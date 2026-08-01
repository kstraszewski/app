export default defineNuxtRouteMiddleware(() => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, statusMessage: 'Page not found' })
  }
})
