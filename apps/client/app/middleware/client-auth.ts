export default defineNuxtRouteMiddleware(async (to) => {
  const user = useAuthUser()
  if (!user.value) await refreshAuthUser()
  if (!user.value) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  }
})
