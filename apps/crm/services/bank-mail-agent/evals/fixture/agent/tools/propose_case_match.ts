import { defineTool } from 'eve/tools'
import { z } from 'zod'

export default defineTool({
  description: 'Record a synthetic review-only match proposal.',
  inputSchema: z.object({
    caseId: z.string().uuid(),
    applicationId: z.string().uuid(),
    evidence: z.object({
      senderIdentity: z.literal('verified'),
      candidateCount: z.literal(1),
      externalReferenceMatch: z.literal('exact_unique'),
      applicantNameMatch: z.literal('full'),
      bankMatch: z.literal('match'),
      contradictions: z.array(z.string()).max(0),
    }).strict(),
  }).strict(),
  async execute() {
    return {
      proposalRecorded: true,
      reviewStatus: 'review_required',
      eligibleForAutomaticAttach: false,
    }
  },
})
