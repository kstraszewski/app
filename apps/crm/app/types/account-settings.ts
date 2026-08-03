import type { ExpertBrandProfile } from '#shared/brand'
import type { OrganizationDesignSettings } from '#shared/design'

export interface AccountBrandResponse {
  data: {
    profile: ExpertBrandProfile
    design: OrganizationDesignSettings
  }
  permissions: {
    canEditProfile: boolean
    canEditVisualIdentity: boolean
  }
  updatedAt: string | null
}

export interface AccountPublicVisibilityResponse {
  portal: {
    audience: 'linked_clients'
    card: {
      name: string
      professionalTitle: string | null
      avatarUrl: string | null
    }
    contact: {
      email: string | null
      phone: string | null
    }
  }
  directory: {
    status: 'listed' | 'facility_only' | 'hidden' | 'partial'
    listed: boolean
    sourceIsCurrentOrganization: boolean
    currentOrganizationListed: boolean
    rpcFailureCount: number
    directoryUrl: string
    facilityAppearances: Array<{
      id: string
      name: string
      address: string | null
    }>
    card: {
      name: string
      avatarUrl: string | null
      facility: {
        id: string
        name: string
        address: string | null
      }
      services: Array<{
        name: string
        durationMinutes: number
      }>
      bookingUrl: string | null
    } | null
  }
  profileScope: {
    organizationId: string
    organizationName: string
  }
}
