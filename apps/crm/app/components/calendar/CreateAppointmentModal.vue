<script setup lang="ts">
import type { ClientListItem } from '~/types/clients'
import type {
  BookingService,
  CalendarEntryType,
  ExpertTimeOff,
  Facility,
  FacilityListPayload,
  FacilityMember,
  FacilityMembersPayload,
  FacilityServicesPayload,
  OrganizationMembersPayload,
} from '~/types/scheduling'

type StaffAppointmentSlot = {
  startsAt: string
  endsAt: string
  expertUserId: string
  expertName: string
}

type CreatedStaffAppointment = {
  id: string
  facilityId: string
  serviceId: string
  expertUserId: string
  clientId: string
  startsAt: string
  endsAt: string
  timezone: string
  status: string
  meetingMode: 'office' | 'online'
  meetingUrl: string | null
  customerName: string
}

type CreatedCalendarEntry = {
  kind: 'appointment' | 'vacation'
  expertUserId: string
  startsAt: string
  appointment?: CreatedStaffAppointment
  timeOff?: ExpertTimeOff
}

type FacilityAppointmentContext = {
  services: BookingService[]
  members: FacilityMember[]
}

const props = withDefaults(defineProps<{
  open: boolean
  facilityId?: string
  initialDate?: string
  initialExpertId?: string
}>(), {
  facilityId: '',
  initialDate: '',
  initialExpertId: '',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': [entry: CreatedCalendarEntry]
}>()

const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()

const entryType = ref<CalendarEntryType>('office')
const facilities = ref<Facility[]>([])
const defaultFacilityId = ref<string | null>(null)
const organizationMembers = ref<OrganizationMembersPayload>({
  currentUserId: '',
  role: 'expert',
  canAssignOthers: false,
  members: [],
})
const services = ref<BookingService[]>([])
const members = ref<FacilityMember[]>([])
const slots = ref<StaffAppointmentSlot[]>([])
const selectedClient = ref<ClientListItem | null>(null)
const selectedSlot = ref<StaffAppointmentSlot | null>(null)
const facilitiesPending = ref(false)
const contextPending = ref(false)
const slotsPending = ref(false)
const saving = ref(false)
const setupError = ref('')
const vacationSetupError = ref('')
const slotsError = ref('')
const submitError = ref('')
const idempotencyIntent = ref('')

const form = reactive({
  facilityId: '',
  serviceId: '',
  expertUserId: '',
  localDate: '',
  meetingUrl: '',
  vacationStartsOn: '',
  vacationEndsOn: '',
  notes: '',
  idempotencyKey: '',
})

const openModel = computed({
  get: () => props.open,
  set: (value) => {
    if (!value && saving.value) return
    emit('update:open', value)
  },
})

let facilitiesRequestId = 0
let contextRequestId = 0
let slotsRequestId = 0
let submitRequestId = 0
const facilityContextCache = new Map<string, FacilityAppointmentContext>()

const entryTypeItems: Array<{
  value: CalendarEntryType
  label: string
  description: string
  icon: string
}> = [
  {
    value: 'office',
    label: 'W biurze',
    description: 'Wizyta klienta w wybranej placówce.',
    icon: 'i-lucide-building-2',
  },
  {
    value: 'online',
    label: 'Online',
    description: 'Rozmowa wideo lub spotkanie pod linkiem.',
    icon: 'i-lucide-video',
  },
  {
    value: 'vacation',
    label: 'Urlop',
    description: 'Całodniowa blokada dostępności eksperta.',
    icon: 'i-lucide-plane',
  },
]

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year!, month! - 1, day!, 12)
  return date.getFullYear() === year
    && date.getMonth() === month! - 1
    && date.getDate() === day
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year!, month! - 1, day!, 0, 0, 0, 0)
}

function addDaysToKey(value: string, days: number) {
  const date = dateFromKey(value)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

function dateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Warsaw'
}

function memberLabel(member: FacilityMember) {
  return member.user?.full_name || member.user?.email || 'Ekspert'
}

