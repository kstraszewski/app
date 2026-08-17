<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type {
  CaseDetailResponse,
  CaseDocument,
  CaseFiltersResponse,
  CaseProperty,
  DocumentRequirement,
  MortgageNextActionKind,
  SavedCaseOffer,
} from '~/types/cases'
import type { MultiformCrmContext } from '~/types/multiform'
import type {
  CaseTaskDelegationAssignee,
  CaseTaskDelegationPayload,
  CaseTaskDelegationRecentAssignee,
} from '~/types/task-delegation-ui'
import {
  calculatePropertyOfferComparison,
  getFinancingComparisonBaseline,
} from '~/utils/mortgage-property-comparison'
import {
  mortgageActionLabel,
  resolveCaseMortgageNextAction,
} from '~/utils/mortgage-case-process'
import {
  applicableDocumentRequirements,
  documentRequirementIsRequired,
} from '#shared/document-requirements'

definePageMeta({ middleware: ['auth', 'organization'] })

interface RenameForm { title: string }
interface ClientsForm { client_ids: string[] }

interface DelegationProfile {
  id?: string
  user_id?: string
  email?: string | null
  full_name?: string | null
}

interface DelegationHistoryEntry {
  id: string
  activity_type: string
  title: string
  body?: string | null
  created_at: string
  actor?: DelegationProfile | null
}

interface DelegationMeeting {
  id: string
  starts_at: string
  ends_at?: string | null
  status: string
  meeting_mode?: string | null
  customer_name?: string | null
  notes?: string | null
  expert?: DelegationProfile | null
}

interface DelegatedTask {
  id: string
  title: string
  description?: string | null
  assignee_user_id: string
  delegator_user_id: string
  delegation_status: 'pending' | 'accepted' | 'rejected' | 'cancelled'
  status_code: 'open' | 'in_progress' | 'done' | 'cancelled' | string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  due_at?: string | null
  data_access_scope?: string[]
  delegated_at: string
  accepted_at?: string | null
  rejected_at?: string | null
  rejection_reason?: string | null
  completed_at?: string | null
  assignee?: DelegationProfile | null
  delegator?: DelegationProfile | null
  history?: DelegationHistoryEntry[]
  meetings?: DelegationMeeting[]
}

interface DelegatedTasksResponse {
  data: DelegatedTask[]
  current_user_id?: string
}

interface DelegationMemberRow {
  user_id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: 'expert' | 'admin'
  open_task_count?: number
  team_name?: string | null
}

interface DelegationRecentMemberRow extends DelegationMemberRow {
  last_delegated_at: string
  delegation_count: number
}

interface DelegationAssigneesResponse {
  data: {
    members: DelegationMemberRow[]
    recent: DelegationRecentMemberRow[]
  }
}

const route = useRoute()
const router = useRouter()
const { organizationSlug, crmApiPath, orgPath } = useOrganizationContext()
const caseId = computed(() => String(route.params.id))
const toast = useToast()
const requestFetch = useRequestFetch()
const authenticatedUser = useAuthUser()

const emptyCase = (): CaseDetailResponse => ({
  current_user_id: '',
  data: {
    id: '',
    organization_id: '',
    owner_user_id: null,
    title: '',
    description: null,
    status_code: 'nowa',
    priority: 'normal',
    progress_percent: 0,
    opened_at: '',
    closed_at: null,
    created_at: '',
    updated_at: '',
    owner: null,
    clients: [],
    offers: [],
    selected_offer_id: null,
    selected_property_id: null,
    bank_applications: [],
    contract_application_id: null,
    contract_signed_at: null,
    documents: [],
    items: [],
    properties: [],
    open_tasks: [],
    recent_activities: [],
  },
})
const emptyFilters = (): CaseFiltersResponse => ({
  clients: [],
  banks: [],
  offer_counts: { with: 0, without: 0 },
  date_bounds: null,
})

const {
  data,
  pending,
  error,
  refresh,
} = await useAsyncData<CaseDetailResponse>(
  `crm-case:${organizationSlug.value}:${caseId.value}`,
  () => requestFetch<CaseDetailResponse>(crmApiPath(`/cases/${caseId.value}`)),
  { default: emptyCase, watch: [organizationSlug, caseId] },
)
const { data: filterConfiguration } = await useAsyncData<CaseFiltersResponse>(
  `crm-cases-filters:${organizationSlug.value}`,
  () => requestFetch<CaseFiltersResponse>(crmApiPath('/cases/filters')),
  { default: emptyFilters, watch: [organizationSlug] },
)
const {
  data: delegatedTasksResponse,
  pending: delegatedTasksPending,
  error: delegatedTasksError,
  refresh: refreshDelegatedTasks,
} = await useAsyncData<DelegatedTasksResponse>(
  `crm-case-delegated-tasks:${organizationSlug.value}:${caseId.value}`,
  () => requestFetch<DelegatedTasksResponse>(crmApiPath(`/cases/${caseId.value}/tasks`)),
  {
    default: () => ({ data: [] }),
    watch: [organizationSlug, caseId],
  },
)

useHead(() => ({ title: `${data.value.data.title || 'Sprawa'} — OpenExpert CRM` }))

const renameOpen = ref(false)
const clientsOpen = ref(false)
const offerDetailsOpen = ref(false)
const removeOfferOpen = ref(false)
const propertyOpen = ref(false)
const renovationOpen = ref(false)
const insuranceOpen = ref(false)
const delegationOpen = ref(false)
const savingName = ref(false)
const savingClients = ref(false)
const removingOffer = ref(false)
const selectingOfferId = ref('')
const selectingPropertyId = ref('')
const selectingFinancingVariantKey = ref('')
const selectedOffer = ref<SavedCaseOffer | null>(null)
const selectedOfferProperty = ref<CaseProperty | null>(null)
const selectedProperty = ref<CaseProperty | null>(null)
const selectedInsuranceType = ref<'insurance_life' | 'insurance_property'>('insurance_life')
const multiformContext = ref<MultiformCrmContext | null>(null)
const multiformContextPending = ref(false)
const delegationAssignees = ref<CaseTaskDelegationAssignee[]>([])
const recentDelegationAssignees = ref<CaseTaskDelegationRecentAssignee[]>([])
const delegationAssigneesPending = ref(false)
const delegationAssigneesError = ref('')
const delegationSubmitting = ref(false)
const delegationSubmitError = ref('')
const delegationSubmitted = ref(false)
const updatingDelegatedTaskId = ref('')
const delegationIdempotencyKey = ref('')
const mortgageActionOpen = ref(false)
const mortgageActionKind = ref<MortgageNextActionKind | null>(null)
const mortgageActionApplicationId = ref<string | null>(null)
const renameForm = reactive<RenameForm>({ title: '' })
const clientsForm = reactive<ClientsForm>({ client_ids: [] })

const clientItems = computed(() => filterConfiguration.value.clients.map(client => ({
  label: client.display_name,
  description: client.primary_email || client.primary_phone || 'Brak danych kontaktowych',
  value: client.id,
})))

const formApplications = computed(() => {
  if (data.value.data.contract_application_id) {
    return data.value.data.bank_applications.filter(application => (
      application.id === data.value.data.contract_application_id
    ))
  }
  return data.value.data.bank_applications.filter(application => (
    application.status_code !== 'odrzucone' && application.status_code !== 'wycofane'
  ))
})

const focusedApplication = computed(() => (
  data.value.data.bank_applications.find(application => (
    application.offer_id === data.value.data.selected_offer_id
  ))
  ?? formApplications.value[0]
  ?? data.value.data.bank_applications[0]
  ?? null
))

const activeOffer = computed(() => (
  data.value.data.offers.find(offer => offer.id === focusedApplication.value?.offer_id)
  ?? null
))

const mortgageNextAction = computed(() => resolveCaseMortgageNextAction(data.value.data))
const hasMortgageProcess = computed(() => (
  data.value.data.bank_applications.length > 0
  || data.value.data.offers.length > 0
  || data.value.data.items.some(item => item.product_type?.code === 'credit_mortgage')
))

const mortgageActionApplication = computed(() => (
  data.value.data.bank_applications.find(application => (
    application.id === mortgageActionApplicationId.value
  )) ?? null
))

const mortgageActionOffer = computed(() => (
  data.value.data.offers.find(offer => (
    offer.id === mortgageActionApplication.value?.offer_id
  )) ?? null
))

const contractApplication = computed(() => (
  data.value.data.bank_applications.find(application => (
    application.id === data.value.data.contract_application_id
  )) ?? null
))

const contractOffer = computed(() => (
  data.value.data.offers.find(offer => offer.id === contractApplication.value?.offer_id)
  ?? null
))

const activeProperty = computed(() => (
  data.value.data.properties.find(property => property.id === data.value.data.selected_property_id)
  ?? null
))

const financingComparisonBaseline = computed(() => getFinancingComparisonBaseline(
  data.value.data.offers,
  data.value.data.selected_offer_id,
))

