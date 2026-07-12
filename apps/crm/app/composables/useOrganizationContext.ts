export function useOrganizationContext() {
  const route = useRoute()
  const organizationSlug = computed(() => {
    const value = route.params.organizationSlug
    return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
  })

  function orgPath(path = '/dashboard') {
    const suffix = path.startsWith('/') ? path : `/${path}`
    return `/org/${encodeURIComponent(organizationSlug.value)}${suffix}`
  }

  function orgApiPath(path = '') {
    const suffix = path.startsWith('/') || !path ? path : `/${path}`
    return `/api/org/${encodeURIComponent(organizationSlug.value)}${suffix}`
  }

  function crmApiPath(path = '') {
    const suffix = path.startsWith('/') || !path ? path : `/${path}`
    return orgApiPath(`/crm${suffix}`)
  }

  return {
    organizationSlug,
    crmApiPath,
    orgApiPath,
    orgPath,
  }
}
