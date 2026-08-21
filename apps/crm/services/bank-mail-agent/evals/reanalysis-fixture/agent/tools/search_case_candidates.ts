import { defineTool } from 'eve/tools'
import { z } from 'zod'

export default defineTool({
  description: 'Search synthetic read-only candidates.',
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().int().optional(),
  }).strict(),
  async execute() {
    return {
      candidateCount: 1,
      candidates: [{ caseId: '11111111-1111-4111-8111-111111111111' }],
    }
  },
})
