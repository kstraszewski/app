<script setup lang="ts">
import type {
  CaseBankApplication,
  CaseDetail,
  MortgageApplicationStatus,
  SavedCaseOffer,
} from '~/types/cases'
import type {
  CaseMultiformDraftResponse,
  CaseMultiformDraftSaveResponse,
  MultiformCollectionDefinition,
  MultiformCrmContext,
  MultiformFieldValue,
  MultiformFormField,
  MultiformPrepareResponse,
  MultiformRenderGroup,
  MultiformRepeatableGroup,
} from '~/types/multiform'
import {
  createEmptyMultiformIntake,
  getMultiformIntakeProgress,
  normalizeMultiformIntake,
  resolveMultiformIntakeRequirement,
  validateMultiformIntake,
  type MultiformIntakeAnswers,
} from '#shared/multiform-intake'

const props = defineProps<{
  caseData: CaseDetail
}>()

const emit = defineEmits<{
  refresh: []
}>()

const { crmApiPath, orgPath } = useOrganizationContext()
const toast = useToast()

const contextPending = ref(false)
const draftPending = ref(false)
const preparePending = ref(false)
const fillPending = ref(false)
const contextError = ref('')
const draftError = ref('')
const prepareError = ref('')
const fillError = ref('')
const context = ref<MultiformCrmContext | null>(null)
const preparedBundle = ref<MultiformPrepareResponse | null>(null)
const selectedDocumentIds = ref<string[]>([])
const values = ref<Record<string, MultiformFieldValue>>({})
const collectionCounts = ref<Record<string, number>>({})
const activeCollectionTabs = ref<Record<string, string>>({})
const activeStep = ref(1)
const intakeAnswers = ref<MultiformIntakeAnswers>(
  createEmptyMultiformIntake(props.caseData.clients.map(client => client.id)),
)
const intakeValidationVisible = ref(false)
const autoFilledCount = ref(0)
const validationVisible = ref(false)
const exportComplete = ref(false)
const formHeading = ref<HTMLElement | null>(null)
const intakePanel = ref<{ focusIssue?: (issue: unknown) => Promise<void> | void } | null>(null)

const selectionFingerprint = ref('')
const draftRevision = ref(0)
const draftReady = ref(false)
const draftSaving = ref(false)
const draftSavedAt = ref('')
const draftDirty = ref(false)
const restoringDraft = ref(false)
let draftSaveTimer: ReturnType<typeof setTimeout> | undefined

const activeApplicationStatuses = new Set<MortgageApplicationStatus>([
  'draft',
  'wyslane',
  'w_analizie',
  'braki',
  'zaakceptowane',
])

const applicationStatusMeta: Record<MortgageApplicationStatus, {
  label: string
  color: 'neutral' | 'info' | 'warning' | 'success' | 'error'
}> = {
  draft: { label: 'Szkic', color: 'neutral' },
  wyslane: { label: 'Wysłany', color: 'info' },
  w_analizie: { label: 'W analizie', color: 'info' },
  braki: { label: 'Braki', color: 'warning' },
  zaakceptowane: { label: 'Zaakceptowany', color: 'success' },
  odrzucone: { label: 'Odrzucony', color: 'error' },
  wycofane: { label: 'Wycofany', color: 'neutral' },
}

function applicationIsFinal(application: CaseBankApplication) {
  const finalId = props.caseData.contract_application_id
  return Boolean(finalId && (
    application.id === finalId
    || application.submission_id === finalId
  ))
}

const activeApplications = computed(() => {
  const applications = [...props.caseData.bank_applications]
    .sort((left, right) => left.slot - right.slot)
  if (props.caseData.contract_application_id) {
    return applications.filter(applicationIsFinal)
  }
  return applications.filter(application => activeApplicationStatuses.has(application.status_code))
})

function offerTemplateIds(offer: SavedCaseOffer | null | undefined) {
  const configured = offer?.catalog_snapshot?.version?.multiform_template_ids
  return Array.isArray(configured)
    ? configured
        .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
        .map(id => id.trim())
    : []
}

const activeApplicationDetails = computed(() => activeApplications.value.map((application) => {
  const offer = props.caseData.offers.find(item => item.id === application.offer_id) ?? null
  const property = props.caseData.properties.find(item => item.id === application.property_id) ?? null
  return { application, offer, property }
}))

const primaryApplication = computed(() => activeApplicationDetails.value[0] ?? null)
const primaryOffer = computed(() => primaryApplication.value?.offer ?? null)
const activeProperty = computed(() => (
  primaryApplication.value?.property
  ?? props.caseData.properties.find(property => property.id === props.caseData.selected_property_id)
  ?? null
))

const templateIds = computed(() => (
  context.value?.templateIds
  ?? [...new Set(activeApplicationDetails.value.flatMap(({ offer }) => offerTemplateIds(offer)))]
))

const applicationCount = computed(() => activeApplications.value.length)
const bankNames = computed(() => [...new Set(activeApplicationDetails.value.map(({ offer }) => (
  offer?.bank_name || 'Bank'
)))])

const applicationCards = computed(() => activeApplicationDetails.value.map(({ application, offer, property }) => ({
  id: application.id,
  slot: application.slot,
  bankName: offer?.bank_name || 'Bank',
  productName: offer?.product_name || 'Oferta kredytowa',
  status: applicationStatusMeta[application.status_code],
  propertyLabel: property
    ? [property.address, property.city].filter(Boolean).join(', ')
    : 'Dane nieruchomości wspólne dla sprawy',
  templateCount: offerTemplateIds(offer).length,
  isFinal: applicationIsFinal(application),
})))

function bankCountLabel(count: number) {
  if (count === 1) return '1 bank'
  if (count >= 2 && count <= 4) return `${count} banki`
  return `${count} banków`
}

const prerequisite = computed(() => {
  if (!props.caseData.clients.length) return 'Najpierw dodaj wnioskodawców do sprawy.'
  if (!props.caseData.bank_applications.length) {
    return 'Najpierw uruchom co najmniej jeden wniosek bankowy. Możesz przygotować do trzech banków równolegle.'
  }
  if (!activeApplications.value.length) {
    return 'Sprawa nie ma aktywnego wniosku bankowego do przygotowania.'
  }
  return ''
})

const workflowSteps = computed(() => [
  {
    title: 'Zakres sprawy',
    description: activeStep.value > 0 ? 'Ukończono' : 'W trakcie',
    icon: activeStep.value > 0 ? 'i-lucide-check' : undefined,
  },
  {
    title: 'Pytania wstępne',
    description: activeStep.value === 1
      ? 'W trakcie'
      : activeStep.value > 1 ? 'Ukończono' : 'Oczekuje',
  },
  {
    title: 'Dokumenty',
    description: activeStep.value === 2
      ? 'W trakcie'
      : activeStep.value > 2 ? 'Ukończono' : 'Oczekuje',
  },
  {
    title: 'Formularze bankowe',
    description: activeStep.value === 3
      ? 'W trakcie'
      : activeStep.value > 3 ? 'Ukończono' : 'Oczekuje',
  },
  {
    title: 'Paczka ZIP',
    description: activeStep.value === 4 ? 'W trakcie' : 'Oczekuje',
  },
])

