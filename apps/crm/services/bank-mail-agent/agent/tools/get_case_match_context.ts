import {
  GetCaseMatchContextInputSchema,
  getCaseMatchContext,
} from '@openexpert/crm-agent-capabilities'
import { defineTool } from 'eve/tools'
import { bankMailCapabilityPrincipal, requireBankMailAgentCaller } from '../lib/caller.ts'
import { createBankMailActingUserDataApiClient } from '../lib/data-api.ts'

export default defineTool({
  description: 'Inspect one candidate returned by search_case_candidates through a minimal, read-only matching DTO. It exposes applicant display names and bank application references, but never contact details, notes, PESEL, NIP, credentials, document bodies or activity text. Scope remains fixed to cases owned by the mailbox owner.',
  inputSchema: GetCaseMatchContextInputSchema,
  async execute(input, ctx) {
    const caller = requireBankMailAgentCaller(ctx)
    const dataApi = createBankMailActingUserDataApiClient(caller.mailboxOwnerUserId)
    const candidate = await getCaseMatchContext({
      ...input,
      dataApi,
      principal: bankMailCapabilityPrincipal(caller),
    })

    return {
      found: candidate !== null,
      candidate,
    }
  },
})
