<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'
import type {
  ClientAnonymizationRequestChannel,
  ClientConsentCaptureRequest,
  ClientConsentState,
  ClientDetailResponse,
} from '~/types/clients'

definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const { organizationSlug, crmApiPath, orgPath } = useOrganizationContext()
const clientId = computed(() => String(route.params.id))
const requestFetch = useRequestFetch()
const toast = useToast()

const emptyDetail = (): ClientDetailResponse => ({
  data: {
    id: '',
    organization_id: '',
    owner_user_id: null,
    display_name: '',
    primary_email: null,
    primary_phone: null,
    status_code: '',
    lead_source: null,
    tags: [],
    notes: null,
    metadata: {},
    created_at: '',
    updated_at: '',
  },
  owner: null,
  primary_person: null,
  people: [],
  portal_accounts: [],
  cases: [],
  tasks: [],
  documents: [],
  activities: [],
  activity_count: 0,
  consents: [],
  consent_states: [],
  consent_definitions: [],
  consent_events: [],
  consent_history: [],
  consent_history_count: 0,
  consent_capture_requests: [],
  consent_access: { can_request: false, can_manage: false },
  consent_history_page_info: { offset: 0, limit: 100, has_more: false },
  anonymization_requests: [],
  current_anonymization_request: null,
  privacy_access: {
    can_view_requests: false,
    can_create_request: false,
    create_permission_key: 'privacy.requests.create',
    can_execute_anonymization: false,
    execute_permission_key: 'clients.anonymization.execute',
    execution_requires_temporary_grant: true,
    execution_grant: null,
  },
  appointments: [],
  appointment_count: 0,
  appointments_page_info: { offset: 0, limit: 20, has_more: false },
  summary: {
    people_count: 0,
    cases_count: 0,
    open_cases_count: 0,
    task_count: 0,
    open_tasks_count: 0,
    documents_count: 0,
    activity_count: 0,
    consent_definition_count: 0,
    granted_consent_count: 0,
    appointment_count: 0,
  },
})

const {
  data,
  pending,
  error,
  refresh,
} = await useAsyncData<ClientDetailResponse>(
  `crm-client:${organizationSlug.value}:${clientId.value}`,
  () => requestFetch<ClientDetailResponse>(crmApiPath(`/clients/${clientId.value}`)),
  {
    default: emptyDetail,
    watch: [organizationSlug, clientId],
  },
)

useHead(() => ({ title: `${data.value.data.display_name || 'Klient'} — OpenExpert CRM` }))

const validViews = ['overview', 'cases', 'consents', 'privacy', 'appointments', 'history'] as const
type ClientView = typeof validViews[number]

const currentView = computed<ClientView>(() => {
  const view = String(route.query.view ?? 'overview')
  return validViews.includes(view as ClientView) ? view as ClientView : 'overview'
})

function viewLocation(view: ClientView) {
  const query = { ...route.query }
  if (view === 'overview') delete query.view
  else query.view = view
  return { path: route.path, query }
}

const clientTabs = computed(() => [
  {
    label: 'Podsumowanie',
    icon: 'i-lucide-layout-dashboard',
    to: viewLocation('overview'),
  },
  {
    label: 'Sprawy',
    icon: 'i-lucide-briefcase-business',
    count: data.value.summary.cases_count,
    to: viewLocation('cases'),
  },
  {
    label: 'Zgody',
    icon: 'i-lucide-shield-check',
    count: data.value.summary.consent_definition_count,
    to: viewLocation('consents'),
  },
  ...((
    data.value.privacy_access.can_view_requests
    || data.value.privacy_access.can_create_request
  )
    ? [{
        label: 'Prywatność danych',
        icon: 'i-lucide-shield-alert',
        count: data.value.anonymization_requests.length,
        to: viewLocation('privacy'),
      }]
    : []),
  {
    label: 'Wizyty',
    icon: 'i-lucide-calendar-days',
    count: data.value.appointment_count,
    to: viewLocation('appointments'),
  },
  {
    label: 'Historia',
    icon: 'i-lucide-history',
    count: data.value.activity_count + data.value.consent_history_count,
    to: viewLocation('history'),
  },
])

const statusMeta = computed(() => {
  const statuses: Record<string, { label: string, color: 'neutral' | 'info' | 'success' | 'warning' | 'error' }> = {
    lead: { label: 'Potencjalny klient', color: 'info' },
    active: { label: 'Aktywny', color: 'success' },
    inactive: { label: 'Nieaktywny', color: 'neutral' },
    blocked: { label: 'Zablokowany', color: 'error' },
  }
  const rawStatus = data.value.data.status_code
  return statuses[rawStatus] ?? {
    label: rawStatus ? rawStatus.replaceAll('_', ' ') : 'Bez statusu',
    color: 'neutral' as const,
  }
})

const headerDate = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const longDate = new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'long',
  timeStyle: 'short',
})

const shortDate = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function formatDateTime(value: string | null | undefined, fallback = '—') {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : longDate.format(date)
}

function formatShortDate(value: string | null | undefined, fallback = '—') {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : shortDate.format(date)
}

function formatHeaderDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : headerDate.format(date)
}

const clientInitials = computed(() => {
  const words = data.value.data.display_name.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map(word => word[0]?.toUpperCase()).join('') || 'K'
})

const currentAnonymizationRequest = computed(() => data.value.current_anonymization_request)
const activeAnonymizationRequest = computed(() => (
  data.value.anonymization_requests.find(request => (
    !['completed', 'rejected', 'cancelled'].includes(request.status)
  )) ?? null
))

const anonymizationRequestChannelItems: Array<{
  label: string
  value: ClientAnonymizationRequestChannel
}> = [
  { label: 'E-mail', value: 'email' },
  { label: 'Telefon', value: 'phone' },
  { label: 'Osobiście', value: 'in_person' },
  { label: 'List', value: 'letter' },
  { label: 'Inny', value: 'other' },
]

const anonymizationRequestSchema = z.object({
  subjectPersonId: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Wybierz osobę, której dotyczy żądanie.',
  ),
  requestChannel: z.enum(['email', 'phone', 'in_person', 'letter', 'other']),
  requestedAt: z.string()
    .min(1, 'Podaj datę otrzymania żądania.')
    .refine((value) => {
      const milliseconds = new Date(value).getTime()
      return Number.isFinite(milliseconds) && milliseconds <= Date.now() + 60_000
    }, 'Data otrzymania nie może być w przyszłości.'),
  justification: z.string()
    .trim()
    .min(20, 'Opisz żądanie w co najmniej 20 znakach.')
    .max(2_000, 'Opis może zawierać maksymalnie 2000 znaków.'),
})

type AnonymizationRequestForm = z.output<typeof anonymizationRequestSchema>

const anonymizationRequestSubjectItems = computed(() => (
  data.value.people.map(person => ({
    label: person.display_name || 'Osoba bez nazwy',
    value: person.id,
  }))
))

const anonymizationStatuses = {
  received: { label: 'Otrzymane', color: 'info', icon: 'i-lucide-inbox' },
  identity_verification: { label: 'Weryfikacja tożsamości', color: 'warning', icon: 'i-lucide-scan-face' },
  legal_review: { label: 'Ocena podstawy prawnej', color: 'warning', icon: 'i-lucide-scale' },
  approved: { label: 'Zatwierdzone do anonimizacji', color: 'success', icon: 'i-lucide-badge-check' },
  in_progress: { label: 'Anonimizacja w toku', color: 'warning', icon: 'i-lucide-loader-circle' },
  completed: { label: 'Zanonimizowane', color: 'neutral', icon: 'i-lucide-shield-check' },
  rejected: { label: 'Odrzucone', color: 'error', icon: 'i-lucide-circle-x' },
  cancelled: { label: 'Anulowane', color: 'neutral', icon: 'i-lucide-ban' },
} as const

function anonymizationStatusMeta(status: string) {
  return anonymizationStatuses[status as keyof typeof anonymizationStatuses]
    ?? { label: status.replaceAll('_', ' '), color: 'neutral' as const, icon: 'i-lucide-circle-help' }
}

function anonymizationChannelLabel(channel: string) {
  return ({
    email: 'E-mail',
    phone: 'Telefon',
    in_person: 'Osobiście',
    letter: 'List',
    other: 'Inny',
  })[channel] ?? channel
}

const anonymizationDeadlineLabel = computed(() => {
  const dueAt = currentAnonymizationRequest.value?.due_at
  if (!dueAt) return '—'
  const dueTime = new Date(dueAt).getTime()
  if (Number.isNaN(dueTime)) return '—'
  const days = Math.ceil((dueTime - Date.now()) / (24 * 60 * 60 * 1000))
  if (days < 0) return `${Math.abs(days)} dni po terminie`
  if (days === 0) return 'Termin upływa dziś'
  return `${days} dni do terminu`
})

function consentDecisionLabel(decision: string) {
  return ({
    granted: 'Udzielona',
    declined: 'Brak zgody',
    withdrawn: 'Wycofana',
    missing: 'Brak decyzji',
  })[decision] ?? decision
}

function consentDecisionColor(decision: string): 'success' | 'error' | 'warning' | 'neutral' {
  return ({
    granted: 'success',
    declined: 'error',
    withdrawn: 'warning',
    missing: 'neutral',
  })[decision] as 'success' | 'error' | 'warning' | 'neutral' ?? 'neutral'
}

function consentChannelLabel(channel: string | null | undefined) {
  if (!channel) return 'Dowolny kanał'
  return ({
    email: 'E-mail',
    sms: 'SMS/MMS',
    phone: 'Telefon',
    messaging: 'Komunikator',
    other: 'Inny kanał',
  })[channel] ?? channel
}

function consentSourceLabel(source: string | null | undefined) {
  if (!source) return 'CRM'
  return ({
    client_creation: 'Dodanie klienta',
    client_card: 'Karta klienta',
    import: 'Import',
    api: 'API',
    booking_widget: 'Widget rezerwacji',
    sms_verification: 'SMS z kodem',
  })[source] ?? source
}

const activeConsentCaptureStatuses = new Set([
  'pending',
  'queued',
  'sent',
  'delivered',
  'opened',
  'verified',
])

function consentCaptureStatusLabel(request: ClientConsentCaptureRequest) {
  if (request.status === 'failed' && request.delivery_status === 'otp_locked') {
    return 'Kod OTP zablokowany'
  }
  return ({
    pending: 'Przygotowywanie',
    queued: 'W kolejce',
    sent: 'SMS wysłany',
    delivered: 'SMS dostarczony',
    opened: 'Link otwarty',
    verified: 'Numer potwierdzony',
    accepted: 'Zgoda udzielona',
    declined: 'Brak zgody',
    withdrawn: 'Zgoda wycofana',
    expired: 'Prośba wygasła',
    cancelled: 'Prośba anulowana',
    failed: 'Błąd wysyłki',
  })[request.status] ?? request.status
}

