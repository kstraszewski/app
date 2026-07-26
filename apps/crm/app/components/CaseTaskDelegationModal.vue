<script setup lang="ts">
import type { PublicBookingSlot } from '~/types/booking'
import type {
  CaseTaskDelegationAccessScope,
  CaseTaskDelegationAppointmentContext,
  CaseTaskDelegationAppointmentOptions,
  CaseTaskDelegationAssignee,
  CaseTaskDelegationCaseSummary,
  CaseTaskDelegationPayload,
  CaseTaskDelegationPriority,
  CaseTaskDelegationRecentAssignee,
} from '~/types/task-delegation-ui'
import {
  addDaysToIsoDate,
  BOOKING_WEEK_DAYS,
  buildBookingWeekDays,
  formatBookingWeekRange,
  isoDateForTimestamp,
} from '~/utils/booking-slots'
import {
  caseTaskDelegationAccessScopeIsRequired,
  normalizeCaseTaskDelegationAccessScope,
} from '~/utils/task-delegation-access'
import BookingWeekPicker from '~/components/booking/BookingWeekPicker.vue'

type DraftErrorKey = 'title' | 'description' | 'assigneeUserId' | 'dueAt' | 'appointmentSlot'
type ScheduleMode = 'appointment' | 'deadline'

interface DelegationDraft {
  title: string
  description: string
  priority: CaseTaskDelegationPriority
  assigneeUserId: string
  dueAt: string
  accessScope: CaseTaskDelegationAccessScope[]
}

const props = withDefaults(defineProps<{
  open: boolean
  caseSummary: CaseTaskDelegationCaseSummary
  recentAssignees?: CaseTaskDelegationRecentAssignee[]
  availableAssignees?: CaseTaskDelegationAssignee[]
  loadingAssignees?: boolean
  assigneesError?: string
  submitting?: boolean
  submitError?: string
  submitted?: boolean
}>(), {
  recentAssignees: () => [],
  availableAssignees: () => [],
  loadingAssignees: false,
  assigneesError: '',
  submitting: false,
  submitError: '',
  submitted: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'submit': [payload: CaseTaskDelegationPayload]
  'retry-assignees': []
}>()

const stepItems = [
  {
    title: 'Zadanie',
    description: 'Co trzeba zrobić',
  },
  {
    title: 'Realizator',
    description: 'Kto przejmuje zadanie',
  },
  {
    title: 'Termin i kontekst',
    description: 'Kiedy i jakie informacje przekazać',
  },
]

const priorityOptions: Array<{
  value: CaseTaskDelegationPriority
  label: string
  description: string
  icon: string
}> = [
  {
    value: 'low',
    label: 'Niski',
    description: 'Może poczekać',
    icon: 'i-lucide-arrow-down',
  },
  {
    value: 'normal',
    label: 'Normalny',
    description: 'Standardowy tok pracy',
    icon: 'i-lucide-minus',
  },
  {
    value: 'high',
    label: 'Wysoki',
    description: 'Wymaga szybkiej reakcji',
    icon: 'i-lucide-arrow-up',
  },
  {
    value: 'urgent',
    label: 'Pilny',
    description: 'Pierwsza kolejność',
    icon: 'i-lucide-siren',
  },
]

const accessOptions: Array<{
  value: CaseTaskDelegationAccessScope
  label: string
  description: string
  icon: string
}> = [
  {
    value: 'case_summary',
    label: 'Podsumowanie sprawy',
    description: 'Nazwa, etap i podstawowy kontekst zadania.',
    icon: 'i-lucide-briefcase-business',
  },
  {
    value: 'client_identity',
    label: 'Dane klientów',
    description: 'Imiona i role osób powiązanych ze sprawą.',
    icon: 'i-lucide-contact',
  },
  {
    value: 'client_contact',
    label: 'Kontakt do klientów',
    description: 'Adresy e-mail i numery telefonów.',
    icon: 'i-lucide-phone',
  },
  {
    value: 'documents',
    label: 'Dokumenty',
    description: 'Pliki oraz stan ich kompletności.',
    icon: 'i-lucide-files',
  },
  {
    value: 'offers',
    label: 'Oferty',
    description: 'Zapisane oferty i ich porównanie.',
    icon: 'i-lucide-landmark',
  },
  {
    value: 'financial_data',
    label: 'Dane finansowe',
    description: 'Kwoty, wyliczenia i parametry finansowania.',
    icon: 'i-lucide-chart-no-axes-combined',
  },
  {
    value: 'activities',
    label: 'Historia i notatki',
    description: 'Dotychczasowe działania oraz ustalenia.',
    icon: 'i-lucide-history',
  },
]

const quickTaskTitles = [
  'Skontaktuj się z klientem',
  'Zweryfikuj dokumenty',
  'Przygotuj propozycję',
]

const activeStep = ref(0)
const assigneeSearch = ref('')
const showSuccess = ref(false)
const errors = reactive<Partial<Record<DraftErrorKey, string>>>({})
const draft = reactive<DelegationDraft>(createInitialDraft())
const { crmApiPath } = useOrganizationContext()
const scheduleMode = ref<ScheduleMode>('appointment')
const appointmentWeekStart = ref('')
const appointmentSelectedDate = ref('')
const appointmentSelectedSlot = ref<PublicBookingSlot | null>(null)
const appointmentContexts = ref<CaseTaskDelegationAppointmentContext[]>([])
const selectedAppointmentContextKey = ref('')
const appointmentOptionsPending = ref(false)
const appointmentOptionsError = ref('')
const appointmentFallbackNotice = ref('')
const appointmentSlotsExpanded = ref(false)
const appointmentPickerOpen = ref(true)
const selectedAppointmentSummary = useTemplateRef<HTMLElement>('selectedAppointmentSummary')
let appointmentOptionsRequestId = 0

const openModel = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value && props.submitting) return
    emit('update:open', value)
  },
})

const stepModel = computed({
  get: () => activeStep.value,
  set: (value: string | number | undefined) => {
    const requestedStep = Number(value)
    if (!Number.isInteger(requestedStep) || requestedStep < 0 || requestedStep > 2) return
    if (requestedStep <= activeStep.value) {
      activeStep.value = requestedStep
      focusCurrentStep()
      return
    }
    if (requestedStep === activeStep.value + 1 && validateStep(activeStep.value)) {
      activeStep.value = requestedStep
      focusCurrentStep()
    }
  },
})

const allAssignees = computed<CaseTaskDelegationAssignee[]>(() => {
  const byUserId = new Map<string, CaseTaskDelegationAssignee>()
  for (const assignee of props.availableAssignees) byUserId.set(assignee.userId, assignee)
  for (const assignee of props.recentAssignees) {
    if (!byUserId.has(assignee.userId)) byUserId.set(assignee.userId, assignee)
  }
  return [...byUserId.values()]
})

const selectedAssignee = computed<CaseTaskDelegationAssignee | null>(() => (
  allAssignees.value.find(assignee => assignee.userId === draft.assigneeUserId) ?? null
))

const minimumAppointmentDate = computed<string>(() => (
  toLocalDateTime(new Date()).slice(0, 10)
))

const appointmentContextItems = computed(() => appointmentContexts.value.map(context => ({
  label: `${context.serviceName} · ${context.facilityName}`,
  value: appointmentContextKey(context),
})))

const selectedAppointmentContext = computed<CaseTaskDelegationAppointmentContext | null>(() => (
  appointmentContexts.value.find(context => (
    appointmentContextKey(context) === selectedAppointmentContextKey.value
  )) ?? null
))

const appointmentSlots = computed<PublicBookingSlot[]>(() => {
  const assignee = selectedAssignee.value
  return (selectedAppointmentContext.value?.slots ?? []).map(slot => ({
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    expertUserId: draft.assigneeUserId,
    expertName: assignee ? assigneeName(assignee) : 'Realizator',
  }))
})

const appointmentTimezone = computed<string>(() => (
  selectedAppointmentContext.value?.timezone || 'Europe/Warsaw'
))

const appointmentWeekDays = computed(() => (
  appointmentWeekStart.value
    ? buildBookingWeekDays(
        appointmentWeekStart.value,
        appointmentSlots.value,
        appointmentTimezone.value,
      )
    : []
))

const appointmentWeekRangeLabel = computed<string>(() => (
  formatBookingWeekRange(
    appointmentWeekStart.value,
    appointmentWeekStart.value
      ? addDaysToIsoDate(appointmentWeekStart.value, BOOKING_WEEK_DAYS - 1)
      : '',
  )
))

