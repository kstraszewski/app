import { Client } from 'eve/client'
import type { H3Event } from 'h3'
import {
  dispatchBankMailReanalysisWithDependencies,
  type BankMailReanalysisDispatchInput,
  type BankMailReanalysisDispatcherDependencies,
  type BankMailReanalysisDispatchResult,
} from './bank-mail-reanalysis-dispatch-core.ts'
import { selectBankMailAgentServiceUrl } from './bank-mail-agent-dispatch-core.ts'
import { serverDataBackend } from './data-api.ts'
import {
  serverDataTokenSigner,
  serverScopedBackendDataClient,
} from './platform-data.ts'

type RpcResult = Awaited<ReturnType<BankMailReanalysisDispatcherDependencies['rpc']>>

export async function dispatchBankMailReanalysis(
  event: H3Event,
  input: BankMailReanalysisDispatchInput,
): Promise<BankMailReanalysisDispatchResult> {
  const runtimeConfig = useRuntimeConfig(event) as {
    bankMailAgent?: { serviceUrl?: string }
  }
  const backend = serverDataBackend(event)
  const signer = serverDataTokenSigner(event)

  return dispatchBankMailReanalysisWithDependencies(
    selectBankMailAgentServiceUrl(
      process.env.BANK_MAIL_AGENT_INTERNAL_URL,
      runtimeConfig.bankMailAgent?.serviceUrl,
    ),
    input,
    {
      rpc: (name, args, context) => {
        const claims = context?.scopedClaims
        const requiresScopedClaims = name === 'claim_bank_mail_agent_reanalysis'
          || name === 'fail_bank_mail_agent_reanalysis'
        if (requiresScopedClaims !== Boolean(claims)) {
          throw new Error('Invalid bank-mail reanalysis Data API scope.')
        }
        const rpcBackend = claims
          ? serverScopedBackendDataClient(event, claims)
          : backend
        return (
          rpcBackend.rpc as unknown as (
            rpcName: string,
            rpcArgs: Record<string, unknown>,
          ) => Promise<RpcResult>
        )(name, args)
      },
      signServiceToken: claims => signer.signBackend({ ...claims }),
      async createSession({ serviceUrl, bearerToken, prompt }) {
        const client = new Client({
          host: serviceUrl,
          auth: { bearer: bearerToken },
          redirect: 'error',
        })
        const created = await client.sessions.create({
          message: prompt,
          signal: AbortSignal.timeout(15_000),
        })
        return { sessionId: created.session.state.sessionId }
      },
    },
  )
}
