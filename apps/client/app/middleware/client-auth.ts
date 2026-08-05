export default defineNuxtRouteMiddleware(async (to) => {
  const user = useAuthUser()
  if (!user.value) {
    try {
      await refreshAuthUser()
    }
    catch {
      throw createError({
        statusCode: 503,
        statusMessage: 'Nie udało się sprawdzić sesji. Spróbuj ponownie.',
      })
    }
  }
  if (!user.value) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  }
})