const canGoPreviousAppointmentWeek = computed<boolean>(() => (
  Boolean(appointmentWeekStart.value)
  && addDaysToIsoDate(appointmentWeekStart.value, -BOOKING_WEEK_DAYS)
    >= minimumAppointmentDate.value
))

const appointmentSummary = computed<string>(() => {
  const slot = appointmentSelectedSlot.value
  if (!slot) return 'Wybierz dzień i godzinę'
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: appointmentTimezone.value,
  }).format(new Date(slot.startsAt))
})

const filteredAssignees = computed<CaseTaskDelegationAssignee[]>(() => {
  const query = assigneeSearch.value.trim().toLocaleLowerCase('pl')
  if (!query) return allAssignees.value
  return allAssignees.value.filter((assignee) => {
    const searchable = [
      assignee.fullName,
      assignee.email,
      assignee.teamName ?? '',
      assignee.role === 'admin' ? 'administrator' : 'ekspert',
    ].join(' ').toLocaleLowerCase('pl')
    return searchable.includes(query)
  })
})

const visibleRecentAssignees = computed<CaseTaskDelegationRecentAssignee[]>(() => (
  props.recentAssignees.slice(0, 4)
))

const clientContextLabel = computed<string>(() => {
  if (!props.caseSummary.clients.length) return 'Bez przypisanego klienta'
  const visibleClients = props.caseSummary.clients
    .slice(0, 2)
    .map(client => client.display_name)
    .filter(Boolean)
  const remaining = props.caseSummary.clients.length - visibleClients.length
  return remaining > 0
    ? `${visibleClients.join(', ')} i ${remaining} ${remaining === 1 ? 'inna osoba' : 'inne osoby'}`
    : visibleClients.join(', ')
})

const minimumDueAt = computed<string>(() => {
  const minimum = new Date()
  minimum.setMinutes(minimum.getMinutes() + 15, 0, 0)
  return toLocalDateTime(minimum)
})

const effectiveAccessScope = computed<CaseTaskDelegationAccessScope[]>(() => (
  normalizeCaseTaskDelegationAccessScope(
    draft.accessScope,
    scheduleMode.value === 'appointment',
  )
))

const selectedAccessLabels = computed<string[]>(() => (
  accessOptions
    .filter(option => effectiveAccessScope.value.includes(option.value))
    .map(option => option.label)
))

const primaryActionBlocked = computed<boolean>(() => (
  (
    activeStep.value === 0
    && !draft.title.trim()
  )
  || (
    activeStep.value === 1
    && (
      props.loadingAssignees
      || Boolean(props.assigneesError)
      || !allAssignees.value.length
      || !draft.assigneeUserId
    )
  )
  || (
    activeStep.value === 2
    && scheduleMode.value === 'appointment'
    && (
      appointmentOptionsPending.value
      || !appointmentSelectedSlot.value
      || !selectedAppointmentContext.value
    )
  )
  || (
    activeStep.value === 2
    && scheduleMode.value === 'deadline'
    && !draft.dueAt
  )
))

const primaryActionLabel = computed<string>(() => (
  activeStep.value === 2 ? 'Deleguj zadanie' : 'Dalej'
))

const dueDateSummary = computed<string>(() => {
  if (scheduleMode.value === 'appointment') return appointmentSummary.value
  if (!draft.dueAt || Number.isNaN(new Date(draft.dueAt).getTime())) {
    return 'Nie wybrano terminu'
  }
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(draft.dueAt))
})

function createInitialDraft(): DelegationDraft {
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + 7)
  dueDate.setHours(17, 0, 0, 0)
  return {
    title: '',
    description: '',
    priority: 'normal',
    assigneeUserId: '',
    dueAt: toLocalDateTime(dueDate),
    accessScope: normalizeCaseTaskDelegationAccessScope(
      ['case_summary', 'client_contact'],
      true,
    ),
  }
}

function toLocalDateTime(date: Date) {
  const offset = date.getTimezoneOffset()
  const localDate = new Date(date.getTime() - offset * 60_000)
  return localDate.toISOString().slice(0, 16)
}

