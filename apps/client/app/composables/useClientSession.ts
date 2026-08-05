import {
  CLIENT_SESSION_EXPIRED_REASON,
  clientSessionReturnPath,
} from '~/utils/client-session'

export async function handleExpiredClientSession(): Promise<void> {
  if (import.meta.server) return

  const handling = useState<boolean>(
    'openexpert-client-auth-session-expiry-handling',
    () => false,
  )
  if (handling.value) return
  handling.value = true

  const route = useRoute()
  const redirect = clientSessionReturnPath(route.fullPath)
  useAuthUser().value = null
  useState<boolean>('openexpert-client-auth-session-checked', () => false).value = false
  clearNuxtData()

  try {
    await navigateTo({
      path: '/login',
      query: {
        reason: CLIENT_SESSION_EXPIRED_REASON,
        redirect,
      },
    }, { replace: true })
  }
  finally {
    handling.value = false
  }
}

export async function confirmExpiredClientSession(): Promise<boolean> {
  if (import.meta.server || !useAuthUser().value) return false

  try {
    const result = await useAuthClient().getSession({
      query: { disableCookieCache: true },
    })
    const authenticated = authenticatedUserFromSession(result.data)
    if (authenticated) {
      useAuthUser().value = authenticated
      return false
    }
    if (result.error && result.error.status !== 401) return false
  }
  catch {
    // A network or server failure is not proof that the browser session ended.
    return false
  }

  await handleExpiredClientSession()
  return true
}

export const usePortalFetch = createUseFetch(callerOptions => ({
  ...callerOptions,
  $fetch: useNuxtApp().$portalFetch as typeof $fetch,
}))
