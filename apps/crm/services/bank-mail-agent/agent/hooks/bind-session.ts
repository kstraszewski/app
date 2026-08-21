import { defineHook } from 'eve/hooks'
import { requireBankMailAgentCaller } from '../lib/caller.ts'
import { createBankMailSessionBindDataApiClient } from '../lib/data-api.ts'
import { callBankMailServiceRpc } from '../lib/rpc.ts'
import { bankMailSessionBindRequest } from '../lib/session-bind.ts'

export default defineHook({
  events: {
    async 'session.started'(_event, ctx) {
      const request = bankMailSessionBindRequest(
        requireBankMailAgentCaller(ctx),
        ctx.session.id,
      )
      await callBankMailServiceRpc(
        createBankMailSessionBindDataApiClient(request.claims),
        'bind_bank_mail_agent_run_session',
        request.args,
      )
    },
  },
})
