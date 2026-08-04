export const CRM_CALCULATOR_PATHS = {
  capacity: '/calculator/capacity',
  mortgages: '/calculator/mortgages',
} as const

const CRM_MORTGAGE_ADMIN_TAB_DEFINITIONS = [
  {
    label: 'Instytucje',
    path: '/settings/institutions',
    icon: 'i-lucide-landmark',
  },
  {
    label: 'Produkty',
    path: '/settings/products',
    icon: 'i-lucide-package-search',
  },
  {
    label: 'Pliki z banków',
    path: '/settings/institution-files',
    icon: 'i-lucide-folder-search-2',
  },
] as const

export interface CrmNavigationTarget {
  to: string
  activePaths?: string[]
  exact?: boolean
}

export function createMortgageAdminTabs(organizationSlug: string) {
  const organizationBase = `/org/${encodeURIComponent(organizationSlug)}`

  return CRM_MORTGAGE_ADMIN_TAB_DEFINITIONS.map(tab => ({
    label: tab.label,
    to: `${organizationBase}${tab.path}`,
    icon: tab.icon,
    exact: false,
  }))
}

export function isCrmNavigationPathActive(currentPath: string, item: CrmNavigationTarget) {
  const paths = item.activePaths ?? [item.to]

  return paths.some(path => (
    currentPath === path
    || currentPath === `${path}/`
    || (!item.exact && currentPath.startsWith(`${path}/`))
  ))
}
