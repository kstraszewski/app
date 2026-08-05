import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMessageAttachmentStoragePath,
  buildMessagePreview,
  conversationChannelNames,
  DurableConversationEventSchema,
  mapConversationRow,
  mapMessageRow,
  MESSAGE_ATTACHMENT_ACCEPT,
  MESSAGE_ATTACHMENT_MAX_FILE_BYTES,
  MESSAGE_ATTACHMENT_MAX_FILES,
  MESSAGE_ATTACHMENT_MAX_TOTAL_BYTES,
  mapReceiptRow,
  ReceiptUpdateInputSchema,
  ReserveMessageAttachmentInputSchema,
  SendMessageInputSchema,
  resolveMessageAttachmentContentType,
  validateMessageAttachmentCandidate,
} from '../src/index.ts'

const ids = {
  authUser: '0b47c8b7-7d46-45a3-847d-512d88a342cf',
  case: '03410974-6146-49ed-bace-fba3b58031f5',
  client: 'b7aaea82-d507-437d-809a-e75fa560ed5e',
  clientPerson: '2be2fafc-2a6a-45d3-9093-6e63187354b2',
  conversation: '9A56449A-6095-4103-8F76-BEED48DCA866',
  message: '3dbdc6b0-63c3-4c3c-bd55-32225b7a1ef1',
  organization: 'ee72cc2b-b4e8-4db3-8879-1730358af7ae',
  receipt: '39efc92a-096e-490c-aa97-80ed1da5c7a2',
  staff: 'fa16fbd5-e5aa-4376-b205-b265bc179291',
}

test('creates distinct durable and ephemeral channel names', () => {
  assert.deepEqual(conversationChannelNames(ids.conversation), {
    durable: `private:case-chat:${ids.conversation.toLowerCase()}`,
    ephemeral: `private:case-chat:${ids.conversation.toLowerCase()}:ephemeral`,
  })
  assert.throws(() => conversationChannelNames('not-a-uuid'))
})

test('validates and normalizes message input', () => {
  assert.deepEqual(SendMessageInputSchema.parse({
    body: '  Dzień dobry  ',
    clientMessageId: ids.message,
  }), {
    attachmentIds: [],
    body: 'Dzień dobry',
    clientMessageId: ids.message,
  })
  assert.throws(() => SendMessageInputSchema.parse({
    body: ' '.repeat(10),
    clientMessageId: ids.message,
  }))
  assert.throws(() => SendMessageInputSchema.parse({
    body: 'a'.repeat(4_001),
    clientMessageId: ids.message,
  }))
  assert.deepEqual(SendMessageInputSchema.parse({
    attachmentIds: [ids.receipt],
    body: '',
    clientMessageId: ids.message,
  }), {
    attachmentIds: [ids.receipt],
    body: '',
    clientMessageId: ids.message,
  })
  assert.throws(() => SendMessageInputSchema.parse({
    attachmentIds: [ids.receipt, ids.receipt],
    body: 'duplicate attachment',
    clientMessageId: ids.message,
  }))
})

test('validates attachment candidates and builds deterministic blob paths', () => {
  assert.equal(MESSAGE_ATTACHMENT_MAX_FILES, 10)
  assert.equal(MESSAGE_ATTACHMENT_MAX_FILE_BYTES, 25 * 1024 * 1024)
  assert.equal(MESSAGE_ATTACHMENT_MAX_TOTAL_BYTES, 50 * 1024 * 1024)
  assert.match(MESSAGE_ATTACHMENT_ACCEPT, /application\/pdf/u)

  assert.equal(
    resolveMessageAttachmentContentType('dokument.PDF', ''),
    'application/pdf',
  )
  assert.equal(
    resolveMessageAttachmentContentType('zdjecie.jpg', 'image/jpeg; charset=binary'),
    'image/jpeg',
  )
  assert.equal(resolveMessageAttachmentContentType('payload.html', 'text/html'), null)
  assert.deepEqual(validateMessageAttachmentCandidate({
    name: 'umowa.pdf',
    type: 'application/pdf',
    size: 1024,
  }), { ok: true, mimeType: 'application/pdf' })
  assert.deepEqual(validateMessageAttachmentCandidate({
    name: 'malware.exe',
    type: 'application/pdf',
    size: 1024,
  }), {
    ok: false,
    reason: 'File extension does not match its type',
  })
  assert.deepEqual(validateMessageAttachmentCandidate({
    name: 'raport.docx',
    type: 'application/pdf',
    size: 1024,
  }), {
    ok: false,
    reason: 'File extension does not match its type',
  })
  assert.equal(validateMessageAttachmentCandidate({
    name: 'za-duzy.pdf',
    type: 'application/pdf',
    size: MESSAGE_ATTACHMENT_MAX_FILE_BYTES + 1,
  }).ok, false)

  assert.equal(buildMessageAttachmentStoragePath({
    organizationId: ids.organization,
    caseId: ids.case,
    conversationId: ids.conversation,
    clientMessageId: ids.message,
    attachmentId: ids.receipt,
    mimeType: 'application/pdf',
  }), [
    ids.organization,
    ids.case,
    ids.conversation.toLowerCase(),
    ids.message,
    `${ids.receipt}.pdf`,
  ].join('/'))
})

test('validates and normalizes attachment reservation input', () => {
  assert.deepEqual(ReserveMessageAttachmentInputSchema.parse({
    clientMessageId: ids.message,
    name: '  folder\\umowa.pdf\u0000  ',
    mimeType: 'application/pdf',
    sizeBytes: 4096,
  }), {
    clientMessageId: ids.message,
    name: 'folder-umowa.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 4096,
  })
  assert.throws(() => ReserveMessageAttachmentInputSchema.parse({
    clientMessageId: ids.message,
    name: 'payload.svg',
    mimeType: 'image/svg+xml',
    sizeBytes: 1024,
  }))
  assert.throws(() => ReserveMessageAttachmentInputSchema.parse({
    clientMessageId: ids.message,
    name: 'invoice.exe',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
  }))
})

