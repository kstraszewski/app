export default defineNuxtRouteMiddleware(async () => {
  const user = useSupabaseUser()
  if (user.value) {
    try {
      const { resolvePostAuthPath } = useAuthFlow()
      return navigateTo(await resolvePostAuthPath())
    } catch {
      // A stale browser session must not make the public login screen crash.
    }
  }
})
