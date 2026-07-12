import type { OrganizationSummary } from '~/types/organization'

export function useOrganizations() {
  return useFetch<{ data: OrganizationSummary[] }>('/api/me/organizations', {
    key: 'openexpert-organizations',
    default: () => ({ data: [] }),
  })
}
