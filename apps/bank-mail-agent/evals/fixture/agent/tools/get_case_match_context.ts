import { defineTool } from 'eve/tools'
import { z } from 'zod'

export default defineTool({
  description: 'Load synthetic, PII-free context for one candidate.',
  inputSchema: z.object({ caseId: z.string().uuid() }).strict(),
  async execute({ caseId }) {
    return {
      caseId,
      bankName: 'Bank Syntetyczny',
      applicationId: '22222222-2222-4222-8222-222222222222',
      externalReference: 'ABC-2026-0042',
      applicantMatch: 'exact',
      applicationStatus: 'awaiting_bank_decision',
    }
  },
})