const selectedOfferComparison = computed(() => {
  if (!selectedOffer.value || !selectedOfferProperty.value || !financingComparisonBaseline.value) return null
  return calculatePropertyOfferComparison(
    selectedOfferProperty.value.id,
    {
      purchasePrice: selectedOfferProperty.value.price_amount,
      appraisalValue: selectedOfferProperty.value.appraisal_value_amount,
      currency: selectedOfferProperty.value.currency,
    },
    selectedOffer.value,
    financingComparisonBaseline.value,
  )
})

const delegatedTasks = computed(() => delegatedTasksResponse.value.data ?? [])
const delegationCurrentUserId = computed(() => (
  delegatedTasksResponse.value.current_user_id
  || authenticatedUser.value?.id
  || null
))

const validViews = ['overview', 'messages', 'mail', 'credit', 'documents', 'delegations', 'history'] as const
type CaseView = typeof validViews[number]
const currentView = computed<CaseView>(() => {
  const value = String(route.query.view ?? 'overview')
  return validViews.includes(value as CaseView) ? value as CaseView : 'overview'
})

const queryUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function queryUuid(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && queryUuidPattern.test(candidate)
    ? candidate
    : ''
}

const focusedTaskId = computed(() => queryUuid(route.query.task))
const focusedDocumentId = computed(() => queryUuid(route.query.document))
const focusedApplicationId = computed(() => queryUuid(route.query.application))
const mortgageActionKinds = new Set<MortgageNextActionKind>([
  'upload-esis',
  'deliver-esis',
  'submit-application',
  'confirm-completeness',
  'record-early-consent',
  'resume-review',
  'upload-decision',
  'deliver-decision',
  'upload-agreement',
  'deliver-agreement',
  'review-offer',
  'review-agreement',
  'complete-application',
  'close-application',
  'open-documents',
])
const deepLinkedMortgageAction = computed<MortgageNextActionKind | null>(() => {
  const value = Array.isArray(route.query.action) ? route.query.action[0] : route.query.action
  return typeof value === 'string' && mortgageActionKinds.has(value as MortgageNextActionKind)
    ? value as MortgageNextActionKind
    : null
})

