import type {
  MortgageBridgeInsuranceV2,
  MortgageConditionV2,
  MortgageCostRuleV2,
  MortgageOfferVersionV2,
  MortgageEvidenceReferenceV2,
} from '@openexpert/mortgage'

export type MortgageCostKnowledgeStateV2 = MortgageCostRuleV2['state']
export type MortgageCostClassificationV2 = MortgageCostRuleV2['classification']

export type MortgageCostRuleDraftV2 = MortgageCostRuleV2 & {
  notes?: string
}

export type DocumentRequirementItemKindV2 =
  | 'client_document'
  | 'bank_document'
  | 'external_check'
  | 'manual_action'

export type DocumentRequirementCategoryV2 =
  | 'application'
  | 'identity'
  | 'income_employment'
  | 'income_business'
  | 'income_other'
  | 'liabilities'
  | 'transaction'
  | 'property_legal'
  | 'valuation'
  | 'construction_renovation'
  | 'refinance_discharge'
  | 'insurance_security'
  | 'disbursement'
  | 'disclosure_privacy'
  | 'other'

export type DocumentRequirementScopeV2 = 'case' | 'primary_applicant' | 'each_applicant'
export type DocumentRequirementStageV2 = 'analysis' | 'agreement' | 'disbursement' | 'tranche' | 'maintenance'
export type DocumentRequirementApplicabilityV2 = 'always' | 'conditional' | 'optional' | 'case_requested'
export type DocumentRequirementEvidenceV2 =
  | 'confirmed_bank_source'
  | 'inferred'
  | 'expert_default'
  | 'organization_custom'

export interface DocumentRequirementV2 {
  code: string
  label: string
  category: DocumentRequirementCategoryV2
  itemKind: DocumentRequirementItemKindV2
  scope: DocumentRequirementScopeV2
  stage: DocumentRequirementStageV2
  applicability: DocumentRequirementApplicabilityV2
  evidence: DocumentRequirementEvidenceV2
  required: boolean
  multiple: boolean
  allowedMimeTypes: string[]
  templateId?: string
  notes?: string
  when?: MortgageConditionV2
  evidenceRefs?: MortgageEvidenceReferenceV2[]
}

export type OfferSourceKindV2 =
  | 'bank_tariff'
  | 'bank_product_page'
  | 'bank_terms'
  | 'bank_information_sheet'
  | 'regulation'
  | 'expert_note'
  | 'other'

export type OfferSourceRoleV2 = 'pricing' | 'eligibility' | 'costs' | 'documents' | 'legal' | 'general'

export interface OfferSourceV2 {
  id?: string
  title: string
  url: string
  kind: OfferSourceKindV2
  role: OfferSourceRoleV2
  retrievedAt?: string
  publishedAt?: string
  sha256?: string
}

export type MortgageOfferDraftDataV2 = Omit<MortgageOfferVersionV2, 'costs' | 'bridgeInsurance'> & {
  costs: MortgageCostRuleDraftV2[]
  bridgeInsurance?: MortgageBridgeInsuranceV2
  migration?: {
    fromSchema?: string
    sourceVersionId?: string | null
    sourceVersionKey?: string | null
    assumptions?: unknown[]
    unknownFields?: unknown[]
  }
  documentation: {
    requirements: DocumentRequirementV2[]
    sources: OfferSourceV2[]
  }
}
