<script setup lang="ts">
import { MULTIFORM_MODEL_DEFINITIONS } from '@openexpert/multiform'
import { DEMO_TEMPLATE_IDS } from '@openexpert/multiform/demo'
import { useEveAgent } from 'eve/vue'
import { GENERATED_BUNDLE_STORAGE_KEY } from '~/utils/multiform-template-storage'
import type {
  FieldValue,
  FormCollectionDefinition,
  FormField,
  FormRenderGroup,
  RepeatableFormGroup,
  RepeatableFormItem,
} from '~/types/multiform-form'

type TabId = 'bundle' | 'template' | 'assistant'

interface TemplateSummary {
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

interface PreparedDocument {
  id?: string
  templateId?: string
  bank?: string
  name?: string
  fileName?: string
}

interface PrepareResponse {
  fields: FormField[]
  collections: FormCollectionDefinition[]
  documents: PreparedDocument[]
  summary: Record<string, unknown>
}

interface CrmContextDocument {
  id: string
  client_id: string | null
  applicant_label: string | null
  name: string
  document_type: string
  mime_type: string | null
  size_bytes: number | null
  sha256: string | null
  status_code: string
  eligible: boolean
  blocker?: string
}

interface CrmContextRequirement {
  code: string
  label: string
  category: string
  itemKind: 'client_document' | 'bank_document' | 'external_check' | 'manual_action'
  scope: 'case' | 'primary_applicant' | 'each_applicant'
  stage: string
  applicability: string
  evidence: string
  required: boolean
  multiple: boolean
  allowedMimeTypes: string[]
  templateId?: string
  notes?: string
  key: string
  ownerClientId: string | null
  ownerLabel: string | null
  documentIds: string[]
  fulfillment: 'attached' | 'generated' | 'missing' | 'manual' | 'conditional' | 'optional'
}

interface CrmContextResponse {
  organization: { slug: string, name: string }
  case: { id: string, title: string }
  applicants: Array<{ clientId: string, label: string, isPrimary: boolean }>
  offer: {
    id: string
    bankId: string | null
    bankName: string
    productId: string | null
    productName: string
    productVersionId: string | null
    versionKey: string | null
  }
  bank: { id: string | null, name: string }
  product: { id: string | null, versionId: string | null, versionKey: string | null, name: string }
  templateIds: string[]
  documentRequirements: Array<Omit<
    CrmContextRequirement,
    'key' | 'ownerClientId' | 'ownerLabel' | 'documentIds' | 'fulfillment'
  >>
  documents: CrmContextDocument[]
  checklist: {
    requirements: CrmContextRequirement[]
    missingAttachmentRequirementCodes: string[]
    missingAttachmentRequirementKeys: string[]
    manualRequirementCodes: string[]
    readyForAttachmentExport: boolean
  }
  selectedOfferValidation: {
    valid: boolean
    blockers: string[]
    templates: Array<{ templateId: string, found: boolean, ready: boolean, warnings: string[] }>
  }
}

interface GeneratedBundleResponse {
  id: string
  status: 'draft'
  templates: Array<{ id: string, label: string, source: { fileName: string } }>
  form: {
    id: string
    label: string
    fields: FormField[]
    collections: FormCollectionDefinition[]
    fieldCount: number
    requiredFieldCount: number
    deduplicationKey: 'canonicalKey'
  }
  generation: {
    model: string
    generatedAt: string
    documentCount: number
  }
  printExport: {
    canFill: boolean
    approvedTemplateIds: string[]
    approvedDocumentCount: number
    reviewRequiredDocumentCount: number
    sourceVerification: 'sha256'
    message: string
  }
  warnings: string[]
}

useHead({
  title: 'Multiform Eve — OpenExpert',
  meta: [
    {
      name: 'description',
      content: 'Uzupełniaj wiele wniosków kredytowych jednym wspólnym formularzem z pomocą Eve.',
    },
  ],
})

const tabs: Array<{ id: TabId, label: string, shortLabel: string }> = [
  { id: 'bundle', label: 'Pakiet wniosków', shortLabel: 'Pakiet' },
  { id: 'template', label: 'Generator template JSON', shortLabel: 'Template JSON' },
  { id: 'assistant', label: 'Asystent Eve', shortLabel: 'Eve' },
]

const activeTab = ref<TabId>('bundle')
const modelBadgeLabel = `${MULTIFORM_MODEL_DEFINITIONS.agent.label} · ${MULTIFORM_MODEL_DEFINITIONS.templateGenerator.label}`
const templateGeneratorModelLabel = MULTIFORM_MODEL_DEFINITIONS.templateGenerator.label
const route = useRoute()
const runtimeConfig = useRuntimeConfig()

// Pakiet wniosków
const templates = ref<TemplateSummary[]>([])
const templatesPending = ref(true)
const templatesError = ref('')
const selectedTemplateIds = ref<string[]>([])
const preparedBundle = ref<PrepareResponse | null>(null)
const values = ref<Record<string, FieldValue>>({})
const preparePending = ref(false)
const prepareError = ref('')
const fillPending = ref(false)
const fillError = ref('')
const validationVisible = ref(false)
const collectionState = ref<Record<string, { count: number, activeIndex: number }>>({})
const crmContext = ref<CrmContextResponse | null>(null)
const crmContextPending = ref(false)
const crmContextError = ref('')
const selectedCrmDocumentIds = ref<string[]>([])

// Generator template JSON
const templateFileInput = ref<HTMLInputElement | null>(null)
const templateFiles = ref<File[]>([])
const generatorPending = ref(false)
const demoFilesPending = ref(false)
const generatorError = ref('')
const generatedTemplate = ref<GeneratedBundleResponse | null>(null)
const generatedCollectionActiveIndex = ref<Record<string, number>>({})

// Asystent Eve
const prompt = ref('')
const messagesEl = ref<HTMLElement | null>(null)
const composerEl = ref<HTMLTextAreaElement | null>(null)
const {
  data: chatData,
  status: chatStatus,
  error: chatError,
  send,
  stop,
  reset,
} = useEveAgent()

const isChatBusy = computed(() => chatStatus.value === 'submitted' || chatStatus.value === 'streaming')

const selectedTemplates = computed(() => {
  const selected = new Set(selectedTemplateIds.value)
  return templates.value.filter(template => selected.has(template.id))
})

const displayedTemplates = computed(() => (
  hasCrmContextQuery.value ? selectedTemplates.value : templates.value
))

const demoTemplates = computed(() => {
  const templateById = new Map(templates.value.map(template => [template.id, template]))
  return DEMO_TEMPLATE_IDS.flatMap((id) => {
    const template = templateById.get(id)
    return template ? [template] : []
  })
})

const selectedWarnings = computed(() => selectedTemplates.value.flatMap(template => (
  template.warnings.map(warning => ({ template: template.name, warning }))
)))

const blockedTemplateWarnings = computed(() => templates.value.flatMap(template => (
  template.ready
    ? []
    : template.warnings.map(warning => ({ template: template.name, warning }))
)))

function routeQueryText(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' ? candidate.trim() : ''
}

const requestedCrmContext = computed(() => ({
  organizationSlug: routeQueryText(route.query.organizationSlug),
  caseId: routeQueryText(route.query.caseId),
  offerId: routeQueryText(route.query.offerId),
}))
const hasCrmContextQuery = computed(() => Object.values(requestedCrmContext.value).some(Boolean))
const hasCompleteCrmContextQuery = computed(() => Object.values(requestedCrmContext.value).every(Boolean))
const crmCaseUrl = computed(() => {
  if (!crmContext.value) return ''
  const configured = String(runtimeConfig.public.openexpert.crmBaseUrl || 'http://127.0.0.1:3004')
  const baseUrl = new URL(configured)
  baseUrl.pathname = `/org/${encodeURIComponent(crmContext.value.organization.slug)}/cases/${encodeURIComponent(crmContext.value.case.id)}`
  baseUrl.search = ''
  baseUrl.hash = ''
  return baseUrl.toString()
})
const crmContextCanPrepare = computed(() => Boolean(
  crmContext.value?.selectedOfferValidation.valid
  && crmContext.value.templateIds.length > 0,
))

function crmRequirementAcceptsAttachment(requirement: CrmContextRequirement) {
  return requirement.itemKind === 'client_document'
    || (requirement.itemKind === 'bank_document' && !requirement.templateId)
}

const crmMissingSelectedRequirements = computed(() => {
  const selectedIds = new Set(selectedCrmDocumentIds.value)
  return (crmContext.value?.checklist.requirements ?? []).filter(requirement => (
    requirement.required
    && crmRequirementAcceptsAttachment(requirement)
    && requirement.applicability === 'always'
    && !requirement.documentIds.some(documentId => selectedIds.has(documentId))
  ))
})
const crmContextCanExport = computed(() => (
  !crmContext.value || crmContextCanPrepare.value && crmMissingSelectedRequirements.value.length === 0
))
const crmSelectedDocumentCount = computed(() => selectedCrmDocumentIds.value.length)

function crmRequirementDocuments(requirement: CrmContextRequirement) {
  return (crmContext.value?.documents ?? []).filter(document => (
    document.document_type === requirement.code
    && (
      requirement.scope === 'case'
      || Boolean(requirement.ownerClientId && document.client_id === requirement.ownerClientId)
    )
  ))
}

function crmRequirementStatus(requirement: CrmContextRequirement) {
  if (requirement.fulfillment === 'generated') return 'Generowany w pakiecie'
  if (requirement.fulfillment === 'manual') return 'Krok ręczny'
  if (requirement.fulfillment === 'conditional') return 'Do potwierdzenia'
  if (requirement.fulfillment === 'optional') return 'Opcjonalny'
  if (requirement.fulfillment === 'missing') return 'Brakuje pliku'
  return 'Plik dostępny'
}

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes < 1) return 'brak rozmiaru'
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`
}

function toggleCrmDocument(
  document: CrmContextDocument,
  requirement: CrmContextRequirement,
  checked: boolean,
) {
  if (!document.eligible) return
  const selected = new Set(selectedCrmDocumentIds.value)
  if (checked) {
    if (!requirement.multiple) {
      for (const documentId of requirement.documentIds) selected.delete(documentId)
    }
    selected.add(document.id)
  }
  else {
    selected.delete(document.id)
  }
  selectedCrmDocumentIds.value = [...selected]
}

function buildFormGroups(
  fields: readonly FormField[],
  collections: readonly FormCollectionDefinition[],
): FormRenderGroup[] {
  const collectionByKey = new Map(collections.map(collection => [collection.key, collection]))
  const sectionFields = new Map<string, FormField[]>()
  for (const field of fields) {
    const section = field.section || 'Pozostałe informacje'
    const current = sectionFields.get(section) ?? []
    current.push(field)
    sectionFields.set(section, current)
  }

  const groups: FormRenderGroup[] = []
  for (const [section, fieldsInSection] of sectionFields) {
    const regularFields = fieldsInSection.filter(field => (
      !field.collection || !collectionByKey.has(field.collection.key)
    ))
    if (regularFields.length) {
      groups.push({
        kind: 'fields',
        id: `fields:${section}`,
        section,
        fields: regularFields,
      })
    }

    const collectionKeys = [...new Set(fieldsInSection.flatMap(field => (
      field.collection && collectionByKey.has(field.collection.key)
        ? [field.collection.key]
        : []
    )))]
    for (const collectionKey of collectionKeys) {
      const collection = collectionByKey.get(collectionKey)
      if (!collection) continue

      const itemFields = new Map<number, FormField[]>()
      for (const field of fieldsInSection) {
        if (field.collection?.key !== collectionKey) continue
        const current = itemFields.get(field.collection.index) ?? []
        current.push(field)
        itemFields.set(field.collection.index, current)
      }
      const items = Array.from(itemFields, ([index, itemFields]) => ({
        index,
        fields: itemFields,
      })).sort((left, right) => left.index - right.index)
      const supportedIndexes = new Set(items.map(item => item.index))
      let supportedItemCount = 0
      while (supportedIndexes.has(supportedItemCount)) supportedItemCount += 1
      if (supportedItemCount === 0) continue

      groups.push({
        kind: 'repeatable',
        id: `collection:${collectionKey}`,
        section,
        collection: {
          ...collection,
          maxItems: Math.min(collection.maxItems, supportedItemCount),
        },
        items: items.filter(item => item.index < supportedItemCount),
      })
    }
  }
  return groups
}

function fieldConditionMatches(condition?: FormField['visibleWhen']) {
  if (!condition) return true
  const value = values.value[condition.canonicalKey]
  if (value === undefined || value === null) return false
  const expected = Array.isArray(condition.equals) ? condition.equals : [condition.equals]
  return expected.includes(String(value))
}

function fieldCollection(field: FormField) {
  if (!field.collection) return undefined
  return preparedBundle.value?.collections.find(collection => collection.key === field.collection?.key)
}

function collectionItemCount(collection: FormCollectionDefinition) {
  return collectionState.value[collection.key]?.count ?? collection.minItems
}

function isCollectionFieldActive(field: FormField) {
  if (!field.collection) return true
  const collection = fieldCollection(field)
  if (!collection) return true
  return field.collection.index < collectionItemCount(collection)
}

function isFieldVisible(field: FormField) {
  return isCollectionFieldActive(field) && fieldConditionMatches(field.visibleWhen)
}

function isFieldRequired(field: FormField) {
  if (!isFieldVisible(field)) return false
  if (field.required || Boolean(field.requiredWhen && fieldConditionMatches(field.requiredWhen))) return true
  const collection = fieldCollection(field)
  return Boolean(
    collection
    && field.collection
    && collection.requiredRelativeKeys.includes(field.collection.relativeKey),
  )
}

const groupedFields = computed(() => {
  const fields = (preparedBundle.value?.fields ?? []).filter(field => (
    field.collection ? fieldConditionMatches(field.visibleWhen) : isFieldVisible(field)
  ))
  return buildFormGroups(fields, preparedBundle.value?.collections ?? [])
})

const generatedGroupedFields = computed(() => {
  return buildFormGroups(
    generatedTemplate.value?.form.fields ?? [],
    generatedTemplate.value?.form.collections ?? [],
  )
})

const requiredFields = computed(() => preparedBundle.value?.fields.filter(isFieldRequired) ?? [])
const missingRequiredFields = computed(() => requiredFields.value.filter((field) => {
  const value = values.value[field.key]
  if (field.type === 'checkbox') return value !== true
  return value === undefined || value === null || String(value).trim() === ''
}))
const invalidFields = computed(() => (preparedBundle.value?.fields ?? []).filter((field) => {
  if (!isFieldVisible(field)) return false
  const value = values.value[field.key]
  if (isFieldRequired(field) && (value === undefined || value === null || String(value).trim() === '')) return true
  if (value === undefined || value === null || String(value).trim() === '') return false

  const stringValue = String(value).trim()
  if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(stringValue)) return true
  if (field.type === 'number' || field.type === 'currency') {
    const numericValue = Number(stringValue.replace(',', '.'))
    if (!Number.isFinite(numericValue)) return true
    if (field.validation?.min !== undefined && numericValue < field.validation.min) return true
    if (field.validation?.max !== undefined && numericValue > field.validation.max) return true
    if (field.validation?.integer && !Number.isInteger(numericValue)) return true
  }
  return false
}))
const completedRequiredCount = computed(() => requiredFields.value.length - missingRequiredFields.value.length)
const formProgress = computed(() => {
  if (requiredFields.value.length === 0) return 100
  return Math.round((completedRequiredCount.value / requiredFields.value.length) * 100)
})

function fieldHasValue(field: FormField) {
  const value = values.value[field.key]
  if (field.type === 'checkbox') return value === true
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function initializeCollectionState(
  fields: FormField[],
  collections: FormCollectionDefinition[],
  nextValues: Record<string, FieldValue>,
) {
  const nextState: Record<string, { count: number, activeIndex: number }> = {}
  const repeatableGroups = buildFormGroups(fields, collections).filter(
    (group): group is RepeatableFormGroup => group.kind === 'repeatable',
  )

  for (const group of repeatableGroups) {
    const previous = collectionState.value[group.collection.key]
    let count = Math.max(group.collection.minItems, previous?.count ?? 0)
    for (const item of group.items) {
      if (item.fields.some(field => {
        const value = nextValues[field.key]
        return value !== undefined && value !== null && String(value).trim() !== ''
      })) {
        count = Math.max(count, item.index + 1)
      }
    }
    count = Math.min(count, group.collection.maxItems)
    const activeIndex = Math.min(previous?.activeIndex ?? 0, Math.max(0, count - 1))
    nextState[group.collection.key] = { count, activeIndex }
  }
  collectionState.value = nextState
}

function initializeGeneratedCollectionState() {
  const nextState: Record<string, number> = {}
  for (const group of generatedGroupedFields.value) {
    if (group.kind === 'repeatable') nextState[group.collection.key] = group.items[0]?.index ?? 0
  }
  generatedCollectionActiveIndex.value = nextState
}

function activeCollectionIndex(group: RepeatableFormGroup) {
  return collectionState.value[group.collection.key]?.activeIndex ?? group.items[0]?.index ?? 0
}

function activeGeneratedCollectionIndex(group: RepeatableFormGroup) {
  return generatedCollectionActiveIndex.value[group.collection.key] ?? group.items[0]?.index ?? 0
}

function activeRepeatableFields(group: RepeatableFormGroup, index = activeCollectionIndex(group)) {
  return group.items.find(item => item.index === index)?.fields ?? []
}

function repeatableManagerItems(group: RepeatableFormGroup) {
  const state = collectionState.value[group.collection.key]
  const count = state?.count ?? group.collection.minItems
  const invalidKeys = new Set(invalidFields.value.map(field => field.key))

  return group.items
    .filter(item => item.index < count)
    .map((item) => {
      const visibleFields = item.fields.filter(isFieldVisible)
      const firstName = visibleFields.find(field => field.collection?.relativeKey === 'firstName')
      const lastName = visibleFields.find(field => field.collection?.relativeKey === 'lastName')
      const name = [firstName, lastName]
        .map(field => field ? String(values.value[field.key] ?? '').trim() : '')
        .filter(Boolean)
        .join(' ')

      return {
        index: item.index,
        label: `${group.collection.itemLabel} ${item.index + 1}`,
        description: name || 'Brak danych',
        filledCount: visibleFields.filter(fieldHasValue).length,
        fieldCount: visibleFields.length,
        invalidCount: visibleFields.filter(field => invalidKeys.has(field.key)).length,
        removable: item.index === count - 1 && count > group.collection.minItems,
      }
    })
}

function generatedManagerItems(group: RepeatableFormGroup) {
  return group.items.map(item => ({
    index: item.index,
    label: `${group.collection.itemLabel} ${item.index + 1}`,
    description: 'Pola gotowe do uzupełnienia',
    filledCount: 0,
    fieldCount: item.fields.length,
    invalidCount: 0,
    removable: false,
  }))
}

function collectionAddLabel(collection: FormCollectionDefinition) {
  return collection.key === 'applicants' ? 'Dodaj wnioskodawcę' : 'Dodaj pozycję'
}

function collectionRemoveLabel(collection: FormCollectionDefinition) {
  return collection.key === 'applicants' ? 'Usuń wnioskodawcę' : 'Usuń pozycję'
}

function collectionLimitLabel(collection: FormCollectionDefinition) {
  return collection.key === 'applicants'
    ? `Ten zestaw dokumentów obsługuje maksymalnie ${collection.maxItems} wnioskodawców.`
    : `Ten zestaw dokumentów obsługuje maksymalnie ${collection.maxItems} pozycji.`
}

function selectCollectionItem(group: RepeatableFormGroup, index: number) {
  const state = collectionState.value[group.collection.key]
  if (!state || index < 0 || index >= state.count) return
  collectionState.value = {
    ...collectionState.value,
    [group.collection.key]: { ...state, activeIndex: index },
  }
}

function selectGeneratedCollectionItem(group: RepeatableFormGroup, index: number) {
  if (!group.items.some(item => item.index === index)) return
  generatedCollectionActiveIndex.value = {
    ...generatedCollectionActiveIndex.value,
    [group.collection.key]: index,
  }
}

function addCollectionItem(group: RepeatableFormGroup) {
  const state = collectionState.value[group.collection.key] ?? {
    count: group.collection.minItems,
    activeIndex: 0,
  }
  if (state.count >= group.collection.maxItems) return
  const nextIndex = state.count
  const nextValues = { ...values.value }
  for (const field of activeRepeatableFields(group, nextIndex)) {
    nextValues[field.key] = field.type === 'checkbox' ? false : ''
  }
  values.value = nextValues
  collectionState.value = {
    ...collectionState.value,
    [group.collection.key]: { count: nextIndex + 1, activeIndex: nextIndex },
  }
  nextTick(() => {
    const firstField = activeRepeatableFields(group, nextIndex)[0]
    if (firstField) document.getElementById(`field-${firstField.key}`)?.focus()
  })
}

function removeCollectionItem(group: RepeatableFormGroup, index: number) {
  const state = collectionState.value[group.collection.key]
  if (
    !state
    || state.count <= group.collection.minItems
    || index !== state.count - 1
  ) {
    return
  }

  const fields = activeRepeatableFields(group, index)
  const hasEnteredData = fields.some(fieldHasValue)
  if (
    hasEnteredData
    && !window.confirm(
      group.collection.key === 'applicants'
        ? `Usunąć wnioskodawcę ${index + 1}? Wprowadzone dane tej osoby zostaną usunięte ze wszystkich przygotowywanych wniosków.`
        : `Usunąć pozycję ${index + 1}? Wprowadzone dane zostaną usunięte ze wszystkich przygotowywanych dokumentów.`,
    )
  ) {
    return
  }

  const nextValues = { ...values.value }
  for (const field of fields) delete nextValues[field.key]
  values.value = nextValues
  collectionState.value = {
    ...collectionState.value,
    [group.collection.key]: {
      count: state.count - 1,
      activeIndex: Math.max(0, state.count - 2),
    },
  }
}

function activeValuesPayload() {
  const activeKeys = new Set(
    (preparedBundle.value?.fields ?? [])
      .filter(isCollectionFieldActive)
      .map(field => field.key),
  )
  return Object.fromEntries(
    Object.entries(values.value).filter(([key]) => activeKeys.has(key)),
  )
}

function collectionCountsPayload() {
  return Object.fromEntries((preparedBundle.value?.collections ?? []).map(collection => [
    collection.key,
    collectionState.value[collection.key]?.count ?? collection.minItems,
  ]))
}

async function focusFirstInvalidField() {
  const field = invalidFields.value[0]
  if (!field) return
  if (field.collection) {
    const state = collectionState.value[field.collection.key]
    if (state) {
      collectionState.value = {
        ...collectionState.value,
        [field.collection.key]: { ...state, activeIndex: field.collection.index },
      }
    }
  }
  await nextTick()
  document.getElementById(`field-${field.key}`)?.focus()
}

const generatedTemplateJson = computed(() => (
  generatedTemplate.value ? JSON.stringify(generatedTemplate.value, null, 2) : ''
))

function readableError(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const candidate = error as { data?: { message?: string, statusMessage?: string }, message?: string }
    return candidate.data?.message || candidate.data?.statusMessage || candidate.message || fallback
  }
  return fallback
}

function coveragePercent(template: TemplateSummary) {
  if (!template.fieldCount) return 0
  return Math.round((template.mappedFieldCount / template.fieldCount) * 100)
}

function manualActionLabel(count: number) {
  if (count === 1) return 'krok ręczny'
  if (count >= 2 && count <= 4) return 'kroki ręczne'
  return 'kroków ręcznych'
}

function fillModeLabel(mode: string) {
  const labels: Record<string, string> = {
    acroform: 'Pola PDF',
    overlay: 'Nakładanie pól',
    hybrid: 'Tryb mieszany',
  }
  return labels[mode.toLowerCase()] ?? mode
}

function documentTitle(document: PreparedDocument, index: number) {
  return document.name || document.bank || document.fileName || `Dokument ${index + 1}`
}

function setActiveTab(tab: TabId) {
  activeTab.value = tab
  if (tab === 'assistant') nextTick(() => composerEl.value?.focus())
}

async function loadTemplates() {
  templatesPending.value = true
  templatesError.value = ''
  try {
    const response = await $fetch<{ templates: TemplateSummary[] }>('/api/multiform/templates')
    templates.value = response.templates ?? []
  }
  catch (error) {
    templatesError.value = readableError(error, 'Nie udało się pobrać listy dokumentów.')
  }
  finally {
    templatesPending.value = false
  }
}

async function loadCrmContext() {
  if (!hasCrmContextQuery.value) return
  crmContextPending.value = true
  crmContextError.value = ''
  crmContext.value = null
  selectedCrmDocumentIds.value = []

  if (!hasCompleteCrmContextQuery.value) {
    crmContextError.value = 'Link do sprawy CRM jest niepełny. Wymagane są organizationSlug, caseId i offerId.'
    crmContextPending.value = false
    return
  }

  try {
    const response = await $fetch<CrmContextResponse>('/api/multiform/crm/context', {
      query: requestedCrmContext.value,
    })
    crmContext.value = response
    selectedTemplateIds.value = [...response.templateIds]

    const selectedDocumentIds = new Set<string>()
    for (const requirement of response.checklist.requirements) {
      if (
        !crmRequirementAcceptsAttachment(requirement)
        || !requirement.required
        || requirement.applicability !== 'always'
      ) continue
      const eligibleDocumentIds = requirement.documentIds.filter(documentId => (
        response.documents.some(document => document.id === documentId && document.eligible)
      ))
      const defaultIds = requirement.multiple ? eligibleDocumentIds : eligibleDocumentIds.slice(0, 1)
      for (const documentId of defaultIds) selectedDocumentIds.add(documentId)
    }
    selectedCrmDocumentIds.value = [...selectedDocumentIds]
  }
  catch (error) {
    crmContextError.value = readableError(error, 'Nie udało się pobrać wybranej sprawy CRM.')
  }
  finally {
    crmContextPending.value = false
  }
}

function toggleTemplate(templateId: string) {
  if (hasCrmContextQuery.value) return
  if (!templates.value.find(template => template.id === templateId)?.ready) return
  if (selectedTemplateIds.value.includes(templateId)) {
    selectedTemplateIds.value = selectedTemplateIds.value.filter(id => id !== templateId)
  }
  else {
    selectedTemplateIds.value = [...selectedTemplateIds.value, templateId]
  }
}

async function prepareSelectedBundle() {
  if (selectedTemplateIds.value.length === 0 || preparePending.value) return
  if (hasCrmContextQuery.value && !crmContextCanPrepare.value) {
    prepareError.value = crmContextError.value || 'Template’y wybranej oferty nie są gotowe do przygotowania.'
    return
  }

  preparePending.value = true
  prepareError.value = ''
  fillError.value = ''
  validationVisible.value = false
  try {
    const response = await $fetch<PrepareResponse>('/api/multiform/bundle/prepare', {
      method: 'POST',
      body: { templateIds: selectedTemplateIds.value },
    })
    preparedBundle.value = response

    const nextValues: Record<string, FieldValue> = {}
    for (const field of response.fields ?? []) {
      const previousValue = values.value[field.key]
      nextValues[field.key] = previousValue ?? (field.type === 'checkbox' ? false : '')
    }
    initializeCollectionState(response.fields ?? [], response.collections ?? [], nextValues)
    values.value = nextValues
    nextTick(() => document.querySelector<HTMLElement>('#wspolny-formularz')?.focus())
  }
  catch (error) {
    preparedBundle.value = null
    collectionState.value = {}
    prepareError.value = readableError(error, 'Nie udało się przygotować wspólnego formularza.')
  }
  finally {
    preparePending.value = false
  }
}

async function fillAndDownloadBundle() {
  if (!preparedBundle.value || fillPending.value) return
  validationVisible.value = true
  fillError.value = ''
  if (!crmContextCanExport.value) {
    fillError.value = `Wybierz załączniki dla wszystkich wymaganych pozycji (${crmMissingSelectedRequirements.value.length}).`
    return
  }
  if (invalidFields.value.length > 0) {
    fillError.value = `Popraw oznaczone pola (${invalidFields.value.length}), aby wygenerować dokumenty.`
    await focusFirstInvalidField()
    return
  }

  fillPending.value = true
  try {
    const blob = await $fetch<Blob>('/api/multiform/bundle/fill', {
      method: 'POST',
      body: {
        templateIds: selectedTemplateIds.value,
        values: activeValuesPayload(),
        collectionCounts: collectionCountsPayload(),
        ...(crmContext.value
          ? {
              crmContext: {
                ...requestedCrmContext.value,
                documentIds: selectedCrmDocumentIds.value,
              },
            }
          : {}),
      },
      responseType: 'blob',
    })
    downloadBlob(blob, `wnioski-kredytowe-${new Date().toISOString().slice(0, 10)}.zip`)
  }
  catch (error) {
    fillError.value = readableError(error, 'Nie udało się wygenerować paczki dokumentów.')
  }
  finally {
    fillPending.value = false
  }
}

function selectTemplateFile(event: Event) {
  const input = event.target as HTMLInputElement
  const selectedFiles = Array.from(input.files ?? [])
  if (selectedFiles.length > 5) {
    templateFiles.value = []
    generatorError.value = 'Możesz wybrać maksymalnie 5 PDF-ów naraz.'
    input.value = ''
    return
  }
  templateFiles.value = [...new Map(
    selectedFiles.map(file => [`${file.name}:${file.size}:${file.lastModified}`, file]),
  ).values()]
  generatedTemplate.value = null
  generatedCollectionActiveIndex.value = {}
  generatorError.value = ''
}

function clearTemplateFile() {
  templateFiles.value = []
  generatedTemplate.value = null
  generatedCollectionActiveIndex.value = {}
  generatorError.value = ''
  if (templateFileInput.value) templateFileInput.value.value = ''
}

function demoPdfUrl(templateId: string) {
  return `/api/multiform/demo-pdfs/${encodeURIComponent(templateId)}`
}

async function loadDemoTemplateFiles() {
  if (demoFilesPending.value || generatorPending.value) return

  demoFilesPending.value = true
  generatorError.value = ''
  generatedTemplate.value = null
  generatedCollectionActiveIndex.value = {}

  try {
    if (templates.value.length === 0) await loadTemplates()
    if (demoTemplates.value.length !== DEMO_TEMPLATE_IDS.length) {
      throw new Error('Nie udało się pobrać kompletnej listy testowych dokumentów.')
    }

    templateFiles.value = await Promise.all(demoTemplates.value.map(async (template) => {
      const blob = await $fetch<Blob>(demoPdfUrl(template.id), { responseType: 'blob' })
      return new File([blob], template.fileName, {
        type: 'application/pdf',
        lastModified: Date.now(),
      })
    }))

    if (templateFileInput.value) templateFileInput.value.value = ''
  }
  catch (error) {
    templateFiles.value = []
    generatorError.value = readableError(error, 'Nie udało się dodać testowych PDF-ów.')
  }
  finally {
    demoFilesPending.value = false
  }
}

async function generateTemplateJson() {
  if (templateFiles.value.length === 0 || generatorPending.value) return
  if (templateFiles.value.some(file => file.type && file.type !== 'application/pdf')) {
    generatorError.value = 'Wybierz wyłącznie pliki PDF.'
    return
  }

  generatorPending.value = true
  generatorError.value = ''
  generatedTemplate.value = null
  generatedCollectionActiveIndex.value = {}
  const formData = new FormData()
  for (const file of templateFiles.value) formData.append('files', file)

  try {
    const response = await $fetch<GeneratedBundleResponse>('/api/multiform/templates/generate', {
      method: 'POST',
      body: formData,
    })
    generatedTemplate.value = response
    if (import.meta.client) {
      try {
        localStorage.setItem(GENERATED_BUNDLE_STORAGE_KEY, JSON.stringify(response))
      }
      catch {
        // The generated result stays available in this view if browser storage is full or disabled.
      }
    }
    initializeGeneratedCollectionState()
  }
  catch (error) {
    generatorError.value = readableError(error, 'Nie udało się przeanalizować dokumentu.')
  }
  finally {
    generatorPending.value = false
  }
}

async function useGeneratedDocuments() {
  const printExport = generatedTemplate.value?.printExport
  if (!printExport?.canFill || printExport.approvedTemplateIds.length === 0) return

  selectedTemplateIds.value = [...printExport.approvedTemplateIds]
  await nextTick()
  setActiveTab('bundle')
  await nextTick()
  await prepareSelectedBundle()
}

function downloadGeneratedTemplate() {
  if (!generatedTemplateJson.value) return
  const baseName = templateFiles.value.length === 1
    ? templateFiles.value[0]?.name.replace(/\.pdf$/i, '') || 'template'
    : 'multiform-template-bundle'
  downloadBlob(
    new Blob([generatedTemplateJson.value], { type: 'application/json;charset=utf-8' }),
    `${baseName}.template.json`,
  )
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function messageText(parts: ReadonlyArray<{ type: string, text?: string }>) {
  return parts
    .filter(part => part.type === 'text' && part.text)
    .map(part => part.text)
    .join('')
}

async function scrollToLatest() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

async function submitPrompt() {
  const message = prompt.value.trim()
  if (!message || isChatBusy.value) return
  prompt.value = ''
  await send({ message })
  composerEl.value?.focus()
}

function startNewConversation() {
  stop()
  reset()
  prompt.value = ''
  nextTick(() => composerEl.value?.focus())
}

watch(selectedTemplateIds, () => {
  preparedBundle.value = null
  prepareError.value = ''
  fillError.value = ''
  validationVisible.value = false
})

watch(
  () => chatData.value.messages,
  () => scrollToLatest(),
  { deep: true },
)

onMounted(async () => {
  await loadTemplates()
  await loadCrmContext()
})
</script>

<template>
  <div class="multiform-page">
    <header class="app-nav">
      <NuxtLink to="/" class="app-brand" aria-label="OpenExpert — strona główna">
        <picture>
          <source srcset="/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
          <img src="/assets/logo-light.svg" alt="" class="app-brand__logo">
        </picture>
        <span>OpenExpert</span>
      </NuxtLink>

      <div class="app-nav__meta">
        <NuxtLink to="/multiform-eve/admin" class="admin-nav-link">Template JSON</NuxtLink>
        <span class="model-badge"><span class="model-badge__dot" />{{ modelBadgeLabel }}</span>
        <span class="experiment-badge">Eksperyment</span>
      </div>
    </header>

    <main class="app-main">
      <section class="page-heading" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">Multiform Eve</p>
          <h1 id="page-title">Jeden zestaw danych. Wiele gotowych wniosków.</h1>
          <p class="page-heading__lead">
            Wybierz dokumenty bankowe, podaj dane klienta tylko raz i pobierz komplet uzupełnionych PDF-ów.
          </p>
        </div>
        <div class="once-card" aria-label="Zasada działania">
          <span class="once-card__icon" aria-hidden="true">1×</span>
          <div><strong>Podaj raz</strong><span>Eve dopasuje wartość do każdego formatu.</span></div>
        </div>
      </section>

      <div class="tabs" role="tablist" aria-label="Funkcje Multiform Eve">
        <button
          v-for="tab in tabs"
          :id="`tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          class="tab-button"
          :class="{ 'tab-button--active': activeTab === tab.id }"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`panel-${tab.id}`"
          @click="setActiveTab(tab.id)"
        >
          <span class="tab-button__full">{{ tab.label }}</span>
          <span class="tab-button__short">{{ tab.shortLabel }}</span>
        </button>
      </div>

      <section
        v-show="activeTab === 'bundle'"
        id="panel-bundle"
        role="tabpanel"
        aria-labelledby="tab-bundle"
        class="panel"
      >
        <div class="panel-heading">
          <div>
            <p class="step-label">Krok 1</p>
            <h2>Wybierz wnioski do pakietu</h2>
            <p>Możesz przygotować kilka formularzy równocześnie. Wspólne dane pojawią się tylko raz.</p>
          </div>
          <div v-if="selectedTemplateIds.length" class="selection-count" aria-live="polite">
            {{ selectedTemplateIds.length }} {{ selectedTemplateIds.length === 1 ? 'dokument' : 'dokumenty' }}
          </div>
        </div>

        <section v-if="hasCrmContextQuery" class="crm-context-card" aria-labelledby="crm-context-title">
          <div v-if="crmContextPending" class="crm-context-loading" aria-busy="true">
            <span class="spinner spinner--dark" aria-hidden="true" />
            <span>Pobieram wybraną sprawę, ofertę i dokumenty z CRM…</span>
          </div>

          <div v-else-if="crmContextError" class="crm-context-error" role="alert">
            <div>
              <strong>Nie można otworzyć kontekstu CRM</strong>
              <span>{{ crmContextError }}</span>
            </div>
            <button type="button" class="button button--secondary" @click="loadCrmContext">Spróbuj ponownie</button>
          </div>

          <template v-else-if="crmContext">
            <header class="crm-context-header">
              <div>
                <p class="step-label">Wybrana sprawa z CRM</p>
                <h3 id="crm-context-title">{{ crmContext.case.title }}</h3>
                <p>{{ crmContext.organization.name }} · oferta aktywnie wybrana w sprawie</p>
              </div>
              <div class="crm-context-actions">
                <span
                  class="crm-context-status"
                  :class="{ 'crm-context-status--blocked': !crmContext.selectedOfferValidation.valid }"
                >
                  {{ crmContext.selectedOfferValidation.valid ? 'Template’y gotowe' : 'Eksport zablokowany' }}
                </span>
                <button type="button" class="button button--secondary button--small" @click="loadCrmContext">Odśwież</button>
                <a v-if="crmCaseUrl" :href="crmCaseUrl" class="button button--secondary button--small">Wróć do sprawy</a>
              </div>
            </header>

            <div class="crm-offer-grid">
              <div><span>Bank</span><strong>{{ crmContext.bank.name }}</strong></div>
              <div><span>Produkt</span><strong>{{ crmContext.product.name }}</strong></div>
              <div><span>Wnioskodawcy</span><strong>{{ crmContext.applicants.length }}</strong></div>
              <div><span>Template’y</span><strong>{{ crmContext.templateIds.length }}</strong></div>
            </div>

            <div v-if="crmContext.selectedOfferValidation.blockers.length" class="crm-template-blocker" role="alert">
              <strong>Nie można przygotować wniosków dla tej oferty</strong>
              <ul>
                <li v-for="blocker in crmContext.selectedOfferValidation.blockers" :key="blocker">{{ blocker }}</li>
              </ul>
              <span>Mapowania trzeba zatwierdzić w panelu Template JSON. Kontrola pokrycia PDF pozostaje aktywna.</span>
            </div>

            <div class="crm-checklist">
              <div class="crm-checklist-heading">
                <div>
                  <strong>Checklist załączników</strong>
                  <span>Zaznaczone pliki trafią do katalogu 02-zalaczniki w pobieranym ZIP-ie.</span>
                </div>
                <span>{{ crmSelectedDocumentCount }} wybranych</span>
              </div>

              <ul v-if="crmContext.checklist.requirements.length" class="crm-requirement-list">
                <li
                  v-for="requirement in crmContext.checklist.requirements"
                  :key="requirement.key"
                  class="crm-requirement"
                  :class="{
                    'crm-requirement--missing': requirement.fulfillment === 'missing',
                    'crm-requirement--conditional': requirement.fulfillment === 'conditional',
                  }"
                >
                  <div class="crm-requirement-header">
                    <div>
                      <strong>{{ requirement.label }}</strong>
                      <span v-if="requirement.ownerLabel">{{ requirement.ownerLabel }}</span>
                      <small v-if="requirement.notes">{{ requirement.notes }}</small>
                    </div>
                    <span>{{ crmRequirementStatus(requirement) }}</span>
                  </div>

                  <div
                    v-if="crmRequirementAcceptsAttachment(requirement) && crmRequirementDocuments(requirement).length"
                    class="crm-document-options"
                  >
                    <label
                      v-for="document in crmRequirementDocuments(requirement)"
                      :key="document.id"
                      class="crm-document-option"
                      :class="{ 'crm-document-option--disabled': !document.eligible }"
                    >
                      <input
                        type="checkbox"
                        :checked="selectedCrmDocumentIds.includes(document.id)"
                        :disabled="!document.eligible"
                        @change="toggleCrmDocument(document, requirement, ($event.target as HTMLInputElement).checked)"
                      >
                      <span>
                        <strong>{{ document.name }}</strong>
                        <small>
                          {{ document.applicant_label ? `${document.applicant_label} · ` : '' }}{{ formatFileSize(document.size_bytes) }}
                        </small>
                        <small v-if="document.blocker" class="crm-document-blocker">{{ document.blocker }}</small>
                      </span>
                    </label>
                  </div>

                  <p
                    v-else-if="crmRequirementAcceptsAttachment(requirement) && requirement.fulfillment === 'missing'"
                    class="crm-requirement-empty"
                  >
                    Brak poprawnego pliku w sprawie CRM. Dodaj go w CRM i odśwież kontekst.
                  </p>
                </li>
              </ul>
              <p v-else class="crm-checklist-empty">Ta oferta nie ma skonfigurowanej checklisty dokumentów.</p>

              <p v-if="crmMissingSelectedRequirements.length" class="crm-selection-warning" role="status">
                Do eksportu brakuje wyboru dla {{ crmMissingSelectedRequirements.length }} wymaganych
                {{ crmMissingSelectedRequirements.length === 1 ? 'pozycji' : 'pozycji' }} checklisty.
              </p>
            </div>
          </template>
        </section>

        <div v-if="templatesPending" class="template-grid" aria-label="Pobieranie dokumentów" aria-busy="true">
          <div v-for="index in 3" :key="index" class="template-card template-card--skeleton">
            <span /><span /><span />
          </div>
        </div>

        <div v-else-if="templatesError" class="state-card state-card--error" role="alert">
          <div>
            <strong>Nie udało się pobrać dokumentów</strong>
            <span>{{ templatesError }}</span>
          </div>
          <button type="button" class="button button--secondary" @click="loadTemplates">Spróbuj ponownie</button>
        </div>

        <div v-else-if="displayedTemplates.length === 0" class="state-card">
          <div><strong>Brak gotowych template’ów</strong><span>Dodaj pierwszy dokument w generatorze template JSON.</span></div>
          <button type="button" class="button button--secondary" @click="setActiveTab('template')">Przejdź do generatora</button>
        </div>

        <div v-else class="template-grid">
          <label
            v-for="template in displayedTemplates"
            :key="template.id"
              class="template-card"
              :class="{
                'template-card--selected': selectedTemplateIds.includes(template.id),
                'template-card--disabled': !template.ready || hasCrmContextQuery,
              }"
              :aria-disabled="!template.ready || hasCrmContextQuery"
              :title="!template.ready ? template.warnings.join(' ') : hasCrmContextQuery ? 'Zestaw wskazuje aktywna oferta CRM.' : undefined"
          >
            <input
              class="sr-only"
              type="checkbox"
                :disabled="!template.ready || hasCrmContextQuery"
              :checked="selectedTemplateIds.includes(template.id)"
              @change="toggleTemplate(template.id)"
            >
            <span class="template-card__check" aria-hidden="true">
              <svg v-if="selectedTemplateIds.includes(template.id)" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6" /></svg>
            </span>
            <span class="template-card__topline">
              <span class="bank-mark">{{ template.bank.slice(0, 2).toUpperCase() }}</span>
              <span
                class="status-pill"
                :class="{ 'status-pill--warning': template.status !== 'gotowy' }"
              >{{ template.status }}</span>
            </span>
            <strong class="template-card__name">{{ template.name }}</strong>
            <span class="template-card__file">{{ template.pages }} str. · {{ fillModeLabel(template.fillMode) }}</span>
            <span class="coverage-row">
              <span>Pokrycie formularza</span><strong>{{ template.mappedFieldCount }}/{{ template.fieldCount }}</strong>
            </span>
            <span class="progress-track" aria-hidden="true"><span :style="{ width: `${coveragePercent(template)}%` }" /></span>
            <span v-if="template.warnings.length" class="warning-count">
              {{ template.warnings.length }} {{ template.warnings.length === 1 ? 'uwaga' : 'uwagi' }}
            </span>
            <span v-if="template.manualUserActionCount" class="manual-action-count">
              + {{ template.manualUserActionCount }} {{ manualActionLabel(template.manualUserActionCount) }}
            </span>
          </label>
        </div>

        <div v-if="!hasCrmContextQuery && blockedTemplateWarnings.length" class="warnings-box">
          <div class="warnings-box__heading">
            <span aria-hidden="true">!</span><strong>Szablony zablokowane do pełnego pokrycia</strong>
          </div>
          <ul>
            <li v-for="(item, index) in blockedTemplateWarnings" :key="`blocked-${item.template}-${index}`">
              <strong>{{ item.template }}:</strong> {{ item.warning }}
            </li>
          </ul>
        </div>

        <div v-if="!hasCrmContextQuery && selectedWarnings.length" class="warnings-box">
          <div class="warnings-box__heading"><span aria-hidden="true">!</span><strong>Uwagi przed przygotowaniem</strong></div>
          <ul>
            <li v-for="(item, index) in selectedWarnings" :key="`${item.template}-${index}`">
              <strong>{{ item.template }}:</strong> {{ item.warning }}
            </li>
          </ul>
        </div>

        <p v-if="prepareError" class="inline-error" role="alert">{{ prepareError }}</p>

        <div class="panel-actions">
          <p>{{ selectedTemplateIds.length ? 'Następnie utworzymy jeden formularz dla wybranych dokumentów.' : 'Zaznacz co najmniej jeden dokument.' }}</p>
          <button
            type="button"
            class="button button--primary"
            :disabled="selectedTemplateIds.length === 0 || preparePending || crmContextPending || (hasCrmContextQuery && !crmContextCanPrepare)"
            @click="prepareSelectedBundle"
          >
            <span v-if="preparePending" class="spinner" aria-hidden="true" />
            {{ preparePending ? 'Analizuję wspólne pola…' : 'Przygotuj wspólny formularz' }}
          </button>
        </div>

        <div v-if="preparedBundle" id="wspolny-formularz" class="shared-form" tabindex="-1">
          <div class="shared-form__header">
            <div>
              <p class="step-label">Krok 2</p>
              <h2>Uzupełnij dane tylko raz</h2>
              <p>Każda wartość zostanie wpisana we właściwe miejsce we wszystkich wybranych wnioskach.</p>
            </div>
            <div class="form-progress" :aria-label="`Uzupełniono ${formProgress}% wymaganych pól`">
              <div><span>Wymagane pola</span><strong>{{ completedRequiredCount }}/{{ requiredFields.length }}</strong></div>
              <span class="progress-track"><span :style="{ width: `${formProgress}%` }" /></span>
            </div>
          </div>

          <div v-if="preparedBundle.documents?.length" class="document-strip" aria-label="Dokumenty w pakiecie">
            <span v-for="(document, index) in preparedBundle.documents" :key="document.id || document.templateId || index">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></svg>
              {{ documentTitle(document, index) }}
            </span>
          </div>

          <form class="fields-form" novalidate @submit.prevent="fillAndDownloadBundle">
            <template v-for="group in groupedFields" :key="group.id">
              <fieldset v-if="group.kind === 'fields'" class="field-section">
                <legend>{{ group.section }}</legend>
                <div class="field-grid">
                  <MultiformFieldControl
                    v-for="field in group.fields"
                    :key="field.key"
                    :field="field"
                    :model-value="values[field.key]"
                    :required="isFieldRequired(field)"
                    :invalid="validationVisible && invalidFields.some(item => item.key === field.key)"
                    @update:model-value="values[field.key] = $event"
                  />
                </div>
              </fieldset>

              <MultiformRepeatableFieldGroup
                v-else
                :group-id="group.id"
                :legend="group.section"
                :item-label="group.collection.itemLabel"
                :items="repeatableManagerItems(group)"
                :active-index="activeCollectionIndex(group)"
                :max-items="group.collection.maxItems"
                :can-add="(collectionState[group.collection.key]?.count ?? group.collection.minItems) < group.collection.maxItems"
                :description="group.collection.key === 'applicants'
                  ? 'Dodaj osoby, które wspólnie składają wniosek. Dane każdej wpisz tylko raz.'
                  : undefined"
                :add-label="collectionAddLabel(group.collection)"
                :remove-label="collectionRemoveLabel(group.collection)"
                :limit-label="collectionLimitLabel(group.collection)"
                @select="selectCollectionItem(group, $event)"
                @add="addCollectionItem(group)"
                @remove="removeCollectionItem(group, $event)"
              >
                <template #default="{ item }">
                  <div class="field-grid">
                    <MultiformFieldControl
                      v-for="field in activeRepeatableFields(group, item.index)"
                      :key="field.key"
                      :field="field"
                      :model-value="values[field.key]"
                      :required="isFieldRequired(field)"
                      :invalid="validationVisible && invalidFields.some(invalidField => invalidField.key === field.key)"
                      @update:model-value="values[field.key] = $event"
                    />
                  </div>
                </template>
              </MultiformRepeatableFieldGroup>
            </template>

            <div v-if="preparedBundle.fields.length === 0" class="state-card">
              <div><strong>Nie znaleziono wspólnych pól</strong><span>Sprawdź template’y lub wybierz inny zestaw dokumentów.</span></div>
            </div>

            <p v-if="fillError" class="inline-error" role="alert">{{ fillError }}</p>

            <div class="download-bar">
              <div>
                <span class="download-bar__label">Wynik</span>
                <strong>
                  {{ selectedTemplateIds.length }} uzupełnione PDF-y
                  <template v-if="crmContext"> + {{ crmSelectedDocumentCount }} załączników</template>
                  w jednej paczce ZIP
                </strong>
              </div>
              <button type="submit" class="button button--primary" :disabled="fillPending || preparedBundle.fields.length === 0 || !crmContextCanExport">
                <span v-if="fillPending" class="spinner" aria-hidden="true" />
                <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
                {{ fillPending ? 'Generuję dokumenty…' : 'Uzupełnij i pobierz ZIP' }}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section
        v-show="activeTab === 'template'"
        id="panel-template"
        role="tabpanel"
        aria-labelledby="tab-template"
        class="panel generator-panel"
      >
        <div class="panel-heading">
          <div>
            <p class="step-label">Narzędzie administratora</p>
            <h2>Wygeneruj template JSON z wielu PDF-ów</h2>
            <p>{{ templateGeneratorModelLabel }} analizuje każdy dokument, a potem tworzy jeden formularz wspólnych danych bez powtórzeń pól.</p>
          </div>
        </div>

        <div class="demo-pdf-kit">
          <div class="demo-pdf-kit__intro">
            <span class="demo-pdf-kit__badge">Demo</span>
            <div>
              <strong>Trzy puste wnioski gotowe do testu</strong>
              <p>Dodaj Erste, PKO BP i Pekao jednym kliknięciem albo otwórz każdy PDF przed analizą.</p>
            </div>
          </div>
          <div class="demo-pdf-list" aria-label="Testowe dokumenty PDF">
            <a
              v-for="template in demoTemplates"
              :key="`demo-${template.id}`"
              class="demo-pdf-card"
              :href="demoPdfUrl(template.id)"
              target="_blank"
              rel="noopener"
            >
              <span class="demo-pdf-card__mark">PDF</span>
              <span>
                <strong>{{ template.bank }}</strong>
                <small>{{ template.pages }} stron · otwórz dokument</small>
              </span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 3h7v7" /><path d="m10 14 11-11" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>
            </a>
          </div>
          <button
            type="button"
            class="button button--secondary demo-pdf-kit__action"
            :disabled="templatesPending || demoFilesPending || generatorPending"
            @click="loadDemoTemplateFiles"
          >
            <span v-if="demoFilesPending" class="spinner" aria-hidden="true" />
            {{ demoFilesPending ? 'Dodaję PDF-y…' : 'Dodaj 3 testowe PDF-y do generatora' }}
          </button>
        </div>

        <div class="generator-layout">
          <div class="upload-column">
            <label class="drop-zone" :class="{ 'drop-zone--ready': templateFiles.length > 0 }">
              <input ref="templateFileInput" class="sr-only" type="file" accept="application/pdf,.pdf" multiple @change="selectTemplateFile">
              <span class="drop-zone__icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M12 18v-6" /><path d="m9 15 3-3 3 3" /></svg>
              </span>
              <template v-if="templateFiles.length">
                <strong>{{ templateFiles.length }} {{ templateFiles.length === 1 ? 'PDF gotowy' : 'PDF-y gotowe' }} do analizy</strong>
                <span v-for="file in templateFiles" :key="`${file.name}:${file.size}`">
                  {{ file.name }} · {{ (file.size / 1024 / 1024).toFixed(2) }} MB
                </span>
              </template>
              <template v-else>
                <strong>Wybierz pliki PDF</strong>
                <span>Do 5 dokumentów analizowanych jako jeden pakiet</span>
              </template>
            </label>

            <button v-if="templateFiles.length" type="button" class="text-button" @click="clearTemplateFile">Usuń wybrane pliki</button>

            <div class="generator-note">
              <strong>Co powstanie?</strong>
              <ol>
                <li>Osobny draft template dla każdego PDF-u</li>
                <li>Scalenie pól według wspólnego canonicalKey</li>
                <li>Jeden formularz bez powtórzeń</li>
              </ol>
            </div>

            <p class="privacy-note">
              Eksperyment wysyła wyodrębnioną treść do Vercel AI Gateway. Nie wgrywaj PDF-ów z prawdziwymi danymi klientów.
            </p>

            <p v-if="generatorError" class="inline-error" role="alert">{{ generatorError }}</p>

            <button type="button" class="button button--primary button--full" :disabled="templateFiles.length === 0 || generatorPending" @click="generateTemplateJson">
              <span v-if="generatorPending" class="spinner" aria-hidden="true" />
              {{ generatorPending ? 'Gemini analizuje pakiet…' : 'Wygeneruj wspólny template JSON' }}
            </button>
          </div>

          <div class="json-column">
            <div class="json-toolbar">
              <div><span class="json-toolbar__dot json-toolbar__dot--red" /><span class="json-toolbar__dot json-toolbar__dot--yellow" /><span class="json-toolbar__dot json-toolbar__dot--green" /><strong>multiform-template-bundle.json</strong></div>
              <div class="json-toolbar__actions">
                <NuxtLink to="/multiform-eve/admin" class="text-button">Otwórz edytor</NuxtLink>
                <button v-if="generatedTemplateJson" type="button" class="text-button" @click="downloadGeneratedTemplate">Pobierz JSON</button>
              </div>
            </div>
            <div v-if="generatorPending" class="json-placeholder" aria-live="polite">
              <span class="spinner spinner--dark" aria-hidden="true" />
              <strong>Analizuję strukturę dokumentów</strong>
              <span>Rozpoznaję pola i usuwam powtórzenia wspólnych kluczy…</span>
            </div>
            <pre v-else-if="generatedTemplateJson" class="json-output" tabindex="0"><code>{{ generatedTemplateJson }}</code></pre>
            <div v-else class="json-placeholder">
              <span class="json-placeholder__braces" aria-hidden="true">{ }</span>
              <strong>Wynik pojawi się tutaj</strong>
              <span>Po analizie zobaczysz drafty dokumentów i jeden wspólny formularz.</span>
            </div>
          </div>
        </div>

        <div v-if="generatedTemplate?.form.fields.length" class="generated-form-preview">
          <div class="panel-heading">
            <div>
              <p class="step-label">Podgląd wyniku</p>
              <h2>{{ generatedTemplate.form.label }}</h2>
              <p>
                {{ generatedTemplate.form.fieldCount }} unikalnych pól dla
                {{ generatedTemplate.generation.documentCount }} dokumentów. Każdy canonicalKey występuje dokładnie raz.
              </p>
            </div>
            <span class="experiment-badge">Draft · do zatwierdzenia</span>
          </div>

          <div class="fields-form generated-form-sections">
            <template v-for="group in generatedGroupedFields" :key="group.id">
              <fieldset v-if="group.kind === 'fields'" class="field-section">
                <legend>{{ group.section }}</legend>
                <div class="field-grid">
                  <MultiformFieldControl
                    v-for="field in group.fields"
                    :key="field.key"
                    :field="field"
                    :input-id="`preview-${field.key}`"
                    :required="field.required || Boolean(field.requiredWhen)"
                    disabled
                  />
                </div>
              </fieldset>

              <MultiformRepeatableFieldGroup
                v-else
                :group-id="`preview-${group.id}`"
                :legend="group.section"
                :item-label="group.collection.itemLabel"
                :items="generatedManagerItems(group)"
                :active-index="activeGeneratedCollectionIndex(group)"
                :max-items="group.collection.maxItems"
                readonly
                description="Podgląd sposobu renderowania danych powtarzalnych z template JSON."
                @select="selectGeneratedCollectionItem(group, $event)"
              >
                <template #default="{ item }">
                  <div class="field-grid">
                    <MultiformFieldControl
                      v-for="field in activeRepeatableFields(group, item.index)"
                      :key="field.key"
                      :field="field"
                      :input-id="`preview-${field.key}`"
                      :required="field.required || group.collection.requiredRelativeKeys.includes(field.collection?.relativeKey ?? '')"
                      disabled
                    />
                  </div>
                </template>
              </MultiformRepeatableFieldGroup>
            </template>
          </div>

          <div
            class="generated-print-export"
            :class="{ 'generated-print-export--ready': generatedTemplate.printExport.canFill }"
          >
            <div>
              <p class="step-label">Wydruk PDF</p>
              <strong>
                {{ generatedTemplate.printExport.canFill
                  ? 'Zweryfikowane mapowania są gotowe'
                  : 'Wydruk wymaga zatwierdzenia mapowań' }}
              </strong>
              <span>{{ generatedTemplate.printExport.message }}</span>
              <small>
                {{ generatedTemplate.printExport.approvedDocumentCount }}/{{ generatedTemplate.generation.documentCount }}
                dokumentów rozpoznanych po dokładnej sumie SHA-256.
              </small>
            </div>
            <button
              v-if="generatedTemplate.printExport.canFill"
              type="button"
              class="button button--primary"
              @click="useGeneratedDocuments"
            >
              Uzupełnij i pobierz {{ generatedTemplate.generation.documentCount }} PDF-y
            </button>
          </div>
        </div>
      </section>

      <section
        v-show="activeTab === 'assistant'"
        id="panel-assistant"
        role="tabpanel"
        aria-labelledby="tab-assistant"
        class="panel assistant-panel"
      >
        <div class="assistant-header">
          <div>
            <p class="step-label">Agent Eve</p>
            <h2>Zapytaj o dokumenty i brakujące dane</h2>
            <p>Agent korzysta z tych samych template’ów i nie wymyśla informacji o kliencie.</p>
          </div>
          <button class="icon-button" type="button" title="Nowa rozmowa" @click="startNewConversation">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" /></svg>
            <span>Nowa rozmowa</span>
          </button>
        </div>

        <div class="chat-shell">
          <div ref="messagesEl" class="chat-messages" aria-live="polite">
            <div v-if="chatData.messages.length === 0" class="chat-empty">
              <div class="eve-mark" aria-hidden="true">e</div>
              <h3>W czym mogę pomóc?</h3>
              <p>Zapytaj, jakich danych brakuje do pakietu, albo poproś o wyjaśnienie konkretnego pola.</p>
              <div class="suggestions">
                <button type="button" @click="prompt = 'Jakie dane są zwykle wspólne dla wszystkich wniosków hipotecznych?'; submitPrompt()">Jakie dane podam tylko raz?</button>
                <button type="button" @click="prompt = 'Pomóż mi przygotować komplet danych klienta do wniosków.'; submitPrompt()">Przygotuj listę danych klienta</button>
              </div>
            </div>

            <ol v-else class="chat-thread">
              <li v-for="message in chatData.messages" :key="message.id" class="chat-message" :class="`chat-message--${message.role}`">
                <div class="chat-message__label">{{ message.role === 'user' ? 'Ty' : 'Eve' }}</div>
                <div class="chat-message__body">{{ messageText(message.parts) }}</div>
              </li>
              <li v-if="isChatBusy" class="chat-message chat-message--assistant">
                <div class="chat-message__label">Eve</div>
                <div class="thinking" role="status"><span /><span /><span /><span class="sr-only">Agent przygotowuje odpowiedź</span></div>
              </li>
            </ol>
          </div>

          <div class="composer-wrap">
            <p v-if="chatError" class="inline-error" role="alert">{{ chatError.message || 'Nie udało się wysłać wiadomości.' }}</p>
            <form class="composer" @submit.prevent="submitPrompt">
              <textarea
                ref="composerEl"
                v-model="prompt"
                rows="1"
                class="composer__input"
                placeholder="Napisz wiadomość do Eve…"
                aria-label="Wiadomość do Eve"
                :disabled="isChatBusy"
                @keydown.enter.exact.prevent="submitPrompt"
              />
              <button v-if="isChatBusy" type="button" class="send-button send-button--stop" aria-label="Zatrzymaj odpowiedź" @click="stop"><span /></button>
              <button v-else type="submit" class="send-button" aria-label="Wyślij wiadomość" :disabled="!prompt.trim()">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
              </button>
            </form>
            <p class="composer-hint">Enter wysyła · Shift + Enter dodaje nową linię</p>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.multiform-page {
  --mf-accent: #2563eb;
  --mf-accent-soft: #eff6ff;
  --mf-positive: #15803d;
  --mf-warning: #b45309;
  min-height: 100vh;
  color: var(--fg-primary);
  background: var(--bg-default);
  font-family: var(--font-sans);
}

