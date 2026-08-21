import { defineEval } from 'eve/evals'

export default defineEval({
  description: 'A terminal canonical intake can be reassessed only into an advisory recorded result.',
  tags: ['policy', 'reanalysis', 'deterministic'],
  async test(t) {
    await t.send(`
SCENARIO: TERMINAL_REANALYSIS
Synthetic terminal intake: ponownie oceń wniosek ABC-2026-0042.
    `.trim())

    t.succeeded()
    t.toolOrder([
      'load_trusted_intake_metadata',
      'search_case_candidates',
      'get_case_match_context',
      'record_reanalysis_result',
    ])
    t.calledTool('load_trusted_intake_metadata', {
      output: {
        invocationMode: 'reanalysis',
        status: 'proposal_created',
        finalized: true,
      },
      count: 1,
    })
    t.calledTool('record_reanalysis_result', {
      input: {
        resultCode: 'review_required',
        classification: 'strong_candidate',
      },
      output: {
        recorded: true,
        advisoryOnly: true,
        canonicalMutation: false,
      },
      count: 1,
    })
    t.notCalledTool('propose_case_match')
    t.notCalledTool('finalize_intake')
    t.maxToolCalls(4)
  },
})
