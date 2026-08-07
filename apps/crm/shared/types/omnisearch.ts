export type CrmOmnisearchKind =
  | 'forum_thread'
  | 'bank_file'
  | 'knowledge'
  | 'case'
  | 'client'
  | 'appointment'
  | 'task'
  | 'document'

export type CrmOmnisearchOrganizationRole = 'expert' | 'admin'

export function canAccessCrmOmnisearch(
  role: unknown,
): role is CrmOmnisearchOrganizationRole {
  return role === 'expert' || role === 'admin'
}

export type CrmOmnisearchGroupKey =
  | 'forum'
  | 'bankFiles'
  | 'knowledge'
  | 'cases'
  | 'clients'
  | 'appointments'
  | 'tasks'
  | 'documents'

export type CrmOmnisearchRouteQueryValue =
  | string
  | number
  | null
  | Array<string | number | null>

export type CrmOmnisearchTarget =
  | string
  | {
      path: string
      query?: Record<string, CrmOmnisearchRouteQueryValue>
    }

export interface CrmOmnisearchAvatar {
  src?: string
  alt?: string
  text?: string
  style?: {
    backgroundColor?: string
  }
}

export interface CrmOmnisearchHit {
  id: string
  kind: CrmOmnisearchKind
  label: string
  description?: string
  suffix?: string
  icon?: string
  avatar?: CrmOmnisearchAvatar
  to: CrmOmnisearchTarget
}

export interface CrmOmnisearchResponse {
  query: string
  groups: Record<CrmOmnisearchGroupKey, CrmOmnisearchHit[]>
}