const availableFacilities = computed(() => facilities.value.filter(facility => facility.is_active))
const facilityItems = computed(() => availableFacilities.value.map(facility => ({
  label: facility.city ? `${facility.name} · ${facility.city}` : facility.name,
  value: facility.id,
})))
const selectedFacility = computed(() => facilities.value.find(facility => (
  facility.id === form.facilityId
)) ?? null)
const hasFixedFacility = computed(() => Boolean(
  props.facilityId
  && availableFacilities.value.some(facility => facility.id === props.facilityId),
))
const showFacilitySelect = computed(() => (
  entryType.value !== 'vacation'
  && !hasFixedFacility.value
  && availableFacilities.value.length > 1
))
const showFacilitySummary = computed(() => (
  entryType.value === 'office'
  && !showFacilitySelect.value
  && Boolean(selectedFacility.value)
))
const activeServices = computed(() => services.value.filter(service => (
  service.is_active && service.isAvailable
)))
const selectedService = computed(() => activeServices.value.find(service => (
  service.id === form.serviceId
)) ?? null)
const bookableMembers = computed(() => members.value.filter(member => member.is_bookable))
const expertItems = computed(() => {
  const allowedExpertIds = new Set(selectedService.value?.expertUserIds ?? [])
  return bookableMembers.value
    .filter(member => allowedExpertIds.has(member.user_id))
    .map(member => ({
      label: memberLabel(member),
      value: member.user_id,
    }))
})
const vacationExpertItems = computed(() => {
  const membersList = organizationMembers.value.canAssignOthers
    ? organizationMembers.value.members
    : organizationMembers.value.members.filter(member => (
        member.userId === organizationMembers.value.currentUserId
      ))
  return membersList.map(member => ({
    label: member.userId === organizationMembers.value.currentUserId
      ? `${member.fullName || member.email} · Ty`
      : member.fullName || member.email,
    value: member.userId,
  }))
})
const minimumDate = computed(() => dateInTimezone(
  selectedFacility.value?.timezone || browserTimezone(),
))
const vacationTimezone = computed(() => (
  selectedFacility.value?.timezone || browserTimezone()
))
const selectedEntryType = computed(() => (
  entryTypeItems.find(item => item.value === entryType.value) ?? entryTypeItems[0]!
))
const canSubmitAppointment = computed(() => Boolean(
  selectedClient.value
  && selectedSlot.value
  && form.facilityId
  && form.serviceId
  && form.expertUserId,
))
const canSubmitVacation = computed(() => Boolean(
  form.expertUserId
  && isDateKey(form.vacationStartsOn)
  && isDateKey(form.vacationEndsOn)
  && form.vacationEndsOn >= form.vacationStartsOn,
))
const canSubmit = computed(() => (
  entryType.value === 'vacation'
    ? canSubmitVacation.value
    : canSubmitAppointment.value
))

function initialLocalDate(timezone: string) {
  const today = dateInTimezone(timezone)
  if (!isDateKey(props.initialDate)) return today
  return props.initialDate < today ? today : props.initialDate
}

function resetState() {
  contextRequestId += 1
  slotsRequestId += 1
  submitRequestId += 1
  facilityContextCache.clear()
  saving.value = false
  entryType.value = 'office'
  facilities.value = []
  defaultFacilityId.value = null
  services.value = []
  members.value = []
  slots.value = []
  selectedClient.value = null
  selectedSlot.value = null
  setupError.value = ''
  vacationSetupError.value = ''
  slotsError.value = ''
  submitError.value = ''
  idempotencyIntent.value = ''
  Object.assign(form, {
    facilityId: '',
    serviceId: '',
    expertUserId: '',
    localDate: '',
    meetingUrl: '',
    vacationStartsOn: '',
    vacationEndsOn: '',
    notes: '',
    idempotencyKey: '',
  })
}

async function fetchFacilityContext(facilityId: string): Promise<FacilityAppointmentContext> {
  const cachedContext = facilityContextCache.get(facilityId)
  if (cachedContext) return cachedContext

  const encodedFacilityId = encodeURIComponent(facilityId)
  const [servicesPayload, membersPayload] = await Promise.all([
    $fetch<FacilityServicesPayload>(orgApiPath(`/facilities/${encodedFacilityId}/services`)),
    $fetch<FacilityMembersPayload>(orgApiPath(`/facilities/${encodedFacilityId}/members`)),
  ])
  const context = {
    services: servicesPayload.data ?? [],
    members: membersPayload.data ?? [],
  }
  facilityContextCache.set(facilityId, context)
  return context
}

