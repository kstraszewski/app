import assert from 'node:assert/strict'
import test from 'node:test'
import type { Conversation, Message, Receipt } from '@openexpert/messaging'
import type { CrmConversationInboxItem } from '../shared/types/case-conversation-inbox.ts'
import {
  buildCrmConversationInboxItem,
  sortCrmConversationInboxItems,
  truncateConversationPreview,
} from '../server/utils/case-conversation-inbox-summary.ts'

const ids = {
  case: 'case-1',
  client: 'client-1',
  clientPerson: 'person-1',
  conversation: 'conversation-1',
  message: 'message-1',
  organization: 'organization-1',
  receipt: 'receipt-1',
  staff: 'staff-1',
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: ids.conversation,
    organizationId: ids.organization,
    caseId: ids.case,
    kind: 'direct',
    clientId: ids.client,
    clientPersonId: ids.clientPerson,
    lastMessageSequence: 7,
    lastMessageAt: '2026-08-03T10:07:00.000Z',
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:07:00.000Z',
    ...overrides,
  }
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: ids.message,
    organizationId: ids.organization,
    conversationId: ids.conversation,
    sequence: 7,
    clientMessageId: 'client-message-1',
    senderKind: 'staff',
    senderUserId: ids.staff,
    senderClientPersonId: null,
    senderAuthUserId: 'auth-user-1',
    body: '  Dzień dobry\n\tJak możemy pomóc?  ',
    attachments: [],
    replyToMessageId: null,
    replyToMessage: null,
    createdAt: '2026-08-03T10:07:00.000Z',
    editedAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: ids.receipt,
    organizationId: ids.organization,
    conversationId: ids.conversation,
    participantKind: 'staff',
    participantUserId: ids.staff,
    participantClientPersonId: null,
    deliveredThroughSequence: 7,
    readThroughSequence: 3,
    deliveredAt: '2026-08-03T10:07:00.000Z',
    readAt: '2026-08-03T10:03:00.000Z',
    updatedAt: '2026-08-03T10:07:00.000Z',
    ...overrides,
  }
}

function build(overrides: {
  conversation?: Conversation
  caseData?: Parameters<typeof buildCrmConversationInboxItem>[0]['caseData']
  clientPerson?: Parameters<typeof buildCrmConversationInboxItem>[0]['clientPerson']
  lastMessage?: Message | null
  receipt?: Receipt | null
  currentUserId?: string
} = {}) {
  return buildCrmConversationInboxItem({
    conversation: overrides.conversation ?? conversation(),
    caseData: overrides.caseData === undefined
      ? { id: ids.case, title: '  Kredyt hipoteczny  ', statusCode: 'active' }
      : overrides.caseData,
    clientPerson: overrides.clientPerson === undefined
      ? {
          id: ids.clientPerson,
          clientId: ids.client,
          displayName: '  Anna Kowalska  ',
          email: '  anna@example.com  ',
        }
      : overrides.clientPerson,
    lastMessage: overrides.lastMessage === undefined ? message() : overrides.lastMessage,
    receipt: overrides.receipt === undefined ? receipt() : overrides.receipt,
    currentUserId: overrides.currentUserId ?? ids.staff,
  })
}

test('maps a conversation summary and normalizes display values', () => {
  assert.deepEqual(build(), {
    conversationId: ids.conversation,
    kind: 'direct',
    caseId: ids.case,
    caseTitle: 'Kredyt hipoteczny',
    caseStatusCode: 'active',
    clientId: ids.client,
    clientPersonId: ids.clientPerson,
    clientName: 'Anna Kowalska',
    clientEmail: 'anna@example.com',
    participants: [],
    lastMessageSequence: 7,
    lastMessageAt: '2026-08-03T10:07:00.000Z',
    lastMessagePreview: 'Dzień dobry Jak możemy pomóc?',
    lastMessageSenderKind: 'staff',
    lastMessageSenderName: null,
    lastMessageSentByCurrentUser: true,
    readThroughSequence: 3,
    unreadCount: 4,
  })
})

