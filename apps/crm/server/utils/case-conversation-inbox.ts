import {
  mapConversationRow,
  mapMessageRow,
  mapReceiptRows,
  type Conversation,
  type Message,
  type Receipt,
} from '@openexpert/messaging'
import type { H3Event } from 'h3'
import type { CrmConversationInboxPayload } from '../../shared/types/case-conversation-inbox.ts'
import {
  buildCrmConversationInboxItem,
  sortCrmConversationInboxItems,
  type CrmConversationInboxCase,
  type CrmConversationInboxPerson,
} from './case-conversation-inbox-summary.ts'
import { requireCrmSession, throwDbError, type CrmSession } from './crm'

const inboxLimit = 100
const latestMessageChunkSize = 20

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

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

function latestMessageFilter(conversations: readonly Conversation[]): string {
  return conversations.map(conversation => (
    `and(conversation_id.eq.${conversation.id},sequence.eq.${conversation.lastMessageSequence})`
  )).join(',')
}

async function loadLatestMessages(
  dataApi: CrmSession['dataApi'],
  organizationId: string,
  conversations: readonly Conversation[],
): Promise<Message[]> {
  const results = await Promise.all(chunks(conversations, latestMessageChunkSize).map(chunk => (
    dataApi
      .from('crm_case_messages')
      .select(messageSelect)
      .eq('organization_id', organizationId)
      .or(latestMessageFilter(chunk))
  )))

  return results.flatMap((result) => {
    throwDbError(result.error)
    return (result.data ?? []).map(mapMessageRow)
  })
}

export async function listCrmConversationInbox(
  event: H3Event,
): Promise<CrmConversationInboxPayload> {
  const session = await requireCrmSession(event)
  const conversationResult = await session.dataApi
    .from('crm_case_conversations')
    .select(conversationSelect)
    .eq('organization_id', session.organizationId)
    .gt('last_message_sequence', 0)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('id')
    .limit(inboxLimit + 1)
  throwDbError(conversationResult.error)

  const allConversations: Conversation[] = (
    (conversationResult.data ?? []) as unknown[]
  ).map(mapConversationRow)
  const hasMore = allConversations.length > inboxLimit
  const conversations = allConversations.slice(0, inboxLimit)
  if (!conversations.length) {
    return {
      conversations: [],
      unreadCount: 0,
      unreadConversationCount: 0,
      hasMore: false,
      generatedAt: new Date().toISOString(),
    }
  }

  const caseIds = [...new Set(conversations.map(conversation => conversation.caseId))]
  const personIds = [...new Set(conversations.map(conversation => conversation.clientPersonId))]
  const conversationIds = conversations.map(conversation => conversation.id)

  const [casesResult, peopleResult, receiptsResult, latestMessages] = await Promise.all([
    session.dataApi
      .from('crm_cases')
      .select('id, title, status_code')
      .eq('organization_id', session.organizationId)
      .in('id', caseIds),
    session.dataApi
      .from('crm_client_people')
      .select('id, client_id, display_name, email')
      .eq('organization_id', session.organizationId)
      .in('id', personIds),
    session.dataApi
      .from('crm_case_conversation_states')
      .select(receiptSelect)
      .eq('organization_id', session.organizationId)
      .eq('participant_kind', 'staff')
      .eq('participant_user_id', session.userId)
      .in('conversation_id', conversationIds),
    loadLatestMessages(session.dataApi, session.organizationId, conversations),
  ])
  throwDbError(casesResult.error)
  throwDbError(peopleResult.error)
  throwDbError(receiptsResult.error)

  const caseById = new Map<string, CrmConversationInboxCase>(
    (casesResult.data ?? []).map((row: Record<string, unknown>) => [
      String(row.id),
      {
        id: String(row.id),
        title: String(row.title ?? ''),
        statusCode: row.status_code ? String(row.status_code) : null,
      },
    ]),
  )
  const personById = new Map<string, CrmConversationInboxPerson>(
    (peopleResult.data ?? []).map((row: Record<string, unknown>) => [
      String(row.id),
      {
        id: String(row.id),
        clientId: String(row.client_id),
        displayName: String(row.display_name ?? ''),
        email: row.email ? String(row.email) : null,
      },
    ]),
  )
  const receiptByConversation = new Map<string, Receipt>(
    mapReceiptRows(receiptsResult.data ?? []).map(receipt => [receipt.conversationId, receipt]),
  )
  const messageByConversation = new Map<string, Message>(
    latestMessages.map(message => [message.conversationId, message]),
  )

  const items = sortCrmConversationInboxItems(conversations.flatMap((conversation) => {
    const item = buildCrmConversationInboxItem({
      conversation,
      caseData: caseById.get(conversation.caseId) ?? null,
      clientPerson: personById.get(conversation.clientPersonId) ?? null,
      lastMessage: messageByConversation.get(conversation.id) ?? null,
      receipt: receiptByConversation.get(conversation.id) ?? null,
      currentUserId: session.userId,
    })
    return item ? [item] : []
  }))

  return {
    conversations: items,
    unreadCount: items.reduce((total, item) => total + item.unreadCount, 0),
    unreadConversationCount: items.filter(item => item.unreadCount > 0).length,
    hasMore,
    generatedAt: new Date().toISOString(),
  }
}
