export const GENERATED_BUNDLE_STORAGE_KEY = 'openexpert.multiform.generated-bundle.v1'
export const ADMIN_TEMPLATE_DRAFTS_STORAGE_KEY = 'openexpert.multiform.admin-template-drafts.v1'

export interface StoredAdminTemplateDraft {
  text: string
  savedAt: string
}

export type StoredAdminTemplateDrafts = Record<string, StoredAdminTemplateDraft>

