import assert from 'node:assert/strict'
import test from 'node:test'

import { getBearerToken } from '../src/headers.ts'

test('getBearerToken reads a strict Bearer token', () => {
  assert.equal(
    getBearerToken(new Headers({ authorization: 'Bearer header.payload.signature' })),
    'header.payload.signature',
  )
  assert.equal(getBearerToken({ Authorization: 'bearer token-value' }), 'token-value')
})

test('getBearerToken rejects malformed or ambiguous headers', () => {
  assert.equal(getBearerToken({ authorization: 'Basic abc' }), null)
  assert.equal(getBearerToken({ authorization: ['Bearer one', 'Bearer two'] }), null)
  assert.equal(getBearerToken({ authorization: 'Bearer token with spaces' }), null)
})
