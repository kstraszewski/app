import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildConsentSmsBody,
  consentCaptureDemoUrl,
  consentCapturePublicUrl,
  consentDecisionAllowed,
  createConsentVerificationProof,
  generateConsentCaptureOtp,
  generateConsentCaptureToken,
  hashConsentCaptureOtp,
  hashConsentCaptureToken,
  isConsentCaptureOtp,
  isConsentCaptureToken,
  maskConsentPhone,
  normalizeConsentPhone,
  resolveConsentSmsConfig,
  securelyEqualConsentHash,
  sendConsentSms,
  verifyConsentCaptureOtp,
  verifyConsentVerificationProof,
} from '../server/utils/consent-capture.ts'

const secret = 'test-consent-secret-with-at-least-32-characters'
const requestId = '123e4567-e89b-42d3-a456-426614174000'

describe('consent capture credentials', () => {
  it('generates a 256-bit unpadded public token and a six-digit OTP', () => {
    const tokens = new Set(Array.from({ length: 20 }, generateConsentCaptureToken))
    assert.equal(tokens.size, 20)
    for (const token of tokens) assert.equal(isConsentCaptureToken(token), true)

    for (let index = 0; index < 100; index += 1) {
      assert.equal(isConsentCaptureOtp(generateConsentCaptureOtp()), true)
    }
  })

  it('stores domain-separated HMACs and compares them in constant-size buffers', () => {
    const token = generateConsentCaptureToken()
    const tokenHash = hashConsentCaptureToken(secret, token)
    const otpHash = hashConsentCaptureOtp(secret, requestId, '012345')

    assert.match(tokenHash, /^[0-9a-f]{64}$/)
    assert.match(otpHash, /^[0-9a-f]{64}$/)
    assert.notEqual(tokenHash, otpHash)
    assert.equal(tokenHash.includes(token), false)
    assert.equal(securelyEqualConsentHash(tokenHash, tokenHash), true)
    const changedLastCharacter = tokenHash.endsWith('0') ? '1' : '0'
    assert.equal(
      securelyEqualConsentHash(
        tokenHash,
        `${tokenHash.slice(0, -1)}${changedLastCharacter}`,
      ),
      false,
    )
    assert.equal(securelyEqualConsentHash(tokenHash, 'not-a-hash'), false)
  })

  it('binds OTP and browser verification proof to one capture request', () => {
    const otpHash = hashConsentCaptureOtp(secret, requestId, '012345')
    assert.equal(verifyConsentCaptureOtp(secret, requestId, '012345', otpHash), true)
    assert.equal(verifyConsentCaptureOtp(secret, requestId, '012346', otpHash), false)
    assert.equal(verifyConsentCaptureOtp(secret, requestId, '12345', otpHash), false)

    const tokenHash = hashConsentCaptureToken(secret, generateConsentCaptureToken())
    const proof = createConsentVerificationProof(secret, requestId, tokenHash)
    assert.equal(
      verifyConsentVerificationProof(secret, requestId, tokenHash, proof),
      true,
    )
    assert.equal(
      verifyConsentVerificationProof(secret, requestId, tokenHash, tokenHash),
      false,
    )
  })
})

describe('consent capture phone handling', () => {
  it('normalizes Polish local and international E.164-style numbers', () => {
    assert.equal(normalizeConsentPhone('501 234 567'), '+48501234567')
    assert.equal(normalizeConsentPhone('48 501-234-567'), '+48501234567')
    assert.equal(normalizeConsentPhone('+48 (501) 234 567'), '+48501234567')
    assert.equal(normalizeConsentPhone('0044 20 7946 0958'), '+442079460958')
    assert.equal(normalizeConsentPhone('+1 415 555 2671'), '+14155552671')
  })

  it('rejects ambiguous or malformed phone values and masks valid output', () => {
    assert.equal(normalizeConsentPhone('4155552671'), null)
    assert.equal(normalizeConsentPhone('+48 501 234 567 ext 2'), null)
    assert.equal(normalizeConsentPhone('+0123456789'), null)
    assert.equal(maskConsentPhone('+48 501 234 567'), '••• ••• 567')
  })
})

