import type {
  MultiformFieldValue,
  MultiformFormField,
} from './multiform'

export interface ClientMultiformCaseSummary {
  id: string
  title: string
  organization: {
    name: string
    slug: string
  }
  applicantLabel: string
  sharedAt: string
  updatedAt: string | null
  completedAt: string | null
}

export interface ClientMultiformCasesResponse {
  data: ClientMultiformCaseSummary[]
}

export interface ClientMultiformFormResponse {
  data: {
    case: {
      id: string
      title: string
      organization: {
        name: string
        slug: string
      }
    }
    applicant: {
      clientId: string
      index: number
      label: string
    }
    selectionFingerprint: string
    revision: number
    fields: MultiformFormField[]
    values: Record<string, MultiformFieldValue>
    updatedAt: string | null
    completedAt: string | null
  }
}
