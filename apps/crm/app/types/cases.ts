import type { DocumentRequirement as SharedDocumentRequirement } from '#shared/document-requirements'

export interface CaseClient {
  id: string
  display_name: string
  primary_email?: string | null
  primary_phone?: string | null
  is_primary?: boolean
}

export interface CaseBankSummary {
  id: string | null
  name: string
}

export interface CaseListItem {
  id: string
  title: string
  created_at: string
  updated_at: string
  clients: CaseClient[]
  offer_count: number
  banks: CaseBankSummary[]
}

export interface CaseListResponse {
  data: CaseListItem[]
  count: number
  page_info?: {
    has_more: boolean
    offset: number
    limit: number
  }
}

export interface CaseFilterOption {
  value: string
  label: string
  count?: number
}

export interface CaseFiltersResponse {
  clients: CaseClient[]
  banks: CaseFilterOption[]
  offer_counts: { with: number, without: number }
  date_bounds: Record<string, string | null> | null
}

export interface SavedCaseOffer {
  id: string
  case_id: string
  bank_id: string | null
  mortgage_product_id: string | null
  mortgage_product_version_id: string | null
  offer_type: string
  bank_name: string
  product_name: string
  version_key: string | null
  calculator_version: string
  currency: string
  loan_amount: number | null
  first_installment: number | null
  first_monthly_outflow: number | null
  cost_first_five_years: number | null
  total_cost: number | null
  representative_apr_pct: number | null
  scenario_snapshot: Record<string, unknown>
  catalog_snapshot: Record<string, any>
  calculation_snapshot?: Record<string, any>
  calculation_status?: 'complete' | 'partial' | 'ineligible' | 'unsupported'
  saved_at: string
  bank_logo_url?: string | null
  bank_logo_background?: string | null
}

export type MortgageApplicationStatus =
  | 'draft'
  | 'wyslane'
  | 'w_analizie'
  | 'braki'
  | 'zaakceptowane'
  | 'odrzucone'
  | 'wycofane'

export interface CaseBankApplication {
  id: string
  submission_id: string
  case_id: string
  case_item_id: string
  offer_id: string
  bank_id: string
  property_id: string | null
  slot: 1 | 2 | 3
  status_code: MortgageApplicationStatus
  external_reference: string | null
  submitted_at: string | null
  decision_at: string | null
  notes: string | null
  metadata: Record<string, unknown>
  snapshot_status: 'legacy_missing' | 'pending_property' | 'complete'
  snapshot_schema_version: string | null
  calculator_version: string | null
  comparison_baseline_offer_id: string | null
  scenario_snapshot: Record<string, any> | null
  calculation_snapshot: Record<string, any> | null
  purchase_price_amount: number | null
  appraisal_value_amount: number | null
  net_loan_amount: number | null
  gross_loan_amount: number | null
  financed_costs: number | null
  ltv_debt_basis: string | null
  collateral_value_basis: string | null
  ltv_debt_amount: number | null
  collateral_value_amount: number | null
  ltv_pct: number | null
  first_installment: number | null
  first_monthly_outflow: number | null
  cost_first_five_years: number | null
  total_cost: number | null
  calculated_at: string | null
  created_by_user_id: string | null
  created_at: string
  updated_at: string
}

export type DocumentRequirement = SharedDocumentRequirement

export interface CaseDocument {
  id: string
  organization_id: string
  client_id: string | null
  case_id: string
  case_item_id: string | null
  submission_id: string | null
  document_type: string
  name: string
  status_code: string
  uploaded_by_user_id: string | null
  mime_type: 'application/pdf' | 'image/jpeg' | 'image/png' | null
  size_bytes: number | null
  sha256: string | null
  received_at: string | null
  verified_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type CasePriority = 'low' | 'normal' | 'high' | 'urgent'

export interface CaseUserSummary {
  id: string
  email: string
  full_name: string | null
}

export interface CaseProductType {
  id: string
  domain: 'credit' | 'insurance' | 'real_estate' | 'other'
  code: string
  name: string
  description: string | null
}

export interface CaseItem {
  id: string
  case_id: string
  product_type_id: string
  owner_user_id: string | null
  title: string
  status_code: string
  amount_value: number | null
  currency: string
  expected_close_date: string | null
  won_at: string | null
  lost_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  product_type: CaseProductType | null
  owner: CaseUserSummary | null
}

export interface CaseProperty {
  id: string
  case_id: string | null
  case_item_id: string | null
  address: string
  city: string | null
  postal_code: string | null
  property_type: string | null
  market_type: string | null
  price_amount: number | null
  appraisal_value_amount: number | null
  currency: string
  area_m2: number | null
  rooms: number | null
  listing_title: string | null
  description: string | null
  source_url: string | null
  source_published_at: string | null
  imported_at: string | null
  metadata: Record<string, unknown>
  images: CasePropertyImage[]
  created_at: string
  updated_at: string
}

export interface CasePropertyImage {
  id: string
  property_id: string
  source_url: string | null
  mime_type: string
  size_bytes: number
  width_px: number | null
  height_px: number | null
  sort_order: number
  alt_text: string | null
  metadata: Record<string, unknown>
  url: string | null
  created_at: string
  updated_at: string
}

export interface CaseTask {
  id: string
  assignee_user_id: string | null
  client_id: string | null
  case_id: string | null
  case_item_id: string | null
  title: string
  description: string | null
  status_code: string
  priority: CasePriority
  due_at: string | null
  completed_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  assignee: CaseUserSummary | null
}

export interface CaseActivity {
  id: string
  actor_user_id: string | null
  client_id: string | null
  case_id: string | null
  case_item_id: string | null
  submission_id: string | null
  activity_type: string
  title: string
  body: string | null
  payload: Record<string, unknown>
  created_at: string
  actor: CaseUserSummary | null
}

export interface CaseDetail {
  id: string
  organization_id: string
  owner_user_id: string | null
  title: string
  description: string | null
  status_code: string
  priority: CasePriority
  progress_percent: number
  opened_at: string
  closed_at: string | null
  created_at: string
  updated_at: string
  owner: CaseUserSummary | null
  selected_offer_id: string | null
  selected_property_id: string | null
  bank_applications: CaseBankApplication[]
  contract_application_id: string | null
  contract_signed_at: string | null
  clients: CaseClient[]
  offers: SavedCaseOffer[]
  documents: CaseDocument[]
  items: CaseItem[]
  properties: CaseProperty[]
  open_tasks: CaseTask[]
  recent_activities: CaseActivity[]
}

export interface CaseDetailResponse {
  data: CaseDetail
}

export interface CreateCaseResponse {
  data: {
    id: string
    title: string
    created_at: string
    updated_at: string
  }
}