function isFutureDate(value: string) {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

function clearErrors() {
  for (const key of Object.keys(errors) as DraftErrorKey[]) delete errors[key]
}

function resetAppointmentSchedule() {
  appointmentOptionsRequestId += 1
  scheduleMode.value = 'appointment'
  ensureRequiredAccessScopes()
  appointmentWeekStart.value = minimumAppointmentDate.value
  appointmentSelectedDate.value = minimumAppointmentDate.value
  appointmentSelectedSlot.value = null
  appointmentContexts.value = []
  selectedAppointmentContextKey.value = ''
  appointmentOptionsPending.value = false
  appointmentOptionsError.value = ''
  appointmentFallbackNotice.value = ''
  appointmentSlotsExpanded.value = false
  appointmentPickerOpen.value = true
  delete errors.appointmentSlot
}

function resetDraft() {
  Object.assign(draft, createInitialDraft())
  activeStep.value = 0
  assigneeSearch.value = ''
  showSuccess.value = false
  clearErrors()
  resetAppointmentSchedule()
}

function validateTaskStep() {
  delete errors.title
  delete errors.description
  const title = draft.title.trim()
  if (title.length < 3) {
    errors.title = 'Wpisz nazwę zadania — minimum 3 znaki.'
  } else if (title.length > 140) {
    errors.title = 'Nazwa zadania może mieć maksymalnie 140 znaków.'
  }
  if (draft.description.length > 2000) {
    errors.description = 'Opis może mieć maksymalnie 2000 znaków.'
  }
  return !errors.title && !errors.description
}

function validateAssigneeStep() {
  delete errors.assigneeUserId
  if (!draft.assigneeUserId) {
    errors.assigneeUserId = 'Wybierz osobę, która przejmie zadanie.'
  } else if (!allAssignees.value.some(assignee => assignee.userId === draft.assigneeUserId)) {
    errors.assigneeUserId = 'Wybrana osoba nie jest już dostępna. Wybierz inną.'
  }
  return !errors.assigneeUserId
}

function validateAccessStep() {
  delete errors.dueAt
  delete errors.appointmentSlot
  ensureRequiredAccessScopes()
  if (scheduleMode.value === 'appointment') {
    if (!appointmentSelectedSlot.value || !selectedAppointmentContext.value) {
      errors.appointmentSlot = 'Wybierz konkretną, wolną godzinę realizatora.'
      appointmentPickerOpen.value = true
    } else if (!isFutureDate(appointmentSelectedSlot.value.startsAt)) {
      errors.appointmentSlot = 'Wybrany termin nie jest już dostępny. Wybierz inną godzinę.'
      appointmentPickerOpen.value = true
    }
  } else if (!draft.dueAt) {
    errors.dueAt = 'Wybierz termin wykonania zadania.'
  } else if (!isFutureDate(draft.dueAt)) {
    errors.dueAt = 'Termin wykonania musi przypadać w przyszłości.'
  }
  return !errors.dueAt && !errors.appointmentSlot
}

function validateStep(step: number) {
  if (step === 0) return validateTaskStep()
  if (step === 1) return validateAssigneeStep()
  return validateAccessStep()
}

function validateAll() {
  if (!validateTaskStep()) {
    activeStep.value = 0
    focusCurrentStep()
    return false
  }
  if (!validateAssigneeStep()) {
    activeStep.value = 1
    focusCurrentStep()
    return false
  }
  if (!validateAccessStep()) {
    activeStep.value = 2
    focusCurrentStep()
    return false
  }
  return true
}

function goBack() {
  if (props.submitting) return
  if (activeStep.value === 0) {
    openModel.value = false
    return
  }
  activeStep.value -= 1
  focusCurrentStep()
}

function handlePrimaryAction() {
  if (props.submitting || showSuccess.value) return
  if (activeStep.value < 2) {
    if (!validateStep(activeStep.value)) return
    activeStep.value += 1
    focusCurrentStep()
    return
  }
  submitDelegation()
}

function submitDelegation() {
  if (!validateAll()) return
  const slot = appointmentSelectedSlot.value
  const context = selectedAppointmentContext.value
  const hasAppointment = scheduleMode.value === 'appointment' && Boolean(slot && context)
  const accessScope = normalizeCaseTaskDelegationAccessScope(
    draft.accessScope,
    hasAppointment,
  )
  emit('submit', {
    title: draft.title.trim(),
    description: draft.description.trim(),
    priority: draft.priority,
    assigneeUserId: draft.assigneeUserId,
    dueAt: hasAppointment ? slot!.startsAt : new Date(draft.dueAt).toISOString(),
    accessScope,
    appointment: hasAppointment
      ? {
          facilityId: context!.facilityId,
          serviceId: context!.serviceId,
          startsAt: slot!.startsAt,
          meetingMode: 'office',
        }
      : null,
  })
}

function selectQuickTitle(title: string) {
  draft.title = title
  delete errors.title
}

function selectAssignee(assignee: CaseTaskDelegationAssignee) {
  draft.assigneeUserId = assignee.userId
  delete errors.assigneeUserId
}

function setQuickDueDate(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(days === 1 ? 12 : 17, 0, 0, 0)
  draft.dueAt = toLocalDateTime(date)
  delete errors.dueAt
}

function appointmentContextKey(context: Pick<
  CaseTaskDelegationAppointmentContext,
  'facilityId' | 'serviceId'
>) {
  return `${context.facilityId}:${context.serviceId}`
}

function setScheduleMode(mode: ScheduleMode) {
  if (props.submitting || scheduleMode.value === mode) return
  scheduleMode.value = mode
  appointmentFallbackNotice.value = ''
  delete errors.dueAt
  delete errors.appointmentSlot
  if (mode === 'appointment') {
    ensureRequiredAccessScopes()
    appointmentPickerOpen.value = !appointmentSelectedSlot.value
    if (!appointmentWeekStart.value) {
      appointmentWeekStart.value = minimumAppointmentDate.value
      appointmentSelectedDate.value = minimumAppointmentDate.value
    }
  } else {
    appointmentOptionsRequestId += 1
    appointmentOptionsPending.value = false
    nextTick(() => {
      document.querySelector<HTMLElement>(
        '#delegate-task-form [name="delegationDueAt"]',
      )?.focus()
    })
  }
}

function appointmentOptionsErrorMessage(error: unknown) {
  const candidate = error as {
    data?: { statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return candidate.data?.statusMessage
    || candidate.statusMessage
    || candidate.message
    || 'Odśwież kalendarz i spróbuj ponownie.'
}

function appointmentOptionsFallbackMessage(error: unknown) {
  const candidate = error as {
    data?: { statusCode?: number, statusMessage?: string }
    status?: number
    statusCode?: number
    statusMessage?: string
    message?: string
  }
  const statusCode = candidate.data?.statusCode ?? candidate.statusCode ?? candidate.status
  const message = [
    candidate.data?.statusMessage,
    candidate.statusMessage,
    candidate.message,
  ].filter(Boolean).join(' ')
  if (statusCode !== 409) return ''
  if (/link a client/i.test(message)) {
    return 'Połącz sprawę z klientem, aby umówić godzinę. Nadal możesz ustawić zwykły termin wykonania.'
  }
  if (/(?:contact|client) person/i.test(message)) {
    return 'Dodaj osobę kontaktową do klienta, aby umówić godzinę. Nadal możesz ustawić zwykły termin wykonania.'
  }
  return ''
}

async function loadAppointmentOptions() {
  const assigneeUserId = draft.assigneeUserId
  const rangeStart = appointmentWeekStart.value || minimumAppointmentDate.value
  if (
    !props.open
    || activeStep.value !== 2
    || scheduleMode.value !== 'appointment'
    || !assigneeUserId
  ) return

  const requestId = ++appointmentOptionsRequestId
  appointmentOptionsPending.value = true
  appointmentOptionsError.value = ''
  appointmentFallbackNotice.value = ''
  appointmentSelectedSlot.value = null
  appointmentPickerOpen.value = true
  delete errors.appointmentSlot

  try {
    const result = await $fetch<CaseTaskDelegationAppointmentOptions>(
      crmApiPath(`/cases/${encodeURIComponent(props.caseSummary.id)}/tasks/appointment-options`),
      {
        query: {
          assignee_user_id: assigneeUserId,
          date: rangeStart,
          days: BOOKING_WEEK_DAYS,
        },
      },
    )
    if (
      requestId !== appointmentOptionsRequestId
      || assigneeUserId !== draft.assigneeUserId
      || rangeStart !== appointmentWeekStart.value
      || scheduleMode.value !== 'appointment'
    ) return

    appointmentContexts.value = result.contexts
    if (!result.contexts.length) {
      appointmentFallbackNotice.value = selectedAssignee.value
        ? `${assigneeName(selectedAssignee.value)} nie ma jeszcze skonfigurowanego grafiku spotkań. Ustaw zwykły termin wykonania zadania.`
        : 'Realizator nie ma jeszcze skonfigurowanego grafiku spotkań. Ustaw zwykły termin wykonania zadania.'
      scheduleMode.value = 'deadline'
      return
    }

    appointmentWeekStart.value = result.date
    const previousContextStillExists = result.contexts.some(context => (
      appointmentContextKey(context) === selectedAppointmentContextKey.value
    ))
    if (!previousContextStillExists) {
      const defaultContext = result.contexts.find(context => context.slots.length)
        ?? result.contexts[0]!
      selectedAppointmentContextKey.value = appointmentContextKey(defaultContext)
    }

    const context = result.contexts.find(item => (
      appointmentContextKey(item) === selectedAppointmentContextKey.value
    )) ?? result.contexts[0]!
    const firstSlot = context.slots[0]
    const returnedDates = appointmentWeekDays.value.map(day => day.date)
    const selectedDayHasSlots = context.slots.some(slot => (
      isoDateForTimestamp(slot.startsAt, context.timezone) === appointmentSelectedDate.value
    ))
    if (!returnedDates.includes(appointmentSelectedDate.value) || !selectedDayHasSlots) {
      appointmentSelectedDate.value = firstSlot
        ? isoDateForTimestamp(firstSlot.startsAt, context.timezone)
        : result.date
    }
  } catch (caught: unknown) {
    if (requestId !== appointmentOptionsRequestId) return
    appointmentContexts.value = []
    selectedAppointmentContextKey.value = ''
    const fallbackMessage = appointmentOptionsFallbackMessage(caught)
    if (fallbackMessage) {
      appointmentFallbackNotice.value = fallbackMessage
      scheduleMode.value = 'deadline'
    } else {
      appointmentOptionsError.value = appointmentOptionsErrorMessage(caught)
    }
  } finally {
    if (requestId === appointmentOptionsRequestId) {
      appointmentOptionsPending.value = false
    }
  }
}

function selectAppointmentContext(value: string | number | undefined) {
  const contextKey = typeof value === 'string' ? value : ''
  if (!contextKey || contextKey === selectedAppointmentContextKey.value) return
  selectedAppointmentContextKey.value = contextKey
  appointmentSelectedSlot.value = null
  appointmentPickerOpen.value = true
  appointmentSlotsExpanded.value = false
  delete errors.appointmentSlot
  const firstSlot = selectedAppointmentContext.value?.slots[0]
  appointmentSelectedDate.value = firstSlot
    ? isoDateForTimestamp(firstSlot.startsAt, appointmentTimezone.value)
    : appointmentWeekStart.value
}

function navigateAppointmentWeek(direction: -1 | 1) {
  if (!appointmentWeekStart.value || appointmentOptionsPending.value) return
  const requestedStart = addDaysToIsoDate(
    appointmentWeekStart.value,
    direction * BOOKING_WEEK_DAYS,
  )
  appointmentWeekStart.value = requestedStart < minimumAppointmentDate.value
    ? minimumAppointmentDate.value
    : requestedStart
  appointmentSelectedDate.value = appointmentWeekStart.value
  appointmentSelectedSlot.value = null
  appointmentSlotsExpanded.value = false
  appointmentPickerOpen.value = true
  delete errors.appointmentSlot
  void loadAppointmentOptions()
}

function selectAppointmentDate(date: string) {
  appointmentSelectedDate.value = date
  if (
    appointmentSelectedSlot.value
    && isoDateForTimestamp(
      appointmentSelectedSlot.value.startsAt,
      appointmentTimezone.value,
    ) !== date
  ) {
    appointmentSelectedSlot.value = null
  }
  delete errors.appointmentSlot
}

function selectAppointmentSlot(slot: PublicBookingSlot, date: string) {
  appointmentSelectedDate.value = date
  appointmentSelectedSlot.value = slot
  appointmentPickerOpen.value = false
  delete errors.appointmentSlot
  nextTick(() => selectedAppointmentSummary.value?.focus())
}

function updateAccessScope(scope: CaseTaskDelegationAccessScope, enabled: boolean) {
  if (accessScopeIsRequired(scope) || props.submitting) return
  const scopes = new Set(draft.accessScope)
  if (enabled) scopes.add(scope)
  else scopes.delete(scope)
  draft.accessScope = normalizeCaseTaskDelegationAccessScope(
    scopes,
    scheduleMode.value === 'appointment',
  )
}

function accessScopeIsRequired(scope: CaseTaskDelegationAccessScope) {
  return caseTaskDelegationAccessScopeIsRequired(
    scope,
    scheduleMode.value === 'appointment',
  )
}

function accessScopeRequirementLabel(scope: CaseTaskDelegationAccessScope) {
  if (scope === 'case_summary') return 'Wymagane'
  return accessScopeIsRequired(scope)
    ? 'Wymagane przy umówieniu spotkania'
    : ''
}

function ensureRequiredAccessScopes() {
  draft.accessScope = normalizeCaseTaskDelegationAccessScope(
    draft.accessScope,
    scheduleMode.value === 'appointment',
  )
}

function initials(assignee: CaseTaskDelegationAssignee) {
  const source = assignee.fullName.trim() || assignee.email
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'OE'
}

function assigneeName(assignee: CaseTaskDelegationAssignee) {
  return assignee.fullName.trim() || assignee.email || 'Użytkownik'
}

function assigneeRole(assignee: CaseTaskDelegationAssignee) {
  return assignee.teamName || (assignee.role === 'admin' ? 'Administrator' : 'Ekspert')
}

function taskCountLabel(count: number) {
  if (count === 1) return '1 otwarte zadanie'
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  if (lastDigit >= 2 && lastDigit <= 4 && !(lastTwoDigits >= 12 && lastTwoDigits <= 14)) {
    return `${count} otwarte zadania`
  }
  return `${count} otwartych zadań`
}

function delegationCountLabel(count: number) {
  if (count === 1) return '1 delegacja'
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  if (lastDigit >= 2 && lastDigit <= 4 && !(lastTwoDigits >= 12 && lastTwoDigits <= 14)) {
    return `${count} delegacje`
  }
  return `${count} delegacji`
}

function relativeDelegationDate(value?: string | null) {
  if (!value) return 'Ostatnio'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'Ostatnio'
  const dayDifference = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000))
  if (dayDifference === 0) return 'Dzisiaj'
  if (dayDifference === 1) return 'Wczoraj'
  if (dayDifference < 7) return `${dayDifference} dni temu`
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(timestamp))
}

