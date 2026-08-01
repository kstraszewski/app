import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertProcessHandoffFingerprint,
  canChangeProcessStatus,
  canHandoffProcess,
  canRespondToProcessHandoff,
  expectedProcessHandoffStatus,
  parseProcessHandoffRequest,
  parseProcessHandoffResponse,
  processHandoffFingerprint,
} from '../server/utils/process-handoff.ts'

const requesterUserId = '11111111-1111-4111-8111-111111111111'
const proposedOwnerUserId = '22222222-2222-4222-8222-222222222222'
const caseId = '33333333-3333-4333-8333-333333333333'
const organizationId = '44444444-4444-4444-8444-444444444444'
const caseItemId = '55555555-5555-4555-8555-555555555555'
const caseOwnerUserId = '66666666-6666-4666-8666-666666666666'
const processOwnerUserId = '77777777-7777-4777-8777-777777777777'
const unrelatedUserId = '88888888-8888-4888-8888-888888888888'
const idempotencyKey = '99999999-9999-4999-8999-999999999999'

describe('process handoff input', () => {
  it('normalizes a retry-safe request', () => {
    assert.deepEqual(parseProcessHandoffRequest({
      proposed_owner_user_id: proposedOwnerUserId.toUpperCase(),
      request_note: '  Przekaż klienta.  ',
      idempotency_key: idempotencyKey.toUpperCase(),
    }), {
      proposedOwnerUserId,
      requestNote: 'Przekaż klienta.',
      idempotencyKey,
    })
  })

  it('rejects missing, malformed and unsupported request fields', () => {
    assert.throws(() => parseProcessHandoffRequest({
      proposed_owner_user_id: proposedOwnerUserId,
      idempotency_key: idempotencyKey,
      organization_id: organizationId,
    }), /Unsupported field/)
    assert.throws(() => parseProcessHandoffRequest({
      proposed_owner_user_id: 'not-a-uuid',
      idempotency_key: idempotencyKey,
    }), /must be a UUID/)
    assert.throws(() => parseProcessHandoffRequest({
      proposed_owner_user_id: proposedOwnerUserId,
    }), /idempotency_key is required/)
  })

  it('parses response actions and an optional note strictly', () => {
    assert.deepEqual(parseProcessHandoffResponse({
      action: 'reject',
      response_note: '  Brak dostępności.  ',
    }), {
      action: 'reject',
      responseNote: 'Brak dostępności.',
    })
    assert.deepEqual(parseProcessHandoffResponse({ action: 'accept' }), {
      action: 'accept',
      responseNote: null,
    })
    assert.throws(
      () => parseProcessHandoffResponse({ action: 'reassign' }),
      /unsupported value/,
    )
    assert.throws(
      () => parseProcessHandoffResponse({ action: 'cancel', reason: 'unused' }),
      /Unsupported field/,
    )
  })
})

describe('process handoff idempotency', () => {
  const fingerprintInput = {
    organizationId,
    caseId,
    caseItemId,
    requestedByUserId: requesterUserId,
    proposedOwnerUserId,
    requestNote: 'Przekaż klienta.',
  }

  it('uses the agreed canonical SHA-256 fingerprint', () => {
    const fingerprint = processHandoffFingerprint(fingerprintInput)
    assert.equal(
      fingerprint,
      '1878a23443f25569bcc4d68900f4b024556161ce560c3fef782d9198de438c8e',
    )
    assert.equal(assertProcessHandoffFingerprint(fingerprint), fingerprint)
  })

  it('changes when a business field changes and rejects corrupt stored data', () => {
    assert.notEqual(
      processHandoffFingerprint(fingerprintInput),
      processHandoffFingerprint({ ...fingerprintInput, requestNote: null }),
    )
    assert.throws(
      () => assertProcessHandoffFingerprint('invalid'),
      /fingerprint is invalid/,
    )
  })
})

describe('process handoff permissions', () => {
  const crmCase = { owner_user_id: caseOwnerUserId }
  const process = { owner_user_id: processOwnerUserId }
  const handoff = {
    requested_by_user_id: requesterUserId,
    proposed_owner_user_id: proposedOwnerUserId,
  }

  it('allows only case owner, process owner or admin to request a handoff', () => {
    assert.equal(canHandoffProcess(
      { userId: caseOwnerUserId, role: 'expert' },
      crmCase,
      process,
    ), true)
    assert.equal(canHandoffProcess(
      { userId: processOwnerUserId, role: 'expert' },
      crmCase,
      process,
    ), true)
    assert.equal(canHandoffProcess(
      { userId: unrelatedUserId, role: 'admin' },
      crmCase,
      process,
    ), true)
    assert.equal(canHandoffProcess(
      { userId: unrelatedUserId, role: 'expert' },
      crmCase,
      process,
    ), false)
    assert.equal(canChangeProcessStatus(
      { userId: unrelatedUserId, role: 'expert' },
      crmCase,
      process,
    ), false)
  })

  it('reserves accept/reject for the proposed owner, including against admins', () => {
    assert.equal(canRespondToProcessHandoff(
      { userId: proposedOwnerUserId, role: 'expert' },
      handoff,
      'accept',
      crmCase,
      process,
    ), true)
    assert.equal(canRespondToProcessHandoff(
      { userId: unrelatedUserId, role: 'admin' },
      handoff,
      'reject',
      crmCase,
      process,
    ), false)
  })

  it('lets requester, owners or admin cancel but rejects unrelated experts', () => {
    for (const actor of [
      { userId: requesterUserId, role: 'expert' },
      { userId: caseOwnerUserId, role: 'expert' },
      { userId: processOwnerUserId, role: 'expert' },
      { userId: unrelatedUserId, role: 'admin' },
    ] as const) {
      assert.equal(
        canRespondToProcessHandoff(actor, handoff, 'cancel', crmCase, process),
        true,
      )
    }
    assert.equal(canRespondToProcessHandoff(
      { userId: unrelatedUserId, role: 'expert' },
      handoff,
      'cancel',
      crmCase,
      process,
    ), false)
  })

  it('maps response actions to terminal handoff statuses', () => {
    assert.equal(expectedProcessHandoffStatus('accept'), 'accepted')
    assert.equal(expectedProcessHandoffStatus('reject'), 'rejected')
    assert.equal(expectedProcessHandoffStatus('cancel'), 'cancelled')
  })
})
