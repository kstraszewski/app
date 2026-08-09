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
  canonicalDisbursementTypeFromIntake,
  canonicalLoanPurposeFromIntake,
  multiformApplicantDefaults,
} from '~/utils/multiform-prefill'
import {
  multiformFillMethodIsSupported,
  multiformFillMethodPresentation,
} from '~/utils/multiform-fill-method'
import {
  changeCollectionCount,
  collectionState,
  normalizeCollectionActiveIndex,
  normalizeCollectionCount,
  supportedCollectionItemCount,
} from '~/utils/multiform-collections'
import {
  buildMultiformSubmissionReadinessManifest,
  createEmptyMultiformIntake,
  getMultiformIntakeProgress,
  normalizeMultiformIntake,
  resolveMultiformIntakeRequirement,
  validateMultiformIntake,
  type MultiformIntakeAnswers,
  type MultiformSubmissionReadinessManifest,
} from '#shared/multiform-intake'

interface MultiformDeliveryRecipientResult {
  clientId: string
  displayName: string
  email: string
  alreadySent?: boolean
}

interface MultiformDeliveryResponse {
  status: 'complete' | 'partial' | 'failed'
  sent: MultiformDeliveryRecipientResult[]
  failed: MultiformDeliveryRecipientResult[]
}

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
const individualDownloadPending = ref('')
const templatePreviewOpen = ref(false)
const templatePreviewDocument = shallowRef<MultiformPrepareResponse['documents'][number] | null>(null)
const templatePreviewBankId = ref('')
const contextError = ref('')
const draftError = ref('')
const prepareError = ref('')
const fillError = ref('')
const individualDownloadError = ref('')
const context = ref<MultiformCrmContext | null>(null)
const preparedBundle = ref<MultiformPrepareResponse | null>(null)
const selectedDocumentIds = ref<string[]>([])
const excludedPackageDocumentIds = ref<string[]>([])
const selectedPackageApplicationIds = ref<string[]>([])
const activePackageApplicationId = ref('')
const protectZipWithPassword = ref(true)
const zipPasswordModalOpen = ref(false)
const zipPassword = ref('')
const zipPasswordCopied = ref(false)
const sendModalOpen = ref(false)
const sendPending = ref(false)
const sendError = ref('')
const sendRequestId = ref('')
const sendApplicationIds = ref<string[]>([])
const sendResult = ref<MultiformDeliveryResponse | null>(null)
const zipPasswordModalModel = computed({
  get: () => zipPasswordModalOpen.value,
  set: (open: boolean) => {
    if (open) zipPasswordModalOpen.value = true
    else closeZipPasswordModal()
  },
})
const sendModalModel = computed({
  get: () => sendModalOpen.value,
  set: (open: boolean) => {
    if (open) sendModalOpen.value = true
    else closeSendModal()
  },
})
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

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes < 1) return 'Rozmiar zostanie ustalony przy pobraniu'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

const missingTemplateWarnings = computed(() => (
  context.value?.selectedApplicationsValidation.warnings ?? []
))

const mappingBlockers = computed(() => new Set(
  context.value?.selectedApplicationsValidation.templates.flatMap(template => (
    template.warnings.map(warning => `${template.templateId}: ${warning}`)
  )) ?? [],
))

const formPreparationBlockers = computed(() => (
  context.value?.selectedApplicationsValidation.blockers.filter(blocker => (
    !mappingBlockers.value.has(blocker)
  )) ?? []
))

const contextCanPrepare = computed(() => Boolean(
  context.value
  && context.value.applicationIds.length > 0
  && context.value.templateIds.length > 0
  && formPreparationBlockers.value.length === 0
))

