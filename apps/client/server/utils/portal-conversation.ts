import {
  mapConversationRow,
  mapMessageRow,
  mapReceiptRows,
  type Conversation,
  type ConversationKind,
  type ConversationSnapshot,
  type Message,
  type Receipt,
  type ReceiptUpdateInput,
  type SendMessageInput,
} from '@openexpert/messaging'
import { createError, type H3Event } from 'h3'
import { serverDataBackend } from './data-api'
import {
  asRecord,
  loadClientPortalSession,
  requirePortalCaseAccess,
  throwPortalDbError,
  type ClientPortalSession,
  type PortalCaseAccess,
} from './portal-auth'
import { loadGrantedScopes, type GrantedScope } from './portal-cases'
import {
  buildPortalConversationSummary,
  filterPortalConversationsInGrantedScopes,
  type PortalConversationSummary,
} from './portal-conversation-summary'
import {
  chunkPortalQueryValues,
  runPortalQueryChunks,
} from './portal-query'
import {
  conversationRealtime,
  publishConversationEvent,
  publishDirectMessagePush,
  type MessagingPublishResult,
} from './messaging-ably'
import { nudgeNotificationOutbox } from './notification-outbox'

const conversationSelect = [
  'id',
  'organization_id',
  'case_id',
  'kind',
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
  'reply_to_message_id',
  'created_at',
  'attachments:crm_case_message_attachments(id,position,file_name,content_type,size_bytes)',
].join(',')

