<script setup lang="ts">
import type {
  CaseBankApplication,
  CaseDetail,
  MortgageApplicationStatus,
  SavedCaseOffer,
} from '~/types/cases'
import type {
  MultiformCollectionDefinition,
  MultiformCrmContext,
  MultiformFieldValue,
  MultiformFormField,
  MultiformPrepareResponse,
  MultiformRenderGroup,
  MultiformRepeatableGroup,
} from '~/types/multiform'

const props = defineProps<{
  caseData: CaseDetail
  documentsReady: boolean
}>()

const { crmApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const started = ref(false)
const contextPending = ref(false)
const preparePending = ref(false)
const fillPending = ref(false)
const contextError = ref('')
const prepareError = ref('')
const fillError = ref('')
const context = ref<MultiformCrmContext | null>(null)
const preparedBundle = ref<MultiformPrepareResponse | null>(null)
const selectedDocumentIds = ref<string[]>([])
const values = ref<Record<string, MultiformFieldValue>>({})
const collectionCounts = ref<Record<string, number>>({})
const activeCollectionTabs = ref<Record<string, string>>({})
const validationVisible = ref(false)
const exportComplete = ref(false)
const formHeading = ref<HTMLElement | null>(null)

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
  const applications = [...props.caseData.bank_applications].sort((left, right) => left.slot - right.slot)
  if (props.caseData.contract_application_id) {
    return applications.filter(applicationIsFinal)
  }
  return applications.filter(application => activeApplicationStatuses.has(application.status_code))
})

