export default defineNuxtRouteMiddleware(async (to) => {
  const user = useAuthUser()
  if (to.path === '/reset-password' && typeof to.query.token === 'string') return
  if (user.value) {
    try {
      const { resolvePostAuthPath } = useAuthFlow()
      return navigateTo(await resolvePostAuthPath())
    } catch {
      // A stale browser session must not make the public login screen crash.
    }
  }
})
