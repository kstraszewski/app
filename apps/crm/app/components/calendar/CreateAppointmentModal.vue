<script setup lang="ts">
import type { ClientListItem } from '~/types/clients'
import type {
  BookingService,
  Facility,
  FacilityListPayload,
  FacilityMember,
  FacilityMembersPayload,
  FacilityServicesPayload,
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
  customerName: string
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
  'created': [appointment: CreatedStaffAppointment]
}>()

const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()

const facilities = ref<Facility[]>([])
const services = ref<BookingService[]>([])
const members = ref<FacilityMember[]>([])
const slots = ref<StaffAppointmentSlot[]>([])
const selectedClient = ref<ClientListItem | null>(null)
const selectedSlot = ref<StaffAppointmentSlot | null>(null)
const facilitiesPending = ref(false)
const contextPending = ref(false)
const slotsPending = ref(false)
const saving = ref(false)
const openModel = computed({
  get: () => props.open,
  set: (value) => {
    if (!value && saving.value) return
    emit('update:open', value)
  },
})
const setupError = ref('')
const slotsError = ref('')
const submitError = ref('')
const idempotencyIntent = ref('')
const form = reactive({
  facilityId: '',
  serviceId: '',
  expertUserId: '',
  localDate: '',
  notes: '',
  idempotencyKey: '',
})

let facilitiesRequestId = 0
let contextRequestId = 0
let slotsRequestId = 0
let submitRequestId = 0
const facilityContextCache = new Map<string, FacilityAppointmentContext>()

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
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
const minimumDate = computed(() => dateInTimezone(
  selectedFacility.value?.timezone || 'Europe/Warsaw',
))
const canSubmit = computed(() => Boolean(
  selectedClient.value
  && selectedSlot.value
  && form.facilityId
  && form.serviceId
  && form.expertUserId,
))

function resetState() {
  contextRequestId += 1
  slotsRequestId += 1
  submitRequestId += 1
  facilityContextCache.clear()
  saving.value = false
  services.value = []
  members.value = []
  slots.value = []
  selectedClient.value = null
  selectedSlot.value = null
  setupError.value = ''
  slotsError.value = ''
  submitError.value = ''
  idempotencyIntent.value = ''
  Object.assign(form, {
    facilityId: '',
    serviceId: '',
    expertUserId: '',
    localDate: '',
    notes: '',
    idempotencyKey: '',
  })
}