test('builds safe text and attachment-only conversation previews', () => {
  const attachment = {
    id: ids.receipt,
    name: 'potwierdzenie.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
  }
  assert.equal(buildMessagePreview('  Dzień\n dobry  ', [attachment]), 'Dzień dobry')
  assert.equal(buildMessagePreview('', [attachment]), 'Załącznik: potwierdzenie.pdf')
  assert.equal(buildMessagePreview('', [
    attachment,
    { ...attachment, id: ids.message },
  ]), '2 załączników')
})

test('read receipt also advances delivery high-water mark', () => {
  assert.deepEqual(ReceiptUpdateInputSchema.parse({
    deliveredThroughSequence: 3,
    readThroughSequence: 7,
  }), {
    deliveredThroughSequence: 7,
    readThroughSequence: 7,
  })
  assert.throws(() => ReceiptUpdateInputSchema.parse({}))
})

test('durable event rejects message content and participant metadata', () => {
  const event = {
    conversationId: ids.conversation,
    kind: 'message.created',
    messageId: ids.message,
    sequence: 2,
  }
  assert.deepEqual(DurableConversationEventSchema.parse(event), event)
  assert.throws(() => DurableConversationEventSchema.parse({
    ...event,
    body: 'This must never travel over the durable event channel',
  }))
  assert.throws(() => DurableConversationEventSchema.parse({
    ...event,
    senderUserId: ids.staff,
  }))
})

test('maps and normalizes Data API conversation and message rows', () => {
  const conversation = mapConversationRow({
    case_id: ids.case,
    client_id: ids.client,
    client_person_id: ids.clientPerson,
    created_at: '2026-08-02 10:00:00+00',
    id: ids.conversation,
    last_message_at: '2026-08-02T10:01:00Z',
    last_message_sequence: '12',
    next_sequence: '13',
    organization_id: ids.organization,
    updated_at: '2026-08-02T10:01:00.000Z',
  })
  assert.equal(conversation.lastMessageSequence, 12)
  assert.equal(conversation.createdAt, '2026-08-02T10:00:00.000Z')

  const message = mapMessageRow({
    attachments: [
      {
        id: ids.receipt,
        position: 2,
        file_name: 'drugi.pdf',
        content_type: 'application/pdf',
        size_bytes: '2048',
      },
      {
        id: 'f57efc08-9c7d-4794-b962-4959b1db3fb0',
        position: 1,
        file_name: 'pierwszy.jpg',
        content_type: 'image/jpeg',
        size_bytes: 1024,
        storage_path: 'must/not/leak',
      },
    ],
    body: 'Dzień dobry',
    client_message_id: ids.message,
    conversation_id: ids.conversation,
    created_at: '2026-08-02T10:01:00Z',
    id: ids.message,
    organization_id: ids.organization,
    sender_auth_user_id: ids.authUser,
    sender_client_person_id: ids.clientPerson,
    sender_kind: 'client',
    sender_user_id: null,
    sequence: '12',
  })
  assert.equal(message.sequence, 12)
  assert.deepEqual(message.attachments, [
    {
      id: 'f57efc08-9c7d-4794-b962-4959b1db3fb0',
      name: 'pierwszy.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
    },
    {
      id: ids.receipt,
      name: 'drugi.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    },
  ])
  assert.equal(JSON.stringify(message.attachments).includes('storage_path'), false)
  assert.equal(message.editedAt, null)
  assert.equal(message.deletedAt, null)
  assert.equal(mapMessageRow({
    attachments: [],
    body: 'Archiwalna odpowiedź',
    client_message_id: '6c912252-878c-4d68-8419-2037d6a155bf',
    conversation_id: ids.conversation,
    created_at: '2026-08-02T10:01:00Z',
    id: 'a359119e-60fb-49ba-92d1-6497295e1848',
    organization_id: ids.organization,
    sender_auth_user_id: null,
    sender_client_person_id: null,
    sender_kind: 'staff',
    sender_user_id: null,
    sequence: '13',
  }).senderUserId, null)
  assert.throws(() => mapMessageRow({
    ...message,
    client_message_id: ids.message,
    conversation_id: ids.conversation,
    created_at: message.createdAt,
    id: ids.message,
    organization_id: ids.organization,
    sender_auth_user_id: null,
    sender_client_person_id: null,
    sender_kind: 'client',
    sender_user_id: ids.staff,
    sequence: 12,
  }))
})

test('maps receipt high-water marks and enforces participant consistency', () => {
  const receipt = mapReceiptRow({
    conversation_id: ids.conversation,
    delivered_at: '2026-08-02T10:02:00Z',
    delivered_through_sequence: '12',
    id: ids.receipt,
    organization_id: ids.organization,
    participant_client_person_id: null,
    participant_kind: 'staff',
    participant_user_id: ids.staff,
    read_at: null,
    read_through_sequence: 10,
    updated_at: '2026-08-02T10:02:00Z',
  })
  assert.equal(receipt.deliveredThroughSequence, 12)
  assert.equal(receipt.readThroughSequence, 10)
  assert.throws(() => mapReceiptRow({
    conversation_id: ids.conversation,
    delivered_at: null,
    delivered_through_sequence: 2,
    id: ids.receipt,
    organization_id: ids.organization,
    participant_client_person_id: null,
    participant_kind: 'staff',
    participant_user_id: ids.staff,
    read_at: null,
    read_through_sequence: 3,
    updated_at: '2026-08-02T10:02:00Z',
  }))
})
