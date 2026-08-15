import assert from 'node:assert/strict'
import {
  createPublicKey,
  generateKeyPairSync,
  verify,
} from 'node:crypto'
import test from 'node:test'
import {
  createDataApiTokenSigner,
  parseDataApiPublicJwk,
  verifyDataApiToken,
} from '../src/token.ts'

function decodePart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T
}

test('signs PostgREST user tokens with RLS role and subject', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const signer = createDataApiTokenSigner({
    audience: 'openexpert-data',
    issuer: 'http://127.0.0.1:3004',
    keyId: 'local-test',
    privateKey,
    publicKey,
    ttlSeconds: 30,
  })

  const token = signer.signUser('5a9db4ce-5960-4d3f-a646-a40b49eafc5a')
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
  const header = decodePart<Record<string, unknown>>(encodedHeader!)
  const payload = decodePart<Record<string, unknown>>(encodedPayload!)

  assert.equal(header.alg, 'EdDSA')
  assert.equal(header.kid, 'local-test')
  assert.equal(payload.role, 'authenticated')
  assert.equal(payload.sub, '5a9db4ce-5960-4d3f-a646-a40b49eafc5a')
  assert.equal(payload.aud, 'openexpert-data')
  assert.equal(payload.iss, 'http://127.0.0.1:3004')
  assert.ok(Number(payload.exp) - Number(payload.iat) === 30)
  assert.equal(
    verify(
      null,
      Buffer.from(`${encodedHeader}.${encodedPayload}`, 'ascii'),
      publicKey,
      Buffer.from(encodedSignature!, 'base64url'),
    ),
    true,
  )

  const jwk = signer.jwks.keys[0]!
  assert.equal(jwk.d, undefined)
  assert.equal(createPublicKey({ format: 'jwk', key: jwk }).asymmetricKeyType, 'ed25519')
  assert.equal(
    verifyDataApiToken(token, {
      audience: 'openexpert-data',
      issuer: 'http://127.0.0.1:3004',
      publicJwk: jwk,
    }).sub,
    '5a9db4ce-5960-4d3f-a646-a40b49eafc5a',
  )
})

test('verification rejects expired and role-confused tokens', () => {
  const { privateKey } = generateKeyPairSync('ed25519')
  const signer = createDataApiTokenSigner({
    audience: 'openexpert-data',
    issuer: 'openexpert',
    keyId: 'verification-test',
    privateKey,
    ttlSeconds: 1,
  })
  const token = signer.signUser('user-1')

  assert.throws(
    () => verifyDataApiToken(token, {
      audience: 'openexpert-data',
      expectedRole: 'openexpert_service',
      issuer: 'openexpert',
      publicJwk: signer.jwks.keys[0]!,
    }),
    /Unexpected/u,
  )
  assert.throws(
    () => verifyDataApiToken(token, {
      audience: 'openexpert-data',
      issuer: 'openexpert',
      now: Date.now() + 10_000,
      publicJwk: signer.jwks.keys[0]!,
    }),
    /expired/u,
  )
})

test('service tokens cannot be confused with end-user tokens', () => {
  const { privateKey } = generateKeyPairSync('ed25519')
  const signer = createDataApiTokenSigner({
    audience: 'openexpert-data',
    issuer: 'openexpert',
    keyId: 'service-test',
    privateKey,
  })

  const payload = decodePart<Record<string, unknown>>(signer.signBackend().split('.')[1]!)
  assert.equal(payload.role, 'openexpert_service')
  assert.equal(payload.sub, undefined)
  const trustedActorPayload = decodePart<Record<string, unknown>>(
    signer.signBackend({ actor_user_id: '5a9db4ce-5960-4d3f-a646-a40b49eafc5a' }).split('.')[1]!,
  )
  assert.equal(trustedActorPayload.role, 'openexpert_service')
  assert.equal(
    trustedActorPayload.actor_user_id,
    '5a9db4ce-5960-4d3f-a646-a40b49eafc5a',
  )
  assert.equal(trustedActorPayload.sub, undefined)
  assert.throws(
    () => signer.sign({ role: 'authenticated' }),
    /require sub/u,
  )
})

test('rejects public JWK values that leak private key material', () => {
  assert.throws(
    () => parseDataApiPublicJwk(JSON.stringify({
      crv: 'Ed25519',
      d: 'private',
      kty: 'OKP',
      x: 'public',
    })),
    /cannot contain private/u,
  )
})