function initialLocalDate(timezone: string) {
  const today = dateInTimezone(timezone)
  if (!isDateKey(props.initialDate)) return today
  return props.initialDate < today ? today : props.initialDate
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

async function findFacilityForExpert(
  candidates: Facility[],
  expertUserId: string,
  facilitiesLoadId: number,
) {
  if (!expertUserId) return null

  for (const facility of candidates) {
    if (facilitiesLoadId !== facilitiesRequestId || !openModel.value) return null
    try {
      const context = await fetchFacilityContext(facility.id)
      const isBookableMember = context.members.some(member => (
        member.user_id === expertUserId && member.is_bookable
      ))
      const hasAvailableService = context.services.some(service => (
        service.is_active
        && service.isAvailable
        && service.expertUserIds.includes(expertUserId)
      ))
      if (isBookableMember && hasAvailableService) return facility
    } catch {
      // A single inaccessible facility should not block the remaining choices.
    }
  }

  return null
}

async function initialize() {
  resetState()
  const requestId = ++facilitiesRequestId
  facilitiesPending.value = true
  try {
    const payload = await $fetch<FacilityListPayload>(orgApiPath('/facilities'))
    if (requestId !== facilitiesRequestId || !openModel.value) return
    facilities.value = payload.data ?? []
    const requestedFacility = availableFacilities.value.find(facility => facility.id === props.facilityId)
    const expertFacility = requestedFacility
      ? null
      : await findFacilityForExpert(
          availableFacilities.value,
          props.initialExpertId,
          requestId,
        )
    if (requestId !== facilitiesRequestId || !openModel.value) return
    const facility = requestedFacility ?? expertFacility ?? availableFacilities.value[0] ?? null
    if (!facility) return
    form.localDate = initialLocalDate(facility.timezone)
    form.facilityId = facility.id
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
  form.expertUserId = ''
  if (!facilityId || !openModel.value) {
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

async function createAppointment() {
  const client = selectedClient.value
  const slot = selectedSlot.value
  if (!client || !slot || !canSubmit.value || saving.value) return

  const intent = JSON.stringify({
    facilityId: form.facilityId,
    serviceId: form.serviceId,
    expertUserId: form.expertUserId,
    clientId: client.id,
    startsAt: slot.startsAt,
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
    const result = await $fetch<{ appointment: CreatedStaffAppointment }>(orgApiPath('/appointments'), {
      method: 'POST',
      body: {
        facilityId: form.facilityId,
        serviceId: form.serviceId,
        expertUserId: form.expertUserId,
        clientId: client.id,
        startsAt: slot.startsAt,
        notes: form.notes.trim() || null,
        idempotencyKey: form.idempotencyKey,
      },
    })
    if (requestId !== submitRequestId || !openModel.value) return
    emit('created', result.appointment)
    emit('update:open', false)
    toast.add({
      title: 'Spotkanie zostało umówione',
      description: `${client.display_name} · ${slotTime(slot)}`,
      color: 'success',
      icon: 'i-lucide-calendar-check-2',
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
  if (!openModel.value) return
  const facility = facilities.value.find(item => item.id === facilityId)
  if (facility) form.localDate = initialLocalDate(facility.timezone)
  void loadFacilityContext(facilityId)
})

watch(expertItems, (items) => {
  if (items.some(item => item.value === form.expertUserId)) return
  const requestedExpert = items.find(item => item.value === props.initialExpertId)
  form.expertUserId = requestedExpert?.value ?? items[0]?.value ?? ''
})

watch(
  () => [form.serviceId, form.expertUserId, form.localDate],
  () => { void loadSlots() },
)
</script>

<template>
  <UModal
    v-model:open="openModel"
    title="Umów spotkanie z klientem"
    description="Wybierz klienta CRM, placówkę, eksperta i dostępny termin."
    :dismissible="!saving"
    :ui="{ content: 'sm:max-w-4xl', footer: 'justify-end' }"
  >
    <template #body>
      <form id="create-calendar-appointment-form" class="appointment-create-form" @submit.prevent="createAppointment">
        <div v-if="facilitiesPending" class="appointment-create-loading">
          <USkeleton class="h-20 w-full" />
          <USkeleton class="h-44 w-full" />
          <USkeleton class="h-36 w-full" />
        </div>

        <UAlert
          v-else-if="setupError"
          color="error"
          variant="subtle"
          icon="i-lucide-calendar-x-2"
          title="Nie udało się przygotować formularza"
          :description="setupError"
          :actions="[{ label: 'Spróbuj ponownie', onClick: initialize }]"
        />

        <UAlert
          v-else-if="!availableFacilities.length"
          color="warning"
          variant="subtle"
          icon="i-lucide-building-2"
          title="Brak aktywnej placówki"
          description="Spotkanie musi być przypisane do aktywnej placówki."
          :actions="[{ label: 'Przejdź do placówek', to: orgPath('/facilities') }]"
        />

        <template v-else>
          <section class="appointment-create-section">
            <div class="appointment-create-section__heading">
              <span>1</span>
              <div>
                <h3>Klient</h3>
                <p>Znajdź klienta po danych kontaktowych lub danych osoby.</p>
              </div>
            </div>

            <UFormField name="appointmentClient" label="Klient" required>
            <ClientPicker v-model="selectedClient" autofocus required />
            </UFormField>
            <p class="appointment-create-client-link">
              Nie ma klienta?
              <NuxtLink :to="orgPath('/clients')">Dodaj go w CRM</NuxtLink>
            </p>
          </section>

          <section class="appointment-create-section">
            <div class="appointment-create-section__heading">
              <span>2</span>
              <div>
                <h3>Miejsce i ekspert</h3>
                <p>Dostępność uwzględnia godziny placówki, grafik eksperta i kalendarze zewnętrzne.</p>
              </div>
            </div>

            <div class="appointment-create-grid">
              <UFormField name="appointmentFacility" label="Placówka" required>
                <USelect
                  v-model="form.facilityId"
                  class="w-full"
                  :items="facilityItems"
                  value-key="value"
                  :disabled="Boolean(facilityId)"
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

            <UAlert
              v-if="!contextPending && form.facilityId && !activeServices.length"
              color="warning"
              variant="subtle"
              icon="i-lucide-briefcase-business"
              title="Brak usługi spotkania"
              description="W wybranej placówce nie ma aktywnej usługi przypisanej do eksperta."
            />
          </section>

          <section class="appointment-create-section">
            <div class="appointment-create-section__heading">
              <span>3</span>
              <div>
                <h3>Dostępny termin</h3>
                <p>Wybierz konkretną godzinę spotkania.</p>
              </div>
            </div>

            <div v-if="slotsPending" class="appointment-slot-grid">
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
              class="appointment-slot-grid"
              role="radiogroup"
              aria-label="Dostępne terminy"
            >
              <button
                v-for="slot in slots"
                :key="`${slot.startsAt}-${slot.expertUserId}`"
                type="button"
                class="appointment-slot"
                :class="{ 'appointment-slot--selected': selectedSlot?.startsAt === slot.startsAt && selectedSlot?.expertUserId === slot.expertUserId }"
                role="radio"
                :aria-checked="selectedSlot?.startsAt === slot.startsAt && selectedSlot?.expertUserId === slot.expertUserId"
                @click="selectedSlot = slot"
              >
                <strong>{{ slotTime(slot) }}</strong>
                <small>{{ slot.expertName }}</small>
              </button>
            </div>
            <div v-else class="appointment-create-empty">
              <UIcon name="i-lucide-calendar-x-2" />
              <p>Brak wolnych terminów dla wybranego dnia.</p>
            </div>
          </section>

          <UFormField name="appointmentNotes" label="Notatka do spotkania" hint="Opcjonalnie">
            <UTextarea v-model="form.notes" class="w-full" :rows="3" autoresize :maxrows="6" maxlength="2000" />
          </UFormField>

          <UAlert
            v-if="submitError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Nie udało się zapisać spotkania"
            :description="submitError"
          />
        </template>
      </form>
    </template>

    <template #footer="{ close }">
      <UButton color="neutral" variant="ghost" :disabled="saving" @click="close">Anuluj</UButton>
      <UButton
        type="submit"
        form="create-calendar-appointment-form"
        icon="i-lucide-calendar-check-2"
        :disabled="saving || facilitiesPending || contextPending || slotsPending || !canSubmit"
        :loading="saving"
      >
        Umów spotkanie
      </UButton>
    </template>
  </UModal>
</template>

<style scoped>
.appointment-create-form,
.appointment-create-loading {
  display: grid;
  gap: 16px;
}

.appointment-create-section {
  display: grid;
  gap: 14px;
  padding: 17px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.appointment-create-section__heading {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.appointment-create-section__heading > span {
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

.appointment-create-section__heading h3,
.appointment-create-section__heading p {
  margin: 0;
}

.appointment-create-section__heading h3 {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.appointment-create-section__heading p {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.appointment-create-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.appointment-create-client-link {
  margin: -3px 0 0;
  color: var(--ui-text-dimmed);
  font-size: 11px;
}

.appointment-create-client-link a {
  color: var(--ui-text);
  font-weight: 650;
  text-decoration: underline;
  text-decoration-color: var(--ui-border-accented);
  text-underline-offset: 3px;
}

.appointment-slot-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.appointment-slot {
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

.appointment-slot:hover,
.appointment-slot--selected {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
}

.appointment-slot--selected {
  box-shadow: inset 0 0 0 1px var(--ui-primary);
}

.appointment-slot strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.appointment-slot small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.appointment-create-empty {
  display: grid;
  justify-items: center;
  gap: 7px;
  padding: 18px;
  color: var(--ui-text-muted);
  text-align: center;
}

.appointment-create-empty .iconify {
  width: 22px;
  height: 22px;
}

.appointment-create-empty p {
  margin: 0;
  font-size: 11px;
}

@media (max-width: 720px) {
  .appointment-create-grid {
    grid-template-columns: 1fr;
  }

  .appointment-slot-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
