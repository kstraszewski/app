import { defineTool } from 'eve/tools'
import { z } from 'zod'

export default defineTool({
  description: 'Record a synthetic advisory-only reanalysis result.',
  inputSchema: z.object({
    resultCode: z.enum([
      'review_required',
      'no_match',
      'not_bank_mail',
      'needs_human_selection',
      'security_rejected',
    ]),
    classification: z.enum(['strong_candidate', 'ambiguous_candidate']).nullable(),
    caseId: z.string().uuid().nullable(),
    applicationId: z.string().uuid().nullable(),
    evidenceCodes: z.array(z.string()),
    contradictionCodes: z.array(z.string()),
    reasonCodes: z.array(z.string()),
  }).strict(),
  async execute({ resultCode }) {
    return {
      recorded: true,
      state: 'completed',
      resultCode,
      advisoryOnly: true,
      canonicalMutation: false,
    }
  },
})
