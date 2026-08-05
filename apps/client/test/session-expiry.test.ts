import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clientSessionReturnPath,
  isProtectedClientApiRequest,
  isUnauthorizedRequestError,
} from '../app/utils/client-session.ts'

test('recognizes only protected client API requests', () => {
  assert.equal(isProtectedClientApiRequest('/api/client/portal'), true)
  assert.equal(isProtectedClientApiRequest('/api/client'), true)
  assert.equal(isProtectedClientApiRequest('https://client.openexpert.app/api/client/conversations?after=3'), true)
  assert.equal(isProtectedClientApiRequest(new Request('https://client.openexpert.app/api/client/cases/1')), true)
  assert.equal(isProtectedClientApiRequest('/api/auth/get-session'), false)
  assert.equal(isProtectedClientApiRequest('/api/demo/session'), false)
  assert.equal(isProtectedClientApiRequest('/api/client-side/public'), false)
})

test('recognizes common unauthorized fetch error shapes', () => {
  assert.equal(isUnauthorizedRequestError({ statusCode: 401 }), true)
  assert.equal(isUnauthorizedRequestError({ status: 401 }), true)
  assert.equal(isUnauthorizedRequestError({ response: { status: 401 } }), true)
  assert.equal(isUnauthorizedRequestError({ statusCode: 500 }), false)
  assert.equal(isUnauthorizedRequestError(new Error('network error')), false)
})

test('keeps safe return locations and blocks redirect loops', () => {
  assert.equal(clientSessionReturnPath('/messages?case=abc'), '/messages?case=abc')
  assert.equal(clientSessionReturnPath('/cases/123#messages'), '/cases/123#messages')
  assert.equal(clientSessionReturnPath('/login?redirect=/messages'), '/')
  assert.equal(clientSessionReturnPath('/preview/messages'), '/')
  assert.equal(clientSessionReturnPath('//evil.example/path'), '/')
  assert.equal(clientSessionReturnPath('/\\evil.example/path'), '/')
})
