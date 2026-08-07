import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { createDataApiTokenSigner } from '@openexpert/data-api/token'
import {
  MULTIFORM_SERVICE_TOKEN_PURPOSE,
  parseMultiformServiceCredentials,
} from '../server/utils/multiform-service-auth.ts'

function fixture() {
  const { privateKey } = generateKeyPairSync('ed25519')
  const signer = createDataApiTokenSigner({
    audience: 'openexpert-data',
    issuer: 'openexpert-production',
    keyId: 'multiform-test',
    privateKey,
    ttlSeconds: 60,
  })
  return signer
}

test('extracts a CRM user token scoped to the Multiform service', () => {
  const signer = fixture()
  const token = signer.signUser('user-1', {
    purpose: MULTIFORM_SERVICE_TOKEN_PURPOSE,
  })

  assert.deepEqual(parseMultiformServiceCredentials(`Bearer ${token}`), {
    token,
    userId: 'user-1',
  })
})

test('rejects tokens without the Multiform service purpose', () => {
  const signer = fixture()

  assert.equal(
    parseMultiformServiceCredentials(`Bearer ${signer.signUser('user-1')}`),
    null,
  )
  assert.equal(
    parseMultiformServiceCredentials(`Bearer ${signer.signBackend()}`),
    null,
  )
})

test('rejects malformed credentials', () => {
  assert.equal(parseMultiformServiceCredentials('Basic credentials'), null)
  assert.equal(parseMultiformServiceCredentials('Bearer not-a-jwt'), null)
})
