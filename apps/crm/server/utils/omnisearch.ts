import type {
  CrmOmnisearchHit,
  CrmOmnisearchResponse,
  CrmOmnisearchTarget,
} from '../../shared/types/omnisearch'

type UnknownRecord = Record<string, unknown>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const statusLabels: Record<string, string> = {
  accepted: 'Przyjęte',
  active: 'Aktywny',
  answered: 'Odpowiedziane',
  archived: 'Archiwalny',
  cancelled: 'Anulowane',
  closed: 'Zamknięte',
  completed: 'Zakończone',
  concluded: 'Zakończona',
  confirmed: 'Potwierdzone',
  draft: 'Szkic',
  braki: 'Braki',
  inactive: 'Nieaktywny',
  in_progress: 'W toku',
  lead: 'Lead',
  missing: 'Brak',
  new: 'Nowy',
  open: 'Otwarte',
  needs_clarification: 'Wymaga doprecyzowania',
  pending: 'Oczekuje',
  received: 'Odebrany',
  rejected: 'Odrzucone',
  resolved: 'Rozwiązane',
  sent: 'Wysłane',
  verified: 'Zweryfikowane',
  waiting_summary: 'Oczekuje na podsumowanie',
  w_analizie: 'W analizie',
  won: 'Wygrane',
  wyslane: 'Wysłane',
  wycofane: 'Wycofane',
  zaakceptowane: 'Zaakceptowane',
  odrzucone: 'Odrzucone',
}

export interface CrmOmnisearchInput {
  query: string
  limit: number
}

export function parseCrmOmnisearchInput(
  rawQuery: unknown,
  rawLimit: unknown,
): CrmOmnisearchInput {
  const queryValue = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery
  const query = typeof queryValue === 'string'
    ? queryValue.trim().replace(/\s+/gu, ' ')
    : ''

  if (query.length < 3 || query.length > 200) {
    throw new RangeError('q must contain between 3 and 200 characters')
  }

  const limitValue = Array.isArray(rawLimit) ? rawLimit[0] : rawLimit
  const limit = limitValue === undefined || limitValue === null || limitValue === ''
    ? 5
    : Number(limitValue)
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
    throw new RangeError('limit must be an integer between 1 and 8')
  }

  return { query, limit }
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter(row => Object.keys(row).length > 0)
    : []
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function uuid(value: unknown): string | undefined {
  const normalized = text(value)
  return normalized && uuidPattern.test(normalized) ? normalized : undefined
}

function joinDetails(...values: unknown[]): string | undefined {
  const details = values.map(text).filter((value): value is string => Boolean(value))
  return details.length ? [...new Set(details)].join(' · ') : undefined
}

function statusLabel(value: unknown): string | undefined {
  const status = text(value)
  if (!status) return undefined
  if (statusLabels[status]) return statusLabels[status]
  const label = status.replaceAll('_', ' ').trim()
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : undefined
}

function formatDateTime(value: unknown, timeZone = 'Europe/Warsaw'): string | undefined {
  const input = text(value)
  if (!input) return undefined
  const date = new Date(input)
  if (Number.isNaN(date.valueOf())) return undefined

  try {
    return new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(date)
  }
  catch {
    return new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Warsaw',
    }).format(date)
  }
}

