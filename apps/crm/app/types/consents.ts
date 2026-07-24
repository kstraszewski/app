export type ConsentChannel = 'email' | 'sms' | 'phone' | 'messaging' | 'other'
export type ConsentStatus = 'draft' | 'published' | 'archived'

export type ConsentVersion = {
  id: string
  version: number
  internal_name: string
  display_title: string
  content: string
  purpose: string
  channel: ConsentChannel
  legal_basis: string
  is_required: boolean
  status: ConsentStatus
  sort_order: number
  language_code: string
  effective_from: string
  effective_to: string | null
  change_note: string | null
  content_sha256: string
  created_at: string
}

export type ConsentDefinition = {
  id: string
  code: string
  context: string
  current_version_id: string
  created_at: string
  updated_at: string
  current_version: ConsentVersion | null
  versions: ConsentVersion[]
}

export type ConsentPayload = {
  role: 'admin' | 'expert'
  canManage: boolean
  definitions: ConsentDefinition[]
}

export type ConsentForm = {
  code: string
  internal_name: string
  display_title: string
  content: string
  purpose: string
  channel: ConsentChannel
  legal_basis: string
  is_required: boolean
  status: ConsentStatus
  sort_order: number
  language_code: string
  effective_from: string
  effective_to: string
  change_note: string
}
