import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { requireBankMailAgentCaller } from '../lib/caller.ts'
import { createBankMailServiceDataApiClient } from '../lib/data-api.ts'
import { callBankMailServiceRpc } from '../lib/rpc.ts'

const outcomeSchema = z.enum([
  'no_match',
  'not_bank_mail',
  'security_rejected',
  'needs_human_selection',
  'processing_failed',
])

const reasonCodeSchema = z.enum([
  'trusted_bank_identity',
  'unknown_bank_identity',
  'bank_identity_mismatch',
  'authentication_failed',
  'authentication_indeterminate',
  'dmarc_not_aligned',
  'reply_to_mismatch',
  'bank_application_reference',
  'applicant_identity',
  'expert_identity',
  'bank_identity',
  'case_context',
  'application_status',
  'attachment_metadata',
  'no_candidate',
  'no_matching_signal',
  'multiple_candidates',
  'bank_mismatch',
  'reference_mismatch',
  'owner_mismatch',
  'stale_application',
  'weak_evidence',
  'attachment_unavailable',
  'prompt_injection_suspected',
  'not_bank_message',
  'unsafe_attachment',
  'processing_error',
  'human_review_required',
  'policy_requires_review',
])

export default defineTool({
  description: 'Idempotently finish the trusted intake without creating a match proposal. Use it when there is no candidate, the mail is not from a configured bank, sender security failed, multiple candidates require a person, or processing cannot safely continue. It does not mutate any CRM case or attachment.',
  inputSchema: z.object({
    outcome: outcomeSchema,
    reasonCodes: z.array(reasonCodeSchema).min(1).max(12),
  }).strict(),
  async execute({ outcome, reasonCodes }, ctx) {
    const caller = requireBankMailAgentCaller(ctx)
    const normalizedReasonCodes = [...new Set(reasonCodes)].sort()
    await callBankMailServiceRpc(
      createBankMailServiceDataApiClient(),
      'finalize_bank_mail_agent_intake',
      {
        p_intake_id: caller.intakeId,
        p_analysis_run_id: caller.analysisRunId,
        p_outcome: outcome,
        p_reason_codes: normalizedReasonCodes,
      },
    )

    return {
      finalized: true,
      outcome,
      reasonCodes: normalizedReasonCodes,
    }
  },
})
