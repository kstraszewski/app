export interface AccountContextOrganization {
  id: string
  name: string
  slug: string
  role: string
  isDefault: boolean
}

export interface AccountContexts {
  identity: {
    id: string
    email: string
    fullName: string
  }
  staffOrganizations: AccountContextOrganization[]
  clientLinkCount: number
  hasStaff: boolean
  hasClient: boolean
}

export interface ClientAppointment {
  id: string
  status: string
  meetingMode: 'office' | 'online'
  meetingUrl: string | null
  startsAt: string
  endsAt: string
  timezone: string
  organization: {
    id: string
    name: string
    slug: string
  } | null
  facility: {
    id: string
    name: string
    city: string | null
    addressLine1: string | null
    addressLine2: string | null
    postalCode: string | null
  } | null
  service: {
    id: string
    name: string
    durationMinutes: number
  } | null
  expert: {
    id: string
    name: string
  } | null
}
