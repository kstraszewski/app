export type CaseTaskDelegationPriority = 'low' | 'normal' | 'high' | 'urgent'

export type CaseTaskDelegationAccessScope =
  | 'case_summary'
  | 'client_contact'
  | 'client_identity'
  | 'documents'
  | 'offers'
  | 'financial_data'
  | 'activities'

export interface CaseTaskDelegationClientSummary {
  id: string
  display_name: string
  primary_email?: string | null
  primary_phone?: string | null
  is_primary?: boolean
}

export interface CaseTaskDelegationCaseSummary {
  id: string
  title: string
  clients: CaseTaskDelegationClientSummary[]
}

export interface CaseTaskDelegationAssignee {
  userId: string
  email: string
  fullName: string
  role: 'expert' | 'admin'
  teamName?: string | null
  avatarUrl?: string | null
  openTaskCount?: number
}

export interface CaseTaskDelegationRecentAssignee extends CaseTaskDelegationAssignee {
  lastDelegatedAt?: string | null
  delegationCount?: number
}

export interface CaseTaskDelegationAppointment {
  facilityId: string
  serviceId: string
  startsAt: string
  meetingMode: 'office' | 'online'
}

export interface CaseTaskDelegationAppointmentSlot {
  startsAt: string
  endsAt: string
}

export interface CaseTaskDelegationAppointmentContext {
  facilityId: string
  facilityName: string
  timezone: string
  serviceId: string
  serviceName: string
  durationMinutes: number
  slots: CaseTaskDelegationAppointmentSlot[]
}

export interface CaseTaskDelegationAppointmentOptions {
  date: string
  endDate: string
  days: number
  assigneeUserId: string
  contexts: CaseTaskDelegationAppointmentContext[]
}

export interface CaseTaskDelegationPayload {
  title: string
  description: string
  priority: CaseTaskDelegationPriority
  assigneeUserId: string
  dueAt: string
  accessScope: CaseTaskDelegationAccessScope[]
  appointment: CaseTaskDelegationAppointment | null
}