function focusCurrentStep() {
  nextTick(() => {
    const selector = activeStep.value === 0
      ? '[name="delegationTitle"]'
      : activeStep.value === 1
        ? '[name="assigneeSearch"]'
        : scheduleMode.value === 'appointment'
          ? '[data-schedule-mode="appointment"]'
          : '[name="delegationDueAt"]'
    document.querySelector<HTMLElement>(`#delegate-task-form ${selector}`)?.focus()
  })
}

defineShortcuts({
  meta_enter: {
    usingInput: true,
    handler: () => {
      if (!props.open || props.submitting) return
      handlePrimaryAction()
    },
  },
})

watch(() => props.open, (isOpen, wasOpen) => {
  if (isOpen && !wasOpen) {
    resetDraft()
    focusCurrentStep()
  } else if (!isOpen && wasOpen) {
    appointmentOptionsRequestId += 1
    appointmentOptionsPending.value = false
  }
})

watch(() => props.submitted, (submitted, wasSubmitted) => {
  if (props.open && submitted && !wasSubmitted) showSuccess.value = true
})
watch(() => props.submitError, (submitError, previousSubmitError) => {
  if (
    !props.open
    || !submitError
    || submitError === previousSubmitError
    || scheduleMode.value !== 'appointment'
    || !/(?:slot|available|termin|godzin)/i.test(submitError)
  ) return
  appointmentSelectedSlot.value = null
  appointmentPickerOpen.value = true
  appointmentSlotsExpanded.value = false
  void loadAppointmentOptions()
})

watch(() => draft.title, () => { delete errors.title })
watch(() => draft.description, () => { delete errors.description })
watch(() => draft.dueAt, () => { delete errors.dueAt })
watch(() => draft.assigneeUserId, (assigneeUserId, previousAssigneeUserId) => {
  if (assigneeUserId === previousAssigneeUserId) return
  resetAppointmentSchedule()
})
watch(
  () => [props.open, activeStep.value, scheduleMode.value] as const,
  ([isOpen, step, mode]) => {
    if (
      isOpen
      && step === 2
      && mode === 'appointment'
      && draft.assigneeUserId
      && !appointmentOptionsPending.value
      && !appointmentContexts.value.length
    ) {
      void loadAppointmentOptions()
    }
  },
)
</script>

