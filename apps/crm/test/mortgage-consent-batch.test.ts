import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMortgageConsentBatchIdentity,
  mortgageConsentBatchSteps,
  sortedMortgageConsentClientIds,
} from '../app/utils/mortgage-consent-batch.ts'

const clientA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const clientB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

test('consent batch ordering and per-client command identities remain stable across retry', () => {
  let nextCommand = 0
  const identity = createMortgageConsentBatchIdentity(
    [clientB, clientA],
    7,
    () => `command-${++nextCommand}`,
  )
  const firstAttempt = mortgageConsentBatchSteps([clientB, clientA], identity)
  const retry = mortgageConsentBatchSteps([clientA, clientB], identity)

  assert.deepEqual(firstAttempt, [
    { clientId: clientA, commandId: 'command-1', expectedRevision: 7 },
    { clientId: clientB, commandId: 'command-2', expectedRevision: 8 },
  ])
  assert.deepEqual(retry, firstAttempt)
  assert.deepEqual(sortedMortgageConsentClientIds([clientB, clientA]), [clientA, clientB])
})

test('consent batch rejects duplicate clients and an identity from another material version', () => {
  const identity = createMortgageConsentBatchIdentity([clientA], 3, () => 'command-a')
  assert.throws(
    () => mortgageConsentBatchSteps([clientA, clientA], identity),
    /duplicate client/u,
  )
  assert.throws(
    () => mortgageConsentBatchSteps([clientB], identity),
    /does not match its clients/u,
  )
})
