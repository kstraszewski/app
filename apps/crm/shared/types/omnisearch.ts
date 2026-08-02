export type CrmOmnisearchKind =
  | 'forum_thread'
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

export interface CrmOmnisearchHit {
  id: string
  kind: CrmOmnisearchKind
  label: string
  description?: string
  suffix?: string
  icon: string
  to: CrmOmnisearchTarget
}

export interface CrmOmnisearchResponse {
  query: string
  groups: Record<CrmOmnisearchGroupKey, CrmOmnisearchHit[]>
}