<template>
  <UModal
    v-model:open="openModel"
    title="Deleguj zadanie"
    description="Przekaż konkretny zakres pracy i zachowaj kontrolę nad terminem."
    :dismissible="!submitting"
    :close="!submitting"
    :ui="{
      content: 'sm:max-w-[944px] max-sm:inset-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none',
      description: 'sr-only',
      header: 'shrink-0',
      body: 'min-h-0 overflow-y-auto p-0 sm:p-0',
      footer: 'block shrink-0 p-0 sm:p-0',
    }"
  >
    <template #body>
      <div class="delegation-modal">
        <section class="delegation-context" aria-label="Kontekst delegowanego zadania">
          <span class="delegation-context__icon" aria-hidden="true">
            <UIcon name="i-lucide-briefcase-business" />
          </span>
          <div class="delegation-context__copy">
            <span>Zadanie w sprawie</span>
            <strong>{{ caseSummary.title }}</strong>
            <small>
              <UIcon name="i-lucide-users-round" aria-hidden="true" />
              {{ clientContextLabel }}
            </small>
          </div>
          <UBadge v-if="caseSummary.id" color="neutral" variant="subtle" class="delegation-context__badge">
            Sprawa
          </UBadge>
        </section>

        <div v-if="showSuccess" class="delegation-success" role="status" aria-live="polite">
          <span class="delegation-success__icon" aria-hidden="true">
            <UIcon name="i-lucide-circle-check-big" />
          </span>
          <div>
            <span>Zadanie przekazane</span>
            <h2>{{ draft.title }}</h2>
            <p>
              {{ selectedAssignee ? assigneeName(selectedAssignee) : 'Realizator' }}
              otrzyma zadanie wraz z wybranym kontekstem sprawy.
            </p>
          </div>
          <dl class="delegation-success__facts">
            <div>
              <dt>Realizator</dt>
              <dd>{{ selectedAssignee ? assigneeName(selectedAssignee) : '—' }}</dd>
            </div>
            <div>
              <dt>Termin</dt>
              <dd class="first-letter:uppercase">{{ dueDateSummary }}</dd>
            </div>
            <div v-if="scheduleMode === 'appointment' && selectedAppointmentContext">
              <dt>Spotkanie</dt>
              <dd>
                {{ selectedAppointmentContext.serviceName }} ·
                {{ selectedAppointmentContext.facilityName }}
              </dd>
            </div>
            <div>
              <dt>Dołączono</dt>
              <dd>{{ selectedAccessLabels.length }} {{ selectedAccessLabels.length === 1 ? 'obszar' : 'obszarów' }}</dd>
            </div>
          </dl>
        </div>

        <template v-else>
          <UStepper
            v-model="stepModel"
            :items="stepItems"
            size="xs"
            color="success"
            class="delegation-stepper"
            :ui="{
              description: 'hidden',
              content: 'hidden',
            }"
          />

          <form
            id="delegate-task-form"
            novalidate
            class="delegation-form"
            :class="{ 'delegation-form--assignee': activeStep === 1 }"
            @submit.prevent="handlePrimaryAction"
          >
            <div class="delegation-form__main">
              <UAlert
                v-if="submitError"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                title="Nie udało się delegować zadania"
                :description="submitError"
                role="alert"
              />

              <Transition name="delegation-step" mode="out-in">
                <section
                  v-if="activeStep === 0"
                  key="task"
                  class="delegation-panel"
                  aria-labelledby="delegation-task-heading"
                >
                <header class="delegation-panel__heading">
                  <span aria-hidden="true"><UIcon name="i-lucide-list-checks" /></span>
                  <div>
                    <h2 id="delegation-task-heading">Co ma zostać zrobione?</h2>
                    <p>Nazwij rezultat krótko. Szczegóły pomogą uniknąć pytań po przekazaniu.</p>
                  </div>
                </header>

                <UFormField
                  name="title"
                  label="Nazwa zadania"
                  required
                  :error="errors.title"
                >
                  <UInput
                    v-model="draft.title"
                    name="delegationTitle"
                    class="w-full"
                    icon="i-lucide-text-cursor-input"
                    placeholder="np. Zweryfikuj dokumenty nieruchomości"
                    maxlength="140"
                    autocomplete="off"
                    autofocus
                    :disabled="submitting"
                  />
                </UFormField>

                <div class="delegation-suggestions" aria-label="Przykładowe zadania">
                  <span>Szybki start</span>
                  <div>
                    <button
                      v-for="title in quickTaskTitles"
                      :key="title"
                      type="button"
                      :disabled="submitting"
                      @click="selectQuickTitle(title)"
                    >
                      <UIcon name="i-lucide-plus" aria-hidden="true" />
                      {{ title }}
                    </button>
                  </div>
                </div>

                <UFormField
                  name="description"
                  label="Opis i oczekiwany rezultat"
                  hint="Opcjonalnie"
                  :error="errors.description"
                >
                  <UTextarea
                    v-model="draft.description"
                    name="delegationDescription"
                    class="w-full"
                    :rows="4"
                    autoresize
                    :maxrows="8"
                    maxlength="2000"
                    placeholder="Dodaj najważniejsze ustalenia i napisz, po czym poznasz, że zadanie jest gotowe."
                    :disabled="submitting"
                  />
                  <template #help>
                    {{ draft.description.length }}/2000 znaków
                  </template>
                </UFormField>

                <fieldset class="delegation-priority">
                  <legend>Priorytet</legend>
                  <div role="radiogroup" aria-label="Priorytet zadania">
                    <button
                      v-for="option in priorityOptions"
                      :key="option.value"
                      type="button"
                      class="delegation-priority__option"
                      :class="{ 'delegation-priority__option--selected': draft.priority === option.value }"
                      role="radio"
                      :aria-checked="draft.priority === option.value"
                      :disabled="submitting"
                      @click="draft.priority = option.value"
                    >
                      <span aria-hidden="true"><UIcon :name="option.icon" /></span>
                      <strong>{{ option.label }}</strong>
                      <small>{{ option.description }}</small>
                    </button>
                  </div>
                </fieldset>
                </section>

                <section
                  v-else-if="activeStep === 1"
                  key="assignee"
                  class="delegation-panel"
                  aria-labelledby="delegation-assignee-heading"
                >
                <header class="delegation-panel__heading">
                  <span aria-hidden="true"><UIcon name="i-lucide-user-round-check" /></span>
                  <div>
                    <h2 id="delegation-assignee-heading">Kto przejmie zadanie?</h2>
                    <p>Wybierz osobę z ostatnich delegacji albo znajdź kogoś w zespole.</p>
                  </div>
                </header>

                <div v-if="loadingAssignees" class="delegation-assignees-loading" aria-label="Pobieranie osób">
                  <USkeleton class="h-24 w-full" />
                  <USkeleton class="h-12 w-full" />
                  <USkeleton class="h-36 w-full" />
                </div>

                <UAlert
                  v-else-if="assigneesError"
                  color="error"
                  variant="subtle"
                  icon="i-lucide-users-round"
                  title="Nie udało się pobrać zespołu"
                  :description="assigneesError"
                  :actions="[{ label: 'Spróbuj ponownie', onClick: () => emit('retry-assignees') }]"
                  role="alert"
                />

                <template v-else>
                  <section v-if="visibleRecentAssignees.length" class="delegation-recent">
                    <div class="delegation-section-label">
                      <span>
                        <UIcon name="i-lucide-history" aria-hidden="true" />
                        Ostatnio delegowałeś do
                      </span>
                      <small>Szybki wybór</small>
                    </div>
                    <div class="delegation-recent__grid" role="radiogroup" aria-label="Ostatnio wybierane osoby">
                      <button
                        v-for="assignee in visibleRecentAssignees"
                        :key="assignee.userId"
                        type="button"
                        class="delegation-recent__person"
                        :class="{ 'delegation-recent__person--selected': draft.assigneeUserId === assignee.userId }"
                        role="radio"
                        :aria-checked="draft.assigneeUserId === assignee.userId"
                        :disabled="submitting"
                        @click="selectAssignee(assignee)"
                      >
                        <UAvatar
                          :src="assignee.avatarUrl || undefined"
                          :alt="assigneeName(assignee)"
                          :text="initials(assignee)"
                          size="lg"
                        />
                        <span>
                          <strong>{{ assigneeName(assignee) }}</strong>
                          <small>
                            {{ relativeDelegationDate(assignee.lastDelegatedAt) }}
                            <template v-if="assignee.delegationCount">
                              · {{ delegationCountLabel(assignee.delegationCount) }}
                            </template>
                          </small>
                        </span>
                        <UIcon
                          v-if="draft.assigneeUserId === assignee.userId"
                          name="i-lucide-circle-check"
                          class="delegation-selection-check"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  </section>

                  <section class="delegation-directory">
                    <div class="delegation-section-label">
                      <span>
                        <UIcon name="i-lucide-users-round" aria-hidden="true" />
                        Zespół
                      </span>
                      <small>{{ allAssignees.length }} {{ allAssignees.length === 1 ? 'osoba' : 'osób' }}</small>
                    </div>

                    <UFormField
                      name="assigneeUserId"
                      :error="errors.assigneeUserId"
                    >
                      <UInput
                        v-model="assigneeSearch"
                        name="assigneeSearch"
                        class="w-full"
                        icon="i-lucide-search"
                        placeholder="Szukaj po imieniu, e-mailu lub zespole"
                        autocomplete="off"
                        autofocus
                        :disabled="submitting || !allAssignees.length"
                      />
                    </UFormField>

                    <div
                      v-if="filteredAssignees.length"
                      class="delegation-directory__list"
                      role="radiogroup"
                      aria-label="Dostępni realizatorzy"
                    >
                      <button
                        v-for="assignee in filteredAssignees"
                        :key="assignee.userId"
                        type="button"
                        class="delegation-directory__person"
                        :class="{ 'delegation-directory__person--selected': draft.assigneeUserId === assignee.userId }"
                        role="radio"
                        :aria-checked="draft.assigneeUserId === assignee.userId"
                        :disabled="submitting"
                        @click="selectAssignee(assignee)"
                      >
                        <UAvatar
                          :src="assignee.avatarUrl || undefined"
                          :alt="assigneeName(assignee)"
                          :text="initials(assignee)"
                          size="md"
                        />
                        <span class="delegation-directory__identity">
                          <strong>{{ assigneeName(assignee) }}</strong>
                          <small>{{ assignee.email }}</small>
                        </span>
                        <span class="delegation-directory__meta">
                          <small>{{ assigneeRole(assignee) }}</small>
                          <UBadge
                            v-if="assignee.openTaskCount !== undefined"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                          >
                            {{ taskCountLabel(assignee.openTaskCount) }}
                          </UBadge>
                        </span>
                        <UIcon
                          :name="draft.assigneeUserId === assignee.userId ? 'i-lucide-circle-check' : 'i-lucide-chevron-right'"
                          :class="{ 'delegation-selection-check': draft.assigneeUserId === assignee.userId }"
                          aria-hidden="true"
                        />
                      </button>
                    </div>

                    <div v-else class="delegation-directory__empty" role="status">
                      <UIcon :name="allAssignees.length ? 'i-lucide-search-x' : 'i-lucide-user-round-x'" aria-hidden="true" />
                      <strong>{{ allAssignees.length ? 'Nie znaleziono takiej osoby' : 'Brak osób do wyboru' }}</strong>
                      <p>
                        {{ allAssignees.length
                          ? 'Zmień wyszukiwaną frazę i spróbuj ponownie.'
                          : 'Gdy ktoś dołączy do organizacji, pojawi się na tej liście.' }}
                      </p>
                    </div>
                  </section>
                </template>
                </section>

                <section
                  v-else
                  key="access"
                  class="delegation-panel"
                  aria-labelledby="delegation-access-heading"
                >
                <header class="delegation-panel__heading">
                  <span aria-hidden="true"><UIcon name="i-lucide-calendar-clock" /></span>
                  <div>
                    <h2 id="delegation-access-heading">Ustal termin i kontekst zadania</h2>
                    <p>Wskaż realizatorowi te elementy sprawy, których potrzebuje do pracy.</p>
                  </div>
                </header>

                <div
                  class="delegation-schedule-mode"
                  role="radiogroup"
                  aria-label="Sposób ustalenia terminu"
                >
                  <button
                    type="button"
                    class="delegation-schedule-mode__option"
                    data-schedule-mode="appointment"
                    :class="{ 'delegation-schedule-mode__option--selected': scheduleMode === 'appointment' }"
                    role="radio"
                    :aria-checked="scheduleMode === 'appointment'"
                    :disabled="submitting"
                    @click="setScheduleMode('appointment')"
                  >
                    <span aria-hidden="true"><UIcon name="i-lucide-calendar-check-2" /></span>
                    <span>
                      <strong>Umów konkretną godzinę</strong>
                      <small>Wybierz wolny termin z kalendarza realizatora.</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="delegation-schedule-mode__option"
                    data-schedule-mode="deadline"
                    :class="{ 'delegation-schedule-mode__option--selected': scheduleMode === 'deadline' }"
                    role="radio"
                    :aria-checked="scheduleMode === 'deadline'"
                    :disabled="submitting"
                    @click="setScheduleMode('deadline')"
                  >
                    <span aria-hidden="true"><UIcon name="i-lucide-flag" /></span>
                    <span>
                      <strong>Tylko termin wykonania</strong>
                      <small>Ustal deadline bez tworzenia spotkania.</small>
                    </span>
                  </button>
                </div>

                <UAlert
                  v-if="appointmentFallbackNotice"
                  color="warning"
                  variant="subtle"
                  icon="i-lucide-calendar-x-2"
                  title="Brak dostępnego grafiku spotkań"
                  :description="appointmentFallbackNotice"
                  role="status"
                />

                <template v-if="scheduleMode === 'appointment'">
                  <UFormField
                    v-if="appointmentContextItems.length > 1"
                    name="appointmentContext"
                    label="Rodzaj spotkania i placówka"
                    description="Realizator ma kilka grafików. Wybierz właściwy kontekst."
                  >
                    <USelect
                      :model-value="selectedAppointmentContextKey"
                      class="w-full"
                      :items="appointmentContextItems"
                      value-key="value"
                      icon="i-lucide-building-2"
                      :disabled="submitting || appointmentOptionsPending"
                      @update:model-value="selectAppointmentContext"
                    />
                  </UFormField>

                  <div
                    v-else-if="selectedAppointmentContext && !appointmentOptionsPending"
                    class="delegation-schedule-context"
                  >
                    <span aria-hidden="true"><UIcon name="i-lucide-building-2" /></span>
                    <span>
                      <small>Kalendarz</small>
                      <strong>
                        {{ selectedAppointmentContext.serviceName }} ·
                        {{ selectedAppointmentContext.facilityName }}
                      </strong>
                    </span>
                    <UBadge color="neutral" variant="subtle">
                      {{ selectedAppointmentContext.durationMinutes }} min
                    </UBadge>
                  </div>

                  <UFormField
                    name="appointmentSlot"
                    :error="errors.appointmentSlot"
                  >
                    <section
                      v-if="appointmentSelectedSlot && !appointmentPickerOpen"
                      ref="selectedAppointmentSummary"
                      class="delegation-selected-appointment"
                      role="status"
                      tabindex="-1"
                      aria-labelledby="delegation-selected-appointment-title"
                    >
                      <span class="delegation-selected-appointment__icon" aria-hidden="true">
                        <UIcon name="i-lucide-calendar-check-2" />
                      </span>
                      <div>
                        <small id="delegation-selected-appointment-title">Wybrany termin</small>
                        <strong class="first-letter:uppercase">{{ appointmentSummary }}</strong>
                        <span>
                          {{ selectedAssignee ? assigneeName(selectedAssignee) : 'Realizator' }}
                          <template v-if="selectedAppointmentContext">
                            · {{ selectedAppointmentContext.serviceName }}
                            · {{ selectedAppointmentContext.facilityName }}
                          </template>
                        </span>
                      </div>
                      <UButton
                        type="button"
                        color="neutral"
                        variant="outline"
                        icon="i-lucide-pencil"
                        :disabled="submitting"
                        @click="appointmentPickerOpen = true"
                      >
                        Zmień godzinę
                      </UButton>
                    </section>

                    <div v-else class="delegation-slot-picker">
                      <BookingWeekPicker
                        :days="appointmentWeekDays"
                        :range-label="appointmentWeekRangeLabel"
                        :selected-date="appointmentSelectedDate"
                        :selected-slot="appointmentSelectedSlot"
                        :timezone="appointmentTimezone"
                        :pending="appointmentOptionsPending"
                        :error="appointmentOptionsError"
                        :can-go-previous="canGoPreviousAppointmentWeek"
                        :expanded="appointmentSlotsExpanded"
                        title="Wybierz wolną godzinę realizatora"
                        trust-message="Termin pochodzi bezpośrednio z kalendarza realizatora."
                        empty-week-message="Realizator nie ma wolnej godziny w tym tygodniu."
                        empty-day-message="Brak wolnej godziny tego dnia."
                        empty-day-hint="Wybierz inny dzień albo przejdź do następnego tygodnia."
                        retry-label="Odśwież kalendarz"
                        @previous="navigateAppointmentWeek(-1)"
                        @next="navigateAppointmentWeek(1)"
                        @select-date="selectAppointmentDate"
                        @select-slot="selectAppointmentSlot"
                        @toggle-expanded="appointmentSlotsExpanded = !appointmentSlotsExpanded"
                        @retry="loadAppointmentOptions"
                      />
                    </div>
                  </UFormField>
                </template>

                <div v-else class="delegation-due-date">
                  <UFormField
                    name="dueAt"
                    label="Termin wykonania"
                    required
                    :error="errors.dueAt"
                  >
                    <UInput
                      v-model="draft.dueAt"
                      name="delegationDueAt"
                      class="w-full"
                      type="datetime-local"
                      icon="i-lucide-calendar-clock"
                      :min="minimumDueAt"
                      autofocus
                      :disabled="submitting"
                    />
                  </UFormField>
                  <div class="delegation-due-date__presets" aria-label="Szybki wybór terminu">
                    <button type="button" :disabled="submitting" @click="setQuickDueDate(1)">Jutro</button>
                    <button type="button" :disabled="submitting" @click="setQuickDueDate(3)">Za 3 dni</button>
                    <button type="button" :disabled="submitting" @click="setQuickDueDate(7)">Za tydzień</button>
                  </div>
                </div>

                <fieldset class="delegation-access">
                  <legend>Jakie informacje dołączyć do zadania?</legend>
                  <p>Wybrane obszary tworzą czytelną listę kontekstu dla realizatora.</p>
                  <div class="delegation-access__grid">
                    <div
                      v-for="option in accessOptions"
                      :key="option.value"
                      class="delegation-access__option"
                      :class="{
                        'delegation-access__option--selected': effectiveAccessScope.includes(option.value),
                        'delegation-access__option--required': accessScopeIsRequired(option.value),
                      }"
                      @click="updateAccessScope(option.value, !effectiveAccessScope.includes(option.value))"
                    >
                      <span class="delegation-access__icon" aria-hidden="true">
                        <UIcon :name="option.icon" />
                      </span>
                      <span class="delegation-access__copy">
                        <strong>{{ option.label }}</strong>
                        <small>{{ option.description }}</small>
                        <em v-if="accessScopeRequirementLabel(option.value)">
                          {{ accessScopeRequirementLabel(option.value) }}
                        </em>
                      </span>
                      <UCheckbox
                        :model-value="effectiveAccessScope.includes(option.value)"
                        :disabled="accessScopeIsRequired(option.value) || submitting"
                        :aria-label="accessScopeRequirementLabel(option.value)
                          ? `${option.label} — ${accessScopeRequirementLabel(option.value)}`
                          : option.label"
                        @click.stop
                        @update:model-value="updateAccessScope(option.value, Boolean($event))"
                      />
                    </div>
                  </div>
                </fieldset>

                <section class="delegation-review" aria-labelledby="delegation-review-heading">
                  <div class="delegation-section-label">
                    <span id="delegation-review-heading">
                      <UIcon name="i-lucide-eye" aria-hidden="true" />
                      Podsumowanie przekazania
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>Realizator</dt>
                      <dd>
                        <UAvatar
                          v-if="selectedAssignee"
                          :src="selectedAssignee.avatarUrl || undefined"
                          :alt="assigneeName(selectedAssignee)"
                          :text="initials(selectedAssignee)"
                          size="xs"
                        />
                        {{ selectedAssignee ? assigneeName(selectedAssignee) : 'Nie wybrano' }}
                      </dd>
                    </div>
                    <div>
                      <dt>Termin</dt>
                      <dd class="first-letter:uppercase">{{ dueDateSummary }}</dd>
                    </div>
                    <div v-if="scheduleMode === 'appointment' && selectedAppointmentContext">
                      <dt>Spotkanie</dt>
                      <dd>
                        {{ selectedAppointmentContext.serviceName }} ·
                        {{ selectedAppointmentContext.facilityName }}
                      </dd>
                    </div>
                    <div>
                      <dt>Kontekst</dt>
                      <dd>{{ selectedAccessLabels.join(', ') }}</dd>
                    </div>
                  </dl>
                </section>

                <UAlert
                  color="neutral"
                  variant="subtle"
                  icon="i-lucide-shield-check"
                  title="Pełna historia pozostaje przy sprawie"
                  description="Delegacja, spotkanie i każda zmiana statusu będą widoczne w historii sprawy."
                />
                </section>
              </Transition>
            </div>

            <aside
              v-if="activeStep === 1"
              class="delegation-assignee-summary"
              aria-label="Podsumowanie delegowanego zadania"
            >
              <dl>
                <div>
                  <dt>
                    <UIcon name="i-lucide-list-checks" aria-hidden="true" />
                    Zadanie
                  </dt>
                  <dd>{{ draft.title }}</dd>
                </div>
                <div>
                  <dt>
                    <UIcon name="i-lucide-briefcase-business" aria-hidden="true" />
                    Sprawa
                  </dt>
                  <dd>{{ caseSummary.title }}</dd>
                </div>
                <div>
                  <dt>
                    <UIcon name="i-lucide-users-round" aria-hidden="true" />
                    Klienci
                  </dt>
                  <dd>{{ clientContextLabel }}</dd>
                </div>
              </dl>
              <div class="delegation-assignee-summary__notice">
                <UIcon name="i-lucide-info" aria-hidden="true" />
                <p>Zakres danych i termin ustawisz w kolejnym kroku.</p>
              </div>
            </aside>

            <p class="sr-only" aria-live="polite">
              Krok {{ activeStep + 1 }} z 3: {{ stepItems[activeStep]?.title }}
            </p>
          </form>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="delegation-footer">
        <p v-if="!showSuccess">
          <UIcon name="i-lucide-command" aria-hidden="true" />
          <span><kbd>⌘</kbd> + <kbd>Enter</kbd>, aby przejść dalej</span>
        </p>
        <span v-else />

        <div v-if="showSuccess">
          <UButton
            color="success"
            variant="solid"
            icon="i-lucide-check"
            @click="openModel = false"
          >
            Gotowe
          </UButton>
        </div>
        <div v-else>
          <UButton
            color="neutral"
            variant="ghost"
            :icon="activeStep > 0 ? 'i-lucide-arrow-left' : undefined"
            :disabled="submitting"
            @click="goBack"
          >
            {{ activeStep > 0 ? 'Wstecz' : 'Anuluj' }}
          </UButton>
          <UButton
            type="submit"
            form="delegate-task-form"
            color="success"
            variant="solid"
            :icon="activeStep === 2 ? 'i-lucide-send' : undefined"
            :trailing-icon="activeStep < 2 ? 'i-lucide-arrow-right' : undefined"
            :loading="submitting"
            :disabled="submitting || primaryActionBlocked"
          >
            {{ primaryActionLabel }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.delegation-modal {
  min-height: 530px;
}

.delegation-context {
  display: none;
  align-items: center;
  gap: 12px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.delegation-context__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
}

.delegation-context__icon .iconify {
  width: 18px;
  height: 18px;
}

.delegation-context__copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.delegation-context__copy > span {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.delegation-context__copy strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delegation-context__copy small {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delegation-context__copy small .iconify {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
}

.delegation-context__badge {
  margin-left: auto;
}

.delegation-stepper {
  padding: 10px 56px 8px;
  border-bottom: 1px solid var(--ui-border);
}

.delegation-form {
  padding: 22px 24px 26px;
}

.delegation-form__main {
  min-width: 0;
}

.delegation-form--assignee {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 286px;
  min-height: 472px;
  padding: 0;
}

.delegation-form--assignee .delegation-form__main {
  padding: 26px 32px 30px;
}

.delegation-form--assignee .delegation-panel {
  gap: 20px;
}

.delegation-form--assignee .delegation-panel__heading p {
  display: none;
}

.delegation-form--assignee .delegation-directory__list {
  max-height: 116px;
}

.delegation-assignee-summary {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 30px 24px;
  border-left: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.delegation-assignee-summary dl {
  display: grid;
  gap: 24px;
  margin: 0;
}

.delegation-assignee-summary dl > div {
  display: grid;
  gap: 5px;
}

.delegation-assignee-summary dt {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 600;
}

.delegation-assignee-summary dt .iconify {
  width: 16px;
  height: 16px;
  color: var(--ui-text);
}

.delegation-assignee-summary dd {
  margin: 0 0 0 24px;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
}

.delegation-assignee-summary__notice {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  margin-top: auto;
  padding: 14px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
}

.delegation-assignee-summary__notice .iconify {
  width: 16px;
  height: 16px;
  margin-top: 1px;
  color: var(--ui-text);
}

.delegation-assignee-summary__notice p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.delegation-panel {
  display: grid;
  gap: 18px;
}

.delegation-panel__heading {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.delegation-panel__heading > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}

.delegation-panel__heading > span .iconify {
  width: 17px;
  height: 17px;
}

.delegation-panel__heading h2,
.delegation-panel__heading p {
  margin: 0;
}

.delegation-panel__heading h2 {
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 650;
}

.delegation-panel__heading p {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.delegation-suggestions {
  display: grid;
  gap: 7px;
  margin-top: -8px;
}

.delegation-suggestions > span,
.delegation-priority legend,
.delegation-access legend {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.delegation-suggestions > div,
.delegation-due-date__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.delegation-suggestions button,
.delegation-due-date__presets button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: var(--ui-bg);
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 600;
  transition:
    border-color var(--oe-motion-fast),
    background var(--oe-motion-fast),
    color var(--oe-motion-fast);
}

.delegation-suggestions button:hover:not(:disabled),
.delegation-due-date__presets button:hover:not(:disabled) {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}

.delegation-suggestions button:disabled,
.delegation-due-date__presets button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.delegation-suggestions button .iconify {
  width: 12px;
  height: 12px;
}

.delegation-priority {
  display: grid;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.delegation-priority > div {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.delegation-priority__option {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1px 8px;
  padding: 11px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
  transition:
    border-color var(--oe-motion-fast),
    background var(--oe-motion-fast),
    box-shadow var(--oe-motion-fast);
}

.delegation-priority__option:hover:not(:disabled),
.delegation-priority__option--selected {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.delegation-priority__option--selected {
  box-shadow: inset 0 0 0 1px var(--ui-primary);
}

.delegation-priority__option:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.delegation-priority__option > span {
  display: grid;
  grid-row: span 2;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}

.delegation-priority__option > span .iconify {
  width: 13px;
  height: 13px;
}

.delegation-priority__option strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
}

.delegation-priority__option small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delegation-assignees-loading {
  display: grid;
  gap: 10px;
}

.delegation-recent,
.delegation-directory,
.delegation-access,
.delegation-review {
  display: grid;
  gap: 10px;
}

.delegation-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.delegation-section-label > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.delegation-section-label > span .iconify {
  width: 14px;
  height: 14px;
  color: var(--ui-text-muted);
}

.delegation-section-label > small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.delegation-recent__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.delegation-form--assignee .delegation-recent__grid {
  grid-template-columns: 1fr;
}

.delegation-recent__person {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-muted);
  color: var(--ui-text);
  text-align: left;
  transition:
    border-color var(--oe-motion-fast),
    background var(--oe-motion-fast),
    box-shadow var(--oe-motion-fast);
}

.delegation-recent__person:hover:not(:disabled),
.delegation-recent__person--selected {
  border-color: var(--ui-success);
  background: var(--ui-bg-elevated);
}

.delegation-recent__person--selected {
  box-shadow: inset 0 0 0 1px var(--ui-success);
}

.delegation-recent__person:focus-visible,
.delegation-directory__person:focus-visible {
  outline: 2px solid var(--ui-success);
  outline-offset: 2px;
}

.delegation-recent__person:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.delegation-recent__person > span {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.delegation-recent__person strong,
.delegation-directory__identity strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delegation-recent__person small,
.delegation-directory__identity small,
.delegation-directory__meta small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delegation-selection-check {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--ui-success);
}

.delegation-directory__list {
  display: grid;
  max-height: 238px;
  overflow-y: auto;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg);
}

.delegation-directory__person {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 9px 10px;
  border: 0;
  border-bottom: 1px solid var(--ui-border);
  background: transparent;
  color: var(--ui-text);
  text-align: left;
  transition: background var(--oe-motion-fast);
}

.delegation-directory__person:last-child {
  border-bottom: 0;
}

.delegation-directory__person:hover:not(:disabled),
.delegation-directory__person--selected {
  background: var(--ui-bg-muted);
}

.delegation-directory__person:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.delegation-directory__identity,
.delegation-directory__meta {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.delegation-directory__meta {
  justify-items: end;
}

.delegation-directory__person > .iconify {
  width: 15px;
  height: 15px;
  color: var(--ui-text-dimmed);
}

.delegation-directory__empty {
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 24px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 12px;
  color: var(--ui-text-muted);
  text-align: center;
}

.delegation-directory__empty .iconify {
  width: 22px;
  height: 22px;
  margin-bottom: 3px;
}

.delegation-directory__empty strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.delegation-directory__empty p {
  margin: 0;
  font-size: 10px;
}

.delegation-schedule-mode {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 5px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg-muted);
}

.delegation-schedule-mode__option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 62px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--oe-motion-fast),
    background var(--oe-motion-fast),
    box-shadow var(--oe-motion-fast);
}

.delegation-schedule-mode__option:hover:not(:disabled) {
  background: var(--ui-bg-elevated);
}

.delegation-schedule-mode__option--selected {
  border-color: color-mix(in srgb, var(--ui-success) 58%, var(--ui-border));
  background: var(--ui-bg);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ui-text-highlighted) 8%, transparent);
}

.delegation-schedule-mode__option:focus-visible {
  outline: 2px solid var(--ui-success);
  outline-offset: 2px;
}

.delegation-schedule-mode__option:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.delegation-schedule-mode__option > span:first-child {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-muted);
}

