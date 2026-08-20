import {
  searchCaseCandidates,
  SearchCaseCandidatesInputSchema,
  type DataApiClientLike,
} from '@openexpert/crm-agent-capabilities'
import { defineTool } from 'eve/tools'
import { requireCrmAgentCaller } from '../lib/caller'
import { createAgentActingUserDataApiClient } from '../lib/data-api'

export default defineTool({
  description: 'Search CRM cases and bank applications through the shared, redacted candidate matcher. Use it when an application reference, bank or applicant evidence must be matched to a concrete case. This is read-only.',
  inputSchema: SearchCaseCandidatesInputSchema,
  async execute(input, ctx) {
    const caller = requireCrmAgentCaller(ctx)
    const candidates = await searchCaseCandidates({
      ...input,
      dataApi: createAgentActingUserDataApiClient(caller.userId) as unknown as DataApiClientLike,
      principal: {
        kind: 'user',
        organizationId: caller.organizationId,
        organizationSlug: caller.organizationSlug,
        userId: caller.userId,
        role: caller.role === 'admin' ? 'admin' : 'expert',
      },
    })

    return {
      count: candidates.length,
      candidates: candidates.map(candidate => ({
        ...candidate,
        url: `/org/${encodeURIComponent(caller.organizationSlug)}/cases/${encodeURIComponent(candidate.caseId)}`,
      })),
    }
  },
})
