import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Conversation, Message, Receipt } from '@openexpert/messaging'
import {
  buildPortalConversationSummary,
  isPortalConversationInGrantedScope,
} from '../server/utils/portal-conversation-summary.ts'

const ids = {
  authUser: '0b47c8b7-7d46-45a3-847d-512d88a342cf',
  case: '03410974-6146-49ed-bace-fba3b58031f5',
  client: 'b7aaea82-d507-437d-809a-e75fa560ed5e',
  clientPerson: '2be2fafc-2a6a-45d3-9093-6e63187354b2',
  conversation: '9a56449a-6095-4103-8f76-beed48dca866',
  message: '3dbdc6b0-63c3-4c3c-bd55-32225b7a1ef1',
  organization: 'ee72cc2b-b4e8-4db3-8879-1730358af7ae',
  receipt: '39efc92a-096e-490c-aa97-80ed1da5c7a2',
}

const conversation: Conversation = {
  id: ids.conversation,
  organizationId: ids.organization,
  caseId: ids.case,
  kind: 'direct',
  clientId: ids.client,
  clientPersonId: ids.clientPerson,
  lastMessageSequence: 12,
  lastMessageAt: '2026-08-02T10:01:00.000Z',
  createdAt: '2026-08-02T10:00:00.000Z',
  updatedAt: '2026-08-02T10:01:00.000Z',
}

const receipt: Receipt = {
  id: ids.receipt,
  organizationId: ids.organization,
  conversationId: ids.conversation,
  participantKind: 'client',
  participantUserId: null,
  participantClientPersonId: ids.clientPerson,
  deliveredThroughSequence: 9,
  readThroughSequence: 8,
  deliveredAt: '2026-08-02T10:01:30.000Z',
  readAt: '2026-08-02T10:01:30.000Z',
  updatedAt: '2026-08-02T10:01:30.000Z',
}

const message: Message = {
  id: ids.message,
  organizationId: ids.organization,
  conversationId: ids.conversation,
  sequence: 12,
  clientMessageId: ids.message,
  senderKind: 'staff',
  senderUserId: null,
  senderClientPersonId: null,
  senderAuthUserId: null,
  body: `  Proszę\nuzupełnić ${'dokumenty '.repeat(30)}  `,
  attachments: [],
  replyToMessageId: null,
  replyToMessage: null,
  createdAt: '2026-08-02T10:01:00.000Z',
  editedAt: null,
  deletedAt: null,
}

describe('client portal conversation inbox authorization', () => {
  const scope = {
    grant: {
      organizationId: ids.organization,
      caseId: ids.case,
      clientId: ids.client,
    },
    link: {
      clientPersonId: ids.clientPerson,
    },
  }

  it('accepts only the exact granted tenant, case, client and person tuple', () => {
    assert.equal(isPortalConversationInGrantedScope(conversation, [scope]), true)
    assert.equal(isPortalConversationInGrantedScope({
      ...conversation,
      clientPersonId: '4d073c31-e674-4f80-9140-31f8a1910468',
    }, [scope]), false)
    assert.equal(isPortalConversationInGrantedScope({
      ...conversation,
      organizationId: '9dad735c-bb35-4493-a357-155be6b10b44',
    }, [scope]), false)
    assert.equal(isPortalConversationInGrantedScope({
      ...conversation,
      caseId: '819a7c17-d702-4eec-a6bc-9b10281ae923',
    }, [scope]), false)
    assert.equal(isPortalConversationInGrantedScope({
      ...conversation,
      clientId: '7a86e70b-2241-4106-9b9f-478a58b0fbc6',
    }, [scope]), false)
  })
})

describe('client portal conversation inbox summary', () => {
  it('returns a compact safe preview and client unread high-water mark', () => {
    const summary = buildPortalConversationSummary(
      conversation,
      receipt,
      message,
    )
    assert.equal(summary.caseId, ids.case)
    assert.equal(summary.conversationId, ids.conversation)
    assert.equal(summary.kind, 'direct')
    assert.equal(summary.readThroughSequence, 8)
    assert.equal(summary.unreadCount, 4)
    assert.equal(summary.lastMessageSenderKind, 'staff')
    assert.equal(summary.lastMessageCreatedAt, message.createdAt)
    assert.equal(summary.lastMessagePreview?.includes('\n'), false)
    assert.equal(summary.lastMessagePreview?.length, 160)
    assert.equal(summary.lastMessagePreview?.endsWith('…'), true)
  })

  it('does not invent message data and clamps an invalid receipt cursor', () => {
    const summary = buildPortalConversationSummary(
      conversation,
      { ...receipt, readThroughSequence: 99 },
      null,
    )
    assert.equal(summary.readThroughSequence, 12)
    assert.equal(summary.unreadCount, 0)
    assert.equal(summary.lastMessagePreview, null)
    assert.equal(summary.lastMessageSenderKind, null)
    assert.equal(summary.lastMessageCreatedAt, null)
  })

  it('shows a useful preview for an attachment-only message', () => {
    const summary = buildPortalConversationSummary(
      conversation,
      receipt,
      {
        ...message,
        body: '',
        attachments: [{
          id: '56f4f22d-47db-4b4a-a188-18b9ae0dcf64',
          name: 'zdjecie.webp',
          mimeType: 'image/webp',
          sizeBytes: 2_048,
        }],
      },
    )
    assert.equal(summary.lastMessagePreview, 'Zdjęcie: zdjecie.webp')
  })

  it('distinguishes the current borrower from another borrower in a group', () => {
    const otherPersonId = 'a033bac3-6e9b-4cb8-862c-094464c4251f'
    const groupConversation: Conversation = {
      ...conversation,
      kind: 'group',
      clientId: null,
      clientPersonId: null,
    }
    const otherBorrowerMessage: Message = {
      ...message,
      senderKind: 'client',
      senderClientPersonId: otherPersonId,
    }
    const participants = [{
      clientId: ids.client,
      clientPersonId: ids.clientPerson,
      displayName: 'Anna Nowak',
      role: 'borrower',
    }, {
      clientId: ids.client,
      clientPersonId: otherPersonId,
      displayName: 'Jan Nowak',
      role: 'co_borrower',
    }]

    const otherSummary = buildPortalConversationSummary(
      groupConversation,
      receipt,
      otherBorrowerMessage,
      ids.clientPerson,
      participants,
    )
    const ownSummary = buildPortalConversationSummary(
      groupConversation,
      receipt,
      { ...otherBorrowerMessage, senderClientPersonId: ids.clientPerson },
      ids.clientPerson,
      participants,
    )

    assert.equal(otherSummary.kind, 'group')
    assert.equal(otherSummary.lastMessageIsOwn, false)
    assert.equal(ownSummary.lastMessageIsOwn, true)
    assert.deepEqual(otherSummary.participants, participants)
  })
})
