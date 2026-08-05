export default defineNuxtPlugin(async () => {
  const route = useRoute()
  if (route.path === '/demo' || route.path.startsWith('/preview')) return

  const user = useAuthUser()
  const sessionChecked = useState<boolean>(
    'openexpert-client-auth-session-checked',
    () => false,
  )
  if (import.meta.prerender) {
    sessionChecked.value = false
  }
  else if (!sessionChecked.value) {
    try {
      await refreshAuthUser()
      sessionChecked.value = true
    }
    catch {
      // A temporary auth API failure must not be treated as a signed-out user.
    }
  }

  if (import.meta.client) {
    const session = useAuthClient().useSession()
    watch(session, async (state) => {
      if (state.isPending || state.isRefetching) return
      if (state.error && state.error.status !== 401) return

      const authenticated = authenticatedUserFromSession(state.data)
      if (authenticated) {
        user.value = authenticated
        return
      }
      if (user.value) await handleExpiredClientSession()
    }, { immediate: true })
  }
})
