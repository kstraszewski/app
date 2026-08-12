import type { OrganizationMember } from './organization'

export type ClientConsentChannel = 'email' | 'sms' | 'phone' | 'messaging' | 'other'
export type ClientConsentDecision = 'granted' | 'declined' | 'withdrawn'
export type ClientConsentFilterDecision = ClientConsentDecision | 'unknown'
export type ClientSortDirection = 'asc' | 'desc'
export type ClientSortField = 'updated_at' | 'created_at' | 'display_name'

export interface ClientListPrimaryPerson {
  id: string
  display_name: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  pesel_last4: string | null
}

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
  primaryPerson?: ClientListPrimaryPerson | null
  matchedPerson?: ClientListPrimaryPerson | null
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
  sort?: ClientSortField | 'relevance'
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

export type ClientDetailJson =
  | null
  | boolean
  | number
  | string
  | ClientDetailJson[]
  | { [key: string]: ClientDetailJson }

export interface ClientUserSummary {
  id: string
  email: string
  full_name: string | null
}

export interface ClientDetailRecord extends Omit<ClientListItem, 'organization_id' | 'tags'> {
  organization_id: string
  tags: string[]
  metadata: ClientDetailJson
  primary_email_normalized?: string | null
  primary_phone_normalized?: string | null
  search_text?: string
}

export interface ClientPerson {
  id: string
  organization_id: string
  client_id: string
  subject_person_id: string
  role: string
  first_name: string | null
  last_name: string | null
  display_name: string
  email: string | null
  phone: string | null
  pesel: string | null
  date_of_birth: string | null
  metadata: ClientDetailJson
  created_at: string
  updated_at: string
  email_normalized?: string | null
  phone_normalized?: string | null
}

export interface ClientPortalAccount {
  auth_user_id: string
  organization_id: string
  client_id: string
  client_person_id: string
  status: string
  archived_at: string | null
  archive_reason: string | null
  revision: number
  created_at: string
  updated_at: string
}

export interface ClientCaseSummary {
  id: string
  title: string
  closed_at: string | null
  created_at: string
  updated_at: string
  offer_count: number
}

export interface ClientTask {
  id: string
  organization_id: string
  assignee_user_id: string | null
  client_id: string | null
  case_id: string | null
  case_item_id: string | null
  title: string
  description: string | null
  status_code: string
  priority: string
  due_at: string | null
  completed_at: string | null
  metadata: ClientDetailJson
  created_at: string
  updated_at: string
}

export interface ClientDocument {
  id: string
  organization_id: string
  client_id: string | null
  case_id: string | null
  case_item_id: string | null
  submission_id: string | null
  document_type: string
  name: string
  status_code: string
  storage_bucket: string | null
  storage_path: string | null
  received_at: string | null
  verified_at: string | null
  metadata: ClientDetailJson
  created_at: string
  updated_at: string
  mime_type?: string | null
  sha256?: string | null
  size_bytes?: number | null
  uploaded_by_user_id?: string | null
}

export interface ClientActivity {
  id: string
  organization_id: string
  actor_user_id: string | null
  client_id: string | null
  case_id: string | null
  case_item_id: string | null
  submission_id: string | null
  activity_type: string
  title: string
  body: string | null
  payload: ClientDetailJson
  created_at: string
  actor?: ClientUserSummary | null
}

export interface ClientAppointmentFacility {
  id: string
  name: string
  timezone: string
}

export interface ClientAppointmentService {
  id: string
  name: string
  duration_minutes: number
}

