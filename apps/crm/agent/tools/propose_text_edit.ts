import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { requireCrmAgentCaller } from '../lib/caller'

const editTargetSchema = z.enum(['selection', 'document'])

export default defineTool({
  description: 'Prepare a complete Markdown replacement for the selected text or the whole document in the Experiments text editor. The proposal is never applied automatically; the user must accept it in the editor.',
  inputSchema: z.object({
    requestId: z.string().uuid()
      .describe('Copy the exact opaque requestId from client context.'),
    target: editTargetSchema.describe('selection when the provided selection should be replaced; document otherwise.'),
    documentRevision: z.number().int().min(0)
      .describe('Copy the exact documentRevision from client context so the UI can reject stale edits.'),
    replacementMarkdown: z.string().max(60_000)
      .describe('Complete replacement Markdown for the requested target, not a diff and not commentary. Use an empty string only when the user explicitly asks to remove the target.'),
    summary: z.string().trim().min(1).max(240)
      .describe('Short Polish description of the proposed change.'),
  }),
  execute(input, ctx) {
    const caller = requireCrmAgentCaller(ctx)
    if (!caller.canUseExperiments) {
      throw new Error('Dostęp do eksperymentów jest wymagany.')
    }

    return {
      proposalId: ctx.callId,
      ...input,
    }
  },
})