.app-nav {
  position: sticky;
  z-index: 20;
  top: 0;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 0 max(24px, calc((100vw - 1180px) / 2));
  border-bottom: 1px solid var(--border-default);
  background: color-mix(in srgb, var(--bg-default) 92%, transparent);
  backdrop-filter: blur(16px);
}

.app-brand,
.app-nav__meta,
.model-badge,
.once-card,
.panel-actions,
.shared-form__header,
.download-bar,
.assistant-header,
.json-toolbar,
.json-toolbar > div,
.warnings-box__heading,
.coverage-row,
.template-card__topline {
  display: flex;
  align-items: center;
}

.app-brand {
  gap: 10px;
  color: var(--fg-primary);
  font-weight: var(--weight-medium);
  text-decoration: none;
  letter-spacing: var(--tracking-snug);
}

.app-brand__logo { display: block; height: 20px; }
.app-nav__meta { gap: 10px; }

.admin-nav-link {
  padding: 7px 10px;
  color: var(--fg-secondary);
  border: 1px solid var(--border-default);
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
  text-decoration: none;
  white-space: nowrap;
}

.admin-nav-link:hover {
  color: var(--fg-primary);
  border-color: var(--border-strong);
}

.model-badge,
.experiment-badge,
.status-pill,
.selection-count {
  border: 1px solid var(--border-default);
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}

