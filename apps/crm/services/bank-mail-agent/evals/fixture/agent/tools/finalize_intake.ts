import { defineTool } from 'eve/tools'
import { z } from 'zod'

export default defineTool({
  description: 'Finish a synthetic intake without creating a proposal.',
  inputSchema: z.object({
    outcome: z.enum(['security_rejected', 'needs_human_selection', 'no_match']),
    reasonCodes: z.array(z.string()).min(1).max(12),
  }).strict(),
  async execute({ outcome, reasonCodes }) {
    return { finalized: true, outcome, reasonCodes }
  },
})