async function facilitySupportsExpert(facility: Facility, expertUserId: string) {
  if (!expertUserId) return true
  try {
    const context = await fetchFacilityContext(facility.id)
    return context.members.some(member => (
      member.user_id === expertUserId && member.is_bookable
    )) && context.services.some(service => (
      service.is_active
      && service.isAvailable
      && service.expertUserIds.includes(expertUserId)
    ))
  } catch {
    return false
  }
}

async function resolveInitialFacility(requestId: number) {
  const requestedFacility = availableFacilities.value.find(facility => (
    facility.id === props.facilityId
  ))
  if (requestedFacility) return requestedFacility

  const preferredFacility = availableFacilities.value.find(facility => (
    facility.id === defaultFacilityId.value
  ))
  if (
    preferredFacility
    && await facilitySupportsExpert(preferredFacility, props.initialExpertId)
  ) {
    return preferredFacility
  }
  if (requestId !== facilitiesRequestId || !openModel.value) return null

  if (availableFacilities.value.length === 1) {
    return availableFacilities.value[0] ?? null
  }
  return null
}

function selectVacationExpert() {
  const requestedExpert = vacationExpertItems.value.find(item => (
    item.value === props.initialExpertId
  ))
  const currentUser = vacationExpertItems.value.find(item => (
    item.value === organizationMembers.value.currentUserId
  ))
  form.expertUserId = requestedExpert?.value
    ?? currentUser?.value
    ?? vacationExpertItems.value[0]?.value
    ?? ''
}

async function initialize() {
  resetState()
  const requestId = ++facilitiesRequestId
  facilitiesPending.value = true
  try {
    const [facilityResult, membersResult] = await Promise.allSettled([
      $fetch<FacilityListPayload>(orgApiPath('/facilities')),
      $fetch<OrganizationMembersPayload>(orgApiPath('/members')),
    ])
    if (requestId !== facilitiesRequestId || !openModel.value) return

    if (facilityResult.status === 'fulfilled') {
      facilities.value = facilityResult.value.data ?? []
      defaultFacilityId.value = facilityResult.value.defaultFacilityId ?? null
    } else {
      setupError.value = apiErrorMessage(facilityResult.reason)
    }
    if (membersResult.status === 'fulfilled') {
      organizationMembers.value = membersResult.value
      selectVacationExpert()
    } else {
      vacationSetupError.value = apiErrorMessage(membersResult.reason)
    }

    const facility = facilityResult.status === 'fulfilled'
      ? await resolveInitialFacility(requestId)
      : null
    if (requestId !== facilitiesRequestId || !openModel.value) return
    const timezone = facility?.timezone || browserTimezone()
    const date = initialLocalDate(timezone)
    form.localDate = date
    form.vacationStartsOn = isDateKey(props.initialDate) ? props.initialDate : date
    form.vacationEndsOn = form.vacationStartsOn
    form.facilityId = facility?.id ?? ''
  } catch (error: unknown) {
    if (requestId !== facilitiesRequestId) return
    setupError.value = apiErrorMessage(error)
  } finally {
    if (requestId === facilitiesRequestId) facilitiesPending.value = false
  }
}

async function loadFacilityContext(facilityId: string) {
  const requestId = ++contextRequestId
  services.value = []
  members.value = []
  slots.value = []
  selectedSlot.value = null
  slotsError.value = ''
  form.serviceId = ''
  if (!facilityId || !openModel.value || entryType.value === 'vacation') {
    contextPending.value = false
    return
  }

  contextPending.value = true
  try {
    const context = await fetchFacilityContext(facilityId)
    if (requestId !== contextRequestId || !openModel.value) return
    services.value = context.services
    members.value = context.members
    const requestedService = activeServices.value.find(service => (
      service.expertUserIds.includes(props.initialExpertId)
    ))
    form.serviceId = requestedService?.id ?? activeServices.value[0]?.id ?? ''
    const requestedExpert = expertItems.value.find(item => item.value === props.initialExpertId)
    form.expertUserId = requestedExpert?.value ?? expertItems.value[0]?.value ?? ''
  } catch (error: unknown) {
    if (requestId !== contextRequestId) return
    setupError.value = apiErrorMessage(error)
  } finally {
    if (requestId === contextRequestId) contextPending.value = false
  }
}