.model-badge {
  gap: 7px;
  padding: 7px 10px;
  color: var(--fg-secondary);
  font-family: var(--font-mono);
}

.model-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success-icon, #22c55e);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success-icon, #22c55e) 14%, transparent);
}

.experiment-badge { padding: 7px 10px; color: var(--fg-tertiary); }

.app-main {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
  padding: 58px 0 80px;
}

.page-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 290px;
  gap: 64px;
  align-items: end;
  margin-bottom: 42px;
}

.eyebrow,
.step-label {
  margin: 0 0 10px;
  color: var(--mf-accent);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.page-heading h1 {
  max-width: 780px;
  margin: 0;
  font-family: var(--font-serif);
  font-size: clamp(40px, 5vw, 62px);
  font-weight: var(--weight-regular);
  line-height: 1.02;
  letter-spacing: -.035em;
}

.page-heading__lead {
  max-width: 690px;
  margin: 20px 0 0;
  color: var(--fg-secondary);
  font-size: 17px;
  line-height: 1.65;
}

.once-card {
  gap: 13px;
  padding: 15px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}

.once-card__icon {
  width: 42px;
  height: 42px;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  color: var(--mf-accent);
  background: var(--mf-accent-soft);
  border-radius: 50%;
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
}

.once-card div { display: grid; gap: 3px; }
.once-card strong { font-size: 14px; }
.once-card span:last-child { color: var(--fg-tertiary); font-size: 12px; line-height: 1.4; }

.tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  margin-bottom: 20px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}

