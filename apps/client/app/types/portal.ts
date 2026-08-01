export type PortalProgressStatus = 'completed' | 'current' | 'waiting'

export interface PortalUser {
  id: string
  name: string
  email: string
}

export interface PortalExpert {
  id: string
  name: string
  initials?: string
  avatarUrl?: string | null
  role?: string | null
  professionalTitle?: string | null
  contact?: {
    email?: string | null
    phone?: string | null
  } | null
}

export interface PortalCaseStep {
  id: string
  label: string
  status: PortalProgressStatus
}

export interface PortalCaseAction {
  kind: 'upload_document' | 'complete_multiform' | 'wait'
  title: string
  description?: string | null
  deadlineAt?: string | null
  label?: string | null
  to?: string | null
}

export interface PortalTimelineItem {
  id: string
  kind: 'action' | 'document' | 'message' | 'status' | 'multiform'
  title: string
  body?: string | null
  createdAt: string
  isNew?: boolean
  author?: {
    name: string
    avatarUrl?: string | null
    role?: 'client' | 'expert'
  } | null
  action?: {
    kind: 'upload_document' | 'complete_multiform'
    label: string
    to?: string | null
  } | null
}

export interface PortalCase {
  id: string
  title: string
  subtitle?: string | null
  statusCode?: string | null
  caseNumber?: string | null
  location?: string | null
  openedAt: string
  updatedAt: string
  closedAt?: string | null
  organization: {
    id: string
    name: string
    slug: string
  }
  expert: PortalExpert
  clientPerson?: {
    id: string
    displayName: string
  } | null
  grant: {
    portalEnabled: boolean
    multiformEnabled: boolean
    portalEnabledAt?: string | null
    multiformEnabledAt?: string | null
  }
  progressPercent: number
  steps?: PortalCaseStep[]
  documents?: {
    total: number
    uploaded: number
    pending: number
  } | null
  action?: PortalCaseAction | null
  timeline?: PortalTimelineItem[]
}

export interface PortalPayload {
  user: PortalUser
  linked: boolean
  cases: PortalCase[]
  activeCaseId?: string | null
  appointments?: PortalAppointment[]
  nextAppointment?: PortalAppointment | null
  nextStep?: PortalNextStep | null
}

export interface PortalAppointment {
  id: string
  status: string
  startsAt: string
  endsAt: string
  timezone: string
  meetingMode: string
  meetingUrl?: string | null
  facility?: {
    id?: string
    name?: string
    city?: string | null
    addressLine1?: string | null
    addressLine2?: string | null
    postalCode?: string | null
  } | null
  service?: { id?: string, name?: string, durationMinutes?: number } | null
  expert?: PortalExpert | null
}

export interface PortalNextStep {
  kind: 'upload_document' | 'complete_multiform' | 'prepare_appointment' | 'wait'
  responsibility: 'client' | 'expert'
  title: string
  description?: string | null
  caseId?: string | null
  appointmentId?: string | null
  label?: string | null
  to?: string | null
}

export type IncomeSource = 'employment' | 'business' | 'civil_contract' | 'retirement' | 'rental' | 'foreign' | 'other'
export type EmploymentType = 'indefinite' | 'fixed' | 'probation' | 'other'
export type LoanPurpose = 'purchase_primary' | 'purchase_secondary' | 'construction' | 'renovation' | 'refinance'

export interface PortalMultiformAnswers {
  applicant: {
    incomeSource: IncomeSource | null
    employmentType: EmploymentType | null
    incomePaidToAccount: boolean | null
    additionalIncome: boolean | null
    liabilities: boolean | null
  }
  case: {
    loanPurpose: LoanPurpose | null
    preliminaryAgreement: boolean | null
    landRegister: boolean | null
    appraisalAvailable: boolean | null
    trancheDisbursement: boolean | null
  }
}

export interface PortalMultiformDraft {
  answers: PortalMultiformAnswers
  activeStep: number
  revision: number
  updatedAt?: string | null
  completedAt?: string | null
}

export interface PortalMultiformPayload {
  access: 'locked' | 'unlocked'
  grant?: PortalCase['grant'] | null
  draft?: PortalMultiformDraft | null
}