const replyMessageSelect = [
  'id',
  'sequence',
  'sender_kind',
  'sender_client_person_id',
  'body',
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

export interface ConversationPageRequest {
  afterSequence?: number
  beforeSequence?: number
  limit: number
}

export interface PortalConversationContext {
  access: PortalCaseAccess
  conversation: Conversation
  participants: PortalConversationParticipant[]
}

export interface PortalConversationParticipant {
  clientId: string
  clientPersonId: string
  displayName: string
  role: string
}

export function parsePortalConversationThread(input: unknown): ConversationKind {
  const value = Array.isArray(input) ? input[0] : input
  if (value === undefined || value === null || value === '' || value === 'direct') {
    return 'direct'
  }
  if (value === 'group') return 'group'
  throw createError({ statusCode: 400, statusMessage: 'thread must be direct or group' })
}

interface ConversationScopeQuery {
  organizationId: string
  clientId: string
  clientPersonId: string
  caseIds: string[]
}

interface ScopedPortalConversation {
  conversation: Conversation
  currentClientPersonId: string
  participants: PortalConversationParticipant[]
}

async function ensurePortalGroupConversation(
  event: H3Event,
  organizationId: string,
  caseId: string,
): Promise<void> {
  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('ensure_case_group_conversation', {
    p_organization_id: organizationId,
    p_case_id: caseId,
  })
  throwPortalDbError(result.error, 'could not initialize group conversation')
}

async function ensurePortalGroupConversations(
  event: H3Event,
  scopes: GrantedScope[],
): Promise<void> {
  const cases = new Map<string, { organizationId: string, caseId: string }>()
  for (const scope of scopes) {
    const item = {
      organizationId: scope.grant.organizationId,
      caseId: scope.grant.caseId,
    }
    cases.set(JSON.stringify([item.organizationId, item.caseId]), item)
  }

  await Promise.all([...cases.values()].map(item => ensurePortalGroupConversation(
    event,
    item.organizationId,
    item.caseId,
  )))
}

function conversationScopeQueries(
  scopes: GrantedScope[],
): ConversationScopeQuery[] {
  const grouped = new Map<string, ConversationScopeQuery>()
  for (const scope of scopes) {
    const key = JSON.stringify([
      scope.grant.organizationId,
      scope.grant.clientId,
      scope.link.clientPersonId,
    ])
    const query = grouped.get(key) ?? {
      organizationId: scope.grant.organizationId,
      clientId: scope.grant.clientId,
      clientPersonId: scope.link.clientPersonId,
      caseIds: [],
    }
    query.caseIds.push(scope.grant.caseId)
    grouped.set(key, query)
  }

  return [...grouped.values()].flatMap(query => (
    chunkPortalQueryValues([...new Set(query.caseIds)]).map(caseIds => ({
      ...query,
      caseIds,
    }))
  ))
}

async function loadExistingPortalConversations(
  event: H3Event,
  scopes: GrantedScope[],
): Promise<ScopedPortalConversation[]> {
  const backend = serverDataBackend(event) as any
  const queries = conversationScopeQueries(scopes)
  const directRowGroups = await runPortalQueryChunks(
    queries.map(query => [query]),
    async ([query]) => {
      if (!query) return []
      const result = await backend
        .from('crm_case_conversations')
        .select(conversationSelect)
        .eq('organization_id', query.organizationId)
        .eq('kind', 'direct')
        .eq('client_id', query.clientId)
        .eq('client_person_id', query.clientPersonId)
        .in('case_id', query.caseIds)
        .limit(query.caseIds.length)
      throwPortalDbError(result.error, 'could not list client conversations')
      return (result.data ?? []) as unknown[]
    },
  )
  const directConversations = filterPortalConversationsInGrantedScopes(
    directRowGroups.flat().map(mapConversationRow),
    scopes,
  )

  const membershipGroups = await runPortalQueryChunks(
    queries.map(query => [query]),
    async ([query]) => {
      if (!query) return []
      const result = await backend
        .from('crm_case_conversation_participants')
        .select('organization_id,case_id,conversation_id,client_id,client_person_id')
        .eq('organization_id', query.organizationId)
        .in('case_id', query.caseIds)
        .eq('client_id', query.clientId)
        .eq('client_person_id', query.clientPersonId)
        .is('removed_at', null)
        .limit(query.caseIds.length)
      throwPortalDbError(result.error, 'could not list group conversation memberships')
      return (result.data ?? []) as Record<string, unknown>[]
    },
  )
  const membershipRows = membershipGroups.flat()
  const groupConversationIds = [...new Set(membershipRows.map(row => (
    String(row.conversation_id)
  )))]
  const groupRows = groupConversationIds.length
    ? await runPortalQueryChunks(
        chunkPortalQueryValues(groupConversationIds),
        async (ids) => {
          const result = await backend
            .from('crm_case_conversations')
            .select(conversationSelect)
            .in('id', ids)
            .eq('kind', 'group')
          throwPortalDbError(result.error, 'could not list group conversations')
          return (result.data ?? []) as unknown[]
        },
      )
    : []
  const groupsById = new Map(groupRows.flat().map((row) => {
    const conversation = mapConversationRow(row)
    return [conversation.id, conversation] as const
  }))
  const scopeByTuple = new Map(scopes.map(scope => [
    JSON.stringify([
      scope.grant.organizationId,
      scope.grant.caseId,
      scope.grant.clientId,
      scope.link.clientPersonId,
    ]),
    scope,
  ]))
  const groupScopes = new Map<string, { conversation: Conversation, currentClientPersonId: string }>()
  for (const membership of membershipRows) {
    const conversation = groupsById.get(String(membership.conversation_id))
    if (!conversation) continue
    const scope = scopeByTuple.get(JSON.stringify([
      String(membership.organization_id),
      String(membership.case_id),
      String(membership.client_id),
      String(membership.client_person_id),
    ]))
    if (
      !scope
      || conversation.organizationId !== String(membership.organization_id)
      || conversation.caseId !== String(membership.case_id)
    ) continue
    groupScopes.set(conversation.id, {
      conversation,
      currentClientPersonId: scope.link.clientPersonId,
    })
  }

  const directEntries = await Promise.all(directConversations.map(async conversation => ({
    conversation,
    currentClientPersonId: conversation.clientPersonId!,
    participants: await loadActiveConversationParticipants(event, conversation),
  })))
  const groupEntries = await Promise.all([...groupScopes.values()].map(async entry => ({
    ...entry,
    participants: await loadActiveConversationParticipants(event, entry.conversation),
  })))
  return [...directEntries, ...groupEntries]
}

async function loadActiveConversationParticipants(
  event: H3Event,
  conversation: Conversation,
): Promise<PortalConversationParticipant[]> {
  const backend = serverDataBackend(event) as any
  let membershipRows: Record<string, unknown>[] = []
  if (conversation.kind === 'direct') {
    membershipRows = conversation.clientId && conversation.clientPersonId
      ? [{
          client_id: conversation.clientId,
          client_person_id: conversation.clientPersonId,
        }]
      : []
  }
  else {
    const participantResult = await backend
      .from('crm_case_conversation_participants')
      .select('client_id,client_person_id,joined_at')
      .eq('organization_id', conversation.organizationId)
      .eq('case_id', conversation.caseId)
      .eq('conversation_id', conversation.id)
      .is('removed_at', null)
      .order('joined_at')
    throwPortalDbError(
      participantResult.error,
      'could not load group conversation participants',
    )
    membershipRows = (participantResult.data ?? []) as Record<string, unknown>[]
  }
  const personIds = [...new Set(membershipRows.map(row => String(row.client_person_id)))]
  if (!personIds.length) return []

  const [peopleResult, grantsResult] = await Promise.all([
    backend
      .from('crm_client_people')
      .select('id,client_id,display_name,role')
      .eq('organization_id', conversation.organizationId)
      .in('id', personIds),
    backend
      .from('client_portal_case_grants')
      .select('client_id,client_person_id')
      .eq('organization_id', conversation.organizationId)
      .eq('case_id', conversation.caseId)
      .in('client_person_id', personIds)
      .eq('portal_enabled', true)
      .is('revoked_at', null),
  ])
  throwPortalDbError(peopleResult.error, 'could not load conversation participants')
  throwPortalDbError(grantsResult.error, 'could not validate conversation participants')
  const activeGrantKeys = new Set((grantsResult.data ?? []).map((row: Record<string, unknown>) => (
    JSON.stringify([String(row.client_id), String(row.client_person_id)])
  )))
  const personByKey = new Map<string, Record<string, unknown>>((peopleResult.data ?? []).map((row: Record<string, unknown>) => [
    JSON.stringify([String(row.client_id), String(row.id)]),
    row,
  ]))
  return membershipRows.flatMap((membership: Record<string, unknown>) => {
    const clientId = String(membership.client_id)
    const clientPersonId = String(membership.client_person_id)
    const key = JSON.stringify([clientId, clientPersonId])
    const person = personByKey.get(key)
    if (!person || !activeGrantKeys.has(key)) return []
    return [{
      clientId,
      clientPersonId,
      displayName: String(person.display_name ?? ''),
      role: String(person.role ?? ''),
    }]
  })
}

async function loadPortalConversationLastMessages(
  event: H3Event,
  conversations: Conversation[],
): Promise<Map<string, Message>> {
  const backend = serverDataBackend(event) as any
  const conversationsWithMessages = conversations.filter(
    conversation => conversation.lastMessageSequence > 0,
  )
  const rowsByChunk = await runPortalQueryChunks(
    chunkPortalQueryValues(conversationsWithMessages, 20),
    async (chunk) => {
      const conversationById = new Map(chunk.map(conversation => [
        conversation.id,
        conversation,
      ]))
      const sequences = [...new Set(chunk.map(
        conversation => conversation.lastMessageSequence,
      ))]
      const result = await backend
        .from('crm_case_messages')
        .select(messageSelect)
        .in('organization_id', [...new Set(chunk.map(
          conversation => conversation.organizationId,
        ))])
        .in('conversation_id', [...conversationById.keys()])
        .in('sequence', sequences)
        .limit(chunk.length * sequences.length)
      throwPortalDbError(result.error, 'could not load conversation previews')
      return (result.data ?? [])
        .map(mapMessageRow)
        .filter((message: Message) => {
          const conversation = conversationById.get(message.conversationId)
          return Boolean(
            conversation
            && message.organizationId === conversation.organizationId
            && message.sequence === conversation.lastMessageSequence,
          )
        })
    },
  )

  return new Map(rowsByChunk.flat().map(message => [
    message.conversationId,
    message,
  ]))
}

async function loadPortalConversationReceipts(
  event: H3Event,
  entries: ScopedPortalConversation[],
): Promise<Map<string, Receipt>> {
  const backend = serverDataBackend(event) as any
  const entryById = new Map(entries.map(entry => [
    entry.conversation.id,
    entry,
  ]))
  const rowsByChunk = await runPortalQueryChunks(
    chunkPortalQueryValues(entries, 40),
    async (chunk) => {
      const personIds = [...new Set(chunk.map(entry => entry.currentClientPersonId))]
      const result = await backend
        .from('crm_case_conversation_states')
        .select(receiptSelect)
        .in('conversation_id', chunk.map(entry => entry.conversation.id))
        .eq('participant_kind', 'client')
        .in('participant_client_person_id', personIds)
        .limit(chunk.length * personIds.length)
      throwPortalDbError(result.error, 'could not load conversation read state')
      return mapReceiptRows(result.data ?? []).filter((receipt) => {
        const entry = entryById.get(receipt.conversationId)
        return Boolean(
          entry
          && receipt.organizationId === entry.conversation.organizationId
          && receipt.participantClientPersonId === entry.currentClientPersonId,
        )
      })
    },
  )

  return new Map(rowsByChunk.flat().map(receipt => [
    receipt.conversationId,
    receipt,
  ]))
}

export async function listPortalConversationSummaries(
  event: H3Event,
  providedSession?: ClientPortalSession,
): Promise<PortalConversationSummary[]> {
  const session = providedSession ?? await loadClientPortalSession(event)
  const scopes = await loadGrantedScopes(event, session)
  if (!scopes.length) return []

  await ensurePortalGroupConversations(event, scopes)
  const entries = await loadExistingPortalConversations(event, scopes)
  if (!entries.length) return []
  const conversations = entries.map(entry => entry.conversation)

  const [lastMessageByConversation, receiptByConversation] = await Promise.all([
    loadPortalConversationLastMessages(event, conversations),
    loadPortalConversationReceipts(event, entries),
  ])

  return entries
    .filter(entry => entry.conversation.kind === 'direct' || entry.participants.length >= 2)
    .map(entry => buildPortalConversationSummary(
      entry.conversation,
      receiptByConversation.get(entry.conversation.id) ?? null,
      lastMessageByConversation.get(entry.conversation.id) ?? null,
      entry.currentClientPersonId,
      entry.participants,
    ))
    .sort((left, right) => {
      const leftTime = left.lastMessageAt ? Date.parse(left.lastMessageAt) : -1
      const rightTime = right.lastMessageAt ? Date.parse(right.lastMessageAt) : -1
      return rightTime - leftTime
        || left.caseId.localeCompare(right.caseId)
        || left.conversationId.localeCompare(right.conversationId)
    })
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

async function findConversation(
  event: H3Event,
  access: PortalCaseAccess,
  kind: ConversationKind,
): Promise<Conversation | null> {
  const backend = serverDataBackend(event) as any
  let request = backend
    .from('crm_case_conversations')
    .select(conversationSelect)
    .eq('organization_id', access.grant.organizationId)
    .eq('case_id', access.grant.caseId)
    .eq('kind', kind)
  if (kind === 'direct') {
    request = request
      .eq('client_id', access.grant.clientId)
      .eq('client_person_id', access.link.clientPersonId)
  }
  const result = await request.maybeSingle()
  throwPortalDbError(result.error, 'could not load case conversation')
  if (!result.data) return null

  const conversation = mapConversationRow(result.data)
  if (kind === 'direct') return conversation

  const participantResult = await backend
    .from('crm_case_conversation_participants')
    .select('conversation_id')
    .eq('organization_id', access.grant.organizationId)
    .eq('case_id', access.grant.caseId)
    .eq('conversation_id', conversation.id)
    .eq('client_id', access.grant.clientId)
    .eq('client_person_id', access.link.clientPersonId)
    .is('removed_at', null)
    .maybeSingle()
  throwPortalDbError(
    participantResult.error,
    'could not validate group conversation membership',
  )
  return participantResult.data ? conversation : null
}

async function ensureConversation(
  event: H3Event,
  access: PortalCaseAccess,
): Promise<Conversation> {
  const existing = await findConversation(event, access, 'direct')
  if (existing) return existing

  const backend = serverDataBackend(event) as any
  const createResult = await backend
    .from('crm_case_conversations')
    .upsert({
      organization_id: access.grant.organizationId,
      case_id: access.grant.caseId,
      kind: 'direct',
      client_id: access.grant.clientId,
      client_person_id: access.link.clientPersonId,
    }, {
      ignoreDuplicates: true,
      onConflict: 'organization_id,case_id,client_person_id',
    })
  throwPortalDbError(createResult.error, 'could not initialize case conversation')

  const created = await findConversation(event, access, 'direct')
  if (!created) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Client portal conversation is temporarily unavailable',
    })
  }
  return created
}

