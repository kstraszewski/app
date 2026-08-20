import { defineEval } from 'eve/evals'

export default defineEval({
  description: 'A unique bank reference follows the trusted-load, search, context, proposal sequence.',
  tags: ['policy', 'deterministic'],
  async test(t) {
    await t.send(`
SCENARIO: STRONG
Synthetic mail: decyzja dla wniosku ABC-2026-0042 w Banku Syntetycznym.
    `.trim())

    t.succeeded()
    t.toolOrder([
      'load_trusted_intake_metadata',
      'search_case_candidates',
      'get_case_match_context',
      'propose_case_match',
    ])
    t.calledTool('search_case_candidates', {
      input: { query: 'ABC-2026-0042' },
      output: { candidateCount: 1 },
      count: 1,
    })
    t.calledTool('propose_case_match', {
      output: {
        proposalRecorded: true,
        reviewStatus: 'review_required',
        eligibleForAutomaticAttach: false,
      },
      count: 1,
    })
    t.notCalledTool('finalize_intake')
    t.maxToolCalls(4)
  },
})
