import {
  buildMessagePreview,
  DurableConversationEventSchema,
  mapConversationRow,
  mapMessageAttachmentRows,
  mapMessageRow,
  mapReceiptRows,
  type Conversation,
  type ConversationSnapshot,
  type DurableConversationEvent,
  type Message,
  type Receipt,
  type ReceiptUpdateInput,
  type SendMessageInput,
} from '@openexpert/messaging'
import { createError, type H3Event } from 'h3'
import { caseUuidPattern } from './case-identifiers'
import {
  asRecord,
  requireCrmSession,
  throwDbError,
  type CrmSession,
} from './crm'
import { serverDataBackend } from './data-api'
import {
  conversationRealtime,
  publishConversationEvent,
  publishDirectMessagePush,
  type MessagingPublishResult,
} from './messaging-ably'

const conversationSelect = [
  'id',
  'organization_id',
  'case_id',
  'client_id',
  'client_person_id',
  'last_message_sequence',
  'last_message_at',
  'created_at',
  'updated_at',
].join(',')

const messageSelect = [
  'id',
  'organization_id',
  'conversation_id',
  'sequence',
  'client_message_id',
  'sender_kind',
  'sender_user_id',
  'sender_client_person_id',
  'sender_auth_user_id',
  'body',
  'created_at',
  'attachments:crm_case_message_attachments(id,position,file_name,content_type,size_bytes)',
].join(',')

const receiptSelect = [
  'id',
  'organization_id',
  'conversation_id',
  'participant_kind',
  'participant_user_id',
  'participant_client_person_id',
  'delivered_through_sequence',
  'read_through_sequence',
  'delivered_at',
  'read_at',
  'updated_at',
].join(',')

interface CaseAccess {
  session: CrmSession
  caseId: string
  ownerUserId: string | null
}

interface ClientPersonAccess {
  clientId: string
  clientPersonId: string
  displayName: string
  email: string | null
  role: string
  portalEnabled: boolean
  portalActivated: boolean
}

export interface CaseConversationAccess extends CaseAccess {
  clientPerson: ClientPersonAccess
  conversation: Conversation
}

export interface ConversationPageRequest {
  afterSequence?: number
  beforeSequence?: number
  limit: number
}

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !caseUuidPattern.test(value)) {
    throw createError({ statusCode: 404, statusMessage: `${field} not found` })
  }
  return value.toLowerCase()
}

