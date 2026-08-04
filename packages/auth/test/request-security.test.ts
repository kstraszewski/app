import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getOpenExpertTrustedClientIp,
  isOpenExpertSameOriginJsonRequest,
} from '../src/request-security.ts'

test('uses only explicitly trusted single-value proxy IP headers', () => {
  const headers = new Headers({
    'x-vercel-forwarded-for': '2001:0db8:0:0:0:0:0:1',
    'x-forwarded-for': '198.51.100.10, 10.0.0.1',
  })
  assert.equal(getOpenExpertTrustedClientIp({
    headers,
    directAddress: '127.0.0.1',
    trustedHeaderNames: ['x-vercel-forwarded-for'],
  }), '2001:db8::1')

  assert.equal(getOpenExpertTrustedClientIp({
    headers,
    directAddress: '127.0.0.1',
    trustedHeaderNames: ['x-forwarded-for'],
  }), '127.0.0.1')
})

test('rejects cross-origin and form auth-message requests', () => {
  const baseURL = 'https://crm.openexpert.app'
  assert.equal(isOpenExpertSameOriginJsonRequest(new Headers({
    'content-type': 'application/json; charset=utf-8',
    origin: baseURL,
    'sec-fetch-site': 'same-origin',
  }), baseURL), true)

  assert.equal(isOpenExpertSameOriginJsonRequest(new Headers({
    'content-type': 'application/json',
    origin: 'https://attacker.example',
    'sec-fetch-site': 'cross-site',
  }), baseURL), false)

  assert.equal(isOpenExpertSameOriginJsonRequest(new Headers({
    'content-type': 'application/x-www-form-urlencoded',
    origin: baseURL,
  }), baseURL), false)
})