.tab-button {
  flex: 1;
  min-height: 42px;
  padding: 9px 14px;
  color: var(--fg-secondary);
  background: transparent;
  border: 0;
  border-radius: calc(var(--radius-lg) - 4px);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
}

.tab-button:hover { color: var(--fg-primary); }
.tab-button--active { color: var(--fg-primary); background: var(--bg-default); box-shadow: var(--shadow-sm); }
.tab-button__short { display: none; }

.panel {
  padding: 34px;
  background: var(--bg-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: 0 16px 50px color-mix(in srgb, var(--fg-primary) 5%, transparent);
}

.panel-heading,
.assistant-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 28px;
}

.panel h2,
.assistant-header h2,
.shared-form h2 {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 29px;
  font-weight: var(--weight-regular);
  letter-spacing: -.02em;
}

.panel-heading p:last-child,
.assistant-header p:last-child,
.shared-form__header p:last-child {
  max-width: 690px;
  margin: 8px 0 0;
  color: var(--fg-secondary);
  font-size: 14px;
  line-height: 1.55;
}

.selection-count { padding: 8px 11px; color: var(--mf-accent); background: var(--mf-accent-soft); border-color: #bfdbfe; }

.crm-context-card {
  margin: -4px 0 26px;
  overflow: hidden;
  background: color-mix(in srgb, var(--mf-accent-soft) 44%, var(--bg-default));
  border: 1px solid color-mix(in srgb, var(--mf-accent) 24%, var(--border-default));
  border-radius: var(--radius-lg);
}
.crm-context-loading,
.crm-context-error { min-height: 92px; display: flex; align-items: center; gap: 12px; padding: 20px; }
.crm-context-error { justify-content: space-between; color: #991b1b; background: #fef2f2; }
.crm-context-error > div { display: grid; gap: 4px; }
.crm-context-error span { font-size: 12px; }
.crm-context-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 20px; border-bottom: 1px solid var(--border-default); }
.crm-context-header h3 { margin: 1px 0 0; font-family: var(--font-serif); font-size: 23px; font-weight: 400; }
.crm-context-header p:last-child { margin: 5px 0 0; color: var(--fg-tertiary); font-size: 11px; }
.crm-context-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 7px; }
.crm-context-status { flex: 0 0 auto; padding: 6px 9px; color: var(--mf-positive); background: color-mix(in srgb, var(--mf-positive) 9%, var(--bg-default)); border: 1px solid color-mix(in srgb, var(--mf-positive) 24%, var(--border-default)); border-radius: 999px; font-size: 10px; font-weight: 700; }
.crm-context-status--blocked { color: var(--mf-warning); background: #fffbeb; border-color: #fde68a; }
.crm-offer-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--border-default); border-bottom: 1px solid var(--border-default); }
.crm-offer-grid > div { min-width: 0; display: grid; gap: 4px; padding: 13px 16px; background: var(--bg-default); }
.crm-offer-grid span { color: var(--fg-tertiary); font-size: 9px; letter-spacing: .06em; text-transform: uppercase; }
.crm-offer-grid strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.crm-template-blocker { display: grid; gap: 7px; padding: 15px 18px; color: #92400e; background: #fffbeb; border-bottom: 1px solid #fde68a; font-size: 11px; }
.crm-template-blocker ul { display: grid; gap: 4px; margin: 0; padding-left: 18px; }
.crm-template-blocker > span { color: var(--fg-secondary); }
.crm-checklist { padding: 18px 20px 20px; }
.crm-checklist-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 13px; }
.crm-checklist-heading > div { display: grid; gap: 3px; }
.crm-checklist-heading strong { font-size: 13px; }
.crm-checklist-heading span { color: var(--fg-tertiary); font-size: 10px; }
.crm-checklist-heading > span { flex: 0 0 auto; padding: 5px 7px; background: var(--bg-default); border: 1px solid var(--border-default); border-radius: 999px; }
.crm-requirement-list { display: grid; gap: 9px; padding: 0; margin: 0; list-style: none; }
.crm-requirement { padding: 12px; background: var(--bg-default); border: 1px solid var(--border-default); border-radius: var(--radius-md); }
.crm-requirement--missing { border-color: #fca5a5; }
.crm-requirement--conditional { border-style: dashed; }
.crm-requirement-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.crm-requirement-header > div { min-width: 0; display: grid; gap: 3px; }
.crm-requirement-header strong { font-size: 12px; }
.crm-requirement-header div > span,
.crm-requirement-header small { color: var(--fg-tertiary); font-size: 10px; line-height: 1.4; }
.crm-requirement-header > span { flex: 0 0 auto; color: var(--fg-secondary); font-size: 10px; }
.crm-document-options { display: grid; gap: 6px; margin-top: 10px; }
.crm-document-option { display: flex; align-items: flex-start; gap: 9px; padding: 9px; background: var(--bg-subtle); border-radius: 7px; cursor: pointer; }
.crm-document-option > input { margin-top: 2px; accent-color: var(--mf-accent); }
.crm-document-option > span { min-width: 0; display: grid; gap: 2px; }
.crm-document-option strong { overflow-wrap: anywhere; font-size: 11px; }
.crm-document-option small { color: var(--fg-tertiary); font-size: 9px; }
.crm-document-option--disabled { opacity: .58; cursor: not-allowed; }
.crm-document-blocker { color: var(--mf-warning) !important; }
.crm-requirement-empty,
.crm-checklist-empty { margin: 9px 0 0; color: #b91c1c; font-size: 10px; }
.crm-selection-warning { margin: 12px 0 0; padding: 9px 11px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 7px; font-size: 10px; }

.template-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.template-card {
  position: relative;
  min-height: 222px;
  display: flex;
  flex-direction: column;
  padding: 18px;
  background: var(--bg-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast);
}

.template-card:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.template-card:focus-within { outline: 2px solid var(--border-focus); outline-offset: 2px; }
.template-card--selected { border-color: var(--mf-accent); box-shadow: 0 0 0 1px var(--mf-accent); }
.template-card--disabled { cursor: not-allowed; opacity: .78; }
.template-card--disabled:hover { border-color: var(--border-default); transform: none; }

.template-card__check {
  position: absolute;
  top: 17px;
  right: 17px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  color: white;
  background: var(--bg-default);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
}

.template-card--selected .template-card__check { background: var(--mf-accent); border-color: var(--mf-accent); }
.template-card__topline { justify-content: space-between; padding-right: 30px; }

.bank-mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  color: var(--fg-secondary);
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  border-radius: 9px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
}

.status-pill { padding: 5px 7px; color: var(--mf-positive); border-color: color-mix(in srgb, var(--mf-positive) 22%, var(--border-default)); }
.status-pill--warning { color: var(--mf-warning); border-color: color-mix(in srgb, var(--mf-warning) 30%, var(--border-default)); }
.template-card__name { margin-top: 17px; padding-right: 8px; font-size: 15px; line-height: 1.35; }
.template-card__file { margin: 5px 0 auto; color: var(--fg-tertiary); font-size: 12px; }
.coverage-row { justify-content: space-between; margin-top: 20px; color: var(--fg-tertiary); font-size: 11px; }
.coverage-row strong { color: var(--fg-secondary); font-family: var(--font-mono); }

.progress-track {
  height: 4px;
  display: block;
  margin-top: 7px;
  overflow: hidden;
  background: var(--bg-muted);
  border-radius: 999px;
}

.progress-track > span { height: 100%; display: block; background: var(--mf-accent); border-radius: inherit; transition: width .3s ease; }
.warning-count,
.manual-action-count { margin-top: 10px; font-size: 11px; }
.warning-count { color: var(--mf-warning); }
.manual-action-count { color: var(--fg-tertiary); }

.template-card--skeleton { gap: 15px; cursor: default; }
.template-card--skeleton span { height: 13px; background: var(--bg-muted); border-radius: 6px; animation: shimmer 1.4s ease-in-out infinite alternate; }
.template-card--skeleton span:first-child { width: 36px; height: 36px; }
.template-card--skeleton span:nth-child(2) { width: 75%; margin-top: 10px; }
.template-card--skeleton span:last-child { width: 45%; }

.warnings-box {
  margin-top: 18px;
  padding: 15px 17px;
  color: var(--mf-warning);
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: var(--radius-md);
  font-size: 12px;
}

.warnings-box__heading { gap: 8px; }
.warnings-box__heading > span { width: 18px; height: 18px; display: grid; place-items: center; border: 1px solid currentColor; border-radius: 50%; font-weight: 700; }
.warnings-box ul { margin: 8px 0 0 26px; padding: 0; line-height: 1.55; }

.panel-actions {
  justify-content: space-between;
  gap: 24px;
  margin-top: 24px;
  padding-top: 22px;
  border-top: 1px solid var(--border-default);
}

.panel-actions p { margin: 0; color: var(--fg-tertiary); font-size: 12px; }

.button {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 10px 16px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity var(--transition-fast), transform var(--transition-fast), background var(--transition-fast);
}

.button:hover:not(:disabled) { transform: translateY(-1px); }
.button:disabled { opacity: .42; cursor: not-allowed; }
.button--primary { color: white; background: var(--mf-accent); border-color: var(--mf-accent); }
.button--primary:hover:not(:disabled) { background: #1d4ed8; }
.button--secondary { color: var(--fg-primary); background: var(--bg-default); border-color: var(--border-strong); }
.button--small { min-height: 31px; padding: 6px 10px; font-size: 10px; }
.button--full { width: 100%; }

.spinner {
  width: 15px;
  height: 15px;
  border: 2px solid color-mix(in srgb, currentColor 28%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin .7s linear infinite;
}

.spinner--dark { color: var(--fg-tertiary); }

.inline-error {
  margin: 16px 0 0;
  padding: 11px 13px;
  color: #991b1b;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: var(--radius-md);
  font-size: 12px;
}

.state-card {
  min-height: 124px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}

.state-card div { display: grid; gap: 5px; }
.state-card span { color: var(--fg-secondary); font-size: 13px; }
.state-card--error { color: #991b1b; background: #fef2f2; border-color: #fecaca; }

.shared-form {
  margin-top: 36px;
  padding-top: 34px;
  border-top: 1px solid var(--border-default);
  outline: none;
}

.shared-form__header { justify-content: space-between; gap: 40px; align-items: flex-end; }
.form-progress { width: 190px; flex: 0 0 auto; }
.form-progress > div { display: flex; justify-content: space-between; color: var(--fg-tertiary); font-size: 11px; }
.form-progress strong { color: var(--fg-secondary); font-family: var(--font-mono); }

.document-strip { display: flex; flex-wrap: wrap; gap: 8px; margin: 22px 0 4px; }
.document-strip > span { display: inline-flex; align-items: center; gap: 7px; padding: 7px 9px; color: var(--fg-secondary); background: var(--bg-subtle); border-radius: 7px; font-size: 11px; }

.fields-form { margin-top: 28px; }
.field-section { min-width: 0; padding: 0; margin: 0 0 32px; border: 0; }
.field-section legend { width: 100%; padding: 0 0 11px; margin-bottom: 17px; border-bottom: 1px solid var(--border-default); font-family: var(--font-serif); font-size: 20px; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 20px; }

.download-bar {
  justify-content: space-between;
  gap: 24px;
  padding: 20px;
  margin-top: 12px;
  background: var(--bg-inverse);
  border-radius: var(--radius-lg);
  color: var(--fg-inverse);
}

.download-bar > div { display: grid; gap: 3px; }
.download-bar__label { opacity: .62; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.download-bar strong { font-size: 13px; }

.generator-layout { display: grid; grid-template-columns: 360px minmax(0, 1fr); gap: 24px; }
.demo-pdf-kit {
  display: grid;
  grid-template-columns: minmax(220px, .8fr) minmax(0, 1.4fr) auto;
  gap: 18px;
  align-items: center;
  margin-bottom: 24px;
  padding: 17px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}
.demo-pdf-kit__intro { display: flex; align-items: flex-start; gap: 11px; }
.demo-pdf-kit__intro > div { display: grid; gap: 4px; }
.demo-pdf-kit__intro strong { font-size: 13px; line-height: 1.35; }
.demo-pdf-kit__intro p { margin: 0; color: var(--fg-tertiary); font-size: 10px; line-height: 1.45; }
.demo-pdf-kit__badge { padding: 5px 7px; color: var(--mf-accent); background: var(--mf-accent-soft); border-radius: 999px; font-family: var(--font-mono); font-size: 9px; font-weight: 700; text-transform: uppercase; }
.demo-pdf-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
.demo-pdf-card { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 9px; color: var(--fg-primary); background: var(--bg-default); border: 1px solid var(--border-default); border-radius: var(--radius-md); text-decoration: none; transition: border-color var(--transition-fast), transform var(--transition-fast); }
.demo-pdf-card:hover { border-color: var(--mf-accent); transform: translateY(-1px); }
.demo-pdf-card > span:nth-child(2) { min-width: 0; display: grid; gap: 2px; }
.demo-pdf-card strong,
.demo-pdf-card small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.demo-pdf-card strong { font-size: 11px; }
.demo-pdf-card small { color: var(--fg-tertiary); font-size: 8px; }
.demo-pdf-card__mark { padding: 4px; color: #b91c1c; background: #fef2f2; border-radius: 4px; font-family: var(--font-mono); font-size: 8px; font-weight: 700; }
.demo-pdf-card > svg { color: var(--fg-tertiary); }
.demo-pdf-kit__action { white-space: nowrap; }
.generated-form-preview { margin-top: 36px; padding-top: 34px; border-top: 1px solid var(--border-default); }
.generated-form-sections { margin-top: 24px; }
.generated-form-sections :disabled { opacity: .68; cursor: not-allowed; }
.generated-print-export {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-top: 28px;
  padding: 18px;
  color: #92400e;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: var(--radius-lg);
}
.generated-print-export--ready {
  color: #166534;
  background: #f0fdf4;
  border-color: #bbf7d0;
}
.generated-print-export > div { display: grid; gap: 5px; }
.generated-print-export .step-label { margin-bottom: 1px; color: currentColor; }
.generated-print-export strong { font-size: 14px; }
.generated-print-export span { color: var(--fg-secondary); font-size: 12px; line-height: 1.45; }
.generated-print-export small { color: var(--fg-tertiary); font-size: 10px; }
.upload-column { min-width: 0; }
.drop-zone { min-height: 190px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; text-align: center; background: var(--bg-subtle); border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); cursor: pointer; transition: border-color var(--transition-fast), background var(--transition-fast); }
.drop-zone:hover { border-color: var(--mf-accent); background: var(--mf-accent-soft); }
.drop-zone--ready { border-style: solid; border-color: color-mix(in srgb, var(--mf-positive) 45%, var(--border-default)); }
.drop-zone__icon { width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 14px; color: var(--mf-accent); background: var(--mf-accent-soft); border-radius: 50%; }
.drop-zone strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
.drop-zone > span:last-child { margin-top: 6px; color: var(--fg-tertiary); font-size: 12px; }
.text-button { padding: 0; color: var(--mf-accent); background: transparent; border: 0; font: inherit; font-size: 12px; cursor: pointer; }
.text-button:hover { text-decoration: underline; }
.upload-column > .text-button { display: block; margin: 10px auto 0; }

.generator-note { padding: 16px; margin: 20px 0; background: var(--bg-subtle); border-radius: var(--radius-md); }
.generator-note strong { font-size: 12px; }
.generator-note ol { display: grid; gap: 7px; margin: 10px 0 0; padding-left: 20px; color: var(--fg-secondary); font-size: 11px; line-height: 1.4; }
.privacy-note { padding: 11px 12px; margin: -8px 0 18px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: var(--radius-md); font-size: 10px; line-height: 1.45; }

.json-column { min-height: 500px; display: grid; grid-template-rows: 43px minmax(0, 1fr); overflow: hidden; color: #d4d4d8; background: #18181b; border: 1px solid #27272a; border-radius: var(--radius-lg); }
.json-toolbar { justify-content: space-between; padding: 0 14px; background: #202024; border-bottom: 1px solid #2d2d31; }
.json-toolbar > div { gap: 6px; }
.json-toolbar strong { margin-left: 7px; color: #a1a1aa; font-family: var(--font-mono); font-size: 10px; font-weight: 500; }
.json-toolbar .text-button { color: #93c5fd; }
.json-toolbar__actions { gap: 14px !important; }
.json-toolbar__actions a { text-decoration: none; }
.json-toolbar__actions a:hover { text-decoration: underline; }
.json-toolbar__dot { width: 8px; height: 8px; border-radius: 50%; }
.json-toolbar__dot--red { background: #f87171; }
.json-toolbar__dot--yellow { background: #fbbf24; }
.json-toolbar__dot--green { background: #4ade80; }
.json-output { max-width: 100%; max-height: 600px; overflow: auto; padding: 20px; margin: 0; font-family: var(--font-mono); font-size: 11px; line-height: 1.65; tab-size: 2; white-space: pre; }
.json-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 30px; color: #71717a; text-align: center; }
.json-placeholder strong { margin: 11px 0 5px; color: #a1a1aa; font-size: 13px; }
.json-placeholder span:last-child { max-width: 320px; font-size: 11px; line-height: 1.45; }
.json-placeholder__braces { font-family: var(--font-mono); font-size: 27px; }

.assistant-panel { padding-bottom: 0; overflow: hidden; }
.assistant-header { margin-bottom: 18px; }
.icon-button { min-height: 36px; display: inline-flex; align-items: center; gap: 8px; padding: 8px 10px; color: var(--fg-secondary); background: transparent; border: 1px solid var(--border-default); border-radius: var(--radius-md); font: inherit; font-size: 11px; cursor: pointer; }
.icon-button:hover { color: var(--fg-primary); border-color: var(--border-strong); }
.chat-shell { height: min(620px, calc(100vh - 280px)); min-height: 480px; display: grid; grid-template-rows: minmax(0, 1fr) auto; border-top: 1px solid var(--border-default); }
.chat-messages { min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
.chat-empty { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 44px 24px; text-align: center; }
.eve-mark { width: 42px; height: 42px; display: grid; place-items: center; margin-bottom: 15px; color: var(--fg-inverse); background: var(--bg-inverse); border-radius: 50%; font-family: var(--font-serif); font-size: 22px; font-style: italic; }
.chat-empty h3 { margin: 0; font-family: var(--font-serif); font-size: 28px; font-weight: 400; }
.chat-empty > p { max-width: 500px; margin: 9px 0 0; color: var(--fg-secondary); font-size: 13px; line-height: 1.55; }
.suggestions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 22px; }
.suggestions button { padding: 8px 11px; color: var(--fg-secondary); background: var(--bg-subtle); border: 1px solid var(--border-default); border-radius: 999px; font: inherit; font-size: 11px; cursor: pointer; }
.suggestions button:hover { color: var(--fg-primary); border-color: var(--border-strong); }
.chat-thread { display: flex; flex-direction: column; gap: 26px; padding: 30px 4px 42px; margin: 0; list-style: none; }
.chat-message { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 18px; }
.chat-message__label { padding-top: 2px; color: var(--fg-tertiary); font-family: var(--font-mono); font-size: 10px; }
.chat-message__body { color: var(--fg-primary); font-size: 14px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-message--user .chat-message__body { color: var(--fg-secondary); }
.thinking { min-height: 24px; display: flex; align-items: center; gap: 5px; }
.thinking > span:not(.sr-only) { width: 5px; height: 5px; background: var(--fg-tertiary); border-radius: 50%; animation: pulse 1.1s infinite ease-in-out; }
.thinking > span:nth-child(2) { animation-delay: 120ms; }
.thinking > span:nth-child(3) { animation-delay: 240ms; }
.composer-wrap { padding: 12px 0 20px; background: linear-gradient(to bottom, transparent, var(--bg-default) 20%); }
.composer { display: grid; grid-template-columns: minmax(0, 1fr) 42px; align-items: end; gap: 10px; padding: 9px; background: var(--bg-default); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); }
.composer:focus-within { border-color: var(--border-focus); box-shadow: 0 0 0 1px var(--border-focus), var(--shadow-md); }
.composer__input { width: 100%; min-height: 42px; max-height: 160px; resize: vertical; padding: 10px 8px; color: var(--fg-primary); background: transparent; border: 0; outline: 0; font: inherit; line-height: 1.45; }
.composer__input::placeholder { color: var(--fg-tertiary); }
.send-button { width: 42px; height: 42px; display: grid; place-items: center; color: var(--fg-inverse); background: var(--bg-inverse); border: 0; border-radius: var(--radius-md); cursor: pointer; }
.send-button:disabled { opacity: .28; cursor: not-allowed; }
.send-button--stop span { width: 11px; height: 11px; background: currentColor; border-radius: 2px; }
.composer-hint { margin: 7px 0 0; color: var(--fg-tertiary); font-size: 10px; text-align: center; }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes shimmer { from { opacity: .45; } to { opacity: 1; } }
@keyframes pulse { 0%, 70%, 100% { opacity: .25; transform: translateY(0); } 35% { opacity: 1; transform: translateY(-2px); } }

@media (max-width: 900px) {
  .app-main { width: min(100% - 32px, 780px); padding-top: 40px; }
  .page-heading { grid-template-columns: 1fr; gap: 22px; }
  .once-card { max-width: 340px; }
  .template-grid { grid-template-columns: 1fr; }
  .crm-offer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .template-card { min-height: 205px; }
  .generator-layout { grid-template-columns: 1fr; }
  .demo-pdf-kit { grid-template-columns: 1fr; }
  .demo-pdf-kit__action { width: 100%; }
  .json-column { min-height: 430px; }
}

@media (max-width: 640px) {
  .app-nav { height: 56px; padding: 0 16px; }
  .model-badge { display: none; }
  .app-main { width: calc(100% - 24px); padding: 30px 0 48px; }
  .page-heading { margin-bottom: 28px; }
  .page-heading h1 { font-size: 39px; }
  .page-heading__lead { font-size: 15px; }
  .tab-button { padding-inline: 7px; font-size: 12px; }
  .tab-button__full { display: none; }
  .tab-button__short { display: inline; }
  .panel { padding: 22px 17px; border-radius: var(--radius-lg); }
  .panel h2,
  .assistant-header h2,
  .shared-form h2 { font-size: 25px; }
  .panel-heading,
  .assistant-header,
  .shared-form__header { flex-direction: column; gap: 17px; }
  .panel-actions,
  .download-bar,
  .generated-print-export { align-items: stretch; flex-direction: column; }
  .panel-actions .button,
  .download-bar .button,
  .generated-print-export .button { width: 100%; }
  .field-grid { grid-template-columns: 1fr; }
  .form-progress { width: 100%; }
  .state-card { align-items: stretch; flex-direction: column; }
  .crm-context-header,
  .crm-context-error,
  .crm-checklist-heading,
  .crm-requirement-header { align-items: stretch; flex-direction: column; }
  .crm-context-status { align-self: flex-start; }
  .crm-offer-grid { grid-template-columns: 1fr; }
  .json-column { min-height: 380px; }
  .demo-pdf-list { grid-template-columns: 1fr; }
  .assistant-panel { padding-bottom: 0; }
  .assistant-header .icon-button span { display: none; }
  .chat-shell { height: min(620px, calc(100vh - 240px)); min-height: 440px; }
  .chat-message { grid-template-columns: 1fr; gap: 5px; }
  .chat-empty { padding-inline: 4px; }
  .suggestions { flex-direction: column; }
}

@media (prefers-reduced-motion: reduce) {
  .spinner,
  .thinking > span:not(.sr-only),
  .template-card--skeleton span { animation: none; }
  .progress-track > span { transition: none; }
}

@media (prefers-color-scheme: dark) {
  .multiform-page { --mf-accent: #60a5fa; --mf-accent-soft: #172554; --mf-positive: #4ade80; --mf-warning: #fbbf24; }
  .selection-count { border-color: #1e40af; }
  .warnings-box { background: #422006; border-color: #713f12; }
  .crm-context-status--blocked,
  .crm-template-blocker,
  .crm-selection-warning { background: #422006; border-color: #713f12; }
  .crm-context-error { color: #fecaca; background: #450a0a; }
  .generated-print-export { background: #422006; border-color: #713f12; }
  .generated-print-export--ready { background: #052e16; border-color: #166534; }
  .inline-error,
  .state-card--error { color: #fecaca; background: #450a0a; border-color: #7f1d1d; }
  .download-bar { border: 1px solid var(--border-default); }
}
</style>
