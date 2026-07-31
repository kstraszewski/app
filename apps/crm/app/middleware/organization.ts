export default defineNuxtRouteMiddleware(async (to) => {
  const rawSlug = to.params.organizationSlug
  const organizationSlug = Array.isArray(rawSlug) ? String(rawSlug[0] ?? '') : String(rawSlug ?? '')
  if (!organizationSlug) return navigateTo('/org')

  const { data, error } = await useOrganizations()
  const organization = data.value.data.find(item => item.slug === organizationSlug)

  if (error.value || !organization) {
    return navigateTo({ path: '/org', query: { missing: organizationSlug } })
  }
})
