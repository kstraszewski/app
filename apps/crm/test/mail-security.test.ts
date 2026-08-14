import assert from 'node:assert/strict'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  decryptMailSecretValue,
  decryptMailSecretValueWithLegacyFallback,
  deriveMailEncryptionKey,
  encryptMailSecretValue,
  MAIL_ENCRYPTION_SECRET_MIN_BYTES,
  mailEncryptionSecretIsStrong,
} from '../server/utils/mail-crypto-core.ts'
import {
  mailOAuthCookieName,
  mailOAuthCookieNames,
  mailOAuthFlowSecretContext,
  mailOAuthStateFromCookieName,
  MAX_ACTIVE_MAIL_OAUTH_FLOWS,
  validatedMailOAuthFlow,
} from '../server/utils/mail-oauth-flow.ts'
import {
  connectionBoundMailMessageId,
  mailSendCanRecoverWithoutNewAttempt,
} from '../server/utils/mail-send-idempotency.ts'

const strongSecret = 'mail-encryption-secret-with-32-bytes-minimum'
const stateA = 'A'.repeat(43)
const stateB = 'B'.repeat(43)

test('keeps composer and API attachment limits below the Vercel request ceiling', () => {
  const requestLimit = 4 * 1024 * 1024
  const attachmentLimit = 3 * 1024 * 1024
  const worstCaseBodyBytes = Buffer.byteLength('\u0800'.repeat(200_000), 'utf8')

  assert.ok(requestLimit < 4_500_000)
  assert.ok(requestLimit - attachmentLimit - worstCaseBodyBytes > 256 * 1024)

  const route = readFileSync(
    new URL('../server/api/org/[organizationSlug]/mail/messages.post.ts', import.meta.url),
    'utf8',
  )
  const capabilities = readFileSync(
    new URL('../server/api/org/[organizationSlug]/mail-connections/index.get.ts', import.meta.url),
    'utf8',
  )
  const composer = readFileSync(
    new URL('../app/components/mail/MailComposerSlideover.vue', import.meta.url),
    'utf8',
  )

  assert.match(route, /MAX_REQUEST_BYTES = 4 \* 1024 \* 1024/u)
  assert.match(route, /MAX_ATTACHMENT_BYTES = 3 \* 1024 \* 1024/u)
  assert.match(route, /MAX_ATTACHMENTS_BYTES = 3 \* 1024 \* 1024/u)
  assert.match(capabilities, /MAX_MAIL_ATTACHMENT_BYTES = 3 \* 1024 \* 1024/u)
  assert.match(composer, /maxAttachmentBytes: 3 \* 1024 \* 1024/u)
  assert.match(composer, /maxTotalAttachmentBytes: 3 \* 1024 \* 1024/u)
})

test('requires at least 32 UTF-8 bytes for mail credential encryption', () => {
  assert.equal(MAIL_ENCRYPTION_SECRET_MIN_BYTES, 32)
  assert.equal(mailEncryptionSecretIsStrong('x'.repeat(31)), false)
  assert.equal(mailEncryptionSecretIsStrong('x'.repeat(32)), true)
  assert.equal(mailEncryptionSecretIsStrong('ą'.repeat(16)), true)
  assert.throws(() => deriveMailEncryptionKey('short secret'), /at least 32/u)
})

