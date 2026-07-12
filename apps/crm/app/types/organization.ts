export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  role: 'expert' | 'admin'
  isDefault: boolean
}

export interface OrganizationMember {
  userId: string
  email: string
  fullName: string
  role: 'expert' | 'admin'
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
  role: 'member' | 'lead'
  created_at: string
  updated_at: string
}

export interface TeamGraphPayload {
  organization: OrganizationSummary
  teams: TeamNode[]
  edges: TeamEdge[]
  memberships: TeamMembership[]
  members: OrganizationMember[]
}
