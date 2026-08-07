import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { requireCrmAgentCaller } from '../lib/caller'

const MAX_SOURCE_CHARACTERS = 60_000

const dynamicContentEditSchema = z.object({
  requestId: z.string().uuid()
    .describe('Copy the exact opaque requestId from client context.'),
  documentRevision: z.number().int().min(0)
    .describe('Copy the exact documentRevision from client context so the UI can reject stale edits.'),
  replacementHtml: z.string().max(MAX_SOURCE_CHARACTERS)
    .describe('Complete replacement HTML for the page body. Do not include html, head, body, style, or script wrapper tags.'),
  replacementCss: z.string().max(MAX_SOURCE_CHARACTERS)
    .describe('Complete replacement CSS for the interactive page, without a style wrapper tag.'),
  replacementJavaScript: z.string().max(MAX_SOURCE_CHARACTERS)
    .describe('Complete replacement browser JavaScript for the interactive page, without a script wrapper tag.'),
  summary: z.string().trim().min(1).max(240)
    .describe('Short Polish description of the proposed change.'),
}).superRefine((input, refinement) => {
  const sourceCharacters = input.replacementHtml.length
    + input.replacementCss.length
    + input.replacementJavaScript.length

  if (sourceCharacters > MAX_SOURCE_CHARACTERS) {
    refinement.addIssue({
      code: 'custom',
      message: `Combined HTML, CSS, and JavaScript must not exceed ${MAX_SOURCE_CHARACTERS} characters.`,
    })
  }
})

export default defineTool({
  description: 'Prepare complete replacement HTML, CSS, and JavaScript for an interactive page in the Experiments dynamic content editor. Use only when clientContext.surface is experiments-dynamic-content-editor. The proposal is never applied automatically; the user must accept it in the editor.',
  inputSchema: dynamicContentEditSchema,
  execute(input, ctx) {
    const caller = requireCrmAgentCaller(ctx)
    if (!caller.canUseExperiments) {
      throw new Error('Dostęp do eksperymentów jest wymagany.')
    }

    const sourceCharacters = input.replacementHtml.length
      + input.replacementCss.length
      + input.replacementJavaScript.length
    if (sourceCharacters > MAX_SOURCE_CHARACTERS) {
      throw new Error(`Łączna długość HTML, CSS i JavaScript nie może przekraczać ${MAX_SOURCE_CHARACTERS} znaków.`)
    }

    return {
      proposalId: ctx.callId,
      ...input,
    }
  },
  toModelOutput(output) {
    return {
      type: 'json',
      value: {
        proposalId: output.proposalId,
        requestId: output.requestId,
        documentRevision: output.documentRevision,
        summary: output.summary,
      },
    }
  },
})
