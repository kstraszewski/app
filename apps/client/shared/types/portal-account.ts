export type PortalAccountConsentDecision =
  | 'granted'
  | 'declined'
  | 'withdrawn'
  | 'missing'

export interface PortalAccountProfile {
  organizationId: string
  organizationName: string
  clientId: string
  clientPersonId: string
  displayName: string
  role: string
  status: 'active' | 'archived'
  archivedAt: string | null
}

export interface PortalAccountConsentHistoryItem {
  id: string
  decision: Exclude<PortalAccountConsentDecision, 'missing'>
  occurredAt: string
  source: string
  version: number | null
}

export interface PortalAccountConsent {
  organizationId: string
  organizationName: string
  clientId: string
  clientPersonId: string
  personName: string
  definitionId: string
  code: string
  title: string
  content: string
  purpose: string
  channel: string
  legalBasis: string
  isRequired: boolean
  decision: PortalAccountConsentDecision
  decidedAt: string | null
  source: string | null
  canWithdraw: boolean
  history: PortalAccountConsentHistoryItem[]
}

export interface PortalAccountPayload {
  user: {
    id: string
    name: string
    email: string
  }
  profiles: PortalAccountProfile[]
  consents: PortalAccountConsent[]
}

export interface PortalAccountResponse {
  data: PortalAccountPayload
}