const mappingsReady = computed(() => Boolean(
  context.value?.selectedApplicationsValidation.valid,
))

const contextCanPrepare = computed(() => Boolean(
  context.value
  && context.value.applicationIds.length > 0
  && context.value.templateIds.length > 0
  && context.value.selectedApplicationsValidation.templates.every(template => template.found),
))

const formPreparationBlocker = computed(() => {
  if (!templateIds.value.length) {
    return 'Checklista jest dostępna, ale ten bank nie ma jeszcze przypisanego formularza PDF. Formularze i paczka ZIP odblokują się po dodaniu szablonu banku.'
  }
  if (context.value && !context.value.selectedApplicationsValidation.templates.every(template => template.found)) {
    return 'Co najmniej jeden przypisany formularz PDF banku nie jest dostępny.'
  }
  return ''
})

function requirementAcceptsAttachment(
  requirement: MultiformCrmContext['checklist']['requirements'][number],
) {
  return requirement.itemKind === 'client_document'
    || (requirement.itemKind === 'bank_document' && !requirement.templateId)
}

const intakeValidation = computed(() => validateMultiformIntake(
  intakeAnswers.value,
  props.caseData.clients.map(client => client.id),
))

const resolvedDocumentRequirements = computed(() => (
  (context.value?.checklist.requirements ?? []).flatMap((requirement) => {
    if (!requirementAcceptsAttachment(requirement)) return []
    const resolution = resolveMultiformIntakeRequirement(requirement, intakeAnswers.value)
    if (resolution.phase !== 'analysis' || resolution.status !== 'required') return []
    return [{
      ...requirement,
      required: true,
      applicability: 'always',
    }]
  })
))

const missingSelectedRequirements = computed(() => {
  const selected = new Set(selectedDocumentIds.value)
  return resolvedDocumentRequirements.value.filter(requirement => (
    !requirement.documentIds.some(documentId => selected.has(documentId))
  ))
})

const documentStepComplete = computed(() => missingSelectedRequirements.value.length === 0)
const contextCanExport = computed(() => Boolean(
  mappingsReady.value && documentStepComplete.value,
))
const selectedDocumentCount = computed(() => selectedDocumentIds.value.length)

function readableError(error: unknown, fallback: string) {
  return apiErrorMessage(error) || fallback
}

function initializeDocumentSelection(
  nextContext: MultiformCrmContext,
  preferredDocumentIds: readonly string[] = selectedDocumentIds.value,
) {
  const existingIds = new Set(nextContext.documents.map(document => document.id))
  const selected = new Set(
    preferredDocumentIds.filter(documentId => existingIds.has(documentId)),
  )
  for (const requirement of nextContext.checklist.requirements) {
    if (!requirementAcceptsAttachment(requirement)) continue
    const resolution = resolveMultiformIntakeRequirement(requirement, intakeAnswers.value)
    if (resolution.phase !== 'analysis' || resolution.status !== 'required') continue
    const eligible = requirement.documentIds.filter(documentId => (
      nextContext.documents.some(document => document.id === documentId && document.eligible)
    ))
    if (eligible.some(documentId => selected.has(documentId))) continue
    for (const documentId of requirement.multiple ? eligible : eligible.slice(0, 1)) {
      selected.add(documentId)
    }
  }
  selectedDocumentIds.value = [...selected]
}

async function loadContext(options: { preservePrepared?: boolean } = {}) {
  if (prerequisite.value || contextPending.value) return
  contextPending.value = true
  contextError.value = ''
  prepareError.value = ''
  fillError.value = ''
  const preferredDocumentIds = [...selectedDocumentIds.value]
  if (!options.preservePrepared) preparedBundle.value = null
  try {
    const response = await $fetch<MultiformCrmContext>(
      crmApiPath(`/cases/${props.caseData.id}/multiform/context`),
    )
    context.value = response
    initializeDocumentSelection(response, preferredDocumentIds)
  }
  catch (error) {
    contextError.value = readableError(error, 'Nie udało się pobrać kontekstu Multiwniosku.')
  }
  finally {
    contextPending.value = false
  }
}

function normalizeDraftValues(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(
    (entry): entry is [string, MultiformFieldValue] => (
      typeof entry[1] === 'string'
      || typeof entry[1] === 'number'
      || typeof entry[1] === 'boolean'
    ),
  ))
}

function defaultIntakeAnswers() {
  const answers = createEmptyMultiformIntake(props.caseData.clients.map(client => client.id))
  let count = 0
  const property = activeProperty.value
  if (property?.market_type === 'primary') {
    answers.case.loanPurpose = 'purchase_primary'
    count += 1
  }
  else if (property?.market_type === 'secondary') {
    answers.case.loanPurpose = 'purchase_secondary'
    count += 1
  }
  if (property?.appraisal_value_amount != null) {
    answers.case.appraisalAvailable = true
    count += 1
  }
  if (answers.case.loanPurpose?.startsWith('purchase_')) {
    answers.case.trancheDisbursement = false
    count += 1
  }
  return { answers, count }
}

async function loadDraft() {
  draftPending.value = true
  draftError.value = ''
  try {
    const response = await $fetch<CaseMultiformDraftResponse>(
      crmApiPath(`/cases/${props.caseData.id}/multiform/draft`),
    )
    const defaults = defaultIntakeAnswers()
    selectionFingerprint.value = response.selectionFingerprint
    autoFilledCount.value = defaults.count
    draftRevision.value = response.draft?.revision ?? 0

    if (
      response.draft
      && response.draft.selectionFingerprint === response.selectionFingerprint
    ) {
      intakeAnswers.value = normalizeMultiformIntake(
        response.draft.intakeAnswers,
        props.caseData.clients.map(client => client.id),
      )
      autoFilledCount.value = Math.max(
        defaults.count,
        getMultiformIntakeProgress(
          intakeAnswers.value,
          props.caseData.clients.map(client => client.id),
        ).completed,
      )
      values.value = normalizeDraftValues(response.draft.formValues)
      collectionCounts.value = { ...response.draft.collectionCounts }
      selectedDocumentIds.value = [...response.draft.selectedDocumentIds]
      activeStep.value = Math.max(0, Math.min(4, response.draft.activeStep - 1))
      draftSavedAt.value = response.draft.updatedAt
    }
    else {
      intakeAnswers.value = defaults.answers
      values.value = {}
      collectionCounts.value = {}
      selectedDocumentIds.value = []
      activeStep.value = 1
      draftSavedAt.value = ''
    }
    draftReady.value = true
  }
  catch (error) {
    const defaults = defaultIntakeAnswers()
    intakeAnswers.value = defaults.answers
    autoFilledCount.value = defaults.count
    activeStep.value = 1
    draftError.value = readableError(error, 'Nie udało się wczytać automatycznego zapisu.')
  }
  finally {
    draftPending.value = false
  }
}

