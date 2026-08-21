import { defineTool } from 'eve/tools'
import { z } from 'zod'

export default defineTool({
  description: 'Load synthetic trusted intake metadata. Always call first.',
  inputSchema: z.object({}).strict(),
  async execute() {
    return {
      invocationMode: 'initial',
      status: 'processing',
      bankId: '33333333-3333-4333-8333-333333333333',
      identityVerdict: 'trusted_bank',
      authenticationStatus: 'failed',
      authenticationPolicy: 'openexpert_mock_dkim_aligned',
      dkimAligned: true,
      dmarcAligned: false,
      replyToMismatch: false,
      finalized: false,
    }
  },
})
