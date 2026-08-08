<script setup lang="ts">
import type { CaseListResponse } from '~/types/cases'
import type { ClientListItem } from '~/types/clients'
import type {
  CrmMeetingListResponse,
  CrmMeetingRecord,
} from '~/types/crm-meeting'
import type {
  BookingService,
  Facility,
  FacilityListPayload,
  FacilityMember,
  FacilityMembersPayload,
  FacilityServicesPayload,
} from '~/types/scheduling'

type MeetingTiming = 'now' | 'scheduled'
type CaseMode = 'create' | 'link'

type StaffAppointmentSlot = {
  startsAt: string
  endsAt: string
  expertUserId: string
  expertName: string
}

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Spotkania — OpenExpert CRM' })

const { organizationSlug, crmApiPath, orgApiPath, orgPath } = useOrganizationContext()
const requestFetch = useRequestFetch()
const toast = useToast()

const { data: meetingsPayload, pending, error, refresh } = await useAsyncData<CrmMeetingListResponse>(
  `crm-meetings:${organizationSlug.value}`,
  () => requestFetch<CrmMeetingListResponse>(crmApiPath('/meetings')),
  {
    default: () => ({ data: [] }),
    watch: [organizationSlug],
  },
)

const { data: casesPayload, pending: casesPending } = await useAsyncData<CaseListResponse>(
  `crm-meeting-cases:${organizationSlug.value}`,
  () => requestFetch<CaseListResponse>(crmApiPath('/cases'), {
    query: { sort: 'updated_desc', limit: 100 },
  }),
  {
    default: () => ({ data: [], count: 0 }),
    watch: [organizationSlug],
  },
)

const clock = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  clockTimer = setInterval(() => {
    clock.value = Date.now()
  }, 30_000)
})
onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer)
})

const meetings = computed(() => meetingsPayload.value.data)
const liveMeetings = computed(() => meetings.value.filter(item => item.status === 'live'))
const upcomingMeetings = computed(() => meetings.value
  .filter(item => item.status === 'scheduled' && new Date(item.endsAt).valueOf() >= clock.value)
  .sort((left, right) => left.startsAt.localeCompare(right.startsAt)))
const pastMeetings = computed(() => meetings.value
  .filter(item => item.status === 'ended' || new Date(item.endsAt).valueOf() < clock.value)
  .sort((left, right) => right.startsAt.localeCompare(left.startsAt))
  .slice(0, 12))

const scheduleOpen = ref(false)
const scheduleTiming = ref<MeetingTiming>('scheduled')
const caseMode = ref<CaseMode>('create')
const selectedClient = ref<ClientListItem | null>(null)
const selectedCaseId = ref('')
const facilities = ref<Facility[]>([])
const services = ref<BookingService[]>([])
const members = ref<FacilityMember[]>([])
const slots = ref<StaffAppointmentSlot[]>([])
const selectedSlot = ref<StaffAppointmentSlot | null>(null)
const setupPending = ref(false)
const contextPending = ref(false)
const slotsPending = ref(false)
const saving = ref(false)
const setupError = ref('')
const slotsError = ref('')
const submitError = ref('')
const idempotencyIntent = ref('')
let contextRequestId = 0
let slotsRequestId = 0

const form = reactive({
  facilityId: '',
  serviceId: '',
  expertUserId: '',
  localDate: '',
  caseTitle: '',
  notes: '',
  idempotencyKey: '',
})

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

