import type { FieldCondition } from '@openexpert/multiform'

export type FieldValue = string | number | boolean
export type FieldOption = string | { label: string, value: string }

export interface FormCollectionFieldRef {
  key: string
  index: number
  displayIndex: number
  relativeKey: string
  label: string
}

export interface FormCollectionDefinition {
  key: string
  label: string
  itemLabel: string
  minItems: number
  maxItems: number
  requiredRelativeKeys: string[]
}

export interface FormField {
  key: string
  label: string
  question?: string
  helpText?: string
  type: string
  section: string
  required: boolean
  options?: FieldOption[]
  placeholder?: string
  description?: string
  semanticDescription?: string
  semanticRole?: string
  aiMappingHints?: {
    aliases: string[]
    exclude: string[]
  }
  collection?: FormCollectionFieldRef
  visibleWhen?: FieldCondition
  requiredWhen?: FieldCondition
  validation?: {
    pattern?: string
    min?: number
    max?: number
    integer?: boolean
  }
}

export interface FlatFormGroup {
  kind: 'fields'
  id: string
  section: string
  fields: FormField[]
}

export interface RepeatableFormItem {
  index: number
  fields: FormField[]
}

export interface RepeatableFormGroup {
  kind: 'repeatable'
  id: string
  section: string
  collection: FormCollectionDefinition
  items: RepeatableFormItem[]
}

export type FormRenderGroup = FlatFormGroup | RepeatableFormGroup
