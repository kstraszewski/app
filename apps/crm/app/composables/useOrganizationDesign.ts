import {
  cloneDefaultOrganizationDesign,
  type OrganizationDesignSettings,
} from '#shared/design'

export function useOrganizationDesignState() {
  return useState<OrganizationDesignSettings>(
    'openexpert-organization-design',
    cloneDefaultOrganizationDesign,
  )
}