describe('consent capture runtime and messages', () => {
  it('resolves a safe local development configuration', () => {
    assert.deepEqual(resolveConsentSmsConfig({
      provider: 'local',
      otpSecret: secret,
      publicBaseUrl: 'http://127.0.0.1:3004/some-path',
      ttlSeconds: 600,
      maxOtpAttempts: 5,
    }), {
      provider: 'local',
      demoAutoFill: false,
      gatewayUrl: '',
      gatewayToken: '',
      sender: '',
      otpSecret: secret,
      publicBaseUrl: 'http://127.0.0.1:3004',
      ttlSeconds: 600,
      maxOtpAttempts: 5,
    })
  })

  it('rejects a local or insecure HTTP provider in production', () => {
    assert.throws(() => resolveConsentSmsConfig({
      provider: 'local',
      otpSecret: secret,
      publicBaseUrl: 'https://crm.example.com',
    }, { production: true }))

    assert.throws(() => resolveConsentSmsConfig({
      provider: 'http',
      gatewayUrl: 'http://sms.example.com/send',
      gatewayToken: 'gateway-secret',
      sender: 'OpenExpert',
      otpSecret: secret,
      publicBaseUrl: 'https://crm.example.com',
    }, { production: true }))
  })

  it('allows the local provider in production only for explicit demo auto-fill', () => {
    assert.deepEqual(resolveConsentSmsConfig({
      provider: 'local',
      demoAutoFill: true,
      otpSecret: secret,
      publicBaseUrl: 'https://crm-demo.example.com',
    }, { production: true }), {
      provider: 'local',
      demoAutoFill: true,
      gatewayUrl: '',
      gatewayToken: '',
      sender: '',
      otpSecret: secret,
      publicBaseUrl: 'https://crm-demo.example.com',
      ttlSeconds: 600,
      maxOtpAttempts: 5,
    })

    assert.throws(() => resolveConsentSmsConfig({
      provider: 'http',
      demoAutoFill: true,
      gatewayUrl: 'https://sms.example.com/send',
      gatewayToken: 'gateway-secret',
      sender: 'OpenExpert',
      otpSecret: secret,
      publicBaseUrl: 'https://crm.example.com',
    }, { production: true }))

    assert.throws(() => resolveConsentSmsConfig({
      provider: 'local',
      demoAutoFill: 'TRUE',
      otpSecret: secret,
      publicBaseUrl: 'https://crm-demo.example.com',
    }, { production: true }))
  })

  it('builds a root-scoped public URL and intent-specific message', () => {
    const token = generateConsentCaptureToken()
    const publicUrl = consentCapturePublicUrl('https://crm.example.com/base', token)
    assert.equal(publicUrl, `https://crm.example.com/consent/${token}`)
    assert.match(buildConsentSmsBody({
      intent: 'withdraw',
      otp: '012345',
      publicUrl,
      ttlSeconds: 601,
    }), /Wycofanie zgody.*012345.*11 min\./)
  })

  it('puts demo OTP only in a URL fragment', () => {
    const token = generateConsentCaptureToken()
    const publicUrl = consentCapturePublicUrl('https://crm-demo.example.com', token)
    const demoUrl = consentCaptureDemoUrl(publicUrl, '012345')
    const parsed = new URL(demoUrl)

    assert.equal(parsed.origin + parsed.pathname, publicUrl)
    assert.equal(parsed.search, '')
    assert.equal(parsed.hash, '#demo-code=012345')
    assert.equal(demoUrl.includes('?'), false)
    assert.throws(() => consentCaptureDemoUrl(publicUrl, '12345'))
  })

  it('keeps local delivery deterministic without a network dependency', async () => {
    const config = resolveConsentSmsConfig({
      provider: 'local',
      otpSecret: secret,
      publicBaseUrl: 'http://127.0.0.1:3004',
    })
    assert.deepEqual(await sendConsentSms(config, {
      requestId,
      destination: '+48501234567',
      body: 'test',
    }), {
      provider: 'local',
      providerMessageId: `local-${requestId}`,
    })
  })

  it('allows only intent-compatible final decisions', () => {
    assert.equal(consentDecisionAllowed('collect', 'granted'), true)
    assert.equal(consentDecisionAllowed('collect', 'declined'), true)
    assert.equal(consentDecisionAllowed('collect', 'withdrawn'), false)
    assert.equal(consentDecisionAllowed('withdraw', 'withdrawn'), true)
    assert.equal(consentDecisionAllowed('withdraw', 'declined'), false)
  })
})
