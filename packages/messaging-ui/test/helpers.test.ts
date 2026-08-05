import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatMessageAttachmentBytes,
  isImageMessageAttachment,
  messageAttachmentFileFingerprint,
  messageAttachmentKindLabel,
  messageAttachmentVisualKind,
} from '../src/helpers.ts'

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
