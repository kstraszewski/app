import { defineHook } from 'eve/hooks'
import { requireBankMailAgentCaller } from '../lib/caller.ts'
import { createBankMailSessionBindDataApiClient } from '../lib/data-api.ts'
import { callBankMailServiceRpc } from '../lib/rpc.ts'
import {
  bankMailReanalysisFailureRequest,
  bankMailSessionStartedRequest,
  type BankMailReanalysisFailureCode,
} from '../lib/session-bind.ts'

async function callScopedRequest(request: {
  claims: Parameters<typeof createBankMailSessionBindDataApiClient>[0]
  rpcName: string
  args: Record<string, unknown>
}): Promise<void> {
  await callBankMailServiceRpc(
    createBankMailSessionBindDataApiClient(request.claims),
    request.rpcName,
    request.args,
  )
}

async function failReanalysis(
  ctx: Parameters<typeof requireBankMailAgentCaller>[0],
  failureCode: BankMailReanalysisFailureCode,
): Promise<void> {
  const caller = requireBankMailAgentCaller(ctx)
  if (caller.mode !== 'reanalysis') return
  await callScopedRequest(bankMailReanalysisFailureRequest(
    caller,
    ctx.session.id,
    failureCode,
  ))
}

export default defineHook({
  events: {
    async 'session.started'(_event, ctx) {
      const request = bankMailSessionStartedRequest(
        requireBankMailAgentCaller(ctx),
        ctx.session.id,
      )
      await callScopedRequest(request)
    },
    async 'turn.completed'(_event, ctx) {
      await failReanalysis(ctx, 'result_missing')
    },
    async 'turn.failed'(_event, ctx) {
      await failReanalysis(ctx, 'turn_failed')
    },
    async 'session.failed'(_event, ctx) {
      await failReanalysis(ctx, 'session_failed')
    },
  },
})
