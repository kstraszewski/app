import type { RouteLocationRaw } from 'vue-router'
import { isBillingAccessGranted } from '~~/shared/organization-billing'

export type OrganizationSettingsTabKey = 'overview' | 'billing' | 'intermediary' | 'capacity' | 'design'

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
    key: 'billing',
    label: 'Subskrypcja',
    path: '/settings/billing',
    icon: 'i-lucide-credit-card',
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
  const { data: organizations } = useOrganizations()
  const organizationSlug = computed(() => {
    const value = route.params.organizationSlug
    return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
  })
  const activeOrganization = computed(() => organizations.value.data.find(organization => (
    organizationSlug.value === organization.slug
  )))
  const billingRestricted = computed(() => (
    activeOrganization.value?.kind === 'application'
    && !isBillingAccessGranted(activeOrganization.value.billingAccessState)
  ))

  return computed<OrganizationSettingsTab[]>(() => (
    organizationSettingsTabDefinitions
      .filter(tab => (
        billingRestricted.value
          ? tab.key === 'billing'
          : activeOrganization.value?.kind === 'application'
            ? tab.key !== 'intermediary'
            : tab.key !== 'billing'
      ))
      .map(tab => ({
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