async function loadSlots() {
  const requestId = ++slotsRequestId
  selectedSlot.value = null
  slots.value = []
  slotsError.value = ''
  if (
    !openModel.value
    || entryType.value === 'vacation'
    || !form.facilityId
    || !form.serviceId
    || !form.expertUserId
    || !form.localDate
  ) {
    slotsPending.value = false
    return
  }

  slotsPending.value = true
  try {
    const payload = await $fetch<{ slots: StaffAppointmentSlot[] }>(
      orgApiPath(`/facilities/${encodeURIComponent(form.facilityId)}/appointment-slots`),
      {
        query: {
          serviceId: form.serviceId,
          expertUserId: form.expertUserId,
          date: form.localDate,
        },
      },
    )
    if (requestId !== slotsRequestId || !openModel.value) return
    slots.value = payload.slots ?? []
  } catch (error: unknown) {
    if (requestId !== slotsRequestId) return
    slotsError.value = apiErrorMessage(error)
  } finally {
    if (requestId === slotsRequestId) slotsPending.value = false
  }
}

function slotTime(slot: StaffAppointmentSlot) {
  return new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: selectedFacility.value?.timezone || 'Europe/Warsaw',
  }).format(new Date(slot.startsAt))
}

function selectEntryType(value: CalendarEntryType) {
  if (saving.value) return
  entryType.value = value
  submitError.value = ''
  if (value === 'vacation') {
    contextRequestId += 1
    slotsRequestId += 1
    contextPending.value = false
    slotsPending.value = false
    selectedSlot.value = null
    slots.value = []
    selectVacationExpert()
    return
  }
  if (!form.facilityId) {
    const preferred = availableFacilities.value.find(facility => (
      facility.id === defaultFacilityId.value
    ))
    const only = availableFacilities.value.length === 1 ? availableFacilities.value[0] : null
    form.facilityId = preferred?.id ?? only?.id ?? ''
  } else {
    void loadFacilityContext(form.facilityId)
  }
}

