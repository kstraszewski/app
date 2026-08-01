export interface ClientPortalAccessRecipient {
  client_id: string
  client_person_id: string
  display_name: string
  email: string | null
  email_normalized: string | null
  phone: string | null
  is_primary: true
}

export interface ClientPortalCaseGrant {
  portal_enabled: boolean
  multiform_enabled: boolean
  portal_enabled_at: string | null
  multiform_enabled_at: string | null
  revoked_at: string | null
  created_at: string | null
  updated_at: string | null
  revision: number
}

export interface ClientPortalInvitationSummary {
  id: string
  email_normalized: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  expires_at: string
  sent_at: string | null
  accepted_at: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
  revision: number
  delivery_attempts: number
  delivery_failed: boolean
}

export type ClientPortalInvitationDeliveryStatus =
  | 'missing_email'
  | 'not_created'
  | 'pending_send'
  | 'failed'
  | 'sent'
  | 'accepted'
  | 'expired'
  | 'revoked'

export interface ClientPortalAccessResponse {
  data: {
    case_id: string
    recipient: ClientPortalAccessRecipient | null
    access: ClientPortalCaseGrant
    invitation: ClientPortalInvitationSummary | null
    invitation_delivery: {
      status: ClientPortalInvitationDeliveryStatus
      message: string
    }
    can_configure: boolean
    blocking_reason: string | null
  }
}
