import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  administrativeAccessDbConflict,
  administrativeRoleIds,
  parseAdministrativeAccessPutInput,
  parseAnonymizationGrantApproveInput,
  parseAnonymizationGrantCreateInput,
  parseAnonymizationGrantRejectInput,
  parseAnonymizationGrantRevokeInput,
} from '../server/utils/administrative-access.ts'

const now = new Date('2026-07-29T10:00:00.000Z')
const requestId = '11111111-1111-4111-8111-111111111111'
const approverUserId = '22222222-2222-4222-8222-222222222222'
const idempotencyKey = '33333333-3333-4333-8333-333333333333'

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

describe('administrative access roles and PUT input', () => {
  it('exports the complete stable role catalogue', () => {
    assert.deepEqual(administrativeRoleIds, [
      'organization_admin',
      'access_admin',
      'structure_admin',
      'consents_admin',
      'crm_config_admin',
    ])
  })

  it('normalizes a strict administrative-access replacement', () => {
    assert.deepEqual(
      parseAdministrativeAccessPutInput({
        expectedRevision: 7,
        idempotencyKey: idempotencyKey.toUpperCase(),
        roles: ['consents_admin', 'organization_admin', 'access_admin'],
        consentPublishingGrant: {
          justification: '  Publikacja po akceptacji compliance.  ',
          expiresAt: '2026-08-31T23:59:59+02:00',
        },
        changeReason: '  Zmiana zakresu odpowiedzialności.  ',
      }, now),
      {
        expectedRevision: 7,
        idempotencyKey,
        roles: [
          'organization_admin',
          'access_admin',
          'consents_admin',
        ],
        consentPublishingGrant: {
          justification: 'Publikacja po akceptacji compliance.',
          expiresAt: '2026-08-31T21:59:59.000Z',
        },
        changeReason: 'Zmiana zakresu odpowiedzialności.',
      },
    )
  })

  it('allows revoking every role and direct consent grant', () => {
    const parsed = parseAdministrativeAccessPutInput({
      expectedRevision: 0,
      idempotencyKey,
      roles: [],
      consentPublishingGrant: null,
      changeReason: 'Odebranie całego dostępu administracyjnego.',
    }, now)

    assert.deepEqual(parsed.roles, [])
    assert.equal(parsed.consentPublishingGrant, null)
  })

  it('rejects duplicate and unsupported roles', () => {
    const base = {
      expectedRevision: 1,
      idempotencyKey,
      consentPublishingGrant: null,
      changeReason: 'Aktualizacja zakresu uprawnień.',
    }
    assertBadRequest(
      () => parseAdministrativeAccessPutInput({
        ...base,
        roles: ['access_admin', 'access_admin'],
      }, now),
      /duplicates/,
    )
    assertBadRequest(
      () => parseAdministrativeAccessPutInput({
        ...base,
        roles: ['super_admin'],
      }, now),
      /unsupported value/,
    )
  })

  it('rejects unknown fields at the root and inside a consent grant', () => {
    const base = {
      expectedRevision: 1,
      idempotencyKey,
      roles: ['access_admin'],
      changeReason: 'Aktualizacja zakresu uprawnień.',
    }
    assertBadRequest(
      () => parseAdministrativeAccessPutInput({
        ...base,
        consentPublishingGrant: null,
        actorUserId: approverUserId,
      }, now),
      /actorUserId/,
    )
    assertBadRequest(
      () => parseAdministrativeAccessPutInput({
        ...base,
        consentPublishingGrant: {
          justification: 'Uzasadnienie wyjątku.',
          expiresAt: '2026-07-30T08:00:00Z',
          status: 'active',
        },
      }, now),
      /consentPublishingGrant.*status/,
    )
  })

  it('validates revision, UUID, reason and consent-grant lifetime', () => {
    const base = {
      expectedRevision: 1,
      idempotencyKey,
      roles: ['access_admin'],
      consentPublishingGrant: null,
      changeReason: 'Aktualizacja zakresu uprawnień.',
    }
    assertBadRequest(
      () => parseAdministrativeAccessPutInput({
        ...base,
        expectedRevision: 1.5,
      }, now),
      /non-negative safe integer/,
    )
    assertBadRequest(
      () => parseAdministrativeAccessPutInput({
        ...base,
        idempotencyKey: 'retry-me',
      }, now),
      /must be a UUID/,
    )
    assertBadRequest(
      () => parseAdministrativeAccessPutInput({
        ...base,
        changeReason: 'Za krótko',
      }, now),
      /at least 10/,
    )
    assertBadRequest(
      () => parseAdministrativeAccessPutInput({
        ...base,
        consentPublishingGrant: {
          justification: 'Za krótko',
          expiresAt: '2026-07-30T08:00:00Z',
        },
      }, now),
      /justification.*at least 10/,
    )
    assertBadRequest(
      () => parseAdministrativeAccessPutInput({
        ...base,
        consentPublishingGrant: {
          justification: 'Wystarczające uzasadnienie.',
          expiresAt: '2026-07-29T09:59:59Z',
        },
      }, now),
      /expiresAt must be in the future/,
    )
  })
})

