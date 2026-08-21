import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { requireBankMailAgentCaller } from '../lib/caller.ts'
import { loadTrustedBankMailIntake } from '../lib/intake.ts'

export default defineTool({
  description: 'Load the authoritative, PII-free intake status and sender trust verdict for this authenticated session. Always call this first. The tool derives intake scope from immutable service auth and never accepts organization, mailbox, owner, run or intake identifiers from the model.',
  inputSchema: z.object({}).strict(),
  async execute(_input, ctx) {
    const caller = requireBankMailAgentCaller(ctx)
    const intake = await loadTrustedBankMailIntake(caller.intakeId)

    return {
      invocationMode: caller.mode,
      status: intake.status,
      provider: intake.provider,
      bankId: intake.bankId,
      identityVerdict: intake.identityVerdict,
      authenticationStatus: intake.authenticationStatus,
      authenticationPolicy: intake.authenticationPolicy,
      dkimAligned: intake.dkimAligned,
      dmarcAligned: intake.dmarcAligned,
      replyToMismatch: intake.replyToMismatch,
      reasonCodes: intake.reasonCodes,
      attachmentCount: intake.attachments.length,
      claimed: true,
      finalized: intake.finalizedAt !== null,
    }
  },
})
