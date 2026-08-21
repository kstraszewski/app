import { Client } from 'eve/client'
import type { H3Event } from 'h3'
import {
  BANK_MAIL_INGRESS_DATA_SOURCE,
  dispatchBankMailAgentWithDependencies,
  selectBankMailAgentServiceUrl,
  type BankMailAgentDispatchInput,
  type BankMailAgentDispatcherDependencies,
  type BankMailAgentDispatchResult,
} from './bank-mail-agent-dispatch-core'
import { serverDataBackend } from './data-api'
import {
  serverDataTokenSigner,
  serverScopedBackendDataClient,
} from './platform-data'

type RpcResult = Awaited<ReturnType<BankMailAgentDispatcherDependencies['rpc']>>

/** Production adapter used by trusted provider-ingestion code. */
export async function dispatchBankMailAgent(
  event: H3Event,
  input: BankMailAgentDispatchInput,
): Promise<BankMailAgentDispatchResult> {
  const runtimeConfig = useRuntimeConfig(event) as {
    bankMailAgent?: { serviceUrl?: string }
  }
  const backend = serverDataBackend(event)
  const signer = serverDataTokenSigner(event)

  return dispatchBankMailAgentWithDependencies(
    selectBankMailAgentServiceUrl(
      process.env.BANK_MAIL_AGENT_INTERNAL_URL,
      runtimeConfig.bankMailAgent?.serviceUrl,
    ),
    input,
    {
      rpc: (name, args, context) => {
        const ingress = context?.bankMailIngress
        if (name === 'claim_bank_mail_agent_intake' && !ingress) {
          throw new Error('Bank-mail intake claim is missing its durable thread-link scope.')
        }
        if (ingress && name !== 'claim_bank_mail_agent_intake') {
          throw new Error('Bank-mail ingress scope is restricted to the intake claim.')
        }
        const rpcBackend = ingress
          ? serverScopedBackendDataClient(event, {
              ...ingress,
              source: BANK_MAIL_INGRESS_DATA_SOURCE,
            })
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