async function createAppointment() {
  const client = selectedClient.value
  const slot = selectedSlot.value
  if (!client || !slot || !canSubmitAppointment.value || saving.value) return

  const meetingMode = entryType.value === 'online' ? 'online' : 'office'
  const meetingUrl = meetingMode === 'online' ? form.meetingUrl.trim() || null : null
  const intent = JSON.stringify({
    facilityId: form.facilityId,
    serviceId: form.serviceId,
    expertUserId: form.expertUserId,
    clientId: client.id,
    startsAt: slot.startsAt,
    meetingMode,
    meetingUrl,
    notes: form.notes.trim() || null,
  })
  if (idempotencyIntent.value !== intent) {
    idempotencyIntent.value = intent
    form.idempotencyKey = crypto.randomUUID()
  }

  const requestId = ++submitRequestId
  saving.value = true
  submitError.value = ''
  try {
    const result = await $fetch<{ appointment: CreatedStaffAppointment }>(
      orgApiPath('/appointments'),
      {
        method: 'POST',
        body: {
          facilityId: form.facilityId,
          serviceId: form.serviceId,
          expertUserId: form.expertUserId,
          clientId: client.id,
          startsAt: slot.startsAt,
          meetingMode,
          meetingUrl,
          notes: form.notes.trim() || null,
          idempotencyKey: form.idempotencyKey,
        },
      },
    )
    if (requestId !== submitRequestId || !openModel.value) return
    emit('created', {
      kind: 'appointment',
      expertUserId: result.appointment.expertUserId,
      startsAt: result.appointment.startsAt,
      appointment: result.appointment,
    })
    emit('update:open', false)
    toast.add({
      title: meetingMode === 'online'
        ? 'Spotkanie online zostało umówione'
        : 'Spotkanie w biurze zostało umówione',
      description: `${client.display_name} · ${slotTime(slot)}`,
      color: 'success',
      icon: meetingMode === 'online'
        ? 'i-lucide-video'
        : 'i-lucide-calendar-check-2',
    })
  } catch (error: unknown) {
    if (requestId !== submitRequestId) return
    submitError.value = apiErrorMessage(error)
    toast.add({
      title: 'Nie udało się umówić spotkania',
      description: submitError.value,
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    const candidate = error as {
      statusCode?: number
      status?: number
      response?: { status?: number }
      data?: { statusMessage?: string }
      message?: string
    }
    const statusCode = Number(
      candidate.statusCode ?? candidate.status ?? candidate.response?.status ?? 0,
    )
    const detail = candidate.data?.statusMessage || candidate.message || ''
    if (statusCode === 409 && /slot|termin|available/i.test(detail)) {
      await loadSlots()
    }
  } finally {
    if (requestId === submitRequestId) saving.value = false
  }
}

async function createVacation() {
  if (!canSubmitVacation.value || saving.value) return
  const requestId = ++submitRequestId
  saving.value = true
  submitError.value = ''
  try {
    const result = await $fetch<{ timeOff: ExpertTimeOff }>(orgApiPath('/time-off'), {
      method: 'POST',
      body: {
        expertUserId: form.expertUserId,
        startsOn: form.vacationStartsOn,
        endsOn: form.vacationEndsOn,
        timezone: vacationTimezone.value,
        allDay: true,
        notes: form.notes.trim() || null,
      },
    })
    if (requestId !== submitRequestId || !openModel.value) return
    emit('created', {
      kind: 'vacation',
      expertUserId: result.timeOff.expert_user_id,
      startsAt: result.timeOff.starts_at,
      timeOff: result.timeOff,
    })
    emit('update:open', false)
    toast.add({
      title: 'Urlop został dodany',
      description: form.vacationStartsOn === form.vacationEndsOn
        ? form.vacationStartsOn
        : `${form.vacationStartsOn} – ${form.vacationEndsOn}`,
      color: 'success',
      icon: 'i-lucide-plane',
    })
  } catch (error: unknown) {
    if (requestId !== submitRequestId) return
    submitError.value = apiErrorMessage(error)
    toast.add({
      title: 'Nie udało się dodać urlopu',
      description: submitError.value,
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    if (requestId === submitRequestId) saving.value = false
  }
}

async function submit() {
  if (entryType.value === 'vacation') {
    await createVacation()
    return
  }
  await createAppointment()
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    void initialize()
    return
  }
  facilitiesRequestId += 1
  contextRequestId += 1
  slotsRequestId += 1
  submitRequestId += 1
  saving.value = false
}, { immediate: true })

watch(() => form.facilityId, (facilityId) => {
  if (!openModel.value || entryType.value === 'vacation') return
  const facility = facilities.value.find(item => item.id === facilityId)
  if (facility) form.localDate = initialLocalDate(facility.timezone)
  void loadFacilityContext(facilityId)
})

watch(expertItems, (items) => {
  if (entryType.value === 'vacation') return
  if (items.some(item => item.value === form.expertUserId)) return
  const requestedExpert = items.find(item => item.value === props.initialExpertId)
  form.expertUserId = requestedExpert?.value ?? items[0]?.value ?? ''
})

watch(
  () => [entryType.value, form.serviceId, form.expertUserId, form.localDate],
  () => { void loadSlots() },
)

watch(() => form.vacationStartsOn, (startsOn) => {
  if (form.vacationEndsOn < startsOn) form.vacationEndsOn = startsOn
})
</script>

<template>
  <UModal
    v-model:open="openModel"
    title="Nowe zdarzenie"
    :description="selectedEntryType.description"
    :dismissible="!saving"
    :ui="{ content: 'sm:max-w-4xl', footer: 'justify-end' }"
  >
    <template #body>
      <form id="create-calendar-entry-form" class="calendar-entry-form" @submit.prevent="submit">
        <section class="calendar-entry-types" aria-labelledby="calendar-entry-type-label">
          <div>
            <span id="calendar-entry-type-label">Typ zdarzenia</span>
            <small>Wybierz, co chcesz dodać do kalendarza.</small>
          </div>
          <div class="calendar-entry-types__grid" role="radiogroup" aria-label="Typ zdarzenia">
            <button
              v-for="item in entryTypeItems"
              :key="item.value"
              type="button"
              class="calendar-entry-type"
              :class="{ 'calendar-entry-type--selected': entryType === item.value }"
              role="radio"
              :aria-checked="entryType === item.value"
              @click="selectEntryType(item.value)"
            >
              <span><UIcon :name="item.icon" /></span>
              <strong>{{ item.label }}</strong>
              <small>{{ item.description }}</small>
            </button>
          </div>
        </section>

        <div v-if="facilitiesPending" class="calendar-entry-loading">
          <USkeleton class="h-24 w-full" />
          <USkeleton class="h-44 w-full" />
          <USkeleton class="h-36 w-full" />
        </div>

        <UAlert
          v-else-if="entryType === 'vacation' && vacationSetupError"
          color="error"
          variant="subtle"
          icon="i-lucide-users-round"
          title="Nie udało się pobrać ekspertów"
          :description="vacationSetupError"
          :actions="[{ label: 'Spróbuj ponownie', onClick: initialize }]"
        />

        <UAlert
          v-else-if="entryType !== 'vacation' && setupError"
          color="error"
          variant="subtle"
          icon="i-lucide-calendar-x-2"
          title="Nie udało się przygotować formularza"
          :description="setupError"
          :actions="[{ label: 'Spróbuj ponownie', onClick: initialize }]"
        />

        <template v-else-if="entryType === 'vacation'">
          <section class="calendar-entry-section">
            <div class="calendar-entry-section__heading">
              <span><UIcon name="i-lucide-plane" /></span>
              <div>
                <h3>Termin urlopu</h3>
                <p>Każdy dzień włącznie z datą końcową zostanie wyłączony z dostępności.</p>
              </div>
            </div>
            <div class="calendar-entry-grid">
              <UFormField name="vacationExpert" label="Ekspert" required>
                <USelect
                  v-model="form.expertUserId"
                  class="w-full"
                  :items="vacationExpertItems"
                  value-key="value"
                  :disabled="vacationExpertItems.length <= 1"
                  placeholder="Wybierz eksperta"
                />
              </UFormField>
              <UFormField name="vacationStartsOn" label="Od" required>
                <UInput v-model="form.vacationStartsOn" class="w-full" type="date" />
              </UFormField>
              <UFormField name="vacationEndsOn" label="Do (włącznie)" required>
                <UInput
                  v-model="form.vacationEndsOn"
                  class="w-full"
                  type="date"
                  :min="form.vacationStartsOn"
                />
              </UFormField>
            </div>
            <UAlert
              color="info"
              variant="subtle"
              icon="i-lucide-calendar-x-2"
              title="Urlop zablokuje rezerwacje"
              :description="`W tym okresie klient nie zobaczy wolnych terminów tego eksperta w żadnej placówce. Strefa: ${vacationTimezone}.`"
            />
          </section>

          <UFormField name="vacationNotes" label="Notatka prywatna" hint="Opcjonalnie">
            <UTextarea
              v-model="form.notes"
              class="w-full"
              :rows="3"
              autoresize
              :maxrows="6"
              maxlength="2000"
            />
          </UFormField>
        </template>

        <UAlert
          v-else-if="!availableFacilities.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-building-2"
          title="Brak aktywnej placówki"
          description="Spotkanie potrzebuje placówki jako kontekstu grafiku i usługi."
          :actions="[{ label: 'Przejdź do placówek', to: orgPath('/facilities') }]"
        />

        <template v-else>
          <section class="calendar-entry-section">
            <div class="calendar-entry-section__heading">
              <span>1</span>
              <div>
                <h3>Klient</h3>
                <p>Znajdź klienta po danych kontaktowych lub danych osoby.</p>
              </div>
            </div>
            <UFormField name="appointmentClient" label="Klient" required>
              <ClientPicker v-model="selectedClient" autofocus required />
            </UFormField>
            <p class="calendar-entry-client-link">
              Nie ma klienta?
              <NuxtLink :to="orgPath('/clients')">Dodaj go w CRM</NuxtLink>
            </p>
          </section>

          <section class="calendar-entry-section">
            <div class="calendar-entry-section__heading">
              <span>2</span>
              <div>
                <h3>{{ entryType === 'online' ? 'Grafik i ekspert' : 'Miejsce i ekspert' }}</h3>
                <p>Dostępność uwzględnia grafik eksperta, usługę i kalendarze zewnętrzne.</p>
              </div>
            </div>

            <div
              v-if="showFacilitySummary"
              class="calendar-entry-facility-summary"
            >
              <UIcon name="i-lucide-building-2" />
              <div>
                <span>Placówka</span>
                <strong>{{ selectedFacility?.name }}</strong>
                <small v-if="selectedFacility?.city">{{ selectedFacility.city }}</small>
              </div>
            </div>

            <div
              v-else-if="entryType === 'online' && selectedFacility && !showFacilitySelect"
              class="calendar-entry-context"
            >
              <UIcon name="i-lucide-calendar-range" />
              Grafik i usługi: <strong>{{ selectedFacility.name }}</strong>
            </div>

            <div class="calendar-entry-grid">
              <UFormField
                v-if="showFacilitySelect"
                name="appointmentFacility"
                :label="entryType === 'online' ? 'Placówka grafiku' : 'Placówka'"
                required
              >
                <USelect
                  v-model="form.facilityId"
                  class="w-full"
                  :items="facilityItems"
                  value-key="value"
                  placeholder="Wybierz placówkę"
                />
              </UFormField>
              <UFormField name="appointmentExpert" label="Ekspert" required>
                <USelect
                  v-model="form.expertUserId"
                  class="w-full"
                  :items="expertItems"
                  value-key="value"
                  :loading="contextPending"
                  :disabled="contextPending || !expertItems.length"
                  placeholder="Wybierz eksperta"
                />
              </UFormField>
              <UFormField name="appointmentDate" label="Data" required>
                <UInput
                  v-model="form.localDate"
                  class="w-full"
                  type="date"
                  :min="minimumDate"
                />
              </UFormField>
            </div>

            <UFormField
              v-if="entryType === 'online'"
              name="appointmentMeetingUrl"
              label="Link do spotkania"
              hint="Opcjonalnie — np. link z OpenExpert Meet, Google Meet lub Teams"
            >
              <UInput
                v-model="form.meetingUrl"
                class="w-full"
                type="url"
                inputmode="url"
                icon="i-lucide-link-2"
                placeholder="https://meet.example.com/pokoj"
                maxlength="2000"
              />
            </UFormField>

            <UAlert
              v-if="!contextPending && form.facilityId && !activeServices.length"
              color="warning"
              variant="subtle"
              icon="i-lucide-briefcase-business"
              title="Brak usługi spotkania"
              description="W wybranej placówce nie ma aktywnej usługi przypisanej do eksperta."
            />
          </section>

          <section class="calendar-entry-section">
            <div class="calendar-entry-section__heading">
              <span>3</span>
              <div>
                <h3>Dostępny termin</h3>
                <p>Wybierz konkretną godzinę spotkania.</p>
              </div>
            </div>

            <div v-if="slotsPending" class="calendar-entry-slot-grid">
              <USkeleton v-for="index in 6" :key="index" class="h-14 w-full" />
            </div>
            <UAlert
              v-else-if="slotsError"
              color="error"
              variant="subtle"
              :description="slotsError"
              :actions="[{ label: 'Odśwież terminy', onClick: loadSlots }]"
            />
            <div
              v-else-if="slots.length"
              class="calendar-entry-slot-grid"
              role="radiogroup"
              aria-label="Dostępne terminy"
            >
              <button
                v-for="slot in slots"
                :key="`${slot.startsAt}-${slot.expertUserId}`"
                type="button"
                class="calendar-entry-slot"
                :class="{ 'calendar-entry-slot--selected': selectedSlot?.startsAt === slot.startsAt && selectedSlot?.expertUserId === slot.expertUserId }"
                role="radio"
                :aria-checked="selectedSlot?.startsAt === slot.startsAt && selectedSlot?.expertUserId === slot.expertUserId"
                @click="selectedSlot = slot"
              >
                <strong>{{ slotTime(slot) }}</strong>
                <small>{{ slot.expertName }}</small>
              </button>
            </div>
            <div v-else class="calendar-entry-empty">
              <UIcon name="i-lucide-calendar-x-2" />
              <p>{{ form.facilityId ? 'Brak wolnych terminów dla wybranego dnia.' : 'Najpierw wybierz placówkę.' }}</p>
            </div>
          </section>

          <UFormField name="appointmentNotes" label="Notatka do spotkania" hint="Opcjonalnie">
            <UTextarea
              v-model="form.notes"
              class="w-full"
              :rows="3"
              autoresize
              :maxrows="6"
              maxlength="2000"
            />
          </UFormField>
        </template>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="entryType === 'vacation' ? 'Nie udało się zapisać urlopu' : 'Nie udało się zapisać spotkania'"
          :description="submitError"
        />
      </form>
    </template>

    <template #footer="{ close }">
      <UButton color="neutral" variant="ghost" :disabled="saving" @click="close">
        Anuluj
      </UButton>
      <UButton
        type="submit"
        form="create-calendar-entry-form"
        :icon="entryType === 'vacation' ? 'i-lucide-calendar-x-2' : entryType === 'online' ? 'i-lucide-video' : 'i-lucide-calendar-check-2'"
        :disabled="saving || facilitiesPending || (entryType !== 'vacation' && (contextPending || slotsPending)) || !canSubmit"
        :loading="saving"
      >
        {{ entryType === 'vacation' ? 'Dodaj urlop' : 'Umów spotkanie' }}
      </UButton>
    </template>
  </UModal>
</template>

<style scoped>
.calendar-entry-form,
.calendar-entry-loading {
  display: grid;
  gap: 16px;
}

.calendar-entry-types {
  display: grid;
  gap: 10px;
}

.calendar-entry-types > div:first-child {
  display: grid;
  gap: 2px;
}

.calendar-entry-types > div:first-child span {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 700;
}

.calendar-entry-types > div:first-child small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.calendar-entry-types__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}

.calendar-entry-type {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 9px;
  padding: 13px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
  transition:
    border-color var(--oe-motion-fast),
    background var(--oe-motion-fast),
    box-shadow var(--oe-motion-fast);
}

.calendar-entry-type:hover,
.calendar-entry-type--selected {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
}

.calendar-entry-type--selected {
  box-shadow: inset 0 0 0 1px var(--ui-primary);
}

.calendar-entry-type > span {
  display: grid;
  grid-row: span 2;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--ui-bg-muted);
  color: var(--ui-primary);
}