const activeFacilities = computed(() => facilities.value.filter(item => item.is_active))
const facilityItems = computed(() => activeFacilities.value.map(item => ({
  label: item.city ? `${item.name} · ${item.city}` : item.name,
  value: item.id,
})))
const selectedFacility = computed(() => facilities.value.find(item => item.id === form.facilityId) ?? null)
const activeServices = computed(() => services.value.filter(item => item.is_active && item.isAvailable))
const serviceItems = computed(() => activeServices.value.map(item => ({
  label: `${item.name} · ${item.duration_minutes} min`,
  value: item.id,
})))
const selectedService = computed(() => activeServices.value.find(item => item.id === form.serviceId) ?? null)
const expertItems = computed(() => {
  const allowed = new Set(selectedService.value?.expertUserIds ?? [])
  return members.value
    .filter(item => item.is_bookable && allowed.has(item.user_id))
    .map(item => ({
      label: item.user?.full_name || item.user?.email || 'Ekspert',
      value: item.user_id,
    }))
})
const selectedCase = computed(() => casesPayload.value.data.find(item => item.id === selectedCaseId.value) ?? null)
const caseItems = computed(() => casesPayload.value.data.map(item => ({
  label: item.clients[0]?.display_name
    ? `${item.clients[0].display_name} · ${item.title}`
    : item.title,
  value: item.id,
})))
const selectedClientName = computed(() => (
  caseMode.value === 'create'
    ? selectedClient.value?.display_name ?? ''
    : selectedCase.value?.clients[0]?.display_name ?? ''
))
const canSubmit = computed(() => Boolean(
  form.facilityId
  && form.serviceId
  && form.expertUserId
  && (caseMode.value === 'create' ? selectedClient.value : selectedCaseId.value)
  && (scheduleTiming.value === 'now' || selectedSlot.value),
))

function resetScheduler(timing: MeetingTiming) {
  contextRequestId += 1
  slotsRequestId += 1
  scheduleTiming.value = timing
  caseMode.value = 'create'
  selectedClient.value = null
  selectedCaseId.value = ''
  facilities.value = []
  services.value = []
  members.value = []
  slots.value = []
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
    caseTitle: '',
    notes: '',
    idempotencyKey: crypto.randomUUID(),
  })
}

async function loadFacilityContext(facilityId: string) {
  const requestId = ++contextRequestId
  services.value = []
  members.value = []
  slots.value = []
  selectedSlot.value = null
  form.serviceId = ''
  form.expertUserId = ''
  if (!facilityId) return

  contextPending.value = true
  try {
    const encoded = encodeURIComponent(facilityId)
    const [servicesPayload, membersPayload] = await Promise.all([
      $fetch<FacilityServicesPayload>(orgApiPath(`/facilities/${encoded}/services`)),
      $fetch<FacilityMembersPayload>(orgApiPath(`/facilities/${encoded}/members`)),
    ])
    if (requestId !== contextRequestId) return
    services.value = servicesPayload.data ?? []
    members.value = membersPayload.data ?? []
    form.serviceId = activeServices.value[0]?.id ?? ''
  } catch (caught: unknown) {
    if (requestId !== contextRequestId) return
    setupError.value = apiErrorMessage(caught)
  } finally {
    if (requestId === contextRequestId) contextPending.value = false
  }
}

async function initializeScheduler(timing: MeetingTiming) {
  resetScheduler(timing)
  scheduleOpen.value = true
  setupPending.value = true
  try {
    const payload = await $fetch<FacilityListPayload>(orgApiPath('/facilities'))
    facilities.value = payload.data ?? []
    const initialFacility = activeFacilities.value.find(item => item.id === payload.defaultFacilityId)
      ?? activeFacilities.value[0]
      ?? null
    form.facilityId = initialFacility?.id ?? ''
    form.localDate = dateInTimezone(initialFacility?.timezone || 'Europe/Warsaw')
  } catch (caught: unknown) {
    setupError.value = apiErrorMessage(caught)
  } finally {
    setupPending.value = false
  }
}

async function loadSlots() {
  const requestId = ++slotsRequestId
  slots.value = []
  selectedSlot.value = null
  slotsError.value = ''
  if (
    scheduleTiming.value !== 'scheduled'
    || !form.facilityId
    || !form.serviceId
    || !form.expertUserId
    || !form.localDate
  ) return

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
    if (requestId !== slotsRequestId) return
    slots.value = payload.slots ?? []
  } catch (caught: unknown) {
    if (requestId !== slotsRequestId) return
    slotsError.value = apiErrorMessage(caught)
  } finally {
    if (requestId === slotsRequestId) slotsPending.value = false
  }
}

