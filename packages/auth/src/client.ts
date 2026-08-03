import { passkeyClient } from '@better-auth/passkey/client'
import type { BetterAuthClientPlugin } from 'better-auth'
import {
  jwtClient,
  magicLinkClient,
  phoneNumberClient,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'

export interface OpenExpertAuthClientOptions {
  baseURL?: string
  basePath?: string
}

export interface OpenExpertPasskey {
  id: string
  name?: string
  publicKey: string
  userId: string
  credentialID: string
  counter: number
  deviceType: string
  backedUp: boolean
  transports?: string
  createdAt: Date
  aaguid?: string
}

interface OpenExpertClientError {
  code?: string
  message?: string
  status: number
  statusText: string
}

type OpenExpertClientResult<T> = Promise<
  | { data: T, error: null }
  | { data: null, error: OpenExpertClientError }
>

function createOpenExpertBaseAuthClient(
  options: OpenExpertAuthClientOptions = {},
) {
  // Better Auth 1.6.25's jwtClient declaration is narrower than the Vue
  // client's generic plugin constraint under TypeScript 6. Keep the concrete
  // plugin type for endpoint inference while acknowledging that it implements
  // the runtime client-plugin contract.
  const openExpertJwtClient = jwtClient() as ReturnType<typeof jwtClient> &
    BetterAuthClientPlugin

  return createAuthClient({
    ...options,
    plugins: [magicLinkClient(), phoneNumberClient(), openExpertJwtClient],
  })
}

type OpenExpertBaseAuthClient = ReturnType<
  typeof createOpenExpertBaseAuthClient
>
type OpenExpertPasskeyActions = ReturnType<
  ReturnType<typeof passkeyClient>['getActions']
>

type OpenExpertPasskeyClient = Omit<OpenExpertBaseAuthClient, 'signIn' | 'passkey'> & {
  signIn: OpenExpertBaseAuthClient['signIn'] & OpenExpertPasskeyActions['signIn']
  passkey: OpenExpertPasskeyActions['passkey'] & {
    listUserPasskeys(): OpenExpertClientResult<OpenExpertPasskey[]>
    updatePasskey(input: { id: string, name: string }): OpenExpertClientResult<{
      passkey: OpenExpertPasskey
    }>
    deletePasskey(input: { id: string }): OpenExpertClientResult<{
      status: boolean
    }>
  }
}

export function createOpenExpertAuthClient(
  options: OpenExpertAuthClientOptions = {},
): OpenExpertPasskeyClient {
  const openExpertJwtClient = jwtClient() as ReturnType<typeof jwtClient> &
    BetterAuthClientPlugin

  const client = createAuthClient({
    ...options,
    plugins: [
      magicLinkClient(),
      phoneNumberClient(),
      passkeyClient(),
      openExpertJwtClient,
    ],
  })

  // The passkey plugin adds `signIn.passkey` through getActions while Better
  // Auth's 1.6.25 Vue declarations replace, instead of intersecting, the
  // existing sign-in namespace. Runtime actions are merged correctly; expose
  // that actual merged shape until the upstream declaration is corrected.
  return client as unknown as OpenExpertPasskeyClient
}

export type OpenExpertAuthClient = ReturnType<
  typeof createOpenExpertAuthClient
>
