import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decodeClientAttachmentCursor,
  encodeClientAttachmentCursor,
} from '../server/utils/case-conversation-attachment-cursor.ts'

const attachmentId = '12345678-1234-4234-8234-123456789abc'

describe('client conversation attachment cursor', () => {
  it('preserves PostgreSQL microseconds used at a page boundary', () => {
    const cursor = {
      sentAt: '2026-08-06T12:34:56.123456+00:00',
      id: attachmentId,
    }

    assert.deepEqual(
      decodeClientAttachmentCursor(encodeClientAttachmentCursor(cursor)),
      cursor,
    )
  })

  it('rejects additional filter fields', () => {
    const encoded = Buffer.from(JSON.stringify({
      sentAt: '2026-08-06T12:34:56.123456Z',
      id: attachmentId,
      organizationId: attachmentId,
    })).toString('base64url')

    assert.throws(() => decodeClientAttachmentCursor(encoded))
  })

  it('rejects oversized input before decoding it', () => {
    assert.throws(() => decodeClientAttachmentCursor('a'.repeat(513)))
  })
})
