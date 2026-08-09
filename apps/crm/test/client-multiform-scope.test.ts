import assert from 'node:assert/strict'
import test from 'node:test'
import {
  invalidClientMultiformFieldKeys,
  mergeOwnedClientMultiformValues,
  sanitizeClientMultiformField,
  verifiedClientMultiformLinks,
} from '../server/utils/client-multiform-scope.ts'

test('accepts only an active email proof belonging to the authenticated identity', () => {
  const rows = [
    {
      organization_id: 'org-1',
      client_id: 'client-1',
      client_person_id: 'person-1',
      verification_method: 'email',
      verified_contact_normalized: 'client@example.com',
    },
    {
      organization_id: 'org-2',
      client_id: 'client-2',
      client_person_id: 'person-2',
      verification_method: 'email',
      verified_contact_normalized: 'attacker@example.com',
    },
    {
      organization_id: 'org-3',
      client_id: 'client-3',
      client_person_id: 'person-3',
      verification_method: 'phone',
      verified_contact_normalized: 'client@example.com',
    },
    {
      organization_id: 'org-4',
      client_id: 'client-4',
      client_person_id: 'person-4',
      verification_method: 'email',
      verified_contact_normalized: ' client@example.com ',
    },
  ]

  assert.deepEqual(
    verifiedClientMultiformLinks(' Client@Example.com ', true, rows),
    [{
      organizationId: 'org-1',
      clientId: 'client-1',
      clientPersonId: 'person-1',
      verifiedEmail: 'client@example.com',
    }],
  )
  assert.deepEqual(verifiedClientMultiformLinks('client@example.com', false, rows), [])
})

test('keeps client-owned conditions without exposing external condition values', () => {
  const ownCondition = {
    canonicalKey: 'applicants.0.incomeSource',
    equals: 'business',
  }
  const ownField = sanitizeClientMultiformField({
    key: 'applicants.0.businessName',
    visibleWhen: ownCondition,
  }, 'applicants.0.', {})
  assert.deepEqual(ownField?.visibleWhen, ownCondition)

  const externalField = sanitizeClientMultiformField({
    key: 'applicants.0.firstName',
    visibleWhen: { canonicalKey: 'loan.program', equals: 'standard' },
  }, 'applicants.0.', { 'loan.program': 'standard' })
  assert.equal(externalField?.visibleWhen, undefined)

  assert.equal(sanitizeClientMultiformField({
    key: 'applicants.0.firstName',
    visibleWhen: { canonicalKey: 'loan.program', equals: 'rkm' },
  }, 'applicants.0.', { 'loan.program': 'standard' }), null)
})

test('merges only the applicant field allowlist and preserves all other draft values', () => {
  const current = {
    'applicants.0.firstName': 'Jan',
    'applicants.1.firstName': 'Anna',
    'loan.amount': 700_000,
  }
  const allowed = new Set(['applicants.0.firstName'])

  assert.deepEqual(
    mergeOwnedClientMultiformValues(current, { 'applicants.0.firstName': 'Janusz' }, allowed),
    {
      values: {
        'applicants.0.firstName': 'Janusz',
        'applicants.1.firstName': 'Anna',
        'loan.amount': 700_000,
      },
      unknownKey: null,
    },
  )
  assert.deepEqual(
    mergeOwnedClientMultiformValues(current, { 'applicants.1.firstName': 'Atak' }, allowed),
    { values: current, unknownKey: 'applicants.1.firstName' },
  )
})

test('validates required and conditional fields before marking the client form complete', () => {
  const fields = [
    { key: 'applicants.0.firstName', type: 'text', required: true },
    {
      key: 'applicants.0.businessNip',
      type: 'text',
      required: true,
      visibleWhen: { canonicalKey: 'applicants.0.incomeSource', equals: 'business' },
      validation: { pattern: '^\\d{10}$' },
    },
  ]
  assert.deepEqual(invalidClientMultiformFieldKeys(fields, {
    'applicants.0.firstName': '',
    'applicants.0.incomeSource': 'employment',
  }), ['applicants.0.firstName'])
  assert.deepEqual(invalidClientMultiformFieldKeys(fields, {
    'applicants.0.firstName': 'Jan',
    'applicants.0.incomeSource': 'business',
    'applicants.0.businessNip': '123',
  }), ['applicants.0.businessNip'])
})