const formPreparationBlocker = computed(() => {
  if (formPreparationBlockers.value.length) {
    return formPreparationBlockers.value[0]
      || 'Aktywne wnioski nie są jeszcze gotowe do przygotowania formularzy bankowych.'
  }
  if (!templateIds.value.length) {
    return 'Checklista jest dostępna, ale ten bank nie ma jeszcze przypisanego formularza PDF. Formularze i paczka ZIP odblokują się po dodaniu szablonu banku.'
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
const selectedDocuments = computed(() => {
  const selected = new Set(selectedDocumentIds.value)
  return context.value?.documents.filter(document => selected.has(document.id)) ?? []
})

const packageApplications = computed(() => (
  (context.value?.applications ?? [])
    .slice()
    .sort((left, right) => left.slot - right.slot)
))

const activePackageApplication = computed(() => (
  packageApplications.value.find(application => (
    application.applicationId === activePackageApplicationId.value
  )) ?? packageApplications.value[0] ?? null
))

function packageApplicationIsSelected(applicationId: string) {
  return selectedPackageApplicationIds.value.includes(applicationId)
}

function setPackageApplicationSelected(applicationId: string, selected: boolean) {
  const next = new Set(selectedPackageApplicationIds.value)
  if (selected) next.add(applicationId)
  else next.delete(applicationId)
  selectedPackageApplicationIds.value = packageApplications.value
    .map(application => application.applicationId)
    .filter(id => next.has(id))
}

function initializePackageApplicationSelection(nextContext: MultiformCrmContext) {
  const applicationIds = nextContext.applications
    .slice()
    .sort((left, right) => left.slot - right.slot)
    .map(application => application.applicationId)
  selectedPackageApplicationIds.value = applicationIds
  activePackageApplicationId.value = nextContext.applications.find(application => (
    application.templateIds.length > 0
  ))?.applicationId ?? applicationIds[0] ?? ''
}

function packagePreparedDocuments(applicationId: string) {
  const application = packageApplications.value.find(item => item.applicationId === applicationId)
  if (!application) return []
  const templateIds = new Set(application.templateIds)
  return (preparedBundle.value?.documents ?? []).filter(document => (
    templateIds.has(preparedDocumentTemplateId(document))
    && preparedDocumentIsApplicable(document)
  ))
}

function preparedDocumentIsApplicable(
  preparedDocument: MultiformPrepareResponse['documents'][number],
) {
  if (!preparedDocument.includeWhen) return true
  const actual = values.value[preparedDocument.includeWhen.canonicalKey]
  if (actual === undefined || actual === null || actual === '') return false
  const expected = Array.isArray(preparedDocument.includeWhen.equals)
    ? preparedDocument.includeWhen.equals
    : [preparedDocument.includeWhen.equals]
  return expected.includes(String(actual))
}

const applicablePreparedDocuments = computed(() => (
  (preparedBundle.value?.documents ?? []).filter(preparedDocumentIsApplicable)
))

function preparedDocumentFillMethod(
  preparedDocument: MultiformPrepareResponse['documents'][number],
) {
  return multiformFillMethodPresentation(preparedDocument.fillMethod)
}

function preparedDocumentIsSupported(
  preparedDocument: MultiformPrepareResponse['documents'][number],
) {
  return multiformFillMethodIsSupported(preparedDocument.fillMethod)
}

function preparedDocumentIsManual(
  preparedDocument: MultiformPrepareResponse['documents'][number],
) {
  return preparedDocument.fillMethod?.kind === 'pdf_manual'
    || preparedDocument.fillMethod?.kind === 'xlsx_manual'
}

function preparedDocumentIsPassThrough(
  preparedDocument: MultiformPrepareResponse['documents'][number],
) {
  return preparedDocument.fillMethod?.kind === 'pdf_manual'
    || preparedDocument.fillMethod?.kind === 'pdf_readonly'
    || preparedDocument.fillMethod?.kind === 'xlsx_manual'
}

function preparedDocumentSupportsFieldPreview(
  preparedDocument: MultiformPrepareResponse['documents'][number],
) {
  return preparedDocument.fillMethod?.kind === 'pdf_acroform'
    || preparedDocument.fillMethod?.kind === 'pdf_overlay'
    || preparedDocument.fillMethod?.kind === 'pdf_hybrid'
}

function unsupportedPreparedDocument(applicationIds: readonly string[]) {
  return applicationIds
    .flatMap(applicationId => packagePreparedDocuments(applicationId))
    .find(document => !preparedDocumentIsSupported(document))
}

function packageAvailableDocuments(applicationIds: readonly string[]) {
  const selectedApplications = new Set(applicationIds)
  const selectedFiles = new Set(selectedDocumentIds.value)
  return context.value?.documents.filter(document => (
    selectedFiles.has(document.id)
    && (document.submission_id === null || selectedApplications.has(document.submission_id))
  )) ?? []
}

function packageDocumentIsSelected(documentId: string) {
  return !excludedPackageDocumentIds.value.includes(documentId)
}

function setPackageDocumentSelected(documentId: string, selected: boolean) {
  const available = new Set(packageAvailableDocuments(
    packageApplications.value.map(application => application.applicationId),
  ).map(document => document.id))
  if (!available.has(documentId)) return

  const excluded = new Set(excludedPackageDocumentIds.value)
  if (selected) excluded.delete(documentId)
  else excluded.add(documentId)
  excludedPackageDocumentIds.value = [...excluded]
}

function packageDocuments(applicationIds: readonly string[]) {
  const excluded = new Set(excludedPackageDocumentIds.value)
  return packageAvailableDocuments(applicationIds).filter(document => !excluded.has(document.id))
}

function packageRequirements(applicationId: string) {
  return context.value?.checklist.requirements.filter(requirement => (
    !requirement.applicationId
    || requirement.applicationId === applicationId
    || requirement.applicationIds.includes(applicationId)
  )) ?? []
}

function missingSelectedRequirementsForApplications(applicationIds: readonly string[]) {
  const selectedApplications = new Set(applicationIds)
  const selectedFiles = new Set(selectedDocumentIds.value)
  const requirements = resolvedDocumentRequirements.value.filter(requirement => (
    requirement.applicationIds.length === 0
    || requirement.applicationIds.some(applicationId => selectedApplications.has(applicationId))
  ))
  return requirements.filter(requirement => (
    !requirement.documentIds.some(documentId => selectedFiles.has(documentId))
  ))
}

const activePackageDocuments = computed(() => activePackageApplication.value
  ? packageAvailableDocuments([activePackageApplication.value.applicationId])
  : [])

const activePackageSelectedDocumentCount = computed(() => (
  activePackageDocuments.value.filter(document => packageDocumentIsSelected(document.id)).length
))

const activePackageAllDocumentsSelected = computed(() => (
  activePackageDocuments.value.length > 0
  && activePackageSelectedDocumentCount.value === activePackageDocuments.value.length
))

function toggleActivePackageDocuments() {
  const selected = !activePackageAllDocumentsSelected.value
  for (const document of activePackageDocuments.value) {
    setPackageDocumentSelected(document.id, selected)
  }
}

const activePackagePreparedDocuments = computed(() => activePackageApplication.value
  ? packagePreparedDocuments(activePackageApplication.value.applicationId)
  : [])

const activePackageHasUnsupportedFillMethod = computed(() => (
  activePackagePreparedDocuments.value.some(document => !preparedDocumentIsSupported(document))
))

const selectedPackageHasUnsupportedFillMethod = computed(() => Boolean(
  unsupportedPreparedDocument(selectedPackageApplicationIds.value),
))

function packageSubmissionReadiness(applicationId: string): MultiformSubmissionReadinessManifest {
  return buildMultiformSubmissionReadinessManifest({
    applicationId,
    requirements: packageRequirements(applicationId),
    documents: context.value?.documents ?? [],
    selectedDocumentIds: packageDocuments([applicationId]).map(document => document.id),
    intakeAnswers: intakeAnswers.value,
    now: context.value?.checklist.readiness.evaluatedAt,
  })
}

const activePackageReadiness = computed(() => activePackageApplication.value
  ? packageSubmissionReadiness(activePackageApplication.value.applicationId)
  : null)

const selectedPackageReadiness = computed(() => selectedPackageApplicationIds.value.map(
  applicationId => packageSubmissionReadiness(applicationId),
))

const selectedPackageReadyForSubmission = computed(() => (
  selectedPackageReadiness.value.length > 0
  && selectedPackageReadiness.value.every(manifest => manifest.readyForSubmission)
  && missingTemplateWarnings.value.length === 0
))

const selectedPackageReadinessIssueCount = computed(() => (
  selectedPackageReadiness.value.reduce(
    (count, manifest) => count + manifest.blockingIssues.length,
    0,
  ) + missingTemplateWarnings.value.length
))

const selectedPackageDocumentCount = computed(() => {
  const applicationIds = selectedPackageApplicationIds.value
  const formCount = applicationIds.reduce((count, applicationId) => (
    count + packagePreparedDocuments(applicationId).length
  ), 0)
  return formCount + packageDocuments(applicationIds).length
})

function bankOffer(applicationId: string) {
  const application = packageApplications.value.find(item => item.applicationId === applicationId)
  return application
    ? props.caseData.offers.find(offer => offer.id === application.offerId) ?? null
    : null
}

function applicationDocumentCount(applicationId: string) {
  return packagePreparedDocuments(applicationId).length + packageDocuments([applicationId]).length
}

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
    initializePackageApplicationSelection(response)
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
  excludedPackageDocumentIds.value = []
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
  sendModalOpen.value = false
  sendPending.value = false
  sendError.value = ''
  sendRequestId.value = ''
  sendApplicationIds.value = []
  sendResult.value = null
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
  return fieldIsActive(field)
    && conditionMatches(field.visibleWhen)
    && (
      !field.applicableWhenAny?.length
      || field.applicableWhenAny.some(conditionMatches)
    )
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
  if (field.validation?.maxLength !== undefined && rawValue.length > field.validation.maxLength) return true
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
  (preparedBundle.value?.fields ?? []).filter(fieldIsVisible),
  preparedBundle.value?.collections ?? [],
))

function supportedCollectionCount(
  collection: MultiformCollectionDefinition,
  fields: MultiformFormField[],
) {
  return supportedCollectionItemCount(collection.key, collection.maxItems, fields)
}

function applicantDefaults(index: number) {
  const applicant = context.value?.applicants[index]
  if (!applicant) return {}
  const client = props.caseData.clients.find(item => item.id === applicant.clientId)
  return multiformApplicantDefaults(applicant, client)
}

function suggestedValue(field: MultiformFormField): MultiformFieldValue | undefined {
  if (field.collection?.key === 'applicants') {
    const defaults = applicantDefaults(field.collection.index)
    const relativeKey = field.collection.relativeKey as keyof typeof defaults
    if (relativeKey in defaults) return defaults[relativeKey]
    const applicant = context.value?.applicants[field.collection.index]
    const intake = applicant ? intakeAnswers.value.applicants[applicant.clientId] : undefined
    if (field.collection.relativeKey === 'incomeSource' && intake?.incomeSource) {
      return intake.incomeSource
    }
    if (field.collection.relativeKey === 'employmentType' && intake?.employmentType) {
      return intake.employmentType
    }
  }
  if (field.key === 'loan.program' && intakeAnswers.value.case.loanProgram) {
    return intakeAnswers.value.case.loanProgram
  }
  if (field.key === 'loan.rkmGuarantee' && intakeAnswers.value.case.rkmGuarantee !== null) {
    return intakeAnswers.value.case.rkmGuarantee
  }
  if (field.key === 'loan.purpose') {
    return canonicalLoanPurposeFromIntake(intakeAnswers.value.case.loanPurpose)
  }
  if (field.key === 'loan.disbursementType') {
    return canonicalDisbursementTypeFromIntake(intakeAnswers.value.case.trancheDisbursement)
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
    if (minimumRequested > supported) {
      throw new Error(
        `${collection.label}: zestaw dokumentów obsługuje ${supported}, a sprawa wymaga ${minimumRequested} pozycji.`,
      )
    }
    const requested = normalizeCollectionCount(
      collectionCounts.value[collection.key],
      { minItems: minimumRequested, maxItems: supported },
    )
    nextCounts[collection.key] = requested
    nextTabs[collection.key] = requested > 0 ? '0' : ''
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
  const normalized = normalizeCollectionActiveIndex(
    activeCollectionTabs.value[group.collection.key],
    collectionItemCount(group.collection),
  )
  return normalized !== null && collectionItems(group).some(item => item.index === normalized)
    ? normalized
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
  const activeIndex = normalizeCollectionActiveIndex(value, collectionItemCount(group.collection))
  if (activeIndex === null || !collectionItems(group).some(item => item.index === activeIndex)) return
  activeCollectionTabs.value = {
    ...activeCollectionTabs.value,
    [group.collection.key]: String(activeIndex),
  }
}

function isApplicantCollection(group: MultiformRepeatableGroup) {
  return group.collection.key === 'applicants'
}

function collectionLimit(group: MultiformRepeatableGroup) {
  return supportedCollectionCount(
    group.collection,
    preparedBundle.value?.fields ?? [],
  )
}

function groupCollectionState(group: MultiformRepeatableGroup) {
  return collectionState(
    collectionItemCount(group.collection),
    activeCollectionTabs.value[group.collection.key],
    {
      minItems: group.collection.minItems,
      maxItems: collectionLimit(group),
    },
  )
}

function collectionDescription(group: MultiformRepeatableGroup) {
  if (isApplicantCollection(group)) {
    return 'Lista wynika z klientów przypisanych do sprawy.'
  }
  const limit = collectionLimit(group)
  return group.collection.minItems === 0
    ? `Dodaj pozycje w razie potrzeby. Maksymalnie: ${limit}.`
    : `Formularz wymaga od ${group.collection.minItems} do ${limit} pozycji.`
}

function updateCollectionState(
  group: MultiformRepeatableGroup,
  nextState: ReturnType<typeof groupCollectionState>,
) {
  collectionCounts.value = {
    ...collectionCounts.value,
    [group.collection.key]: nextState.count,
  }
  activeCollectionTabs.value = {
    ...activeCollectionTabs.value,
    [group.collection.key]: nextState.activeIndex === null ? '' : String(nextState.activeIndex),
  }
}

function addCollectionItem(group: MultiformRepeatableGroup) {
  if (isApplicantCollection(group)) return
  const bounds = {
    minItems: group.collection.minItems,
    maxItems: collectionLimit(group),
  }
  const current = groupCollectionState(group)
  updateCollectionState(group, changeCollectionCount(current, bounds, 'add'))
}

function removeCollectionItem(group: MultiformRepeatableGroup) {
  if (isApplicantCollection(group)) return
  const bounds = {
    minItems: group.collection.minItems,
    maxItems: collectionLimit(group),
  }
  const current = groupCollectionState(group)
  const next = changeCollectionCount(current, bounds, 'remove')
  if (next.count === current.count) return

  for (const field of preparedBundle.value?.fields ?? []) {
    if (field.collection?.key !== group.collection.key || field.collection.index < next.count) continue
    values.value[field.key] = field.type === 'checkbox' ? false : ''
  }
  updateCollectionState(group, next)
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

function filledPdfFileName(preparedDocument: MultiformPrepareResponse['documents'][number]) {
  const isXlsx = preparedDocument.fillMethod?.kind === 'xlsx_native'
    || preparedDocument.fillMethod?.kind === 'xlsx_manual'
  const extension = isXlsx ? '.xlsx' : '.pdf'
  const sourceName = preparedDocument.fileName || `wniosek${extension}`
  if (preparedDocumentIsPassThrough(preparedDocument)) return blankPdfFileName(preparedDocument)
  const base = `uzupelniony-${sourceName.toLocaleLowerCase('pl-PL').endsWith(extension)
    ? sourceName
    : `${sourceName}${extension}`}`
  if (preparedDocument.instanceIndex === undefined) return base
  const suffix = preparedDocument.instanceLabel
    ?.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLocaleLowerCase('pl-PL') || `wnioskodawca-${preparedDocument.instanceIndex + 1}`
  return base.replace(/\.(?:pdf|xlsx)$/i, `-${suffix}${extension}`)
}

function blankPdfFileName(preparedDocument: MultiformPrepareResponse['documents'][number]) {
  const isXlsx = preparedDocument.fillMethod?.kind === 'xlsx_native'
    || preparedDocument.fillMethod?.kind === 'xlsx_manual'
  const extension = isXlsx ? '.xlsx' : '.pdf'
  const sourceName = preparedDocument.fileName || `szablon-wniosku${extension}`
  return sourceName.toLocaleLowerCase('pl-PL').endsWith(extension)
    ? sourceName
    : `${sourceName}${extension}`
}

function preparedDocumentTemplateId(
  preparedDocument: MultiformPrepareResponse['documents'][number],
) {
  return preparedDocument.templateId || preparedDocument.id || ''
}

function templateBankId(
  preparedDocument: MultiformPrepareResponse['documents'][number],
) {
  const templateId = preparedDocumentTemplateId(preparedDocument)
  if (!templateId) return ''
  const application = context.value?.applications.find(item => (
    item.templateIds.includes(templateId)
  ))
  if (application?.bankId) return application.bankId
  if (context.value?.templateIds.includes(templateId)) return context.value.bank.id || ''
  return ''
}

function openTemplatePreview(
  preparedDocument: MultiformPrepareResponse['documents'][number],
) {
  const bankId = templateBankId(preparedDocument)
  if (!bankId) {
    individualDownloadError.value = 'Nie udało się ustalić banku przypisanego do tego szablonu.'
    return
  }
  individualDownloadError.value = ''
  templatePreviewDocument.value = preparedDocument
  templatePreviewBankId.value = bankId
  templatePreviewOpen.value = true
}

async function handleTemplateSaved() {
  await loadContext()
  if (context.value) await prepareForm(false)
}

async function downloadPreparedDocument(
  preparedDocument: MultiformPrepareResponse['documents'][number],
  variant: 'filled' | 'blank',
) {
  const templateId = preparedDocument.templateId || preparedDocument.id
  if (!templateId || individualDownloadPending.value) return
  const preparedDocumentId = preparedDocument.id || templateId
  individualDownloadError.value = ''
  if (!preparedDocumentIsSupported(preparedDocument)) {
    individualDownloadError.value = `${preparedDocumentFillMethod(preparedDocument).label} jest jeszcze nieobsługiwany w eksporcie Multiwniosku.`
    return
  }
  if (variant === 'filled') validationVisible.value = true
  if (variant === 'filled' && invalidFields.value.length) {
    fillError.value = `Uzupełnij lub popraw oznaczone pola (${invalidFields.value.length}).`
    activeStep.value = 3
    await focusFirstInvalidField()
    return
  }
  individualDownloadPending.value = `template:${variant}:${preparedDocumentId}`
  try {
    const blob = await $fetch<Blob>(
      crmApiPath(`/cases/${props.caseData.id}/multiform/files/${encodeURIComponent(templateId)}`),
      {
        method: 'POST',
        body: {
          variant,
          values: activeValuesPayload(),
          collectionCounts: collectionCounts.value,
          ...(preparedDocument.instanceIndex !== undefined
            ? { instanceIndex: preparedDocument.instanceIndex }
            : {}),
        },
        responseType: 'blob',
      },
    )
    downloadBlob(
      blob,
      variant === 'blank'
        ? blankPdfFileName(preparedDocument)
        : filledPdfFileName(preparedDocument),
    )
  }
  catch (error) {
    individualDownloadError.value = readableError(
      error,
      variant === 'blank'
        ? 'Nie udało się pobrać pustego szablonu dokumentu.'
        : 'Nie udało się pobrać uzupełnionego dokumentu.',
    )
  }
  finally {
    individualDownloadPending.value = ''
  }
}

async function downloadAttachment(document: MultiformCrmContext['documents'][number]) {
  if (individualDownloadPending.value) return
  individualDownloadError.value = ''
  individualDownloadPending.value = `attachment:${document.id}`
  try {
    const blob = await $fetch<Blob>(
      crmApiPath(`/cases/${props.caseData.id}/documents/${document.id}`),
      { responseType: 'blob' },
    )
    downloadBlob(blob, document.name || 'zalacznik')
  }
  catch (error) {
    individualDownloadError.value = readableError(error, 'Nie udało się pobrać załącznika.')
  }
  finally {
    individualDownloadPending.value = ''
  }
}

function generateZipPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const random = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(random, value => alphabet[value % alphabet.length])
    .join('')
    .match(/.{1,4}/g)!
    .join('-')
}

function closeZipPasswordModal() {
  zipPasswordModalOpen.value = false
  zipPassword.value = ''
  zipPasswordCopied.value = false
}

async function copyZipPassword() {
  if (!zipPassword.value) return
  await navigator.clipboard.writeText(zipPassword.value)
  zipPasswordCopied.value = true
  toast.add({ title: 'Hasło skopiowane', color: 'success' })
}

async function validatePackageForExport(
  requestedApplicationIds: readonly string[],
) {
  if (!preparedBundle.value) {
    fillError.value = 'Najpierw przygotuj formularze bankowe.'
    return null
  }
  const applicationIds = [...new Set(requestedApplicationIds)]
  validationVisible.value = true
  fillError.value = ''
  if (!applicationIds.length) {
    fillError.value = 'Wybierz co najmniej jeden wniosek bankowy do paczki.'
    return null
  }
  const selectedApplications = packageApplications.value.filter(application => (
    applicationIds.includes(application.applicationId)
  ))
  if (!selectedApplications.some(application => application.templateIds.length > 0)) {
    fillError.value = 'Wybrane wnioski nie mają szablonu formularza do wygenerowania.'
    return null
  }
  const unsupportedDocument = unsupportedPreparedDocument(applicationIds)
  if (unsupportedDocument) {
    fillError.value = `${preparedDocumentFillMethod(unsupportedDocument).label} jest jeszcze nieobsługiwany w eksporcie Multiwniosku.`
    return null
  }
  const missingRequirements = missingSelectedRequirementsForApplications(applicationIds)
  if (!mappingsReady.value || missingRequirements.length) {
    fillError.value = mappingsReady.value
      ? `Wybierz pliki dla wszystkich wymaganych pozycji (${missingRequirements.length}).`
      : 'Eksport czeka na kompletne mapowanie pól formularzy bankowych.'
    return null
  }
  if (invalidFields.value.length) {
    fillError.value = `Uzupełnij lub popraw oznaczone pola (${invalidFields.value.length}).`
    activeStep.value = 3
    await focusFirstInvalidField()
    return null
  }
  return applicationIds
}

async function fillAndDownload(
  requestedApplicationIds: readonly string[] = selectedPackageApplicationIds.value,
) {
  if (fillPending.value || sendPending.value) return
  const applicationIds = await validatePackageForExport(requestedApplicationIds)
  if (!applicationIds) return
  exportComplete.value = false

  fillPending.value = true
  const password = protectZipWithPassword.value ? generateZipPassword() : ''
  try {
    const blob = await $fetch<Blob>(
      crmApiPath(`/cases/${props.caseData.id}/multiform/fill`),
      {
        method: 'POST',
        body: {
          values: activeValuesPayload(),
          collectionCounts: collectionCounts.value,
          applicationIds,
          documentIds: packageDocuments(applicationIds).map(document => document.id),
          ...(password ? { password } : {}),
        },
        responseType: 'blob',
      },
    )
    const singleApplication = applicationIds.length === 1
      ? packageApplications.value.find(application => application.applicationId === applicationIds[0])
      : null
    const packageName = singleApplication?.bankName || props.caseData.title
    downloadBlob(blob, `wnioski-${packageName
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'sprawa'}.zip`)
    exportComplete.value = true
    if (password) {
      zipPassword.value = password
      zipPasswordCopied.value = false
      zipPasswordModalOpen.value = true
    }
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

function closeSendModal() {
  if (sendPending.value) return
  sendModalOpen.value = false
  sendError.value = ''
  sendRequestId.value = ''
  sendApplicationIds.value = []
  sendResult.value = null
}

async function openSendModal() {
  if (sendPending.value || fillPending.value) return
  const applicationIds = await validatePackageForExport(selectedPackageApplicationIds.value)
  if (!applicationIds) return
  sendApplicationIds.value = applicationIds
  sendRequestId.value = crypto.randomUUID()
  sendError.value = ''
  sendResult.value = null
  sendModalOpen.value = true
}

async function sendPackageToClients() {
  if (
    sendPending.value
    || !sendModalOpen.value
    || !sendRequestId.value
    || !sendApplicationIds.value.length
  ) return

  sendPending.value = true
  sendError.value = ''
  try {
    const response = await $fetch<MultiformDeliveryResponse>(
      crmApiPath(`/cases/${props.caseData.id}/multiform/send`),
      {
        method: 'POST',
        body: {
          requestId: sendRequestId.value,
          values: activeValuesPayload(),
          collectionCounts: collectionCounts.value,
          applicationIds: sendApplicationIds.value,
          documentIds: packageDocuments(sendApplicationIds.value).map(document => document.id),
        },
      },
    )
    sendResult.value = response
    if (response.status === 'complete') {
      toast.add({
        title: 'Paczki wysłane do klientów',
        description: `Wysłano ${response.sent.length} zabezpieczonych wiadomości.`,
        color: 'success',
      })
    }
    else {
      sendError.value = response.status === 'partial'
        ? `Wysłano ${response.sent.length} z ${response.sent.length + response.failed.length} wiadomości. Możesz ponowić pozostałe.`
        : 'Nie udało się wysłać paczek. Sprawdź konfigurację poczty i spróbuj ponownie.'
    }
  }
  catch (error) {
    sendError.value = readableError(
      error,
      'Nie udało się wysłać paczek do klientów.',
    )
  }
  finally {
    sendPending.value = false
  }
}

function deliveryResultFor(clientId: string) {
  if (sendResult.value?.sent.some(recipient => recipient.clientId === clientId)) return 'sent'
  if (sendResult.value?.failed.some(recipient => recipient.clientId === clientId)) return 'failed'
  return 'pending'
}

const sendActionLabel = computed(() => {
  if (sendPending.value) return 'Wysyłam bezpieczne paczki…'
  if (sendResult.value?.status === 'complete') return 'Wysłano do klientów'
  if (sendResult.value?.status === 'partial') return 'Ponów niewysłane'
  return `Wyślij do klientów (${props.caseData.clients.length})`
})

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
    fillError.value = ''
    activeStep.value = 4
    await persistCurrentDraft()
    await focusCurrentStep()
    return
  }
  await fillAndDownload(selectedPackageApplicationIds.value)
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
  return fillPending.value
    ? 'Generuję dokumenty…'
    : `Pobierz całość ZIP (${selectedPackageDocumentCount.value})`
})

const primaryActionIcon = computed(() => (
  activeStep.value === 4 ? 'i-lucide-download' : 'i-lucide-arrow-right'
))

const primaryActionDisabled = computed(() => (
  contextPending.value
  || draftPending.value
  || preparePending.value
  || fillPending.value
  || sendPending.value
  || Boolean(individualDownloadPending.value)
  || (activeStep.value === 2 && Boolean(formPreparationBlocker.value))
  || (activeStep.value === 4 && (!contextCanExport.value || !selectedPackageApplicationIds.value.length))
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

watch(() => invalidFields.value.length, (count) => {
  if (!fillError.value.startsWith('Uzupełnij lub popraw oznaczone pola')) return
  fillError.value = count
    ? `Uzupełnij lub popraw oznaczone pola (${count}).`
    : ''
})

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
    :class="{ 'case-multiform--package': activeStep === 4 }"
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
            v-if="prepareError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Nie udało się przygotować formularzy bankowych"
            :description="prepareError"
          >
            <template #actions>
              <UButton color="error" variant="soft" size="sm" @click="prepareForm(false)">
                Spróbuj ponownie
              </UButton>
            </template>
          </UAlert>
          <UAlert
            v-if="formPreparationBlocker"
            color="warning"
            variant="subtle"
            icon="i-lucide-file-warning"
            title="Formularze bankowe wymagają szablonu PDF"
            :description="formPreparationBlocker"
          />
          <UAlert
            v-if="missingTemplateWarnings.length"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Część banków wymaga obsługi ręcznej"
          >
            <template #description>
              <ul>
                <li v-for="warning in missingTemplateWarnings" :key="warning">
                  {{ warning }}
                </li>
              </ul>
            </template>
          </UAlert>
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
                i {{ applicablePreparedDocuments.length }} formularzy PDF.
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
                v-for="(preparedDocument, index) in applicablePreparedDocuments"
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
                  <div class="case-multiform__file-info">
                    <strong>{{ group.collection.label }}</strong>
                    <span>{{ collectionDescription(group) }}</span>
                  </div>
                  <UButton
                    v-if="isApplicantCollection(group)"
                    :to="{ path: orgPath(`/cases/${caseData.id}`), query: { view: 'credit' }, hash: '#case-clients' }"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-users-round"
                  >
                    Zarządzaj wnioskodawcami
                  </UButton>
                  <div
                    v-else-if="collectionItems(group).length"
                    class="case-multiform__repeatable-actions"
                  >
                    <UButton
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-trash-2"
                      :disabled="!groupCollectionState(group).canRemove"
                      @click="removeCollectionItem(group)"
                    >
                      Usuń pozycję
                    </UButton>
                    <UButton
                      color="neutral"
                      variant="outline"
                      size="xs"
                      icon="i-lucide-plus"
                      :disabled="!groupCollectionState(group).canAdd"
                      @click="addCollectionItem(group)"
                    >
                      Dodaj pozycję
                    </UButton>
                  </div>
                </div>
                <template v-if="collectionItems(group).length">
                  <UTabs
                    :model-value="String(activeCollectionIndex(group))"
                    :items="collectionTabItems(group)"
                    :content="false"
                    class="case-multiform__person-tabs"
                    @update:model-value="updateCollectionTab(group, $event)"
                  />
                  <div class="case-multiform__person-panel">
                    <div class="case-multiform__person-title">
                      <span>{{ group.collection.label }}</span>
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
                </template>
                <div v-else class="case-multiform__repeatable-empty">
                  <span><UIcon name="i-lucide-list-plus" /></span>
                  <div>
                    <strong>Brak pozycji</strong>
                    <small>Dodaj pierwszą pozycję „{{ group.collection.itemLabel }}”, aby uzupełnić jej dane.</small>
                  </div>
                  <UButton
                    color="neutral"
                    variant="outline"
                    size="xs"
                    icon="i-lucide-plus"
                    :disabled="!groupCollectionState(group).canAdd"
                    @click="addCollectionItem(group)"
                  >
                    Dodaj pozycję
                  </UButton>
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
          <header class="case-multiform__package-heading">
            <div class="case-multiform__step-heading">
              <p>Paczka wniosków</p>
              <h3 id="case-multiform-zip-title">Dokumenty według wniosków bankowych</h3>
              <span>Wybierz wnioski, sprawdź ich zawartość i pobierz osobną albo zbiorczą paczkę.</span>
            </div>
            <div class="case-multiform__package-actions">
              <label class="case-multiform__password-option">
                <input v-model="protectZipWithPassword" type="checkbox" :disabled="fillPending || sendPending">
                <span>
                  <strong>Zabezpiecz jednorazowym hasłem</strong>
                  <small>Hasło pokażemy tylko po pobraniu</small>
                </span>
              </label>
              <UButton
                size="lg"
                color="neutral"
                variant="outline"
                icon="i-lucide-send"
                :loading="sendPending"
                :disabled="!selectedPackageApplicationIds.length || selectedPackageHasUnsupportedFillMethod || fillPending || sendPending"
                @click="openSendModal"
              >
                Wyślij do klientów
              </UButton>
              <UButton
                size="lg"
                icon="i-lucide-download"
                :loading="fillPending"
                :disabled="!selectedPackageApplicationIds.length || selectedPackageHasUnsupportedFillMethod || fillPending || sendPending"
                @click="fillAndDownload(selectedPackageApplicationIds)"
              >
                Pobierz całość ZIP ({{ selectedPackageDocumentCount }})
              </UButton>
            </div>
          </header>

          <div class="case-multiform__package-layout">
            <aside class="case-multiform__application-rail" aria-label="Wnioski bankowe">
              <div class="case-multiform__rail-label">
                <span>Wnioski</span>
                <small>{{ selectedPackageApplicationIds.length }}/{{ packageApplications.length }} wybrane</small>
              </div>
              <article
                v-for="application in packageApplications"
                :key="application.applicationId"
                class="case-multiform__rail-item"
                :class="{
                  'is-active': activePackageApplication?.applicationId === application.applicationId,
                  'is-unselected': !packageApplicationIsSelected(application.applicationId),
                }"
              >
                <input
                  type="checkbox"
                  :checked="packageApplicationIsSelected(application.applicationId)"
                  :aria-label="`Dodaj ${application.bankName} do paczki zbiorczej`"
                  @change="setPackageApplicationSelected(application.applicationId, ($event.target as HTMLInputElement).checked)"
                >
                <button type="button" class="case-multiform__rail-open" @click="activePackageApplicationId = application.applicationId">
                  <span class="case-multiform__bank-mark" :style="{ background: bankOffer(application.applicationId)?.bank_logo_background || undefined }">
                    <img
                      v-if="bankOffer(application.applicationId)?.bank_logo_url"
                      :src="bankOffer(application.applicationId)?.bank_logo_url || ''"
                      :alt="application.bankName"
                    >
                    <UIcon v-else name="i-lucide-landmark" />
                  </span>
                  <span class="case-multiform__rail-copy">
                    <strong>{{ application.bankName }}</strong>
                    <small>{{ application.productName }}</small>
                    <em :class="application.templateIds.length ? 'is-ready' : 'is-manual'">
                      {{ application.templateIds.length
                        ? `${applicationDocumentCount(application.applicationId)} plików`
                        : 'Brak szablonu · ręcznie' }}
                    </em>
                  </span>
                  <UIcon name="i-lucide-chevron-right" />
                </button>
              </article>

              <div class="case-multiform__archive-tree">
                <span>Struktura pełnej paczki</span>
                <div v-for="application in packageApplications.filter(item => packageApplicationIsSelected(item.applicationId))" :key="`folder-${application.applicationId}`">
                  <UIcon name="i-lucide-folder" />
                  <strong>{{ application.bankName }}/</strong>
                </div>
                <div>
                  <UIcon name="i-lucide-folder" />
                  <strong>Wspólne/</strong>
                </div>
              </div>
            </aside>

            <section v-if="activePackageApplication" class="case-multiform__bank-workspace">
              <header class="case-multiform__bank-heading">
                <div class="case-multiform__bank-identity">
                  <span class="case-multiform__bank-mark is-large" :style="{ background: bankOffer(activePackageApplication.applicationId)?.bank_logo_background || undefined }">
                    <img
                      v-if="bankOffer(activePackageApplication.applicationId)?.bank_logo_url"
                      :src="bankOffer(activePackageApplication.applicationId)?.bank_logo_url || ''"
                      :alt="activePackageApplication.bankName"
                    >
                    <UIcon v-else name="i-lucide-landmark" />
                  </span>
                  <div>
                    <p>Wniosek {{ activePackageApplication.slot }}</p>
                    <h4>{{ activePackageApplication.bankName }}</h4>
                    <span>{{ activePackageApplication.productName }}</span>
                  </div>
                </div>
                <div class="case-multiform__bank-actions">
                  <span>{{ applicationDocumentCount(activePackageApplication.applicationId) }} dokumentów</span>
                  <UButton
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-download"
                    :loading="fillPending"
                    :disabled="!activePackageApplication.templateIds.length || activePackageHasUnsupportedFillMethod || fillPending || sendPending"
                    @click="fillAndDownload([activePackageApplication.applicationId])"
                  >
                    Pobierz ZIP banku
                  </UButton>
                </div>
              </header>

              <div v-if="!activePackageApplication.templateIds.length" class="case-multiform__manual-bank">
                <UIcon name="i-lucide-triangle-alert" />
                <div>
                  <strong>Ten bank nie ma jeszcze szablonu Multiwniosku</strong>
                  <span>Dokumenty wspólne są dostępne poniżej, ale formularz bankowy trzeba przygotować ręcznie.</span>
                </div>
              </div>

              <section class="case-multiform__bank-section">
                <header>
                  <div>
                    <UIcon name="i-lucide-file-pen-line" />
                    <span>
                      <strong>Formularze bankowe</strong>
                      <small>Uzupełnione danymi z Multiwniosku</small>
                    </span>
                  </div>
                  <em>{{ activePackagePreparedDocuments.length }}</em>
                </header>
                <div v-if="activePackagePreparedDocuments.length" class="case-multiform__file-list">
                  <article
                    v-for="(preparedDocument, index) in activePackagePreparedDocuments"
                    :key="preparedDocument.templateId || preparedDocument.id || index"
                    class="case-multiform__file-row"
                  >
                    <span class="case-multiform__file-icon"><UIcon name="i-lucide-file-type-2" /></span>
                    <div class="case-multiform__file-info">
                      <strong>{{ documentTitle(preparedDocument, index) }}</strong>
                      <small>{{ preparedDocument.fileName || 'Dokument bankowy' }}</small>
                      <span class="case-multiform__fill-method">
                        <UIcon name="i-lucide-wand-sparkles" />
                        Metoda: {{ preparedDocumentFillMethod(preparedDocument).label }}
                        <em v-if="!preparedDocumentIsSupported(preparedDocument)">Jeszcze nieobsługiwane</em>
                      </span>
                    </div>
                    <div class="case-multiform__file-actions">
                      <UButton
                        v-if="preparedDocumentSupportsFieldPreview(preparedDocument)"
                        color="neutral"
                        variant="soft"
                        size="sm"
                        icon="i-lucide-eye"
                        :disabled="!preparedDocumentIsSupported(preparedDocument) || !templateBankId(preparedDocument) || Boolean(individualDownloadPending)"
                        @click="openTemplatePreview(preparedDocument)"
                      >
                        Podgląd pól
                      </UButton>
                      <UButton
                        v-if="!preparedDocumentIsPassThrough(preparedDocument)"
                        color="neutral"
                        variant="outline"
                        size="sm"
                        icon="i-lucide-download"
                        :loading="individualDownloadPending === `template:filled:${preparedDocument.id || preparedDocument.templateId}`"
                        :disabled="!preparedDocumentIsSupported(preparedDocument) || Boolean(individualDownloadPending)"
                        @click="downloadPreparedDocument(preparedDocument, 'filled')"
                      >
                        Pobierz uzupełniony
                      </UButton>
                      <UButton
                        color="neutral"
                        :variant="preparedDocumentIsPassThrough(preparedDocument) ? 'outline' : 'ghost'"
                        size="sm"
                        icon="i-lucide-file"
                        :loading="individualDownloadPending === `template:blank:${preparedDocument.id || preparedDocument.templateId}`"
                        :disabled="!preparedDocumentIsSupported(preparedDocument) || Boolean(individualDownloadPending)"
                        @click="downloadPreparedDocument(preparedDocument, 'blank')"
                      >
                        {{ preparedDocumentIsManual(preparedDocument)
                          ? 'Pobierz do uzupełnienia'
                          : preparedDocumentIsPassThrough(preparedDocument)
                            ? 'Pobierz dokument'
                            : 'Pusty szablon' }}
                      </UButton>
                    </div>
                  </article>
                </div>
                <p v-else class="case-multiform__empty-section">Brak automatycznie generowanego formularza dla tego banku.</p>
              </section>

              <section class="case-multiform__bank-section">
                <header>
                  <div>
                    <UIcon name="i-lucide-paperclip" />
                    <span>
                      <strong>Dokumenty do wniosku</strong>
                      <small>Zaznacz pliki, które mają trafić do ZIP-a</small>
                    </span>
                  </div>
                  <div class="case-multiform__section-actions">
                    <UButton
                      v-if="activePackageDocuments.length"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      @click="toggleActivePackageDocuments"
                    >
                      {{ activePackageAllDocumentsSelected ? 'Odznacz wszystkie' : 'Zaznacz wszystkie' }}
                    </UButton>
                    <em>{{ activePackageSelectedDocumentCount }}/{{ activePackageDocuments.length }}</em>
                  </div>
                </header>
                <div class="case-multiform__file-list">
                  <article
                    v-for="document in activePackageDocuments"
                    :key="document.id"
                    class="case-multiform__file-row"
                    :class="{ 'is-unselected': !packageDocumentIsSelected(document.id) }"
                  >
                    <input
                      class="case-multiform__file-checkbox"
                      type="checkbox"
                      :checked="packageDocumentIsSelected(document.id)"
                      :aria-label="`Dodaj ${document.name} do paczki ZIP`"
                      :disabled="fillPending || sendPending"
                      @change="setPackageDocumentSelected(document.id, ($event.target as HTMLInputElement).checked)"
                    >
                    <span class="case-multiform__file-icon"><UIcon name="i-lucide-file" /></span>
                    <div class="case-multiform__file-info">
                      <strong>{{ document.name }}</strong>
                      <small>
                        {{ document.submission_id === null ? 'Wspólne dla sprawy · ' : '' }}{{ formatFileSize(document.size_bytes) }}
                      </small>
                    </div>
                    <UBadge v-if="!packageDocumentIsSelected(document.id)" color="neutral" variant="soft">Poza paczką</UBadge>
                    <UBadge v-else-if="document.submission_id === null" color="neutral" variant="soft">Wspólne</UBadge>
                    <UButton
                      color="neutral"
                      variant="outline"
                      size="sm"
                      icon="i-lucide-download"
                      :loading="individualDownloadPending === `attachment:${document.id}`"
                      :disabled="Boolean(individualDownloadPending)"
                      @click="downloadAttachment(document)"
                    >
                      Pobierz
                    </UButton>
                  </article>
                </div>
              </section>

              <section
                v-if="activePackageReadiness"
                class="case-multiform__missing-section"
                :class="{
                  'is-empty': activePackageReadiness.readyForSubmission,
                  'is-working-package': activePackageReadiness.status === 'working_package',
                }"
              >
                <header>
                  <div>
                    <UIcon :name="activePackageReadiness.readyForSubmission ? 'i-lucide-shield-check' : 'i-lucide-circle-alert'" />
                    <span>
                      <strong>{{ activePackageReadiness.readyForSubmission
                        ? 'Gotowy do złożenia'
                        : activePackageReadiness.status === 'working_package'
                          ? 'Paczka robocza — wymagane działania'
                          : 'Paczka niekompletna' }}</strong>
                      <small>{{ activePackageReadiness.readyForSubmission
                        ? 'Wszystkie blokujące elementy zostały zweryfikowane'
                        : 'ZIP można pobrać, ale nie należy jeszcze składać go w banku' }}</small>
                    </span>
                  </div>
                  <em>{{ activePackageReadiness.blockingIssues.length }}</em>
                </header>
                <ul v-if="activePackageReadiness.issues.length">
                  <li v-for="issue in activePackageReadiness.issues" :key="`${issue.requirementKey}:${issue.code}`">
                    <UIcon :name="issue.blocking ? 'i-lucide-circle-alert' : 'i-lucide-building-2'" />
                    <span>
                      <strong>{{ issue.label }}</strong>
                      <small>{{ issue.message }}</small>
                    </span>
                    <UBadge v-if="!issue.blocking" color="neutral" variant="soft">Po stronie banku</UBadge>
                  </li>
                </ul>
              </section>
            </section>
          </div>

          <UAlert
            v-if="individualDownloadError"
            color="error"
            variant="subtle"
            title="Nie udało się pobrać pliku"
            :description="individualDownloadError"
          />

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
            v-if="missingTemplateWarnings.length"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Nie wszystkie wnioski trafią do paczki"
          >
            <template #description>
              <ul>
                <li v-for="warning in missingTemplateWarnings" :key="warning">
                  {{ warning }}
                </li>
              </ul>
            </template>
          </UAlert>

          <UAlert
            v-if="!context.selectedApplicationsValidation.blockers.length && selectedPackageReadyForSubmission"
            color="success"
            variant="subtle"
            icon="i-lucide-shield-check"
            title="Paczka jest gotowa do złożenia"
            description="Formularze, wymagane załączniki, weryfikacje i czynności przed złożeniem są kompletne."
          />

          <UAlert
            v-else-if="!context.selectedApplicationsValidation.blockers.length"
            color="warning"
            variant="subtle"
            icon="i-lucide-package-open"
            title="Możesz pobrać paczkę roboczą"
            :description="`${selectedPackageReadinessIssueCount} ${selectedPackageReadinessIssueCount === 1 ? 'blokujący element wymaga' : 'blokujących elementów wymaga'} uzupełnienia lub weryfikacji przed złożeniem w banku.`"
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
            :loading="preparePending || fillPending || sendPending"
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

  <CaseMultiformTemplatePreviewModal
    v-if="templatePreviewDocument"
    v-model:open="templatePreviewOpen"
    :organization-slug="context?.organization.slug || ''"
    :bank-id="templatePreviewBankId"
    :template-id="preparedDocumentTemplateId(templatePreviewDocument)"
    :title="documentTitle(templatePreviewDocument, 0)"
    @saved="handleTemplateSaved"
  />

  <UModal
    v-model:open="zipPasswordModalModel"
    title="Jednorazowe hasło do paczki ZIP"
    description="Skopiuj hasło i przekaż je odbiorcy innym kanałem niż paczkę."
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <div class="case-multiform__password-modal">
        <div class="case-multiform__password-value">
          <code>{{ zipPassword }}</code>
          <UButton
            color="neutral"
            variant="outline"
            :icon="zipPasswordCopied ? 'i-lucide-check' : 'i-lucide-copy'"
            @click="copyZipPassword"
          >
            {{ zipPasswordCopied ? 'Skopiowano' : 'Kopiuj hasło' }}
          </UButton>
        </div>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-key-round"
          title="Po zamknięciu hasło zniknie"
          description="Nie zapisujemy go i nie można go odzyskać. Kolejne pobranie utworzy nową paczkę z nowym hasłem."
        />
      </div>
    </template>
    <template #footer>
      <UButton class="ml-auto" @click="closeZipPasswordModal">Gotowe, zamknij</UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="sendModalModel"
    title="Wyślij paczki do klientów"
    description="Każdy klient otrzyma osobną, zabezpieczoną kopię wybranych dokumentów."
    :dismissible="!sendPending"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="case-multiform__delivery-modal">
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-shield-check"
          title="Hasłem będzie PESEL odbiorcy"
          description="Numer PESEL nie trafi do treści wiadomości ani do widoku. Klient zobaczy tylko informację, że hasłem jest jego 11-cyfrowy PESEL."
        />
        <UAlert
          v-if="missingTemplateWarnings.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Część wniosków wymaga obsługi ręcznej"
        >
          <template #description>
            <ul class="case-multiform__delivery-warnings">
              <li v-for="warning in missingTemplateWarnings" :key="warning">{{ warning }}</li>
            </ul>
          </template>
        </UAlert>

        <div class="case-multiform__delivery-summary">
          <span><strong>{{ sendApplicationIds.length }}</strong> wnioski bankowe</span>
          <span><strong>{{ packageDocuments(sendApplicationIds).length }}</strong> załączniki</span>
          <span><strong>{{ caseData.clients.length }}</strong> odbiorcy</span>
        </div>

        <div class="case-multiform__recipient-list" aria-label="Odbiorcy paczek">
          <article v-for="client in caseData.clients" :key="client.id">
            <span class="case-multiform__recipient-icon"><UIcon name="i-lucide-user-round" /></span>
            <div>
              <strong>{{ client.display_name }}</strong>
              <small>{{ client.primary_email || 'Brak adresu e-mail' }}</small>
            </div>
            <UBadge
              v-if="deliveryResultFor(client.id) !== 'pending'"
              :color="deliveryResultFor(client.id) === 'sent' ? 'success' : 'error'"
              variant="subtle"
            >
              {{ deliveryResultFor(client.id) === 'sent' ? 'Wysłano' : 'Nie wysłano' }}
            </UBadge>
            <UBadge v-else color="neutral" variant="subtle">
              Oczekuje
            </UBadge>
          </article>
        </div>

        <UAlert
          v-if="sendError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Wysyłka wymaga uwagi"
          :description="sendError"
        />
        <UAlert
          v-else-if="sendResult?.status === 'complete'"
          color="success"
          variant="subtle"
          icon="i-lucide-circle-check"
          title="Wszystkie paczki zostały wysłane"
          description="Każdy klient otrzymał własny plik ZIP zabezpieczony jego numerem PESEL."
        />
      </div>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="sendPending"
        @click="closeSendModal"
      >
        {{ sendResult?.status === 'complete' ? 'Zamknij' : 'Anuluj' }}
      </UButton>
      <UButton
        class="ml-auto"
        icon="i-lucide-send"
        :loading="sendPending"
        :disabled="sendResult?.status === 'complete'"
        @click="sendPackageToClients"
      >
        {{ sendActionLabel }}
      </UButton>
    </template>
  </UModal>
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

.case-multiform--package :deep([data-slot="body"]) {
  max-height: none;
  overflow: visible;
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

.case-multiform__repeatable-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.case-multiform__repeatable-empty {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 86px;
  padding: 14px;
  border: 1px dashed var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-muted);
}

.case-multiform__repeatable-empty > span {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: 9px;
  background: var(--ui-bg);
  color: var(--ui-text-muted);
  font-size: 18px;
}

.case-multiform__repeatable-empty > div {
  display: grid;
  min-width: 0;
  flex: 1;
  gap: 3px;
}

.case-multiform__repeatable-empty strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.case-multiform__repeatable-empty small {
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
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
}

.case-multiform__package-heading,
.case-multiform__package-actions,
.case-multiform__password-option,
.case-multiform__bank-heading,
.case-multiform__bank-identity,
.case-multiform__bank-actions,
.case-multiform__bank-section > header,
.case-multiform__bank-section > header > div,
.case-multiform__missing-section > header,
.case-multiform__missing-section > header > div,
.case-multiform__manual-bank,
.case-multiform__password-value {
  display: flex;
  align-items: center;
}

.case-multiform__package-heading,
.case-multiform__bank-heading,
.case-multiform__bank-section > header,
.case-multiform__missing-section > header {
  justify-content: space-between;
}

.case-multiform__package-heading {
  gap: 24px;
}

.case-multiform__package-actions {
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.case-multiform__password-option {
  gap: 10px;
  min-width: 230px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-muted);
  cursor: pointer;
}

.case-multiform__password-option input,
.case-multiform__rail-item input,
.case-multiform__file-checkbox {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  accent-color: var(--ui-primary);
  cursor: pointer;
}

.case-multiform__file-checkbox:disabled {
  cursor: not-allowed;
}

.case-multiform__password-option span,
.case-multiform__rail-copy,
.case-multiform__bank-identity > div,
.case-multiform__bank-section > header span,
.case-multiform__missing-section > header span,
.case-multiform__missing-section li > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.case-multiform__password-option strong {
  color: var(--ui-text-highlighted);
  font-size: 10px;
}

.case-multiform__password-option small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.case-multiform__package-layout {
  display: grid;
  grid-template-columns: 270px minmax(0, 1fr);
  min-height: 560px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg);
}

