export interface OrganizationCapabilities {
  organizationAdmin: boolean
  teamAdmin: boolean
  facilityAdmin: boolean
  canManageTeams: boolean
}

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  role: 'expert' | 'admin'
  isDefault: boolean
  capabilities: OrganizationCapabilities
}

export interface OrganizationMember {
  userId: string
  email: string
  fullName: string
  avatarUrl: string | null
  role: 'expert' | 'admin'
  adminRoles?: Array<
    | 'organization_admin'
    | 'access_admin'
    | 'structure_admin'
    | 'consents_admin'
    | 'crm_config_admin'
  >
  status?: 'active' | 'pending' | 'inactive'
  teams?: string[]
  facilities?: string[]
  createdAt?: string
  lastActivityAt?: string | null
}

export interface TeamNode {
  id: string
  organization_id: string
  name: string
  slug: string
  kind: 'team' | 'department' | 'division' | 'other'
  description: string | null
  created_at: string
  updated_at: string
  accessLevel?: 'organization_admin' | 'team_admin' | 'inherited'
}

export interface TeamEdge {
  organization_id: string
  parent_team_id: string
  child_team_id: string
  created_at: string
}

export interface TeamMembership {
  organization_id: string
  team_id: string
  user_id: string
  role: 'member' | 'admin'
  created_at: string
  updated_at: string
}

export interface TeamGraphPayload {
  organization: OrganizationSummary
  teams: TeamNode[]
  edges: TeamEdge[]
  memberships: TeamMembership[]
  members: OrganizationMember[]
  access: {
    canCreate: boolean
    managedTeamIds: string[]
    directAdminTeamIds: string[]
  }
}

export interface TeamDetailMember {
  membership: TeamMembership
  user: {
    id: string
    email: string
    fullName: string
    avatarUrl: string | null
  }
}

export interface TeamDetailPayload {
  data: {
    team: TeamNode
    members: TeamDetailMember[]
    facilities: Facility[]
    parents: TeamNode[]
    children: TeamNode[]
    stats: {
      memberCount: number
      adminCount: number
      facilityCount: number
      childTeamCount: number
    }
  }
  access: {
    canView: true
    canManage: boolean
    canDelete: boolean
    canManageStructure: boolean
  }
  organization: OrganizationSummary
}
import type { Facility } from './scheduling'
