import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import type { H3Event } from 'h3'
import {
  parseMailMultipartBody,
  readBoundedRequestBody,
} from '../server/utils/mail-multipart.ts'

test('parses multipart text and binary file parts', async () => {
  const formData = new FormData()
  formData.append('to', 'anna@example.com')
  formData.append(
    'attachment',
    new File([new Uint8Array([0, 1, 2, 255])], 'raport.pdf', {
      type: 'application/pdf',
    }),
  )
  const request = new Request('http://openexpert.invalid/', {
    method: 'POST',
    body: formData,
  })
  const parts = await parseMailMultipartBody(
    request.headers.get('content-type') || '',
    Buffer.from(await request.arrayBuffer()),
  )

  assert.equal(parts[0]?.name, 'to')
  assert.equal(parts[0]?.data.toString('utf8'), 'anna@example.com')
  assert.equal(parts[1]?.name, 'attachment')
  assert.equal(parts[1]?.filename, 'raport.pdf')
  assert.equal(parts[1]?.type, 'application/pdf')
  assert.deepEqual(parts[1]?.data, Buffer.from([0, 1, 2, 255]))
})

test('caps a streamed request even without Content-Length', async () => {
  const acceptedStream = new PassThrough()
  const accepted = readBoundedRequestBody(
    fakeEvent(acceptedStream),
    5,
  )
  acceptedStream.end(Buffer.from('12345'))
  assert.equal((await accepted).toString('utf8'), '12345')

  const rejectedStream = new PassThrough()
  const rejected = readBoundedRequestBody(
    fakeEvent(rejectedStream),
    5,
  )
  rejectedStream.end(Buffer.from('123456'))
  await assert.rejects(rejected, (error: unknown) => (
    Number((error as { statusCode?: number })?.statusCode) === 413
  ))
})

test('rejects malformed multipart bodies', async () => {
  await assert.rejects(
    parseMailMultipartBody(
      'multipart/form-data; boundary=missing',
      Buffer.from('not a multipart body'),
    ),
    (error: unknown) => (
      Number((error as { statusCode?: number })?.statusCode) === 400
    ),
  )
})

function fakeEvent(stream: PassThrough): H3Event {
  return {
    node: { req: stream },
  } as unknown as H3Event
}