watch(
  [currentView, focusedTaskId, focusedDocumentId, pending, delegatedTasksPending],
  async ([view, taskId, documentId, casePending, tasksPending]) => {
    if (!import.meta.client || casePending) return
    if (view === 'delegations' && tasksPending) return

    const recordId = view === 'documents'
      ? documentId
      : view === 'delegations' || view === 'history'
        ? taskId
        : ''
    if (!recordId) return

    await nextTick()
    window.requestAnimationFrame(() => {
      document.getElementById(`case-${view === 'documents' ? 'document' : 'task'}-${recordId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  },
  { immediate: true, flush: 'post' },
)

watch(
  [focusedApplicationId, deepLinkedMortgageAction, pending],
  async ([applicationId, action, casePending]) => {
    if (!import.meta.client || casePending || !applicationId || !action) return
    if (!data.value.data.bank_applications.some(application => application.id === applicationId)) return
    await nextTick()
    await openMortgageAction({ applicationId, kind: action })
    const query = { ...route.query }
    delete query.action
    await router.replace({ query })
  },
  { immediate: true, flush: 'post' },
)

const caseTabs = computed(() => [
  { label: 'Podsumowanie', icon: 'i-lucide-layout-dashboard', to: viewLocation('overview') },
  { label: 'Czat z klientem', icon: 'i-lucide-messages-square', compact: true, to: viewLocation('messages') },
  { label: 'Poczta e-mail', icon: 'i-lucide-mail', compact: true, to: viewLocation('mail') },
  { label: 'Kredyt i oferty', icon: 'i-lucide-landmark', count: data.value.data.offers.length, to: viewLocation('credit') },
  { label: 'Dokumenty i wnioski', icon: 'i-lucide-files', count: data.value.data.documents.length, to: viewLocation('documents') },
  { label: 'Delegacje', icon: 'i-lucide-send', count: delegatedTasks.value.length, to: viewLocation('delegations') },
  { label: 'Historia', icon: 'i-lucide-history', to: viewLocation('history') },
])

const activeInsuranceItem = computed(() => data.value.data.items.find(item => (
  item.product_type?.code === selectedInsuranceType.value
)) ?? null)

const activeRenovationItem = computed(() => data.value.data.items.find(item => (
  item.product_type?.code === 'credit_cash' && item.metadata?.purpose === 'renovation'
)) ?? null)

const propertyScenarioValue = computed(() => {
  const value = Number(activeOffer.value?.scenario_snapshot?.propertyValue ?? 0)
  return Number.isFinite(value) && value > 0 ? value : null
})

function requirementAcceptsUpload(requirement: DocumentRequirement) {
  return requirement.itemKind === 'client_document'
    || (requirement.itemKind === 'bank_document' && !requirement.templateId)
}

const requiredDocumentEntries = computed(() => {
  const entries = new Map<string, { requirement: DocumentRequirement, applicationId: string | null }>()
  for (const application of formApplications.value) {
    const offer = data.value.data.offers.find(item => item.id === application.offer_id)
    const requirements = offer?.catalog_snapshot?.version?.document_requirements
    if (!Array.isArray(requirements)) continue
    const applicableRequirements = applicableDocumentRequirements(
      requirements as DocumentRequirement[],
      offer?.scenario_snapshot,
    )
    for (const requirement of applicableRequirements) {
      if (!documentRequirementIsRequired(requirement) || !requirementAcceptsUpload(requirement)) continue
      const applicationId = requirement.itemKind === 'bank_document' ? application.id : null
      const key = applicationId
        ? `application:${applicationId}:${requirement.code}:${requirement.scope}`
        : `shared:${requirement.code}:${requirement.scope}`
      if (!entries.has(key)) entries.set(key, { requirement, applicationId })
    }
  }
  return [...entries.values()]
})

const requiredDocumentProgress = computed(() => requiredDocumentEntries.value.reduce((progress, entry) => {
  const { requirement, applicationId } = entry
  const matchingDocuments = data.value.data.documents.filter(document => (
    document.document_type === requirement.code
    && (applicationId ? document.submission_id === applicationId : document.submission_id == null)
  ))
  if (requirement.scope === 'case') {
    progress.total += 1
    if (matchingDocuments.length) progress.satisfied += 1
    if (matchingDocuments.some(document => Boolean(document.verified_at))) progress.verified += 1
    return progress
  }
  const clients = requirement.scope === 'primary_applicant'
    ? data.value.data.clients.filter(client => client.is_primary).slice(0, 1)
    : data.value.data.clients
  progress.total += clients.length
  progress.satisfied += clients.filter(client => (
    matchingDocuments.some(document => document.client_id === client.id)
  )).length
  progress.verified += clients.filter(client => (
    matchingDocuments.some(document => document.client_id === client.id && Boolean(document.verified_at))
  )).length
  return progress
}, { satisfied: 0, verified: 0, total: 0 }))

const activeOfferTemplateCount = computed(() => {
  const templateIds = new Set<string>()
  for (const application of formApplications.value) {
    const offer = data.value.data.offers.find(item => item.id === application.offer_id)
    const configured = offer?.catalog_snapshot?.version?.multiform_template_ids
    if (Array.isArray(configured)) {
      for (const id of configured) if (typeof id === 'string') templateIds.add(id)
    }
    const requirements = offer?.catalog_snapshot?.version?.document_requirements
    if (Array.isArray(requirements)) {
      const applicableRequirements = applicableDocumentRequirements(
        requirements as DocumentRequirement[],
        offer?.scenario_snapshot,
      )
      for (const requirement of applicableRequirements) {
        if (requirement.templateId) templateIds.add(requirement.templateId)
      }
    }
  }
  return templateIds.size
})

const requiredDocumentsReady = computed(() => (
  formApplications.value.length > 0
  && requiredDocumentProgress.value.satisfied === requiredDocumentProgress.value.total
))

const caseStatusLabel = computed(() => {
  const labels: Record<string, string> = {
    nowa: 'Nowa sprawa',
    w_toku: 'W toku',
    przygotowanie_wniosku: 'Przygotowanie wniosku',
    oczekuje: 'Oczekuje',
    zakonczona: 'Zakończona',
  }
  if (data.value.data.contract_application_id) return 'Umowa kredytowa podpisana'
  if (requiredDocumentsReady.value) return 'Wnioski gotowe do przygotowania'
  if (data.value.data.bank_applications.length) return `${data.value.data.bank_applications.length}/3 wniosków bankowych`
  return labels[data.value.data.status_code] ?? data.value.data.status_code.replaceAll('_', ' ')
})

const headerDate = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const headerMenuItems = computed(() => [[
  { label: 'Deleguj zadanie', icon: 'i-lucide-user-round-plus', onSelect: openDelegation },
  { label: 'Zmień nazwę', icon: 'i-lucide-pencil', onSelect: openRename },
  { label: 'Zarządzaj klientami', icon: 'i-lucide-users-round', onSelect: openClients },
  { label: 'Dodaj nieruchomość', icon: 'i-lucide-house-plus', onSelect: addProperty },
  { label: 'Dodaj ofertę bankową', icon: 'i-lucide-bookmark-plus', to: { path: orgPath('/calculator/mortgages'), query: { caseId: caseId.value } } },
]])

const workflowSteps = computed(() => [
  {
    href: '#case-clients',
    number: '01',
    label: 'Wnioskodawcy',
    value: data.value.data.clients.length
      ? `${data.value.data.clients.length} ${data.value.data.clients.length === 1 ? 'klient' : 'klientów'}`
      : 'Dodaj klientów',
    complete: data.value.data.clients.length > 0,
    current: data.value.data.clients.length === 0,
  },
  {
    href: '#case-offers',
    number: '02',
    label: 'Shortlista ofert',
    value: data.value.data.offers.length
      ? `${data.value.data.offers.length} ${data.value.data.offers.length === 1 ? 'oferta' : 'ofert'}`
      : 'Dodaj ofertę',
    complete: data.value.data.offers.length > 0,
    current: data.value.data.clients.length > 0 && data.value.data.offers.length === 0,
  },
  {
    href: '#case-bank-applications',
    number: '03',
    label: 'Wnioski bankowe',
    value: data.value.data.bank_applications.length
      ? `${data.value.data.bank_applications.length}/3 banki w procesie`
      : 'Uruchom 1–3 wnioski',
    complete: data.value.data.bank_applications.length > 0,
    current: data.value.data.offers.length > 0 && data.value.data.bank_applications.length === 0,
  },
  {
    href: '#case-documents',
    number: '04',
    label: 'Dokumenty i ZIP',
    value: !formApplications.value.length
      ? 'Najpierw wnioski'
      : !activeOfferTemplateCount.value
          ? 'Brak szablonu'
          : requiredDocumentsReady.value
              ? 'Gotowe do sprawdzenia'
              : 'Po dokumentach',
    complete: requiredDocumentsReady.value,
    current: !data.value.data.contract_application_id && formApplications.value.length > 0,
  },
])

const currency = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})
const number = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 })
const date = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })

function money(value: number | null | undefined, offer?: SavedCaseOffer) {
  if (value == null) return '—'
  if (!offer || offer.currency === 'PLN') return currency.format(Number(value))
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: offer.currency,
    maximumFractionDigits: 0,
  }).format(Number(value))
}

function formatDate(value: string) {
  return date.format(new Date(value))
}

function caseDocumentOwner(document: CaseDocument) {
  if (!document.client_id) return 'Dokument sprawy'
  return data.value.data.clients.find(client => client.id === document.client_id)?.display_name
    ?? 'Dokument klienta'
}

function caseDocumentStatus(document: CaseDocument) {
  if (document.verified_at || document.status_code === 'verified') {
    return { label: 'Zweryfikowany', color: 'success' as const }
  }
  if (document.status_code === 'missing') {
    return { label: 'Brakuje pliku', color: 'warning' as const }
  }
  if (document.status_code === 'received') {
    return { label: 'Odebrany', color: 'info' as const }
  }
  return { label: 'Dodany', color: 'neutral' as const }
}

function caseDocumentDownloadUrl(documentId: string) {
  return crmApiPath(`/cases/${caseId.value}/documents/${documentId}`)
}

function scenarioLabel(offer: SavedCaseOffer) {
  const scenario = offer.scenario_snapshot
  const years = Number(scenario.years ?? 0)
  const installment = scenario.installmentType === 'decreasing' ? 'raty malejące' : 'raty równe'
  return `${money(offer.loan_amount, offer)} · ${years || '—'} lat · ${installment}`
}

function applicationForOffer(offer: SavedCaseOffer) {
  return data.value.data.bank_applications.find(application => application.offer_id === offer.id) ?? null
}

function applicationForBank(offer: SavedCaseOffer) {
  return data.value.data.bank_applications.find(application => application.bank_id === offer.bank_id) ?? null
}

function propertyName(property: CaseProperty) {
  return property.listing_title || [property.address, property.city].filter(Boolean).join(', ') || 'Nieruchomość'
}

function openRename() {
  renameForm.title = data.value.data.title
  renameOpen.value = true
}

function openClients() {
  clientsForm.client_ids = data.value.data.clients.map(client => client.id)
  clientsOpen.value = true
}

function mapDelegationMember(member: DelegationMemberRow): CaseTaskDelegationAssignee {
  return {
    userId: member.user_id,
    email: member.email,
    fullName: member.full_name ?? '',
    avatarUrl: member.avatar_url,
    role: member.role,
    teamName: member.team_name
      ?? (member.role === 'admin' ? 'Administrator organizacji' : 'Ekspert'),
    openTaskCount: member.open_task_count,
  }
}

function mapRecentDelegationMember(member: DelegationRecentMemberRow): CaseTaskDelegationRecentAssignee {
  return {
    ...mapDelegationMember(member),
    lastDelegatedAt: member.last_delegated_at,
    delegationCount: member.delegation_count,
  }
}

function freshIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

async function loadDelegationAssignees() {
  delegationAssigneesPending.value = true
  delegationAssigneesError.value = ''
  try {
    const response = await $fetch<DelegationAssigneesResponse>(
      crmApiPath(`/cases/${caseId.value}/tasks/assignees`),
    )
    delegationAssignees.value = response.data.members.map(mapDelegationMember)
    recentDelegationAssignees.value = response.data.recent.map(mapRecentDelegationMember)
  }
  catch (caught: any) {
    delegationAssigneesError.value = caught?.data?.statusMessage
      ?? caught?.message
      ?? 'Odśwież listę zespołu i spróbuj ponownie.'
  }
  finally {
    delegationAssigneesPending.value = false
  }
}

function openDelegation() {
  delegationSubmitError.value = ''
  delegationSubmitted.value = false
  delegationIdempotencyKey.value = freshIdempotencyKey()
  delegationOpen.value = true
  void loadDelegationAssignees()
}

async function submitDelegatedTask(payload: CaseTaskDelegationPayload) {
  if (delegationSubmitting.value) return
  delegationSubmitting.value = true
  delegationSubmitError.value = ''
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}/tasks`), {
      method: 'POST',
      body: {
        title: payload.title,
        description: payload.description || null,
        assignee_user_id: payload.assigneeUserId,
        due_at: payload.dueAt,
        priority: payload.priority,
        data_access_scope: payload.accessScope,
        idempotency_key: delegationIdempotencyKey.value || freshIdempotencyKey(),
        appointment: payload.appointment
          ? {
              facility_id: payload.appointment.facilityId,
              service_id: payload.appointment.serviceId,
              starts_at: payload.appointment.startsAt,
              meeting_mode: payload.appointment.meetingMode,
            }
          : null,
      },
    })
    delegationSubmitted.value = true
    await Promise.all([refreshDelegatedTasks(), refresh()])
    toast.add({
      title: payload.appointment
        ? 'Zadanie i termin zostały przekazane'
        : 'Zadanie zostało oddelegowane',
      description: payload.appointment
        ? 'Godzina jest już zarezerwowana w kalendarzu realizatora. Status i historię zobaczysz w Delegacjach.'
        : 'Status przyjęcia i całą historię zobaczysz w zakładce Delegacje.',
      color: 'success',
      icon: payload.appointment ? 'i-lucide-calendar-check-2' : 'i-lucide-send',
    })
  }
  catch (caught: any) {
    const statusCode = Number(
      caught?.statusCode
      ?? caught?.status
      ?? caught?.response?.status
      ?? 0,
    )
    const detail = caught?.data?.statusMessage ?? caught?.message ?? ''
    const slotConflict = statusCode === 409
      && /slot|termin|available/i.test(detail)
    if (slotConflict) delegationIdempotencyKey.value = freshIdempotencyKey()
    delegationSubmitError.value = slotConflict
      ? 'Ta godzina właśnie została zajęta. Wybierz nowy wolny termin.'
      : detail || 'Nie udało się zapisać delegacji.'
  }
  finally {
    delegationSubmitting.value = false
  }
}

async function respondToDelegatedTask(payload: {
  taskId: string
  action: 'accept' | 'reject' | 'cancel'
  reason?: string
}) {
  if (updatingDelegatedTaskId.value) return
  updatingDelegatedTaskId.value = payload.taskId
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}/tasks/${payload.taskId}/response`), {
      method: 'PATCH',
      body: {
        action: payload.action,
        ...(payload.reason ? { reason: payload.reason } : {}),
      },
    })
    await Promise.all([refreshDelegatedTasks(), refresh()])
    toast.add({
      title: payload.action === 'accept'
        ? 'Przyjęto zadanie'
        : payload.action === 'reject'
          ? 'Odrzucono zadanie'
          : 'Anulowano delegację',
      color: payload.action === 'accept' ? 'success' : 'neutral',
    })
  }
  catch (caught: any) {
    toast.add({
      title: 'Nie udało się zapisać decyzji',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  }
  finally {
    updatingDelegatedTaskId.value = ''
  }
}

async function updateDelegatedTaskStatus(payload: {
  taskId: string
  statusCode: 'in_progress' | 'done'
}) {
  if (updatingDelegatedTaskId.value) return
  updatingDelegatedTaskId.value = payload.taskId
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}/tasks/${payload.taskId}`), {
      method: 'PATCH',
      body: { status_code: payload.statusCode },
    })
    await Promise.all([refreshDelegatedTasks(), refresh()])
    toast.add({
      title: payload.statusCode === 'done' ? 'Zadanie zakończone' : 'Rozpoczęto realizację',
      color: 'success',
    })
  }
  catch (caught: any) {
    toast.add({
      title: 'Nie udało się zmienić statusu',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  }
  finally {
    updatingDelegatedTaskId.value = ''
  }
}

function openOfferDetails(offer: SavedCaseOffer) {
  selectedOfferProperty.value = null
  selectedOffer.value = offer
  offerDetailsOpen.value = true
}

function openFinancingVariant(property: CaseProperty, offer: SavedCaseOffer) {
  selectedOfferProperty.value = property
  selectedOffer.value = offer
  offerDetailsOpen.value = true
}

function confirmRemoveOffer(offer: SavedCaseOffer) {
  selectedOffer.value = offer
  removeOfferOpen.value = true
}

function viewLocation(view: CaseView) {
  const query = { ...route.query }
  if (view === 'overview') delete query.view
  else query.view = view
  return { path: route.path, query }
}

async function goToView(view: CaseView, anchor?: string) {
  if (currentView.value !== view) {
    await router.replace(viewLocation(view))
    await nextTick()
  }
  if (anchor && import.meta.client) {
    document.querySelector(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

function scrollToDocuments() {
  return goToView('documents', '#case-documents')
}

function addProperty() {
  selectedProperty.value = null
  propertyOpen.value = true
}

function editProperty(property: CaseProperty) {
  selectedProperty.value = property
  propertyOpen.value = true
}

function openRenovation() {
  renovationOpen.value = true
}

function openInsurance(type: 'insurance_life' | 'insurance_property') {
  selectedInsuranceType.value = type
  insuranceOpen.value = true
}

async function openMortgageAction(payload: { applicationId: string | null, kind: MortgageNextActionKind }): Promise<void> {
  if (payload.kind === 'add-client') {
    openClients()
    return
  }
  if (payload.kind === 'add-offer') {
    await router.push({ path: orgPath('/calculator/mortgages'), query: { caseId: caseId.value } })
    return
  }
  if (payload.kind === 'add-application') {
    await goToView('credit', '#case-bank-applications')
    return
  }
  if (payload.kind === 'review-offer' || payload.kind === 'review-agreement' || payload.kind === 'wait-bank') {
    await goToView('credit', '#case-bank-applications')
    return
  }
  if (!payload.applicationId) {
    await goToView('documents', '#case-documents')
    return
  }

  mortgageActionApplicationId.value = payload.applicationId
  mortgageActionKind.value = payload.kind
  mortgageActionOpen.value = true
}

async function openNextStep(): Promise<void> {
  await openMortgageAction({
    applicationId: mortgageNextAction.value.application_id ?? null,
    kind: mortgageNextAction.value.kind,
  })
}

const commandActions = {
  addOffer: () => router.push({ path: orgPath('/calculator/mortgages'), query: { caseId: caseId.value } }),
  goDocuments: () => goToView('documents', '#case-documents'),
  goMultiform: () => goToView('documents', '#case-applications'),
  openRenovation,
  openInsurance,
  openOffer: openOfferDetails,
  openFinancingVariant,
  addProperty,
  editProperty,
  selectProperty: selectPropertyForCase,
  addApplication: addBankApplication,
}

async function addBankApplication(property: CaseProperty | null, offer: SavedCaseOffer) {
  if (selectingFinancingVariantKey.value) return
  const variantKey = `${property?.id ?? 'unassigned'}:${offer.id}`
  selectingFinancingVariantKey.value = variantKey
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}/applications`), {
      method: 'POST',
      body: {
        offer_id: offer.id,
        ...(property ? { property_id: property.id } : {}),
      },
    })
    await refresh()
    toast.add({
      title: 'Dodano równoległy wniosek',
      description: `${property ? property.listing_title || property.address : 'Nieruchomość do przypisania'} · ${offer.bank_name} · ${data.value.data.bank_applications.length}/3`,
      color: 'success',
      icon: 'i-lucide-files',
    })
  }
  catch (caught: any) {
    await refresh()
    toast.add({
      title: 'Nie udało się dodać wniosku bankowego',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  }
  finally {
    selectingFinancingVariantKey.value = ''
  }
}

async function selectPropertyForCase(property: CaseProperty) {
  if (selectingPropertyId.value) return
  if (property.id === data.value.data.selected_property_id) return

  selectingPropertyId.value = property.id
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}/properties/selection`), {
      method: 'PUT',
      body: { property_id: property.id },
    })
    await refresh()
    toast.add({
      title: 'Wybrano nieruchomość do finansowania',
      description: [property.address, property.city].filter(Boolean).join(', '),
      color: 'success',
      icon: 'i-lucide-house-check',
    })
  }
  catch (caught: any) {
    toast.add({
      title: 'Nie udało się wybrać nieruchomości',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  }
  finally {
    selectingPropertyId.value = ''
  }
}

async function selectOfferForDocuments(offer: SavedCaseOffer) {
  if (selectingOfferId.value) return
  const application = data.value.data.bank_applications.find(item => item.offer_id === offer.id)
  if (!application) {
    await addBankApplication(activeProperty.value, offer)
    return
  }
  if (offer.id === data.value.data.selected_offer_id) {
    scrollToDocuments()
    return
  }
  selectingOfferId.value = offer.id
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}/offers/selection`), {
      method: 'PUT',
      body: { offer_id: offer.id },
    })
    await refresh()
    await nextTick()
    scrollToDocuments()
    toast.add({
      title: 'Otwarto dokumenty wniosku',
      description: `${offer.bank_name} · przełączenie widoku nie wybiera banku finalnego`,
      color: 'success',
    })
  }
  catch (caught: any) {
    toast.add({
      title: 'Nie udało się wybrać oferty',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  }
  finally {
    selectingOfferId.value = ''
  }
}

function validateRename(state: Partial<RenameForm>): FormError[] {
  if (!state.title?.trim()) return [{ name: 'title', message: 'Podaj nazwę sprawy.' }]
  if (state.title.trim().length > 200) {
    return [{ name: 'title', message: 'Nazwa może mieć maksymalnie 200 znaków.' }]
  }
  return []
}

function validateClients(state: Partial<ClientsForm>): FormError[] {
  return state.client_ids?.length
    ? []
    : [{ name: 'client_ids', message: 'Sprawa musi mieć co najmniej jednego klienta.' }]
}

async function renameCase(_event: FormSubmitEvent<RenameForm>) {
  savingName.value = true
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}`), {
      method: 'PATCH',
      body: { title: renameForm.title.trim() },
    })
    renameOpen.value = false
    await refresh()
    toast.add({ title: 'Zmieniono nazwę sprawy', color: 'success' })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się zmienić nazwy',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    savingName.value = false
  }
}

