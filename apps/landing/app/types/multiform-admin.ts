import type {
  DocumentTemplate,
  TemplateValidationResult,
} from '@openexpert/multiform'

export interface MultiformTemplateSummary {
  id: string
  bank: string
  name: string
  fileName: string
  pages: number
  fillMode: string
  status: string
  ready: boolean
  fieldCount: number
  mappedFieldCount: number
  manualUserActionCount: number
  warnings: string[]
}

export interface RegisteredAdminTemplate {
  key: string
  kind: 'registered'
  id: string
  label: string
  bank: string
  template: DocumentTemplate
  summary: MultiformTemplateSummary
  validation: TemplateValidationResult
}

export interface AdminTemplatesResponse {
  schemaVersion: 1
  templates: RegisteredAdminTemplate[]
}