function parseInteger(
  input: unknown,
  field: string,
  options: { minimum: number, maximum: number },
): number | undefined {
  if (input === undefined || input === null || input === '') return undefined
  const value = Array.isArray(input) ? input[0] : input
  const parsed = typeof value === 'number' ? value : Number(value)
  if (
    !Number.isSafeInteger(parsed)
    || parsed < options.minimum
    || parsed > options.maximum
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be an integer between ${options.minimum} and ${options.maximum}`,
    })
  }
  return parsed
}

export function parseConversationPageQuery(
  query: Record<string, unknown>,
): ConversationPageRequest {
  const afterSequence = parseInteger(query.afterSequence ?? query.after_sequence, 'afterSequence', {
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  const beforeSequence = parseInteger(query.beforeSequence ?? query.before_sequence, 'beforeSequence', {
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  if (afterSequence !== undefined && beforeSequence !== undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: 'afterSequence cannot be combined with beforeSequence',
    })
  }
  return {
    ...(afterSequence === undefined ? {} : { afterSequence }),
    ...(beforeSequence === undefined ? {} : { beforeSequence }),
    limit: parseInteger(query.limit, 'limit', { minimum: 1, maximum: 200 }) ?? 100,
  }
}

async function requireCaseAccess(event: H3Event, caseIdInput: unknown): Promise<CaseAccess> {
  const session = await requireCrmSession(event)
  const caseId = requiredUuid(caseIdInput, 'Case')
  const result = await session.dataApi
    .from('crm_cases')
    .select('id, owner_user_id')
    .eq('organization_id', session.organizationId)
    .eq('id', caseId)
    .maybeSingle()

  if (result.error || !result.data) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }
  const ownerUserId = result.data.owner_user_id
    ? String(result.data.owner_user_id)
    : null
  if (session.role !== 'admin' && ownerUserId !== session.userId) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  return { session, caseId, ownerUserId }
}

async function loadPortalState(
  event: H3Event,
  access: CaseAccess,
  clientId: string,
  clientPersonId: string,
): Promise<{ portalEnabled: boolean, portalActivated: boolean }> {
  const backend = serverDataBackend(event) as any
  const [grantResult, linkResult] = await Promise.all([
    backend
      .from('client_portal_case_grants')
      .select('case_id')
      .eq('organization_id', access.session.organizationId)
      .eq('case_id', access.caseId)
      .eq('client_id', clientId)
      .eq('client_person_id', clientPersonId)
      .eq('portal_enabled', true)
      .is('revoked_at', null)
      .maybeSingle(),
    backend
      .from('client_account_links')
      .select('auth_user_id')
      .eq('organization_id', access.session.organizationId)
      .eq('client_id', clientId)
      .eq('client_person_id', clientPersonId)
      .is('revoked_at', null)
      .limit(1)
      .maybeSingle(),
  ])
  throwDbError(grantResult.error)
  throwDbError(linkResult.error)
  return {
    portalEnabled: Boolean(grantResult.data),
    portalActivated: Boolean(linkResult.data),
  }
}

async function requireClientPersonAccess(
  event: H3Event,
  access: CaseAccess,
  clientPersonIdInput: unknown,
): Promise<ClientPersonAccess> {
  const clientPersonId = requiredUuid(clientPersonIdInput, 'Client person')
  const personResult = await access.session.dataApi
    .from('crm_client_people')
    .select('id, client_id, display_name, email, role')
    .eq('organization_id', access.session.organizationId)
    .eq('id', clientPersonId)
    .maybeSingle()
  throwDbError(personResult.error)
  if (!personResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Client person not found' })
  }

  const clientId = String(personResult.data.client_id)
  const linkResult = await access.session.dataApi
    .from('crm_case_clients')
    .select('client_id')
    .eq('organization_id', access.session.organizationId)
    .eq('case_id', access.caseId)
    .eq('client_id', clientId)
    .maybeSingle()
  throwDbError(linkResult.error)
  if (!linkResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Client person not found' })
  }

  const portal = await loadPortalState(event, access, clientId, clientPersonId)
  return {
    clientId,
    clientPersonId,
    displayName: String(personResult.data.display_name ?? ''),
    email: personResult.data.email ? String(personResult.data.email) : null,
    role: String(personResult.data.role ?? ''),
    ...portal,
  }
}

async function findConversationByPerson(
  access: CaseAccess,
  clientPersonId: string,
): Promise<Conversation | null> {
  const result = await access.session.dataApi
    .from('crm_case_conversations')
    .select(conversationSelect)
    .eq('organization_id', access.session.organizationId)
    .eq('case_id', access.caseId)
    .eq('client_person_id', clientPersonId)
    .maybeSingle()
  throwDbError(result.error)
  return result.data ? mapConversationRow(result.data) : null
}

async function findConversationById(
  access: CaseAccess,
  conversationIdInput: unknown,
): Promise<Conversation> {
  const conversationId = requiredUuid(conversationIdInput, 'Conversation')
  const result = await access.session.dataApi
    .from('crm_case_conversations')
    .select(conversationSelect)
    .eq('organization_id', access.session.organizationId)
    .eq('case_id', access.caseId)
    .eq('id', conversationId)
    .maybeSingle()
  throwDbError(result.error)
  if (!result.data) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }
  return mapConversationRow(result.data)
}

async function ensureConversation(
  event: H3Event,
  access: CaseAccess,
  clientPerson: ClientPersonAccess,
): Promise<Conversation> {
  const existing = await findConversationByPerson(access, clientPerson.clientPersonId)
  if (existing) return existing

  const backend = serverDataBackend(event) as any
  const createResult = await backend
    .from('crm_case_conversations')
    .upsert({
      organization_id: access.session.organizationId,
      case_id: access.caseId,
      client_id: clientPerson.clientId,
      client_person_id: clientPerson.clientPersonId,
    }, {
      ignoreDuplicates: true,
      onConflict: 'organization_id,case_id,client_person_id',
    })
  throwDbError(createResult.error)

  const created = await findConversationByPerson(access, clientPerson.clientPersonId)
  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Conversation is temporarily unavailable' })
  }
  return created
}

export async function requireCaseConversationAccess(
  event: H3Event,
  caseIdInput: unknown,
  conversationIdInput: unknown,
): Promise<CaseConversationAccess> {
  const access = await requireCaseAccess(event, caseIdInput)
  const conversation = await findConversationById(access, conversationIdInput)
  const clientPerson = await requireClientPersonAccess(
    event,
    access,
    conversation.clientPersonId,
  )
  return { ...access, conversation, clientPerson }
}

export async function ensureCaseConversation(
  event: H3Event,
  caseIdInput: unknown,
  clientPersonIdInput: unknown,
): Promise<CaseConversationAccess> {
  const access = await requireCaseAccess(event, caseIdInput)
  const clientPerson = await requireClientPersonAccess(event, access, clientPersonIdInput)
  if (!clientPerson.portalEnabled) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Enable the client portal before starting a conversation',
    })
  }
  const conversation = await ensureConversation(event, access, clientPerson)
  return { ...access, conversation, clientPerson }
}

async function loadMessages(
  access: CaseConversationAccess,
  page: ConversationPageRequest,
): Promise<{ messages: Message[], hasMore: boolean, lastSequence: number }> {
  let request = access.session.dataApi
    .from('crm_case_messages')
    .select(messageSelect)
    .eq('organization_id', access.session.organizationId)
    .eq('conversation_id', access.conversation.id)

  const ascending = page.afterSequence !== undefined
  if (page.afterSequence !== undefined) {
    request = request
      .gt('sequence', page.afterSequence)
      .order('sequence', { ascending: true })
  }
  else {
    if (page.beforeSequence !== undefined) {
      request = request.lt('sequence', page.beforeSequence)
    }
    request = request.order('sequence', { ascending: false })
  }

  const result = await request.limit(page.limit + 1)
  throwDbError(result.error)
  const hasMore = (result.data ?? []).length > page.limit
  const messages = (result.data ?? []).slice(0, page.limit).map(mapMessageRow)
  if (!ascending) messages.reverse()
  return {
    messages,
    hasMore,
    lastSequence: ascending
      ? messages.at(-1)?.sequence ?? page.afterSequence ?? 0
      : access.conversation.lastMessageSequence,
  }
}

function receiptRank(receipt: Receipt): [number, number, number] {
  return [
    receipt.readThroughSequence,
    receipt.deliveredThroughSequence,
    Date.parse(receipt.updatedAt),
  ]
}

function higherReceipt(left: Receipt, right: Receipt): Receipt {
  const leftRank = receiptRank(left)
  const rightRank = receiptRank(right)
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] === rightRank[index]) continue
    return leftRank[index]! > rightRank[index]! ? left : right
  }
  return left
}

async function loadReceipts(
  access: CaseConversationAccess,
): Promise<{ receipt: Receipt | null, peerReceipt: Receipt | null }> {
  const result = await access.session.dataApi
    .from('crm_case_conversation_states')
    .select(receiptSelect)
    .eq('organization_id', access.session.organizationId)
    .eq('conversation_id', access.conversation.id)
  throwDbError(result.error)

  const receipts = mapReceiptRows(result.data ?? [])
  const receipt = receipts.find(candidate => (
    candidate.participantKind === 'staff'
    && candidate.participantUserId === access.session.userId
  )) ?? null
  const peerReceipt = receipts
    .filter(candidate => candidate.participantKind === 'client')
    .reduce<Receipt | null>((highest, candidate) => (
      highest ? higherReceipt(highest, candidate) : candidate
    ), null)
  return { receipt, peerReceipt }
}

export async function loadCaseConversationSnapshot(
  event: H3Event,
  access: CaseConversationAccess,
  page: ConversationPageRequest,
): Promise<ConversationSnapshot & {
  clientPerson: ClientPersonAccess
  realtime: ReturnType<typeof conversationRealtime>
}> {
  const [messagePage, receipts] = await Promise.all([
    loadMessages(access, page),
    loadReceipts(access),
  ])
  return {
    conversation: access.conversation,
    clientPerson: access.clientPerson,
    messages: messagePage.messages,
    receipt: receipts.receipt,
    peerReceipt: receipts.peerReceipt,
    pageInfo: {
      lastSequence: messagePage.lastSequence,
      hasMore: messagePage.hasMore,
    },
    realtime: conversationRealtime(event, access.conversation.id),
  }
}

async function listCasePeople(
  event: H3Event,
  access: CaseAccess,
): Promise<ClientPersonAccess[]> {
  const caseClientsResult = await access.session.dataApi
    .from('crm_case_clients')
    .select('client_id')
    .eq('organization_id', access.session.organizationId)
    .eq('case_id', access.caseId)
  throwDbError(caseClientsResult.error)
  const clientIds = [...new Set((caseClientsResult.data ?? []).map(
    (row: Record<string, unknown>) => String(row.client_id),
  ))]
  if (!clientIds.length) return []

  const peopleResult = await access.session.dataApi
    .from('crm_client_people')
    .select('id, client_id, display_name, email, role')
    .eq('organization_id', access.session.organizationId)
    .in('client_id', clientIds)
    .order('display_name')
  throwDbError(peopleResult.error)

  return Promise.all((peopleResult.data ?? []).map(async (row: Record<string, unknown>) => {
    const clientId = String(row.client_id)
    const clientPersonId = String(row.id)
    const portal = await loadPortalState(event, access, clientId, clientPersonId)
    return {
      clientId,
      clientPersonId,
      displayName: String(row.display_name ?? ''),
      email: row.email ? String(row.email) : null,
      role: String(row.role ?? ''),
      ...portal,
    }
  }))
}

export async function listCaseConversations(event: H3Event, caseIdInput: unknown) {
  const access = await requireCaseAccess(event, caseIdInput)
  const [recipients, conversationsResult] = await Promise.all([
    listCasePeople(event, access),
    access.session.dataApi
      .from('crm_case_conversations')
      .select(conversationSelect)
      .eq('organization_id', access.session.organizationId)
      .eq('case_id', access.caseId)
      .order('last_message_at', { ascending: false, nullsFirst: false }),
  ])
  throwDbError(conversationsResult.error)
  const conversations: Conversation[] = (
    (conversationsResult.data ?? []) as unknown[]
  ).map(mapConversationRow)
  const recipientByPerson = new Map(recipients.map(recipient => [
    recipient.clientPersonId,
    recipient,
  ]))

  const summaries = await Promise.all(conversations.map(async (conversation) => {
    const [messageResult, receiptResult] = await Promise.all([
      access.session.dataApi
        .from('crm_case_messages')
        .select('body, created_at, attachments:crm_case_message_attachments(id,position,file_name,content_type,size_bytes)')
        .eq('organization_id', access.session.organizationId)
        .eq('conversation_id', conversation.id)
        .order('sequence', { ascending: false })
        .limit(1)
        .maybeSingle(),
      access.session.dataApi
        .from('crm_case_conversation_states')
        .select('read_through_sequence')
        .eq('organization_id', access.session.organizationId)
        .eq('conversation_id', conversation.id)
        .eq('participant_kind', 'staff')
        .eq('participant_user_id', access.session.userId)
        .maybeSingle(),
    ])
    throwDbError(messageResult.error)
    throwDbError(receiptResult.error)
    const readThroughSequence = Number(receiptResult.data?.read_through_sequence ?? 0)
    return {
      ...conversation,
      clientPerson: recipientByPerson.get(conversation.clientPersonId) ?? null,
      unreadCount: Math.max(0, conversation.lastMessageSequence - readThroughSequence),
      lastMessagePreview: messageResult.data
        ? buildMessagePreview(
            String(messageResult.data.body ?? ''),
            mapMessageAttachmentRows(messageResult.data.attachments ?? []),
          ) || null
        : null,
    }
  }))
  const conversationByPerson = new Map(conversations.map(conversation => [
    conversation.clientPersonId,
    conversation.id,
  ]))

  return {
    conversations: summaries,
    recipients: recipients.map(recipient => ({
      ...recipient,
      conversationId: conversationByPerson.get(recipient.clientPersonId) ?? null,
    })),
    realtime: {
      mode: summaries.some(summary => (
        conversationRealtime(event, summary.id).mode === 'ably'
      )) ? 'ably' as const : 'polling' as const,
      pollIntervalMs: 5_000,
    },
  }
}

function rpcMessage(input: unknown): Message {
  const message = asRecord(input)
  return mapMessageRow({
    id: message.id,
    organization_id: message.organizationId ?? message.organization_id,
    conversation_id: message.conversationId ?? message.conversation_id,
    sequence: message.sequence,
    client_message_id: message.clientMessageId ?? message.client_message_id,
    sender_kind: message.senderKind ?? message.sender_kind,
    sender_user_id: message.senderUserId ?? message.sender_user_id ?? null,
    sender_client_person_id:
      message.senderClientPersonId ?? message.sender_client_person_id ?? null,
    sender_auth_user_id:
      message.senderAuthUserId ?? message.sender_auth_user_id ?? null,
    body: message.body,
    attachments: message.attachments
      ?? message.crm_case_message_attachments
      ?? [],
    created_at: message.createdAt ?? message.created_at,
  })
}

async function markOutboxPublishResult(
  event: H3Event,
  outboxId: string | null,
  result: MessagingPublishResult,
): Promise<void> {
  if (!outboxId) return
  const backend = serverDataBackend(event) as any
  // With no realtime provider configured, authenticated polling is the
  // selected delivery mode. There is nothing for the outbox to retry.
  const update = !result.configured || result.published
    ? {
        status: 'completed',
        // Let PostgreSQL resolve the timestamp. JavaScript only retains
        // milliseconds, which can round below the row's microsecond-precision
        // created_at value and violate the processed ordering constraint.
        processed_at: 'now',
        last_error: null,
        locked_at: null,
        locked_by: null,
      }
    : { last_error: result.error ?? 'Ably publish failed' }
  const updateResult = await backend
    .from('crm_message_outbox')
    .update(update)
    .eq('id', outboxId)
    .in('status', ['pending', 'failed'])
  if (updateResult.error) {
    console.warn('[crm-messaging] could not update outbox after publish', {
      outboxId,
      message: updateResult.error.message,
    })
  }
}

function combinePublishResults(
  results: MessagingPublishResult[],
): MessagingPublishResult {
  const failure = results.find(result => !result.published)
  return failure
    ? {
        configured: results.some(result => result.configured),
        published: false,
        error: failure.error ?? 'Messaging delivery failed',
      }
    : {
        configured: results.some(result => result.configured),
        published: true,
        error: null,
      }
}

async function outboxNeedsDelivery(
  event: H3Event,
  outboxId: string | null,
): Promise<boolean> {
  if (!outboxId) return true
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('crm_message_outbox')
    .select('status')
    .eq('id', outboxId)
    .maybeSingle()
  if (result.error) {
    console.warn('[crm-messaging] could not inspect outbox status', {
      outboxId,
      message: result.error.message,
    })
    return true
  }
  const status = result.data?.status ? String(result.data.status) : ''
  return status !== 'completed' && status !== 'processing'
}

function requireSuccessfulPushes(results: MessagingPublishResult[]): void {
  const failure = results.find(result => !result.published)
  if (failure) {
    throw new Error(failure.error ?? 'Ably direct push failed')
  }
}

async function clientPushIds(
  event: H3Event,
  organizationId: string,
  clientId: string,
  clientPersonId: string,
): Promise<string[]> {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('client_account_links')
    .select('auth_user_id')
    .eq('organization_id', organizationId)
    .eq('client_id', clientId)
    .eq('client_person_id', clientPersonId)
    .is('revoked_at', null)
  if (result.error) {
    throw new Error('Could not resolve client push target')
  }
  return [...new Set<string>(((result.data ?? []) as Record<string, unknown>[]).map(
    (row: Record<string, unknown>) => `client:${String(row.auth_user_id)}`,
  ))]
}

export async function sendStaffConversationMessage(
  event: H3Event,
  access: CaseConversationAccess,
  input: SendMessageInput,
) {
  if (!access.clientPerson.portalEnabled) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Enable the client portal before sending a message',
    })
  }
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('send_staff_case_message_v2', {
    p_organization_id: access.session.organizationId,
    p_case_id: access.caseId,
    p_client_person_id: access.clientPerson.clientPersonId,
    p_actor_user_id: access.session.userId,
    p_client_message_id: input.clientMessageId,
    p_body: input.body,
    p_attachment_ids: input.attachmentIds,
  })
  if (
    result.error
    && String(result.error.message ?? '').includes('case_message_attachment_unavailable')
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'One or more attachments are no longer available. Add them again.',
      data: { code: 'case_message_attachment_unavailable' },
    })
  }
  if (
    result.error
    && String(result.error.message ?? '').includes('case_message_attachments_too_large')
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The combined attachment size exceeds 50 MiB.',
    })
  }
  throwDbError(result.error)

  const payload = asRecord(result.data)
  const message = rpcMessage(payload.message)
  const rawOutboxId = payload.outboxId ?? payload.outbox_id
  const outboxId = rawOutboxId === undefined || rawOutboxId === null
    ? null
    : String(rawOutboxId)
  const created = payload.created === true
  if (await outboxNeedsDelivery(event, outboxId)) {
    const realtimeResult = await publishConversationEvent(event, {
      kind: 'message.created',
      conversationId: message.conversationId,
      messageId: message.id,
      sequence: message.sequence,
    })
    const deliveryResults = [realtimeResult]
    if (realtimeResult.published) {
      try {
        const recipientIds = await clientPushIds(
          event,
          access.session.organizationId,
          access.clientPerson.clientId,
          access.clientPerson.clientPersonId,
        )
        deliveryResults.push(...await Promise.all(recipientIds.map(clientId => (
          publishDirectMessagePush(
            event,
            clientId,
            `/messages?case=${encodeURIComponent(access.caseId)}`,
          )
        ))))
      }
      catch (error) {
        deliveryResults.push({
          configured: true,
          published: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    await markOutboxPublishResult(
      event,
      outboxId,
      combinePublishResults(deliveryResults),
    )
  }

  const refreshed = await findConversationById(access, access.conversation.id)
  return {
    conversation: refreshed,
    message,
    created,
    replayed: payload.replayed === true,
    realtime: conversationRealtime(event, message.conversationId),
  }
}

export async function updateStaffConversationReceipt(
  event: H3Event,
  access: CaseConversationAccess,
  input: ReceiptUpdateInput,
) {
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('update_staff_case_message_receipt', {
    p_organization_id: access.session.organizationId,
    p_case_id: access.caseId,
    p_client_person_id: access.clientPerson.clientPersonId,
    p_actor_user_id: access.session.userId,
    p_delivered_through_sequence: input.deliveredThroughSequence ?? null,
    p_read_through_sequence: input.readThroughSequence ?? null,
  })
  throwDbError(result.error)

  const payload = asRecord(result.data)
  const changed = payload.changed === true
  if (changed) {
    const sequence = Math.max(
      Number(payload.deliveredThroughSequence ?? input.deliveredThroughSequence ?? 0),
      Number(payload.readThroughSequence ?? input.readThroughSequence ?? 0),
    )
    const publishResult = await publishConversationEvent(event, {
      kind: 'receipt.updated',
      conversationId: access.conversation.id,
      sequence,
    })
    const outboxId = payload.outboxId ?? payload.outbox_id
    await markOutboxPublishResult(
      event,
      outboxId === undefined || outboxId === null ? null : String(outboxId),
      publishResult,
    )
  }

  const receipts = await loadReceipts(access)
  return {
    ...receipts,
    changed,
    realtime: conversationRealtime(event, access.conversation.id),
  }
}

async function durableEventFromOutbox(
  event: H3Event,
  row: Record<string, unknown>,
): Promise<DurableConversationEvent> {
  const payload = asRecord(row.payload)
  const parsed = DurableConversationEventSchema.safeParse(payload)
  if (parsed.success && (
    parsed.data.kind === 'message.created'
    || parsed.data.kind === 'receipt.updated'
  )) return parsed.data

  const eventType = String(row.event_type ?? '')
  const conversationId = String(row.conversation_id ?? '')
  if (eventType === 'receipt.updated') {
    return DurableConversationEventSchema.parse({
      kind: 'receipt.updated',
      conversationId,
      sequence: Math.max(
        Number(payload.deliveredThroughSequence ?? payload.delivered_through_sequence ?? 0),
        Number(payload.readThroughSequence ?? payload.read_through_sequence ?? 0),
      ),
    })
  }
  if (eventType === 'message.created' && row.message_id) {
    const backend = serverDataBackend(event) as any
    const messageResult = await backend
      .from('crm_case_messages')
      .select('id, sequence')
      .eq('conversation_id', conversationId)
      .eq('id', String(row.message_id))
      .maybeSingle()
    throwDbError(messageResult.error)
    if (messageResult.data) {
      return DurableConversationEventSchema.parse({
        kind: 'message.created',
        conversationId,
        messageId: String(messageResult.data.id),
        sequence: Number(messageResult.data.sequence),
      })
    }
  }
  throw new Error(`Unsupported or invalid outbox event: ${eventType}`)
}

async function pushOutboxMessage(
  event: H3Event,
  durableEvent: DurableConversationEvent,
): Promise<void> {
  if (durableEvent.kind !== 'message.created') return
  const backend = serverDataBackend(event) as any
  const [messageResult, conversationResult] = await Promise.all([
    backend
      .from('crm_case_messages')
      .select('sender_kind')
      .eq('conversation_id', durableEvent.conversationId)
      .eq('id', durableEvent.messageId)
      .maybeSingle(),
    backend
      .from('crm_case_conversations')
      .select('organization_id, case_id, client_id, client_person_id')
      .eq('id', durableEvent.conversationId)
      .maybeSingle(),
  ])
  throwDbError(messageResult.error)
  throwDbError(conversationResult.error)
  if (!messageResult.data || !conversationResult.data) return

  const conversation = conversationResult.data as Record<string, unknown>
  const caseId = String(conversation.case_id)
  const organizationId = String(conversation.organization_id)
  if (String(messageResult.data.sender_kind) === 'staff') {
    const ids = await clientPushIds(
      event,
      organizationId,
      String(conversation.client_id),
      String(conversation.client_person_id),
    )
    const results = await Promise.all(ids.map(clientId => publishDirectMessagePush(
      event,
      clientId,
      `/messages?case=${encodeURIComponent(caseId)}`,
    )))
    requireSuccessfulPushes(results)
    return
  }

  const [caseResult, organizationResult] = await Promise.all([
    backend
      .from('crm_cases')
      .select('owner_user_id')
      .eq('organization_id', organizationId)
      .eq('id', caseId)
      .maybeSingle(),
    backend
      .from('organizations')
      .select('slug')
      .eq('id', organizationId)
      .maybeSingle(),
  ])
  throwDbError(caseResult.error)
  throwDbError(organizationResult.error)
  const ownerUserId = caseResult.data?.owner_user_id
    ? String(caseResult.data.owner_user_id)
    : null
  const organizationSlug = organizationResult.data?.slug
    ? String(organizationResult.data.slug)
    : null
  if (ownerUserId && organizationSlug) {
    const pushResult = await publishDirectMessagePush(
      event,
      `staff:${ownerUserId}`,
      `/org/${encodeURIComponent(organizationSlug)}/cases/${caseId}?view=messages`,
    )
    requireSuccessfulPushes([pushResult])
  }
}

export async function drainCaseMessageOutbox(
  event: H3Event,
  workerId: string,
  limit: number,
) {
  const backend = serverDataBackend(event) as any
  const claimResult = await backend.rpc('claim_crm_message_outbox', {
    p_worker_id: workerId,
    p_limit: limit,
  })
  throwDbError(claimResult.error)
  const rows = (claimResult.data ?? []) as Record<string, unknown>[]

  let completed = 0
  let failed = 0
  for (const row of rows) {
    const outboxId = String(row.id)
    try {
      const durableEvent = await durableEventFromOutbox(event, row)
      const publishResult = await publishConversationEvent(event, durableEvent)
      if (publishResult.configured && !publishResult.published) {
        throw new Error(publishResult.error ?? 'Ably realtime is not configured')
      }
      if (publishResult.configured) {
        await pushOutboxMessage(event, durableEvent)
      }

      const completeResult = await backend.rpc('complete_crm_message_outbox', {
        p_id: outboxId,
        p_worker_id: workerId,
        p_succeeded: true,
        p_error: null,
        p_retry_delay: '5 seconds',
      })
      throwDbError(completeResult.error)
      completed += 1
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const completeResult = await backend.rpc('complete_crm_message_outbox', {
        p_id: outboxId,
        p_worker_id: workerId,
        p_succeeded: false,
        p_error: message.slice(0, 1_000),
        p_retry_delay: '5 seconds',
      })
      if (completeResult.error) {
        console.error('[crm-messaging] could not release failed outbox row', {
          outboxId,
          message: completeResult.error.message,
        })
      }
      failed += 1
    }
  }

  return { claimed: rows.length, completed, delivered: completed, failed }
}