watch(() => form.facilityId, (facilityId) => {
  if (!scheduleOpen.value) return
  const facility = facilities.value.find(item => item.id === facilityId)
  if (facility) form.localDate = dateInTimezone(facility.timezone)
  void loadFacilityContext(facilityId)
})

watch(expertItems, (items) => {
  if (items.some(item => item.value === form.expertUserId)) return
  form.expertUserId = items[0]?.value ?? ''
})

watch(
  () => [scheduleTiming.value, form.serviceId, form.expertUserId, form.localDate],
  () => { void loadSlots() },
)

watch(selectedClient, (client) => {
  if (!client || form.caseTitle.trim()) return
  form.caseTitle = `Finansowanie nieruchomości — ${client.display_name}`
})

function slotLabel(slot: StaffAppointmentSlot) {
  return new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: selectedFacility.value?.timezone || 'Europe/Warsaw',
  }).format(new Date(slot.startsAt))
}

function meetingDate(meeting: CrmMeetingRecord) {
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: meeting.timezone || 'Europe/Warsaw',
  }).format(new Date(meeting.startsAt))
}

function relationLabel(meeting: CrmMeetingRecord) {
  return meeting.relationship === 'first' ? 'Pierwsze spotkanie' : 'Kolejne spotkanie'
}

async function submitMeeting() {
  if (!canSubmit.value || saving.value) return
  const requestBody = {
    timing: scheduleTiming.value,
    case: caseMode.value === 'create'
      ? {
          mode: 'create' as const,
          clientId: selectedClient.value!.id,
          title: form.caseTitle.trim() || `Sprawa — ${selectedClient.value!.display_name}`,
        }
      : {
          mode: 'link' as const,
          id: selectedCaseId.value,
        },
    facilityId: form.facilityId,
    serviceId: form.serviceId,
    expertUserId: form.expertUserId,
    startsAt: scheduleTiming.value === 'scheduled' ? selectedSlot.value?.startsAt : undefined,
    notes: form.notes.trim() || null,
  }
  const intent = JSON.stringify(requestBody)
  if (idempotencyIntent.value !== intent) {
    idempotencyIntent.value = intent
    form.idempotencyKey = crypto.randomUUID()
  }

  saving.value = true
  submitError.value = ''
  try {
    const createMeeting = () => $fetch<{ data: CrmMeetingRecord }>(
      crmApiPath('/meetings'),
      {
        method: 'POST',
        body: {
          ...requestBody,
          idempotencyKey: form.idempotencyKey,
        },
      },
    )

    let result: { data: CrmMeetingRecord }
    try {
      result = await createMeeting()
    } catch (caught: unknown) {
      if (!/this meeting request key was already used/i.test(apiErrorMessage(caught))) {
        throw caught
      }
      form.idempotencyKey = crypto.randomUUID()
      result = await createMeeting()
    }

    scheduleOpen.value = false
    await refresh()
    toast.add({
      title: scheduleTiming.value === 'now'
        ? 'Spotkanie jest gotowe'
        : 'Spotkanie zostało zaplanowane',
      description: `${result.data.clientName} · ${result.data.caseTitle}`,
      color: 'success',
      icon: 'i-lucide-calendar-check-2',
    })
    if (scheduleTiming.value === 'now') {
      await navigateTo(orgPath(`/meetings/${result.data.id}`))
    }
  } catch (caught: unknown) {
    submitError.value = apiErrorMessage(caught)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="meetings-page">
    <CrmPageHeader
      eyebrow="Spotkania"
      title="Rozmowy osadzone w sprawie klienta"
      description="Najpierw zaplanuj termin i przygotuj sprawę. Rozmowa oraz udostępnianie ofert zaczynają się dopiero po wejściu do pokoju."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-video"
          label="Spotkanie teraz"
          data-testid="meeting-create-now"
          @click="initializeScheduler('now')"
        />
        <UButton
          color="primary"
          icon="i-lucide-calendar-plus-2"
          label="Zaplanuj spotkanie"
          data-testid="meeting-create-later"
          @click="initializeScheduler('scheduled')"
        />
      </template>
    </CrmPageHeader>

    <section class="meeting-principles" aria-label="Jak działają spotkania">
      <article>
        <span>1</span>
        <div>
          <strong>Termin i klient</strong>
          <small>„Teraz” i „później” tworzą prawdziwy wpis w kalendarzu.</small>
        </div>
      </article>
      <article>
        <span>2</span>
        <div>
          <strong>Sprawa przed rozmową</strong>
          <small>Pierwszy termin zakłada sprawę, kolejne są do niej przypinane.</small>
        </div>
      </article>
      <article>
        <span>3</span>
        <div>
          <strong>Jawne udostępnianie</strong>
          <small>Klient widzi wyłącznie materiały opublikowane podczas spotkania.</small>
        </div>
      </article>
    </section>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać spotkań"
      :description="apiErrorMessage(error)"
      :actions="[{ label: 'Spróbuj ponownie', onClick: () => refresh() }]"
    />

    <div v-if="pending" class="meetings-loading">
      <USkeleton class="h-44 w-full" />
      <USkeleton class="h-44 w-full" />
    </div>

    <template v-else>
      <section v-if="liveMeetings.length" class="meeting-section meeting-section--live">
        <header>
          <span>
            <small>W toku</small>
            <h2>Aktywne spotkanie</h2>
          </span>
          <span class="live-indicator"><i /> Połączenie rozpoczęte</span>
        </header>
        <div class="meeting-grid">
          <article v-for="meeting in liveMeetings" :key="meeting.id" class="meeting-card is-live">
            <div class="meeting-card__top">
              <span class="meeting-card__avatar">{{ meeting.clientName.slice(0, 1).toUpperCase() }}</span>
              <span>
                <small>{{ relationLabel(meeting) }}</small>
                <h3>{{ meeting.clientName }}</h3>
                <p>{{ meeting.caseTitle }}</p>
              </span>
              <UBadge color="success" variant="soft">W toku</UBadge>
            </div>
            <div class="meeting-card__facts">
              <span><UIcon name="i-lucide-clock-3" /> {{ meetingDate(meeting) }}</span>
              <span><UIcon name="i-lucide-briefcase-business" /> {{ meeting.serviceName }}</span>
            </div>
            <UButton
              :to="orgPath(`/meetings/${meeting.id}`)"
              block
              color="primary"
              icon="i-lucide-arrow-right"
              trailing
              label="Wróć do spotkania"
            />
          </article>
        </div>
      </section>

      <section class="meeting-section">
        <header>
          <span>
            <small>Kalendarz</small>
            <h2>Nadchodzące</h2>
          </span>
          <UBadge color="neutral" variant="soft">{{ upcomingMeetings.length }}</UBadge>
        </header>
        <div v-if="upcomingMeetings.length" class="meeting-grid">
          <article v-for="meeting in upcomingMeetings" :key="meeting.id" class="meeting-card">
            <div class="meeting-card__top">
              <span class="meeting-card__avatar">{{ meeting.clientName.slice(0, 1).toUpperCase() }}</span>
              <span>
                <small>{{ relationLabel(meeting) }}</small>
                <h3>{{ meeting.clientName }}</h3>
                <p>{{ meeting.caseTitle }}</p>
              </span>
              <UBadge color="info" variant="soft">Zaplanowane</UBadge>
            </div>
            <div class="meeting-card__facts">
              <span><UIcon name="i-lucide-calendar-days" /> {{ meetingDate(meeting) }}</span>
              <span><UIcon name="i-lucide-user-round" /> {{ meeting.expertName }}</span>
            </div>
            <UButton
              :to="orgPath(`/meetings/${meeting.id}`)"
              block
              color="neutral"
              variant="outline"
              icon="i-lucide-door-open"
              label="Przygotuj spotkanie"
            />
          </article>
        </div>
        <OeEmptyState
          icon="i-lucide-calendar-clock"
          title="Nie masz zaplanowanych spotkań"
          description="Utwórz spotkanie na teraz albo wybierz późniejszy termin z kalendarza eksperta."
          surface="outline"
        >
          <template #actions>
            <UButton
              color="primary"
              icon="i-lucide-calendar-plus-2"
              label="Zaplanuj pierwsze spotkanie"
              @click="initializeScheduler('scheduled')"
            />
          </template>
        </OeEmptyState>
      </section>

      <section v-if="pastMeetings.length" class="meeting-section meeting-section--past">
        <header>
          <span>
            <small>Historia</small>
            <h2>Poprzednie spotkania</h2>
          </span>
        </header>
        <div class="meeting-history">
          <NuxtLink
            v-for="meeting in pastMeetings"
            :key="meeting.id"
            :to="orgPath(`/meetings/${meeting.id}`)"
          >
            <span class="meeting-history__date">{{ meetingDate(meeting) }}</span>
            <span>
              <strong>{{ meeting.clientName }}</strong>
              <small>{{ meeting.caseTitle }}</small>
            </span>
            <UBadge color="neutral" variant="soft">
              {{ meeting.status === 'ended' ? 'Zakończone' : 'Termin minął' }}
            </UBadge>
            <UIcon name="i-lucide-chevron-right" />
          </NuxtLink>
        </div>
      </section>
    </template>

    <UModal
      v-model:open="scheduleOpen"
      :title="scheduleTiming === 'now' ? 'Spotkanie teraz' : 'Zaplanuj spotkanie'"
      :description="scheduleTiming === 'now'
        ? 'Utwórz termin i przejdź do ekranu przygotowania.'
        : 'Wybierz klienta, sprawę i wolny termin eksperta.'"
      :dismissible="!saving"
      :ui="{ content: 'sm:max-w-4xl', footer: 'justify-between' }"
    >
      <template #body>
        <form id="crm-meeting-schedule-form" class="schedule-form" @submit.prevent="submitMeeting">
          <div v-if="setupPending" class="schedule-loading">
            <USkeleton class="h-32 w-full" />
            <USkeleton class="h-48 w-full" />
          </div>

          <UAlert
            v-else-if="setupError"
            color="error"
            variant="subtle"
            icon="i-lucide-calendar-x-2"
            title="Nie udało się przygotować planowania"
            :description="setupError"
          />

          <template v-else>
            <section class="schedule-section">
              <div class="schedule-section__heading">
                <span>1</span>
                <div>
                  <h3>Kontekst sprawy</h3>
                  <p>Określ, czy jest to pierwsza rozmowa w tej sprawie.</p>
                </div>
              </div>

              <div class="case-mode-grid" role="radiogroup" aria-label="Relacja spotkania ze sprawą">
                <button
                  type="button"
                  :class="{ 'is-selected': caseMode === 'create' }"
                  role="radio"
                  :aria-checked="caseMode === 'create'"
                  @click="caseMode = 'create'"
                >
                  <span><UIcon name="i-lucide-sparkles" /></span>
                  <strong>Pierwsze spotkanie</strong>
                  <small>Po zapisaniu powstanie nowa sprawa dla klienta.</small>
                </button>
                <button
                  type="button"
                  :class="{ 'is-selected': caseMode === 'link' }"
                  role="radio"
                  :aria-checked="caseMode === 'link'"
                  @click="caseMode = 'link'"
                >
                  <span><UIcon name="i-lucide-link-2" /></span>
                  <strong>Kolejne spotkanie</strong>
                  <small>Termin zostanie dopisany do istniejącej sprawy.</small>
                </button>
              </div>

              <template v-if="caseMode === 'create'">
                <UFormField label="Klient" required>
                  <ClientPicker v-model="selectedClient" required />
                </UFormField>
                <UFormField label="Nazwa nowej sprawy" required>
                  <UInput
                    v-model="form.caseTitle"
                    class="w-full"
                    maxlength="200"
                    icon="i-lucide-briefcase-business"
                    placeholder="Np. Finansowanie mieszkania — Anna Kowalska"
                  />
                </UFormField>
              </template>
              <UFormField v-else label="Istniejąca sprawa" required>
                <USelect
                  v-model="selectedCaseId"
                  class="w-full"
                  :items="caseItems"
                  :loading="casesPending"
                  value-key="value"
                  label-key="label"
                  placeholder="Wybierz sprawę klienta"
                />
              </UFormField>

              <div v-if="selectedClientName" class="case-confirmation">
                <UIcon name="i-lucide-shield-check" />
                <span>
                  <small>Spotkanie będzie przypisane do klienta</small>
                  <strong>{{ selectedClientName }}</strong>
                </span>
              </div>
            </section>

            <section class="schedule-section">
              <div class="schedule-section__heading">
                <span>2</span>
                <div>
                  <h3>Ekspert i usługa</h3>
                  <p>To dane kalendarza, na podstawie których powstanie termin.</p>
                </div>
              </div>

              <UAlert
                v-if="!activeFacilities.length"
                color="warning"
                variant="subtle"
                title="Brak aktywnej placówki"
                description="Najpierw skonfiguruj placówkę, usługę spotkania i eksperta."
                :actions="[{ label: 'Przejdź do placówek', to: orgPath('/facilities') }]"
              />
              <div v-else class="schedule-fields">
                <UFormField label="Placówka grafiku" required>
                  <USelect
                    v-model="form.facilityId"
                    class="w-full"
                    :items="facilityItems"
                    value-key="value"
                  />
                </UFormField>
                <UFormField label="Usługa" required>
                  <USelect
                    v-model="form.serviceId"
                    class="w-full"
                    :items="serviceItems"
                    :loading="contextPending"
                    value-key="value"
                    placeholder="Wybierz usługę"
                  />
                </UFormField>
                <UFormField label="Ekspert" required>
                  <USelect
                    v-model="form.expertUserId"
                    class="w-full"
                    :items="expertItems"
                    :loading="contextPending"
                    value-key="value"
                    placeholder="Wybierz eksperta"
                  />
                </UFormField>
              </div>
            </section>

            <section class="schedule-section">
              <div class="schedule-section__heading">
                <span>3</span>
                <div>
                  <h3>{{ scheduleTiming === 'now' ? 'Gotowość do rozmowy' : 'Termin' }}</h3>
                  <p>
                    {{ scheduleTiming === 'now'
                      ? 'Rekord spotkania powstanie teraz, ale rozmowę rozpoczniesz osobnym przyciskiem.'
                      : 'Wybierz wolny slot z grafiku eksperta.' }}
                  </p>
                </div>
              </div>

              <div v-if="scheduleTiming === 'now'" class="instant-summary">
                <span><UIcon name="i-lucide-clock-3" /></span>
                <div>
                  <strong>Teraz</strong>
                  <small>Po utworzeniu przejdziesz do poczekalni i sprawdzisz kontekst sprawy.</small>
                </div>
              </div>
              <template v-else>
                <UFormField label="Dzień" required>
                  <UInput
                    v-model="form.localDate"
                    class="w-full"
                    type="date"
                    :min="dateInTimezone(selectedFacility?.timezone || 'Europe/Warsaw')"
                  />
                </UFormField>
                <div v-if="slotsPending" class="slot-grid">
                  <USkeleton v-for="index in 6" :key="index" class="h-14 w-full" />
                </div>
                <UAlert
                  v-else-if="slotsError"
                  color="error"
                  variant="subtle"
                  :description="slotsError"
                  :actions="[{ label: 'Odśwież terminy', onClick: loadSlots }]"
                />
                <div v-else-if="slots.length" class="slot-grid" role="radiogroup" aria-label="Wolne terminy">
                  <button
                    v-for="slot in slots"
                    :key="slot.startsAt"
                    type="button"
                    :class="{ 'is-selected': selectedSlot?.startsAt === slot.startsAt }"
                    role="radio"
                    :aria-checked="selectedSlot?.startsAt === slot.startsAt"
                    @click="selectedSlot = slot"
                  >
                    <strong>{{ slotLabel(slot) }}</strong>
                    <small>{{ slot.expertName }}</small>
                  </button>
                </div>
                <div v-else class="slots-empty">
                  <UIcon name="i-lucide-calendar-x-2" />
                  <span>Brak wolnych terminów w tym dniu.</span>
                </div>
              </template>
            </section>

            <UFormField label="Notatka organizacyjna" hint="Opcjonalnie">
              <UTextarea v-model="form.notes" class="w-full" :rows="2" maxlength="2000" />
            </UFormField>

            <UAlert
              v-if="submitError"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              title="Nie udało się utworzyć spotkania"
              :description="submitError"
            />
          </template>
        </form>
      </template>
      <template #footer>
        <span class="schedule-footer-note">
          <UIcon name="i-lucide-lock-keyhole" />
          Rozmowa nie rozpocznie się automatycznie.
        </span>
        <div class="schedule-footer-actions">
          <UButton
            color="neutral"
            variant="ghost"
            label="Anuluj"
            :disabled="saving"
            @click="scheduleOpen = false"
          />
          <UButton
            type="submit"
            form="crm-meeting-schedule-form"
            color="primary"
            :loading="saving"
            :disabled="!canSubmit"
            :icon="scheduleTiming === 'now' ? 'i-lucide-door-open' : 'i-lucide-calendar-check-2'"
            :label="scheduleTiming === 'now' ? 'Utwórz i przygotuj' : 'Zaplanuj spotkanie'"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.meetings-page {
  display: grid;
  gap: 28px;
  padding-bottom: 48px;
}

.meeting-principles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  background: var(--ui-border);
}

.meeting-principles article {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 17px 18px;
  background: var(--ui-bg-elevated);
}

.meeting-principles article > span,
.schedule-section__heading > span {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg));
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 800;
}

