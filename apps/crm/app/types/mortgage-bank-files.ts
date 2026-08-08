export type MortgageBankFileStatus = 'current' | 'draft' | 'expired' | 'archived' | 'processing' | 'failed'

export type MortgageBankFileMimeGroup = 'pdf' | 'spreadsheet' | 'document' | 'image' | 'other'

export interface MortgageBankFileInstitution {
  id: string
  name: string
  logoUrl: string | null
}

export interface MortgageBankFileProduct {
  id: string
  name: string
}

export interface MortgageBankFileCategory {
  id: string
  label: string
  count: number
  icon?: string
  archived?: boolean
}

export interface MortgageBankFileVersion {
  id: string
  version: string
  status: MortgageBankFileStatus
  mimeType: string
  mimeGroup: MortgageBankFileMimeGroup
  sizeBytes: number | null
  checksumSha256: string | null
  pageCount: number | null
  publishedAt: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
  sourceUrl: string | null
  previewUrl: string | null
  downloadUrl: string | null
  extractedText?: string | null
}

export interface MortgageBankFileMatch {
  snippet: string
  location: string | null
  page: number | null
  score?: number | null
}

export interface MortgageBankFileTemplate {
  id: string
  key: string
  label: string
  status: 'draft' | 'published' | 'published_with_draft'
  draftRevision: number
  activeRevision: number
  sourceVersionId: string
  usesCurrentVersion: boolean
}

export interface MortgageBankFileSummary {
  id: string
  title: string
  fileName: string
  categoryId: string | null
  institution: MortgageBankFileInstitution
  products: MortgageBankFileProduct[]
  template: MortgageBankFileTemplate | null
  currentVersion: MortgageBankFileVersion
  matches: MortgageBankFileMatch[]
  addedBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface MortgageBankFileRepositoryPayload {
  files: MortgageBankFileSummary[]
  total: number
  categories: MortgageBankFileCategory[]
  institutions: MortgageBankFileInstitution[]
  products: MortgageBankFileProduct[]
  facets?: {
    statuses?: Partial<Record<MortgageBankFileStatus, number>>
    mimeGroups?: Partial<Record<MortgageBankFileMimeGroup, number>>
  }
  permissions: {
    canUpload: boolean
    canManageCategories: boolean
    canCreateTemplates: boolean
  }
}
