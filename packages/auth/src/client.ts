import { createAuthClient } from 'better-auth/vue'
import { jwtClient, magicLinkClient } from 'better-auth/client/plugins'
import type { BetterAuthClientPlugin } from 'better-auth'

export interface OpenExpertAuthClientOptions {
  baseURL?: string
  basePath?: string
}

export function createOpenExpertAuthClient(
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
    plugins: [magicLinkClient(), openExpertJwtClient],
  })
}

export type OpenExpertAuthClient = ReturnType<
  typeof createOpenExpertAuthClient
>