.meeting-principles div,
.schedule-section__heading div,
.case-confirmation span {
  display: grid;
  gap: 3px;
}

.meeting-principles strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.meeting-principles small {
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.meetings-loading,
.meeting-section {
  display: grid;
  gap: 16px;
}

.meeting-section > header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.meeting-section > header > span:first-child {
  display: grid;
  gap: 3px;
}

.meeting-section header small {
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.meeting-section h2,
.meeting-section h3,
.meeting-section p {
  margin: 0;
}

.meeting-section h2 {
  color: var(--ui-text-highlighted);
  font-size: 21px;
  letter-spacing: -.025em;
}

.meeting-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.meeting-card {
  display: grid;
  gap: 18px;
  padding: 19px;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  background: var(--ui-bg-elevated);
  box-shadow: 0 12px 34px color-mix(in srgb, var(--ui-text) 5%, transparent);
}

.meeting-card.is-live {
  border-color: color-mix(in srgb, var(--ui-success) 42%, var(--ui-border));
  background:
    radial-gradient(circle at 100% 0, color-mix(in srgb, var(--ui-success) 10%, transparent), transparent 42%),
    var(--ui-bg-elevated);
}

.meeting-card__top {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 11px;
}

.meeting-card__avatar {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--ui-primary) 13%, var(--ui-bg));
  color: var(--ui-primary);
  font-weight: 800;
}