.delegation-schedule-mode__option--selected > span:first-child {
  background: color-mix(in srgb, var(--ui-success) 12%, var(--ui-bg));
  color: var(--ui-success);
}

.delegation-schedule-mode__option > span:first-child .iconify {
  width: 17px;
  height: 17px;
}

.delegation-schedule-mode__option > span:last-child {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.delegation-schedule-mode__option strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
}

.delegation-schedule-mode__option small {
  color: var(--ui-text-muted);
  font-size: 9px;
  line-height: 1.35;
}

.delegation-schedule-context {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.delegation-schedule-context > span:first-child {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--ui-bg);
  color: var(--ui-text-muted);
}

.delegation-schedule-context > span:first-child .iconify {
  width: 15px;
  height: 15px;
}

.delegation-schedule-context > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.delegation-schedule-context small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.delegation-schedule-context strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delegation-slot-picker {
  --booking-accent: var(--ui-success);

  min-width: 0;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: 13px;
  background: var(--ui-bg-muted);
}

.delegation-slot-picker :deep(.booking-week__toolbar p) {
  font-size: 14px;
}

.delegation-selected-appointment {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 13px 14px;
  border: 1px solid color-mix(in srgb, var(--ui-success) 58%, var(--ui-border));
  border-radius: 13px;
  background: color-mix(in srgb, var(--ui-success) 7%, var(--ui-bg));
}

