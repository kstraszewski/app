import { isProtectedClientApiRequest } from '~/utils/client-session'

export default defineNuxtPlugin((nuxtApp) => {
  let sessionConfirmation: Promise<boolean> | null = null

  const portalFetch: typeof $fetch = import.meta.server
    ? useRequestFetch() as unknown as typeof $fetch
    : $fetch.create({
        async onResponseError({ request, response }) {
          if (
            response.status !== 401
            || !isProtectedClientApiRequest(request)
            || !useAuthUser().value
          ) return

          sessionConfirmation ||= nuxtApp.runWithContext(
            () => confirmExpiredClientSession(),
          ).finally(() => {
            sessionConfirmation = null
          })
          await sessionConfirmation
        },
      })

  return {
    provide: { portalFetch },
  }
})
