import { isBillingAccessGranted } from '~~/shared/organization-billing'

export default defineNuxtRouteMiddleware(async (to) => {
  const rawSlug = to.params.organizationSlug
  const organizationSlug = Array.isArray(rawSlug) ? String(rawSlug[0] ?? '') : String(rawSlug ?? '')
  if (!organizationSlug) return navigateTo('/org')

  const { data, error } = await useOrganizations()
  const organization = data.value.data.find(item => item.slug === organizationSlug)

  if (error.value || !organization) {
    return navigateTo({ path: '/org', query: { missing: organizationSlug } })
  }

  if (
    organization.kind === 'application'
    && !isBillingAccessGranted(organization.billingAccessState)
  ) {
    const base = `/org/${encodeURIComponent(organizationSlug)}`
    const billingPath = `${base}/settings/billing`
    const systemOrganizationsPath = `${base}/settings/organizations`
    const allowed = to.path === billingPath
      || to.path.startsWith(`${billingPath}/`)
      || (data.value.access.superAdmin && (
        to.path === systemOrganizationsPath
        || to.path.startsWith(`${systemOrganizationsPath}/`)
      ))
    if (!allowed) {
      return navigateTo({
        path: billingPath,
        query: { required: organization.billingAccessState },
      })
    }
  }

  const intermediaryPath = `/org/${encodeURIComponent(organizationSlug)}/settings/intermediary`
  if (
    organization.kind === 'application'
    && (to.path === intermediaryPath || to.path.startsWith(`${intermediaryPath}/`))
  ) {
    return navigateTo(`/org/${encodeURIComponent(organizationSlug)}/settings/organization`)
  }
})