.case-multiform__application-rail {
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 14px;
  border-right: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg-muted) 72%, var(--ui-bg));
}

.case-multiform__rail-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 4px 7px;
  color: var(--ui-text-muted);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.case-multiform__rail-label small {
  font-size: 8px;
  letter-spacing: 0;
  text-transform: none;
}

.case-multiform__rail-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 11px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: transparent;
  transition: border-color .15s ease, background .15s ease, opacity .15s ease;
}

.case-multiform__rail-open {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.case-multiform__rail-item:hover,
.case-multiform__rail-item.is-active {
  border-color: var(--ui-border);
  background: var(--ui-bg);
}

.case-multiform__rail-item.is-active {
  box-shadow: inset 3px 0 0 var(--ui-primary);
}

.case-multiform__rail-item.is-unselected {
  opacity: .56;
}

.case-multiform__bank-mark {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 38px;
  height: 38px;
  overflow: hidden;
  border: 1px solid var(--ui-border-muted);
  border-radius: 10px;
  background: var(--ui-bg);
  color: var(--ui-text-toned);
}

.case-multiform__bank-mark.is-large {
  width: 52px;
  height: 52px;
  border-radius: 12px;
}

.case-multiform__bank-mark img {
  max-width: 78%;
  max-height: 70%;
  object-fit: contain;
}

.case-multiform__rail-copy strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-multiform__rail-copy small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-multiform__rail-copy em {
  margin-top: 3px;
  font-size: 8px;
  font-style: normal;
  font-weight: 700;
}

.case-multiform__rail-copy em.is-ready {
  color: var(--ui-success);
}

.case-multiform__rail-copy em.is-manual {
  color: var(--ui-warning);
}

.case-multiform__archive-tree {
  display: grid;
  gap: 8px;
  margin-top: 12px;
  padding: 14px 12px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
}

.case-multiform__archive-tree > span {
  margin-bottom: 3px;
  font-size: 8px;
  font-weight: 750;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.case-multiform__archive-tree > div {
  display: flex;
  align-items: center;
  gap: 7px;
}

.case-multiform__archive-tree strong {
  color: var(--ui-text-toned);
  font-size: 9px;
}

.case-multiform__bank-workspace {
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;
  padding: 20px;
}

.case-multiform__bank-heading {
  gap: 18px;
  padding-bottom: 17px;
  border-bottom: 1px solid var(--ui-border);
}

.case-multiform__bank-identity,
.case-multiform__bank-actions,
.case-multiform__bank-section > header > div,
.case-multiform__missing-section > header > div {
  gap: 11px;
}

.case-multiform__bank-identity p,
.case-multiform__bank-identity h4,
.case-multiform__bank-identity span {
  margin: 0;
}

.case-multiform__bank-identity p {
  color: var(--ui-primary);
  font-size: 8px;
  font-weight: 750;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.case-multiform__bank-identity h4 {
  color: var(--ui-text-highlighted);
  font-size: 18px;
}

.case-multiform__bank-identity span,
.case-multiform__bank-actions > span {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.case-multiform__manual-bank {
  gap: 11px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 45%, var(--ui-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-warning) 8%, var(--ui-bg));
  color: var(--ui-warning);
}

.case-multiform__manual-bank > div {
  display: grid;
  gap: 2px;
}

.case-multiform__manual-bank strong {
  font-size: 10px;
}

.case-multiform__manual-bank span {
  color: var(--ui-text-toned);
  font-size: 9px;
}

.case-multiform__bank-section,
.case-multiform__missing-section {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg);
}

.case-multiform__bank-section > header,
.case-multiform__missing-section > header {
  gap: 12px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.case-multiform__bank-section > header span strong,
.case-multiform__missing-section > header span strong {
  color: var(--ui-text-highlighted);
  font-size: 10px;
}

.case-multiform__bank-section > header span small,
.case-multiform__missing-section > header span small {
  color: var(--ui-text-muted);
  font-size: 8px;
}

.case-multiform__bank-section > header em,
.case-multiform__missing-section > header em {
  display: grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ui-bg);
  color: var(--ui-text-toned);
  font-size: 9px;
  font-style: normal;
  font-weight: 750;
}

.case-multiform__section-actions {
  flex: 0 0 auto;
  justify-content: flex-end;
}

.case-multiform__empty-section {
  margin: 0;
  padding: 18px 14px;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.case-multiform__missing-section {
  margin-top: 4px;
  border-color: color-mix(in srgb, var(--ui-warning) 38%, var(--ui-border));
}

.case-multiform__missing-section.is-empty {
  border-color: color-mix(in srgb, var(--ui-success) 35%, var(--ui-border));
}

.case-multiform__missing-section > header > div > svg {
  color: var(--ui-warning);
}

.case-multiform__missing-section.is-empty > header > div > svg {
  color: var(--ui-success);
}

.case-multiform__missing-section ul {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.case-multiform__missing-section li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
}

.case-multiform__missing-section li > span {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}

.case-multiform__missing-section li + li {
  border-top: 1px solid var(--ui-border-muted);
}

.case-multiform__missing-section li strong {
  color: var(--ui-text-highlighted);
  font-size: 10px;
}

.case-multiform__missing-section li small {
  color: var(--ui-text-muted);
  font-size: 8px;
}

.case-multiform__password-modal {
  display: grid;
  gap: 14px;
}

.case-multiform__password-value {
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg-muted);
}

.case-multiform__password-value code {
  color: var(--ui-text-highlighted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 17px;
  font-weight: 750;
  letter-spacing: .08em;
}

.case-multiform__delivery-modal {
  display: grid;
  gap: 14px;
}

.case-multiform__delivery-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.case-multiform__delivery-warnings {
  margin: 0;
  padding-left: 18px;
}

.case-multiform__delivery-summary span {
  padding: 7px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 11px;
}

.case-multiform__delivery-summary strong {
  color: var(--ui-text-highlighted);
}

.case-multiform__recipient-list {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
}

.case-multiform__recipient-list article {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
}

.case-multiform__recipient-list article + article {
  border-top: 1px solid var(--ui-border);
}

.case-multiform__recipient-list article > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.case-multiform__recipient-list strong,
.case-multiform__recipient-list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-multiform__recipient-list strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.case-multiform__recipient-list small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.case-multiform__recipient-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-toned);
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

.case-multiform__file-groups {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.case-multiform__file-group {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg);
}

.case-multiform__file-group > header,
.case-multiform__file-group > header > div,
.case-multiform__file-row {
  display: flex;
  align-items: center;
}

.case-multiform__file-group > header {
  justify-content: space-between;
  gap: 12px;
  padding: 13px 15px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.case-multiform__file-group > header > div {
  min-width: 0;
  gap: 8px;
}

.case-multiform__file-group h4 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.case-multiform__file-group > header span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--ui-bg);
  color: var(--ui-text-toned);
  font-size: 10px;
  font-weight: 700;
}

.case-multiform__file-list {
  display: grid;
}

.case-multiform__file-row {
  min-width: 0;
  gap: 10px;
  padding: 12px 14px;
  transition: background-color .15s ease, opacity .15s ease;
}

.case-multiform__file-row.is-unselected {
  background: color-mix(in srgb, var(--ui-bg-muted) 62%, transparent);
  opacity: .62;
}

.case-multiform__file-row + .case-multiform__file-row {
  border-top: 1px solid var(--ui-border-muted);
}

.case-multiform__file-info {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 2px;
}

.case-multiform__fill-method {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--ui-text-toned);
  font-size: 9px;
}

