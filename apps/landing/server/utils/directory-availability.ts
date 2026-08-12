import type {
  DirectoryExpertAvailability,
} from '../../shared/types/directory'
import type {
  DirectoryCatalogSnapshot,
  DirectoryExpertDraft,
} from './directory-catalog'
import type { OpenExpertDataClient } from './platform-data'

const DEFAULT_TIMEZONE = 'Europe/Warsaw'
const DEFAULT_DATE_LIMIT = 3
const DEFAULT_SEARCH_DAYS = 31
const DEFAULT_CONCURRENCY = 8
const DEFAULT_TIMEOUT_MS = 3_000
const timezoneFormatters = new Map<string, Intl.DateTimeFormat>()

interface DirectoryAvailabilityRpcSlot {
  starts_at: string
  ends_at: string
  expert_user_id: string
  expert_name: string
}

export interface DirectoryAvailabilityBatch {
  serviceId: string
  ok: boolean
  slots: unknown[]
}

export interface DirectoryAvailabilitySummaryOptions {
  expertId: string
  timezone: string
  now?: Date | string
  limitDates?: number
}

interface DirectoryAvailabilityTask {
  expertId: string
  widgetKey: string
  serviceId: string
  startsOn: string
  endsOn: string
}

interface DirectoryAvailabilityTaskResult {
  expertId: string
  batch: DirectoryAvailabilityBatch
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function localDateFormatter(value: string): {
  timezone: string
  formatter: Intl.DateTimeFormat
} {
  const timezone = value.trim() || DEFAULT_TIMEZONE
  const cached = timezoneFormatters.get(timezone)
  if (cached) return { timezone, formatter: cached }

  try {
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    formatter.format(0)
    timezoneFormatters.set(timezone, formatter)
    return { timezone, formatter }
  } catch {
    return localDateFormatter(DEFAULT_TIMEZONE)
  }
}

function safeTimezone(value: string): string {
  return localDateFormatter(value).timezone
}

function parsedDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.valueOf()) ? date : null
}

export function directoryLocalIsoDate(
  value: Date | string,
  timezone: string,
): string | null {
  const date = parsedDate(value)
  if (!date) return null

  const parts = localDateFormatter(timezone).formatter.formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return values.year && values.month && values.day
    ? `${values.year}-${values.month}-${values.day}`
    : null
}

export function addDirectoryDays(value: string, days: number): string {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export function summarizeDirectoryAvailability(
  batches: DirectoryAvailabilityBatch[],
  options: DirectoryAvailabilitySummaryOptions,
): DirectoryExpertAvailability {
  const timezone = safeTimezone(options.timezone)
  const now = parsedDate(options.now ?? new Date()) ?? new Date()
  const requestedLimit = options.limitDates ?? DEFAULT_DATE_LIMIT
  const limitDates = Number.isInteger(requestedLimit)
    ? Math.max(1, requestedLimit)
    : DEFAULT_DATE_LIMIT
  const candidates: Array<{
    startsAt: string
    timestamp: number
    localDate: string
    serviceId: string
  }> = []

  for (const batch of batches) {
    if (!batch.ok) continue

    for (const input of batch.slots) {
      const slot = recordValue(input)
      const expertId = String(slot.expert_user_id ?? slot.expertUserId ?? '')
      const startsAtValue = slot.starts_at ?? slot.startsAt
      if (expertId !== options.expertId || typeof startsAtValue !== 'string') continue

      const startsAt = parsedDate(startsAtValue)
      if (!startsAt || startsAt.valueOf() <= now.valueOf()) continue
      const localDate = directoryLocalIsoDate(startsAt, timezone)
      if (!localDate) continue

      candidates.push({
        startsAt: startsAt.toISOString(),
        timestamp: startsAt.valueOf(),
        localDate,
        serviceId: batch.serviceId,
      })
    }
  }

  candidates.sort((left, right) => (
    left.timestamp - right.timestamp
    || left.serviceId.localeCompare(right.serviceId)
  ))

  const seenStartsAt = new Set<string>()
  const seenDates = new Set<string>()
  const dates: DirectoryExpertAvailability['dates'] = []
  for (const candidate of candidates) {
    if (seenStartsAt.has(candidate.startsAt)) continue
    seenStartsAt.add(candidate.startsAt)
    if (seenDates.has(candidate.localDate)) continue
    seenDates.add(candidate.localDate)
    dates.push({
      localDate: candidate.localDate,
      startsAt: candidate.startsAt,
      serviceId: candidate.serviceId,
    })
    if (dates.length === limitDates) break
  }

  const allRequestsSucceeded = batches.length > 0
    && batches.every(batch => batch.ok)
  if (dates.length && allRequestsSucceeded) {
    return { status: 'available', timezone, dates }
  }

  return {
    status: allRequestsSucceeded ? 'none' : 'unknown',
    timezone,
    dates: allRequestsSucceeded ? dates : [],
  }
}

async function mapWithConcurrency<Input, Output>(
  inputs: Input[],
  concurrency: number,
  mapper: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const outputs = new Array<Output>(inputs.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < inputs.length) {
      const index = nextIndex
      nextIndex += 1
      outputs[index] = await mapper(inputs[index]!)
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), inputs.length) },
    () => worker(),
  ))
  return outputs
}

