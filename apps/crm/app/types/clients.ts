import type { OrganizationMember } from './organization'

export type ClientConsentChannel = 'email' | 'sms' | 'phone' | 'messaging' | 'other'
export type ClientConsentDecision = 'granted' | 'declined' | 'withdrawn'
export type ClientConsentFilterDecision = ClientConsentDecision | 'unknown'
export type ClientSortDirection = 'asc' | 'desc'
export type ClientSortField = 'updated_at' | 'created_at' | 'display_name'

export interface ClientListItem {
  id: string
  organization_id?: string
  owner_user_id: string | null
  display_name: string
  primary_email: string | null
  primary_phone: string | null
  status_code: string
  lead_source: string | null
  tags?: string[]
  notes?: string | null
  created_at: string
  updated_at: string
}

export interface ClientListQuery {
  q?: string
  owner_user_id?: string
  status_code?: string
  lead_source?: string
  tags_any?: string
  tags_all?: string
  consent_definition_id?: string
  consent_decision?: ClientConsentFilterDecision
  created_from?: string
  created_to?: string
  updated_from?: string
  updated_to?: string
  has_email?: boolean
  has_phone?: boolean
  sort?: ClientSortField
  direction?: ClientSortDirection
  offset?: number
  limit?: number
}

export interface ClientPageInfo {
  offset?: number
  limit: number
  next_cursor?: string | null
  next_cursor_token?: string | null
  has_more: boolean
}

export interface ClientSearchCursor {
  value: string
  id: string
}

export interface ClientFilterOption {
  value: string
  label: string
  count?: number
}

export interface ClientListFacets {
  statuses?: ClientFilterOption[]
  sources?: ClientFilterOption[]
  owners?: ClientFilterOption[]
  tags?: ClientFilterOption[]
}

export interface ClientListResponse {
  data: ClientListItem[]
  count: number
  page_info?: ClientPageInfo
  pageInfo?: {
    hasMore: boolean
    nextCursor: ClientSearchCursor | null
    offset: number
    limit: number
  }
  next_cursor?: string | null
  next_cursor_token?: string | null
  has_more?: boolean
  facets?: ClientListFacets
}

export interface ClientAppointmentSummary {
  id: string
  facilityName: string
  serviceName: string
  expertName: string
  starts_at: string
  status: 'hold' | 'confirmed' | 'cancelled' | string
}

export interface ClientAppointmentsPageInfo {
  offset: number
  limit: number
  has_more: boolean
}

export interface ClientConsentVersion {
  id: string
  version: number
  display_title: string
  content: string
  purpose: string
  channel: ClientConsentChannel
  legal_basis: string
  is_required: boolean
}

export interface ClientConsentDefinition {
  id: string
  code: string
  current_version_id: string
  current_version: ClientConsentVersion
}

/** Wire shape accepted from both SQL JSON facets (camelCase) and REST aliases. */
export interface ClientConsentVersionPayload {
  id: string
  version: number
  display_title?: string
  displayTitle?: string
  content: string
  purpose: string
  channel: ClientConsentChannel
  legal_basis?: string
  legalBasis?: string
  is_required?: boolean
  isRequired?: boolean
}

export interface ClientConsentDefinitionPayload {
  id: string
  code: string
  current_version_id?: string
  currentVersionId?: string
  current_version?: ClientConsentVersionPayload
  currentVersion?: ClientConsentVersionPayload
  counts?: Partial<Record<ClientConsentDecision | 'unknown', number>>
}

export interface ClientDateBounds {
  created_min?: string | null
  created_max?: string | null
  updated_min?: string | null
  updated_max?: string | null
  createdMin?: string | null
  createdMax?: string | null
  updatedMin?: string | null
  updatedMax?: string | null
}

export interface ClientContactCounts {
  with_email?: number
  without_email?: number
  with_phone?: number
  without_phone?: number
  with_both?: number
  without_contact?: number
  email?: number
  phone?: number
  both?: number
  none?: number
}

/**
 * Contract: GET /api/org/:organizationSlug/crm/clients/filters
 *
 * The endpoint supplies organization-scoped options for the client toolbar and
 * the current, immutable consent versions used by the create-client form.
 * `lead_sources` and `definitions` are transitional aliases supported by the UI.
 */
export interface ClientFiltersResponse {
  statuses: ClientFilterOption[]
  sources: ClientFilterOption[]
  lead_sources?: ClientFilterOption[]
  tags: ClientFilterOption[]
  owners: ClientFilterOption[]
  consent_definitions: ClientConsentDefinitionPayload[]
  definitions?: ClientConsentDefinitionPayload[]
  date_bounds?: ClientDateBounds | null
  contact_counts?: ClientContactCounts | null
  total?: number
  facets?: Record<string, unknown>
}

export interface ClientPrimaryPersonInput {
  role: 'primary'
  first_name?: string
  last_name?: string
  display_name?: string
  email?: string
  phone?: string
  pesel?: string
  date_of_birth?: string
  metadata?: Record<string, unknown>
}

export interface CreateClientConsentDecision {
  definition_id: string
  version_id: string
  granted: boolean
}

/**
 * Contract: POST /api/org/:organizationSlug/crm/clients
 *
 * `consent_decisions` must contain one decision for every active definition.
 * The server persists the client, primary person and version-pinned decisions
 * atomically. A stale version is reported as HTTP 409 and the UI reloads filters.
 */
export interface CreateClientRequest {
  display_name?: string
  status_code?: string
  lead_source?: string
  primary_email?: string
  primary_phone?: string
  tags?: string[]
  notes?: string
  metadata?: Record<string, unknown>
  owner_user_id: string
  primary_person: ClientPrimaryPersonInput
  consent_decisions: CreateClientConsentDecision[]
}

export type CreateClientResponse = ClientListItem | { data: ClientListItem }

export interface ClientMembersResponse {
  currentUserId: string
  role: 'admin' | 'expert'
  canAssignOthers: boolean
  members: OrganizationMember[]
}