.delegation-selected-appointment:focus-visible {
  outline: 2px solid var(--ui-success);
  outline-offset: 2px;
}

.delegation-selected-appointment__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: color-mix(in srgb, var(--ui-success) 14%, var(--ui-bg));
  color: var(--ui-success);
}

.delegation-selected-appointment__icon .iconify {
  width: 19px;
  height: 19px;
}

.delegation-selected-appointment > div {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.delegation-selected-appointment small,
.delegation-selected-appointment span {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.delegation-selected-appointment strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delegation-due-date {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto;
  align-items: end;
  gap: 12px;
}

.delegation-due-date__presets {
  padding-bottom: 1px;
}

.delegation-access {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.delegation-access > p {
  margin: -7px 0 0;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.delegation-access__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.delegation-access__option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 11px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg);
  cursor: pointer;
  transition:
    border-color var(--oe-motion-fast),
    background var(--oe-motion-fast);
}

.delegation-access__option:hover,
.delegation-access__option--selected {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.delegation-access__option--required {
  cursor: default;
}

.delegation-access__icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}

.delegation-access__icon .iconify {
  width: 15px;
  height: 15px;
}

.delegation-access__copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.delegation-access__copy strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
}

.delegation-access__copy small {
  color: var(--ui-text-muted);
  font-size: 9px;
  line-height: 1.35;
}

.delegation-access__copy em {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-family: var(--font-sans);
  font-size: 8px;
  font-style: normal;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.delegation-review {
  padding: 13px;
  border: 1px solid var(--ui-border);
  border-radius: 13px;
  background: var(--ui-bg-muted);
}

.delegation-review dl,
.delegation-success__facts {
  display: grid;
  gap: 0;
  margin: 0;
}

.delegation-review dl > div,
.delegation-success__facts > div {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--ui-border);
}

.delegation-review dl > div:last-child,
.delegation-success__facts > div:last-child {
  border-bottom: 0;
}

.delegation-review dt,
.delegation-success__facts dt {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.delegation-review dd,
.delegation-success__facts dd {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 10px;
  font-weight: 600;
}

.delegation-success {
  display: grid;
  justify-items: center;
  gap: 16px;
  max-width: 520px;
  margin: 0 auto;
  padding: 54px 24px;
  text-align: center;
}

.delegation-success__icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-success) 14%, transparent);
  color: var(--ui-success);
}

