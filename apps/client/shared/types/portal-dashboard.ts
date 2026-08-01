export type PortalNextStepKind =
  | 'upload_document'
  | 'complete_multiform'
  | 'prepare_appointment'
  | 'wait'

export type PortalNextStepResponsibility = 'client' | 'expert'

export interface PortalDashboardNextStep {
  kind: PortalNextStepKind
  responsibility: PortalNextStepResponsibility
  title: string
  description: string
  caseId: string | null
  appointmentId: string | null
  label: string | null
  to: string | null
}

export interface PortalExpertContact {
  email: string | null
  phone: string | null
}

export interface PortalExpertDetails {
  id: string
  name: string
  avatarUrl: string | null
  role: 'expert' | 'admin'
  professionalTitle: string | null
  contact: PortalExpertContact | null
}
