import { randomInt, randomUUID } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import type {
  InAppNotification,
  InAppNotificationActor,
  InAppNotificationPriority,
  InAppNotificationTone,
  NotificationFeedResponse,
  NotificationReadResponse,
  NotificationRealtimeSnapshot,
  NotificationsReadAllResponse,
} from '~~/shared/types/notifications'
import { serverDataBackend } from './data-api'
import {
  asRecord,
  textValue,
  type CrmSession,
} from './crm'
import {
  notificationRealtimeSignal,
  publishNotificationChange,
} from './notification-realtime'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const cursorPattern = /^[A-Za-z0-9_-]+$/u
const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u
const notificationNudgeLimit = 10
const notificationDeliveryConcurrency = 6
const notificationPriorities = new Set<InAppNotificationPriority>([
  'low',
  'normal',
  'high',
  'urgent',
])

export interface NotificationFeedQuery {
  limit: number
  beforeCreatedAt: string | null
  beforeId: string | null
  unreadOnly: boolean
}

export type NotificationFeedData = Omit<NotificationFeedResponse, 'realtime'>

export type NotificationRealtimeSnapshotData = Omit<NotificationRealtimeSnapshot, 'realtime'>

interface NotificationDeliveryJob {
  id: string
  organizationId: string
  recipientUserId: string
  channel: string
  attempts: number
  maxAttempts: number
  payload: Record<string, unknown>
}

function validationError(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message })
}

function contractError(message: string): never {
  throw createError({
    statusCode: 500,
    statusMessage: `Notification data contract is invalid: ${message}`,
  })
}

function firstRecord(input: unknown): Record<string, unknown> {
  const value = Array.isArray(input) ? input[0] : input
  return asRecord(value)
}

function requiredString(input: unknown, field: string): string {
  const value = textValue(input)
  if (!value) return contractError(`${field} is required`)
  return value
}

function optionalString(input: unknown, field: string, maxLength: number): string | null {
  if (input === null || input === undefined || input === '') return null
  const value = requiredString(input, field)
  if (value.length > maxLength) return contractError(`${field} is too long`)
  return value
}

function requiredBoundedString(input: unknown, field: string, maxLength: number): string {
  return optionalString(input, field, maxLength)
    ?? contractError(`${field} is required`)
}

function requiredUuid(input: unknown, field: string): string {
  const value = requiredString(input, field).toLowerCase()
  if (!uuidPattern.test(value)) return contractError(`${field} must be a UUID`)
  return value
}

function safeInteger(input: unknown, field: string, minimum = 0): number {
  const value = typeof input === 'number' ? input : Number(input)
  if (!Number.isSafeInteger(value) || value < minimum) {
    return contractError(`${field} must be an integer greater than or equal to ${minimum}`)
  }
  return value
}

function normalizedDate(input: unknown, field: string): string {
  const value = requiredString(input, field)
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return contractError(`${field} must be an ISO date-time`)
  return date.toISOString()
}

function optionalDate(input: unknown, field: string): string | null {
  if (input === null || input === undefined || input === '') return null
  return normalizedDate(input, field)
}

function normalizedBoolean(input: unknown, field: string): boolean {
  if (input === true || input === false) return input
  return contractError(`${field} must be a boolean`)
}

function notificationDbError(
  error: { message?: string, code?: string } | null | undefined,
): void {
  if (!error) return
  const message = String(error.message ?? 'Notification operation failed')
  const code = String(error.code ?? '')
  const statusCode = code === '42501'
    ? 403
    : code === 'P0002' || /notification_not_found/iu.test(message)
      ? 404
      : code === '22023' || code === '23514'
        ? 400
        : 500
  if (statusCode === 500) {
    console.error('[crm-notifications] database operation failed', { code, message })
  }
  const statusMessage = statusCode === 403
    ? 'Notification access denied'
    : statusCode === 404
      ? 'Notification not found'
      : statusCode === 400
        ? 'Invalid notification operation'
        : 'Notification operation failed'
  throw createError({ statusCode, statusMessage })
}

function singleQueryValue(input: unknown): unknown {
  return Array.isArray(input) ? input[0] : input
}