.meeting-card__top > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.meeting-card__top small {
  color: var(--ui-text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
}

.meeting-card h3 {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meeting-card p {
  overflow: hidden;
  color: var(--ui-text-toned);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meeting-card__facts {
  display: grid;
  gap: 8px;
  color: var(--ui-text-toned);
  font-size: 12px;
}

.meeting-card__facts span {
  display: flex;
  align-items: center;
  gap: 7px;
}

.live-indicator {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-success);
  font-size: 12px;
  font-weight: 700;
}

.live-indicator i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 13%, transparent);
}

.meeting-empty {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 42px 20px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 20px;
  background: color-mix(in srgb, var(--ui-bg-elevated) 85%, transparent);
  text-align: center;
}

.meeting-empty > span {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border-radius: 17px;
  background: color-mix(in srgb, var(--ui-primary) 11%, var(--ui-bg));
  color: var(--ui-primary);
  font-size: 24px;
}

.meeting-empty h3 {
  color: var(--ui-text-highlighted);
  font-size: 18px;
}

.meeting-empty p {
  max-width: 60ch;
  color: var(--ui-text-toned);
  font-size: 13px;
}

.meeting-section--past {
  margin-top: 8px;
}

.meeting-history {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  background: var(--ui-bg-elevated);
}

.meeting-history a {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ui-border);
  color: inherit;
  text-decoration: none;
}

