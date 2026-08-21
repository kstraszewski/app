export const CRM_CALCULATOR_PATHS = {
  capacity: '/calculator/capacity',
  mortgages: '/calculator/mortgages',
} as const

const CRM_SYSTEM_ADMINISTRATION_NAVIGATION_DEFINITIONS = [
  {
    label: 'Organizacje',
    path: '/settings/organizations',
    icon: 'i-lucide-building-2',
  },
  {
    label: 'Instytucje',
    path: '/settings/institutions',
    icon: 'i-lucide-landmark',
  },
  {
    label: 'Produkty kredytowe',
    path: '/settings/products',
    icon: 'i-lucide-package-search',
  },
  {
    label: 'Dokumenty bankowe',
    path: '/settings/institution-files',
    icon: 'i-lucide-folder-search-2',
  },
] as const

const CRM_ORGANIZATION_ADMINISTRATION_NAVIGATION_DEFINITIONS = [
  {
    label: 'Użytkownicy',
    path: '/users',
    icon: 'i-lucide-user-round-cog',
  },
  {
    label: 'Zgody',
    path: '/consents',
    icon: 'i-lucide-shield-check',
  },
  {
    label: 'Ustawienia',
    path: '/settings/organization',
    icon: 'i-lucide-settings-2',
    activePaths: [
      '/settings/organization',
      '/settings/billing',
      '/settings/capacity',
      '/settings/intermediary',
      '/settings/design',
      '/mortgages/capacity/admin',
    ],
  },
] as const

export interface CrmNavigationTarget {
  to: string
  activePaths?: string[]
  exact?: boolean
}

export function createOrganizationAdministrationNavigationItems(organizationSlug: string) {
  const organizationBase = `/org/${encodeURIComponent(organizationSlug)}`

  return CRM_ORGANIZATION_ADMINISTRATION_NAVIGATION_DEFINITIONS.map(item => ({
    label: item.label,
    to: `${organizationBase}${item.path}`,
    icon: item.icon,
    exact: false,
    ...('activePaths' in item
      ? { activePaths: item.activePaths.map(path => `${organizationBase}${path}`) }
      : {}),
  }))
}

export function createSystemAdministrationNavigationItems(organizationSlug: string) {
  const organizationBase = `/org/${encodeURIComponent(organizationSlug)}`

  return CRM_SYSTEM_ADMINISTRATION_NAVIGATION_DEFINITIONS.map(item => ({
    label: item.label,
    to: `${organizationBase}${item.path}`,
    icon: item.icon,
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