.case-multiform__fill-method em {
  padding: 2px 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-warning) 14%, transparent);
  color: var(--ui-warning);
  font-style: normal;
  font-weight: 700;
}

.case-multiform__file-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}

.case-multiform__file-row strong,
.case-multiform__file-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-multiform__file-row strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.case-multiform__file-row small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.case-multiform__file-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--ui-bg-muted);
  color: var(--ui-primary);
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

  .case-multiform__package-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .case-multiform__package-actions {
    justify-content: space-between;
  }

  .case-multiform__package-layout {
    grid-template-columns: 230px minmax(0, 1fr);
  }

  .case-multiform__file-actions {
    width: 100%;
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
  .case-multiform__file-groups,
  .case-multiform__field-grid {
    grid-template-columns: 1fr;
  }

  .case-multiform__package-actions,
  .case-multiform__bank-heading,
  .case-multiform__bank-actions,
  .case-multiform__password-value {
    align-items: stretch;
    flex-direction: column;
  }

  .case-multiform__password-option {
    min-width: 0;
  }

  .case-multiform__package-layout {
    grid-template-columns: 1fr;
  }

  .case-multiform__application-rail {
    border-right: 0;
    border-bottom: 1px solid var(--ui-border);
  }

  .case-multiform__archive-tree {
    display: none;
  }

  .case-multiform__bank-workspace {
    padding: 14px;
  }

  .case-multiform__form-heading,
  .case-multiform__repeatable-heading,
  .case-multiform__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .case-multiform__repeatable-actions {
    flex-wrap: wrap;
  }

  .case-multiform__repeatable-empty {
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
