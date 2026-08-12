export default defineNuxtRouteMiddleware(async (to) => {
  const user = useAuthUser()
  const { errorCode } = usePortalAuth()
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

  try {
    await useRequestFetch()('/api/client/access', {
      headers: { 'cache-control': 'no-cache' },
    })
  }
  catch (error) {
    if (errorCode(error as Parameters<typeof errorCode>[0]) === 'PORTAL_ACCOUNT_ARCHIVED') {
      if (import.meta.client) {
        try {
          await signOutAuthenticatedUser()
        }
        catch {
          user.value = null
        }
      }
      return navigateTo({
        path: '/login',
        query: { accountArchived: '1' },
      })
    }

    throw createError({
      statusCode: 503,
      statusMessage: 'Nie udało się sprawdzić dostępu do panelu. Spróbuj ponownie.',
    })
  }
})
