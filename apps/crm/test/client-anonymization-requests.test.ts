import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canCreateClientAnonymizationRequest,
  parseClientAnonymizationRequestCreateInput,
  throwClientAnonymizationRequestDbError,
} from '../server/utils/client-anonymization-requests.ts'

const now = new Date('2026-07-30T12:00:00.000Z')
const subjectPersonId = '11111111-1111-4111-8111-111111111111'
const idempotencyKey = '22222222-2222-4222-8222-222222222222'

function validInput() {
  return {
    subjectPersonId,
    requestChannel: 'email',
    requestedAt: '2026-07-30T13:30:00+02:00',
    justification:
      'Klient zażądał usunięcia danych po zakończeniu prowadzonej obsługi.',
    idempotencyKey,
  }
}

function assertBadRequest(
  callback: () => unknown,
  message: RegExp,
): void {
  assert.throws(callback, (error: unknown) => {
    const candidate = error as {
      statusCode?: number
      statusMessage?: string
      message?: string
    }
    assert.equal(candidate.statusCode, 400)
    assert.match(candidate.statusMessage ?? candidate.message ?? '', message)
    return true
  })
}

describe('client anonymization request input', () => {
  it('normalizes the strict request payload', () => {
    assert.deepEqual(
      parseClientAnonymizationRequestCreateInput(validInput(), now),
      {
        subjectPersonId,
        requestChannel: 'email',
        requestedAt: '2026-07-30T11:30:00.000Z',
        justification:
          'Klient zażądał usunięcia danych po zakończeniu prowadzonej obsługi.',
        idempotencyKey,
      },
    )
  })

  it('rejects unknown fields and unsupported channels', () => {
    assertBadRequest(
      () => parseClientAnonymizationRequestCreateInput({
        ...validInput(),
        status: 'approved',
      }, now),
      /status/,
    )
    assertBadRequest(
      () => parseClientAnonymizationRequestCreateInput({
        ...validInput(),
        requestChannel: 'chat',
      }, now),
      /requestChannel/,
    )
  })

  it('validates UUIDs and timezone-aware request dates', () => {
    assertBadRequest(
      () => parseClientAnonymizationRequestCreateInput({
        ...validInput(),
        subjectPersonId: 'primary-person',
      }, now),
      /subjectPersonId must be a UUID/,
    )
    assertBadRequest(
      () => parseClientAnonymizationRequestCreateInput({
        ...validInput(),
        requestedAt: '2026-07-30T11:30:00',
      }, now),
      /timezone offset/,
    )
  })

  it('allows clock skew but rejects a genuinely future timestamp', () => {
    assert.equal(
      parseClientAnonymizationRequestCreateInput({
        ...validInput(),
        requestedAt: '2026-07-30T12:05:00Z',
      }, now).requestedAt,
      '2026-07-30T12:05:00.000Z',
    )
    assertBadRequest(
      () => parseClientAnonymizationRequestCreateInput({
        ...validInput(),
        requestedAt: '2026-07-30T12:05:00.001Z',
      }, now),
      /must not be in the future/,
    )
  })

  it('enforces an auditable description between 20 and 2000 characters', () => {
    assertBadRequest(
      () => parseClientAnonymizationRequestCreateInput({
        ...validInput(),
        justification: 'Za krótki opis',
      }, now),
      /at least 20/,
    )
    assertBadRequest(
      () => parseClientAnonymizationRequestCreateInput({
        ...validInput(),
        justification: 'x'.repeat(2_001),
      }, now),
      /at most 2000/,
    )
  })
})

describe('client anonymization request authorization', () => {
  const base = {
    currentUserId: '33333333-3333-4333-8333-333333333333',
    ownerUserId: '44444444-4444-4444-8444-444444444444',
    hasCreatePermission: false,
    clientStatus: 'active',
  }

  it('allows the assigned client owner', () => {
    assert.equal(canCreateClientAnonymizationRequest({
      ...base,
      ownerUserId: base.currentUserId,
    }), true)
  })

  it('allows a member with the explicit privacy permission', () => {
    assert.equal(canCreateClientAnonymizationRequest({
      ...base,
      hasCreatePermission: true,
    }), true)
  })

  it('denies unrelated members and already anonymized clients', () => {
    assert.equal(canCreateClientAnonymizationRequest(base), false)
    assert.equal(canCreateClientAnonymizationRequest({
      ...base,
      ownerUserId: base.currentUserId,
      hasCreatePermission: true,
      clientStatus: 'anonymized',
    }), false)
  })
})

describe('client anonymization request database errors', () => {
  it('maps the active-client uniqueness guard to a stable conflict', () => {
    assert.throws(
      () => throwClientAnonymizationRequestDbError({
        code: '23505',
        constraint:
          'crm_client_anonymization_requests_one_active_client_idx',
      }),
      (error: unknown) => {
        const candidate = error as {
          statusCode?: number
          data?: { code?: string }
        }
        assert.equal(candidate.statusCode, 409)
        assert.equal(
          candidate.data?.code,
          'anonymization_request_active_request_exists',
        )
        return true
      },
    )
  })
})
