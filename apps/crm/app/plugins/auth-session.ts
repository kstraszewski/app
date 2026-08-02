export default defineNuxtPlugin(async () => {
  const user = useAuthUser()
  const sessionChecked = useState<boolean>(
    'openexpert-crm-auth-session-checked',
    () => false,
  )
  if (import.meta.prerender) {
    sessionChecked.value = false
  }
  else if (!sessionChecked.value) {
    await refreshAuthUser()
    sessionChecked.value = true
  }

  if (import.meta.client) {
    const session = useAuthClient().useSession()
    watch(session, (state) => {
      if (state.isPending || state.isRefetching) return
      user.value = authenticatedUserFromSession(state.data)
    }, { immediate: true })
  }
})
