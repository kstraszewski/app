export default defineNuxtRouteMiddleware((to) => {
  const user = useSupabaseUser()
  if (!user.value) {
    return navigateTo({
      path: '/client/login',
      query: { redirect: to.fullPath },
    })
  }
})