export async function requirePortalConversation(
  event: H3Event,
  caseId: string,
  kind: ConversationKind = 'direct',
): Promise<PortalConversationContext> {
  const access = await requirePortalCaseAccess(event, caseId)
  if (kind === 'group') {
    await ensurePortalGroupConversation(
      event,
      access.grant.organizationId,
      access.grant.caseId,
    )
  }
  const conversation = kind === 'direct'
    ? await ensureConversation(event, access)
    : await findConversation(event, access, 'group')
  if (!conversation) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }
  const participants = await loadActiveConversationParticipants(event, conversation)
  if (kind === 'group' && participants.length < 2) {
    throw createError({ statusCode: 404, statusMessage: 'Conversation not found' })
  }
  return { access, conversation, participants }
}

async function loadMessages(
  event: H3Event,
  conversation: Conversation,
  page: ConversationPageRequest,
): Promise<{ messages: Message[], hasMore: boolean, lastSequence: number }> {
  const backend = serverDataBackend(event) as any
  let request = backend
    .from('crm_case_messages')
    .select(messageSelect)
    .eq('organization_id', conversation.organizationId)
    .eq('conversation_id', conversation.id)

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
  throwPortalDbError(result.error, 'could not load case messages')

  const hasMore = (result.data ?? []).length > page.limit
  const selectedRows = await hydrateMessageReplies(
    backend,
    conversation,
    (result.data ?? []).slice(0, page.limit),
  )
  const messages = selectedRows.map(mapMessageRow)
  if (!ascending) messages.reverse()

  return {
    messages,
    hasMore,
    lastSequence: ascending
      ? messages.at(-1)?.sequence ?? page.afterSequence ?? 0
      : conversation.lastMessageSequence,
  }
}

