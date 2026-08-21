import { defineTool } from 'eve/tools'
import { z } from 'zod'

export default defineTool({
  description: 'Load synthetic read-only case context.',
  inputSchema: z.object({ caseId: z.string().uuid() }).strict(),
  async execute({ caseId }) {
    return {
      found: true,
      candidate: {
        caseId,
        applicationId: '22222222-2222-4222-8222-222222222222',
        bankMatch: 'match',
        externalReferenceMatch: 'exact_unique',
      },
    }
  },
})
