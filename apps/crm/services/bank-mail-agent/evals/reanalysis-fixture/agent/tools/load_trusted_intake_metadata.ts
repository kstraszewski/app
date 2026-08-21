import { defineTool } from 'eve/tools'
import { z } from 'zod'

export default defineTool({
  description: 'Load a synthetic terminal canonical intake in reanalysis mode.',
  inputSchema: z.object({}).strict(),
  async execute() {
    return {
      invocationMode: 'reanalysis',
      status: 'proposal_created',
      identityVerdict: 'trusted_bank',
      authenticationStatus: 'passed',
      authenticationPolicy: 'dmarc_aligned',
      dkimAligned: false,
      dmarcAligned: true,
      replyToMismatch: false,
      finalized: true,
    }
  },
})