test('maps a group conversation with participant metadata and client sender label', () => {
  const item = buildCrmConversationInboxItem({
    conversation: conversation({
      kind: 'group',
      clientId: null,
      clientPersonId: null,
    }),
    caseData: { id: ids.case, title: 'Kredyt wspólny', statusCode: 'active' },
    clientPerson: null,
    participants: [
      { id: ids.clientPerson, clientId: ids.client, displayName: 'Anna Kowalska', email: 'anna@example.com' },
      { id: 'person-2', clientId: ids.client, displayName: 'Jan Kowalski', email: 'jan@example.com' },
    ],
    lastMessage: message({
      senderKind: 'client',
      senderUserId: null,
      senderClientPersonId: ids.clientPerson,
      senderAuthUserId: 'auth-user-1',
    }),
    receipt: receipt(),
    currentUserId: ids.staff,
  })

  assert.equal(item?.clientName, 'Wszyscy kredytobiorcy (2)')
  assert.equal(item?.clientPersonId, null)
  assert.equal(item?.lastMessageSenderName, 'Anna Kowalska')
  assert.deepEqual(item?.participants.map(participant => participant.displayName), [
    'Anna Kowalska',
    'Jan Kowalski',
  ])
})

test('compacts whitespace and truncates a long preview without exceeding the limit', () => {
  assert.equal(
    truncateConversationPreview('  Pierwsza\n\n  druga\tczęść  '),
    'Pierwsza druga część',
  )

  const preview = truncateConversationPreview(`  ${'x'.repeat(200)}  `)
  assert.equal(preview, `${'x'.repeat(157)}…`)
  assert.ok(preview.length <= 160)
})

test('uses an attachment fallback for a message without text', () => {
  const item = build({
    lastMessage: message({
      body: '',
      attachments: [{
        id: 'attachment-1',
        name: 'umowa.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1_024,
      }],
    }),
  })

  assert.equal(item?.lastMessagePreview, 'Załącznik: umowa.pdf')
})

test('clamps a receipt cursor to the conversation high-water mark', () => {
  const item = build({
    receipt: receipt({ readThroughSequence: 99 }),
  })

  assert.equal(item?.readThroughSequence, 7)
  assert.equal(item?.unreadCount, 0)
})

test('does not expose metadata from mismatched related records', () => {
  const item = build({
    caseData: {
      id: 'different-case',
      title: 'Poufna sprawa',
      statusCode: 'secret',
    },
    clientPerson: {
      id: ids.clientPerson,
      clientId: 'different-client',
      displayName: 'Poufny klient',
      email: 'secret@example.com',
    },
    lastMessage: message({
      organizationId: 'different-organization',
      body: 'Poufna wiadomość',
    }),
    receipt: receipt({ participantUserId: 'different-staff-user' }),
  })

  assert.equal(item?.caseTitle, 'Sprawa bez nazwy')
  assert.equal(item?.caseStatusCode, null)
  assert.equal(item?.clientName, 'Klient')
  assert.equal(item?.clientEmail, null)
  assert.equal(item?.lastMessagePreview, null)
  assert.equal(item?.lastMessageSenderKind, null)
  assert.equal(item?.lastMessageSentByCurrentUser, false)
  assert.equal(item?.readThroughSequence, 0)
  assert.equal(item?.unreadCount, 7)
  assert.doesNotMatch(JSON.stringify(item), /Poufna|secret@example\.com|secret/)
})

test('omits a conversation that has no messages', () => {
  assert.equal(build({
    conversation: conversation({
      lastMessageSequence: 0,
      lastMessageAt: null,
    }),
    lastMessage: null,
    receipt: null,
  }), null)
})

test('sorts summaries newest first with a deterministic conversation-id tie-break', () => {
  const base = build()
  assert.ok(base)

  const older: CrmConversationInboxItem = {
    ...base,
    conversationId: 'conversation-z',
    lastMessageAt: '2026-08-03T09:00:00.000Z',
  }
  const tiedSecond: CrmConversationInboxItem = {
    ...base,
    conversationId: 'conversation-b',
  }
  const tiedFirst: CrmConversationInboxItem = {
    ...base,
    conversationId: 'conversation-a',
  }
  const input = [older, tiedSecond, tiedFirst]

  const sorted = sortCrmConversationInboxItems(input)

  assert.deepEqual(
    sorted.map(item => item.conversationId),
    ['conversation-a', 'conversation-b', 'conversation-z'],
  )
  assert.deepEqual(
    input.map(item => item.conversationId),
    ['conversation-z', 'conversation-b', 'conversation-a'],
  )
})