function consentCaptureStatusColor(status: string): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (['accepted', 'delivered', 'verified'].includes(status)) return 'success'
  if (['declined', 'withdrawn', 'failed'].includes(status)) return 'error'
  if (['pending', 'queued', 'sent', 'opened'].includes(status)) return 'info'
  if (status === 'expired') return 'warning'
  return 'neutral'
}

function latestConsentCaptureRequest(consent: ClientConsentState): ClientConsentCaptureRequest | null {
  return data.value.consent_capture_requests.find(request => (
    request.definition_id === consent.definition_id
    && request.subject_person_id === consent.subject_person_id
  )) ?? null
}

function consentCaptureActionLabel(consent: ClientConsentState) {
  const latestRequest = latestConsentCaptureRequest(consent)
  if (latestRequest && activeConsentCaptureStatuses.has(latestRequest.status)) return 'Wyślij ponownie'
  return consent.decision === 'granted' ? 'Wyślij wycofanie' : 'Wyślij prośbę SMS'
}

function personRoleLabel(role: string) {
  return ({
    primary: 'Osoba główna',
    co_borrower: 'Współkredytobiorca',
    insured: 'Ubezpieczony',
    representative: 'Pełnomocnik',
  })[role] ?? role.replaceAll('_', ' ')
}

const appointmentStatuses = {
  hold: { label: 'Wstępnie zarezerwowana', color: 'warning' },
  confirmed: { label: 'Potwierdzona', color: 'success' },
  cancelled: { label: 'Anulowana', color: 'error' },
} as const

function appointmentStatusMeta(status: string) {
  return appointmentStatuses[status as keyof typeof appointmentStatuses]
    ?? { label: status || 'Nieznany', color: 'neutral' as const }
}

function appointmentDay(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pl-PL', { day: '2-digit' }).format(date)
}

function appointmentMonth(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pl-PL', { month: 'short' }).format(date)
}

function appointmentTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function activityIcon(activityType: string) {
  if (activityType === 'client_portal_account_archived') return 'i-lucide-archive'
  if (activityType.includes('created')) return 'i-lucide-circle-plus'
  if (activityType.includes('status')) return 'i-lucide-refresh-cw'
  if (activityType.includes('document') || activityType.includes('submission')) return 'i-lucide-file-check-2'
  if (activityType.includes('note')) return 'i-lucide-message-square-text'
  if (activityType.includes('appointment')) return 'i-lucide-calendar-check'
  if (activityType.includes('updated')) return 'i-lucide-pencil'
  return 'i-lucide-activity'
}

function activityLabel(activityType: string) {
  return ({
    client_created: 'Utworzenie klienta',
    client_updated: 'Zmiana danych',
    client_portal_account_archived: 'Archiwizacja konta panelu klienta',
    case_created: 'Nowa sprawa',
    status_changed: 'Zmiana statusu',
    note: 'Notatka',
    submission_created: 'Nowy wniosek',
    settlement_upserted: 'Aktualizacja rozliczenia',
  })[activityType] ?? activityType.replaceAll('_', ' ')
}

function portalArchiveReasonLabel(reason: string | null): string {
  if (!reason) return ''
  if (reason === 'self_service_request') return 'na prośbę klienta w panelu'
  return reason.replaceAll('_', ' ')
}

type HistoryItem = {
  id: string
  date: string
  icon: string
  category: string
  title: string
  description: string
  meta: string
  tone: 'neutral' | 'success' | 'warning' | 'error'
}

const historyItems = computed<HistoryItem[]>(() => {
  const activities = data.value.activities.map(activity => ({
    id: `activity:${activity.id}`,
    date: activity.created_at,
    icon: activityIcon(activity.activity_type),
    category: activityLabel(activity.activity_type),
    title: activity.title,
    description: activity.body || 'Zdarzenie zapisane w historii klienta.',
    meta: activity.activity_type === 'client_portal_account_archived'
      ? 'Klient · panel klienta'
      : activity.actor?.full_name || activity.actor?.email || 'OpenExpert CRM',
    tone: 'neutral' as const,
  }))

  const consents = data.value.consent_history.map(consent => ({
    id: `consent:${consent.id}`,
    date: consent.occurred_at,
    icon: consent.decision === 'granted' ? 'i-lucide-shield-check' : 'i-lucide-shield-x',
    category: 'Decyzja zgody',
    title: consent.version?.display_title || 'Zgoda klienta',
    description: `${consentDecisionLabel(consent.decision)} · ${consentChannelLabel(consent.version?.channel)}`,
    meta: consentSourceLabel(consent.source),
    tone: consent.decision === 'granted'
      ? 'success' as const
      : consent.decision === 'withdrawn'
        ? 'warning' as const
        : 'error' as const,
  }))

  return [...activities, ...consents].sort((left, right) => (
    new Date(right.date).getTime() - new Date(left.date).getTime()
  ))
})

const portalAccountStatusMeta = computed(() => {
  const accounts = data.value.portal_accounts
  if (!accounts.length) {
    return {
      label: 'Brak konta',
      detail: 'Klient nie ma konta w panelu klienta.',
      icon: 'i-lucide-user-round-x',
      color: 'neutral' as const,
    }
  }

  const activeAccount = accounts.find(account => (
    account.status === 'active' && !account.archived_at
  ))
  if (activeAccount) {
    return {
      label: 'Konto aktywne',
      detail: `Aktywne od ${formatShortDate(activeAccount.created_at)}.`,
      icon: 'i-lucide-user-round-check',
      color: 'success' as const,
    }
  }

  const account = accounts[0]!
  if (account.status === 'archived' || account.archived_at) {
    return {
      label: 'Konto zarchiwizowane',
      detail: account.archive_reason
        ? `${formatShortDate(account.archived_at || account.updated_at)} · ${portalArchiveReasonLabel(account.archive_reason)}`
        : `Zarchiwizowane ${formatShortDate(account.archived_at || account.updated_at)}.`,
      icon: 'i-lucide-archive',
      color: 'warning' as const,
    }
  }

  return {
    label: account.status.replaceAll('_', ' '),
    detail: `Ostatnia zmiana ${formatShortDate(account.updated_at)}.`,
    icon: 'i-lucide-circle-help',
    color: 'neutral' as const,
  }
})

const recentHistory = computed(() => historyItems.value.slice(0, 3))
const oldestHistoryItem = computed(() => historyItems.value.at(-1) ?? null)

const summaryMetrics = computed(() => [
  {
    label: 'Otwarte sprawy',
    value: data.value.summary.open_cases_count,
    icon: 'i-lucide-briefcase-business',
    hint: `${data.value.summary.cases_count} łącznie`,
  },
  {
    label: 'Wizyty',
    value: data.value.summary.appointment_count,
    icon: 'i-lucide-calendar-days',
    hint: 'w historii klienta',
  },
  {
    label: 'Aktywne zgody',
    value: data.value.summary.granted_consent_count,
    icon: 'i-lucide-shield-check',
    hint: `${data.value.summary.consent_definition_count} definicje`,
  },
  {
    label: 'Otwarte zadania',
    value: data.value.summary.open_tasks_count,
    icon: 'i-lucide-list-checks',
    hint: `${data.value.summary.task_count} łącznie`,
  },
])

const createCaseOpen = ref(false)
const savingCase = ref(false)
const caseForm = reactive({ title: '' })

function openCreateCase() {
  createCaseOpen.value = true
}

