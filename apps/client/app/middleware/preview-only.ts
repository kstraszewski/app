export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.dev) return

  const config = useRuntimeConfig()
  if (!config.public.openexpert.demoEnabled) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found' })
  }

  try {
    const session = await useRequestFetch()<{ authenticated: boolean }>(
      '/api/demo/session',
      { headers: { 'cache-control': 'no-cache' } },
    )
    if (session.authenticated) return
  }
  catch {
    // The login page will surface a temporary configuration error if needed.
  }

  return navigateTo({
    path: '/demo',
    query: { redirect: to.fullPath },
  })
})