function dateKeyInTimeZone(value: string, timeZone?: string): string {
  const date = new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timeZone || 'Europe/Warsaw',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function organizationPath(slug: string, path: string): string {
  return `/org/${encodeURIComponent(slug)}${path}`
}

function parentTarget(
  slug: string,
  row: UnknownRecord,
  caseQuery?: Record<string, string>,
): CrmOmnisearchTarget {
  const caseId = uuid(row.case_id)
  if (caseId) {
    return {
      path: organizationPath(slug, `/cases/${caseId}`),
      ...(caseQuery ? { query: caseQuery } : {}),
    }
  }

  const clientId = uuid(row.client_id)
  if (clientId) return organizationPath(slug, `/clients/${clientId}`)
  return organizationPath(slug, '/cases')
}

function mapCases(rows: UnknownRecord[], slug: string): CrmOmnisearchHit[] {
  return rows.flatMap((row) => {
    const id = uuid(row.id)
    const label = text(row.title)
    if (!id || !label) return []

    return [{
      id,
      kind: 'case' as const,
      label,
      description: text(row.client_names) ?? 'Sprawa CRM',
      suffix: statusLabel(row.status_code),
      icon: 'i-lucide-briefcase-business',
      to: organizationPath(slug, `/cases/${id}`),
    }]
  })
}

function mapClients(rows: UnknownRecord[], slug: string): CrmOmnisearchHit[] {
  return rows.flatMap((row) => {
    const id = uuid(row.id)
    const label = text(row.display_name)
    if (!id || !label) return []

    return [{
      id,
      kind: 'client' as const,
      label,
      description: joinDetails(row.primary_email, row.primary_phone) ?? 'Klient CRM',
      suffix: statusLabel(row.status_code),
      icon: 'i-lucide-user-round',
      to: organizationPath(slug, `/clients/${id}`),
    }]
  })
}

function mapAppointments(rows: UnknownRecord[], slug: string): CrmOmnisearchHit[] {
  return rows.flatMap((row) => {
    const id = uuid(row.id)
    const label = text(row.customer_name)
    const expertUserId = uuid(row.expert_user_id)
    const startsAt = text(row.starts_at)
    if (!id || !label || !startsAt) return []

    const timeZone = text(row.timezone)
    const date = dateKeyInTimeZone(startsAt, timeZone)
    const target: CrmOmnisearchTarget = {
      path: organizationPath(slug, '/calendar'),
      query: {
        date,
        appointment: id,
        appointmentAt: startsAt,
        ...(expertUserId ? { expert: expertUserId } : {}),
      },
    }
    const location = text(row.meeting_mode) === 'online'
      ? 'Online'
      : text(row.facility_name)

    return [{
      id,
      kind: 'appointment' as const,
      label,
      description: joinDetails(row.service_name, location, row.expert_name) ?? 'Spotkanie',
      suffix: formatDateTime(startsAt, timeZone),
      icon: 'i-lucide-calendar-clock',
      to: target,
    }]
  })
}

function mapTasks(rows: UnknownRecord[], slug: string): CrmOmnisearchHit[] {
  return rows.flatMap((row) => {
    const id = uuid(row.id)
    const label = text(row.title)
    if (!id || !label) return []

    const dueAt = formatDateTime(row.due_at)
    const targetView = text(row.delegation_status) === 'not_delegated'
      ? 'history'
      : 'delegations'
    return [{
      id,
      kind: 'task' as const,
      label,
      description: joinDetails(row.case_title, row.client_name) ?? 'Zadanie CRM',
      suffix: dueAt ? `Termin: ${dueAt}` : statusLabel(row.delegation_status ?? row.status_code),
      icon: 'i-lucide-list-checks',
      to: parentTarget(slug, row, { view: targetView, task: id }),
    }]
  })
}

function mapDocuments(rows: UnknownRecord[], slug: string): CrmOmnisearchHit[] {
  return rows.flatMap((row) => {
    const id = uuid(row.id)
    const label = text(row.label)
    if (!id || !label) return []

    const application = text(row.record_type) === 'application'
    return [{
      id,
      kind: 'document' as const,
      label,
      description: joinDetails(row.case_title, row.client_name, row.detail)
        ?? (application ? 'Wniosek bankowy' : 'Dokument CRM'),
      suffix: statusLabel(row.status_code),
      icon: application ? 'i-lucide-landmark' : 'i-lucide-file-text',
      to: parentTarget(slug, row, {
        view: 'documents',
        [application ? 'application' : 'document']: id,
      }),
    }]
  })
}

function mapForum(rows: UnknownRecord[], slug: string): CrmOmnisearchHit[] {
  return rows.flatMap((row) => {
    const id = uuid(row.thread_id ?? row.id)
    const label = text(row.title ?? row.label)
    if (!id || !label) return []

    const matchedIn = text(row.matched_in ?? row.matchedIn)
    const category = text(row.category_name ?? row.categoryName)
    const excerpt = text(row.excerpt ?? row.matched_excerpt ?? row.description)
    const description = joinDetails(
      matchedIn ? `Trafienie: ${matchedIn}` : undefined,
      category,
      excerpt,
    ) ?? 'Wątek forum ekspertów'

    return [{
      id,
      kind: 'forum_thread' as const,
      label,
      description,
      suffix: statusLabel(row.status) ?? 'Forum',
      icon: text(row.type) === 'discussion'
        ? 'i-lucide-messages-square'
        : 'i-lucide-message-circle-question',
      to: {
        path: organizationPath(slug, '/forum'),
        query: { thread: id },
      },
    }]
  })
}

export function mapCrmOmnisearchResponse(
  payload: unknown,
  organizationSlug: string,
  query: string,
): CrmOmnisearchResponse {
  const groups = asRecord(payload)

  return {
    query,
    groups: {
      forum: mapForum(recordArray(groups.forum), organizationSlug),
      cases: mapCases(recordArray(groups.cases), organizationSlug),
      clients: mapClients(recordArray(groups.clients), organizationSlug),
      appointments: mapAppointments(recordArray(groups.appointments), organizationSlug),
      tasks: mapTasks(recordArray(groups.tasks), organizationSlug),
      documents: mapDocuments(recordArray(groups.documents), organizationSlug),
    },
  }
}
