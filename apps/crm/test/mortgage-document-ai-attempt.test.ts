import assert from 'node:assert/strict'
import test from 'node:test'
import {
  claimMortgageDocumentAiAttempt,
  completeMortgageDocumentAiAttempt,
  mortgageDocumentValidationPiiFreeObservations,
  parseMortgageDocumentAiAttempt,
  runOrReplayMortgageDocumentAiAttempt,
  type MortgageDocumentAiAttemptScope,
} from '../server/utils/mortgage-document-ai-attempt.ts'
import type { MortgageDocumentValidationResult } from '../server/utils/mortgage-document-ai-validation.ts'

const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const leaseToken = '1'.repeat(64)
const sha = (character: string) => character.repeat(64)
const completedAt = '2026-08-14T13:00:00.000Z'
const observations = {
  checks: {
    content: 'match',
    kind: 'match',
    bank: 'match',
    applicants: 'match',
    decisionOutcome: 'not_applicable',
    validUntil: 'match',
    loanAmount: 'match',
    requiredSections: 'match',
  },
  expectedApplicantCount: 2,
  matchedApplicantCount: 2,
  missingSignalCodes: [],
  anomalyCodes: [],
}
const accepted: MortgageDocumentValidationResult = {
  verdict: 'accepted',
  reasonCodes: [],
  safeSummary: 'Dokument przeszedł automatyczną walidację strukturalną.',
  confidence: 0.97,
  ...observations,
  provider: 'vercel-ai-gateway',
  model: 'gemini-3.5-flash-lite',
  promptVersion: 'mortgage-document-validation-v1',
}
const scope: MortgageDocumentAiAttemptScope = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  caseId: '22222222-2222-4222-8222-222222222222',
  applicationId: '33333333-3333-4333-8333-333333333333',
  actorUserId: '44444444-4444-4444-8444-444444444444',
  kind: 'esis',
  sourceSha256: sha('a'),
  applicantContextSha256: sha('b'),
  bankContextSha256: sha('c'),
  expectationSha256: sha('d'),
  decisionOutcome: null,
  validUntil: '2026-09-30T21:59:00.000Z',
}

test('parses claimed, in-progress and completed AI attempts without PII', () => {
  assert.deepEqual(parseMortgageDocumentAiAttempt({
    attemptId,
    state: 'claimed',
    leaseToken,
    leaseExpiresAt: '2026-08-14T13:02:00.000Z',
  }), {
    attemptId,
    state: 'claimed',
    leaseToken,
    leaseExpiresAt: '2026-08-14T13:02:00.000Z',
  })
  assert.equal(parseMortgageDocumentAiAttempt({
    attemptId,
    state: 'in_progress',
    leaseExpiresAt: '2026-08-14T13:02:00.000Z',
  }).state, 'in_progress')

  const completed = parseMortgageDocumentAiAttempt({
    attemptId,
    state: 'completed',
    verdict: 'accepted',
    confidence: '0.9700',
    reasonCodes: [],
    piiFreeObservations: observations,
    completedAt,
  })
  assert.equal(completed.state, 'completed')
  assert.deepEqual(completed.state === 'completed' ? completed.validation : null, accepted)
  assert.equal(JSON.stringify(completed).includes('Kowalski'), false)
})

test('rejects malformed or PII-bearing completed attempt payloads', () => {
  assert.throws(() => parseMortgageDocumentAiAttempt({
    attemptId,
    state: 'completed',
    verdict: 'accepted',
    confidence: 0.97,
    reasonCodes: [],
    piiFreeObservations: { ...observations, applicantName: 'Jan Kowalski' },
    completedAt,
  }), /invalid/)
  assert.throws(() => parseMortgageDocumentAiAttempt({
    attemptId,
    state: 'completed',
    verdict: 'accepted',
    confidence: 0.97,
    reasonCodes: ['not-a-controlled-code'],
    piiFreeObservations: observations,
    completedAt,
  }), /invalid/)
})

test('claims with exact source and opaque authoritative context hashes', async () => {
  let call: { name: string, args: Record<string, unknown> } | undefined
  const result = await claimMortgageDocumentAiAttempt({
    async rpc(name, args) {
      call = { name, args }
      return {
        data: {
          attemptId,
          state: 'claimed',
          leaseToken,
          leaseExpiresAt: '2026-08-14T13:02:00.000Z',
        },
        error: null,
      }
    },
  }, scope)
  assert.equal(result.state, 'claimed')
  assert.deepEqual(call, {
    name: 'claim_crm_mortgage_document_ai_attempt',
    args: {
      p_organization_id: scope.organizationId,
      p_case_id: scope.caseId,
      p_application_id: scope.applicationId,
      p_actor_user_id: scope.actorUserId,
      p_expected_kind: 'esis',
      p_source_sha256: scope.sourceSha256,
      p_applicant_context_sha256: scope.applicantContextSha256,
      p_bank_context_sha256: scope.bankContextSha256,
      p_expectation_sha256: scope.expectationSha256,
      p_provider: 'vercel-ai-gateway',
      p_model: 'gemini-3.5-flash-lite',
      p_prompt_version: 'mortgage-document-validation-v1',
      p_decision_outcome: null,
      p_valid_until: scope.validUntil,
    },
  })
})

test('completes once and reconciles a lost response from the durable attempt', async () => {
  const calls: string[] = []
  const result = await completeMortgageDocumentAiAttempt({
    async rpc(name, args) {
      calls.push(name)
      if (name === 'complete_crm_mortgage_document_ai_attempt') {
        assert.deepEqual(args.p_pii_free_observations, mortgageDocumentValidationPiiFreeObservations(accepted))
        return { data: null, error: { message: 'connection lost' } }
      }
      return {
        data: {
          attemptId,
          state: 'completed',
          verdict: 'accepted',
          confidence: 0.97,
          reasonCodes: [],
          piiFreeObservations: observations,
          completedAt,
        },
        error: null,
      }
    },
  }, scope, {
    attemptId,
    state: 'claimed',
    leaseToken,
    leaseExpiresAt: '2026-08-14T13:02:00.000Z',
  }, accepted)
  assert.equal(result.validation.verdict, 'accepted')
  assert.deepEqual(calls, [
    'complete_crm_mortgage_document_ai_attempt',
    'claim_crm_mortgage_document_ai_attempt',
  ])
})

test('a completed negative attempt is replayed without calling the model again', async () => {
  let analyzeCalls = 0
  const result = await runOrReplayMortgageDocumentAiAttempt({
    async rpc(name) {
      assert.equal(name, 'claim_crm_mortgage_document_ai_attempt')
      return {
        data: {
          attemptId,
          state: 'completed',
          verdict: 'rejected',
          confidence: 0.99,
          reasonCodes: ['wrong_document_kind'],
          piiFreeObservations: {
            ...observations,
            checks: { ...observations.checks, kind: 'mismatch' },
          },
          completedAt,
        },
        error: null,
      }
    },
  }, scope, async () => {
    analyzeCalls += 1
    return accepted
  })
  assert.equal(result.state, 'completed')
  assert.equal(result.state === 'completed' ? result.validation.verdict : null, 'rejected')
  assert.equal(analyzeCalls, 0)
})