async function hydrateMessageReplies(
  backend: any,
  conversation: Conversation,
  inputRows: unknown[],
): Promise<Record<string, unknown>[]> {
  const rows = inputRows.map(asRecord)
  const replyIds = [...new Set(rows.flatMap((row) => {
    const replyId = row.reply_to_message_id
    return typeof replyId === 'string' ? [replyId] : []
  }))]
  if (!replyIds.length) return rows

  const replyRowGroups = await runPortalQueryChunks(
    chunkPortalQueryValues(replyIds),
    async (replyIdsChunk) => {
      const replyResult = await backend
        .from('crm_case_messages')
        .select(replyMessageSelect)
        .eq('organization_id', conversation.organizationId)
        .eq('conversation_id', conversation.id)
        .in('id', replyIdsChunk)
      throwPortalDbError(replyResult.error, 'could not load replied-to messages')
      return replyResult.data ?? []
    },
  )

  const repliesById = new Map(
    replyRowGroups.flat().map((input: unknown) => {
      const reply = asRecord(input)
      return [String(reply.id), reply] as const
    }),
  )
  return rows.map((row) => {
    const replyId = typeof row.reply_to_message_id === 'string'
      ? row.reply_to_message_id
      : null
    return {
      ...row,
      reply_to_message: replyId ? repliesById.get(replyId) ?? null : null,
    }
  })
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
  event: H3Event,
  context: PortalConversationContext,
): Promise<{ receipt: Receipt | null, peerReceipt: Receipt | null }> {
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('crm_case_conversation_states')
    .select(receiptSelect)
    .eq('organization_id', context.access.grant.organizationId)
    .eq('conversation_id', context.conversation.id)
  throwPortalDbError(result.error, 'could not load case message receipts')

  const receipts = mapReceiptRows(result.data ?? [])
  const receipt = receipts.find(candidate => (
    candidate.participantKind === 'client'
    && candidate.participantClientPersonId === context.access.link.clientPersonId
  )) ?? null
  const peerReceipt = receipts
    .filter(candidate => candidate.participantKind === 'staff')
    .reduce<Receipt | null>((highest, candidate) => (
      highest ? higherReceipt(highest, candidate) : candidate
    ), null)

  return { receipt, peerReceipt }
}

