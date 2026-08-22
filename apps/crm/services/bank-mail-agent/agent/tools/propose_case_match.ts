import {
  BankMailProposalEvidenceSchema,
  reduceBankMailProposal,
} from '@openexpert/crm-agent-capabilities'
import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { requireInitialBankMailAgentCaller } from '../lib/caller.ts'
import { createBankMailServiceDataApiClient } from '../lib/data-api.ts'
import { callBankMailServiceRpc } from '../lib/rpc.ts'

const inputSchema = z.object({
  caseId: z.string().uuid()
    .describe('Exact candidate case UUID returned by search_case_candidates.'),
  applicationId: z.string().uuid()
    .describe('Exact application UUID returned inside that candidate.'),
  evidence: BankMailProposalEvidenceSchema,
}).strict()

const contradictionMap = {
  bank_mismatch: 'bank_mismatch',
  case_scope_conflict: 'owner_mismatch',
  external_reference_conflict: 'reference_mismatch',
} as const

function finalizationReasonCode(code: string): string {
  if (code === 'external_reference_conflict') return 'reference_mismatch'
  if (code === 'case_scope_conflict') return 'owner_mismatch'
  if (code === 'sender_identity_failed') return 'authentication_failed'
  return code
}

export default defineTool({
  description: 'Record an idempotent, human-review-only proposal for one exact case/application candidate. The RPC re-checks mailbox ownership and application membership from trusted intake scope. This tool cannot attach a file, change an application, or raise the action ceiling above review_required.',
  inputSchema,
  async execute({ caseId, applicationId, evidence: rawEvidence }, ctx) {
    const caller = requireInitialBankMailAgentCaller(ctx)
    const evidence = BankMailProposalEvidenceSchema.parse(rawEvidence)
    const policy = reduceBankMailProposal(evidence)
    if (policy.decision !== 'review_required') {
      return {
        proposalRecorded: false,
        decision: policy.decision,
        eligibleForAutomaticAttach: false,
        reasonCodes: policy.reasonCodes.map(finalizationReasonCode),
        nextAction: 'Call finalize_intake with a matching terminal outcome.',
      }
    }

    const evidenceCodes = new Set<string>(['case_context', 'application_status'])
    if (evidence.senderIdentity === 'verified') evidenceCodes.add('bank_identity')
    if (evidence.externalReferenceMatch !== 'none') {
      evidenceCodes.add('bank_application_reference')
    }
    if (evidence.applicantNameMatch !== 'none') evidenceCodes.add('applicant_identity')

    const contradictionCodes = new Set<string>()
    for (const contradiction of evidence.contradictions) {
      const mapped = contradictionMap[contradiction as keyof typeof contradictionMap]
      if (mapped) contradictionCodes.add(mapped)
    }
    if (
      evidence.candidateCount !== 1
      || evidence.externalReferenceMatch === 'exact_ambiguous'
    ) contradictionCodes.add('multiple_candidates')
    if (policy.evidenceStrength !== 'strong') contradictionCodes.add('weak_evidence')

    const strongCandidate = (
      policy.evidenceStrength === 'strong'
      && evidence.senderIdentity === 'verified'
      && evidence.candidateCount === 1
      && contradictionCodes.size === 0
    )

    await callBankMailServiceRpc(
      createBankMailServiceDataApiClient(),
      'propose_bank_mail_case_match',
      {
        p_intake_id: caller.intakeId,
        p_analysis_run_id: caller.analysisRunId,
        p_case_id: caseId,
        p_application_id: applicationId,
        p_classification: strongCandidate ? 'strong_candidate' : 'ambiguous_candidate',
        p_evidence_codes: [...evidenceCodes].sort(),
        p_contradiction_codes: [...contradictionCodes].sort(),
      },
    )

    return {
      proposalRecorded: true,
      classification: strongCandidate ? 'strong_candidate' : 'ambiguous_candidate',
      reviewStatus: 'review_required',
      eligibleForAutomaticAttach: false,
      policyVersion: policy.policyVersion,
      reasonCodes: policy.reasonCodes,
    }
  },
})