.calendar-entry-type strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.calendar-entry-type small {
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.35;
}

.calendar-entry-section {
  display: grid;
  gap: 14px;
  padding: 17px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.calendar-entry-section__heading {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.calendar-entry-section__heading > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 27px;
  height: 27px;
  border-radius: 999px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.calendar-entry-section__heading h3,
.calendar-entry-section__heading p {
  margin: 0;
}

.calendar-entry-section__heading h3 {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.calendar-entry-section__heading p {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.calendar-entry-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.calendar-entry-facility-summary,
.calendar-entry-context {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg);
}

.calendar-entry-facility-summary > .iconify,
.calendar-entry-context > .iconify {
  width: 18px;
  height: 18px;
  color: var(--ui-primary);
}

.calendar-entry-facility-summary > div {
  display: grid;
  gap: 1px;
}

.calendar-entry-facility-summary span,
.calendar-entry-facility-summary small,
.calendar-entry-context {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.calendar-entry-facility-summary strong,
.calendar-entry-context strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.calendar-entry-client-link {
  margin: -3px 0 0;
  color: var(--ui-text-dimmed);
  font-size: 11px;
}

.calendar-entry-client-link a {
  color: var(--ui-text);
  font-weight: 650;
  text-decoration: underline;
  text-decoration-color: var(--ui-border-accented);
  text-underline-offset: 3px;
}

.calendar-entry-slot-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.calendar-entry-slot {
  display: grid;
  gap: 2px;
  min-height: 54px;
  padding: 9px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
  transition:
    border-color var(--oe-motion-fast),
    background var(--oe-motion-fast);
}

.calendar-entry-slot:hover,
.calendar-entry-slot--selected {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
}

.calendar-entry-slot--selected {
  box-shadow: inset 0 0 0 1px var(--ui-primary);
}

.calendar-entry-slot strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.calendar-entry-slot small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.calendar-entry-empty {
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 18px;
  color: var(--ui-text-muted);
  text-align: center;
}

.calendar-entry-empty .iconify {
  width: 22px;
  height: 22px;
}

.calendar-entry-empty p {
  margin: 0;
  font-size: 11px;
}

@media (max-width: 720px) {
  .calendar-entry-types__grid,
  .calendar-entry-grid {
    grid-template-columns: 1fr;
  }

  .calendar-entry-slot-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