export async function loadPortalConversationSnapshot(
  event: H3Event,
  context: PortalConversationContext,
  page: ConversationPageRequest,
): Promise<ConversationSnapshot & {
  currentClientPersonId: string
  participants: PortalConversationParticipant[]
  realtime: ReturnType<typeof conversationRealtime>
}> {
  const [messagePage, receipts] = await Promise.all([
    loadMessages(event, context.conversation, page),
    loadReceipts(event, context),
  ])

  return {
    conversation: context.conversation,
    currentClientPersonId: context.access.link.clientPersonId,
    participants: context.participants,
    messages: messagePage.messages,
    receipt: receipts.receipt,
    peerReceipt: receipts.peerReceipt,
    pageInfo: {
      lastSequence: messagePage.lastSequence,
      hasMore: messagePage.hasMore,
    },
    realtime: conversationRealtime(event, context.conversation.id),
  }
}

function rpcMessage(input: unknown): Message {
  const message = asRecord(input)
  const rawReply = message.replyToMessage ?? message.reply_to_message
  const reply = rawReply ? asRecord(rawReply) : null
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
    reply_to_message_id:
      message.replyToMessageId ?? message.reply_to_message_id ?? null,
    reply_to_message: reply
      ? {
          id: reply.id,
          sequence: reply.sequence,
          sender_kind: reply.senderKind ?? reply.sender_kind,
          sender_client_person_id:
            reply.senderClientPersonId ?? reply.sender_client_person_id ?? null,
          body: reply.body,
          attachments: reply.attachments
            ?? reply.crm_case_message_attachments
            ?? [],
        }
      : null,
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
    console.warn('[client-messaging] could not update outbox after publish', {
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
    console.warn('[client-messaging] could not inspect outbox status', {
      outboxId,
      message: result.error.message,
    })
    return true
  }
  const status = result.data?.status ? String(result.data.status) : ''
  return status !== 'completed' && status !== 'processing'
}

async function enforcePortalMessageRateLimit(
  event: H3Event,
  context: PortalConversationContext,
  clientMessageId: string,
): Promise<void> {
  const backend = serverDataBackend(event) as any
  const replayResult = await backend
    .from('crm_case_messages')
    .select('id')
    .eq('organization_id', context.access.grant.organizationId)
    .eq('conversation_id', context.conversation.id)
    .eq('client_message_id', clientMessageId)
    .eq('sender_auth_user_id', context.access.session.identity.userId)
    .maybeSingle()
  throwPortalDbError(replayResult.error, 'could not verify message idempotency')
  if (replayResult.data) return

  const since = new Date(Date.now() - 60_000).toISOString()
  const recentResult = await backend
    .from('crm_case_messages')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', context.access.grant.organizationId)
    .eq('sender_auth_user_id', context.access.session.identity.userId)
    .gte('created_at', since)
  throwPortalDbError(recentResult.error, 'could not check message rate limit')
  if ((recentResult.count ?? 0) >= 5) {
    throw createError({ statusCode: 429, statusMessage: 'Too many messages' })
  }
}

async function portalExpertPushTarget(
  event: H3Event,
  context: PortalConversationContext,
): Promise<{ clientId: string | null, path: string }> {
  const backend = serverDataBackend(event) as any
  const [caseResult, organizationResult] = await Promise.all([
    backend
      .from('crm_cases')
      .select('owner_user_id')
      .eq('organization_id', context.access.grant.organizationId)
      .eq('id', context.access.grant.caseId)
      .maybeSingle(),
    backend
      .from('organizations')
      .select('slug')
      .eq('id', context.access.grant.organizationId)
      .maybeSingle(),
  ])
  if (caseResult.error || organizationResult.error) {
    throw new Error('Could not resolve expert push target')
  }

  const ownerUserId = caseResult.data?.owner_user_id
    ? String(caseResult.data.owner_user_id)
    : null
  const slug = organizationResult.data?.slug
    ? String(organizationResult.data.slug)
    : ''
  if (ownerUserId && !slug) throw new Error('Could not resolve expert push path')
  return {
    clientId: ownerUserId ? `staff:${ownerUserId}` : null,
    path: slug
      ? `/org/${encodeURIComponent(slug)}/cases/${context.access.grant.caseId}?view=messages${
          context.conversation.kind === 'group'
            ? `&conversation=${encodeURIComponent(context.conversation.id)}`
            : ''
        }`
      : '/',
  }
}

async function portalGroupPeerPushIds(
  event: H3Event,
  context: PortalConversationContext,
): Promise<string[]> {
  if (context.conversation.kind !== 'group') return []
  const peerParticipants = context.participants.filter(participant => (
    participant.clientPersonId !== context.access.link.clientPersonId
  ))
  if (!peerParticipants.length) return []

  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('client_account_links')
    .select('auth_user_id,client_id,client_person_id')
    .eq('organization_id', context.access.grant.organizationId)
    .in('client_person_id', peerParticipants.map(participant => participant.clientPersonId))
    .is('revoked_at', null)
  if (result.error) throw new Error('Could not resolve group participant push targets')

  const allowed = new Set(peerParticipants.map(participant => JSON.stringify([
    participant.clientId,
    participant.clientPersonId,
  ])))
  return [...new Set<string>(((result.data ?? []) as Record<string, unknown>[]).flatMap(row => {
    const authUserId = String(row.auth_user_id ?? '')
    const key = JSON.stringify([String(row.client_id), String(row.client_person_id)])
    if (
      !authUserId
      || authUserId === context.access.session.identity.userId
      || !allowed.has(key)
    ) return []
    return [`client:${authUserId}`]
  }))]
}

export async function sendPortalConversationMessage(
  event: H3Event,
  context: PortalConversationContext,
  input: SendMessageInput,
) {
  await enforcePortalMessageRateLimit(event, context, input.clientMessageId)
  const backend = serverDataBackend(event) as any
  const commonInput = {
    p_organization_id: context.access.grant.organizationId,
    p_case_id: context.access.grant.caseId,
    p_client_person_id: context.access.link.clientPersonId,
    p_auth_user_id: context.access.session.identity.userId,
    p_client_message_id: input.clientMessageId,
    p_reply_to_message_id: input.replyToMessageId ?? null,
    p_body: input.body,
    p_attachment_ids: input.attachmentIds,
  }
  const result = context.conversation.kind === 'group'
    ? await backend.rpc('send_client_case_group_message_v1', {
        ...commonInput,
        p_conversation_id: context.conversation.id,
      })
    : await backend.rpc('send_client_case_message_v3', commonInput)
  if (
    result.error
    && String(result.error.message ?? '').includes('case_message_reply_')
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'The message being replied to is no longer available.',
      data: { code: 'case_message_reply_unavailable' },
    })
  }
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
  throwPortalDbError(result.error, 'could not send case message')

  const payload = asRecord(result.data)
  const message = rpcMessage(payload.message)
  const rawOutboxId = payload.outboxId ?? payload.outbox_id
  const outboxId = rawOutboxId === undefined || rawOutboxId === null
    ? null
    : String(rawOutboxId)
  const created = payload.created === true
  const notificationNudge = created
    ? nudgeNotificationOutbox(event)
    : Promise.resolve()
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
        const target = await portalExpertPushTarget(event, context)
        deliveryResults.push(await publishDirectMessagePush(
          event,
          target.clientId,
          target.path,
        ))
        const peerPushIds = await portalGroupPeerPushIds(event, context)
        deliveryResults.push(...await Promise.all(peerPushIds.map(clientId => (
          publishDirectMessagePush(
            event,
            clientId,
            `/messages?case=${encodeURIComponent(context.access.grant.caseId)}&thread=group`,
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

  await notificationNudge

  const refreshedConversation = await findConversation(
    event,
    context.access,
    context.conversation.kind,
  )
  return {
    conversation: refreshedConversation ?? context.conversation,
    message,
    created,
    replayed: payload.replayed === true,
    realtime: conversationRealtime(event, message.conversationId),
  }
}

export async function updatePortalConversationReceipt(
  event: H3Event,
  context: PortalConversationContext,
  input: ReceiptUpdateInput,
) {
  const backend = serverDataBackend(event) as any
  const commonInput = {
    p_organization_id: context.access.grant.organizationId,
    p_case_id: context.access.grant.caseId,
    p_client_person_id: context.access.link.clientPersonId,
    p_auth_user_id: context.access.session.identity.userId,
    p_delivered_through_sequence: input.deliveredThroughSequence ?? null,
    p_read_through_sequence: input.readThroughSequence ?? null,
  }
  const result = context.conversation.kind === 'group'
    ? await backend.rpc('update_client_case_group_message_receipt', {
        ...commonInput,
        p_conversation_id: context.conversation.id,
      })
    : await backend.rpc('update_client_case_message_receipt', commonInput)
  throwPortalDbError(result.error, 'could not update case message receipt')

  const payload = asRecord(result.data)
  const changed = payload.changed === true
  if (changed) {
    const sequence = Math.max(
      Number(payload.deliveredThroughSequence ?? input.deliveredThroughSequence ?? 0),
      Number(payload.readThroughSequence ?? input.readThroughSequence ?? 0),
    )
    const publishResult = await publishConversationEvent(event, {
      kind: 'receipt.updated',
      conversationId: context.conversation.id,
      sequence,
    })
    const outboxId = payload.outboxId ?? payload.outbox_id
    await markOutboxPublishResult(
      event,
      outboxId === undefined || outboxId === null ? null : String(outboxId),
      publishResult,
    )
  }

  const receipts = await loadReceipts(event, context)
  return {
    ...receipts,
    changed,
    realtime: conversationRealtime(event, context.conversation.id),
  }
}