function resetWorkspace() {
  context.value = null
  preparedBundle.value = null
  selectedDocumentIds.value = []
  values.value = {}
  collectionCounts.value = {}
  activeCollectionTabs.value = {}
  activeStep.value = 1
  contextError.value = ''
  draftError.value = ''
  prepareError.value = ''
  fillError.value = ''
  selectionFingerprint.value = ''
  draftRevision.value = 0
  draftReady.value = false
  draftSavedAt.value = ''
  draftDirty.value = false
  intakeValidationVisible.value = false
  validationVisible.value = false
  exportComplete.value = false
}

async function bootstrapWorkspace() {
  if (prerequisite.value) return
  restoringDraft.value = true
  resetWorkspace()
  restoringDraft.value = true
  await loadContext()
  if (context.value) {
    await loadDraft()
    initializeDocumentSelection(context.value, selectedDocumentIds.value)
    const restoredStep = activeStep.value
    if (
      restoredStep >= 3
      && intakeValidation.value.valid
      && documentStepComplete.value
    ) {
      activeStep.value = 2
      await prepareForm(false)
      if (preparedBundle.value) activeStep.value = restoredStep
    }
  }
  restoringDraft.value = false
}

function scheduleDraftSave() {
  if (!draftReady.value || restoringDraft.value || !selectionFingerprint.value) return
  draftDirty.value = true
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = undefined
    void saveDraftNow()
  }, 700)
}

async function saveDraftNow() {
  if (
    !draftReady.value
    || restoringDraft.value
    || !selectionFingerprint.value
    || draftSaving.value
  ) return
  draftSaving.value = true
  draftError.value = ''
  try {
    while (draftDirty.value) {
      draftDirty.value = false
      const response = await $fetch<CaseMultiformDraftSaveResponse>(
        crmApiPath(`/cases/${props.caseData.id}/multiform/draft`),
        {
          method: 'PUT',
          body: {
            selectionFingerprint: selectionFingerprint.value,
            revision: draftRevision.value,
            activeStep: activeStep.value + 1,
            intakeAnswers: intakeAnswers.value,
            formValues: values.value,
            collectionCounts: collectionCounts.value,
            selectedDocumentIds: selectedDocumentIds.value,
          },
        },
      )
      draftRevision.value = response.draft.revision
      draftSavedAt.value = response.draft.updatedAt
    }
  }
  catch (error) {
    draftError.value = readableError(error, 'Nie udało się zapisać zmian.')
    draftReady.value = false
  }
  finally {
    draftSaving.value = false
  }
}

function conditionMatches(condition?: MultiformFormField['visibleWhen']) {
  if (!condition) return true
  const value = values.value[condition.canonicalKey]
  if (value === undefined || value === null) return false
  const expected = Array.isArray(condition.equals) ? condition.equals : [condition.equals]
  return expected.includes(String(value))
}

function fieldCollection(field: MultiformFormField) {
  if (!field.collection) return undefined
  return preparedBundle.value?.collections.find(
    collection => collection.key === field.collection?.key,
  )
}

function collectionItemCount(collection: MultiformCollectionDefinition) {
  return collectionCounts.value[collection.key] ?? collection.minItems
}

function fieldIsActive(field: MultiformFormField) {
  if (!field.collection) return true
  const collection = fieldCollection(field)
  if (!collection) return true
  return field.collection.index < collectionItemCount(collection)
}

function fieldIsVisible(field: MultiformFormField) {
  return fieldIsActive(field) && conditionMatches(field.visibleWhen)
}

function fieldIsRequired(field: MultiformFormField) {
  if (!fieldIsVisible(field)) return false
  if (field.required || Boolean(field.requiredWhen && conditionMatches(field.requiredWhen))) {
    return true
  }
  const collection = fieldCollection(field)
  return Boolean(
    collection
    && field.collection
    && collection.requiredRelativeKeys.includes(field.collection.relativeKey),
  )
}

function valueIsMissing(field: MultiformFormField) {
  const value = values.value[field.key]
  if (field.type === 'checkbox') return value !== true
  return value === undefined || value === null || String(value).trim() === ''
}

function fieldIsInvalid(field: MultiformFormField) {
  if (!fieldIsVisible(field)) return false
  if (fieldIsRequired(field) && valueIsMissing(field)) return true
  if (valueIsMissing(field)) return false

  const rawValue = String(values.value[field.key]).trim()
  if (field.validation?.pattern && !new RegExp(field.validation.pattern).test(rawValue)) return true
  if (['number', 'currency', 'integer', 'decimal'].includes(field.type)) {
    const numeric = Number(rawValue.replace(',', '.'))
    if (!Number.isFinite(numeric)) return true
    if (field.validation?.min !== undefined && numeric < field.validation.min) return true
    if (field.validation?.max !== undefined && numeric > field.validation.max) return true
    if (field.validation?.integer && !Number.isInteger(numeric)) return true
  }
  return false
}

const requiredFields = computed(() => (
  preparedBundle.value?.fields.filter(fieldIsRequired) ?? []
))
const invalidFields = computed(() => (
  preparedBundle.value?.fields.filter(fieldIsInvalid) ?? []
))
const completedRequiredCount = computed(() => (
  requiredFields.value.filter(field => !valueIsMissing(field)).length
))
const formProgress = computed(() => (
  requiredFields.value.length
    ? Math.round((completedRequiredCount.value / requiredFields.value.length) * 100)
    : 100
))

function buildFormGroups(
  fields: readonly MultiformFormField[],
  collections: readonly MultiformCollectionDefinition[],
): MultiformRenderGroup[] {
  const collectionByKey = new Map(collections.map(collection => [collection.key, collection]))
  const fieldsBySection = new Map<string, MultiformFormField[]>()
  for (const field of fields) {
    const section = field.section || 'Pozostałe informacje'
    fieldsBySection.set(section, [...(fieldsBySection.get(section) ?? []), field])
  }

  const groups: MultiformRenderGroup[] = []
  for (const [section, sectionFields] of fieldsBySection) {
    const regularFields = sectionFields.filter(field => (
      !field.collection || !collectionByKey.has(field.collection.key)
    ))
    if (regularFields.length) {
      groups.push({ kind: 'fields', id: `fields:${section}`, section, fields: regularFields })
    }

    const collectionKeys = [...new Set(sectionFields.flatMap(field => (
      field.collection && collectionByKey.has(field.collection.key)
        ? [field.collection.key]
        : []
    )))]
    for (const collectionKey of collectionKeys) {
      const collection = collectionByKey.get(collectionKey)
      if (!collection) continue
      const itemFields = new Map<number, MultiformFormField[]>()
      for (const field of sectionFields) {
        if (field.collection?.key !== collectionKey) continue
        itemFields.set(field.collection.index, [
          ...(itemFields.get(field.collection.index) ?? []),
          field,
        ])
      }
      const items = Array.from(itemFields, ([index, itemFields]) => ({
        index,
        fields: itemFields,
      })).sort((left, right) => left.index - right.index)
      groups.push({
        kind: 'repeatable',
        id: `collection:${collectionKey}:${section}`,
        section,
        collection,
        items,
      })
    }
  }
  return groups
}

const formGroups = computed(() => buildFormGroups(
  (preparedBundle.value?.fields ?? []).filter(field => (
    field.collection ? conditionMatches(field.visibleWhen) : fieldIsVisible(field)
  )),
  preparedBundle.value?.collections ?? [],
))

