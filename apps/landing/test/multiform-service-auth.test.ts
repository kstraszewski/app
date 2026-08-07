import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { createDataApiTokenSigner } from '@openexpert/data-api/token'
import {
  MULTIFORM_SERVICE_TOKEN_PURPOSE,
  multiformServiceUserId,
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
  const verification = {
    audience: 'openexpert-data',
    issuer: 'openexpert-production',
    publicJwk: signer.jwks.keys[0]!,
  }
  return { signer, verification }
}

test('accepts a short-lived CRM user token scoped to the Multiform service', () => {
  const { signer, verification } = fixture()
  const token = signer.signUser('user-1', {
    purpose: MULTIFORM_SERVICE_TOKEN_PURPOSE,
  })

  assert.equal(multiformServiceUserId(`Bearer ${token}`, verification), 'user-1')
})

test('rejects tokens without the Multiform service purpose', () => {
  const { signer, verification } = fixture()

  assert.equal(
    multiformServiceUserId(`Bearer ${signer.signUser('user-1')}`, verification),
    null,
  )
  assert.equal(
    multiformServiceUserId(`Bearer ${signer.signBackend()}`, verification),
    null,
  )
})

test('rejects malformed and differently signed credentials', () => {
  const { verification } = fixture()
  const { signer: otherSigner } = fixture()
  const otherToken = otherSigner.signUser('user-1', {
    purpose: MULTIFORM_SERVICE_TOKEN_PURPOSE,
  })

  assert.equal(multiformServiceUserId('Basic credentials', verification), null)
  assert.equal(multiformServiceUserId(`Bearer ${otherToken}`, verification), null)
})