function parseLimit(input: unknown): number {
  if (input === undefined || input === null || input === '') return 30
  const value = Number(singleQueryValue(input))
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    return validationError('limit must be between 1 and 50')
  }
  return value
}

function parseUnreadOnly(input: unknown): boolean {
  if (input === undefined || input === null || input === '') return false
  const value = String(singleQueryValue(input)).trim().toLowerCase()
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0') return false
  return validationError('unreadOnly must be true or false')
}

function parseCursor(input: unknown): Pick<NotificationFeedQuery, 'beforeCreatedAt' | 'beforeId'> {
  const raw = textValue(singleQueryValue(input))
  if (!raw) return { beforeCreatedAt: null, beforeId: null }
  if (raw.length > 1_000 || !cursorPattern.test(raw)) {
    return validationError('cursor is invalid')
  }

  let cursor: Record<string, unknown>
  try {
    cursor = asRecord(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
  }
  catch {
    return validationError('cursor is invalid')
  }
  if (
    Object.keys(cursor).some(key => key !== 'createdAt' && key !== 'id')
    || !cursor.createdAt
    || !cursor.id
  ) {
    return validationError('cursor is invalid')
  }

  const createdAtValue = textValue(cursor.createdAt)
  const idValue = textValue(cursor.id)?.toLowerCase()
  const createdAt = createdAtValue ? new Date(createdAtValue) : null
  if (
    !createdAt
    || Number.isNaN(createdAt.valueOf())
    || !idValue
    || !uuidPattern.test(idValue)
  ) {
    return validationError('cursor is invalid')
  }
  return {
    beforeCreatedAt: createdAt.toISOString(),
    beforeId: idValue,
  }
}

function encodeCursor(input: unknown): string | null {
  if (input === null || input === undefined) return null
  const cursor = asRecord(input)
  const createdAt = normalizedDate(
    cursor.createdAt ?? cursor.created_at,
    'nextCursor.createdAt',
  )
  const id = requiredUuid(cursor.id, 'nextCursor.id')
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url')
}

export function parseNotificationFeedQuery(
  query: Record<string, unknown>,
): NotificationFeedQuery {
  if (Object.keys(query).some(key => !['cursor', 'limit', 'unreadOnly'].includes(key))) {
    return validationError('Unsupported notification query field')
  }
  const cursor = parseCursor(query.cursor)
  return {
    limit: parseLimit(query.limit),
    unreadOnly: parseUnreadOnly(query.unreadOnly),
    ...cursor,
  }
}

function mapActor(input: unknown): InAppNotificationActor | null {
  if (input === null || input === undefined) return null
  const actor = asRecord(input)
  const rawId = textValue(actor.id)
  const name = optionalString(actor.name, 'actor.name', 160)
  if (!rawId && !name) return null
  return {
    id: rawId ? requiredUuid(rawId, 'actor.id') : null,
    name: name ?? 'Użytkownik',
    avatarUrl: actor.avatarUrl === null || actor.avatarUrl === undefined
      ? null
      : optionalString(actor.avatarUrl, 'actor.avatarUrl', 2_048),
  }
}

function mapPriority(input: unknown): InAppNotificationPriority {
  const value = requiredString(input, 'item.priority') as InAppNotificationPriority
  if (!notificationPriorities.has(value)) {
    return contractError('item.priority is unsupported')
  }
  return value
}

interface NotificationPresentationDefaults {
  title: string
  icon: string
  tone: InAppNotificationTone
}

const presentationDefaults: Record<string, NotificationPresentationDefaults> = {
  'crm.case_message.received': {
    title: 'Nowa wiadomość od klienta',
    icon: 'i-lucide-message-circle',
    tone: 'info',
  },
  'crm.task.delegated': {
    title: 'Przydzielono Ci zadanie',
    icon: 'i-lucide-list-checks',
    tone: 'info',
  },
  'crm.task.accepted': {
    title: 'Zadanie zostało przyjęte',
    icon: 'i-lucide-circle-check',
    tone: 'success',
  },
  'crm.task.rejected': {
    title: 'Zadanie zostało odrzucone',
    icon: 'i-lucide-circle-x',
    tone: 'warning',
  },
  'crm.task.cancelled': {
    title: 'Zadanie zostało anulowane',
    icon: 'i-lucide-ban',
    tone: 'neutral',
  },
  'crm.task.completed': {
    title: 'Zadanie zostało ukończone',
    icon: 'i-lucide-badge-check',
    tone: 'success',
  },
  'crm.case_item_handoff.requested': {
    title: 'Prośba o przejęcie procesu',
    icon: 'i-lucide-git-pull-request-arrow',
    tone: 'info',
  },
  'crm.case_item_handoff.accepted': {
    title: 'Przekazanie procesu zostało przyjęte',
    icon: 'i-lucide-circle-check',
    tone: 'success',
  },
  'crm.case_item_handoff.rejected': {
    title: 'Przekazanie procesu zostało odrzucone',
    icon: 'i-lucide-circle-x',
    tone: 'warning',
  },
  'crm.case_item_handoff.cancelled': {
    title: 'Przekazanie procesu zostało anulowane',
    icon: 'i-lucide-ban',
    tone: 'neutral',
  },
}

function payloadUuid(input: unknown): string | null {
  const value = textValue(input)?.toLowerCase()
  return value && uuidPattern.test(value) ? value : null
}

function payloadLabel(input: unknown, field: string): string | null {
  return optionalString(input, field, 200)
}

function quotedLabel(input: string | null): string {
  return input ? ` „${input}”` : ''
}

function caseActionPath(
  payload: Record<string, unknown>,
  organizationSlug: string,
  eventType: string,
): string | null {
  const caseId = payloadUuid(payload.caseId ?? payload.case_id)
  if (!caseId) return null

  const base = `/org/${encodeURIComponent(organizationSlug)}/cases/${caseId}`
  if (eventType === 'crm.case_message.received') {
    const conversationId = payloadUuid(payload.conversationId ?? payload.conversation_id)
    const params = new URLSearchParams({ view: 'messages' })
    if (conversationId) params.set('conversation', conversationId)
    return `${base}?${params.toString()}`
  }

  if (eventType.startsWith('crm.task.')) {
    const taskId = payloadUuid(payload.taskId ?? payload.task_id)
    const params = new URLSearchParams({ view: 'delegations' })
    if (taskId) params.set('task', taskId)
    return `${base}?${params.toString()}`
  }

  if (eventType.startsWith('crm.case_item_handoff.')) {
    const caseItemId = payloadUuid(payload.caseItemId ?? payload.case_item_id)
    return caseItemId ? `${base}#case-process-${caseItemId}` : base
  }

  return null
}

function notificationPresentation(
  eventType: string,
  schemaVersion: number,
  payload: Record<string, unknown>,
  organizationSlug: string,
) {
  const defaults = schemaVersion === 1 ? presentationDefaults[eventType] : undefined
  if (!defaults) {
    return {
      title: 'Nowe powiadomienie',
      body: '',
      icon: 'i-lucide-bell',
      tone: 'neutral' as const,
      actionPath: null,
    }
  }

  let body = ''
  if (eventType === 'crm.case_message.received') {
    const caseTitle = payloadLabel(
      payload.caseTitle ?? payload.case_title,
      'item.payload.caseTitle',
    )
    body = `Otrzymano nową wiadomość w sprawie${quotedLabel(caseTitle)}.`
  }
  else if (eventType.startsWith('crm.task.')) {
    const taskTitle = payloadLabel(
      payload.taskTitle ?? payload.task_title,
      'item.payload.taskTitle',
    )
    const suffix = eventType === 'crm.task.delegated'
      ? 'czeka na Twoją decyzję'
      : eventType === 'crm.task.accepted'
        ? 'zostało przyjęte'
        : eventType === 'crm.task.rejected'
          ? 'zostało odrzucone'
          : eventType === 'crm.task.cancelled'
            ? 'zostało anulowane'
            : 'zostało ukończone'
    body = `Zadanie${quotedLabel(taskTitle)} ${suffix}.`
  }
  else if (eventType.startsWith('crm.case_item_handoff.')) {
    const caseItemTitle = payloadLabel(
      payload.caseItemTitle ?? payload.case_item_title,
      'item.payload.caseItemTitle',
    )
    const suffix = eventType === 'crm.case_item_handoff.requested'
      ? 'czeka na Twoją decyzję'
      : eventType === 'crm.case_item_handoff.accepted'
        ? 'zostało przyjęte'
        : eventType === 'crm.case_item_handoff.rejected'
          ? 'zostało odrzucone'
          : 'zostało anulowane'
    body = eventType === 'crm.case_item_handoff.requested'
      ? `Proces${quotedLabel(caseItemTitle)} ${suffix}.`
      : `Przekazanie procesu${quotedLabel(caseItemTitle)} ${suffix}.`
  }
  return {
    title: defaults.title,
    body,
    icon: defaults.icon,
    tone: defaults.tone,
    actionPath: caseActionPath(payload, organizationSlug, eventType),
  }
}

function mapNotificationItem(input: unknown, organizationSlug: string): InAppNotification {
  const row = asRecord(input)
  const eventType = requiredBoundedString(
    row.eventType ?? row.event_type,
    'item.eventType',
    120,
  )
  const schemaVersion = safeInteger(
    row.schemaVersion ?? row.schema_version,
    'item.schemaVersion',
    1,
  )
  const subjectType = optionalString(
    row.subjectType ?? row.subject_type,
    'item.subjectType',
    80,
  )
  const subjectId = optionalString(
    row.subjectId ?? row.subject_id,
    'item.subjectId',
    500,
  )
  if (Boolean(subjectType) !== Boolean(subjectId)) {
    return contractError('item subject must include both type and id')
  }
  const presentation = notificationPresentation(
    eventType,
    schemaVersion,
    asRecord(row.payload),
    organizationSlug,
  )
  return {
    id: requiredUuid(row.id, 'item.id'),
    eventId: requiredUuid(row.eventId ?? row.event_id, 'item.eventId'),
    eventType,
    priority: mapPriority(row.priority),
    ...presentation,
    actor: mapActor(row.actor),
    readAt: optionalDate(row.readAt ?? row.read_at, 'item.readAt'),
    createdAt: normalizedDate(row.createdAt ?? row.created_at, 'item.createdAt'),
  }
}

export function mapNotificationFeed(
  input: unknown,
  organizationSlug: string,
): NotificationFeedData {
  const row = firstRecord(input)
  const data = Array.isArray(row.items)
    ? row.items.map(item => mapNotificationItem(item, organizationSlug))
    : []
  return {
    data,
    page: {
      nextCursor: encodeCursor(row.nextCursor ?? row.next_cursor),
      hasMore: normalizedBoolean(row.hasMore ?? row.has_more, 'hasMore'),
    },
    unreadCount: safeInteger(row.unreadCount ?? row.unread_count, 'unreadCount'),
    generatedAt: normalizedDate(row.generatedAt ?? row.generated_at, 'generatedAt'),
    revision: safeInteger(row.revision, 'revision'),
  }
}

function mapRealtimeEvent(
  input: unknown,
  revision: number,
): NotificationRealtimeSnapshotData['lastEvent'] {
  if (input === null || input === undefined) return null
  const event = asRecord(input)
  const eventRevision = safeInteger(event.revision, 'lastEvent.revision')
  if (eventRevision !== revision) return null
  return notificationRealtimeSignal(
    requiredUuid(event.eventId ?? event.event_id, 'lastEvent.eventId'),
    eventRevision,
  )
}

export function mapNotificationRealtimeSnapshot(
  input: unknown,
): NotificationRealtimeSnapshotData {
  const row = firstRecord(input)
  const revision = safeInteger(row.revision, 'revision')
  return {
    revision,
    lastEvent: mapRealtimeEvent(row.lastEvent ?? row.last_event, revision),
    updatedAt: optionalDate(row.updatedAt ?? row.updated_at, 'updatedAt'),
  }
}

export async function loadNotificationFeed(
  session: CrmSession,
  query: NotificationFeedQuery,
): Promise<NotificationFeedData> {
  const result = await session.dataApi.rpc('get_my_notification_feed', {
    p_organization_id: session.organizationId,
    p_limit: query.limit,
    p_before_created_at: query.beforeCreatedAt,
    p_before_id: query.beforeId,
    p_unread_only: query.unreadOnly,
  })
  notificationDbError(result.error)
  return mapNotificationFeed(result.data, session.organizationSlug)
}

export async function loadNotificationRealtimeSnapshot(
  session: CrmSession,
): Promise<NotificationRealtimeSnapshotData> {
  const result = await session.dataApi.rpc('get_my_notification_realtime_state', {
    p_organization_id: session.organizationId,
  })
  notificationDbError(result.error)
  return mapNotificationRealtimeSnapshot(result.data)
}

export async function markNotificationRead(
  session: CrmSession,
  notificationId: string,
): Promise<NotificationReadResponse> {
  const result = await session.dataApi.rpc('mark_notification_read', {
    p_organization_id: session.organizationId,
    p_notification_id: notificationId,
  })
  notificationDbError(result.error)
  const row = firstRecord(result.data)
  const snapshot = mapNotificationRealtimeSnapshot(row)
  return {
    data: {
      id: requiredUuid(row.notificationId ?? row.notification_id, 'notificationId'),
      readAt: normalizedDate(row.readAt ?? row.read_at, 'readAt'),
    },
    changed: normalizedBoolean(row.changed, 'changed'),
    revision: snapshot.revision,
  }
}

export async function markNotificationsReadThrough(
  session: CrmSession,
  throughAt: string,
): Promise<NotificationsReadAllResponse> {
  const result = await session.dataApi.rpc('mark_notifications_read_through', {
    p_organization_id: session.organizationId,
    p_through_at: throughAt,
  })
  notificationDbError(result.error)
  const row = firstRecord(result.data)
  const snapshot = mapNotificationRealtimeSnapshot(row)
  const count = safeInteger(row.updatedCount ?? row.updated_count, 'updatedCount')
  return {
    data: {
      count,
      readAt: normalizedDate(row.throughAt ?? row.through_at, 'throughAt'),
    },
    changed: count > 0,
    revision: snapshot.revision,
  }
}

export function parseNotificationsReadThroughInput(input: unknown): string {
  const body = asRecord(input)
  if (Object.keys(body).some(key => key !== 'through')) {
    return validationError('Unsupported read-all field')
  }
  const through = textValue(body.through)
  if (!through) return validationError('through is required')
  const date = new Date(through)
  if (!isoDateTimePattern.test(through) || Number.isNaN(date.valueOf())) {
    return validationError('through must be an ISO date-time')
  }
  return date.toISOString()
}

function mapNotificationDeliveryJob(input: unknown): NotificationDeliveryJob {
  const row = asRecord(input)
  const attempts = safeInteger(row.attempts, 'deliveryJob.attempts', 1)
  const maxAttempts = safeInteger(
    row.max_attempts ?? row.maxAttempts,
    'deliveryJob.maxAttempts',
    1,
  )
  if (attempts > maxAttempts) {
    return contractError('deliveryJob.attempts exceeds maxAttempts')
  }
  return {
    id: requiredUuid(row.id, 'deliveryJob.id'),
    organizationId: requiredUuid(
      row.organization_id ?? row.organizationId,
      'deliveryJob.organizationId',
    ),
    recipientUserId: requiredUuid(
      row.recipient_user_id ?? row.recipientUserId,
      'deliveryJob.recipientUserId',
    ),
    channel: requiredString(row.channel, 'deliveryJob.channel'),
    attempts,
    maxAttempts,
    payload: { ...asRecord(row.payload) },
  }
}

function notificationRetryDelay(job: NotificationDeliveryJob): string {
  // The database will not claim a job once attempts reaches maxAttempts. A
  // final delay is still supplied because the completion RPC has one uniform
  // contract for retryable and terminal failures.
  if (job.attempts >= job.maxAttempts) return '15 minutes'

  const exponent = Math.min(job.attempts - 1, 8)
  const uncappedSeconds = 5 * (2 ** exponent)
  const jitter = randomInt(800, 1_201) / 1_000
  const seconds = Math.max(1, Math.min(15 * 60, Math.round(uncappedSeconds * jitter)))
  return `${seconds} seconds`
}

async function completeNotificationDeliveryJob(
  backend: any,
  input: {
    jobId: string
    workerId: string
    succeeded: boolean
    error: string | null
    provider: string | null
    providerMessageId: string | null
    retryDelay?: string
  },
): Promise<void> {
  const result = await backend.rpc('complete_notification_delivery_job', {
    p_id: input.jobId,
    p_worker_id: input.workerId,
    p_succeeded: input.succeeded,
    p_error: input.error,
    p_retry_delay: input.retryDelay ?? '5 seconds',
    p_provider: input.provider,
    p_provider_message_id: input.providerMessageId,
  })
  notificationDbError(result.error)
}

export async function drainNotificationDeliveryJobs(
  event: H3Event,
  workerId: string,
  limit: number,
) {
  const backend = serverDataBackend(event) as any
  const claimResult = await backend.rpc('claim_notification_delivery_jobs', {
    p_worker_id: workerId,
    p_limit: limit,
  })
  notificationDbError(claimResult.error)
  if (!Array.isArray(claimResult.data)) {
    return contractError('delivery job claim must return an array')
  }
  const jobs: NotificationDeliveryJob[] = claimResult.data.map(mapNotificationDeliveryJob)

  async function processJob(job: NotificationDeliveryJob) {
    try {
      if (job.channel !== 'realtime') {
        throw new Error(`Unsupported notification delivery channel: ${job.channel}`)
      }
      const publishResult = await publishNotificationChange(event, {
        organizationId: job.organizationId,
        userId: job.recipientUserId,
        eventId: job.id,
        revision: job.payload.revision,
      })
      if (publishResult.configured && !publishResult.published) {
        throw new Error(publishResult.error ?? 'Notification realtime publish failed')
      }

      await completeNotificationDeliveryJob(backend, {
        jobId: job.id,
        workerId,
        succeeded: true,
        error: null,
        provider: publishResult.provider,
        providerMessageId: publishResult.providerMessageId,
      })
      return {
        completed: 1,
        delivered: publishResult.published ? 1 : 0,
        failed: 0,
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        await completeNotificationDeliveryJob(backend, {
          jobId: job.id,
          workerId,
          succeeded: false,
          error: message.slice(0, 1_000),
          provider: job.channel === 'realtime' ? 'ably' : null,
          providerMessageId: null,
          retryDelay: notificationRetryDelay(job),
        })
      }
      catch (completionError) {
        console.error('[crm-notifications] could not release failed delivery job', {
          eventId: job.id,
          message: completionError instanceof Error
            ? completionError.message
            : String(completionError),
        })
      }
      return { completed: 0, delivered: 0, failed: 1 }
    }
  }

  const results: Array<{ completed: number, delivered: number, failed: number }> = []
  for (let offset = 0; offset < jobs.length; offset += notificationDeliveryConcurrency) {
    const batch = jobs.slice(offset, offset + notificationDeliveryConcurrency)
    results.push(...await Promise.all(batch.map(processJob)))
  }

  return results.reduce<{
    claimed: number
    completed: number
    delivered: number
    failed: number
  }>((totals, result) => ({
    claimed: totals.claimed,
    completed: totals.completed + result.completed,
    delivered: totals.delivered + result.delivered,
    failed: totals.failed + result.failed,
  }), {
    claimed: jobs.length,
    completed: 0,
    delivered: 0,
    failed: 0,
  })
}

export async function nudgeNotificationOutbox(event: H3Event): Promise<void> {
  try {
    const result = await drainNotificationDeliveryJobs(
      event,
      `crm-notification-nudge:${randomUUID()}`,
      notificationNudgeLimit,
    )
    if (result.failed) {
      console.warn('[crm-notifications] realtime nudge left failed jobs', {
        claimed: result.claimed,
        failed: result.failed,
      })
    }
  }
  catch (error) {
    console.warn('[crm-notifications] realtime nudge failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