function supportedCollectionCount(
  collection: MultiformCollectionDefinition,
  fields: MultiformFormField[],
) {
  const indexes = new Set(fields.flatMap(field => (
    field.collection?.key === collection.key ? [field.collection.index] : []
  )))
  let supported = 0
  while (indexes.has(supported)) supported += 1
  return Math.min(collection.maxItems, supported || collection.minItems)
}

function applicantDefaults(index: number) {
  const applicant = context.value?.applicants[index]
  if (!applicant) return {}
  const client = props.caseData.clients.find(item => item.id === applicant.clientId)
  const nameParts = applicant.label.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: nameParts.shift() ?? '',
    lastName: nameParts.join(' '),
    email: client?.primary_email ?? '',
    phone: client?.primary_phone ?? '',
  }
}

function suggestedValue(field: MultiformFormField): MultiformFieldValue | undefined {
  if (field.collection?.key === 'applicants') {
    const defaults = applicantDefaults(field.collection.index)
    const relativeKey = field.collection.relativeKey as keyof typeof defaults
    if (relativeKey in defaults) return defaults[relativeKey]
  }
  if (field.key === 'loan.amount') {
    const grossAmount = primaryApplication.value?.application.gross_loan_amount
    if (grossAmount != null) return grossAmount
    if (primaryOffer.value?.loan_amount != null) return primaryOffer.value.loan_amount
  }
  if (field.key === 'loan.termMonths') {
    const years = Number(
      primaryApplication.value?.application.scenario_snapshot?.years
      ?? primaryOffer.value?.scenario_snapshot?.years,
    )
    if (Number.isFinite(years) && years > 0) return Math.round(years * 12)
  }
  if (field.key === 'property.type' && activeProperty.value?.property_type) {
    return activeProperty.value.property_type
  }
  if (field.key === 'property.address.full' && activeProperty.value) {
    return [
      activeProperty.value.address,
      activeProperty.value.postal_code,
      activeProperty.value.city,
    ].filter(Boolean).join(', ')
  }
  if (field.key === 'property.address.postalCode' && activeProperty.value?.postal_code) {
    return activeProperty.value.postal_code
  }
  if (field.key === 'property.address.city' && activeProperty.value?.city) {
    return activeProperty.value.city
  }
  if (field.key === 'property.marketValue') {
    if (primaryApplication.value?.application.appraisal_value_amount != null) {
      return primaryApplication.value.application.appraisal_value_amount
    }
    if (activeProperty.value?.appraisal_value_amount != null) {
      return activeProperty.value.appraisal_value_amount
    }
    if (activeProperty.value?.price_amount != null) return activeProperty.value.price_amount
    const propertyValue = Number(primaryOffer.value?.scenario_snapshot?.propertyValue)
    if (Number.isFinite(propertyValue) && propertyValue > 0) return propertyValue
  }
  return undefined
}

function initializeForm(bundle: MultiformPrepareResponse) {
  const nextCounts: Record<string, number> = {}
  const nextTabs: Record<string, string> = {}
  for (const collection of bundle.collections) {
    const supported = supportedCollectionCount(collection, bundle.fields)
    const minimumRequested = collection.key === 'applicants'
      ? Math.max(collection.minItems, context.value?.applicants.length ?? 0)
      : collection.minItems
    const requested = Math.max(
      minimumRequested,
      Math.min(supported, collectionCounts.value[collection.key] ?? minimumRequested),
    )
    if (requested > supported) {
      throw new Error(
        `${collection.label}: zestaw dokumentów obsługuje ${supported}, a sprawa wymaga ${requested} pozycji.`,
      )
    }
    nextCounts[collection.key] = requested
    nextTabs[collection.key] = '0'
  }
  collectionCounts.value = nextCounts
  activeCollectionTabs.value = nextTabs

  const nextValues: Record<string, MultiformFieldValue> = {}
  for (const field of bundle.fields) {
    const previous = values.value[field.key]
    const suggested = suggestedValue(field)
    nextValues[field.key] = previous ?? suggested ?? (field.type === 'checkbox' ? false : '')
  }
  values.value = nextValues
}

async function prepareForm(focus = true) {
  if (!contextCanPrepare.value || preparePending.value || preparedBundle.value) return
  preparePending.value = true
  prepareError.value = ''
  fillError.value = ''
  validationVisible.value = false
  exportComplete.value = false
  try {
    const bundle = await $fetch<MultiformPrepareResponse>(
      crmApiPath(`/cases/${props.caseData.id}/multiform/prepare`),
      { method: 'POST' },
    )
    preparedBundle.value = bundle
    initializeForm(bundle)
    if (focus) {
      await nextTick()
      formHeading.value?.focus()
    }
  }
  catch (error) {
    preparedBundle.value = null
    prepareError.value = readableError(error, 'Nie udało się przygotować wspólnego formularza.')
  }
  finally {
    preparePending.value = false
  }
}

function collectionItems(group: MultiformRepeatableGroup) {
  const count = collectionItemCount(group.collection)
  return group.items.filter(item => item.index < count)
}

function activeCollectionIndex(group: MultiformRepeatableGroup) {
  const raw = Number(activeCollectionTabs.value[group.collection.key] ?? 0)
  return collectionItems(group).some(item => item.index === raw)
    ? raw
    : collectionItems(group)[0]?.index ?? 0
}

function activeCollectionFields(group: MultiformRepeatableGroup) {
  return collectionItems(group).find(
    item => item.index === activeCollectionIndex(group),
  )?.fields ?? []
}

function collectionItemLabel(group: MultiformRepeatableGroup, index: number) {
  if (group.collection.key === 'applicants') {
    return context.value?.applicants[index]?.label || `${group.collection.itemLabel} ${index + 1}`
  }
  return `${group.collection.itemLabel} ${index + 1}`
}

function collectionTabItems(group: MultiformRepeatableGroup) {
  return collectionItems(group).map(item => ({
    label: collectionItemLabel(group, item.index),
    value: String(item.index),
  }))
}

function updateCollectionTab(group: MultiformRepeatableGroup, value: string | number) {
  activeCollectionTabs.value = {
    ...activeCollectionTabs.value,
    [group.collection.key]: String(value),
  }
}

function activeValuesPayload() {
  const activeKeys = new Set(
    (preparedBundle.value?.fields ?? []).filter(fieldIsActive).map(field => field.key),
  )
  return Object.fromEntries(
    Object.entries(values.value).filter(([key]) => activeKeys.has(key)),
  )
}