export async function loadDirectoryExpertAvailability(
  backendData: OpenExpertDataClient,
  experts: DirectoryExpertDraft[],
  catalogs: DirectoryCatalogSnapshot[],
  options: {
    now?: Date
    concurrency?: number
    searchDays?: number
    limitDates?: number
    timeoutMs?: number
  } = {},
): Promise<Map<string, DirectoryExpertAvailability>> {
  const now = options.now ?? new Date()
  const requestedSearchDays = options.searchDays
  const searchDays = Number.isInteger(requestedSearchDays)
    ? Math.min(DEFAULT_SEARCH_DAYS, Math.max(0, requestedSearchDays!))
    : DEFAULT_SEARCH_DAYS
  const catalogsByWidgetKey = new Map(catalogs.map(catalog => [
    catalog.widgetKey,
    catalog,
  ]))
  const timezonesByExpert = new Map<string, string>()
  const tasks: DirectoryAvailabilityTask[] = []

  for (const expert of experts) {
    const catalog = catalogsByWidgetKey.get(expert.widgetKey)
    const catalogExpert = catalog?.experts.find(candidate => (
      candidate.expertId === expert.expertId
    ))
    const timezone = safeTimezone(catalog?.facility.timezone ?? DEFAULT_TIMEZONE)
    timezonesByExpert.set(expert.expertId, timezone)
    const startsOn = directoryLocalIsoDate(now, timezone)
    if (!catalog || !catalogExpert || !startsOn) continue
    const endsOn = addDirectoryDays(
      startsOn,
      searchDays,
    )

    for (const serviceId of catalogExpert.serviceKeys) {
      tasks.push({
        expertId: expert.expertId,
        widgetKey: expert.widgetKey,
        serviceId,
        startsOn,
        endsOn,
      })
    }
  }

  const abortController = new AbortController()
  const timeout = setTimeout(
    () => abortController.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  let results: DirectoryAvailabilityTaskResult[]
  try {
    results = await mapWithConcurrency(
      tasks,
      options.concurrency ?? DEFAULT_CONCURRENCY,
      async (task): Promise<DirectoryAvailabilityTaskResult> => {
        if (abortController.signal.aborted) {
          return {
            expertId: task.expertId,
            batch: { serviceId: task.serviceId, ok: false, slots: [] },
          }
        }
        try {
          const { data, error } = await backendData.rpc<DirectoryAvailabilityRpcSlot[]>(
            'get_booking_widget_slots',
            {
              p_widget_token: task.widgetKey,
              p_service_id: task.serviceId,
              p_starts_on: task.startsOn,
              p_ends_on: task.endsOn,
              p_expert_user_id: task.expertId,
            },
          ).abortSignal(abortController.signal)
          if (error) {
            if (!abortController.signal.aborted) {
              console.warn('[directory] expert availability query failed', {
                widgetKey: task.widgetKey,
                expertId: task.expertId,
                serviceId: task.serviceId,
                code: error.code,
              })
            }
            return {
              expertId: task.expertId,
              batch: { serviceId: task.serviceId, ok: false, slots: [] },
            }
          }
          return {
            expertId: task.expertId,
            batch: {
              serviceId: task.serviceId,
              ok: true,
              slots: Array.isArray(data) ? data : [],
            },
          }
        } catch (error) {
          if (!abortController.signal.aborted) {
            console.warn('[directory] expert availability request failed', {
              widgetKey: task.widgetKey,
              expertId: task.expertId,
              serviceId: task.serviceId,
              message: error instanceof Error ? error.message : String(error),
            })
          }
          return {
            expertId: task.expertId,
            batch: { serviceId: task.serviceId, ok: false, slots: [] },
          }
        }
      },
    )
  } finally {
    clearTimeout(timeout)
  }

  const batchesByExpert = new Map<string, DirectoryAvailabilityBatch[]>()
  for (const result of results) {
    const batches = batchesByExpert.get(result.expertId) ?? []
    batches.push(result.batch)
    batchesByExpert.set(result.expertId, batches)
  }

  return new Map(experts.map((expert) => {
    const timezone = timezonesByExpert.get(expert.expertId) ?? DEFAULT_TIMEZONE
    return [
      expert.expertId,
      summarizeDirectoryAvailability(
        batchesByExpert.get(expert.expertId) ?? [],
        {
          expertId: expert.expertId,
          timezone,
          now,
          limitDates: options.limitDates,
        },
      ),
    ]
  }))
}