function offerTemplateIds(offer: SavedCaseOffer | null | undefined) {
  const configured = offer?.catalog_snapshot?.version?.multiform_template_ids
  return Array.isArray(configured)
    ? configured.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
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

function requirementContextLabel(
  requirement: MultiformCrmContext['checklist']['requirements'][number],
) {
  if (requirement.bankName) return requirement.bankName
  if (requirement.bankNames.length === 1) return requirement.bankNames[0]
  if (requirement.bankNames.length > 1) return `Wspólne dla: ${requirement.bankNames.join(', ')}`
  return 'Wspólne dla wszystkich banków'
}

const prerequisite = computed(() => {
  if (!props.caseData.clients.length) return 'Najpierw dodaj wnioskodawców do sprawy.'
  if (!props.caseData.bank_applications.length) {
    return 'Najpierw uruchom co najmniej jeden wniosek bankowy. Możesz przygotować do trzech banków równolegle.'
  }
  if (!activeApplications.value.length) {
    return 'Sprawa nie ma aktywnego wniosku bankowego do przygotowania.'
  }
  if (activeApplications.value.some(application => application.snapshot_status !== 'complete')) {
    return 'Aktywny wniosek nie ma kompletnego, zamrożonego przeliczenia oferty dla nieruchomości.'
  }
  if (props.caseData.properties.length && !activeProperty.value) {
    return 'Wybierz nieruchomość, której dane mają trafić do wniosków.'
  }
  if (!templateIds.value.length) return 'Aktywne wnioski nie mają przypisanych formularzy bankowych.'
  if (!props.documentsReady) return 'Uzupełnij obowiązkowe pozycje na checkliście dokumentów.'
  return ''
})

const contextCanPrepare = computed(() => Boolean(
  context.value?.selectedApplicationsValidation.valid
  && context.value.applicationIds.length > 0
  && context.value.templateIds.length > 0,
))

function requirementAcceptsAttachment(requirement: MultiformCrmContext['checklist']['requirements'][number]) {
  return requirement.itemKind === 'client_document'
    || (requirement.itemKind === 'bank_document' && !requirement.templateId)
}

const missingSelectedRequirements = computed(() => {
  const selected = new Set(selectedDocumentIds.value)
  return (context.value?.checklist.requirements ?? []).filter(requirement => (
    requirement.required
    && requirement.applicability === 'always'
    && requirementAcceptsAttachment(requirement)
    && !requirement.documentIds.some(documentId => selected.has(documentId))
  ))
})

const contextCanExport = computed(() => Boolean(
  contextCanPrepare.value && missingSelectedRequirements.value.length === 0,
))

const selectedDocumentCount = computed(() => selectedDocumentIds.value.length)

function readableError(error: unknown, fallback: string) {
  return apiErrorMessage(error) || fallback
}

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes < 1) return 'brak rozmiaru'
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`
}

function emptyRequirementState(requirement: MultiformCrmContext['checklist']['requirements'][number]) {
  if (requirement.fulfillment === 'missing') return { label: 'Brakuje pliku', color: 'error' as const }
  if (requirement.fulfillment === 'conditional') return { label: 'Do potwierdzenia', color: 'warning' as const }
  if (requirement.fulfillment === 'optional') return { label: 'Opcjonalny', color: 'neutral' as const }
  return { label: 'Bez załącznika', color: 'neutral' as const }
}

function requirementDocuments(requirement: MultiformCrmContext['checklist']['requirements'][number]) {
  const documentIds = new Set(requirement.documentIds)
  return (context.value?.documents ?? []).filter(document => documentIds.has(document.id))
}

function toggleDocument(
  requirement: MultiformCrmContext['checklist']['requirements'][number],
  documentId: string,
  checked: boolean,
) {
  const selected = new Set(selectedDocumentIds.value)
  if (checked) {
    if (!requirement.multiple) {
      for (const id of requirement.documentIds) selected.delete(id)
    }
    selected.add(documentId)
  }
  else {
    selected.delete(documentId)
  }
  selectedDocumentIds.value = [...selected]
}

function initializeDocumentSelection(nextContext: MultiformCrmContext) {
  const selected = new Set<string>()
  for (const requirement of nextContext.checklist.requirements) {
    if (
      !requirementAcceptsAttachment(requirement)
      || !requirement.required
      || requirement.applicability !== 'always'
    ) continue
    const eligible = requirement.documentIds.filter(documentId => (
      nextContext.documents.some(document => document.id === documentId && document.eligible)
    ))
    for (const documentId of requirement.multiple ? eligible : eligible.slice(0, 1)) {
      selected.add(documentId)
    }
  }
  selectedDocumentIds.value = [...selected]
}

async function loadContext() {
  if (prerequisite.value || contextPending.value) return
  started.value = true
  contextPending.value = true
  contextError.value = ''
  prepareError.value = ''
  fillError.value = ''
  context.value = null
  preparedBundle.value = null
  try {
    const response = await $fetch<MultiformCrmContext>(
      crmApiPath(`/cases/${props.caseData.id}/multiform/context`),
    )
    context.value = response
    initializeDocumentSelection(response)
  }
  catch (error) {
    contextError.value = readableError(error, 'Nie udało się pobrać kontekstu Multiwniosku.')
  }
  finally {
    contextPending.value = false
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
  return preparedBundle.value?.collections.find(collection => collection.key === field.collection?.key)
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
  if (field.required || Boolean(field.requiredWhen && conditionMatches(field.requiredWhen))) return true
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
      const items = Array.from(itemFields, ([index, fields]) => ({ index, fields }))
        .sort((left, right) => left.index - right.index)
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

function supportedCollectionCount(collection: MultiformCollectionDefinition, fields: MultiformFormField[]) {
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
    if (activeProperty.value?.appraisal_value_amount != null) return activeProperty.value.appraisal_value_amount
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
    const requested = collection.key === 'applicants'
      ? Math.max(collection.minItems, context.value?.applicants.length ?? 0)
      : collection.minItems
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

async function prepareForm() {
  if (!contextCanPrepare.value || preparePending.value) return
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
    await nextTick()
    formHeading.value?.focus()
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
  return collectionItems(group).find(item => item.index === activeCollectionIndex(group))?.fields ?? []
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
  document.getElementById(`case-multiform-${field.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`)?.focus()
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
    fillError.value = `Wybierz pliki dla wszystkich wymaganych pozycji (${missingSelectedRequirements.value.length}).`
    return
  }
  if (invalidFields.value.length) {
    fillError.value = `Uzupełnij lub popraw oznaczone pola (${invalidFields.value.length}).`
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
    downloadBlob(blob, `wnioski-${props.caseData.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'sprawa'}.zip`)
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

function documentTitle(document: MultiformPrepareResponse['documents'][number], index: number) {
  return document.name || document.bank || document.fileName || `Formularz ${index + 1}`
}

function resetWorkspace() {
  started.value = false
  context.value = null
  preparedBundle.value = null
  selectedDocumentIds.value = []
  values.value = {}
  collectionCounts.value = {}
  activeCollectionTabs.value = {}
  contextError.value = ''
  prepareError.value = ''
  fillError.value = ''
  validationVisible.value = false
  exportComplete.value = false
}

watch(() => [
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
  props.caseData.documents
    .map(document => `${document.id}:${document.submission_id ?? 'shared'}:${document.sha256 ?? ''}`)
    .sort()
    .join(','),
].join('|'), (next, previous) => {
  if (previous && next !== previous) resetWorkspace()
})
</script>

<template>
  <UCard class="case-multiform" data-testid="case-multiform-workspace">
    <template #header>
      <div class="case-multiform__header">
        <div>
          <p>Multiwniosek w CRM</p>
          <h2>{{ bankCountLabel(applicationCount) }} · jeden wspólny formularz</h2>
          <span>Dane wpisujesz raz. Silnik uzupełnia formularze wszystkich banków i tworzy jedną paczkę ZIP.</span>
        </div>
        <div class="case-multiform__facts" aria-label="Zakres paczki">
          <span><strong>{{ caseData.clients.length }}</strong> wnioskodawców</span>
          <span><strong>{{ applicationCount }}</strong> banków</span>
          <span><strong>{{ templateIds.length }}</strong> formularzy</span>
        </div>
      </div>
    </template>

    <div v-if="applicationCards.length" class="case-multiform__applications" aria-label="Banki w paczce Multiwniosku">
      <article
        v-for="application in applicationCards"
        :key="application.id"
        class="case-multiform__application"
        :class="{ 'case-multiform__application--final': application.isFinal }"
      >
        <div class="case-multiform__application-heading">
          <span>Wniosek {{ application.slot }}</span>
          <UBadge
            :color="application.isFinal ? 'success' : application.status.color"
            variant="subtle"
            size="xs"
          >
            {{ application.isFinal ? 'Podpisana umowa' : application.status.label }}
          </UBadge>
        </div>
        <strong>{{ application.bankName }}</strong>
        <p>{{ application.productName }}</p>
        <small>{{ application.propertyLabel }}</small>
        <div class="case-multiform__application-footer">
          <span><UIcon name="i-lucide-files" /> {{ application.templateCount }} formularzy</span>
          <span v-if="application.slot === primaryApplication?.application.slot">
            <UIcon name="i-lucide-database" /> dane startowe
          </span>
        </div>
      </article>
    </div>

    <UAlert
      v-if="prerequisite"
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
          v-else-if="!caseData.bank_applications.length || !activeApplications.length"
          :to="caseData.offers.length
            ? { path: orgPath(`/cases/${caseData.id}`), query: { view: 'credit' }, hash: '#case-bank-applications' }
            : { path: orgPath('/mortgages'), query: { caseId: caseData.id } }"
          color="neutral"
          variant="soft"
          size="sm"
        >
          Wybierz banki do procesu
        </UButton>
        <UButton
          v-else-if="!documentsReady"
          :to="{ path: orgPath(`/cases/${caseData.id}`), query: { view: 'documents' }, hash: '#case-documents' }"
          color="neutral"
          variant="soft"
          size="sm"
        >
          Uzupełnij dokumenty
        </UButton>
      </template>
    </UAlert>

    <div v-else-if="!started" class="case-multiform__start">
      <span class="case-multiform__start-icon"><UIcon name="i-lucide-wand-sparkles" /></span>
      <div>
        <h3>{{ bankCountLabel(applicationCount) }} i dokumenty są gotowe</h3>
        <p>{{ bankNames.join(', ') }}: sprawdzimy mapowania, połączymy pola bez powtórzeń i przygotujemy jedną paczkę ZIP.</p>
      </div>
      <UButton icon="i-lucide-play" @click="loadContext">
        Rozpocznij uzupełnianie
      </UButton>
    </div>

    <div v-else-if="contextPending" class="case-multiform__loading" aria-busy="true">
      <USkeleton class="h-24 w-full" />
      <USkeleton class="h-40 w-full" />
    </div>

    <UAlert
      v-else-if="contextError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się uruchomić Multiwniosku"
      :description="contextError"
    >
      <template #actions>
        <UButton color="error" variant="soft" size="sm" @click="loadContext">Spróbuj ponownie</UButton>
      </template>
    </UAlert>

    <div v-else-if="context" class="case-multiform__workspace">
      <div class="case-multiform__offer-summary">
        <div>
          <span>Zakres wspólnej paczki</span>
          <strong>{{ context.applications.map(application => application.bankName).join(' · ') }}</strong>
        </div>
        <UBadge :color="contextCanPrepare ? 'success' : 'error'" variant="subtle">
          {{ contextCanPrepare ? 'Mapowania gotowe' : 'Mapowania wymagają pracy' }}
        </UBadge>
        <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-refresh-cw" @click="loadContext">
          Odśwież
        </UButton>
      </div>

      <UAlert
        v-if="context.selectedApplicationsValidation.blockers.length"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Eksport PDF jest bezpiecznie zablokowany"
      >
        <template #description>
          <p>Formularz pozostaje w CRM, ale przed wydrukiem trzeba zatwierdzić pełne mapowanie:</p>
          <ul>
            <li v-for="blocker in context.selectedApplicationsValidation.blockers" :key="blocker">{{ blocker }}</li>
          </ul>
        </template>
      </UAlert>

      <section class="case-multiform__attachments" aria-labelledby="case-multiform-attachments-title">
        <div class="case-multiform__section-heading">
          <div>
            <span>Krok 1</span>
            <h3 id="case-multiform-attachments-title">Załączniki do paczki</h3>
            <p>Wymagane poprawne pliki zaznaczyliśmy automatycznie.</p>
          </div>
          <UBadge color="neutral" variant="subtle">{{ selectedDocumentCount }} wybranych</UBadge>
        </div>

        <div class="case-multiform__attachment-list">
          <article
            v-for="requirement in context.checklist.requirements.filter(requirementAcceptsAttachment)"
            :key="requirement.key"
            class="case-multiform__attachment"
          >
            <div>
              <strong>{{ requirement.label }}</strong>
              <span>{{ requirementContextLabel(requirement) }}</span>
              <small v-if="requirement.ownerLabel">{{ requirement.ownerLabel }}</small>
            </div>
            <div v-if="requirementDocuments(requirement).length" class="case-multiform__attachment-options">
              <UCheckbox
                v-for="document in requirementDocuments(requirement)"
                :key="document.id"
                :model-value="selectedDocumentIds.includes(document.id)"
                :disabled="!document.eligible"
                :label="document.name"
                :description="`${document.applicant_label ? `${document.applicant_label} · ` : ''}${formatFileSize(document.size_bytes)}`"
                @update:model-value="toggleDocument(requirement, document.id, Boolean($event))"
              />
            </div>
            <UBadge
              v-else
              :color="emptyRequirementState(requirement).color"
              variant="subtle"
              size="xs"
            >
              {{ emptyRequirementState(requirement).label }}
            </UBadge>
          </article>
        </div>

        <UAlert
          v-if="missingSelectedRequirements.length"
          color="warning"
          variant="subtle"
          :title="`Brakuje wyboru dla ${missingSelectedRequirements.length} wymaganych pozycji`"
        />
      </section>

      <div v-if="!preparedBundle" class="case-multiform__prepare">
        <div>
          <strong>Wspólny formularz</strong>
          <span>{{ bankCountLabel(context.applications.length) }} · {{ context.templateIds.length }} PDF · jedna paczka ZIP</span>
        </div>
        <UButton
          icon="i-lucide-wand-sparkles"
          :loading="preparePending"
          :disabled="!contextCanPrepare"
          @click="prepareForm"
        >
          {{ preparePending ? 'Przygotowuję formularz…' : 'Przygotuj wspólny formularz' }}
        </UButton>
      </div>

      <UAlert
        v-if="prepareError"
        color="error"
        variant="subtle"
        title="Nie udało się przygotować formularza"
        :description="prepareError"
      />

      <form v-if="preparedBundle" class="case-multiform__form" novalidate @submit.prevent="fillAndDownload">
        <div ref="formHeading" class="case-multiform__form-heading" tabindex="-1">
          <div>
            <span>Krok 2</span>
            <h3>Uzupełnij dane tylko raz</h3>
            <p>Wartości trafią do {{ context.applications.length }} wniosków bankowych i {{ preparedBundle.documents.length }} formularzy PDF.</p>
          </div>
          <div class="case-multiform__progress">
            <span>Wymagane pola</span>
            <strong>{{ completedRequiredCount }}/{{ requiredFields.length }}</strong>
            <UProgress :model-value="formProgress" color="neutral" />
          </div>
        </div>

        <div class="case-multiform__document-strip" aria-label="Formularze w paczce">
          <span v-for="(document, index) in preparedBundle.documents" :key="document.id || document.templateId || index">
            <UIcon name="i-lucide-file-text" />
            {{ documentTitle(document, index) }}
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

        <div class="case-multiform__download-bar">
          <div>
            <span>Wynik · jedna paczka ZIP</span>
            <strong>{{ preparedBundle.documents.length }} uzupełnione PDF-y + {{ selectedDocumentCount }} załączników</strong>
          </div>
          <UButton
            type="submit"
            icon="i-lucide-download"
            :loading="fillPending"
            :disabled="!contextCanExport || !preparedBundle.fields.length"
          >
            {{ fillPending ? 'Generuję dokumenty…' : 'Uzupełnij i pobierz ZIP' }}
          </UButton>
        </div>
      </form>
    </div>
  </UCard>
</template>

<style scoped>
.case-multiform {
  margin: 20px 0 0;
}

.case-multiform__header,
.case-multiform__facts,
.case-multiform__start,
.case-multiform__offer-summary,
.case-multiform__application-heading,
.case-multiform__application-footer,
.case-multiform__section-heading,
.case-multiform__prepare,
.case-multiform__form-heading,
.case-multiform__download-bar,
.case-multiform__repeatable-heading,
.case-multiform__person-title {
  display: flex;
  align-items: center;
}

.case-multiform__header,
.case-multiform__section-heading,
.case-multiform__prepare,
.case-multiform__form-heading,
.case-multiform__download-bar,
.case-multiform__repeatable-heading {
  justify-content: space-between;
  gap: 20px;
}

.case-multiform__header > div:first-child,
.case-multiform__start > div,
.case-multiform__prepare > div,
.case-multiform__form-heading > div:first-child,
.case-multiform__section-heading > div,
.case-multiform__download-bar > div,
.case-multiform__repeatable-heading > div,
.case-multiform__person-title {
  display: grid;
  gap: 3px;
}

.case-multiform__header p,
.case-multiform__header h2,
.case-multiform__header span,
.case-multiform__start h3,
.case-multiform__start p,
.case-multiform__section-heading h3,
.case-multiform__section-heading p,
.case-multiform__form-heading h3,
.case-multiform__form-heading p,
.case-multiform__attachment strong,
.case-multiform__attachment span {
  margin: 0;
}

.case-multiform__header p,
.case-multiform__section-heading > div > span,
.case-multiform__form-heading > div:first-child > span,
.case-multiform__offer-summary span,
.case-multiform__person-title span,
.case-multiform__download-bar span {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.case-multiform__header h2 {
  color: var(--ui-text-highlighted);
  font-size: 18px;
}

.case-multiform__header > div:first-child > span,
.case-multiform__section-heading p,
.case-multiform__form-heading p,
.case-multiform__start p,
.case-multiform__prepare span,
.case-multiform__repeatable-heading span {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.case-multiform__facts {
  flex: 0 0 auto;
  gap: 8px;
}

.case-multiform__facts span {
  display: grid;
  gap: 1px;
  min-width: 82px;
  padding: 8px 10px;
  border-radius: 9px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 9px;
  text-align: center;
}

.case-multiform__facts strong {
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.case-multiform__applications {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 16px;
}

.case-multiform__application {
  display: grid;
  min-width: 0;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg-muted);
}

.case-multiform__application--final {
  border-color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-success) 7%, var(--ui-bg));
}

.case-multiform__application-heading,
.case-multiform__application-footer {
  justify-content: space-between;
  gap: 8px;
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
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-multiform__application > p,
.case-multiform__application > small {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-multiform__application > p {
  color: var(--ui-text-toned);
  font-size: 11px;
}

.case-multiform__application > small,
.case-multiform__application-footer {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.case-multiform__application-footer {
  margin-top: 6px;
  padding-top: 7px;
  border-top: 1px solid var(--ui-border-muted);
}

.case-multiform__application-footer span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.case-multiform__start {
  gap: 14px;
  padding: 6px 0;
}

.case-multiform__start > div {
  flex: 1;
}

.case-multiform__start-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.case-multiform__start h3,
.case-multiform__section-heading h3,
.case-multiform__form-heading h3 {
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.case-multiform__loading,
.case-multiform__workspace,
.case-multiform__attachment-list,
.case-multiform__form {
  display: grid;
  gap: 14px;
}

.case-multiform__offer-summary {
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg-muted);
}

.case-multiform__offer-summary > div {
  display: grid;
  flex: 1;
  gap: 2px;
}

.case-multiform__offer-summary strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.case-multiform__workspace :deep([data-slot="description"] ul) {
  margin: 7px 0 0;
  padding-left: 18px;
}

.case-multiform__attachments,
.case-multiform__field-section {
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
}

.case-multiform__attachment {
  display: grid;
  grid-template-columns: minmax(180px, .8fr) minmax(260px, 1.5fr);
  align-items: center;
  gap: 14px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.case-multiform__attachment:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.case-multiform__attachment > div:first-child {
  display: grid;
  gap: 2px;
}

.case-multiform__attachment > div:first-child strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.case-multiform__attachment > div:first-child span {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.case-multiform__attachment > div:first-child small {
  color: var(--ui-text-dimmed);
  font-size: 9px;
}

.case-multiform__attachment-options {
  display: grid;
  gap: 7px;
}

.case-multiform__prepare {
  padding: 14px;
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.case-multiform__prepare strong,
.case-multiform__download-bar strong,
.case-multiform__person-title strong,
.case-multiform__repeatable-heading strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.case-multiform__form {
  gap: 18px;
  margin-top: 4px;
}

.case-multiform__form-heading {
  padding-top: 6px;
  outline: none;
}

.case-multiform__progress {
  display: grid;
  grid-template-columns: auto auto;
  gap: 4px 12px;
  min-width: 180px;
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
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-border);
}

.case-multiform__download-bar {
  position: sticky;
  bottom: 10px;
  z-index: 2;
  padding: 14px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-bg) 94%, transparent);
  box-shadow: 0 14px 30px color-mix(in srgb, var(--ui-text-highlighted) 8%, transparent);
  backdrop-filter: blur(12px);
}

.case-multiform__download-bar > div {
  flex: 1;
}

@media (max-width: 760px) {
  .case-multiform__header,
  .case-multiform__start,
  .case-multiform__section-heading,
  .case-multiform__prepare,
  .case-multiform__form-heading,
  .case-multiform__download-bar,
  .case-multiform__repeatable-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .case-multiform__facts {
    align-self: stretch;
  }

  .case-multiform__facts span {
    flex: 1;
  }

  .case-multiform__applications {
    grid-template-columns: 1fr;
  }

  .case-multiform__attachment {
    grid-template-columns: 1fr;
  }

  .case-multiform__field-grid {
    grid-template-columns: 1fr;
  }

  .case-multiform__download-bar {
    position: static;
  }
}
</style>
