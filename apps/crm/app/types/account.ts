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

export type ClientMeetingStatus = 'scheduled' | 'live' | 'ended'
export type ClientMeetingSharedKind = 'none' | 'mortgage-process' | 'mortgage-offers'

export interface ClientMeetingSharedOffer {
  id: string
  bankName: string
  productName: string
  calculationStatus: 'complete' | 'partial'
  firstInstallment: number
  firstMonthlyOutflow: number
  costFirstFiveYears: number
  totalCost: number
  representativeAprPct: number | null
}

export interface ClientMeetingSharedContent {
  kind: ClientMeetingSharedKind
  processStepId: string | null
  updatedAt: string | null
  offers: ClientMeetingSharedOffer[]
}

export interface ClientMeeting {
  id: string
  status: ClientMeetingStatus
  startsAt: string
  endsAt: string
  timezone: string
  organization: {
    id: string
    name: string
    slug?: string
  } | null
  service: {
    id: string
    name: string
  } | null
  expert: {
    id: string
    name: string
  } | null
  shared: ClientMeetingSharedContent
}

export interface ClientMeetingResponse {
  data: ClientMeeting
}
