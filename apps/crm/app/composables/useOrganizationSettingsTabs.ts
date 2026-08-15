import type { RouteLocationRaw } from 'vue-router'

export type OrganizationSettingsTabKey = 'overview' | 'intermediary' | 'capacity' | 'design'

export type OrganizationSettingsTab = {
  key: OrganizationSettingsTabKey
  label: string
  to: RouteLocationRaw
  icon: string
  exact: boolean
  active?: boolean
}

type OrganizationSettingsTabDefinition = {
  key: OrganizationSettingsTabKey
  label: string
  path: string
  icon: string
  exact: boolean
}

export const organizationSettingsTabDefinitions = [
  {
    key: 'overview',
    label: 'Przegląd',
    path: '/settings/organization',
    icon: 'i-lucide-layout-dashboard',
    exact: true,
  },
  {
    key: 'intermediary',
    label: 'Dane pośrednika',
    path: '/settings/intermediary',
    icon: 'i-lucide-landmark',
    exact: true,
  },
  {
    key: 'capacity',
    label: 'Ustawienia zdolności',
    path: '/settings/capacity',
    icon: 'i-lucide-calculator',
    exact: true,
  },
  {
    key: 'design',
    label: 'Marka i wygląd',
    path: '/settings/design',
    icon: 'i-lucide-palette',
    exact: false,
  },
] as const satisfies readonly OrganizationSettingsTabDefinition[]

export function useOrganizationSettingsTabs() {
  const { orgPath } = useOrganizationContext()
  const route = useRoute()

  return computed<OrganizationSettingsTab[]>(() => (
    organizationSettingsTabDefinitions.map(tab => ({
      key: tab.key,
      label: tab.label,
      to: orgPath(tab.path),
      icon: tab.icon,
      exact: tab.exact,
      active: tab.key === 'capacity' && route.path === orgPath('/mortgages/capacity/admin')
        ? true
        : undefined,
    }))
  ))
}
