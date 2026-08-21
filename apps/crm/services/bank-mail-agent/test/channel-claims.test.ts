import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBankMailInvocationClaims } from '../agent/channels/eve.ts'

const validClaims = {
  serviceId: 'openexpert-crm-bank-mail-ingestion',
  preset: 'bank-mail-intake',
  organizationId: '11111111-1111-4111-8111-111111111111',
  organizationSlug: 'synthetic-bank-test',
  intakeId: '22222222-2222-4222-8222-222222222222',
  analysisRunId: '55555555-5555-4555-8555-555555555555',
  connectionId: '33333333-3333-4333-8333-333333333333',
  mailboxOwnerUserId: '44444444-4444-4444-8444-444444444444',
}

test('accepts a complete immutable bank-mail intake scope', () => {
  assert.deepEqual(parseBankMailInvocationClaims(validClaims), validClaims)
})

test('accepts reanalysis only when its request id equals the analysis run id', () => {
  const reanalysisRequestId = validClaims.analysisRunId
  assert.deepEqual(parseBankMailInvocationClaims({
    ...validClaims,
    serviceId: 'openexpert-crm-bank-mail-reanalysis',
    preset: 'bank-mail-reanalysis',
    reanalysisRequestId,
  }), {
    ...validClaims,
    serviceId: 'openexpert-crm-bank-mail-reanalysis',
    preset: 'bank-mail-reanalysis',
    reanalysisRequestId,
  })

  assert.throws(
    () => parseBankMailInvocationClaims({
      ...validClaims,
      serviceId: 'openexpert-crm-bank-mail-reanalysis',
      preset: 'bank-mail-reanalysis',
      reanalysisRequestId: '66666666-6666-4666-8666-666666666666',
    }),
    /reanalysis request/u,
  )
})

test('rejects reanalysis scope smuggled into an initial invocation', () => {
  assert.throws(
    () => parseBankMailInvocationClaims({
      ...validClaims,
      reanalysisRequestId: validClaims.analysisRunId,
    }),
    /Unexpected.*reanalysis/u,
  )
})

test('rejects a different preset', () => {
  assert.throws(
    () => parseBankMailInvocationClaims({ ...validClaims, preset: 'mail-reply' }),
    /preset/u,
  )
})

test('rejects a backend token minted for another service', () => {
  assert.throws(
    () => parseBankMailInvocationClaims({ ...validClaims, serviceId: 'some-other-worker' }),
    /service principal/u,
  )
})

test('rejects the initial service principal under the reanalysis preset', () => {
  assert.throws(
    () => parseBankMailInvocationClaims({
      ...validClaims,
      preset: 'bank-mail-reanalysis',
      reanalysisRequestId: validClaims.analysisRunId,
    }),
    /reanalysis service principal/u,
  )
})

test('rejects malformed identifiers and organization slugs', () => {
  assert.throws(
    () => parseBankMailInvocationClaims({ ...validClaims, intakeId: '../other' }),
    /intakeId/u,
  )
  assert.throws(
    () => parseBankMailInvocationClaims({ ...validClaims, organizationSlug: 'Other Org' }),
    /slug/u,
  )
})

test('ignores untrusted extra claims instead of projecting them into auth attributes', () => {
  assert.deepEqual(
    parseBankMailInvocationClaims({
      ...validClaims,
      organizationName: 'Do not expose me',
      pesel: '00000000000',
    }),
    validClaims,
  )
})