async function focusFirstInvalidField() {
  const field = invalidFields.value[0]
  if (!field) return
  if (field.collection) {
    activeCollectionTabs.value = {
      ...activeCollectionTabs.value,
      [field.collection.key]: String(field.collection.index),
    }
  }
  await nextTick()
  document.getElementById(
    `case-multiform-${field.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
  )?.focus()
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

async function fillAndDownload() {
  if (!preparedBundle.value || fillPending.value) return
  validationVisible.value = true
  fillError.value = ''
  exportComplete.value = false
  if (!contextCanExport.value) {
    fillError.value = mappingsReady.value
      ? `Wybierz pliki dla wszystkich wymaganych pozycji (${missingSelectedRequirements.value.length}).`
      : 'Eksport czeka na kompletne mapowanie pól formularzy bankowych.'
    return
  }
  if (invalidFields.value.length) {
    fillError.value = `Uzupełnij lub popraw oznaczone pola (${invalidFields.value.length}).`
    activeStep.value = 3
    await focusFirstInvalidField()
    return
  }

  fillPending.value = true
  try {
    const blob = await $fetch<Blob>(
      crmApiPath(`/cases/${props.caseData.id}/multiform/fill`),
      {
        method: 'POST',
        body: {
          values: activeValuesPayload(),
          collectionCounts: collectionCounts.value,
          documentIds: selectedDocumentIds.value,
        },
        responseType: 'blob',
      },
    )
    downloadBlob(
      blob,
      `wnioski-${props.caseData.title
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'sprawa'}.zip`,
    )
    exportComplete.value = true
    toast.add({
      title: 'Paczka dokumentów jest gotowa',
      description: 'Uzupełnione PDF-y i wybrane załączniki zostały pobrane jako ZIP.',
      color: 'success',
    })
  }
  catch (error) {
    fillError.value = readableError(error, 'Nie udało się przygotować paczki ZIP.')
  }
  finally {
    fillPending.value = false
  }
}

function documentTitle(
  preparedDocument: MultiformPrepareResponse['documents'][number],
  index: number,
) {
  return preparedDocument.name
    || preparedDocument.bank
    || preparedDocument.fileName
    || `Formularz ${index + 1}`
}

async function focusCurrentStep() {
  await nextTick()
  document.getElementById(`case-multiform-step-${activeStep.value}`)?.focus()
}

async function persistCurrentDraft() {
  draftDirty.value = true
  await saveDraftNow()
}

async function handlePrimaryAction() {
  if (activeStep.value === 0) {
    activeStep.value = 1
    await focusCurrentStep()
    return
  }
  if (activeStep.value === 1) {
    intakeValidationVisible.value = true
    if (!intakeValidation.value.valid) {
      const firstIssue = intakeValidation.value.issues[0]
      if (firstIssue) await intakePanel.value?.focusIssue?.(firstIssue)
      toast.add({
        title: 'Uzupełnij pytania wstępne',
        description: `Pozostało ${intakeValidation.value.issues.length} odpowiedzi.`,
        color: 'warning',
      })
      return
    }
    if (context.value) {
      initializeDocumentSelection(context.value, selectedDocumentIds.value)
    }
    activeStep.value = 2
    await persistCurrentDraft()
    await focusCurrentStep()
    return
  }
  if (activeStep.value === 2) {
    if (!documentStepComplete.value) {
      toast.add({
        title: 'Dołącz wymagane dokumenty',
        description: `Brakuje ${missingSelectedRequirements.value.length} pozycji z checklisty.`,
        color: 'warning',
      })
      return
    }
    await prepareForm(false)
    if (!preparedBundle.value) return
    activeStep.value = 3
    await persistCurrentDraft()
    await focusCurrentStep()
    return
  }
  if (activeStep.value === 3) {
    validationVisible.value = true
    if (invalidFields.value.length) {
      fillError.value = `Uzupełnij lub popraw oznaczone pola (${invalidFields.value.length}).`
      await focusFirstInvalidField()
      return
    }
    activeStep.value = 4
    await persistCurrentDraft()
    await focusCurrentStep()
    return
  }
  await fillAndDownload()
}

async function requestStep(requestedStep: number) {
  if (!Number.isInteger(requestedStep) || requestedStep < 0 || requestedStep > 4) return
  if (requestedStep <= activeStep.value) {
    activeStep.value = requestedStep
    await focusCurrentStep()
    return
  }
  if (requestedStep === activeStep.value + 1) await handlePrimaryAction()
}

const stepModel = computed({
  get: () => activeStep.value,
  set: (value: string | number | undefined) => {
    void requestStep(Number(value))
  },
})

const primaryActionLabel = computed(() => {
  if (activeStep.value === 0) return 'Przejdź do pytań'
  if (activeStep.value === 1) return 'Wygeneruj checklistę'
  if (activeStep.value === 2) return 'Przejdź do formularzy'
  if (activeStep.value === 3) return 'Przejdź do paczki ZIP'
  return fillPending.value ? 'Generuję dokumenty…' : 'Uzupełnij i pobierz ZIP'
})

const primaryActionIcon = computed(() => (
  activeStep.value === 4 ? 'i-lucide-download' : 'i-lucide-arrow-right'
))

const primaryActionDisabled = computed(() => (
  contextPending.value
  || draftPending.value
  || preparePending.value
  || fillPending.value
  || (activeStep.value === 2 && Boolean(formPreparationBlocker.value))
  || (activeStep.value === 4 && !contextCanExport.value)
))

function formatSavedAt(value: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
}

async function handleDocumentsRefresh() {
  emit('refresh')
  await loadContext({ preservePrepared: true })
}

const selectionKey = computed(() => [
  props.caseData.contract_application_id,
  props.caseData.bank_applications
    .map(application => [
      application.id,
      application.offer_id,
      application.property_id ?? '',
      application.status_code,
      application.gross_loan_amount ?? '',
      application.calculated_at ?? '',
    ].join(':'))
    .sort()
    .join(','),
  props.caseData.selected_property_id,
  props.caseData.offers
    .map(offer => `${offer.id}:${offerTemplateIds(offer).join(',')}:${offer.loan_amount ?? ''}`)
    .sort()
    .join('|'),
  props.caseData.clients.map(client => client.id).join(','),
].join('|'))

watch(selectionKey, (next, previous) => {
  if (previous && next !== previous) void bootstrapWorkspace()
})

watch(
  [activeStep, intakeAnswers, values, collectionCounts, selectedDocumentIds],
  scheduleDraftSave,
  { deep: true },
)

onMounted(() => {
  void bootstrapWorkspace()
})

onBeforeUnmount(() => {
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  if (draftReady.value && draftDirty.value) void saveDraftNow()
})
</script>

<template>
  <UCard
    class="case-multiform"
    :ui="{
      header: 'p-0 sm:p-0',
      body: 'p-0 sm:p-0',
      footer: 'p-0 sm:p-0',
    }"
  >
    <template #header>
      <div class="case-multiform__stepper-shell">
        <p class="sr-only" aria-live="polite">
          Krok {{ activeStep + 1 }} z 5: {{ workflowSteps[activeStep]?.title }}
        </p>
        <UStepper
          v-model="stepModel"
          :items="workflowSteps"
          size="sm"
          color="primary"
          class="case-multiform__stepper"
          :ui="{ content: 'hidden' }"
        />
      </div>
    </template>

    <div v-if="prerequisite" class="case-multiform__blocking">
      <UAlert
        color="neutral"
        variant="subtle"
        icon="i-lucide-lock-keyhole"
        title="Etap oczekuje na wcześniejsze kroki"
        :description="prerequisite"
      >
        <template #actions>
          <UButton
            v-if="!caseData.clients.length"
            :to="{ path: orgPath(`/cases/${caseData.id}`), query: { view: 'credit' }, hash: '#case-clients' }"
            color="neutral"
            variant="soft"
            size="sm"
          >
            Przejdź do klientów
          </UButton>
          <UButton
            v-else
            :to="caseData.offers.length
              ? { path: orgPath(`/cases/${caseData.id}`), query: { view: 'credit' }, hash: '#case-bank-applications' }
              : { path: orgPath('/calculator/mortgages'), query: { caseId: caseData.id } }"
            color="neutral"
            variant="soft"
            size="sm"
          >
            Wybierz banki do procesu
          </UButton>
        </template>
      </UAlert>
    </div>

    <div
      v-else-if="(contextPending || draftPending) && !context"
      class="case-multiform__loading"
      aria-busy="true"
    >
      <USkeleton class="h-16 w-full" />
      <USkeleton class="h-64 w-full" />
    </div>

    <div v-else-if="contextError" class="case-multiform__blocking">
      <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się uruchomić Multiwniosku"
        :description="contextError"
      >
        <template #actions>
          <UButton color="error" variant="soft" size="sm" @click="bootstrapWorkspace">
            Spróbuj ponownie
          </UButton>
        </template>
      </UAlert>
    </div>

    <div v-else-if="context" class="case-multiform__workspace">
      <UAlert
        v-if="draftError"
        color="warning"
        variant="subtle"
        icon="i-lucide-cloud-off"
        title="Automatyczny zapis jest chwilowo niedostępny"
        :description="draftError"
        class="case-multiform__draft-alert"
      />

      <Transition name="case-multiform-step" mode="out-in">
        <section
          v-if="activeStep === 0"
          id="case-multiform-step-0"
          key="scope"
          class="case-multiform__step case-multiform__scope"
          tabindex="-1"
          aria-labelledby="case-multiform-scope-title"
        >
          <header class="case-multiform__step-heading">
            <p>Zakres sprawy</p>
            <h3 id="case-multiform-scope-title">Sprawdź banki i osoby w procesie</h3>
            <span>
              Zakres pochodzi z wybranych ofert oraz aktywnych wniosków. Te dane będą wspólne
              dla checklisty, formularzy bankowych i paczki ZIP.
            </span>
          </header>

          <div class="case-multiform__scope-facts">
            <div>
              <span>Wnioskodawcy</span>
              <strong>{{ caseData.clients.length }}</strong>
              <small>{{ caseData.clients.map(client => client.display_name).join(' · ') }}</small>
            </div>
            <div>
              <span>Banki</span>
              <strong>{{ applicationCount }}</strong>
              <small>{{ bankNames.join(' · ') }}</small>
            </div>
            <div>
              <span>Nieruchomość</span>
              <strong>{{ activeProperty ? 'Wybrana' : 'Opcjonalna' }}</strong>
              <small>
                {{ activeProperty
                  ? [activeProperty.address, activeProperty.city].filter(Boolean).join(', ')
                  : 'Możesz uzupełnić ją później' }}
              </small>
            </div>
          </div>

          <div class="case-multiform__application-grid">
            <article
              v-for="application in applicationCards"
              :key="application.id"
              class="case-multiform__application"
              :class="{ 'case-multiform__application--final': application.isFinal }"
            >
              <div class="case-multiform__application-heading">
                <span>Wniosek {{ application.slot }}</span>
                <UBadge :color="application.status.color" variant="subtle" size="xs">
                  {{ application.status.label }}
                </UBadge>
              </div>
              <strong>{{ application.bankName }}</strong>
              <p>{{ application.productName }}</p>
              <small>{{ application.propertyLabel }}</small>
              <div class="case-multiform__application-footer">
                <span><UIcon name="i-lucide-file-text" /> {{ application.templateCount }} formularze</span>
                <span v-if="application.isFinal"><UIcon name="i-lucide-trophy" /> Wybrany bank</span>
              </div>
            </article>
          </div>

          <UAlert
            color="success"
            variant="subtle"
            icon="i-lucide-circle-check"
            title="Zakres jest gotowy"
            :description="`${bankCountLabel(applicationCount)} · ${caseData.clients.length} wnioskodawców · ${templateIds.length} formularze PDF`"
          />
        </section>

        <section
          v-else-if="activeStep === 1"
          id="case-multiform-step-1"
          key="intake"
          class="case-multiform__step"
          tabindex="-1"
          aria-label="Pytania wstępne"
        >
          <CaseMultiformIntake
            ref="intakePanel"
            v-model="intakeAnswers"
            :case-data="caseData"
            :context="context"
            :validation-visible="intakeValidationVisible"
            :auto-filled-count="autoFilledCount"
            :saving="draftSaving"
            :saved-at="draftSavedAt"
          />
        </section>

        <section
          v-else-if="activeStep === 2"
          id="case-multiform-step-2"
          key="documents"
          class="case-multiform__step"
          tabindex="-1"
          aria-label="Dokumenty"
        >
          <CaseMultiformDocuments
            v-model:selected-document-ids="selectedDocumentIds"
            :case-data="caseData"
            :context="context"
            :requirements="resolvedDocumentRequirements"
            @refresh="handleDocumentsRefresh"
          />
          <UAlert
            v-if="formPreparationBlocker"
            color="warning"
            variant="subtle"
            icon="i-lucide-file-warning"
            title="Formularze bankowe wymagają szablonu PDF"
            :description="formPreparationBlocker"
          />
        </section>

        <section
          v-else-if="activeStep === 3"
          id="case-multiform-step-3"
          key="forms"
          class="case-multiform__step case-multiform__forms"
          tabindex="-1"
          aria-labelledby="case-multiform-form-title"
        >
          <div
            ref="formHeading"
            class="case-multiform__form-heading"
            tabindex="-1"
          >
            <div>
              <p>Formularze bankowe</p>
              <h3 id="case-multiform-form-title">Uzupełnij dane tylko raz</h3>
              <span v-if="preparedBundle">
                Wartości trafią do {{ context.applications.length }} wniosków bankowych
                i {{ preparedBundle.documents.length }} formularzy PDF.
              </span>
            </div>
            <div class="case-multiform__progress">
              <span>Wymagane pola</span>
              <strong>{{ completedRequiredCount }}/{{ requiredFields.length }}</strong>
              <UProgress :model-value="formProgress" color="neutral" />
            </div>
          </div>

          <div v-if="preparePending" class="case-multiform__form-loading">
            <USkeleton class="h-24 w-full" />
            <USkeleton class="h-40 w-full" />
          </div>

          <UAlert
            v-else-if="prepareError"
            color="error"
            variant="subtle"
            title="Nie udało się przygotować formularza"
            :description="prepareError"
          >
            <template #actions>
              <UButton color="error" variant="soft" size="sm" @click="prepareForm()">
                Spróbuj ponownie
              </UButton>
            </template>
          </UAlert>

          <template v-else-if="preparedBundle">
            <div class="case-multiform__document-strip" aria-label="Formularze w paczce">
              <span
                v-for="(preparedDocument, index) in preparedBundle.documents"
                :key="preparedDocument.id || preparedDocument.templateId || index"
              >
                <UIcon name="i-lucide-file-text" />
                {{ documentTitle(preparedDocument, index) }}
              </span>
            </div>

            <template v-for="group in formGroups" :key="group.id">
              <fieldset v-if="group.kind === 'fields'" class="case-multiform__field-section">
                <legend>{{ group.section }}</legend>
                <div class="case-multiform__field-grid">
                  <CaseMultiformField
                    v-for="field in group.fields"
                    :key="field.key"
                    :field="field"
                    :model-value="values[field.key]"
                    :required="fieldIsRequired(field)"
                    :invalid="validationVisible && invalidFields.some(item => item.key === field.key)"
                    @update:model-value="values[field.key] = $event"
                  />
                </div>
              </fieldset>

              <fieldset v-else class="case-multiform__field-section case-multiform__repeatable">
                <legend>{{ group.section }}</legend>
                <div class="case-multiform__repeatable-heading">
                  <div>
                    <strong>{{ group.collection.label }}</strong>
                    <span>Lista wynika z klientów przypisanych do sprawy.</span>
                  </div>
                  <UButton
                    :to="{ path: orgPath(`/cases/${caseData.id}`), query: { view: 'credit' }, hash: '#case-clients' }"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-users-round"
                  >
                    Zarządzaj wnioskodawcami
                  </UButton>
                </div>
                <UTabs
                  :model-value="activeCollectionTabs[group.collection.key] ?? '0'"
                  :items="collectionTabItems(group)"
                  :content="false"
                  class="case-multiform__person-tabs"
                  @update:model-value="updateCollectionTab(group, $event)"
                />
                <div class="case-multiform__person-panel">
                  <div class="case-multiform__person-title">
                    <span>Wnioskodawca {{ activeCollectionIndex(group) + 1 }}</span>
                    <strong>{{ collectionItemLabel(group, activeCollectionIndex(group)) }}</strong>
                  </div>
                  <div class="case-multiform__field-grid">
                    <CaseMultiformField
                      v-for="field in activeCollectionFields(group)"
                      :key="field.key"
                      :field="field"
                      :model-value="values[field.key]"
                      :required="fieldIsRequired(field)"
                      :invalid="validationVisible && invalidFields.some(item => item.key === field.key)"
                      @update:model-value="values[field.key] = $event"
                    />
                  </div>
                </div>
              </fieldset>
            </template>
          </template>

          <UAlert
            v-if="fillError"
            color="error"
            variant="subtle"
            title="Formularz wymaga uzupełnienia"
            :description="fillError"
          />
        </section>

        <section
          v-else
          id="case-multiform-step-4"
          key="zip"
          class="case-multiform__step case-multiform__zip"
          tabindex="-1"
          aria-labelledby="case-multiform-zip-title"
        >
          <header class="case-multiform__step-heading">
            <p>Paczka ZIP</p>
            <h3 id="case-multiform-zip-title">Sprawdź i pobierz komplet wniosków</h3>
            <span>
              Paczka połączy uzupełnione formularze bankowe z dokumentami wybranymi
              na wspólnej checkliście.
            </span>
          </header>

          <div class="case-multiform__zip-summary">
            <div>
              <span><UIcon name="i-lucide-landmark" /></span>
              <strong>{{ context.applications.length }}</strong>
              <small>{{ bankCountLabel(context.applications.length) }}</small>
            </div>
            <div>
              <span><UIcon name="i-lucide-file-pen-line" /></span>
              <strong>{{ preparedBundle?.documents.length ?? 0 }}</strong>
              <small>formularzy PDF</small>
            </div>
            <div>
              <span><UIcon name="i-lucide-paperclip" /></span>
              <strong>{{ selectedDocumentCount }}</strong>
              <small>załączników</small>
            </div>
          </div>

          <UAlert
            v-if="context.selectedApplicationsValidation.blockers.length"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Eksport PDF czeka na kompletne mapowanie"
          >
            <template #description>
              <p>Formularze i odpowiedzi są zapisane. Przed pobraniem paczki trzeba uzupełnić mapowania:</p>
              <ul>
                <li
                  v-for="blocker in context.selectedApplicationsValidation.blockers"
                  :key="blocker"
                >
                  {{ blocker }}
                </li>
              </ul>
            </template>
          </UAlert>

          <UAlert
            v-else
            color="success"
            variant="subtle"
            icon="i-lucide-shield-check"
            title="Paczka jest gotowa do wygenerowania"
            description="Mapowania, formularze i wymagane załączniki są kompletne."
          />

          <UAlert
            v-if="fillError"
            color="error"
            variant="subtle"
            title="Nie można przygotować paczki"
            :description="fillError"
          />
          <UAlert
            v-if="exportComplete"
            color="success"
            variant="subtle"
            icon="i-lucide-circle-check"
            title="Paczka ZIP została pobrana"
          />
        </section>
      </Transition>
    </div>

    <template v-if="!prerequisite && context" #footer>
      <div class="case-multiform__footer">
        <UButton
          v-if="activeStep > 0"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          @click="requestStep(activeStep - 1)"
        >
          {{ activeStep === 1 ? 'Wróć do zakresu' : 'Wstecz' }}
        </UButton>
        <span v-else />

        <div class="case-multiform__save-state" aria-live="polite">
          <UIcon
            :name="draftSaving ? 'i-lucide-loader-circle' : 'i-lucide-circle-check'"
            :class="{ 'is-spinning': draftSaving }"
          />
          <div>
            <strong>{{ draftSaving ? 'Zapisuję automatycznie' : 'Zapisano automatycznie' }}</strong>
            <small v-if="draftSavedAt">Ostatni zapis: {{ formatSavedAt(draftSavedAt) }}</small>
            <small v-else>Zmiany zapisują się w tej sprawie</small>
          </div>
        </div>

        <div class="case-multiform__footer-action">
          <UButton
            :icon="primaryActionIcon"
            trailing
            size="lg"
            :loading="preparePending || fillPending"
            :disabled="primaryActionDisabled"
            @click="handlePrimaryAction"
          >
            {{ primaryActionLabel }}
          </UButton>
          <small v-if="activeStep === 2 && formPreparationBlocker">Checklista działa niezależnie od formularza PDF</small>
          <small v-else-if="activeStep < 4">Przejdź do kroku {{ activeStep + 2 }}: {{ workflowSteps[activeStep + 1]?.title }}</small>
          <small v-else>Pobierz jedną paczkę dla wszystkich banków</small>
        </div>
      </div>
    </template>
  </UCard>
</template>

<style scoped>
.case-multiform {
  overflow: hidden;
  margin: 0;
}

.case-multiform__stepper-shell {
  padding: 22px 28px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.case-multiform__stepper {
  width: 100%;
}

.case-multiform :deep([data-slot="body"]) {
  max-height: calc(100vh - 230px);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.case-multiform__stepper :deep([data-slot="title"]) {
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.case-multiform__stepper :deep([data-slot="description"]) {
  font-size: 10px;
}

.case-multiform__loading,
.case-multiform__blocking {
  padding: 28px;
}

.case-multiform__loading {
  display: grid;
  gap: 14px;
}

.case-multiform__workspace {
  position: relative;
  min-height: 620px;
}

.case-multiform__draft-alert {
  margin: 18px 28px 0;
}

.case-multiform__step {
  min-height: 620px;
  outline: none;
}

.case-multiform__step :deep(.multiform-documents) {
  padding: 30px;
}

.case-multiform__scope,
.case-multiform__forms,
.case-multiform__zip {
  display: grid;
  align-content: start;
  gap: 22px;
  padding: 30px;
}

.case-multiform__step-heading {
  display: grid;
  gap: 6px;
}

.case-multiform__step-heading p,
.case-multiform__step-heading h3,
.case-multiform__step-heading span,
.case-multiform__application p,
.case-multiform__application small,
.case-multiform__form-heading p,
.case-multiform__form-heading h3,
.case-multiform__form-heading span {
  margin: 0;
}

.case-multiform__step-heading p,
.case-multiform__form-heading p {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .075em;
  text-transform: uppercase;
}

.case-multiform__step-heading h3,
.case-multiform__form-heading h3 {
  color: var(--ui-text-highlighted);
  font-size: 23px;
  line-height: 1.2;
}

.case-multiform__step-heading span,
.case-multiform__form-heading span {
  max-width: 760px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.case-multiform__scope-facts,
.case-multiform__zip-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.case-multiform__scope-facts > div {
  display: grid;
  gap: 4px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg-muted);
}

.case-multiform__scope-facts span {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.case-multiform__scope-facts strong {
  color: var(--ui-text-highlighted);
  font-size: 19px;
}

.case-multiform__scope-facts small {
  overflow: hidden;
  color: var(--ui-text-toned);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-multiform__application-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.case-multiform__application {
  display: grid;
  min-width: 0;
  gap: 5px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg);
}

.case-multiform__application--final {
  border-color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-success) 7%, var(--ui-bg));
}

.case-multiform__application-heading,
.case-multiform__application-footer,
.case-multiform__form-heading,
.case-multiform__repeatable-heading,
.case-multiform__person-title,
.case-multiform__footer {
  display: flex;
  align-items: center;
}

.case-multiform__application-heading,
.case-multiform__application-footer,
.case-multiform__form-heading,
.case-multiform__repeatable-heading,
.case-multiform__footer {
  justify-content: space-between;
  gap: 18px;
}

.case-multiform__application-heading > span {
  color: var(--ui-primary);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.case-multiform__application > strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-multiform__application > p {
  overflow: hidden;
  color: var(--ui-text-toned);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-multiform__application > small,
.case-multiform__application-footer {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.case-multiform__application-footer {
  margin-top: 7px;
  padding-top: 8px;
  border-top: 1px solid var(--ui-border-muted);
}

.case-multiform__application-footer span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.case-multiform__form-heading {
  padding-bottom: 2px;
  outline: none;
}

.case-multiform__form-heading > div:first-child {
  display: grid;
  gap: 6px;
}

.case-multiform__progress {
  display: grid;
  grid-template-columns: auto auto;
  gap: 4px 12px;
  min-width: 190px;
}

.case-multiform__progress span {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.case-multiform__progress strong {
  justify-self: end;
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.case-multiform__progress :deep([data-slot="root"]) {
  grid-column: 1 / -1;
}

.case-multiform__form-loading {
  display: grid;
  gap: 14px;
}

.case-multiform__document-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.case-multiform__document-strip span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-toned);
  font-size: 10px;
}

.case-multiform__field-section {
  min-width: 0;
  margin: 0;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
}

.case-multiform__field-section > legend {
  padding: 0 8px;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 700;
}

.case-multiform__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.case-multiform__repeatable-heading {
  margin-bottom: 12px;
}

.case-multiform__repeatable-heading > div {
  display: grid;
  gap: 3px;
}

.case-multiform__repeatable-heading strong,
.case-multiform__person-title strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.case-multiform__repeatable-heading span {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.case-multiform__person-tabs {
  margin-bottom: 12px;
}

.case-multiform__person-panel {
  display: grid;
  gap: 14px;
  padding: 14px;
  border-radius: 10px;
  background: var(--ui-bg-muted);
}

.case-multiform__person-title {
  display: grid;
  gap: 3px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-border);
}

.case-multiform__person-title span {
  color: var(--ui-primary);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.case-multiform__zip {
  max-width: 980px;
  margin: 0 auto;
}

.case-multiform__zip-summary > div {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.case-multiform__zip-summary > div > span {
  display: grid;
  grid-row: 1 / 3;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--ui-bg);
  color: var(--ui-primary);
}

.case-multiform__zip-summary strong {
  color: var(--ui-text-highlighted);
  font-size: 20px;
}

.case-multiform__zip-summary small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.case-multiform__zip :deep([data-slot="description"] p) {
  margin: 0;
}

.case-multiform__zip :deep([data-slot="description"] ul) {
  margin: 7px 0 0;
  padding-left: 18px;
}

.case-multiform__footer {
  z-index: 3;
  min-height: 76px;
  padding: 13px 154px 13px 28px;
  border-top: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg) 96%, transparent);
  box-shadow: 0 -10px 28px color-mix(in srgb, var(--ui-text-highlighted) 5%, transparent);
  backdrop-filter: blur(12px);
}

.case-multiform__save-state {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--ui-text-toned);
}

.case-multiform__save-state > div {
  display: grid;
  gap: 1px;
}

.case-multiform__save-state strong {
  font-size: 11px;
}

.case-multiform__save-state small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.case-multiform__footer-action {
  display: grid;
  justify-items: end;
  gap: 3px;
}

.case-multiform__footer-action small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.is-spinning {
  animation: case-multiform-spin .8s linear infinite;
}

.case-multiform-step-enter-active,
.case-multiform-step-leave-active {
  transition: opacity .16s ease, transform .16s ease;
}

.case-multiform-step-enter-from {
  opacity: 0;
  transform: translateX(8px);
}

.case-multiform-step-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

@keyframes case-multiform-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 920px) {
  .case-multiform__stepper-shell {
    overflow-x: auto;
  }

  .case-multiform__stepper {
    min-width: 780px;
  }

  .case-multiform__application-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .case-multiform :deep([data-slot="body"]) {
    max-height: none;
    overflow: visible;
  }

  .case-multiform__stepper-shell,
  .case-multiform__loading,
  .case-multiform__blocking,
  .case-multiform__scope,
  .case-multiform__forms,
  .case-multiform__zip {
    padding: 18px;
  }

  .case-multiform__scope-facts,
  .case-multiform__application-grid,
  .case-multiform__zip-summary,
  .case-multiform__field-grid {
    grid-template-columns: 1fr;
  }

  .case-multiform__form-heading,
  .case-multiform__repeatable-heading,
  .case-multiform__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .case-multiform__progress {
    min-width: 0;
  }

  .case-multiform__footer {
    gap: 12px;
    padding: 16px;
  }

  .case-multiform__footer-action {
    justify-items: stretch;
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .case-multiform-step-enter-active,
  .case-multiform-step-leave-active,
  .is-spinning {
    animation: none;
    transition: none;
  }
}
</style>