export interface ClientAppointmentSummary {
  id: string
  client_id: string
  facility_id: string
  service_id: string
  expert_user_id: string
  facilityName: string
  serviceName: string
  expertName: string
  starts_at: string
  ends_at: string
  timezone: string
  status: 'hold' | 'confirmed' | 'cancelled' | string
  meeting_mode: 'office' | 'online'
  meeting_url: string | null
  confirmed_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  customer_name: string
  customer_email: string | null
  customer_phone: string | null
  notes: string | null
  source: string
  created_at: string
  updated_at: string
  facility: ClientAppointmentFacility | null
  service: ClientAppointmentService | null
  expert: ClientUserSummary | null
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

export interface ClientConsentDefinitionRecord {
  id: string
  code: string
  context: string
  current_version_id: string
  created_at: string
  updated_at: string
}

export interface ClientDetailConsentDefinition extends ClientConsentDefinitionRecord {
  current_version: ClientConsentVersion | null
}

export interface ClientConsentEvent {
  id: string
  organization_id: string
  client_id: string
  subject_person_id: string
  definition_id: string
  definition_version_id: string
  decision: ClientConsentDecision
  contact_value: string | null
  source: string
  recorded_by_user_id: string | null
  evidence_reference: string | null
  metadata: ClientDetailJson
  occurred_at: string
  created_at: string
}

export interface ClientConsentHistoryEvent extends ClientConsentEvent {
  version: ClientConsentVersion | null
}

export interface ClientConsentState {
  id: string | null
  client_id: string
  definition_id: string
  definition_version_id: string
  decision: ClientConsentDecision | 'missing'
  occurred_at: string | null
  source: string | null
  contact_value: string | null
  definition: ClientConsentDefinitionRecord
  version: ClientConsentVersion | null
  subject_person?: Pick<ClientPerson, 'id' | 'display_name' | 'role' | 'phone'> | null
  organization_id?: string
  subject_person_id?: string
  recorded_by_user_id?: string | null
  evidence_reference?: string | null
  metadata?: ClientDetailJson
  created_at?: string
}

export type ClientConsentCaptureStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'verified'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired'
  | 'cancelled'
  | 'failed'

export interface ClientConsentCaptureRequest {
  id: string
  client_id: string
  subject_person_id: string
  definition_id: string
  definition_version_id: string
  intent: 'collect' | 'withdraw'
  status: ClientConsentCaptureStatus
  delivery_status: string | null
  phone_masked: string
  expires_at: string
  sent_at: string | null
  delivered_at: string | null
  verified_at: string | null
  decided_at: string | null
  decision: ClientConsentDecision | null
  created_at: string
}

export interface ClientConsentAccess {
  can_request: boolean
  can_manage: boolean
}

export type ClientAnonymizationRequestStatus =
  | 'received'
  | 'identity_verification'
  | 'legal_review'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'cancelled'

export type ClientAnonymizationRequestChannel =
  | 'email'
  | 'phone'
  | 'in_person'
  | 'letter'
  | 'other'

export interface ClientAnonymizationRequest {
  id: string
  organization_id: string
  client_id: string
  subject_person_id: string
  request_number: string
  status: ClientAnonymizationRequestStatus
  request_channel: ClientAnonymizationRequestChannel
  legal_basis: string
  requested_at: string
  identity_verified_at: string | null
  identity_verified_by_user_id: string | null
  approved_at: string | null
  approved_by_user_id: string | null
  due_at: string
  justification: string
  review_note: string | null
  completed_at: string | null
  completed_by_user_id: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
  identity_verified_by: ClientUserSummary | null
  approved_by: ClientUserSummary | null
  completed_by: ClientUserSummary | null
  created_by: ClientUserSummary | null
}

export interface ClientPrivacyAccess {
  can_view_requests: boolean
  can_create_request: boolean
  create_permission_key: 'privacy.requests.create'
  can_execute_anonymization: boolean
  execute_permission_key: 'clients.anonymization.execute'
  execution_requires_temporary_grant: true
  execution_grant: {
    id: string
    revision: number
    status: 'active'
    expires_at: string
    approved_at: string
  } | null
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

export interface ClientDetailSummary {
  people_count: number
  cases_count: number
  open_cases_count: number
  task_count: number
  open_tasks_count: number
  documents_count: number
  activity_count: number
  consent_definition_count: number
  granted_consent_count: number
  appointment_count: number
}

/**
 * Contract: GET /api/org/:organizationSlug/crm/clients/:id
 *
 * Activities include direct client activity and activity from every case linked
 * to the client. Actor profiles are scoped to the current organization.
 */
export interface ClientDetailResponse {
  data: ClientDetailRecord
  owner: ClientUserSummary | null
  primary_person: ClientPerson | null
  people: ClientPerson[]
  portal_accounts: ClientPortalAccount[]
  cases: ClientCaseSummary[]
  tasks: ClientTask[]
  documents: ClientDocument[]
  activities: ClientActivity[]
  activity_count: number
  consents: ClientConsentState[]
  consent_states: ClientConsentState[]
  consent_definitions: ClientDetailConsentDefinition[]
  consent_history: ClientConsentHistoryEvent[]
  consent_history_count: number
  consent_capture_requests: ClientConsentCaptureRequest[]
  consent_access: ClientConsentAccess
  anonymization_requests: ClientAnonymizationRequest[]
  current_anonymization_request: ClientAnonymizationRequest | null
  privacy_access: ClientPrivacyAccess
  appointments: ClientAppointmentSummary[]
  appointment_count: number
  appointments_page_info: ClientAppointmentsPageInfo
  summary: ClientDetailSummary
  consent_events?: ClientConsentEvent[]
  consent_history_page_info?: ClientAppointmentsPageInfo
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
 * `consent_decisions` is retained for backward compatibility. New CRM clients
 * are created with an empty array; the data subject records version-pinned
 * decisions later through the verified SMS capture flow.
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
