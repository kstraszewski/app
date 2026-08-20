import { defineEval } from 'eve/evals'

export default defineEval({
  description: 'Two surname-only candidates force abstention and never create a proposal.',
  tags: ['policy', 'deterministic'],
  async test(t) {
    await t.send(`
SCENARIO: AMBIGUOUS
Synthetic mail: wydano decyzję dla klienta Nowak. Brak numeru wniosku.
    `.trim())

    t.succeeded()
    t.toolOrder([
      'load_trusted_intake_metadata',
      'search_case_candidates',
      'finalize_intake',
    ])
    t.calledTool('search_case_candidates', {
      input: { query: 'Nowak' },
      output: { candidateCount: 2 },
      count: 1,
    })
    t.calledTool('finalize_intake', {
      input: {
        outcome: 'needs_human_selection',
        reasonCodes: ['multiple_candidates', 'human_review_required'],
      },
      count: 1,
    })
    t.notCalledTool('get_case_match_context')
    t.notCalledTool('propose_case_match')
    t.maxToolCalls(3)
  },
})