async function saveClients(_event: FormSubmitEvent<ClientsForm>) {
  savingClients.value = true
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}/clients`), {
      method: 'PUT',
      body: { client_ids: clientsForm.client_ids },
    })
    clientsOpen.value = false
    await refresh()
    toast.add({ title: 'Zapisano klientów sprawy', color: 'success' })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się zapisać klientów',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    savingClients.value = false
  }
}

async function removeOffer() {
  if (!selectedOffer.value) return
  removingOffer.value = true
  try {
    await $fetch(crmApiPath(`/cases/${caseId.value}/offers/${selectedOffer.value.id}`), {
      method: 'DELETE',
    })
    removeOfferOpen.value = false
    offerDetailsOpen.value = false
    selectedOffer.value = null
    await refresh()
    toast.add({ title: 'Usunięto zapisaną ofertę', color: 'success' })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się usunąć oferty',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    removingOffer.value = false
  }
}

async function loadMultiformContext() {
  if (!formApplications.value.length) {
    multiformContext.value = null
    return
  }
  multiformContextPending.value = true
  try {
    multiformContext.value = await requestFetch<MultiformCrmContext>(
      crmApiPath(`/cases/${caseId.value}/multiform/context`),
    )
  }
  catch {
    multiformContext.value = null
  }
  finally {
    multiformContextPending.value = false
  }
}

watch(
  () => [
    formApplications.value.map(application => `${application.id}:${application.status_code}`).join(','),
    data.value.data.contract_application_id,
    data.value.data.documents.length,
  ],
  () => loadMultiformContext(),
  { immediate: true },
)
</script>

<template>
  <CrmShell
    :title="data.data.title || 'Sprawa'"
    :workspace="currentView === 'messages' || currentView === 'mail'"
    eyebrow="Karta sprawy"
    description="Klienci, nieruchomości, oferty, dokumenty i historia procesu w jednym miejscu."
    :back-to="orgPath('/cases')"
    back-label="Wróć do spraw"
    :tabs="pending ? [] : caseTabs"
  >
    <template #meta>
      <div class="case-header-meta">
        <span class="case-header-meta__status"><span />{{ caseStatusLabel }}</span>
        <span class="case-header-meta__separator" aria-hidden="true" />
        <span>Właściciel: <strong>{{ data.data.owner?.full_name || data.data.owner?.email || 'Nieprzypisany' }}</strong></span>
        <span class="case-header-meta__separator" aria-hidden="true" />
        <span>Ostatnia aktualizacja: {{ data.data.updated_at ? headerDate.format(new Date(data.data.updated_at)) : '—' }}</span>
      </div>
    </template>
    <template #actions>
      <UButton
        v-if="currentView !== 'messages' && currentView !== 'mail'"
        color="neutral"
        variant="outline"
        size="lg"
        icon="i-lucide-user-round-plus"
        @click="openDelegation"
      >
        Deleguj zadanie
      </UButton>
      <UButton
        v-if="currentView !== 'messages' && currentView !== 'mail' && hasMortgageProcess"
        class="case-next-action"
        color="neutral"
        variant="solid"
        size="lg"
        trailing-icon="i-lucide-arrow-right"
        @click="openNextStep"
      >
        {{ mortgageActionLabel(mortgageNextAction.kind) }}
      </UButton>
      <UDropdownMenu
        v-if="currentView !== 'messages' && currentView !== 'mail'"
        :items="headerMenuItems"
        :content="{ align: 'end' }"
      >
        <UButton
          icon="i-lucide-ellipsis"
          color="neutral"
          variant="outline"
          size="lg"
          aria-label="Więcej działań"
        />
      </UDropdownMenu>
    </template>

    <UAlert
      v-if="error"
      class="detail-alert"
      color="error"
      variant="subtle"
      title="Nie udało się pobrać sprawy"
      description="Odśwież widok i spróbuj ponownie."
    >
      <template #actions>
        <UButton color="error" variant="soft" size="sm" @click="refresh()">Odśwież</UButton>
      </template>
    </UAlert>

    <nav v-if="!pending && currentView === 'credit'" class="case-workflow" aria-label="Etapy obsługi sprawy">
      <div class="case-workflow__intro">
        <div>
          <p>Przebieg sprawy</p>
          <h2>Od klientów do gotowej paczki dokumentów</h2>
        </div>
        <span v-if="contractOffer">
          Podpisana umowa: <strong>{{ contractOffer.bank_name }}</strong>
        </span>
        <span v-else-if="data.data.bank_applications.length">
          Równoległe wnioski: <strong>{{ data.data.bank_applications.length }}/3</strong>
        </span>
      </div>
      <ol>
        <li v-for="step in workflowSteps" :key="step.number">
          <a
            :href="step.href"
            :class="{ complete: step.complete, current: step.current }"
          >
            <span class="case-workflow__number">
              <UIcon v-if="step.complete" name="i-lucide-check" />
              <template v-else>{{ step.number }}</template>
            </span>
            <span>
              <strong>{{ step.label }}</strong>
              <small>{{ step.value }}</small>
            </span>
            <UIcon name="i-lucide-chevron-right" />
          </a>
        </li>
      </ol>
    </nav>

    <div v-if="pending" class="case-command-loading">
      <USkeleton class="h-80 w-full" />
      <USkeleton class="h-96 w-full" />
    </div>

    <div v-else-if="currentView === 'overview'" class="case-overview-stack">
      <CaseMortgageProcessOverview
        v-if="hasMortgageProcess"
        :case-data="data.data"
        @open-action="openMortgageAction"
      />

      <CaseProcessesOverview
        :case-data="data.data"
        :current-user-id="data.current_user_id"
        @changed="refresh()"
      />

      <CaseCommandOverview
        :case-data="data.data"
        :active-offer="activeOffer"
        :document-progress="requiredDocumentProgress"
        :multiform-blockers="multiformContext?.selectedOfferValidation.blockers ?? []"
        :multiform-pending="multiformContextPending"
        :selecting-property-id="selectingPropertyId"
        :selecting-financing-variant-key="selectingFinancingVariantKey"
        :actions="commandActions"
      />
    </div>

    <div
      v-else-if="currentView === 'messages'"
      class="case-messages-workspace"
    >
      <CaseConversationPanel
        :case-id="data.data.id"
        :case-title="data.data.title || 'Sprawa'"
        surface="pane"
      />
    </div>

    <div
      v-else-if="currentView === 'mail'"
      class="case-mail-workspace"
    >
      <MailWorkspace
        scope-type="case"
        :scope-id="data.data.id"
        embedded
      />
    </div>

    <section v-else-if="currentView === 'credit'" class="case-credit-view">
      <div id="case-bank-applications">
        <CaseBankApplications
          :case-data="data.data"
          :focused-application-id="focusedApplicationId"
          @refresh="refresh()"
          @open-documents="goToView('documents', '#case-documents')"
        />
      </div>

      <div class="case-detail-grid">
      <UCard id="case-clients" data-testid="case-clients">
        <template #header>
          <div class="panel-head">
            <div>
              <h2>Klienci</h2>
              <p>{{ data.data.clients.length }} {{ data.data.clients.length === 1 ? 'osoba lub firma' : 'osoby lub firmy' }}</p>
            </div>
            <UButton
              icon="i-lucide-users-round"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="openClients"
            >
              Zarządzaj
            </UButton>
          </div>
        </template>

        <div class="client-list">
          <NuxtLink
            v-for="client in data.data.clients"
            :key="client.id"
            :to="orgPath(`/clients/${client.id}`)"
            class="client-row"
          >
            <span class="client-avatar"><UIcon name="i-lucide-user-round" /></span>
            <div>
              <strong>{{ client.display_name }}</strong>
              <small>{{ client.primary_email || client.primary_phone || 'Brak danych kontaktowych' }}</small>
            </div>
            <UBadge v-if="client.is_primary" color="neutral" variant="subtle" size="xs">
              Główny
            </UBadge>
          </NuxtLink>
        </div>
      </UCard>

      <UCard id="case-offers" data-testid="case-saved-offers">
        <template #header>
          <div class="panel-head">
            <div>
              <h2>Shortlista ofert</h2>
              <p>Shortlista nie oznacza jeszcze wysłania wniosku ani wyboru banku finalnego.</p>
            </div>
            <span class="offer-total">{{ data.data.offers.length }}</span>
          </div>
        </template>

        <div v-if="data.data.offers.length" class="offer-list">
          <article
            v-for="offer in data.data.offers"
            :key="offer.id"
            :class="['saved-offer', { 'saved-offer--selected': offer.id === activeOffer?.id }]"
            data-testid="saved-offer"
            :data-saved-offer-id="offer.id"
          >
            <div class="offer-heading">
              <span class="bank-icon"><UIcon name="i-lucide-landmark" /></span>
              <div>
                <small>{{ offer.bank_name }}</small>
                <strong>{{ offer.product_name }}</strong>
                <p>{{ scenarioLabel(offer) }}</p>
              </div>
              <UBadge
                v-if="applicationForOffer(offer)?.id === data.data.contract_application_id"
                class="offer-heading__badge"
                color="success"
                variant="solid"
                size="xs"
              >
                Podpisana umowa
              </UBadge>
              <UBadge
                v-else-if="applicationForOffer(offer)"
                class="offer-heading__badge"
                color="primary"
                variant="subtle"
                size="xs"
              >
                Wniosek {{ applicationForOffer(offer)?.slot }}/3
              </UBadge>
              <UBadge v-else class="offer-heading__badge" color="neutral" variant="subtle" size="xs">
                Shortlista
              </UBadge>
              <UBadge
                v-if="offer.calculation_status === 'partial'"
                class="offer-heading__badge"
                color="warning"
                variant="subtle"
                size="xs"
                icon="i-lucide-circle-alert"
              >
                Warunki i koszty do potwierdzenia
              </UBadge>
            </div>
            <dl class="offer-metrics">
              <div>
                <dt>Pierwszy wydatek</dt>
                <dd>{{ money(offer.first_monthly_outflow, offer) }}</dd>
              </div>
              <div>
                <dt>Koszt 5 lat</dt>
                <dd>{{ money(offer.cost_first_five_years, offer) }}</dd>
              </div>
              <div>
                <dt>RRSO banku</dt>
                <dd>{{ offer.representative_apr_pct == null ? '—' : `${number.format(offer.representative_apr_pct)}%` }}</dd>
              </div>
            </dl>
            <div class="offer-saved-at">
              <small>Zapisano</small>
              <span>{{ formatDate(offer.saved_at) }}</span>
            </div>
            <div class="offer-actions">
              <UButton
                v-if="applicationForOffer(offer)"
                color="primary"
                variant="soft"
                size="sm"
                icon="i-lucide-folder-open"
                :loading="selectingOfferId === offer.id"
                :disabled="Boolean(selectingOfferId)"
                @click="selectOfferForDocuments(offer)"
              >
                Dokumenty
              </UButton>
              <UBadge
                v-else-if="offer.calculation_status === 'partial'"
                color="warning"
                variant="outline"
                size="sm"
              >
                Potwierdź warunki przed wnioskiem
              </UBadge>
              <UButton
                v-else-if="!data.data.contract_application_id && !applicationForBank(offer) && data.data.bank_applications.length < 3"
                color="neutral"
                variant="soft"
                size="sm"
                icon="i-lucide-plus"
                :loading="selectingFinancingVariantKey.endsWith(`:${offer.id}`)"
                :disabled="Boolean(selectingFinancingVariantKey)"
                @click="addBankApplication(activeProperty, offer)"
              >
                Dodaj wniosek
              </UButton>
              <UBadge v-else-if="applicationForBank(offer)" color="neutral" variant="outline" size="sm">
                Ten bank jest już w procesie
              </UBadge>
              <UBadge v-else color="neutral" variant="outline" size="sm">
                {{ data.data.contract_application_id ? 'Proces zakończony' : 'Limit 3 wniosków' }}
              </UBadge>
              <UButton color="neutral" variant="ghost" size="sm" @click="openOfferDetails(offer)">
                Szczegóły
              </UButton>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                :aria-label="`Usuń zapisaną ofertę ${offer.bank_name} ${offer.product_name}`"
                @click="confirmRemoveOffer(offer)"
              />
            </div>
          </article>
        </div>

        <div v-else class="empty-offers">
          <span><UIcon name="i-lucide-bookmark-plus" /></span>
          <h3>Nie zapisano jeszcze żadnej oferty</h3>
          <p>Otwórz porównywarkę, ustaw scenariusz i zachowaj najlepsze propozycje w tej sprawie.</p>
          <UButton
            :to="{ path: orgPath('/calculator/mortgages'), query: { caseId } }"
            icon="i-lucide-arrow-right"
            trailing
          >
            Przejdź do ofert
          </UButton>
        </div>
      </UCard>
      </div>
    </section>

    <section
      v-if="!pending && currentView === 'documents' && !data.data.bank_applications.length"
      id="case-documents"
      class="case-documents"
      aria-labelledby="case-documents-title"
    >
      <div class="case-section-heading">
        <div>
          <p>Etap 04 · checklista</p>
          <h2 id="case-documents-title">Dokumenty do równoległych wniosków</h2>
          <span>Dokument klienta dodajesz raz, a dokumenty bankowe pozostają przypisane do właściwego wniosku.</span>
        </div>
        <UButton
          v-if="data.data.offers.length"
          :to="{ path: orgPath('/calculator/mortgages'), query: { caseId } }"
          color="neutral"
          variant="outline"
          icon="i-lucide-bookmark-plus"
        >
          Dodaj kolejną ofertę
        </UButton>
      </div>

      <UCard v-if="data.data.documents.length" class="case-files">
        <template #header>
          <div class="case-files__header">
            <div>
              <p>Pliki w teczce</p>
              <h3>Wszystkie dokumenty sprawy</h3>
            </div>
            <UBadge color="neutral" variant="subtle">
              {{ data.data.documents.length }}
            </UBadge>
          </div>
        </template>

        <ul class="case-files__list">
          <li
            v-for="document in data.data.documents"
            :id="`case-document-${document.id}`"
            :key="document.id"
            :class="{ 'is-selected': document.id === focusedDocumentId }"
          >
            <span class="case-files__icon"><UIcon name="i-lucide-file-text" /></span>
            <div>
              <strong>{{ document.name }}</strong>
              <small>
                {{ caseDocumentOwner(document) }}
                · {{ document.document_type.replaceAll('_', ' ') }}
                · {{ formatDate(document.received_at || document.created_at) }}
              </small>
            </div>
            <UBadge :color="caseDocumentStatus(document).color" variant="subtle" size="sm">
              {{ caseDocumentStatus(document).label }}
            </UBadge>
            <UButton
              v-if="document.status_code !== 'missing'"
              :to="caseDocumentDownloadUrl(document.id)"
              target="_blank"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-download"
              aria-label="Pobierz dokument"
            >
              Pobierz
            </UButton>
          </li>
        </ul>
      </UCard>

      <UCard v-if="!data.data.bank_applications.length" class="case-documents__empty">
        <div class="case-documents__empty-body">
          <div class="case-documents__empty-copy">
            <span><UIcon name="i-lucide-files" /></span>
            <div>
              <h3>Najpierw uruchom co najmniej jeden wniosek bankowy</h3>
              <p>Zapisane oferty są shortlistą. W sekcji Kredyt i oferty dodaj od jednego do trzech banków do równoległego procesu.</p>
            </div>
          </div>
          <UButton
            :to="{ path: orgPath('/calculator/mortgages'), query: { caseId } }"
            icon="i-lucide-arrow-right"
            trailing
          >
            Przejdź do ofert
          </UButton>
        </div>
      </UCard>
    </section>

    <section
      v-if="!pending && currentView === 'documents'"
      id="case-applications"
      class="case-applications"
      aria-labelledby="case-applications-title"
    >
      <div class="case-section-heading">
        <div>
          <p>Etap 04 · przygotowanie wniosków</p>
          <h2 id="case-applications-title">Multiwniosek</h2>
          <span>Jedna prowadzona ścieżka: wywiad, dokumenty, formularze bankowe i gotowa paczka ZIP.</span>
        </div>
      </div>

      <CaseClientPortalAccess
        :case-id="data.data.id"
        @changed="refresh()"
      />

      <CaseMultiformWorkspace
        :case-data="data.data"
        @refresh="refresh()"
      />
    </section>

    <section
      v-if="!pending && currentView === 'delegations'"
      class="case-delegations"
      aria-label="Delegowane zadania w sprawie"
    >
      <UAlert
        v-if="delegatedTasksError"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się pobrać delegowanych zadań"
        description="Odśwież listę, aby zobaczyć aktualne statusy."
      >
        <template #actions>
          <UButton color="error" variant="soft" size="sm" @click="refreshDelegatedTasks()">
            Odśwież
          </UButton>
        </template>
      </UAlert>

      <CaseTaskDelegationsPanel
        :tasks="delegatedTasks"
        :loading="delegatedTasksPending"
        :current-user-id="delegationCurrentUserId"
        :updating-task-id="updatingDelegatedTaskId"
        :selected-task-id="focusedTaskId"
        @delegate="openDelegation"
        @respond="respondToDelegatedTask"
        @update-status="updateDelegatedTaskStatus"
      />
    </section>

    <section v-if="!pending && currentView === 'history'" class="case-history" aria-labelledby="case-history-title">
      <div class="case-section-heading">
        <div>
          <p>Pełny ślad sprawy</p>
          <h2 id="case-history-title">Historia i zadania</h2>
          <span>Najbliższe działania oraz wszystkie ostatnie zmiany w tej sprawie.</span>
        </div>
      </div>

      <div class="case-history__grid">
        <section class="history-panel">
          <header>
            <div><UIcon name="i-lucide-list-checks" /><h3>Otwarte zadania</h3></div>
            <UBadge color="neutral" variant="subtle">{{ data.data.open_tasks.length }}</UBadge>
          </header>
          <ol v-if="data.data.open_tasks.length" class="task-list">
            <li
              v-for="task in data.data.open_tasks"
              :id="`case-task-${task.id}`"
              :key="task.id"
              :class="{ 'is-selected': task.id === focusedTaskId }"
            >
              <span class="task-list__status" />
              <div>
                <strong>{{ task.title }}</strong>
                <small>
                  {{ task.due_at ? `Termin ${formatDate(task.due_at)}` : 'Bez terminu' }}
                  <template v-if="task.assignee?.full_name"> · {{ task.assignee.full_name }}</template>
                </small>
              </div>
              <UBadge :color="task.priority === 'urgent' || task.priority === 'high' ? 'warning' : 'neutral'" variant="subtle" size="xs">
                {{ task.priority }}
              </UBadge>
            </li>
          </ol>
          <div v-else class="history-empty">
            <UIcon name="i-lucide-circle-check-big" />
            <div><strong>Brak otwartych zadań</strong><span>Nowe zadania pojawią się tutaj wraz z procesem.</span></div>
          </div>
        </section>

        <section class="history-panel">
          <header>
            <div><UIcon name="i-lucide-history" /><h3>Ostatnia aktywność</h3></div>
          </header>
          <ol v-if="data.data.recent_activities.length" class="full-activity-list">
            <li v-for="activity in data.data.recent_activities" :key="activity.id">
              <span><UIcon name="i-lucide-clock-3" /></span>
              <div>
                <strong>{{ activity.title }}</strong>
                <p v-if="activity.body">{{ activity.body }}</p>
                <small>{{ formatDate(activity.created_at) }}<template v-if="activity.actor?.full_name"> · {{ activity.actor.full_name }}</template></small>
              </div>
            </li>
          </ol>
          <div v-else class="history-empty">
            <UIcon name="i-lucide-clock-3" />
            <div><strong>Historia jest jeszcze pusta</strong><span>Pierwsze działania zostaną zapisane automatycznie.</span></div>
          </div>
        </section>
      </div>
    </section>

    <CasePropertySlideover
      v-if="propertyOpen"
      v-model:open="propertyOpen"
      :property="selectedProperty"
      :scenario-value="propertyScenarioValue"
      @saved="refresh()"
    />

    <CaseCashLoanSlideover
      v-if="renovationOpen"
      v-model:open="renovationOpen"
      :existing-item="activeRenovationItem"
      @saved="refresh()"
    />

    <CaseInsuranceSlideover
      v-if="insuranceOpen"
      v-model:open="insuranceOpen"
      :type="selectedInsuranceType"
      :existing-item="activeInsuranceItem"
      @saved="refresh()"
    />

    <CaseMortgageActionSlideover
      v-if="mortgageActionOpen"
      v-model:open="mortgageActionOpen"
      :case-id="data.data.id"
      :application="mortgageActionApplication"
      :offer="mortgageActionOffer"
      :clients="data.data.clients"
      :action-kind="mortgageActionKind"
      @refresh="refresh()"
    />

    <CaseTaskDelegationModal
      v-model:open="delegationOpen"
      :case-summary="{
        id: data.data.id,
        title: data.data.title,
        clients: data.data.clients,
      }"
      :recent-assignees="recentDelegationAssignees"
      :available-assignees="delegationAssignees"
      :loading-assignees="delegationAssigneesPending"
      :assignees-error="delegationAssigneesError"
      :submitting="delegationSubmitting"
      :submit-error="delegationSubmitError"
      :submitted="delegationSubmitted"
      @retry-assignees="loadDelegationAssignees"
      @submit="submitDelegatedTask"
    />

    <UModal
      v-model:open="renameOpen"
      title="Zmień nazwę sprawy"
      description="Krótka nazwa ułatwia późniejsze wyszukiwanie."
      :dismissible="!savingName"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UForm id="rename-case-form" :state="renameForm" :validate="validateRename" @submit="renameCase">
          <UFormField name="title" label="Nazwa sprawy" required>
            <UInput v-model="renameForm.title" class="w-full" :maxlength="200" autofocus />
          </UFormField>
        </UForm>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="savingName" @click="close">Anuluj</UButton>
        <UButton type="submit" form="rename-case-form" :loading="savingName">Zapisz nazwę</UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="clientsOpen"
      title="Klienci sprawy"
      description="Wybierz wszystkie osoby i firmy związane z tą sprawą."
      :dismissible="!savingClients"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UForm id="case-clients-form" :state="clientsForm" :validate="validateClients" @submit="saveClients">
          <UFormField
            name="client_ids"
            label="Klienci"
            description="Pierwszy wybrany klient będzie oznaczony jako główny."
            required
          >
            <USelectMenu
              v-model="clientsForm.client_ids"
              class="w-full"
              :items="clientItems"
              value-key="value"
              label-key="label"
              multiple
              clear
              placeholder="Wybierz klientów"
              aria-label="Wybierz klientów sprawy"
            />
          </UFormField>
        </UForm>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="savingClients" @click="close">Anuluj</UButton>
        <UButton type="submit" form="case-clients-form" :loading="savingClients">Zapisz klientów</UButton>
      </template>
    </UModal>

    <USlideover
      v-model:open="offerDetailsOpen"
      :title="selectedOffer ? selectedOfferProperty ? `${selectedOffer.bank_name} · ${propertyName(selectedOfferProperty)}` : `${selectedOffer.bank_name} · ${selectedOffer.product_name}` : 'Zapisana oferta'"
      :description="selectedOfferProperty ? 'Szacunek dla tej nieruchomości i wspólnych założeń porównania.' : 'Snapshot parametrów użytych do wyliczenia.'"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template v-if="selectedOffer" #body>
        <div class="snapshot-details">
          <section>
            <h3>{{ selectedOfferComparison ? 'Wariant nieruchomość × bank' : 'Scenariusz' }}</h3>
            <dl>
              <div><dt>Kwota kredytu</dt><dd>{{ money(selectedOfferComparison?.loanAmount ?? selectedOffer.loan_amount, selectedOffer) }}</dd></div>
              <div><dt>Wartość nieruchomości</dt><dd>{{ money(selectedOfferProperty?.price_amount ?? Number(selectedOffer.scenario_snapshot.propertyValue ?? 0), selectedOffer) }}</dd></div>
              <div><dt>Wkład własny</dt><dd>{{ money(financingComparisonBaseline?.contributionAmount ?? Math.max(0, Number(selectedOffer.scenario_snapshot.propertyValue ?? 0) - Number(selectedOffer.loan_amount ?? 0)), selectedOffer) }}</dd></div>
              <div><dt>LTV</dt><dd>{{ selectedOfferComparison?.ltvPct == null ? '—' : `${number.format(selectedOfferComparison.ltvPct)}%` }}</dd></div>
              <div><dt>Okres</dt><dd>{{ financingComparisonBaseline?.years ?? selectedOffer.scenario_snapshot.years ?? '—' }} lat</dd></div>
              <div><dt>Rodzaj rat</dt><dd>{{ (financingComparisonBaseline?.installmentType ?? selectedOffer.scenario_snapshot.installmentType) === 'decreasing' ? 'Malejące' : 'Równe' }}</dd></div>
            </dl>
          </section>
          <section>
            <h3>{{ selectedOfferComparison ? 'Przeliczone wyniki' : 'Zapisane wyniki' }}</h3>
            <dl>
              <div><dt>Pierwsza rata</dt><dd>{{ money(selectedOfferComparison?.firstInstallment ?? selectedOffer.first_installment, selectedOffer) }}</dd></div>
              <div><dt>Pierwszy wydatek miesięczny</dt><dd>{{ money(selectedOfferComparison?.firstMonthlyOutflow ?? selectedOffer.first_monthly_outflow, selectedOffer) }}</dd></div>
              <div><dt>Koszty miesięczne</dt><dd>{{ money(selectedOfferComparison?.firstRecurringCosts ?? null, selectedOffer) }}</dd></div>
              <div><dt>Koszt pierwszych 5 lat</dt><dd>{{ money(selectedOfferComparison?.costFirstFiveYears ?? selectedOffer.cost_first_five_years, selectedOffer) }}</dd></div>
              <div><dt>Koszt całkowity</dt><dd>{{ money(selectedOfferComparison?.totalCost ?? selectedOffer.total_cost, selectedOffer) }}</dd></div>
            </dl>
            <UAlert
              v-if="selectedOfferComparison && (selectedOfferComparison.reasons.length || selectedOfferComparison.eligibility === 'unknown')"
              class="mt-4"
              :color="selectedOfferComparison.status === 'ineligible' ? 'error' : 'warning'"
              variant="subtle"
              title="Warunki wymagają potwierdzenia"
              :description="selectedOfferComparison.reasons.length
                ? selectedOfferComparison.reasons.join(' ')
                : 'Bank nie opublikował pełnego limitu LTV lub siatki marż. Rata jest szacunkiem przy zachowaniu zapisanych warunków cenowych.'"
            />
          </section>
          <section>
            <h3>Wersja danych</h3>
            <dl>
              <div><dt>Wersja oferty</dt><dd>{{ selectedOffer.version_key || '—' }}</dd></div>
              <div><dt>Kalkulator</dt><dd>{{ selectedOffer.calculator_version }}</dd></div>
              <div><dt>Zapisano</dt><dd>{{ formatDate(selectedOffer.saved_at) }}</dd></div>
            </dl>
          </section>
        </div>
      </template>
    </USlideover>

    <UModal
      v-model:open="removeOfferOpen"
      title="Usunąć zapisaną ofertę?"
      :description="selectedOffer ? `${selectedOffer.bank_name} · ${selectedOffer.product_name} zniknie z tej sprawy.` : undefined"
      :dismissible="!removingOffer"
      :ui="{ footer: 'justify-end' }"
    >
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="removingOffer" @click="close">Anuluj</UButton>
        <UButton color="error" icon="i-lucide-trash-2" :loading="removingOffer" @click="removeOffer">
          Usuń ofertę
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.detail-alert {
  margin-bottom: 16px;
}

.case-messages-workspace,
.case-mail-workspace {
  display: grid;
  min-width: 0;
  min-height: 0;
  flex: 1 1 0;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

.case-header-meta,
.case-header-meta__status,
.history-panel > header,
.history-panel > header > div,
.task-list li,
.full-activity-list li,
.history-empty {
  display: flex;
  align-items: center;
}

.case-header-meta {
  flex-wrap: wrap;
  gap: 10px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.case-header-meta strong {
  color: var(--ui-text);
  font-weight: 600;
}

.case-header-meta__status {
  gap: 7px;
  color: var(--ui-text);
}

.case-header-meta__status > span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--ui-success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-success) 14%, transparent);
}

.case-header-meta__separator {
  width: 1px;
  height: 13px;
  background: var(--ui-border-accented);
}

.case-command-loading {
  display: grid;
  grid-template-columns: minmax(0, 1.75fr) minmax(320px, .75fr);
  gap: 16px;
}

.case-overview-stack {
  display: grid;
  gap: 16px;
}

.case-workflow {
  display: grid;
  gap: 16px;
  margin-bottom: 24px;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg);
}

.case-workflow__intro,
.case-workflow__intro > div,
.case-workflow ol,
.case-workflow a,
.case-section-heading,
.case-documents__empty-body,
.case-documents__empty-copy {
  display: flex;
}

.case-workflow__intro {
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.case-workflow__intro > div {
  flex-direction: column;
  gap: 3px;
}

.case-workflow__intro p,
.case-workflow__intro h2,
.case-section-heading p,
.case-section-heading h2,
.case-section-heading span,
.case-documents__empty h3,
.case-documents__empty p {
  margin: 0;
}

.case-workflow__intro p,
.case-section-heading p {
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.case-workflow__intro h2,
.case-section-heading h2 {
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 680;
}

.case-workflow__intro > span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.case-workflow__intro > span strong {
  color: var(--ui-text-highlighted);
}

.case-workflow ol {
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.case-workflow li {
  flex: 1;
  min-width: 0;
}

.case-workflow a {
  align-items: center;
  gap: 10px;
  min-height: 68px;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  color: inherit;
  text-decoration: none;
}

.case-workflow a:hover,
.case-workflow a:focus-visible,
.case-workflow a.current {
  border-color: var(--ui-primary);
  outline: none;
}

.case-workflow a.current {
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-bg));
}

.case-workflow a.complete .case-workflow__number {
  background: color-mix(in srgb, var(--ui-success) 15%, var(--ui-bg));
  color: var(--ui-success);
}

.case-workflow__number {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 800;
}

.case-workflow a > span:nth-child(2) {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}

.case-workflow a strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.case-workflow a small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-workflow a > svg {
  flex: 0 0 auto;
  color: var(--ui-text-dimmed);
  font-size: 14px;
}

.case-detail-grid {
  display: grid;
  grid-template-columns: minmax(280px, .72fr) minmax(0, 1.8fr);
  gap: 24px;
  align-items: start;
}

.case-credit-view {
  container-name: case-credit-view;
  container-type: inline-size;
}

.panel-head,
.client-row,
.saved-offer,
.offer-heading,
.offer-actions {
  display: flex;
  align-items: center;
}

.panel-head {
  justify-content: space-between;
  gap: 16px;
}

.panel-head h2,
.panel-head p,
.empty-offers h3,
.empty-offers p,
.offer-heading p,
.snapshot-details h3 {
  margin: 0;
}

.panel-head h2 {
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.panel-head p {
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.offer-total {
  display: grid;
  place-items: center;
  min-width: 30px;
  height: 30px;
  border-radius: 999px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 700;
}

.client-list,
.offer-list,
.snapshot-details {
  display: grid;
  gap: 12px;
}

.client-row {
  gap: 10px;
  padding: 10px;
  border-radius: 9px;
  color: inherit;
  text-decoration: none;
}

.client-row:hover,
.client-row:focus-visible {
  background: var(--ui-bg-elevated);
  outline: none;
}

.client-avatar,
.bank-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
}

.client-row > div,
.offer-heading > div {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}

.client-row strong,
.offer-heading strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-row small,
.offer-heading small,
.offer-heading p,
.offer-saved-at small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.saved-offer {
  display: grid;
  grid-template-columns: minmax(240px, 1.2fr) minmax(300px, 1.35fr) minmax(130px, .55fr) auto;
  gap: 18px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
}

.saved-offer--selected {
  border-color: var(--ui-primary);
  box-shadow: inset 3px 0 var(--ui-primary);
}

.offer-heading {
  gap: 11px;
  min-width: 0;
}

.offer-heading__badge {
  flex: 0 0 auto;
}

.bank-icon {
  color: var(--ui-primary);
}

.offer-metrics,
.snapshot-details dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.offer-metrics div,
.snapshot-details dl div {
  display: grid;
  gap: 3px;
}

.offer-metrics dt,
.snapshot-details dt {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.offer-metrics dd,
.snapshot-details dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.offer-saved-at {
  display: grid;
  gap: 3px;
}

.offer-saved-at span {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.offer-actions {
  justify-content: flex-end;
  gap: 3px;
}

.empty-offers {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 64px 20px;
  text-align: center;
}

.empty-offers > span {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--ui-bg-muted);
  color: var(--ui-primary);
  font-size: 24px;
}

.empty-offers h3 {
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.empty-offers p {
  max-width: 460px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.case-documents,
.case-delegations,
.case-history {
  scroll-margin-top: 20px;
  margin-top: 0;
}

.case-applications {
  scroll-margin-top: 20px;
  margin-top: 24px;
}

.case-delegations {
  display: grid;
  gap: 16px;
}

.case-section-heading {
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 12px;
}

.case-section-heading > div {
  display: grid;
  gap: 4px;
}

.case-section-heading span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.case-files {
  margin: 16px 0 20px;
}

.case-files__header,
.case-files__list li {
  display: flex;
  align-items: center;
}

.case-files__header {
  justify-content: space-between;
  gap: 16px;
}

.case-files__header p,
.case-files__header h3 {
  margin: 0;
}

.case-files__header p {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.case-files__header h3 {
  margin-top: 3px;
  color: var(--ui-text-highlighted);
  font-size: 15px;
}

.case-files__list {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
}

.case-files__list li {
  gap: 12px;
  min-height: 64px;
  padding: 10px 2px;
  border-radius: 10px;
}

.case-files__list li + li {
  border-top: 1px solid var(--ui-border);
}

.case-files__list li.is-selected {
  scroll-margin: 110px;
  padding-inline: 10px;
  background: color-mix(in srgb, var(--ui-primary) 10%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 22%, transparent);
}

.case-files__icon {
  display: grid;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 10px;
  background: var(--ui-bg-muted);
  color: var(--ui-primary);
}

.case-files__list li > div {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}

.case-files__list strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-files__list small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.case-documents__empty-body {
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.case-documents__empty-copy {
  align-items: center;
  gap: 14px;
}

.case-documents__empty-copy > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--ui-bg-muted);
  color: var(--ui-primary);
  font-size: 21px;
}

.case-documents__empty h3 {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.case-documents__empty p {
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.case-history__grid {
  display: grid;
  grid-template-columns: minmax(280px, .75fr) minmax(0, 1.25fr);
  gap: 16px;
  align-items: start;
}

.history-panel {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.history-panel > header {
  justify-content: space-between;
  gap: 16px;
  min-height: 58px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--ui-border);
}

.history-panel > header > div {
  gap: 9px;
}

.history-panel h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.task-list,
.full-activity-list {
  display: grid;
  margin: 0;
  padding: 10px 14px;
  list-style: none;
}

.task-list li,
.full-activity-list li {
  gap: 11px;
  min-height: 58px;
  padding: 9px 4px;
}

.task-list li + li,
.full-activity-list li + li {
  border-top: 1px solid var(--ui-border);
}

.task-list li.is-selected {
  scroll-margin: 110px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-primary) 10%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 22%, transparent);
}

.task-list__status {
  width: 10px;
  height: 10px;
  border: 2px solid var(--ui-warning);
  border-radius: 999px;
}

.task-list li > div,
.full-activity-list li > div,
.history-empty > div {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}

.task-list strong,
.full-activity-list strong,
.history-empty strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 620;
}

.task-list small,
.full-activity-list small,
.history-empty span,
.full-activity-list p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.full-activity-list > li > span {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
}

.history-empty {
  gap: 12px;
  padding: 28px 18px;
  color: var(--ui-text-muted);
}

.history-empty > svg {
  font-size: 22px;
}

.snapshot-details section {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
}

.snapshot-details h3 {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.snapshot-details dl {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 1700px) {
  .saved-offer {
    grid-template-columns: minmax(180px, 1fr) minmax(220px, 1.2fr);
  }

  .offer-saved-at {
    display: none;
  }

  .offer-actions {
    grid-column: 1 / -1;
    flex-wrap: wrap;
  }
}

@media (max-width: 1200px) {
  .case-workflow ol {
    flex-wrap: wrap;
  }

  .case-workflow li {
    flex: 1 1 calc(50% - 10px);
  }
}

@media (max-width: 700px) {
  .case-workflow__intro,
  .case-section-heading,
  .case-documents__empty-body {
    align-items: stretch;
    flex-direction: column;
  }

  .case-workflow li {
    flex-basis: 100%;
  }

  .case-files__list li {
    flex-wrap: wrap;
  }

  .case-files__list li > div {
    min-width: calc(100% - 48px);
  }
}

@media (max-width: 980px) {
  .case-detail-grid,
  .case-history__grid,
  .case-command-loading {
    grid-template-columns: 1fr;
  }
}

@container case-credit-view (max-width: 900px) {
  .case-detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .case-header-meta__separator {
    display: none;
  }

  .case-header-meta {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }

  .saved-offer {
    grid-template-columns: 1fr;
  }

  .offer-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .offer-saved-at {
    display: grid;
  }

  .offer-actions {
    justify-content: flex-start;
  }
}
</style>
