import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeGmailAttachmentResponse,
  GmailAttachmentResponseError,
  MAX_GMAIL_BANK_ATTACHMENT_BYTES,
  readBoundedJsonResponse,
} from '../server/utils/gmail-attachment-core.ts'

function encoded(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

test('decodes one bounded Gmail attachment with exact size', () => {
  const source = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff])
  const result = decodeGmailAttachmentResponse({
    data: encoded(source),
    size: source.byteLength,
  }, source.byteLength)

  assert.deepEqual(result.bytes, source)
  assert.equal(result.size, source.byteLength)
})

test('rejects inconsistent, malformed and oversized Gmail attachment responses', () => {
  const valid = encoded(new Uint8Array([1, 2, 3]))
  for (const value of [
    null,
    { data: valid, size: 2 },
    { data: valid, size: 3 },
    { data: 'AAAAA', size: 3 },
    { data: 'AR', size: 1 },
    { data: 'AA+/', size: 3 },
    { data: 'AA==garbage', size: 1 },
    { data: 'AA', size: MAX_GMAIL_BANK_ATTACHMENT_BYTES + 1 },
  ]) {
    assert.throws(
      () => decodeGmailAttachmentResponse(value, value === null ? undefined : 4),
      GmailAttachmentResponseError,
    )
  }
  assert.throws(
    () => decodeGmailAttachmentResponse({ data: 'AR', size: 1 }, 1),
    GmailAttachmentResponseError,
  )
})

test('reads provider JSON through an actual byte bound before parsing', async () => {
  const payload = JSON.stringify({ data: 'AQID', size: 3 })
  const parsed = await readBoundedJsonResponse(new Response(payload, {
    headers: { 'content-length': String(Buffer.byteLength(payload)) },
  }), 64)
  assert.deepEqual(parsed, { data: 'AQID', size: 3 })

  await assert.rejects(
    readBoundedJsonResponse(new Response(payload), 8),
    GmailAttachmentResponseError,
  )
  await assert.rejects(
    readBoundedJsonResponse(new Response(payload, {
      headers: { 'content-length': '1000' },
    }), 64),
    GmailAttachmentResponseError,
  )
  await assert.rejects(
    readBoundedJsonResponse(new Response('{"data":'), 64),
    GmailAttachmentResponseError,
  )
})
