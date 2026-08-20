import {
  SearchCaseCandidatesInputSchema,
  searchCaseCandidates,
} from '@openexpert/crm-agent-capabilities'
import { defineTool } from 'eve/tools'
import { bankMailCapabilityPrincipal, requireBankMailAgentCaller } from '../lib/caller.ts'
import { createBankMailActingUserDataApiClient } from '../lib/data-api.ts'

export default defineTool({
  description: 'Search read-only CRM case candidates using a non-secret signal extracted from the untrusted bank mail, such as an application reference, bank name, or applicant surname. Scope is fixed to cases owned by the authenticated mailbox owner. Organization, mailbox and owner scope are never model inputs.',
  inputSchema: SearchCaseCandidatesInputSchema,
  async execute(input, ctx) {
    const caller = requireBankMailAgentCaller(ctx)
    const dataApi = createBankMailActingUserDataApiClient(caller.mailboxOwnerUserId)
    const candidates = await searchCaseCandidates({
      ...input,
      dataApi,
      principal: bankMailCapabilityPrincipal(caller),
    })

    return {
      candidateCount: candidates.length,
      candidates,
    }
  },
})
