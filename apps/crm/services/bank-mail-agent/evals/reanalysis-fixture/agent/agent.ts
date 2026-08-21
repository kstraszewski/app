import { defineAgent } from 'eve'
import { mockModel, type MockModelRequest } from 'eve/evals'

const caseId = '11111111-1111-4111-8111-111111111111'
const applicationId = '22222222-2222-4222-8222-222222222222'

function hasResult(request: MockModelRequest, toolName: string): boolean {
  return request.toolResults.some(result => result.name === toolName)
}

export default defineAgent({
  model: mockModel({
    modelId: 'bank-mail-reanalysis-policy-fixture',
    provider: 'openexpert-evals',
    respond(request) {
      if (!hasResult(request, 'load_trusted_intake_metadata')) {
        return {
          toolCalls: [{
            id: 'load-terminal-intake',
            name: 'load_trusted_intake_metadata',
            input: {},
          }],
        }
      }
      if (!hasResult(request, 'search_case_candidates')) {
        return {
          toolCalls: [{
            id: 'search-reanalysis-candidate',
            name: 'search_case_candidates',
            input: { query: 'ABC-2026-0042', limit: 5 },
          }],
        }
      }
      if (!hasResult(request, 'get_case_match_context')) {
        return {
          toolCalls: [{
            id: 'load-reanalysis-context',
            name: 'get_case_match_context',
            input: { caseId },
          }],
        }
      }
      if (!hasResult(request, 'record_reanalysis_result')) {
        return {
          toolCalls: [{
            id: 'record-advisory-result',
            name: 'record_reanalysis_result',
            input: {
              resultCode: 'review_required',
              classification: 'strong_candidate',
              caseId,
              applicationId,
              evidenceCodes: ['bank_identity', 'bank_application_reference'],
              contradictionCodes: [],
              reasonCodes: ['policy_requires_review'],
            },
          }],
        }
      }
      return 'review_required: advisory_only'
    },
  }),
  modelContextWindowTokens: 32_000,
  limits: {
    maxInputTokensPerSession: 8_000,
    maxOutputTokensPerSession: 2_000,
    sessionTimeoutMs: 30_000,
  },
})