.delegation-success__icon .iconify {
  width: 30px;
  height: 30px;
}

.delegation-success > div > span {
  color: var(--ui-success);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.delegation-success h2 {
  margin: 4px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 22px;
  font-weight: 650;
}

.delegation-success p {
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.delegation-success__facts {
  width: 100%;
  padding: 7px 14px;
  border: 1px solid var(--ui-border);
  border-radius: 13px;
  background: var(--ui-bg-muted);
  text-align: left;
}

.delegation-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
}

.delegation-footer > p {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.delegation-footer > p .iconify {
  width: 12px;
  height: 12px;
}

.delegation-footer kbd {
  padding: 1px 4px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 4px;
  background: var(--ui-bg-muted);
  color: var(--ui-text);
  font-family: var(--font-mono);
  font-size: 8px;
}

.delegation-footer > div {
  display: flex;
  align-items: center;
  gap: 7px;
}

.delegation-step-enter-active,
.delegation-step-leave-active {
  transition:
    opacity var(--oe-motion-fast),
    transform var(--oe-motion-fast);
}

.delegation-step-enter-from {
  opacity: 0;
  transform: translateX(8px);
}

.delegation-step-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

@media (max-width: 639px) {
  :global([role="dialog"]:has(.delegation-modal) button[data-slot="close"]) {
    min-width: 44px;
    min-height: 44px;
    top: 10px;
    right: 10px;
  }

  .delegation-modal {
    min-height: auto;
  }

  .delegation-context {
    display: flex;
    padding: 12px 16px;
  }

  .delegation-context__badge {
    display: none;
  }

  .delegation-stepper {
    padding: 12px 16px 10px;
  }

  .delegation-stepper :deep(button[data-slot="trigger"]) {
    width: 44px;
    height: 44px;
  }

  .delegation-form {
    padding: 18px 16px 24px;
  }

  .delegation-form :deep(input),
  .delegation-form :deep(button[role="combobox"]) {
    min-height: 44px;
  }

  .delegation-suggestions button,
  .delegation-due-date__presets button {
    min-height: 44px;
    padding: 8px 12px;
  }

  .delegation-form--assignee {
    display: block;
    min-height: 0;
    padding: 18px 16px 24px;
  }

  .delegation-form--assignee .delegation-form__main {
    padding: 0;
  }

  .delegation-form--assignee .delegation-panel__heading p {
    display: block;
  }

  .delegation-form--assignee .delegation-directory__list {
    max-height: 238px;
  }

  .delegation-assignee-summary {
    display: none;
  }

  .delegation-priority > div,
  .delegation-recent__grid,
  .delegation-access__grid {
    grid-template-columns: 1fr 1fr;
  }

  .delegation-directory__meta {
    display: none;
  }

  .delegation-directory__person {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .delegation-schedule-mode {
    grid-template-columns: 1fr;
  }

  .delegation-slot-picker {
    padding: 12px;
  }

  .delegation-selected-appointment {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .delegation-selected-appointment > :last-child {
    grid-column: 1 / -1;
    width: 100%;
    justify-content: center;
  }

  .delegation-due-date {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .delegation-footer {
    padding: 12px 16px max(12px, env(safe-area-inset-bottom));
  }

  .delegation-footer > p {
    display: none;
  }

  .delegation-footer > div {
    width: 100%;
  }

  .delegation-footer > div > :deep(button) {
    flex: 1;
    justify-content: center;
    min-height: 44px;
  }

  .delegation-success {
    padding: 42px 18px;
  }
}

@media (max-width: 430px) {
  .delegation-priority > div,
  .delegation-access__grid {
    grid-template-columns: 1fr;
  }

  .delegation-schedule-context {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .delegation-schedule-context > :last-child {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .delegation-step-enter-active,
  .delegation-step-leave-active {
    transition: none;
  }
}
</style>