describe('anonymization grant input', () => {
  it('normalizes a grant request up to exactly 24 hours', () => {
    assert.deepEqual(
      parseAnonymizationGrantCreateInput({
        requestId: requestId.toUpperCase(),
        approverUserId,
        justification: '  Potwierdzone żądanie klienta wymaga wykonania.  ',
        expiresAt: '2026-07-30T12:00:00+02:00',
        idempotencyKey,
      }, now),
      {
        requestId,
        approverUserId,
        justification: 'Potwierdzone żądanie klienta wymaga wykonania.',
        expiresAt: '2026-07-30T10:00:00.000Z',
        idempotencyKey,
      },
    )
  })

  it('rejects short justification, invalid UUID and a lifetime over 24 hours', () => {
    const base = {
      requestId,
      approverUserId,
      justification: 'Potwierdzone żądanie klienta wymaga wykonania.',
      expiresAt: '2026-07-30T09:59:59Z',
      idempotencyKey,
    }
    assertBadRequest(
      () => parseAnonymizationGrantCreateInput({
        ...base,
        justification: 'Za krótkie',
      }, now),
      /justification.*at least 20/,
    )
    assertBadRequest(
      () => parseAnonymizationGrantCreateInput({
        ...base,
        approverUserId: 'marta-wojcik',
      }, now),
      /approverUserId must be a UUID/,
    )
    assertBadRequest(
      () => parseAnonymizationGrantCreateInput({
        ...base,
        expiresAt: '2026-07-30T10:00:00.001Z',
      }, now),
      /not be more than 24 hours/,
    )
  })

  it('requires unambiguous timestamps and rejects unknown fields', () => {
    const base = {
      requestId,
      approverUserId,
      justification: 'Potwierdzone żądanie klienta wymaga wykonania.',
      expiresAt: '2026-07-30T08:00:00Z',
      idempotencyKey,
    }
    assertBadRequest(
      () => parseAnonymizationGrantCreateInput({
        ...base,
        expiresAt: '2026-07-30T08:00:00',
      }, now),
      /timezone offset/,
    )
    assertBadRequest(
      () => parseAnonymizationGrantCreateInput({
        ...base,
        permissionKey: 'clients.anonymization.execute',
      }, now),
      /permissionKey/,
    )
  })

  it('parses approval and requires auditable reasons for rejection and revocation', () => {
    assert.deepEqual(
      parseAnonymizationGrantApproveInput({
        expectedRevision: 1,
        idempotencyKey,
      }),
      {
        expectedRevision: 1,
        idempotencyKey,
        reason: null,
      },
    )
    assert.deepEqual(
      parseAnonymizationGrantApproveInput({
        expectedRevision: 1,
        idempotencyKey,
        reason: '  Zakres został zweryfikowany.  ',
      }),
      {
        expectedRevision: 1,
        idempotencyKey,
        reason: 'Zakres został zweryfikowany.',
      },
    )
    assert.equal(
      parseAnonymizationGrantRejectInput({
        expectedRevision: 1,
        idempotencyKey,
        reason: 'Żądanie nie ma potwierdzonej tożsamości.',
      }).reason,
      'Żądanie nie ma potwierdzonej tożsamości.',
    )
    assert.equal(
      parseAnonymizationGrantRevokeInput({
        expectedRevision: 2,
        idempotencyKey,
        reason: 'Operacja nie jest już potrzebna.',
      }).reason,
      'Operacja nie jest już potrzebna.',
    )
    assertBadRequest(
      () => parseAnonymizationGrantRejectInput({
        expectedRevision: 1,
        idempotencyKey,
      }),
      /reason must be text/,
    )
    assertBadRequest(
      () => parseAnonymizationGrantRevokeInput({
        expectedRevision: 2,
        idempotencyKey,
        reason: 'Za krótko',
      }),
      /reason.*at least 10/,
    )
  })

  it('keeps lifecycle commands strict and revision-safe', () => {
    assertBadRequest(
      () => parseAnonymizationGrantApproveInput({
        expectedRevision: -1,
        idempotencyKey,
      }),
      /non-negative safe integer/,
    )
    assertBadRequest(
      () => parseAnonymizationGrantApproveInput({
        expectedRevision: 1,
        idempotencyKey,
        status: 'active',
      }),
      /status/,
    )
  })
})

describe('administrative access database conflict mapping', () => {
  it('maps serialization and named revision conflicts', () => {
    assert.deepEqual(
      administrativeAccessDbConflict({
        code: '40001',
        message: 'could not serialize access due to concurrent update',
      }),
      {
        code: 'administrative_access_revision_conflict',
        statusCode: 409,
        statusMessage: 'Administrative access changed in another session.',
      },
    )
    assert.equal(
      administrativeAccessDbConflict({
        code: 'P0001',
        message: 'administrative_access_revision_conflict',
      })?.code,
      'administrative_access_revision_conflict',
    )
  })

  it('maps only idempotency-related unique conflicts', () => {
    assert.equal(
      administrativeAccessDbConflict({
        code: '23505',
        constraint: 'organization_user_access_commands_idempotency_key',
        message: 'duplicate key value violates unique constraint',
      })?.code,
      'administrative_access_idempotency_conflict',
    )
    assert.equal(
      administrativeAccessDbConflict({
        code: 'P0001',
        message: 'anonymization_grant_idempotency_key_reused',
      })?.code,
      'administrative_access_idempotency_conflict',
    )
    assert.equal(
      administrativeAccessDbConflict({
        code: '23505',
        constraint: 'organization_user_admin_roles_pkey',
      }),
      null,
    )
  })

  it('returns null for unrelated database failures', () => {
    assert.equal(
      administrativeAccessDbConflict({
        code: '42501',
        message: 'organization admin required',
      }),
      null,
    )
    assert.equal(administrativeAccessDbConflict(null), null)
  })
})
