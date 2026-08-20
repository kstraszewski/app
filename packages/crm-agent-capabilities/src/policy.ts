import { z } from 'zod'
import { BANK_MAIL_MATCH_POLICY_VERSION } from './constants.ts'

export const BankMailProposalEvidenceSchema = z.object({
  candidateCount: z.number().int().min(0).max(100),
  senderIdentity: z.enum(['verified', 'unverified', 'failed']),
  externalReferenceMatch: z.enum(['none', 'exact_unique', 'exact_ambiguous', 'conflict']),
  bankMatch: z.enum(['none', 'match', 'mismatch']),
  applicantNameMatch: z.enum(['none', 'partial', 'full']),
  contradictions: z.array(z.enum([
    'sender_identity_failed',
    'bank_mismatch',
    'external_reference_conflict',
    'case_scope_conflict',
  ])).max(10).default([]),
}).strict()

export type BankMailProposalEvidence = z.input<typeof BankMailProposalEvidenceSchema>

export type BankMailProposalPolicyResult = Readonly<{
  policyVersion: typeof BANK_MAIL_MATCH_POLICY_VERSION
  decision: 'no_match' | 'review_required'
  evidenceStrength: 'none' | 'weak' | 'strong'
  eligibleForAutomaticAttach: false
  reasonCodes: readonly string[]
}>

/**
 * Deterministic action policy. The model may identify signals, but cannot raise
 * the action ceiling: the MVP always requires a human before attachment.
 */
export function reduceBankMailProposal(
  rawEvidence: BankMailProposalEvidence,
): BankMailProposalPolicyResult {
  const evidence = BankMailProposalEvidenceSchema.parse(rawEvidence)
  const contradictions = new Set(evidence.contradictions)
  if (evidence.senderIdentity === 'failed') contradictions.add('sender_identity_failed')
  if (evidence.bankMatch === 'mismatch') contradictions.add('bank_mismatch')
  if (evidence.externalReferenceMatch === 'conflict') {
    contradictions.add('external_reference_conflict')
  }

  const reasonCodes: string[] = [...contradictions].sort()
  if (contradictions.size || evidence.candidateCount === 0) {
    if (evidence.candidateCount === 0) reasonCodes.push('no_candidate')
    return Object.freeze({
      policyVersion: BANK_MAIL_MATCH_POLICY_VERSION,
      decision: 'no_match',
      evidenceStrength: 'none',
      eligibleForAutomaticAttach: false,
      reasonCodes: Object.freeze(reasonCodes),
    })
  }

  const exactUniqueReference = evidence.externalReferenceMatch === 'exact_unique'
  const matchingBank = evidence.bankMatch === 'match'
  const strong = exactUniqueReference && matchingBank
  if (exactUniqueReference) reasonCodes.push('exact_unique_external_reference')
  if (evidence.externalReferenceMatch === 'exact_ambiguous') {
    reasonCodes.push('ambiguous_external_reference')
  }
  if (matchingBank) reasonCodes.push('matching_bank')
  if (evidence.applicantNameMatch !== 'none') {
    reasonCodes.push(
      evidence.applicantNameMatch === 'full'
        ? 'full_applicant_name_match'
        : 'partial_applicant_name_match',
    )
  }
  if (evidence.senderIdentity !== 'verified') reasonCodes.push('sender_identity_unverified')
  if (!strong && evidence.applicantNameMatch !== 'none') {
    reasonCodes.push('name_signal_requires_human_review')
  }
  if (!reasonCodes.length) return Object.freeze({
    policyVersion: BANK_MAIL_MATCH_POLICY_VERSION,
    decision: 'no_match',
    evidenceStrength: 'none',
    eligibleForAutomaticAttach: false,
    reasonCodes: Object.freeze(['no_matching_signal']),
  })

  return Object.freeze({
    policyVersion: BANK_MAIL_MATCH_POLICY_VERSION,
    decision: 'review_required',
    evidenceStrength: strong ? 'strong' : 'weak',
    eligibleForAutomaticAttach: false,
    reasonCodes: Object.freeze(reasonCodes),
  })
}
