import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatMessageAttachmentBytes,
  isImageMessageAttachment,
  messageAttachmentFileFingerprint,
  messageAttachmentKindLabel,
  messageAttachmentVisualKind,
} from '../src/helpers.ts'
import {
  messageReplyPreviewText,
  resolveMessageReplySwipe,
} from '../src/replies.ts'

test('classifies common message attachment MIME types', () => {
  assert.equal(messageAttachmentVisualKind({ mimeType: 'image/jpeg' }), 'image')
  assert.equal(messageAttachmentVisualKind({ mimeType: 'application/pdf' }), 'pdf')
  assert.equal(messageAttachmentVisualKind({ mimeType: 'application/msword' }), 'word')
  assert.equal(messageAttachmentVisualKind({
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }), 'spreadsheet')
  assert.equal(messageAttachmentVisualKind({ mimeType: 'application/octet-stream' }), 'file')
  assert.equal(isImageMessageAttachment({ mimeType: 'IMAGE/PNG' }), true)
  assert.equal(messageAttachmentKindLabel({ mimeType: 'application/pdf' }), 'PDF')
})

test('formats attachment sizes for Polish UI', () => {
  assert.equal(formatMessageAttachmentBytes(0), '0 B')
  assert.equal(formatMessageAttachmentBytes(1024), '1 KB')
  assert.equal(formatMessageAttachmentBytes(10 * 1024), '10 KB')
  assert.equal(formatMessageAttachmentBytes(1.5 * 1024 * 1024), '1,5 MB')
  assert.equal(formatMessageAttachmentBytes(Number.NaN), '')
})

test('builds a stable local file fingerprint', () => {
  const first = { name: 'załącznik.pdf', size: 1024, lastModified: 123 }
  const same = { ...first }
  const changed = { ...first, lastModified: 124 }
  assert.equal(messageAttachmentFileFingerprint(first), messageAttachmentFileFingerprint(same))
  assert.notEqual(messageAttachmentFileFingerprint(first), messageAttachmentFileFingerprint(changed))
})

test('builds compact reply previews for text and attachments', () => {
  const base = {
    id: '3dbdc6b0-63c3-4c3c-bd55-32225b7a1ef1',
    sequence: 1,
    senderKind: 'client' as const,
    attachments: [],
  }
  assert.equal(messageReplyPreviewText({
    ...base,
    body: '  Dzień\n dobry  ',
  }), 'Dzień dobry')
  assert.equal(messageReplyPreviewText({
    ...base,
    body: '',
    attachments: [{
      id: '39efc92a-096e-490c-aa97-80ed1da5c7a2',
      name: 'umowa.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    }],
  }), 'Załącznik: umowa.pdf')
  assert.equal(messageReplyPreviewText({ ...base, body: '' }), 'Wiadomość')
})

test('classifies a right-swipe without blocking vertical scrolling', () => {
  assert.deepEqual(resolveMessageReplySwipe(7, 2), {
    intent: 'pending',
    offset: 0,
    progress: 0,
    shouldReply: false,
  })
  assert.equal(resolveMessageReplySwipe(47, 2).shouldReply, false)
  assert.equal(resolveMessageReplySwipe(48, 2).shouldReply, true)
  assert.equal(resolveMessageReplySwipe(100, 2).offset, 64)
  assert.equal(resolveMessageReplySwipe(20, 30).intent, 'vertical')
  assert.equal(resolveMessageReplySwipe(-60, 1).intent, 'opposite')
})