.meeting-history a:last-child {
  border-bottom: 0;
}

.meeting-history a:hover {
  background: var(--ui-bg-muted);
}

.meeting-history__date {
  color: var(--ui-text-toned);
  font-size: 12px;
}

.meeting-history a > span:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.meeting-history strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.meeting-history small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schedule-form,
.schedule-loading {
  display: grid;
  gap: 18px;
}

.schedule-section {
  display: grid;
  gap: 15px;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--ui-bg-elevated) 88%, var(--ui-bg));
}

.schedule-section__heading {
  display: flex;
  align-items: center;
  gap: 12px;
}

.schedule-section__heading h3,
.schedule-section__heading p {
  margin: 0;
}

.schedule-section__heading h3 {
  color: var(--ui-text-highlighted);
  font-size: 15px;
}

.schedule-section__heading p {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.case-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.case-mode-grid button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 3px 10px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
}

.case-mode-grid button:hover,
.case-mode-grid button.is-selected {
  border-color: color-mix(in srgb, var(--ui-primary) 55%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-bg));
}

.case-mode-grid button > span {
  grid-row: 1 / span 2;
  color: var(--ui-primary);
  font-size: 19px;
}

.case-mode-grid strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.case-mode-grid small {
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.case-confirmation,
.instant-summary {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 14px;
  border-radius: 13px;
  background: color-mix(in srgb, var(--ui-success) 9%, var(--ui-bg));
  color: var(--ui-success);
}

.case-confirmation small,
.instant-summary small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.case-confirmation strong,
.instant-summary strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.schedule-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.instant-summary > span {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  background: var(--ui-bg-elevated);
  font-size: 19px;
}

.instant-summary > div {
  display: grid;
  gap: 2px;
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.slot-grid button {
  display: grid;
  gap: 2px;
  padding: 11px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
}

.slot-grid button:hover,
.slot-grid button.is-selected {
  border-color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 9%, var(--ui-bg));
}

.slot-grid strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.slot-grid small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slots-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px;
  border: 1px dashed var(--ui-border);
  border-radius: 13px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.schedule-footer-note {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.schedule-footer-actions {
  display: flex;
  gap: 8px;
}

@media (max-width: 1050px) {
  .meeting-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .meeting-principles {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .meeting-grid,
  .case-mode-grid,
  .schedule-fields {
    grid-template-columns: 1fr;
  }

  .slot-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .meeting-history a {
    grid-template-columns: 1fr auto;
  }

  .meeting-history__date,
  .meeting-history a > span:nth-child(2) {
    grid-column: 1;
  }

  .meeting-history :deep(.badge),
  .meeting-history a > svg {
    grid-column: 2;
    grid-row: 1 / span 2;
  }

  .schedule-footer-note {
    display: none;
  }
}
</style>
