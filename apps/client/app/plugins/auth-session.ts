export default defineNuxtPlugin(async () => {
  const route = useRoute()
  if (route.path === '/demo' || route.path.startsWith('/preview')) return

  const user = useAuthUser()
  await refreshAuthUser()

  if (import.meta.client) {
    const session = useAuthClient().useSession()
    watch(session, (state) => {
      if (state.isPending || state.isRefetching) return
      user.value = authenticatedUserFromSession(state.data)
    }, { immediate: true })
  }
})
