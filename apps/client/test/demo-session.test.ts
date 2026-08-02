import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createDemoAccessCodeHash,
  createDemoSessionToken,
  DEMO_SESSION_TTL_SECONDS,
  demoAccessCodeMatchesHash,
  isDemoAccessCodeHash,
  isSecureDemoAccessCode,
  verifyDemoSessionToken,
} from '../shared/utils/demo-session.ts'

describe('client demo access code', () => {
  const accessCode = 'OpenExpert-Demo-Access-2026!'

  it('requires a long printable access code', () => {
    assert.equal(isSecureDemoAccessCode('too-short'), false)
    assert.equal(isSecureDemoAccessCode(accessCode), true)
    assert.equal(isSecureDemoAccessCode(`${accessCode}\n`), false)
  })

  it('stores only a salted scrypt hash and compares it safely', () => {
    const hash = createDemoAccessCodeHash(accessCode, 'fixed-demo-salt-1')
    assert.match(hash, /^scrypt\$v1\$fixed-demo-salt-1\$/u)
    assert.equal(isDemoAccessCodeHash(hash), true)
    assert.equal(isDemoAccessCodeHash('scrypt$v1$broken'), false)
    assert.equal(hash.includes(accessCode), false)
    assert.equal(demoAccessCodeMatchesHash(accessCode, hash), true)
    assert.equal(demoAccessCodeMatchesHash('incorrect-access-code', hash), false)
    assert.equal(demoAccessCodeMatchesHash(accessCode, `${hash}tampered`), false)
  })
})

describe('client demo session token', () => {
  const secret = 'a-secure-demo-session-secret-with-more-than-32-characters'
  const now = 1_785_672_000

  it('accepts a signed, unexpired token', () => {
    const token = createDemoSessionToken(secret, now + DEMO_SESSION_TTL_SECONDS)
    assert.equal(verifyDemoSessionToken(secret, token, now), true)
  })

  it('rejects expired, modified and implausibly long-lived tokens', () => {
    const expired = createDemoSessionToken(secret, now - 1)
    const valid = createDemoSessionToken(secret, now + 60)
    const longLived = createDemoSessionToken(secret, now + DEMO_SESSION_TTL_SECONDS + 61)

    assert.equal(verifyDemoSessionToken(secret, expired, now), false)
    assert.equal(verifyDemoSessionToken(secret, `${valid}x`, now), false)
    assert.equal(verifyDemoSessionToken(secret, longLived, now), false)
    assert.equal(verifyDemoSessionToken('different-session-secret-with-more-than-32-characters', valid, now), false)
  })
})