test('decrypts both context-bound v2 and legacy v1 mail secrets', () => {
  const context = 'openexpert-mail:test-context'
  const v2 = encryptMailSecretValue(strongSecret, 'sekret-v2', context)
  assert.match(v2, /^v2\./u)
  assert.equal(decryptMailSecretValue(strongSecret, v2, context), 'sekret-v2')
  assert.throws(() => decryptMailSecretValue(strongSecret, v2, `${context}:other`))

  const weakLegacySecret = 'old-key-11b'
  const iv = randomBytes(12)
  const cipher = createCipheriv(
    'aes-256-gcm',
    createHash('sha256').update(weakLegacySecret, 'utf8').digest(),
    iv,
  )
  const encrypted = Buffer.concat([cipher.update('sekret-v1', 'utf8'), cipher.final()])
  const v1 = [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.')
  assert.throws(() => decryptMailSecretValue(weakLegacySecret, v1, 'dowolny-kontekst'))
  assert.equal(decryptMailSecretValue(
    weakLegacySecret,
    v1,
    'dowolny-kontekst',
    { allowHistoricallyWeakSecret: true },
  ), 'sekret-v1')
  assert.equal(decryptMailSecretValueWithLegacyFallback(
    strongSecret,
    weakLegacySecret,
    v1,
    'dowolny-kontekst',
  ), 'sekret-v1')

  const legacyV2Iv = randomBytes(12)
  const legacyV2Cipher = createCipheriv(
    'aes-256-gcm',
    createHash('sha256').update(weakLegacySecret, 'utf8').digest(),
    legacyV2Iv,
  )
  legacyV2Cipher.setAAD(Buffer.from(context, 'utf8'))
  const legacyV2Encrypted = Buffer.concat([
    legacyV2Cipher.update('sekret-v2-legacy', 'utf8'),
    legacyV2Cipher.final(),
  ])
  const legacyV2 = [
    'v2',
    legacyV2Iv.toString('base64url'),
    legacyV2Cipher.getAuthTag().toString('base64url'),
    legacyV2Encrypted.toString('base64url'),
  ].join('.')
  assert.equal(decryptMailSecretValueWithLegacyFallback(
    strongSecret,
    weakLegacySecret,
    legacyV2,
    context,
  ), 'sekret-v2-legacy')
  assert.throws(() => decryptMailSecretValue(
    'wrong-old-key',
    v1,
    'dowolny-kontekst',
    { allowHistoricallyWeakSecret: true },
  ))
  assert.throws(() => decryptMailSecretValueWithLegacyFallback(
    strongSecret,
    'wrong-old-key',
    v1,
    'dowolny-kontekst',
  ))
})

test('binds new RFC Message-ID values to both connection and idempotency key', () => {
  const connectionA = '11111111-1111-4111-8111-111111111111'
  const connectionB = '22222222-2222-4222-8222-222222222222'
  const key = '58f147b8-62c1-4c0b-81a8-e0d2bafed903'
  const first = connectionBoundMailMessageId(connectionA, key)
  assert.equal(first, connectionBoundMailMessageId(connectionA, key))
  assert.notEqual(first, connectionBoundMailMessageId(connectionB, key))
  assert.notEqual(
    first,
    connectionBoundMailMessageId(connectionA, '68f147b8-62c1-4c0b-81a8-e0d2bafed904'),
  )
  assert.match(first, /^<[0-9a-f]{64}@mail\.openexpert\.app>$/u)
})

test('rate-limit policy bypasses only idempotent recovery without a new attempt', () => {
  assert.equal(mailSendCanRecoverWithoutNewAttempt('pending'), true)
  assert.equal(mailSendCanRecoverWithoutNewAttempt('sent'), true)
  assert.equal(mailSendCanRecoverWithoutNewAttempt('unknown'), true)
  assert.equal(mailSendCanRecoverWithoutNewAttempt('failed'), false)
  assert.equal(mailSendCanRecoverWithoutNewAttempt(null), false)
})

test('uses independent bounded state-keyed OAuth cookies for parallel tabs', () => {
  const cookieA = mailOAuthCookieName(stateA)
  const cookieB = mailOAuthCookieName(stateB)
  assert.notEqual(cookieA, cookieB)
  assert.equal(mailOAuthStateFromCookieName(cookieA), stateA)
  assert.equal(mailOAuthStateFromCookieName(cookieB), stateB)
  assert.notEqual(mailOAuthFlowSecretContext(stateA), mailOAuthFlowSecretContext(stateB))
  assert.equal(MAX_ACTIVE_MAIL_OAUTH_FLOWS, 4)

  const header = Array.from({ length: 24 }, (_, index) => {
    const state = String.fromCharCode(65 + (index % 26)).repeat(43)
    return `${mailOAuthCookieName(state)}=encrypted-${index}`
  }).join('; ')
  assert.equal(mailOAuthCookieNames(header).length, 16)
  assert.deepEqual(mailOAuthCookieNames(`${cookieA}=one; ${cookieB}=two`), [cookieA, cookieB])
})

test('validates OAuth state, owner and bounded flow fields independently per provider', () => {
  const base = {
    state: stateA,
    organizationSlug: 'openexpert-local',
    ownerUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    returnTo: '/org/openexpert-local/mail?account=test',
    codeVerifier: 'v'.repeat(64),
    expiresAt: Date.now() + 10 * 60_000,
  }
  assert.equal(validatedMailOAuthFlow({ ...base, provider: 'google' }, stateA).provider, 'google')
  assert.equal(validatedMailOAuthFlow({ ...base, provider: 'microsoft' }, stateA).provider, 'microsoft')
  assert.throws(() => validatedMailOAuthFlow({ ...base, provider: 'google' }, stateB))
  assert.throws(() => validatedMailOAuthFlow({
    ...base,
    provider: 'google',
    ownerUserId: 'not-a-user-id',
  }))
})