async function createCase() {
  const title = caseForm.title.trim()
  if (!title) return
  savingCase.value = true
  try {
    const response = await $fetch<{ data: { id: string } }>(crmApiPath('/cases'), {
      method: 'POST',
      body: {
        client_ids: [clientId.value],
        title,
      },
    })
    createCaseOpen.value = false
    caseForm.title = ''
    toast.add({
      title: 'Sprawa została utworzona',
      description: 'Klient jest już do niej przypisany.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
    await navigateTo(orgPath(`/cases/${response.data.id}`))
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się utworzyć sprawy',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    savingCase.value = false
  }
}

const editOpen = ref(false)
const anonymizationRequestOpen = ref(false)
const anonymizationExecutionOpen = ref(false)
const anonymizationExecutionConfirmation = ref('')
const anonymizationRequestIdempotencyKey = ref('')
const savingAnonymizationRequest = ref(false)
const executingAnonymization = ref(false)
const savingClient = ref(false)
const requestingConsentKey = ref('')
const anonymizationRequestForm = reactive<Partial<AnonymizationRequestForm>>({
  subjectPersonId: '',
  requestChannel: 'email',
  requestedAt: '',
  justification: '',
})
const editForm = reactive({
  display_name: '',
  primary_email: '',
  primary_phone: '',
  tags: '',
  notes: '',
})

async function requestConsentBySms(consent: ClientConsentState) {
  const subjectPersonId = consent.subject_person_id || consent.subject_person?.id
  const phone = consent.subject_person?.phone
  if (!data.value.consent_access.can_request || !subjectPersonId || !phone) {
    toast.add({
      title: 'Nie można wysłać prośby',
      description: !phone
        ? 'Uzupełnij numer telefonu tej osoby przed wysłaniem SMS-a.'
        : 'Nie masz dostępu do wysyłania próśb o zgodę dla tego klienta.',
      color: 'warning',
      icon: 'i-lucide-message-square-warning',
    })
    return
  }

  const requestKey = `${subjectPersonId}:${consent.definition_id}`
  requestingConsentKey.value = requestKey
  try {
    const response = await $fetch<{
      data: ClientConsentCaptureRequest & {
        maskedPhone?: string
        devOtp?: string
        demoUrl?: string
      }
    }>(crmApiPath(`/consents/${consent.definition_id}/requests`), {
      method: 'POST',
      body: {
        clientId: clientId.value,
        subjectPersonId,
        intent: consent.decision === 'granted' ? 'withdraw' : 'collect',
      },
    })

    await refresh()
    toast.add({
      title: response.data.demoUrl
        ? (consent.decision === 'granted'
            ? 'Utworzono demo wycofania zgody'
            : 'Utworzono prośbę demo')
        : consent.decision === 'granted'
          ? 'Wysłano prośbę o potwierdzenie wycofania'
          : 'Wysłano prośbę o zgodę',
      description: response.data.demoUrl
        ? 'Tryb demo: SMS nie został wysłany. Otwórz formularz, aby przejść proces z automatycznie uzupełnionym kodem.'
        : response.data.devOtp
          ? `Tryb lokalny: kod testowy ${response.data.devOtp}. W produkcji kod trafia wyłącznie SMS-em do klienta.`
          : `SMS został skierowany na numer ${response.data.maskedPhone || response.data.phone_masked}.`,
      color: 'success',
      icon: response.data.demoUrl ? 'i-lucide-flask-conical' : 'i-lucide-message-square-check',
      ...(response.data.demoUrl
        ? {
            actions: [{
              label: 'Otwórz formularz demo',
              onClick: () => {
                window.open(response.data.demoUrl, '_blank', 'noopener,noreferrer')
              },
            }],
          }
        : {}),
    })
  }
  catch (caught: any) {
    toast.add({
      title: 'Nie udało się wysłać SMS-a',
      description: caught?.data?.statusMessage ?? caught?.message ?? 'Spróbuj ponownie.',
      color: 'error',
      icon: 'i-lucide-message-square-warning',
    })
  }
  finally {
    requestingConsentKey.value = ''
  }
}

function localDateTimeValue(date = new Date()) {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  )
  return localDate.toISOString().slice(0, 16)
}

function resetAnonymizationRequestForm() {
  anonymizationRequestForm.subjectPersonId = ''
  anonymizationRequestForm.requestChannel = 'email'
  anonymizationRequestForm.requestedAt = ''
  anonymizationRequestForm.justification = ''
  anonymizationRequestIdempotencyKey.value = ''
}

function openAnonymizationRequest() {
  if (
    !data.value.privacy_access.can_create_request
    || activeAnonymizationRequest.value
  ) return

  const subjectPersonId = (
    data.value.primary_person?.id
    || data.value.people[0]?.id
  )
  if (!subjectPersonId) {
    toast.add({
      title: 'Nie można zgłosić żądania',
      description:
        'Klient nie ma osoby, której można przypisać żądanie anonimizacji.',
      color: 'warning',
      icon: 'i-lucide-user-x',
    })
    return
  }

  anonymizationRequestForm.subjectPersonId = subjectPersonId
  anonymizationRequestForm.requestChannel = 'email'
  anonymizationRequestForm.requestedAt = localDateTimeValue()
  anonymizationRequestForm.justification = ''
  anonymizationRequestIdempotencyKey.value = crypto.randomUUID()
  anonymizationRequestOpen.value = true
}

async function createAnonymizationRequest(
  event: FormSubmitEvent<AnonymizationRequestForm>,
) {
  if (
    savingAnonymizationRequest.value
    || !data.value.privacy_access.can_create_request
    || activeAnonymizationRequest.value
  ) return

  const requestedAt = new Date(event.data.requestedAt)
  if (Number.isNaN(requestedAt.getTime())) return

  if (!anonymizationRequestIdempotencyKey.value) {
    anonymizationRequestIdempotencyKey.value = crypto.randomUUID()
  }

  savingAnonymizationRequest.value = true
  try {
    const response = await $fetch<{
      data: {
        requestNumber: string
        replayed: boolean
      }
    }>(crmApiPath(`/clients/${clientId.value}/anonymization-requests`), {
      method: 'POST',
      body: {
        subjectPersonId: event.data.subjectPersonId,
        requestChannel: event.data.requestChannel,
        requestedAt: requestedAt.toISOString(),
        justification: event.data.justification,
        idempotencyKey: anonymizationRequestIdempotencyKey.value,
      },
    })

    await refresh()
    anonymizationRequestOpen.value = false
    toast.add({
      title: 'Żądanie anonimizacji zostało zgłoszone',
      description:
        `${response.data.requestNumber} oczekuje na weryfikację tożsamości i zakresu.`,
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
  }
  catch (caught: any) {
    toast.add({
      title: 'Nie udało się zgłosić żądania',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    savingAnonymizationRequest.value = false
  }
}

function openEdit() {
  editForm.display_name = data.value.data.display_name
  editForm.primary_email = data.value.data.primary_email ?? ''
  editForm.primary_phone = data.value.data.primary_phone ?? ''
  editForm.tags = data.value.data.tags.join(', ')
  editForm.notes = data.value.data.notes ?? ''
  editOpen.value = true
}

async function saveClient() {
  const displayName = editForm.display_name.trim()
  if (!displayName) return
  savingClient.value = true
  try {
    await $fetch(crmApiPath(`/clients/${clientId.value}`), {
      method: 'PATCH',
      body: {
        display_name: displayName,
        primary_email: editForm.primary_email.trim() || null,
        primary_phone: editForm.primary_phone.trim() || null,
        tags: editForm.tags.split(',').map(tag => tag.trim()).filter(Boolean),
        notes: editForm.notes.trim() || null,
      },
    })
    await refresh()
    editOpen.value = false
    toast.add({
      title: 'Dane klienta zapisane',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się zapisać klienta',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    savingClient.value = false
  }
}

async function executeAnonymization() {
  const request = currentAnonymizationRequest.value
  const grant = data.value.privacy_access.execution_grant
  if (
    !request
    || !grant
    || anonymizationExecutionConfirmation.value.trim() !== 'ANONIMIZUJ'
  ) return

  executingAnonymization.value = true
  try {
    await $fetch(crmApiPath(`/anonymization-requests/${request.id}/execute`), {
      method: 'POST',
      body: {
        grantId: grant.id,
        expectedRevision: grant.revision,
        idempotencyKey: crypto.randomUUID(),
        confirmation: 'ANONIMIZUJ',
      },
    })
    anonymizationExecutionOpen.value = false
    anonymizationExecutionConfirmation.value = ''
    await refresh()
    toast.add({
      title: 'Dane klienta zostały zanonimizowane',
      description: `${request.request_number} zakończono, a jednorazowy grant został zużyty.`,
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
  }
  catch (caught: any) {
    toast.add({
      title: 'Nie udało się wykonać anonimizacji',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    await refresh()
  }
  finally {
    executingAnonymization.value = false
  }
}

const headerMenuItems = computed(() => [
  [
    {
      label: 'Edytuj dane klienta',
      icon: 'i-lucide-pencil',
      onSelect: openEdit,
    },
    {
      label: 'Odśwież dane',
      icon: 'i-lucide-refresh-cw',
      onSelect: () => refresh(),
    },
  ],
  ...(data.value.privacy_access.can_view_requests && currentAnonymizationRequest.value
    ? [[{
        label: 'Otwórz żądanie anonimizacji',
        icon: 'i-lucide-shield-alert',
        onSelect: () => navigateTo(viewLocation('privacy')),
      }]]
    : []),
  ...(data.value.privacy_access.can_create_request
    ? [[{
        label: 'Zgłoś żądanie anonimizacji',
        icon: 'i-lucide-shield-plus',
        onSelect: openAnonymizationRequest,
      }]]
    : []),
])
</script>

<template>
  <CrmShell
    :title="data.data.display_name || 'Klient'"
    eyebrow="Klient · karta CRM"
    description="Relacja, sprawy, zgody, wizyty i pełna historia obsługi w jednym miejscu."
    :back-to="orgPath('/clients')"
    back-label="Wróć do klientów"
    :tabs="pending && !data.data.id ? [] : clientTabs"
  >
    <template #meta>
      <div v-if="data.data.id" class="client-header-meta">
        <UBadge :color="statusMeta.color" variant="subtle">{{ statusMeta.label }}</UBadge>
        <UBadge
          v-if="currentAnonymizationRequest"
          :color="anonymizationStatusMeta(currentAnonymizationRequest.status).color"
          variant="subtle"
          :icon="anonymizationStatusMeta(currentAnonymizationRequest.status).icon"
        >
          {{ currentAnonymizationRequest.request_number }} ·
          {{ anonymizationStatusMeta(currentAnonymizationRequest.status).label }}
        </UBadge>
        <span class="client-header-meta__separator" aria-hidden="true" />
        <span>
          Opiekun:
          <strong>{{ data.owner?.full_name || data.owner?.email || 'Nieprzypisany' }}</strong>
        </span>
        <span class="client-header-meta__separator" aria-hidden="true" />
        <span>Ostatnia aktualizacja: {{ formatHeaderDate(data.data.updated_at) }}</span>
      </div>
    </template>

    <template #actions>
      <template v-if="data.data.id">
        <UButton
          v-if="data.data.primary_email"
          :to="`mailto:${data.data.primary_email}`"
          color="neutral"
          variant="outline"
          size="lg"
          icon="i-lucide-mail"
        >
          Napisz
        </UButton>
        <UButton
          color="neutral"
          variant="solid"
          size="lg"
          icon="i-lucide-folder-plus"
          @click="openCreateCase"
        >
          Nowa sprawa
        </UButton>
        <UDropdownMenu :items="headerMenuItems" :content="{ align: 'end' }">
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            icon="i-lucide-ellipsis"
            aria-label="Więcej działań"
          />
        </UDropdownMenu>
      </template>
    </template>

    <div v-if="pending && !data.data.id" class="client-loading">
      <div class="client-loading__metrics">
        <USkeleton v-for="index in 4" :key="index" class="h-28 w-full" />
      </div>
      <div class="client-loading__body">
        <USkeleton class="h-96 w-full" />
        <USkeleton class="h-96 w-full" />
      </div>
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Nie udało się pobrać karty klienta"
      description="Sprawdź połączenie i spróbuj ponownie."
    >
      <template #actions>
        <UButton color="error" variant="soft" icon="i-lucide-refresh-cw" @click="refresh()">
          Spróbuj ponownie
        </UButton>
      </template>
    </UAlert>

    <template v-else>
      <section v-if="currentView === 'overview'" class="client-overview">
        <div class="client-metrics" aria-label="Podsumowanie klienta">
          <article v-for="metric in summaryMetrics" :key="metric.label" class="client-metric">
            <span class="client-metric__icon"><UIcon :name="metric.icon" /></span>
            <div>
              <strong>{{ metric.value }}</strong>
              <span>{{ metric.label }}</span>
            </div>
            <small>{{ metric.hint }}</small>
          </article>
        </div>

        <div class="client-overview__grid">
          <div class="client-panel-stack">
            <section class="client-panel client-profile-panel" aria-labelledby="client-data-title">
              <header class="client-panel__header">
                <div>
                  <p>Dane podstawowe</p>
                  <h2 id="client-data-title">Kontakt i opiekun</h2>
                </div>
                <UButton color="neutral" variant="ghost" size="sm" icon="i-lucide-pencil" @click="openEdit">
                  Edytuj
                </UButton>
              </header>

              <div class="client-profile">
                <span class="client-avatar">{{ clientInitials }}</span>
                <div class="client-profile__identity">
                  <strong>{{ data.data.display_name }}</strong>
                  <span>{{ statusMeta.label }}</span>
                </div>
              </div>

              <dl class="client-data-list">
                <div>
                  <dt><UIcon name="i-lucide-mail" /> E-mail</dt>
                  <dd>
                    <a v-if="data.data.primary_email" :href="`mailto:${data.data.primary_email}`">
                      {{ data.data.primary_email }}
                    </a>
                    <span v-else>Nie podano</span>
                  </dd>
                </div>
                <div>
                  <dt><UIcon name="i-lucide-phone" /> Telefon</dt>
                  <dd>
                    <a v-if="data.data.primary_phone" :href="`tel:${data.data.primary_phone}`">
                      {{ data.data.primary_phone }}
                    </a>
                    <span v-else>Nie podano</span>
                  </dd>
                </div>
                <div>
                  <dt><UIcon name="i-lucide-user-round-check" /> Opiekun</dt>
                  <dd>{{ data.owner?.full_name || data.owner?.email || 'Nieprzypisany' }}</dd>
                </div>
                <div>
                  <dt><UIcon name="i-lucide-calendar-plus" /> Klient od</dt>
                  <dd>{{ formatShortDate(data.data.created_at) }}</dd>
                </div>
              </dl>
            </section>

            <section class="client-panel" aria-labelledby="related-people-title">
              <header class="client-panel__header">
                <div>
                  <p>Relacje</p>
                  <h2 id="related-people-title">Osoby powiązane</h2>
                </div>
                <UBadge color="neutral" variant="outline">{{ data.people.length }}</UBadge>
              </header>

              <div v-if="data.people.length" class="related-people">
                <article v-for="person in data.people" :key="person.id">
                  <span><UIcon name="i-lucide-user-round" /></span>
                  <div>
                    <strong>{{ person.display_name }}</strong>
                    <small>{{ personRoleLabel(person.role) }}</small>
                  </div>
                  <p>{{ person.email || person.phone || 'Brak danych kontaktowych' }}</p>
                </article>
              </div>
              <div v-else class="client-empty client-empty--compact">
                <UIcon name="i-lucide-users-round" />
                <span>Nie dodano innych osób do tej relacji.</span>
              </div>
            </section>
          </div>

          <aside class="client-panel-stack">
            <section class="client-panel" aria-labelledby="relationship-context-title">
              <header class="client-panel__header">
                <div>
                  <p>Kontekst relacji</p>
                  <h2 id="relationship-context-title">O kliencie</h2>
                </div>
              </header>

              <dl class="client-context-list">
                <div>
                  <dt>Źródło</dt>
                  <dd>{{ data.data.lead_source || 'Nieokreślone' }}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{{ statusMeta.label }}</dd>
                </div>
                <div>
                  <dt>Panel klienta</dt>
                  <dd class="client-portal-account-status">
                    <UBadge
                      :color="portalAccountStatusMeta.color"
                      variant="subtle"
                      :icon="portalAccountStatusMeta.icon"
                    >
                      {{ portalAccountStatusMeta.label }}
                    </UBadge>
                    <small>{{ portalAccountStatusMeta.detail }}</small>
                  </dd>
                </div>
                <div>
                  <dt>Tagi</dt>
                  <dd class="client-tags">
                    <UBadge
                      v-for="tag in data.data.tags"
                      :key="tag"
                      color="neutral"
                      variant="subtle"
                    >
                      {{ tag }}
                    </UBadge>
                    <span v-if="!data.data.tags.length">Brak tagów</span>
                  </dd>
                </div>
              </dl>

              <div v-if="data.data.notes" class="client-note">
                <span><UIcon name="i-lucide-notebook-text" /></span>
                <p>{{ data.data.notes }}</p>
              </div>
            </section>

            <section
              v-if="data.privacy_access.can_view_requests"
              class="client-panel client-privacy-preview"
              aria-labelledby="privacy-preview-title"
            >
              <header class="client-panel__header">
                <div>
                  <p>Prywatność danych</p>
                  <h2 id="privacy-preview-title">Anonimizacja</h2>
                </div>
                <UButton
                  :to="viewLocation('privacy')"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  trailing-icon="i-lucide-arrow-right"
                >
                  Szczegóły
                </UButton>
              </header>

              <template v-if="currentAnonymizationRequest">
                <div class="client-privacy-preview__status">
                  <span>
                    <UIcon :name="anonymizationStatusMeta(currentAnonymizationRequest.status).icon" />
                  </span>
                  <div>
                    <strong>{{ anonymizationStatusMeta(currentAnonymizationRequest.status).label }}</strong>
                    <small>{{ currentAnonymizationRequest.request_number }}</small>
                  </div>
                </div>
                <dl class="client-privacy-preview__facts">
                  <div>
                    <dt>Wpłynęło</dt>
                    <dd>{{ formatShortDate(currentAnonymizationRequest.requested_at) }}</dd>
                  </div>
                  <div>
                    <dt>Termin</dt>
                    <dd>{{ anonymizationDeadlineLabel }}</dd>
                  </div>
                </dl>
              </template>

              <div v-else class="client-empty client-empty--compact">
                <UIcon name="i-lucide-shield-check" />
                <span>Brak aktywnego żądania anonimizacji.</span>
              </div>
            </section>

            <section class="client-panel" aria-labelledby="recent-activity-title">
              <header class="client-panel__header">
                <div>
                  <p>Ostatnie zdarzenia</p>
                  <h2 id="recent-activity-title">Aktywność</h2>
                </div>
                <UButton :to="viewLocation('history')" color="neutral" variant="ghost" size="xs" trailing-icon="i-lucide-arrow-right">
                  Cała historia
                </UButton>
              </header>

              <div v-if="recentHistory.length" class="recent-activity">
                <article v-for="item in recentHistory" :key="item.id">
                  <span><UIcon :name="item.icon" /></span>
                  <div>
                    <strong>{{ item.title }}</strong>
                    <small>{{ formatShortDate(item.date) }}</small>
                  </div>
                </article>
              </div>
              <div v-else class="client-empty client-empty--compact">
                <UIcon name="i-lucide-history" />
                <span>Historia uzupełni się po pierwszych działaniach.</span>
              </div>
            </section>
          </aside>
        </div>
      </section>

      <section v-else-if="currentView === 'cases'" class="client-workspace" aria-labelledby="client-cases-title">
        <header class="workspace-heading">
          <div>
            <p>Powiązane procesy</p>
            <h2 id="client-cases-title">Sprawy klienta</h2>
            <span>Wszystkie procesy, w których uczestniczy ten klient.</span>
          </div>
          <UButton icon="i-lucide-folder-plus" @click="openCreateCase">Nowa sprawa</UButton>
        </header>

        <div v-if="data.cases.length" class="client-case-list">
          <NuxtLink
            v-for="item in data.cases"
            :key="item.id"
            :to="orgPath(`/cases/${item.id}`)"
            class="client-case-row"
          >
            <span class="client-case-row__icon"><UIcon name="i-lucide-briefcase-business" /></span>
            <div class="client-case-row__title">
              <strong>{{ item.title }}</strong>
              <span>Aktualizacja {{ formatShortDate(item.updated_at) }}</span>
            </div>
            <div class="client-case-row__facts">
              <span><UIcon name="i-lucide-bookmark-check" /> {{ item.offer_count }} ofert</span>
              <UBadge :color="item.closed_at ? 'neutral' : 'success'" variant="subtle">
                {{ item.closed_at ? 'Zamknięta' : 'Aktywna' }}
              </UBadge>
            </div>
            <UIcon class="client-case-row__arrow" name="i-lucide-chevron-right" />
          </NuxtLink>
        </div>

        <OeEmptyState
          v-else
          icon="i-lucide-folder-plus"
          title="Brak spraw tego klienta"
          description="Utwórz pierwszą sprawę, a klient zostanie przypisany automatycznie."
          surface="outline"
        >
          <template #actions>
            <UButton icon="i-lucide-folder-plus" @click="openCreateCase">Utwórz sprawę</UButton>
          </template>
        </OeEmptyState>
      </section>

      <section v-else-if="currentView === 'consents'" class="client-workspace" aria-labelledby="client-consents-title">
        <header class="workspace-heading">
          <div>
            <p>Preferencje i podstawy prawne</p>
            <h2 id="client-consents-title">Zgody klienta</h2>
            <span>Aktualna decyzja dla każdej opublikowanej definicji.</span>
          </div>
          <UBadge color="neutral" variant="outline">{{ data.consent_states.length }} definicje</UBadge>
        </header>

        <UAlert
          class="client-consent-capture-note"
          color="info"
          variant="subtle"
          icon="i-lucide-message-square-lock"
          title="Decyzję zapisuje klient"
          description="Doradca tylko inicjuje prośbę. Zgoda lub jej wycofanie zostaną zapisane dopiero po potwierdzeniu numeru jednorazowym kodem SMS."
        />

        <div v-if="data.consent_states.length" class="client-consent-grid">
          <article
            v-for="consent in data.consent_states"
            :key="`${consent.subject_person_id}:${consent.definition_id}`"
            class="client-consent-card"
          >
            <header>
              <span class="client-consent-card__icon"><UIcon name="i-lucide-shield-check" /></span>
              <div>
                <strong>{{ consent.version?.display_title || 'Zgoda' }}</strong>
                <small>
                  {{ consent.subject_person?.display_name || 'Klient' }}
                  ·
                  {{ consentChannelLabel(consent.version?.channel) }}
                  · wersja {{ consent.version?.version || '—' }}
                </small>
              </div>
              <UBadge :color="consentDecisionColor(consent.decision)" variant="subtle">
                {{ consentDecisionLabel(consent.decision) }}
              </UBadge>
            </header>
            <p>{{ consent.version?.content || 'Brak opisu treści zgody.' }}</p>
            <div v-if="latestConsentCaptureRequest(consent)" class="client-consent-card__request">
              <div>
                <UIcon name="i-lucide-message-square-more" />
                <span>
                  <strong>{{ consentCaptureStatusLabel(latestConsentCaptureRequest(consent)!) }}</strong>
                  <small>
                    {{ latestConsentCaptureRequest(consent)!.phone_masked }}
                    · {{ formatDateTime(latestConsentCaptureRequest(consent)!.created_at) }}
                  </small>
                </span>
              </div>
              <UBadge
                :color="consentCaptureStatusColor(latestConsentCaptureRequest(consent)!.status)"
                variant="subtle"
              >
                {{ latestConsentCaptureRequest(consent)!.intent === 'withdraw' ? 'wycofanie' : 'pozyskanie' }}
              </UBadge>
            </div>
            <footer>
              <div>
                <span>{{ consent.version?.is_required ? 'Wymagana' : 'Dobrowolna' }}</span>
                <span v-if="consent.occurred_at">
                  {{ formatDateTime(consent.occurred_at) }} · {{ consentSourceLabel(consent.source) }}
                </span>
                <span v-else>Nie zapisano decyzji</span>
              </div>
              <UButton
                v-if="data.consent_access.can_request"
                size="xs"
                color="neutral"
                variant="outline"
                icon="i-lucide-send"
                :disabled="!consent.subject_person?.phone"
                :loading="requestingConsentKey === `${consent.subject_person_id}:${consent.definition_id}`"
                @click="requestConsentBySms(consent)"
              >
                {{ consentCaptureActionLabel(consent) }}
              </UButton>
            </footer>
          </article>
        </div>

        <OeEmptyState
          v-else
          icon="i-lucide-shield-question"
          title="Brak aktywnych definicji zgód"
          description="Po opublikowaniu zgód ich aktualny stan pojawi się tutaj."
          surface="outline"
        />
      </section>

      <section
        v-else-if="currentView === 'privacy'"
        class="client-workspace"
        aria-labelledby="client-privacy-title"
      >
        <header class="workspace-heading">
          <div>
            <p>Prawa osoby, której dane dotyczą</p>
            <h2 id="client-privacy-title">Prywatność danych</h2>
            <span>Zweryfikowane żądania, terminy i kontrolowane wykonanie anonimizacji.</span>
          </div>
          <div class="workspace-heading__actions">
            <UBadge
              v-if="currentAnonymizationRequest"
              :color="anonymizationStatusMeta(currentAnonymizationRequest.status).color"
              variant="subtle"
              :icon="anonymizationStatusMeta(currentAnonymizationRequest.status).icon"
            >
              {{ anonymizationStatusMeta(currentAnonymizationRequest.status).label }}
            </UBadge>
            <UButton
              v-if="data.privacy_access.can_create_request"
              color="neutral"
              variant="outline"
              icon="i-lucide-shield-plus"
              @click="openAnonymizationRequest"
            >
              Zgłoś żądanie
            </UButton>
          </div>
        </header>

        <div v-if="currentAnonymizationRequest" class="client-privacy-layout">
          <section class="client-panel client-privacy-request" aria-labelledby="anonymization-request-title">
            <header class="client-panel__header">
              <div>
                <p>Żądanie klienta</p>
                <h2 id="anonymization-request-title">{{ currentAnonymizationRequest.request_number }}</h2>
              </div>
              <UBadge color="neutral" variant="outline">
                {{ currentAnonymizationRequest.legal_basis }}
              </UBadge>
            </header>

            <div class="client-privacy-request__hero">
              <span>
                <UIcon :name="anonymizationStatusMeta(currentAnonymizationRequest.status).icon" />
              </span>
              <div>
                <strong>{{ anonymizationStatusMeta(currentAnonymizationRequest.status).label }}</strong>
                <p>{{ currentAnonymizationRequest.justification }}</p>
              </div>
            </div>

            <dl class="client-privacy-request__details">
              <div>
                <dt>Kanał zgłoszenia</dt>
                <dd>{{ anonymizationChannelLabel(currentAnonymizationRequest.request_channel) }}</dd>
              </div>
              <div>
                <dt>Data otrzymania</dt>
                <dd>{{ formatDateTime(currentAnonymizationRequest.requested_at) }}</dd>
              </div>
              <div>
                <dt>Termin realizacji</dt>
                <dd>
                  {{ formatShortDate(currentAnonymizationRequest.due_at) }}
                  <small>{{ anonymizationDeadlineLabel }}</small>
                </dd>
              </div>
              <div>
                <dt>Zatwierdził(a)</dt>
                <dd>
                  {{ currentAnonymizationRequest.approved_by?.full_name
                    || currentAnonymizationRequest.approved_by?.email
                    || '—' }}
                </dd>
              </div>
            </dl>

            <div v-if="currentAnonymizationRequest.review_note" class="client-privacy-request__note">
              <UIcon name="i-lucide-notebook-text" />
              <div>
                <strong>Notatka z weryfikacji</strong>
                <p>{{ currentAnonymizationRequest.review_note }}</p>
              </div>
            </div>

            <ol class="client-privacy-timeline" aria-label="Etapy żądania anonimizacji">
              <li class="client-privacy-timeline__item client-privacy-timeline__item--done">
                <span><UIcon name="i-lucide-check" /></span>
                <div>
                  <strong>Żądanie otrzymane</strong>
                  <small>{{ formatDateTime(currentAnonymizationRequest.requested_at) }}</small>
                </div>
              </li>
              <li
                class="client-privacy-timeline__item"
                :class="{ 'client-privacy-timeline__item--done': currentAnonymizationRequest.identity_verified_at }"
              >
                <span><UIcon name="i-lucide-check" /></span>
                <div>
                  <strong>Tożsamość zweryfikowana</strong>
                  <small>{{ formatDateTime(currentAnonymizationRequest.identity_verified_at, 'Oczekuje') }}</small>
                </div>
              </li>
              <li
                class="client-privacy-timeline__item"
                :class="{ 'client-privacy-timeline__item--done': currentAnonymizationRequest.approved_at }"
              >
                <span><UIcon name="i-lucide-check" /></span>
                <div>
                  <strong>Zakres zatwierdzony</strong>
                  <small>{{ formatDateTime(currentAnonymizationRequest.approved_at, 'Oczekuje') }}</small>
                </div>
              </li>
              <li
                class="client-privacy-timeline__item"
                :class="{ 'client-privacy-timeline__item--done': currentAnonymizationRequest.completed_at }"
              >
                <span><UIcon :name="currentAnonymizationRequest.completed_at ? 'i-lucide-check' : 'i-lucide-lock-keyhole'" /></span>
                <div>
                  <strong>Anonimizacja danych</strong>
                  <small v-if="currentAnonymizationRequest.completed_at">
                    {{ formatDateTime(currentAnonymizationRequest.completed_at) }}
                  </small>
                  <small v-else-if="currentAnonymizationRequest.status === 'approved'">
                    Oczekuje na uprawnionego wykonawcę
                  </small>
                  <small
                    v-else-if="['rejected', 'cancelled'].includes(currentAnonymizationRequest.status)"
                  >
                    Nie wykonano
                  </small>
                  <small v-else>
                    Oczekuje na weryfikację i zatwierdzenie
                  </small>
                </div>
              </li>
            </ol>
          </section>

          <aside class="client-privacy-sidebar">
            <section class="client-panel client-privacy-execution" aria-labelledby="privacy-execution-title">
              <header class="client-panel__header">
                <div>
                  <p>Operacja wysokiego ryzyka</p>
                  <h2 id="privacy-execution-title">Wykonanie anonimizacji</h2>
                </div>
                <span class="client-privacy-execution__icon">
                  <UIcon name="i-lucide-lock-keyhole" />
                </span>
              </header>

              <UAlert
                v-if="currentAnonymizationRequest.completed_at"
                color="neutral"
                variant="subtle"
                icon="i-lucide-shield-check"
                title="Anonimizacja zakończona"
                :description="`Dane zanonimizowano ${formatDateTime(currentAnonymizationRequest.completed_at)}. Jednorazowy grant został zużyty i nie można wykonać operacji ponownie.`"
              />

              <UAlert
                v-else-if="['rejected', 'cancelled'].includes(currentAnonymizationRequest.status)"
                color="neutral"
                variant="subtle"
                icon="i-lucide-shield-x"
                title="Proces zakończony bez anonimizacji"
                description="To żądanie nie może zostać wykonane. Jeśli klient złoży nowe żądanie, zarejestruj osobny proces."
              />

              <UAlert
                v-else-if="currentAnonymizationRequest.status !== 'approved'"
                color="warning"
                variant="subtle"
                icon="i-lucide-hourglass"
                title="Żądanie nie jest jeszcze zatwierdzone"
                description="Przed nadaniem jednorazowego grantu trzeba potwierdzić tożsamość osoby oraz zatwierdzić zakres anonimizacji."
              />

              <template v-else>
                <ul class="client-execution-checks">
                  <li class="client-execution-checks__item--ok">
                    <UIcon name="i-lucide-circle-check" />
                    <span>Żądanie zweryfikowane i zatwierdzone</span>
                  </li>
                  <li class="client-execution-checks__item--ok">
                    <UIcon name="i-lucide-circle-check" />
                    <span>Klient i termin realizacji potwierdzone</span>
                  </li>
                  <li :class="{ 'client-execution-checks__item--ok': data.privacy_access.can_execute_anonymization }">
                    <UIcon :name="data.privacy_access.can_execute_anonymization ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" />
                    <span>
                      {{ data.privacy_access.can_execute_anonymization
                        ? 'Jednorazowy grant jest aktywny'
                        : `Brak aktywnego grantu ${data.privacy_access.execute_permission_key}` }}
                    </span>
                  </li>
                </ul>

                <UAlert
                  :color="data.privacy_access.can_execute_anonymization ? 'success' : 'warning'"
                  variant="subtle"
                  :icon="data.privacy_access.can_execute_anonymization ? 'i-lucide-shield-check' : 'i-lucide-key-round'"
                  :title="data.privacy_access.can_execute_anonymization ? 'Możesz wykonać anonimizację' : 'Wymagany jednorazowy grant'"
                  :description="data.privacy_access.execution_grant
                    ? `Grant zatwierdzony przez drugą osobę wygasa ${formatDateTime(data.privacy_access.execution_grant.expires_at)}.`
                    : 'Grant musi wskazywać to żądanie i klienta, mieć krótki termin ważności oraz zatwierdzenie drugiej osoby.'"
                />

                <UButton
                  block
                  color="error"
                  :variant="data.privacy_access.can_execute_anonymization ? 'solid' : 'soft'"
                  icon="i-lucide-shield-alert"
                  @click="anonymizationExecutionOpen = true"
                >
                  Anonimizuj dane klienta
                </UButton>
              </template>
            </section>

            <section class="client-panel client-privacy-retention">
              <span><UIcon name="i-lucide-database-zap" /></span>
              <div>
                <strong>Anonimizacja, nie zwykłe usunięcie</strong>
                <p>Proces usuwa dane identyfikujące z całego grafu klienta, zachowując wyłącznie informacje wymagane przepisami i ślad audytowy.</p>
              </div>
            </section>
          </aside>
        </div>

        <OeEmptyState
          v-else
          kind="success"
          icon="i-lucide-shield-check"
          title="Brak aktywnego żądania anonimizacji"
          description="Dla tego klienta nie zarejestrowano procesu usunięcia danych."
          surface="outline"
        >
          <template #actions>
            <UButton
              v-if="data.privacy_access.can_create_request"
              icon="i-lucide-shield-plus"
              @click="openAnonymizationRequest"
            >
              Zgłoś żądanie anonimizacji
            </UButton>
          </template>
        </OeEmptyState>
      </section>

      <section v-else-if="currentView === 'appointments'" class="client-workspace" aria-labelledby="client-appointments-title">
        <header class="workspace-heading">
          <div>
            <p>Kalendarz relacji</p>
            <h2 id="client-appointments-title">Wizyty klienta</h2>
            <span>Spotkania w placówkach i z przypisanymi ekspertami.</span>
          </div>
          <UBadge color="neutral" variant="outline">{{ data.appointment_count }} wizyt</UBadge>
        </header>

        <div v-if="data.appointments.length" class="client-appointment-list">
          <article v-for="appointment in data.appointments" :key="appointment.id" class="client-appointment-row">
            <time :datetime="appointment.starts_at" class="client-appointment-row__date">
              <strong>{{ appointmentDay(appointment.starts_at) }}</strong>
              <span>{{ appointmentMonth(appointment.starts_at) }}</span>
            </time>
            <div class="client-appointment-row__body">
              <strong>{{ appointment.serviceName || 'Spotkanie' }}</strong>
              <span>
                {{ appointmentTime(appointment.starts_at) }}
                · {{ appointment.meeting_mode === 'online'
                  ? 'Online'
                  : appointment.facilityName || 'Placówka nieokreślona' }}
              </span>
            </div>
            <div class="client-appointment-row__expert">
              <UIcon name="i-lucide-user-round" />
              <span>{{ appointment.expertName || 'Ekspert nieprzypisany' }}</span>
            </div>
            <UBadge :color="appointmentStatusMeta(appointment.status).color" variant="subtle">
              {{ appointmentStatusMeta(appointment.status).label }}
            </UBadge>
          </article>
        </div>

        <OeEmptyState
          v-else
          icon="i-lucide-calendar-plus"
          title="Brak wizyt klienta"
          description="Umówione spotkania pojawią się tutaj wraz z miejscem, ekspertem i statusem."
          surface="outline"
        >
          <template #actions>
            <UButton :to="orgPath('/calendar')" color="neutral" variant="outline" icon="i-lucide-calendar-days">
              Otwórz kalendarz
            </UButton>
          </template>
        </OeEmptyState>
      </section>

      <section v-else class="client-history-layout" aria-labelledby="client-history-title">
        <div class="client-workspace">
          <header class="workspace-heading">
            <div>
              <p>Pełny ślad obsługi</p>
              <h2 id="client-history-title">Historia klienta</h2>
              <span>Zmiany w CRM, powiązane sprawy oraz decyzje dotyczące zgód.</span>
            </div>
            <UBadge color="neutral" variant="outline">{{ historyItems.length }} zdarzenia</UBadge>
          </header>

          <ol v-if="historyItems.length" class="client-timeline">
            <li v-for="item in historyItems" :key="item.id" :class="`client-timeline__item client-timeline__item--${item.tone}`">
              <span class="client-timeline__marker"><UIcon :name="item.icon" /></span>
              <article>
                <header>
                  <div>
                    <small>{{ item.category }}</small>
                    <strong>{{ item.title }}</strong>
                  </div>
                  <time :datetime="item.date">{{ formatDateTime(item.date) }}</time>
                </header>
                <p>{{ item.description }}</p>
                <footer><UIcon name="i-lucide-user-round" /> {{ item.meta }}</footer>
              </article>
            </li>
          </ol>

          <OeEmptyState
            v-else
            icon="i-lucide-history"
            title="Historia jest jeszcze pusta"
            description="Pierwsze zmiany danych, sprawy i decyzje zgód utworzą tutaj chronologiczny feed."
            surface="outline"
          />
        </div>

        <aside class="client-history-summary">
          <section class="client-panel">
            <header class="client-panel__header">
              <div>
                <p>Zakres historii</p>
                <h2>Źródła zdarzeń</h2>
              </div>
            </header>
            <dl>
              <div>
                <dt><UIcon name="i-lucide-activity" /> Aktywność CRM</dt>
                <dd>{{ data.activity_count }}</dd>
              </div>
              <div>
                <dt><UIcon name="i-lucide-shield-check" /> Decyzje zgód</dt>
                <dd>{{ data.consent_history_count }}</dd>
              </div>
              <div>
                <dt><UIcon name="i-lucide-briefcase-business" /> Powiązane sprawy</dt>
                <dd>{{ data.summary.cases_count }}</dd>
              </div>
            </dl>
          </section>

          <section class="client-panel client-history-start">
            <span><UIcon name="i-lucide-calendar-clock" /></span>
            <div>
              <small>Początek historii</small>
              <strong>{{ oldestHistoryItem ? formatDateTime(oldestHistoryItem.date) : formatDateTime(data.data.created_at) }}</strong>
            </div>
          </section>
        </aside>
      </section>
    </template>

    <UModal
      v-model:open="anonymizationRequestOpen"
      title="Zgłoś żądanie anonimizacji"
      description="Zarejestruj otrzymane żądanie klienta i rozpocznij kontrolowany proces jego obsługi."
      :dismissible="!savingAnonymizationRequest"
      :ui="{
        content: 'sm:max-w-xl',
        header: 'shrink-0',
        body: 'min-h-0 overflow-y-auto',
        footer: 'shrink-0 justify-end',
      }"
      @after:leave="resetAnonymizationRequestForm"
    >
      <template #body>
        <UForm
          id="client-anonymization-request-form"
          :schema="anonymizationRequestSchema"
          :state="anonymizationRequestForm"
          class="client-modal-form"
          @submit="createAnonymizationRequest"
        >
          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="To zgłoszenie nie usuwa danych"
            description="Powstanie formalne żądanie ze statusem „Otrzymane”. Tożsamość, zakres i podstawa prawna muszą zostać zweryfikowane przed anonimizacją."
          />

          <UFormField
            name="subjectPersonId"
            label="Osoba, której dane dotyczą"
            description="Wskaż osobę, od której otrzymano żądanie."
            required
          >
            <USelect
              v-model="anonymizationRequestForm.subjectPersonId"
              class="w-full"
              :items="anonymizationRequestSubjectItems"
              value-key="value"
              label-key="label"
              :disabled="savingAnonymizationRequest"
              placeholder="Wybierz osobę"
            />
          </UFormField>

          <div class="client-modal-form__grid">
            <UFormField
              name="requestChannel"
              label="Kanał zgłoszenia"
              required
            >
              <USelect
                v-model="anonymizationRequestForm.requestChannel"
                class="w-full"
                :items="anonymizationRequestChannelItems"
                value-key="value"
                label-key="label"
                :disabled="savingAnonymizationRequest"
              />
            </UFormField>

            <UFormField
              name="requestedAt"
              label="Data otrzymania"
              description="Od tej daty zostanie wyliczony miesięczny termin."
              required
            >
              <UInput
                v-model="anonymizationRequestForm.requestedAt"
                class="w-full"
                type="datetime-local"
                :max="localDateTimeValue()"
                :disabled="savingAnonymizationRequest"
              />
            </UFormField>
          </div>

          <UFormField
            name="justification"
            label="Opis żądania"
            description="Zapisz treść i kontekst żądania bez kopiowania zbędnych danych osobowych."
            required
          >
            <UTextarea
              v-model="anonymizationRequestForm.justification"
              class="w-full"
              :rows="5"
              autoresize
              :maxrows="9"
              :maxlength="2000"
              :disabled="savingAnonymizationRequest"
              placeholder="Np. klient zażądał usunięcia danych po zakończeniu obsługi..."
            />
          </UFormField>

          <div class="client-anonymization-request-basis">
            <UIcon name="i-lucide-scale" />
            <div>
              <small>Podstawa procesu</small>
              <strong>RODO art. 17 · prawo do usunięcia danych</strong>
            </div>
          </div>
        </UForm>
      </template>

      <template #footer="{ close }">
        <UButton
          color="neutral"
          variant="outline"
          :disabled="savingAnonymizationRequest"
          @click="close"
        >
          Anuluj
        </UButton>
        <UButton
          type="submit"
          form="client-anonymization-request-form"
          icon="i-lucide-send"
          :loading="savingAnonymizationRequest"
        >
          Zgłoś żądanie
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="anonymizationExecutionOpen"
      title="Anonimizacja danych klienta"
      description="Operacja jest nieodwracalna i wymaga jednorazowego dostępu do konkretnego żądania."
      :dismissible="!executingAnonymization"
      :ui="{ footer: 'justify-end' }"
      @after:leave="!executingAnonymization && (anonymizationExecutionConfirmation = '')"
    >
      <template #body>
        <div v-if="currentAnonymizationRequest" class="client-anonymization-gate">
          <div class="client-anonymization-gate__request">
            <span><UIcon name="i-lucide-file-lock-2" /></span>
            <div>
              <small>Zweryfikowane żądanie</small>
              <strong>{{ currentAnonymizationRequest.request_number }}</strong>
              <p>{{ data.data.display_name }} · termin {{ formatShortDate(currentAnonymizationRequest.due_at) }}</p>
            </div>
          </div>

          <template v-if="data.privacy_access.can_execute_anonymization && data.privacy_access.execution_grant">
            <UAlert
              color="error"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="Tej operacji nie można cofnąć"
              description="Dane identyfikujące zostaną usunięte z rekordu klienta i powiązanych danych operacyjnych. Identyfikatory techniczne, wymagane fakty rozliczeniowe i ślad audytowy pozostaną."
            />

            <div class="client-anonymization-confirmation">
              <div>
                <strong>Potwierdź świadome wykonanie</strong>
                <p>
                  Grant jest jednorazowy i wygaśnie
                  {{ formatDateTime(data.privacy_access.execution_grant.expires_at) }}.
                  Wpisz <code>ANONIMIZUJ</code>.
                </p>
              </div>
              <UInput
                v-model="anonymizationExecutionConfirmation"
                class="w-full"
                autocomplete="off"
                :disabled="executingAnonymization"
                placeholder="ANONIMIZUJ"
              />
            </div>
          </template>

          <template v-else>
            <UAlert
              color="warning"
              variant="subtle"
              icon="i-lucide-lock-keyhole"
              title="Wykonanie jest zablokowane"
              :description="`Brak aktywnego grantu ${data.privacy_access.execute_permission_key} przypisanego do tego klienta i żądania.`"
            />

            <ol class="client-anonymization-gate__steps">
              <li>
                <span>1</span>
                <p>Nadaj wybranemu pracownikowi jednorazowy grant na karcie użytkownika.</p>
              </li>
              <li>
                <span>2</span>
                <p>Druga uprawniona osoba zatwierdza grant, który wygasa najpóźniej po 24 godzinach.</p>
              </li>
              <li>
                <span>3</span>
                <p>Wykonawca wraca tutaj, przegląda zakres retencji i potwierdza operację.</p>
              </li>
            </ol>
          </template>
        </div>
      </template>
      <template #footer="{ close }">
        <UButton
          color="neutral"
          variant="outline"
          :disabled="executingAnonymization"
          @click="close"
        >
          Anuluj
        </UButton>
        <UButton
          v-if="data.privacy_access.can_execute_anonymization"
          color="error"
          icon="i-lucide-shield-alert"
          :loading="executingAnonymization"
          :disabled="anonymizationExecutionConfirmation.trim() !== 'ANONIMIZUJ'"
          @click="executeAnonymization"
        >
          Anonimizuj nieodwracalnie
        </UButton>
        <UButton
          v-else
          :to="orgPath('/users')"
          color="neutral"
          icon="i-lucide-users"
        >
          Przejdź do użytkowników
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="createCaseOpen"
      title="Nowa sprawa"
      description="Klient zostanie przypisany do sprawy automatycznie."
      :dismissible="!savingCase"
      :ui="{ footer: 'justify-end' }"
      @after:leave="!savingCase && (caseForm.title = '')"
    >
      <template #body>
        <form id="client-create-case-form" class="client-modal-form" @submit.prevent="createCase">
          <UFormField label="Nazwa sprawy" required>
            <UInput
              v-model="caseForm.title"
              class="w-full"
              autofocus
              :maxlength="200"
              placeholder="Zakup mieszkania — Kowalscy"
            />
          </UFormField>
          <div class="client-case-assignment">
            <span>{{ clientInitials }}</span>
            <div>
              <strong>{{ data.data.display_name }}</strong>
              <small>Zostanie dodany jako klient główny</small>
            </div>
            <UIcon name="i-lucide-circle-check" />
          </div>
        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="savingCase" @click="close">Anuluj</UButton>
        <UButton
          type="submit"
          form="client-create-case-form"
          icon="i-lucide-folder-plus"
          :loading="savingCase"
          :disabled="!caseForm.title.trim()"
        >
          Utwórz sprawę
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="editOpen"
      title="Edytuj dane klienta"
      description="Zmień dane używane w sprawach, wizytach i bieżącej komunikacji."
      :dismissible="!savingClient"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <form id="client-edit-form" class="client-modal-form" @submit.prevent="saveClient">
          <UFormField label="Nazwa klienta" required>
            <UInput v-model="editForm.display_name" class="w-full" :maxlength="200" />
          </UFormField>
          <div class="client-modal-form__grid">
            <UFormField label="E-mail">
              <UInput v-model="editForm.primary_email" class="w-full" type="email" icon="i-lucide-mail" />
            </UFormField>
            <UFormField label="Telefon">
              <UInput v-model="editForm.primary_phone" class="w-full" icon="i-lucide-phone" />
            </UFormField>
          </div>
          <UFormField label="Tagi" description="Oddziel tagi przecinkami.">
            <UInput v-model="editForm.tags" class="w-full" icon="i-lucide-tags" placeholder="premium, polecenie" />
          </UFormField>
          <UFormField label="Notatka">
            <UTextarea v-model="editForm.notes" class="w-full" :rows="4" autoresize :maxrows="8" />
          </UFormField>
        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="savingClient" @click="close">Anuluj</UButton>
        <UButton
          type="submit"
          form="client-edit-form"
          icon="i-lucide-save"
          :loading="savingClient"
          :disabled="!editForm.display_name.trim()"
        >
          Zapisz zmiany
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.client-header-meta,
.client-header-meta > span,
.client-metric,
.client-panel__header,
.client-profile,
.client-data-list dt,
.related-people article,
.recent-activity article,
.client-case-row,
.client-case-row__facts,
.client-appointment-row,
.client-appointment-row__expert,
.client-timeline__item article > header,
.client-timeline__item article > footer,
.client-history-summary dl div,
.client-history-start,
.client-case-assignment,
.workspace-heading__actions,
.client-anonymization-request-basis {
  display: flex;
  align-items: center;
}

.client-header-meta {
  flex-wrap: wrap;
  gap: 10px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.client-header-meta > span {
  gap: 4px;
}

.client-header-meta strong {
  color: var(--ui-text-toned);
  font-weight: 600;
}

.client-header-meta__separator {
  width: 1px;
  height: 14px;
  background: var(--ui-border);
}

.client-loading,
.client-panel-stack,
.client-modal-form {
  display: grid;
  gap: 18px;
}

.client-loading__metrics,
.client-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.client-loading__body {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, .75fr);
  gap: 18px;
}

.client-overview {
  display: grid;
  gap: 18px;
}

.client-metric,
.client-panel,
.client-workspace {
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.client-metric {
  position: relative;
  gap: 12px;
  min-width: 0;
  min-height: 104px;
  padding: 18px;
  border-radius: var(--ui-radius);
}

.client-metric__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  border-radius: 10px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
}

.client-metric__icon svg {
  width: 18px;
  height: 18px;
}

.client-metric > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.client-metric strong {
  color: var(--ui-text-highlighted);
  font-size: 24px;
  font-weight: 650;
  line-height: 1;
}

.client-metric span {
  color: var(--ui-text-toned);
  font-size: 12px;
}

.client-metric small {
  position: absolute;
  right: 14px;
  bottom: 12px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-overview__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, .75fr);
  align-items: start;
  gap: 18px;
}

.client-panel {
  min-width: 0;
  padding: 22px;
  border-radius: var(--ui-radius);
}

.client-panel__header,
.workspace-heading {
  justify-content: space-between;
  gap: 18px;
}

.client-panel__header {
  margin-bottom: 20px;
}

.client-panel__header > div,
.workspace-heading > div {
  min-width: 0;
}

.client-panel__header p,
.workspace-heading p {
  margin: 0 0 4px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.client-panel__header h2,
.workspace-heading h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.workspace-heading h2 {
  font-size: 22px;
}

.workspace-heading > div:first-child > span {
  display: block;
  margin-top: 5px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.workspace-heading__actions {
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.client-profile {
  gap: 14px;
  padding: 0 0 20px;
  border-bottom: 1px solid var(--ui-border);
}

.client-avatar {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  border-radius: 14px;
  color: var(--ui-text-inverted);
  background: var(--ui-bg-inverted);
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 650;
}

.client-profile__identity {
  display: grid;
  gap: 2px;
}

.client-profile__identity strong {
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 650;
}

.client-profile__identity span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.client-data-list,
.client-context-list,
.client-history-summary dl {
  display: grid;
  gap: 0;
  margin: 0;
}

.client-data-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
}

.client-data-list > div,
.client-context-list > div {
  display: grid;
  gap: 7px;
  padding: 16px 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.client-data-list > div:nth-last-child(-n + 2) {
  border-bottom: 0;
  padding-bottom: 0;
}

.client-data-list dt,
.client-context-list dt {
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.client-data-list dt svg {
  width: 14px;
  height: 14px;
}

.client-data-list dd,
.client-context-list dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 550;
}

.client-data-list a {
  color: inherit;
  text-decoration: none;
}

.client-data-list a:hover {
  text-decoration: underline;
}

.client-portal-account-status {
  display: grid;
  justify-items: start;
  gap: 6px;
}

.client-portal-account-status small {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 450;
}

.related-people,
.recent-activity {
  display: grid;
}

.related-people article {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.related-people article:first-child {
  padding-top: 0;
}

.related-people article:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.related-people article > span,
.recent-activity article > span {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
}

.related-people article > div,
.recent-activity article > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.related-people strong,
.recent-activity strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 600;
}

.related-people small,
.recent-activity small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.related-people article > p {
  max-width: 240px;
  margin: 0;
  overflow: hidden;
  color: var(--ui-text-toned);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-context-list > div {
  grid-template-columns: 82px minmax(0, 1fr);
  align-items: start;
}

.client-context-list > div:first-child {
  padding-top: 0;
}

.client-context-list > div:last-child {
  border-bottom: 0;
}

.client-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.client-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: 12px;
  padding: 13px;
  border-radius: 10px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
}

.client-note > span {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
}

.client-note p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
}

.recent-activity article {
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.recent-activity article:first-child {
  padding-top: 0;
}

.recent-activity article:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.client-privacy-preview__status,
.client-privacy-request__hero,
.client-privacy-request__note,
.client-privacy-retention,
.client-anonymization-gate__request,
.client-anonymization-gate__steps li {
  display: flex;
  align-items: flex-start;
}

.client-privacy-preview__status {
  align-items: center;
  gap: 11px;
}

.client-privacy-preview__status > span,
.client-privacy-request__hero > span,
.client-privacy-execution__icon,
.client-privacy-retention > span,
.client-anonymization-gate__request > span {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 11px;
  color: var(--ui-warning);
  background: color-mix(in srgb, var(--ui-warning) 10%, var(--ui-bg-elevated));
}

.client-privacy-preview__status > span {
  width: 40px;
  height: 40px;
}

.client-privacy-preview__status > div {
  display: grid;
  gap: 2px;
}

.client-privacy-preview__status strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.client-privacy-preview__status small {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.client-privacy-preview__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border-muted);
}

.client-privacy-preview__facts > div {
  display: grid;
  gap: 3px;
}

.client-privacy-preview__facts dt {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-privacy-preview__facts dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 600;
}

.client-workspace {
  min-height: 360px;
  padding: 26px;
  border-radius: var(--ui-radius);
}

.workspace-heading {
  display: flex;
  align-items: flex-start;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--ui-border);
}

.client-case-list,
.client-appointment-list {
  display: grid;
}

.client-case-row {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto 20px;
  gap: 14px;
  min-height: 78px;
  padding: 14px 8px;
  border-bottom: 1px solid var(--ui-border-muted);
  color: inherit;
  text-decoration: none;
}

.client-case-row:first-child {
  padding-top: 2px;
}

.client-case-row:last-child {
  border-bottom: 0;
}

.client-case-row:hover .client-case-row__title strong,
.client-case-row:hover .client-case-row__arrow {
  color: var(--ui-primary);
}

.client-case-row__icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 11px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
}

.client-case-row__title {
  display: grid;
  gap: 4px;
}

.client-case-row__title strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
  transition: color var(--oe-motion-fast);
}

.client-case-row__title span,
.client-case-row__facts span {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.client-case-row__facts {
  justify-content: flex-end;
  gap: 16px;
}

.client-case-row__facts > span {
  display: flex;
  align-items: center;
  gap: 5px;
}

.client-case-row__arrow {
  color: var(--ui-text-muted);
  transition: color var(--oe-motion-fast);
}

.client-consent-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.client-consent-capture-note {
  margin-bottom: 2px;
}

.client-consent-card {
  display: grid;
  gap: 16px;
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.client-consent-card header {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.client-consent-card__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
}

.client-consent-card header > div {
  display: grid;
  gap: 3px;
}

.client-consent-card strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.client-consent-card small,
.client-consent-card footer {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-consent-card > p {
  display: -webkit-box;
  min-height: 38px;
  margin: 0;
  overflow: hidden;
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.client-consent-card__request {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 11px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 10px;
  background: var(--ui-bg);
}

.client-consent-card__request > div {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.client-consent-card__request > div > .iconify {
  flex: 0 0 auto;
  color: var(--ui-primary);
}

.client-consent-card__request span {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.client-consent-card__request strong,
.client-consent-card__request small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.client-consent-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border-muted);
}

.client-consent-card footer > div {
  display: grid;
  gap: 3px;
}

.client-privacy-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(310px, .65fr);
  align-items: start;
  gap: 14px;
}

.client-privacy-request {
  padding: 24px;
}

.client-privacy-request__hero {
  gap: 14px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--ui-success) 26%, var(--ui-border));
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-success) 6%, var(--ui-bg-muted));
}

.client-privacy-request__hero > span {
  width: 42px;
  height: 42px;
  color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-success) 12%, var(--ui-bg-elevated));
}

.client-privacy-request__hero > div {
  display: grid;
  gap: 4px;
}

.client-privacy-request__hero strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.client-privacy-request__hero p,
.client-privacy-request__note p,
.client-privacy-retention p,
.client-anonymization-gate__request p,
.client-anonymization-gate__steps p {
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 11px;
  line-height: 1.55;
}

.client-privacy-request__details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 18px 0 0;
  border-top: 1px solid var(--ui-border-muted);
  border-left: 1px solid var(--ui-border-muted);
}

.client-privacy-request__details > div {
  display: grid;
  gap: 5px;
  padding: 14px;
  border-right: 1px solid var(--ui-border-muted);
  border-bottom: 1px solid var(--ui-border-muted);
}

.client-privacy-request__details dt {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-privacy-request__details dd {
  display: grid;
  gap: 2px;
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 600;
}

.client-privacy-request__details dd small {
  color: var(--ui-text-muted);
  font-size: 9px;
  font-weight: 400;
}

.client-privacy-request__note {
  gap: 10px;
  margin-top: 16px;
  padding: 13px;
  border-radius: 11px;
  background: var(--ui-bg-elevated);
}

.client-privacy-request__note > svg {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
}

.client-privacy-request__note > div {
  display: grid;
  gap: 3px;
}

.client-privacy-request__note strong,
.client-privacy-retention strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
}

.client-privacy-timeline {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0;
  margin: 22px 0 0;
  padding: 0;
  list-style: none;
}

.client-privacy-timeline__item {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 8px;
  min-width: 0;
  text-align: center;
}

.client-privacy-timeline__item::before {
  position: absolute;
  top: 15px;
  left: 0;
  width: 100%;
  height: 1px;
  background: var(--ui-border);
  content: "";
}

.client-privacy-timeline__item:first-child::before {
  left: 50%;
  width: 50%;
}

.client-privacy-timeline__item:last-child::before {
  width: 50%;
}

.client-privacy-timeline__item > span {
  z-index: 1;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  color: var(--ui-text-muted);
  background: var(--ui-bg);
}

.client-privacy-timeline__item--done > span {
  border-color: color-mix(in srgb, var(--ui-success) 42%, var(--ui-border));
  color: var(--ui-success);
}

.client-privacy-timeline__item > div {
  display: grid;
  gap: 3px;
}

.client-privacy-timeline__item strong {
  color: var(--ui-text-highlighted);
  font-size: 10px;
  font-weight: 600;
}

.client-privacy-timeline__item small {
  color: var(--ui-text-muted);
  font-size: 8px;
  line-height: 1.4;
}

.client-privacy-sidebar {
  display: grid;
  gap: 12px;
}

.client-privacy-execution {
  display: grid;
  gap: 15px;
}

.client-privacy-execution .client-panel__header {
  margin-bottom: 0;
}

.client-privacy-execution__icon {
  width: 38px;
  height: 38px;
}

.client-execution-checks {
  display: grid;
  gap: 9px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.client-execution-checks li {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  color: var(--ui-warning);
  font-size: 10px;
  line-height: 1.5;
}

.client-execution-checks__item--ok {
  color: var(--ui-success) !important;
}

.client-execution-checks li span {
  color: var(--ui-text-toned);
}

.client-execution-checks code {
  color: var(--ui-text-highlighted);
  font-size: 9px;
}

.client-privacy-retention {
  gap: 11px;
}

.client-privacy-retention > span {
  width: 38px;
  height: 38px;
}

.client-privacy-retention > div {
  display: grid;
  gap: 4px;
}

.client-anonymization-gate {
  display: grid;
  gap: 16px;
}

.client-anonymization-gate__request {
  gap: 11px;
  padding: 13px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 11px;
  background: var(--ui-bg-muted);
}

.client-anonymization-gate__request > span {
  width: 38px;
  height: 38px;
}

.client-anonymization-gate__request > div {
  display: grid;
  gap: 2px;
}

.client-anonymization-gate__request small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.client-anonymization-gate__request strong {
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.client-anonymization-confirmation {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--ui-error) 34%, var(--ui-border));
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-error) 5%, var(--ui-bg));
}

.client-anonymization-confirmation > div {
  display: grid;
  gap: 4px;
}

.client-anonymization-confirmation strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.client-anonymization-confirmation p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.55;
}

.client-anonymization-confirmation code {
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.client-anonymization-gate__steps {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.client-anonymization-gate__steps li {
  gap: 10px;
}

.client-anonymization-gate__steps li > span {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  border-radius: 999px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
  font-family: var(--font-mono);
  font-size: 9px;
}

.client-appointment-row {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) minmax(180px, auto) auto;
  gap: 16px;
  min-height: 84px;
  padding: 14px 8px;
  border-bottom: 1px solid var(--ui-border-muted);
}

.client-appointment-row:last-child {
  border-bottom: 0;
}

.client-appointment-row__date {
  display: grid;
  place-items: center;
  align-content: center;
  width: 52px;
  height: 52px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  text-transform: uppercase;
}

.client-appointment-row__date strong {
  color: var(--ui-text-highlighted);
  font-size: 17px;
  line-height: 1;
}

.client-appointment-row__date span {
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.client-appointment-row__body {
  display: grid;
  gap: 4px;
}

.client-appointment-row__body strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.client-appointment-row__body span,
.client-appointment-row__expert {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.client-appointment-row__expert {
  gap: 7px;
}

.client-history-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  align-items: start;
  gap: 18px;
}

.client-history-summary {
  display: grid;
  gap: 12px;
}

.client-history-summary dl div {
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--ui-border-muted);
}

.client-history-summary dl div:first-child {
  padding-top: 0;
}

.client-history-summary dl div:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.client-history-summary dt {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.client-history-summary dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 12px;
}

.client-history-start {
  gap: 12px;
}

.client-history-start > span {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  border-radius: 10px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
}

.client-history-start > div {
  display: grid;
  gap: 3px;
}

.client-history-start small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-history-start strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 600;
}

.client-timeline {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.client-timeline__item {
  position: relative;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 14px;
  min-width: 0;
  padding-bottom: 22px;
}

.client-timeline__item::before {
  position: absolute;
  top: 40px;
  bottom: 0;
  left: 19px;
  width: 1px;
  background: var(--ui-border);
  content: "";
}

.client-timeline__item:last-child {
  padding-bottom: 0;
}

.client-timeline__item:last-child::before {
  display: none;
}

.client-timeline__marker {
  z-index: 1;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
}

.client-timeline__item--success .client-timeline__marker {
  color: var(--ui-success);
}

.client-timeline__item--warning .client-timeline__marker {
  color: var(--ui-warning);
}

.client-timeline__item--error .client-timeline__marker {
  color: var(--ui-error);
}

.client-timeline__item article {
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.client-timeline__item article > header {
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.client-timeline__item article > header > div {
  display: grid;
  gap: 3px;
}

.client-timeline__item article small {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.client-timeline__item article strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.client-timeline__item time {
  color: var(--ui-text-muted);
  font-size: 10px;
  white-space: nowrap;
}

.client-timeline__item article > p {
  margin: 9px 0 12px;
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 1.5;
}

.client-timeline__item article > footer {
  gap: 5px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-empty {
  color: var(--ui-text-muted);
}

.client-empty--compact {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 48px;
  font-size: 12px;
}

.client-empty--workspace {
  display: grid;
  place-items: center;
  min-height: 260px;
  text-align: center;
}

.client-empty--workspace > span {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 12px;
  border-radius: 14px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
}

.client-empty--workspace h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 650;
}

.client-empty--workspace p {
  max-width: 420px;
  margin: 6px 0 16px;
  font-size: 12px;
  line-height: 1.5;
}

.client-modal-form {
  gap: 16px;
}

.client-modal-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.client-anonymization-request-basis {
  gap: 11px;
  padding: 13px 14px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 11px;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
}

.client-anonymization-request-basis > svg {
  flex: 0 0 auto;
}

.client-anonymization-request-basis > div {
  display: grid;
  gap: 2px;
}

.client-anonymization-request-basis small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-anonymization-request-basis strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.client-case-assignment {
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 10px;
  background: var(--ui-bg-muted);
}

.client-case-assignment > span {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border-radius: 10px;
  color: var(--ui-text-inverted);
  background: var(--ui-bg-inverted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.client-case-assignment > div {
  display: grid;
  flex: 1;
  gap: 2px;
}

.client-case-assignment strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 600;
}

.client-case-assignment small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.client-case-assignment > svg {
  color: var(--ui-success);
}

@media (max-width: 1180px) {
  .client-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .client-overview__grid,
  .client-loading__body,
  .client-history-layout,
  .client-privacy-layout {
    grid-template-columns: 1fr;
  }

  .client-history-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 820px) {
  .client-loading__metrics,
  .client-metrics,
  .client-consent-grid {
    grid-template-columns: 1fr;
  }

  .client-privacy-timeline {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 0;
  }

  .client-privacy-timeline__item:nth-child(2)::before {
    width: 50%;
  }

  .client-privacy-timeline__item:nth-child(3)::before {
    left: 50%;
    width: 50%;
  }

  .client-data-list {
    grid-template-columns: 1fr;
  }

  .client-data-list > div:nth-last-child(-n + 2) {
    border-bottom: 1px solid var(--ui-border-muted);
    padding-bottom: 16px;
  }

  .client-data-list > div:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }

  .client-case-row {
    grid-template-columns: 42px minmax(0, 1fr) 20px;
  }

  .client-case-row__icon {
    grid-row: 1 / span 2;
  }

  .client-case-row__title {
    grid-column: 2;
    grid-row: 1;
  }

  .client-case-row__facts {
    grid-column: 2;
    grid-row: 2;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 8px 14px;
  }

  .client-case-row__arrow {
    grid-column: 3;
    grid-row: 1 / span 2;
    align-self: center;
  }

  .client-appointment-row {
    grid-template-columns: 58px minmax(0, 1fr) auto;
  }

  .client-appointment-row__date {
    grid-row: 1 / span 2;
  }

  .client-appointment-row__body {
    grid-column: 2;
    grid-row: 1;
  }

  .client-appointment-row__expert {
    display: flex;
    grid-column: 2;
    grid-row: 2;
  }

  .client-appointment-row > :last-child {
    grid-column: 3;
    grid-row: 1 / span 2;
    align-self: center;
  }
}

@media (max-width: 620px) {
  .client-header-meta__separator {
    display: none;
  }

  .client-workspace,
  .client-panel {
    padding: 18px;
  }

  .workspace-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .workspace-heading__actions {
    justify-content: flex-start;
  }

  .client-modal-form__grid {
    grid-template-columns: 1fr;
  }

  .client-appointment-row {
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 10px 12px;
  }

  .client-appointment-row__date {
    grid-row: 1 / span 3;
    width: 48px;
    height: 48px;
  }

  .client-appointment-row > :last-child {
    grid-column: 2;
    grid-row: 3;
    justify-self: start;
  }

  .related-people article {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  .related-people article > p {
    grid-column: 2;
  }

  .client-history-summary,
  .client-modal-form__grid,
  .client-privacy-request__details {
    grid-template-columns: 1fr;
  }

  .client-privacy-timeline {
    grid-template-columns: 1fr;
  }

  .client-privacy-timeline__item {
    grid-template-columns: 30px minmax(0, 1fr);
    justify-items: start;
    text-align: left;
  }

  .client-privacy-timeline__item::before,
  .client-privacy-timeline__item:first-child::before,
  .client-privacy-timeline__item:last-child::before,
  .client-privacy-timeline__item:nth-child(2)::before,
  .client-privacy-timeline__item:nth-child(3)::before {
    top: 30px;
    bottom: -16px;
    left: 14px;
    width: 1px;
    height: auto;
  }

  .client-privacy-timeline__item:last-child::before {
    display: none;
  }

  .client-privacy-timeline__item > div {
    padding-top: 2px;
  }

  .client-timeline__item article > header {
    align-items: flex-start;
    flex-direction: column;
    gap: 7px;
  }

  .client-consent-card header {
    grid-template-columns: 38px minmax(0, 1fr);
  }

  .client-consent-card header > :last-child {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
