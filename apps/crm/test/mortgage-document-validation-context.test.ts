import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadMortgageDocumentValidationContext,
  parseMortgageDocumentValidationContext,
} from '../server/utils/mortgage-document-validation-context.ts'

const sha = (character: string) => character.repeat(64)

test('parses the opaque authoritative ESIS validation context', () => {
  const result = parseMortgageDocumentValidationContext({
    kind: 'esis',
    bankId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    offerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    bankName: 'Bank Testowy',
    bankAliases: ['Bank Testowy', 'bank-testowy'],
    applicants: [
      { clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', displayName: 'Jan Kowalski' },
      { clientId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', displayName: 'Anna Kowalska' },
    ],
    applicantContextSha256: sha('a'),
    bankContextSha256: sha('b'),
    expectationSha256: sha('c'),
    validUntil: '2026-09-30T21:59:00+00:00',
    loanAmount: 500_000,
    currency: 'PLN',
  }, 'esis')

  assert.deepEqual(result.expectation, {
    kind: 'esis',
    bankName: 'Bank Testowy',
    bankAliases: ['Bank Testowy', 'bank-testowy'],
    applicantNames: ['Jan Kowalski', 'Anna Kowalska'],
    validUntil: '2026-09-30T21:59:00+00:00',
    loanAmount: 500_000,
    currency: 'PLN',
  })
  assert.equal(result.applicantContextSha256, sha('a'))
  assert.equal(result.expectationSha256, sha('c'))
})

test('parses a credit decision and rejects inconsistent DB context', () => {
  const base = {
    kind: 'credit_decision',
    bankId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    offerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    bankName: 'Bank Testowy',
    bankAliases: [],
    applicants: [{
      clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      displayName: 'Jan Kowalski',
    }],
    applicantContextSha256: sha('a'),
    bankContextSha256: sha('b'),
    expectationSha256: sha('c'),
    decisionOutcome: 'negative',
  }
  const result = parseMortgageDocumentValidationContext(base, 'credit_decision')
  assert.equal(result.expectation.decisionOutcome, 'negative')
  assert.equal(result.loanAmount, null)

  assert.throws(
    () => parseMortgageDocumentValidationContext({ ...base, expectationSha256: 'not-a-hash' }, 'credit_decision'),
    /expectationSha256/,
  )
  assert.throws(
    () => parseMortgageDocumentValidationContext({ ...base, applicants: [] }, 'credit_decision'),
    /applicants/,
  )
  assert.throws(
    () => parseMortgageDocumentValidationContext({ ...base, loanAmount: 1, currency: 'PLN' }, 'credit_decision'),
    /loanAmount\/currency/,
  )
})

test('loads the context only through the service RPC with exact expectation facts', async () => {
  let call: { name: string, args: Record<string, unknown> } | undefined
  const context = {
    kind: 'credit_decision',
    bankId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    offerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    bankName: 'Bank Testowy',
    bankAliases: ['Bank Testowy'],
    applicants: [{
      clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      displayName: 'Jan Kowalski',
    }],
    applicantContextSha256: sha('a'),
    bankContextSha256: sha('b'),
    expectationSha256: sha('c'),
    decisionOutcome: 'positive',
    validUntil: '2026-09-30T21:59:00+00:00',
  }
  const result = await loadMortgageDocumentValidationContext({
    async rpc(name, args) {
      call = { name, args }
      return { data: context, error: null }
    },
  },
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  'credit_decision',
  { decisionOutcome: 'positive', validUntil: '2026-09-30T21:59:00.000Z' })

  assert.equal(result.bankId, context.bankId)
  assert.deepEqual(call, {
    name: 'get_crm_mortgage_document_validation_context',
    args: {
      p_organization_id: '11111111-1111-4111-8111-111111111111',
      p_case_id: '22222222-2222-4222-8222-222222222222',
      p_application_id: '33333333-3333-4333-8333-333333333333',
      p_expected_kind: 'credit_decision',
      p_decision_outcome: 'positive',
      p_valid_until: '2026-09-30T21:59:00.000Z',
    },
  })
})
