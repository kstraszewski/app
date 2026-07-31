export default defineNuxtRouteMiddleware((to) => {
  const user = useAuthUser()
  if (!user.value) {
    return navigateTo({
      path: '/client/login',
      query: { redirect: to.fullPath },
    })
  }
})
