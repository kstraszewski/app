import type { OrganizationSummary } from '~/types/organization'

export function useOrganizations() {
  return useFetch<{ data: OrganizationSummary[], access: { superAdmin: boolean } }>('/api/me/organizations', {
    key: 'openexpert-organizations',
    default: () => ({ data: [], access: { superAdmin: false } }),
  })
}
