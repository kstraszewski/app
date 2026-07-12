export default defineNuxtRouteMiddleware(async (to) => {
  const rawSlug = to.params.organizationSlug
  const organizationSlug = Array.isArray(rawSlug) ? String(rawSlug[0] ?? '') : String(rawSlug ?? '')
  if (!organizationSlug) return navigateTo('/org')

  const supabase = useSupabaseClient()
  const { data, error } = await supabase
    .from('organizations')
    .select('slug')
    .eq('slug', organizationSlug)
    .maybeSingle()

  if (error || !data) {
    return navigateTo({ path: '/org', query: { missing: organizationSlug } })
  }
})
