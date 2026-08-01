<script setup lang="ts">
import { DEFAULT_MORTGAGE_CAPACITY_POLICY } from '@openexpert/mortgage'
import type { BookingCalculatorSnapshot, BookingWidgetSnapshot } from '#shared/types/booking-calculators'
import BookingCapacityCalculator from '~/components/booking/BookingCapacityCalculator.vue'
import BookingPaymentCalculator from '~/components/booking/BookingPaymentCalculator.vue'
import BookingWeekPicker from '~/components/booking/BookingWeekPicker.vue'
import type {
  PublicBookingConfirmation,
  PublicBookingConsent,
  PublicBookingExpert,
  PublicBookingSlot,
  PublicBookingSlotsPayload,
  PublicBookingWidgetPayload,
} from '~/types/booking'
import {
  addDaysToIsoDate,
  BOOKING_WEEK_DAYS,
  buildBookingWeekDays,
  formatBookingWeekRange,
  isoDateForTimestamp,
  isoDateRange,
} from '~/utils/booking-slots'

definePageMeta({ layout: false })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const anyExpertSelectValue = '__openexpert_any_available_expert__'
const widgetKey = computed(() => String(route.params.widgetKey ?? ''))
const isEmbedded = computed(() => route.query.embed === '1')
const previewToken = computed(() => (
  typeof route.query.previewToken === 'string' ? route.query.previewToken : ''
))
const isPreview = computed(() => Boolean(previewToken.value))
const analyticsVisitStateKey = `booking-widget-visit:${widgetKey.value}`
const analyticsVisitId = useState<string>(
  analyticsVisitStateKey,
  () => crypto.randomUUID(),
)
const selectedServiceId = ref('')
const selectedExpertId = ref('')
const selectedDate = ref('')
const weekStartDate = ref('')
const minimumDate = ref('')
const selectedSlot = ref<PublicBookingSlot | null>(null)
const slots = ref<PublicBookingSlot[]>([])
const slotsTimezone = ref('Europe/Warsaw')
const slotsPending = ref(false)
const slotsError = ref('')
const slotsExpanded = ref(false)
const contactStepOpen = ref(false)
const bookingPending = ref(false)
const bookingError = ref('')
const bookingIdempotencyKey = ref('')
const bookingIdempotencyIntent = ref('')
const confirmation = ref<PublicBookingConfirmation | null>(null)
const calculatorSnapshot = ref<BookingCalculatorSnapshot | null>(null)
const prefersDark = ref(false)
const consentDecisions = reactive<Record<string, boolean>>({})
const trackedAnalyticsEvents = new Set<string>()
const contactSection = useTemplateRef<HTMLElement>('contactSection')
let resizeObserver: ResizeObserver | null = null
let slotsRequestId = 0
let shouldFindNextAvailableDate = true
const customer = reactive({
  name: '',
  email: '',
  phone: '',
  notes: '',
})
const clientClaimPath = computed(() => confirmation.value
  ? `/claim?appointmentId=${encodeURIComponent(confirmation.value.appointment.id)}`
  : '/')
const clientActivationLink = computed(() => {
  const configuredBase = String(
    runtimeConfig.public.openexpert?.clientPortalBaseUrl || 'http://127.0.0.1:3006',
  )
  const login = new URL('/login', configuredBase)
  login.searchParams.set('email', customer.email.trim().toLowerCase())
  login.searchParams.set('redirect', clientClaimPath.value)
  return login.toString()
})

const emptyWidgetPayload: PublicBookingWidgetPayload = {
  widget: {
    key: '',
    title: 'Umów spotkanie',
    subtitle: null,
    theme: 'auto',
    accentColor: '#171717',
    bookingMode: 'both',
    widgetType: 'calendar',
    fixedExpertUserId: null,
  },
  facility: { id: '', name: '', address: null, timezone: 'Europe/Warsaw' },
  services: [],
  experts: [],
  consents: [],
  capacityPolicy: DEFAULT_MORTGAGE_CAPACITY_POLICY,
  capacityPolicyRevision: 0,
}

const { data, status, error, refresh: refreshWidgetCatalog } = await useAsyncData<PublicBookingWidgetPayload>(
  `booking-widget-${widgetKey.value}`,
  () => $fetch<PublicBookingWidgetPayload>(
    `/api/booking/widgets/${encodeURIComponent(widgetKey.value)}`,
    {
      query: {
        embed: isEmbedded.value ? '1' : undefined,
        previewToken: previewToken.value || undefined,
        visitId: analyticsVisitId.value,
      },
    },
  ),
  {
    default: () => emptyWidgetPayload,
  },
)

useHead(() => ({
  title: data.value.facility.name
    ? `${data.value.widget.title} — ${data.value.facility.name}`
    : 'Umów spotkanie — OpenExpert',
  meta: [{
    name: 'robots',
    content: 'noindex, nofollow',
  }],
}))

function expertSupportsService(
  expert: PublicBookingWidgetPayload['experts'][number],
  serviceId: string,
) {
  return !expert.serviceIds || expert.serviceIds.includes(serviceId)
}

const bookableServices = computed(() => data.value.services.filter((service) => {
  const fixedExpertUserId = data.value.widget.fixedExpertUserId
  if (fixedExpertUserId) {
    return data.value.experts.some(expert => (
      expert.userId === fixedExpertUserId
      && expertSupportsService(expert, service.id)
    ))
  }
  return data.value.experts.some(expert => expertSupportsService(expert, service.id))
}))

const bookingUnavailableReason = computed(() => {
  if (!data.value.services.length) {
    return {
      title: 'Brak dostępnych terminów',
      description: 'Placówka nie ma jeszcze aktywnej konfiguracji spotkań.',
    }
  }
  if (!bookableServices.value.length) {
    return data.value.widget.fixedExpertUserId
      ? {
          title: 'Ekspert jest obecnie niedostępny',
          description: 'Wybrany ekspert nie przyjmuje obecnie spotkań przez ten widget.',
        }
      : {
          title: 'Brak dostępnych ekspertów',
          description: 'Żaden ekspert nie przyjmuje obecnie spotkań przez ten widget.',
        }
  }
  return null
})

const matchingExperts = computed(() => data.value.experts.filter((expert) => {
  return expertSupportsService(expert, selectedServiceId.value)
}))

interface ExpertSelectItem {
  label: string
  value: string
  description: string
  kind: 'any' | 'expert'
  avatar: {
    src?: string
    alt: string
    text?: string
    icon?: string
  }
}

const expertItems = computed<ExpertSelectItem[]>(() => [
  ...(expertRequired.value
    ? []
    : [{
        label: 'Dowolny dostępny ekspert',
        value: anyExpertSelectValue,
        description: 'Najszybszy dostępny termin',
        kind: 'any' as const,
        avatar: {
          alt: 'Dowolny dostępny ekspert',
          icon: 'i-lucide-users-round',
        },
      }]),
  ...matchingExperts.value.map(expert => ({
    label: expert.name,
    value: expert.userId,
    description: expertRole(expert),
    kind: 'expert' as const,
    avatar: {
      ...(expert.avatarUrl ? { src: expert.avatarUrl } : {}),
      alt: expert.name,
      text: expertInitials(expert.name),
    },
  })),
])
const selectedExpertSelectValue = computed({
  get: () => selectedExpertId.value || (
    expertRequired.value ? '' : anyExpertSelectValue
  ),
  set: value => {
    selectedExpertId.value = value === anyExpertSelectValue ? '' : value
  },
})
const serviceItems = computed(() => bookableServices.value.map(service => ({
  label: `${service.name} · ${service.durationMinutes} min`,
  value: service.id,
})))

const selectedService = computed(() => (
  data.value.services.find(service => service.id === selectedServiceId.value)
))
const selectedExpert = computed(() => (
  data.value.experts.find(expert => expert.userId === selectedExpertId.value)
))
const selectedExpertItem = computed(() => (
  expertItems.value.find(item => item.value === selectedExpertSelectValue.value)
  ?? expertItems.value[0]
))
const selectedExpertLabel = computed(() => (
  selectedExpert.value?.name
  ?? selectedSlot.value?.expertName
  ?? (expertRequired.value ? 'Wybierz eksperta' : 'Dowolny dostępny ekspert')
))
const bookingStep = computed<1 | 2 | 3>(() => (
  confirmation.value ? 3 : contactStepOpen.value ? 2 : 1
))
const canChooseExpert = computed(() => (
  !data.value.widget.fixedExpertUserId
  && data.value.widget.bookingMode !== 'facility'
))
const expertRequired = computed(() => (
  !data.value.widget.fixedExpertUserId
  && data.value.widget.bookingMode === 'expert'
))
const showCalculator = computed(() => (
  data.value.widget.widgetType !== 'calendar'
  && !calculatorSnapshot.value
))
const phoneRequired = true
const phoneHasValue = computed(() => Boolean(customer.phone.trim()))
const phoneIsValid = computed(() => {
  const digits = customer.phone.replace(/[^0-9]+/g, '')
  return digits.length >= 7 && digits.length <= 15
})
const phoneRequirementMet = computed(() => phoneIsValid.value)
const phoneFieldDescription = 'Wymagany do potwierdzenia i obsługi wizyty.'
const phoneFieldError = computed(() => (
  phoneHasValue.value && !phoneIsValid.value
    ? 'Podaj numer zawierający od 7 do 15 cyfr.'
    : undefined
))
const bookingContext = computed<BookingWidgetSnapshot>(() => (
  calculatorSnapshot.value ?? { widgetType: 'calendar', version: 1 }
))
const widgetEyebrow = computed(() => ({
  calendar: 'Rezerwacja online',
  mortgage_capacity: 'Kalkulator zdolności',
  mortgage_payment: 'Kalkulator raty',
})[data.value.widget.widgetType])
const unmetRequiredConsents = computed(() => data.value.consents.filter(consent => (
  consent.isRequired
  && (!consentDecisions[consent.versionId] || !consentChannelIsAvailable(consent.channel))
)))
const weekDays = computed(() => (
  weekStartDate.value
    ? buildBookingWeekDays(weekStartDate.value, slots.value, slotsTimezone.value)
    : []
))
const weekRangeLabel = computed(() => formatBookingWeekRange(
  weekStartDate.value,
  weekStartDate.value
    ? addDaysToIsoDate(weekStartDate.value, BOOKING_WEEK_DAYS - 1)
    : '',
))
const canGoPreviousWeek = computed(() => (
  Boolean(weekStartDate.value && minimumDate.value)
  && addDaysToIsoDate(weekStartDate.value, -BOOKING_WEEK_DAYS) >= minimumDate.value
))
const selectedSlotDate = computed(() => (
  selectedSlot.value
    ? isoDateForTimestamp(selectedSlot.value.startsAt, slotsTimezone.value)
    : ''
))
const selectedSlotSummary = computed(() => (
  selectedSlot.value
    ? `${fullDateWithoutYear(selectedSlotDate.value)} · ${slotTime(selectedSlot.value)} · ${selectedService.value?.durationMinutes ?? 0} min`
    : 'Wybierz dzień i godzinę'
))

const themePreference = computed(() => {
  const requested = String(route.query.theme ?? '')
  return ['light', 'dark', 'auto'].includes(requested)
    ? requested
    : data.value.widget.theme
})

const isDark = computed(() => {
  if (themePreference.value === 'dark') return true
  if (themePreference.value === 'light') return false
  return prefersDark.value
})

const widgetStyle = computed(() => ({
  '--booking-accent': data.value.widget.accentColor || '#171717',
}))

function isoDateInTimezone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function slotTime(slot: PublicBookingSlot) {
  return new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: slotsTimezone.value,
  }).format(new Date(slot.startsAt))
}

function expertInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0))
    .join('')
    .toLocaleUpperCase('pl-PL')
}

function expertRole(expert?: PublicBookingExpert) {
  return expert?.roleLabel?.trim() || 'Ekspert OpenExpert'
}

function dateFromIso(value: string) {
  return new Date(`${value}T12:00:00.000Z`)
}

function fullDateWithoutYear(value: string) {
  if (!value) return ''
  const label = new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(dateFromIso(value))
  return label.charAt(0).toLocaleUpperCase('pl-PL') + label.slice(1)
}

function confirmationDate(value: string) {
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: data.value.facility.timezone,
  }).format(new Date(value))
}

function consentChannelLabel(channel: PublicBookingConsent['channel']) {
  return ({
    email: 'e-mail',
    sms: 'SMS/MMS',
    phone: 'telefon',
    messaging: 'komunikator',
    other: 'inny kanał',
  })[channel]
}

function consentRequiresPhone(channel: PublicBookingConsent['channel']) {
  return channel === 'sms' || channel === 'phone' || channel === 'messaging'
}

function consentChannelIsAvailable(channel: PublicBookingConsent['channel']) {
  if (channel === 'email') return Boolean(customer.email.trim())
  if (consentRequiresPhone(channel)) return phoneIsValid.value
  return Boolean(customer.email.trim() || customer.phone.trim())
}

type ClientWidgetAnalyticsEvent =
  | 'widget_engaged'
  | 'calculator_started'
  | 'calculator_completed'
  | 'service_selected'
  | 'slot_selected'
  | 'contact_started'

function trackWidgetEvent(eventType: ClientWidgetAnalyticsEvent, serviceId?: string | null) {
  if (!import.meta.client) return
  const eventKey = `${eventType}:${serviceId ?? ''}`
  if (trackedAnalyticsEvents.has(eventKey)) return
  trackedAnalyticsEvents.add(eventKey)
  void $fetch(`/api/booking/widgets/${encodeURIComponent(widgetKey.value)}/events`, {
    method: 'POST',
    body: {
      visitId: analyticsVisitId.value,
      eventType,
      serviceId: serviceId || undefined,
      isEmbedded: isEmbedded.value,
      previewToken: previewToken.value || undefined,
    },
  }).catch(() => {
    trackedAnalyticsEvents.delete(eventKey)
  })
}

function trackEngagement() {
  trackWidgetEvent('widget_engaged')
}

function trackCalculatorStarted() {
  trackEngagement()
  trackWidgetEvent('calculator_started')
}

async function continueFromCalculator(snapshot: BookingCalculatorSnapshot) {
  trackCalculatorStarted()
  trackWidgetEvent('calculator_completed')
  calculatorSnapshot.value = snapshot
  await nextTick()
  if (import.meta.client && !isEmbedded.value) window.scrollTo({ top: 0, behavior: 'smooth' })
  postWidgetHeight()
}

async function returnToCalculator() {
  calculatorSnapshot.value = null
  selectedSlot.value = null
  contactStepOpen.value = false
  slotsExpanded.value = false
  bookingError.value = ''
  await nextTick()
  postWidgetHeight()
}

async function loadSlots() {
  const requestId = ++slotsRequestId
  const serviceId = selectedServiceId.value
  const expertId = selectedExpertId.value
  const rangeStart = weekStartDate.value
  selectedSlot.value = null
  slots.value = []
  slotsError.value = ''
  slotsExpanded.value = false
  contactStepOpen.value = false
  if (!serviceId || !rangeStart || (expertRequired.value && !expertId)) {
    slotsPending.value = false
    return
  }
  const findNextAvailable = shouldFindNextAvailableDate
    && rangeStart === minimumDate.value
  shouldFindNextAvailableDate = false

  slotsPending.value = true
  try {
    const result = await $fetch<PublicBookingSlotsPayload>(
      `/api/booking/widgets/${encodeURIComponent(widgetKey.value)}/slots`,
      {
        query: {
          date: rangeStart,
          days: BOOKING_WEEK_DAYS,
          serviceId,
          expertId: expertId || undefined,
          nextAvailable: findNextAvailable ? '1' : undefined,
          embed: isEmbedded.value ? '1' : undefined,
          previewToken: previewToken.value || undefined,
          visitId: analyticsVisitId.value,
        },
      },
    )
    if (
      requestId !== slotsRequestId
      || serviceId !== selectedServiceId.value
      || expertId !== selectedExpertId.value
      || rangeStart !== weekStartDate.value
    ) return
    slots.value = result.slots
    slotsTimezone.value = result.timezone
    if (findNextAvailable && result.date !== rangeStart) {
      weekStartDate.value = result.date
      selectedDate.value = result.date
    } else {
      const returnedDates = isoDateRange(result.date, BOOKING_WEEK_DAYS)
      if (!returnedDates.includes(selectedDate.value)) {
        selectedDate.value = result.slots[0]
          ? isoDateForTimestamp(result.slots[0].startsAt, result.timezone)
          : result.date
      }
    }
  } catch (fetchError) {
    if (requestId !== slotsRequestId) return
    slotsError.value = fetchError instanceof Error
      ? fetchError.message
      : 'Nie udało się pobrać wolnych terminów.'
  } finally {
    if (requestId === slotsRequestId) slotsPending.value = false
  }
}

async function submitBooking() {
  if (
    isPreview.value
    ||
    bookingUnavailableReason.value
    || !selectedSlot.value
    || !selectedServiceId.value
    || !bookableServices.value.some(service => service.id === selectedServiceId.value)
    || (expertRequired.value && !selectedExpertId.value)
    || !customer.name.trim()
    || !customer.email.trim()
    || !phoneRequirementMet.value
    || unmetRequiredConsents.value.length
  ) return
  bookingPending.value = true
  bookingError.value = ''

  try {
    const bookingIntent = {
      serviceId: selectedServiceId.value,
      expertUserId: selectedExpertId.value || selectedSlot.value.expertUserId || null,
      startsAt: selectedSlot.value.startsAt,
      customerName: customer.name.trim(),
      customerEmail: customer.email.trim(),
      customerPhone: customer.phone.trim() || null,
      notes: customer.notes.trim() || null,
      consentDecisions: data.value.consents.map(consent => ({
        definitionId: consent.definitionId,
        versionId: consent.versionId,
        granted: Boolean(consentDecisions[consent.versionId]),
      })),
      bookingContext: bookingContext.value,
    }
    const fingerprint = JSON.stringify(bookingIntent)
    if (bookingIdempotencyIntent.value !== fingerprint) {
      bookingIdempotencyIntent.value = fingerprint
      bookingIdempotencyKey.value = crypto.randomUUID()
    }
    confirmation.value = await $fetch<PublicBookingConfirmation>(
      `/api/booking/widgets/${encodeURIComponent(widgetKey.value)}/booking`,
      {
        method: 'POST',
        body: {
          ...bookingIntent,
          idempotencyKey: bookingIdempotencyKey.value,
          isEmbedded: isEmbedded.value,
          previewToken: previewToken.value || undefined,
          visitId: analyticsVisitId.value,
        },
      },
    )
    postWidgetHeight()
  } catch (fetchError: unknown) {
    const candidate = fetchError as { statusCode?: number; data?: { statusMessage?: string }; message?: string }
    const detail = candidate.data?.statusMessage || candidate.message || ''
    const consentCatalogueChanged = /consent definitions changed/i.test(detail)
    const calculatorChanged = /calculator settings changed/i.test(detail)
    const ambiguousClient = /more than one client/i.test(detail)
    const invalidConsents = /consent decisions|required consents|phone number is required/i.test(detail)
    const slotConflict = /slot|term|booking request key/i.test(detail)
    bookingError.value = consentCatalogueChanged
      ? 'Treść zgód zmieniła się podczas rezerwacji. Sprawdź aktualne wersje i spróbuj ponownie.'
      : calculatorChanged
        ? 'Ustawienia kalkulatora zmieniły się. Wróć do kalkulatora, przelicz wynik i spróbuj ponownie.'
        : ambiguousClient
        ? 'Te dane kontaktowe pasują do kilku klientów. Skontaktuj się bezpośrednio z placówką.'
        : invalidConsents
          ? 'Sprawdź decyzje dotyczące zgód oraz wymagane dane kontaktowe.'
          : candidate.statusCode === 409 && slotConflict
            ? 'Ten termin został właśnie zajęty. Wybierz inny dostępny termin.'
            : detail || 'Nie udało się zarezerwować spotkania.'
    if (consentCatalogueChanged || calculatorChanged) await refreshWidgetCatalog()
    else if (candidate.statusCode === 409 && slotConflict) await loadSlots()
  } finally {
    bookingPending.value = false
  }
}

function postWidgetHeight() {
  if (!import.meta.client || !isEmbedded.value) return
  window.parent.postMessage({
    type: 'openexpert:booking-widget:resize',
    widgetKey: widgetKey.value,
    height: Math.ceil(document.documentElement.scrollHeight),
  }, '*')
}

function selectDate(date: string) {
  selectedDate.value = date
  if (selectedSlotDate.value && selectedSlotDate.value !== date) {
    selectedSlot.value = null
    contactStepOpen.value = false
  }
  trackEngagement()
}

function selectSlot(slot: PublicBookingSlot, date: string) {
  selectedDate.value = date
  selectedSlot.value = slot
  bookingError.value = ''
  trackEngagement()
  trackWidgetEvent('slot_selected', selectedServiceId.value)
  trackContactStarted()
}

function navigateWeek(direction: -1 | 1) {
  if (!weekStartDate.value) return
  const nextStart = addDaysToIsoDate(weekStartDate.value, direction * BOOKING_WEEK_DAYS)
  weekStartDate.value = nextStart < minimumDate.value ? minimumDate.value : nextStart
  selectedDate.value = weekStartDate.value
  selectedSlot.value = null
  contactStepOpen.value = false
  slotsExpanded.value = false
  trackEngagement()
  void loadSlots()
}

async function continueToContact() {
  if (!selectedSlot.value) return
  contactStepOpen.value = true
  await nextTick()
  document.getElementById('booking-contact-title')?.focus({ preventScroll: true })
  contactSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  postWidgetHeight()
}

function returnToSchedule() {
  contactStepOpen.value = false
  if (import.meta.client) {
    document.getElementById('booking-slot-title')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }
}

function onServiceSelected(value: unknown) {
  const serviceId = typeof value === 'string' ? value : ''
  selectedServiceId.value = serviceId
  if (!serviceId) return
  trackEngagement()
  trackWidgetEvent('service_selected', serviceId)
}

function trackContactStarted() {
  if (!selectedSlot.value) return
  const values = [customer.name, customer.email, customer.phone, customer.notes]
  if (!values.some(value => value.trim())) return
  trackEngagement()
  trackWidgetEvent('contact_started', selectedServiceId.value)
}

watch(selectedServiceId, (serviceId, previousServiceId) => {
  if (previousServiceId && serviceId !== previousServiceId) {
    slotsRequestId += 1
    selectedExpertId.value = data.value.widget.fixedExpertUserId ?? ''
    weekStartDate.value = minimumDate.value
    selectedDate.value = minimumDate.value
    selectedSlot.value = null
    slots.value = []
    slotsPending.value = false
    slotsError.value = ''
    slotsExpanded.value = false
    contactStepOpen.value = false
    shouldFindNextAvailableDate = true
  }
  if (
    canChooseExpert.value
    && selectedExpertId.value
    && !matchingExperts.value.some(expert => expert.userId === selectedExpertId.value)
  ) {
    selectedExpertId.value = ''
  }
}, { flush: 'sync' })
watch([selectedServiceId, selectedExpertId], loadSlots)
watch(canChooseExpert, (enabled) => {
  if (!enabled) selectedExpertId.value = data.value.widget.fixedExpertUserId ?? ''
})
watch(() => data.value.widget.fixedExpertUserId, (expertUserId) => {
  if (expertUserId) selectedExpertId.value = expertUserId
}, { immediate: true })
watch(
  [
    bookableServices,
    () => route.query.serviceId,
    () => route.query.expertId,
  ],
  ([services]) => {
    const requestedServiceId = typeof route.query.serviceId === 'string'
      ? route.query.serviceId
      : ''
    const requestedExpertId = typeof route.query.expertId === 'string'
      ? route.query.expertId
      : ''
    const requestedExpert = canChooseExpert.value
      ? data.value.experts.find(expert => expert.userId === requestedExpertId)
      : undefined
    const requestedService = services.find(service => service.id === requestedServiceId)
    const requestedPairIsCompatible = requestedService && (
      !requestedExpert || expertSupportsService(requestedExpert, requestedService.id)
    )
    const firstRequestedExpertService = requestedExpert
      ? services.find(service => expertSupportsService(requestedExpert, service.id))
      : undefined
    const nextServiceId = requestedPairIsCompatible
      ? requestedService.id
      : firstRequestedExpertService?.id
        ?? (services.some(service => service.id === selectedServiceId.value)
          ? selectedServiceId.value
          : services[0]?.id ?? '')

    if (nextServiceId !== selectedServiceId.value) {
      selectedServiceId.value = nextServiceId
    }

    const fixedExpertId = data.value.widget.fixedExpertUserId
    if (fixedExpertId) {
      selectedExpertId.value = fixedExpertId
    } else if (
      canChooseExpert.value
      && matchingExperts.value.some(expert => expert.userId === requestedExpertId)
    ) {
      selectedExpertId.value = requestedExpertId
    }
  },
  { immediate: true },
)
watch(() => data.value.consents, (consents) => {
  const versionIds = new Set(consents.map(consent => consent.versionId))
  for (const versionId of Object.keys(consentDecisions)) {
    if (!versionIds.has(versionId)) delete consentDecisions[versionId]
  }
  for (const consent of consents) {
    if (!(consent.versionId in consentDecisions)) consentDecisions[consent.versionId] = false
  }
}, { immediate: true })
watch(
  () => [customer.name, customer.email, customer.phone, customer.notes],
  trackContactStarted,
)

onMounted(() => {
  minimumDate.value = isoDateInTimezone(data.value.facility.timezone)
  weekStartDate.value ||= minimumDate.value
  selectedDate.value ||= minimumDate.value
  prefersDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  resizeObserver = new ResizeObserver(postWidgetHeight)
  resizeObserver.observe(document.body)
  postWidgetHeight()
  void loadSlots()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  clearNuxtState(analyticsVisitStateKey)
})
</script>

<template>
  <main
    class="booking-page"
    :class="{
      'booking-page--embedded': isEmbedded,
      'booking-page--calculator': data.widget.widgetType !== 'calendar',
      dark: isDark,
    }"
    :style="widgetStyle"
  >
    <section class="booking-widget" aria-labelledby="booking-title">
      <header class="booking-header">
        <div class="booking-brand" aria-label="OpenExpert">
          <img
            class="booking-brand__mark"
            :src="isDark ? '/assets/logo-dark.svg' : '/assets/logo-light.svg'"
            alt=""
          >
          <span>OpenExpert</span>
        </div>
        <h1 v-if="!showCalculator" id="booking-title" class="booking-sr-only">{{ data.widget.title }}</h1>
        <div v-if="data.facility.name" class="booking-facility">
          <UIcon name="i-lucide-map-pin" aria-hidden="true" />
          <span>
            <strong>{{ data.facility.name }}</strong>
            <small v-if="data.facility.address">{{ data.facility.address }}</small>
          </span>
        </div>
        <div v-if="showCalculator" class="booking-header__calculator">
          <p class="booking-header__eyebrow">{{ widgetEyebrow }}</p>
          <h1 id="booking-title">{{ data.widget.title }}</h1>
          <p v-if="data.widget.subtitle" class="booking-header__subtitle">{{ data.widget.subtitle }}</p>
        </div>
      </header>

      <nav
        v-if="status !== 'pending' && !error && !bookingUnavailableReason && !showCalculator"
        class="booking-steps"
        aria-label="Postęp rezerwacji"
      >
        <ol>
          <li
            :class="{
              'booking-step--active': bookingStep === 1,
              'booking-step--complete': bookingStep > 1,
            }"
          >
            <button type="button" :disabled="bookingStep === 1" @click="returnToSchedule">
              <span>1</span><strong>Termin</strong>
            </button>
          </li>
          <li
            :class="{
              'booking-step--active': bookingStep === 2,
              'booking-step--complete': bookingStep > 2,
            }"
          >
            <button
              type="button"
              :disabled="!selectedSlot || bookingStep === 2 || bookingStep === 3"
              @click="continueToContact"
            >
              <span>2</span><strong>Dane</strong>
            </button>
          </li>
          <li :class="{ 'booking-step--active': bookingStep === 3 }">
            <button type="button" disabled>
              <span>3</span><strong>Potwierdzenie</strong>
            </button>
          </li>
        </ol>
      </nav>

      <div v-if="status === 'pending'" class="booking-loading" aria-label="Ładowanie widgetu">
        <USkeleton class="h-12 w-full" />
        <USkeleton class="h-12 w-full" />
        <USkeleton class="h-48 w-full" />
      </div>

      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Widget jest chwilowo niedostępny"
        description="Odśwież stronę albo skontaktuj się bezpośrednio z placówką."
      />

      <section v-else-if="confirmation" class="booking-confirmation" aria-live="polite">
        <span class="booking-confirmation__icon"><UIcon name="i-lucide-check" /></span>
        <p class="booking-kicker">Rezerwacja potwierdzona</p>
        <h2>Do zobaczenia na spotkaniu</h2>
        <dl>
          <div><dt>Termin</dt><dd>{{ confirmationDate(confirmation.appointment.startsAt) }}</dd></div>
          <div><dt>Ekspert</dt><dd>{{ confirmation.appointment.expertName }}</dd></div>
          <div><dt>Placówka</dt><dd>{{ confirmation.appointment.facilityName }}</dd></div>
        </dl>
        <p class="booking-privacy">Rezerwację zapisano dla adresu {{ customer.email }}.</p>
        <div class="booking-confirmation__client">
          <div>
            <strong>Zachowaj dostęp do konsultacji</strong>
            <p>
              {{ confirmation.portalActivation === 'sent'
                ? 'Wysłaliśmy Ci bezpieczny link aktywacyjny. Możesz też otworzyć panel od razu.'
                : 'Aktywuj panel klienta, aby zobaczyć ten i kolejne terminy powiązane z Twoim potwierdzonym kontaktem.' }}
            </p>
          </div>
          <UButton
            :to="clientActivationLink"
            :target="isEmbedded ? '_top' : undefined"
            size="lg"
            icon="i-lucide-calendar-heart"
          >
            Otwórz panel klienta
          </UButton>
        </div>
      </section>

      <section
        v-else-if="bookingUnavailableReason"
        class="booking-unavailable"
        role="status"
        aria-live="polite"
      >
        <span class="booking-unavailable__icon" aria-hidden="true">
          <UIcon name="i-lucide-calendar-x-2" />
        </span>
        <p class="booking-kicker">Rezerwacja niedostępna</p>
        <h2>{{ bookingUnavailableReason.title }}</h2>
        <p>{{ bookingUnavailableReason.description }}</p>
        <small>Spróbuj ponownie później albo skontaktuj się bezpośrednio z placówką.</small>
      </section>

      <BookingCapacityCalculator
        v-else-if="showCalculator && data.widget.widgetType === 'mortgage_capacity'"
        class="booking-calculator"
        :policy="data.capacityPolicy"
        :policy-revision="data.capacityPolicyRevision ?? 0"
        @started="trackCalculatorStarted"
        @continue="continueFromCalculator"
      />

      <BookingPaymentCalculator
        v-else-if="showCalculator && data.widget.widgetType === 'mortgage_payment'"
        class="booking-calculator"
        @started="trackCalculatorStarted"
        @continue="continueFromCalculator"
      />

      <form v-else class="booking-form" @submit.prevent="submitBooking">
        <UAlert
          v-if="isPreview"
          color="neutral"
          variant="subtle"
          icon="i-lucide-eye"
          title="Tryb podglądu"
          description="Możesz sprawdzić cały formularz, ale rezerwacja nie zostanie zapisana."
        />

        <div v-if="data.widget.widgetType !== 'calendar'" class="booking-calculator-return">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            @click="returnToCalculator"
          >
            Wróć do kalkulatora
          </UButton>
          <span>Wynik kalkulacji zostanie zapisany przy rezerwacji.</span>
        </div>
        <section class="booking-context" aria-label="Wybrane spotkanie">
          <div class="booking-context__service">
            <span class="booking-context__icon" aria-hidden="true">
              <UIcon name="i-lucide-briefcase-business" />
            </span>
            <div v-if="bookableServices.length === 1" class="booking-context__copy">
              <small>Usługa</small>
              <strong>{{ selectedService?.name }}</strong>
              <span>{{ selectedService?.durationMinutes }} min</span>
            </div>
            <UFormField
              v-else
              name="service"
              label="Usługa"
              required
              class="booking-context__field"
            >
              <USelect
                :model-value="selectedServiceId"
                class="w-full"
                :items="serviceItems"
                variant="none"
                placeholder="Wybierz usługę"
                @update:model-value="onServiceSelected"
              />
            </UFormField>
          </div>

          <div class="booking-context__expert">
            <div v-if="!canChooseExpert" class="booking-expert-value">
              <UAvatar
                :src="selectedExpert?.avatarUrl || undefined"
                :alt="selectedExpertLabel"
                :text="expertInitials(selectedExpertLabel)"
                size="sm"
              />
              <span>
                <strong>{{ selectedExpertLabel }}</strong>
                <small>{{ expertRole(selectedExpert) }}</small>
              </span>
            </div>
            <UFormField
              v-else
              name="expert"
              label="Ekspert"
              :required="expertRequired"
              class="booking-context__field"
            >
              <USelectMenu
                v-model="selectedExpertSelectValue"
                class="booking-expert-select"
                :items="expertItems"
                value-key="value"
                label-key="label"
                description-key="description"
                :filter-fields="['label', 'description']"
                :search-input="matchingExperts.length > 6
                  ? { placeholder: 'Wyszukaj eksperta' }
                  : false"
                :content="{ sideOffset: 8, align: 'end' }"
                :ui="{
                  content: 'min-w-[min(390px,calc(100vw-32px))]',
                  viewport: 'p-1',
                  item: 'min-h-16 gap-3 p-3',
                }"
                variant="none"
                size="xl"
                aria-label="Wybierz eksperta"
                :placeholder="expertRequired ? 'Wybierz eksperta' : 'Dowolny dostępny ekspert'"
                @update:model-value="trackEngagement"
              >
                <template #default>
                  <div v-if="selectedExpertItem" class="booking-expert-value">
                    <UAvatarGroup
                      v-if="selectedExpertItem.kind === 'any'"
                      size="sm"
                      :max="3"
                      aria-hidden="true"
                    >
                      <UAvatar
                        v-for="expert in matchingExperts.slice(0, 3)"
                        :key="expert.userId"
                        :src="expert.avatarUrl || undefined"
                        :text="expertInitials(expert.name)"
                      />
                    </UAvatarGroup>
                    <UAvatar v-else v-bind="selectedExpertItem.avatar" size="sm" />
                    <span>
                      <strong>{{ selectedExpertItem.label }}</strong>
                      <small>{{ selectedExpertItem.description }}</small>
                    </span>
                  </div>
                </template>

                <template #item-leading="{ item }">
                  <span class="booking-expert-option__avatar">
                    <UAvatarGroup
                      v-if="item.kind === 'any'"
                      size="md"
                      :max="3"
                      aria-hidden="true"
                    >
                      <UAvatar
                        v-for="expert in matchingExperts.slice(0, 3)"
                        :key="expert.userId"
                        :src="expert.avatarUrl || undefined"
                        :text="expertInitials(expert.name)"
                      />
                    </UAvatarGroup>
                    <UAvatar v-else v-bind="item.avatar" size="md" aria-hidden="true" />
                    <span class="booking-expert-option__status" aria-hidden="true" />
                  </span>
                </template>

                <template #item-description="{ item }">
                  <span>{{ item.description }}</span>
                </template>
              </USelectMenu>
            </UFormField>
          </div>
        </section>

        <BookingWeekPicker
          :days="weekDays"
          :range-label="weekRangeLabel"
          :selected-date="selectedDate"
          :selected-slot="selectedSlot"
          :timezone="slotsTimezone"
          :pending="slotsPending"
          :error="slotsError"
          :can-go-previous="canGoPreviousWeek"
          :expanded="slotsExpanded"
          @previous="navigateWeek(-1)"
          @next="navigateWeek(1)"
          @select-date="selectDate"
          @select-slot="selectSlot"
          @toggle-expanded="slotsExpanded = !slotsExpanded"
        />

        <section
          v-if="contactStepOpen"
          ref="contactSection"
          class="booking-contact-step"
          aria-labelledby="booking-contact-title"
        >
          <header class="booking-contact-step__header">
            <div>
              <p>Dane</p>
              <h2 id="booking-contact-title" tabindex="-1">Dane kontaktowe</h2>
              <span>Potrzebne do potwierdzenia spotkania.</span>
            </div>
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              icon="i-lucide-arrow-left"
              @click="returnToSchedule"
            >
              Zmień termin
            </UButton>
          </header>

          <div class="booking-fields booking-fields--contact">
            <UFormField name="name" label="Imię i nazwisko" required>
              <UInput v-model="customer.name" class="w-full" autocomplete="name" required />
            </UFormField>
            <UFormField name="email" label="E-mail" required>
              <UInput v-model="customer.email" class="w-full" type="email" autocomplete="email" required />
            </UFormField>
            <UFormField
              name="phone"
              label="Telefon"
              :description="phoneFieldDescription"
              :hint="phoneRequired ? undefined : 'Opcjonalnie'"
              :required="phoneRequired"
              :error="phoneFieldError"
            >
              <UInput
                v-model="customer.phone"
                class="w-full"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                :required="phoneRequired"
                :aria-invalid="Boolean(phoneFieldError)"
              />
            </UFormField>
            <UFormField name="notes" label="Informacja dla eksperta" hint="Opcjonalnie" class="booking-field--wide">
              <UTextarea v-model="customer.notes" class="w-full" :rows="3" autoresize :maxrows="5" />
            </UFormField>
          </div>

          <section
            v-if="data.consents.length"
            class="booking-consents-step"
            aria-labelledby="booking-consents-title"
          >
            <div>
              <h3 id="booking-consents-title">Zgody i oświadczenia</h3>
              <p>Zapoznaj się z aktualną treścią i zaznacz wybrane zgody.</p>
            </div>

            <div class="booking-consents">
              <UCheckbox
                v-for="consent in data.consents"
                :id="`booking-consent-${consent.versionId}`"
                :key="consent.versionId"
                v-model="consentDecisions[consent.versionId]"
                :aria-label="consent.title"
                :aria-describedby="`booking-consent-description-${consent.versionId}`"
                :aria-required="consent.isRequired"
                :class="['booking-consent', {
                  'booking-consent--required': consent.isRequired,
                }]"
                :ui="{
                  container: 'pt-0.5',
                  wrapper: 'grid gap-2',
                  label: 'cursor-pointer font-normal',
                }"
              >
                <template #label>
                  <span class="booking-consent__body">
                    <span class="booking-consent__title">
                      <strong>{{ consent.title }}</strong>
                      <UBadge color="neutral" variant="subtle">
                        {{ consentChannelLabel(consent.channel) }}
                      </UBadge>
                      <UBadge :color="consent.isRequired ? 'error' : 'neutral'" variant="outline">
                        {{ consent.isRequired ? 'Wymagana' : 'Dobrowolna' }}
                      </UBadge>
                    </span>
                    <span
                      :id="`booking-consent-description-${consent.versionId}`"
                      class="booking-consent__description"
                    >
                      <span>{{ consent.content }}</span>
                      <small>Cel: {{ consent.purpose }} · Podstawa: {{ consent.legalBasis }}</small>
                      <small
                        v-if="consentDecisions[consent.versionId] && !consentChannelIsAvailable(consent.channel)"
                        class="booking-consent__channel-hint"
                      >
                        Uzupełnij {{ consent.channel === 'email' ? 'adres e-mail' : 'numer telefonu' }} przed potwierdzeniem rezerwacji.
                      </small>
                    </span>
                  </span>
                </template>
              </UCheckbox>
            </div>
          </section>
        </section>

        <UAlert v-if="bookingError" color="error" variant="subtle" :description="bookingError" />

        <footer class="booking-actionbar">
          <div class="booking-actionbar__summary">
            <span class="booking-actionbar__icon" aria-hidden="true">
              <UIcon name="i-lucide-calendar-days" />
            </span>
            <div>
              <p>
                <strong>{{ selectedSlotSummary }}</strong>
              </p>
              <small v-if="selectedService">
                {{ selectedService.name }} · {{ selectedExpertLabel }}
              </small>
              <small v-else>Wybierz usługę, aby zobaczyć terminy.</small>
            </div>
          </div>

          <button
            v-if="!contactStepOpen"
            type="button"
            class="booking-actionbar__button"
            :disabled="!selectedSlot || (expertRequired && !selectedExpertId)"
            @click="continueToContact"
          >
            <span>{{ selectedSlot ? 'Dalej' : 'Wybierz godzinę' }}</span>
            <UIcon name="i-lucide-arrow-right" aria-hidden="true" />
          </button>

          <button
            v-else
            type="submit"
            class="booking-actionbar__button"
            :disabled="isPreview || !selectedSlot || (expertRequired && !selectedExpertId) || !customer.name.trim() || !customer.email.trim() || !phoneRequirementMet || unmetRequiredConsents.length > 0 || bookingPending"
          >
            <UIcon v-if="bookingPending" name="i-lucide-loader-circle" class="booking-spin" />
            <span>
              {{ isPreview ? 'Rezerwacja wyłączona w podglądzie' : bookingPending ? 'Rezerwuję…' : 'Potwierdź rezerwację' }}
            </span>
            <UIcon v-if="!bookingPending && !isPreview" name="i-lucide-arrow-right" aria-hidden="true" />
          </button>
        </footer>
      </form>
    </section>
  </main>
</template>

<style scoped>
.booking-page {
  --booking-frame-gutter: 24px;
  min-height: 100vh;
  padding: 0;
  background: var(--ui-bg-muted);
  color: var(--ui-text);
}
.booking-page--embedded {
  min-height: auto;
  padding: 0;
  background: transparent;
}

.booking-widget {
  width: 100%;
  margin: 0 auto;
  background: var(--ui-bg);
}

.booking-page--calculator .booking-widget {
  width: 100%;
}

.booking-page--calculator .booking-header {
  flex-wrap: wrap;
}

.booking-page--embedded .booking-widget {
  width: 100%;
  overflow: clip;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  box-shadow: none;
}

.booking-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.booking-header {
  display: flex;
  width: min(calc(100% - (var(--booking-frame-gutter) * 2)), 1180px);
  align-items: center;
  gap: 24px;
  margin: 0 auto;
  padding: 20px 0;
  border-bottom: 1px solid var(--ui-border);
}

.booking-brand {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 750;
}

.booking-brand__mark {
  display: block;
  width: 30px;
  height: 30px;
  object-fit: contain;
}

.booking-facility {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-left: auto;
  color: var(--ui-text);
}

.booking-facility > .icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--booking-accent);
}

.booking-facility strong,
.booking-facility small {
  display: block;
}

.booking-facility strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.booking-facility small {
  max-width: 44ch;
  margin-top: 1px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.booking-header__calculator {
  flex-basis: 100%;
  padding-top: 24px;
}

.booking-header__eyebrow,
.booking-kicker {
  margin: 0 0 8px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.booking-header__calculator h1 {
  max-width: 680px;
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(34px, 6vw, 58px);
  font-weight: 350;
  letter-spacing: -.045em;
  line-height: 1;
}

.booking-header__subtitle {
  max-width: 600px;
  margin: 16px 0 0;
  color: var(--ui-text-muted);
  font-size: 17px;
}

.booking-steps {
  width: min(calc(100% - (var(--booking-frame-gutter) * 2)), 1180px);
  margin: 0 auto;
  padding: 11px 0;
  border-bottom: 1px solid var(--ui-border);
}

.booking-steps ol {
  display: grid;
  max-width: 660px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 44px;
  margin: 0 auto;
  padding: 0;
  list-style: none;
}

.booking-steps li {
  position: relative;
  min-width: 0;
}

.booking-steps li:not(:last-child)::after {
  position: absolute;
  top: 17px;
  left: calc(100% + 10px);
  width: 24px;
  height: 1px;
  background: var(--ui-border-accented);
  content: "";
}

.booking-steps button {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
}

.booking-steps button:not(:disabled) {
  cursor: pointer;
}

.booking-steps button > span {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--ui-border-accented);
  border-radius: 50%;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
}

.booking-steps strong {
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.booking-step--active button,
.booking-step--complete button {
  color: var(--booking-accent);
}

.booking-step--active button > span,
.booking-step--complete button > span {
  border-color: var(--booking-accent);
  box-shadow: inset 0 0 0 1px var(--booking-accent);
}

.booking-loading,
.booking-form,
.booking-calculator {
  --booking-form-padding: clamp(20px, 4vw, 42px);
  display: grid;
  width: min(calc(100% - (var(--booking-frame-gutter) * 2)), 1180px);
  gap: 24px;
  margin: 0 auto;
  padding: 12px 0 0;
}

.booking-loading {
  gap: 12px;
}

.booking-calculator-return {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-size: 12px;
}

.booking-context {
  display: grid;
  min-height: 74px;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 410px);
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: color-mix(in srgb, var(--ui-bg-elevated) 72%, var(--ui-bg));
}

.booking-context__service {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  padding: 10px 14px;
}

.booking-context__expert {
  display: flex;
  min-width: 0;
  align-items: stretch;
  padding: 7px;
  border-left: 1px solid var(--ui-border);
}

.booking-context__icon,
.booking-actionbar__icon {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--booking-accent) 35%, var(--ui-border));
  border-radius: var(--oe-radius-control);
  color: var(--booking-accent);
  font-size: 17px;
}

.booking-context__copy {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;
}

.booking-context__copy small {
  display: none;
}

.booking-context__copy strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.booking-context__copy > span {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.booking-context__field {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
}

.booking-context__field :deep([data-slot="labelWrapper"]) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

.booking-context__field :deep(.relative.mt-1) {
  width: 100%;
  margin-top: 0;
}

.booking-context__service .booking-context__field :deep([data-slot="base"]) {
  min-height: 48px;
  padding-inline: 0 34px;
  background: transparent;
  font-size: 14px;
  font-weight: 650;
}

.booking-context__service .booking-context__field :deep([data-slot="leading"]) {
  padding-inline-start: 0;
}

.booking-expert-select {
  width: 100%;
  min-height: 58px;
  padding: 5px 42px 5px 8px;
  background: transparent;
}

.booking-expert-value {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 11px;
  text-align: left;
}

.booking-context__expert > .booking-expert-value {
  width: 100%;
  padding: 5px 10px;
}

.booking-expert-value > span {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.booking-expert-value strong,
.booking-expert-value small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.booking-expert-value strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.booking-expert-value small {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 450;
}

.booking-expert-option__avatar {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}

.booking-expert-option__status {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--ui-bg);
  border-radius: 50%;
  background: var(--ui-success);
}

.booking-contact-step {
  display: grid;
  gap: 24px;
  scroll-margin-top: 20px;
  padding-top: 28px;
  border-top: 1px solid var(--ui-border);
}

.booking-contact-step__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 20px;
}

.booking-contact-step__header p {
  margin: 0 0 5px;
  color: var(--booking-accent);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.booking-contact-step h2,
.booking-consents-step h3,
.booking-confirmation h2,
.booking-unavailable h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -.02em;
}

.booking-contact-step__header span,
.booking-consents-step > div > p {
  display: block;
  margin: 3px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.booking-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.booking-field--wide {
  grid-column: 1 / -1;
}

.booking-consents-step {
  display: grid;
  gap: 16px;
  padding-top: 24px;
  border-top: 1px solid var(--ui-border);
}

.booking-consents-step h3 {
  font-size: 17px;
}

.booking-consents {
  display: grid;
  gap: 12px;
}

.booking-consent {
  position: relative;
  padding: 15px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
  cursor: pointer;
  transition:
    border-color var(--oe-motion-fast),
    background-color var(--oe-motion-fast);
}

.booking-consent :deep([data-slot="label"])::before {
  position: absolute;
  z-index: 1;
  inset: 0;
  content: "";
  cursor: pointer;
}

.booking-consent :deep([data-slot="base"]) {
  position: relative;
  z-index: 2;
}

.booking-consent--required {
  border-color: var(--ui-error);
}

.booking-consent:has([data-state="checked"]) {
  border-color: color-mix(in srgb, var(--booking-accent) 65%, var(--ui-border));
  background: color-mix(in srgb, var(--booking-accent) 7%, var(--ui-bg-muted));
}

.booking-consent__body {
  display: grid;
  gap: 8px;
}

.booking-consent__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-highlighted);
}

.booking-consent__title strong {
  margin-right: auto;
}

.booking-consent__description {
  display: grid;
  gap: 6px;
  color: var(--ui-text-muted);
}

.booking-consent small {
  color: var(--ui-text-dimmed);
  font-size: 11px;
  line-height: 1.45;
}

.booking-consent .booking-consent__channel-hint {
  color: var(--ui-warning);
}

.booking-actionbar {
  position: sticky;
  z-index: 10;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin: 0;
  padding: 18px 0;
  isolation: isolate;
}

.booking-actionbar::before {
  position: absolute;
  z-index: -1;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 100vw;
  transform: translateX(-50%);
  border-top: 1px solid var(--ui-border);
  background: var(--ui-bg);
  box-shadow: 0 -12px 34px color-mix(in srgb, var(--ui-text-highlighted) 6%, transparent);
  content: "";
  pointer-events: none;
}

.booking-actionbar__summary {
  display: grid;
  min-width: 0;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}

.booking-actionbar__summary p {
  overflow: hidden;
  margin: 0 0 2px;
  color: var(--ui-text-highlighted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.booking-actionbar__summary strong {
  font-size: 15px;
  font-weight: 650;
}

.booking-actionbar__summary small,
.booking-privacy {
  display: block;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.booking-actionbar__button {
  display: inline-flex;
  min-width: 210px;
  min-height: 50px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 22px;
  border: 0;
  border-radius: var(--oe-radius-control);
  background: var(--booking-accent);
  color: white;
  font-weight: 700;
  cursor: pointer;
  transition:
    opacity var(--oe-motion-fast),
    transform var(--oe-motion-fast);
}

.booking-actionbar__button:hover:not(:disabled) {
  transform: translateY(-1px);
}

.booking-actionbar__button:disabled {
  opacity: .38;
  cursor: not-allowed;
}

.booking-confirmation {
  display: grid;
  justify-items: start;
  padding: clamp(32px, 7vw, 72px);
}

.booking-confirmation__icon {
  display: grid;
  width: 58px;
  height: 58px;
  margin-bottom: 26px;
  place-items: center;
  border-radius: 18px;
  background: var(--booking-accent);
  color: white;
  font-size: 26px;
}

.booking-confirmation dl {
  display: grid;
  width: 100%;
  margin: 32px 0 18px;
  border-top: 1px solid var(--ui-border);
}

.booking-confirmation dl div {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 18px;
  padding: 14px 0;
  border-bottom: 1px solid var(--ui-border);
}

.booking-confirmation dt {
  color: var(--ui-text-muted);
  font-size: 13px;
}

.booking-confirmation dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.booking-confirmation__client {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 28px;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-elevated);
}

.booking-confirmation__client div {
  display: grid;
  gap: 5px;
}

.booking-confirmation__client strong {
  color: var(--ui-text-highlighted);
  font-size: 15px;
}

.booking-confirmation__client p {
  max-width: 48ch;
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 13px;
  line-height: 1.5;
}

.booking-unavailable {
  display: grid;
  min-height: 360px;
  justify-items: center;
  gap: 10px;
  padding: clamp(40px, 8vw, 88px);
  text-align: center;
}

.booking-unavailable__icon {
  display: grid;
  width: 62px;
  height: 62px;
  margin-bottom: 12px;
  place-items: center;
  border: 1px solid var(--ui-border-accented);
  border-radius: 19px;
  background: var(--ui-bg-muted);
  color: var(--booking-accent);
  font-size: 27px;
}

.booking-unavailable > p:not(.booking-kicker),
.booking-unavailable > small {
  max-width: 520px;
  margin: 0;
  color: var(--ui-text-muted);
  line-height: 1.55;
}

.booking-unavailable > small {
  font-size: 12px;
}

.booking-spin {
  animation: booking-spin 1s linear infinite;
}

@keyframes booking-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 900px) {
  .booking-widget {
    width: 100%;
  }

  .booking-context {
    max-width: none;
  }

  .booking-header,
  .booking-steps,
  .booking-loading,
  .booking-form,
  .booking-calculator {
    width: min(100% - 36px, 720px);
  }
}

@media (max-width: 720px) {
  .booking-page {
    --booking-frame-gutter: 18px;
    padding: 0;
  }

  .booking-widget {
    min-height: 100vh;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .booking-page--embedded .booking-widget {
    min-height: auto;
  }

  .booking-header {
    width: 100%;
    flex-wrap: wrap;
    gap: 14px;
    padding: 16px 18px;
  }

  .booking-brand__mark {
    width: 27px;
    height: 27px;
  }

  .booking-facility {
    width: 100%;
    margin-left: 0;
    padding-top: 12px;
    border-top: 1px solid var(--ui-border);
  }

  .booking-steps {
    width: 100%;
    padding: 14px 18px;
  }

  .booking-steps ol {
    gap: 12px;
  }

  .booking-steps li:not(:last-child)::after {
    display: none;
  }

  .booking-steps button {
    gap: 6px;
    min-height: 44px;
  }

  .booking-steps button > span {
    width: 30px;
    height: 30px;
  }

  .booking-steps strong {
    font-size: 10px;
  }

  .booking-loading,
  .booking-form,
  .booking-calculator {
    --booking-form-padding: 18px;
    width: 100%;
    gap: 24px;
    padding: 24px 18px 0;
  }

  .booking-calculator-return,
  .booking-contact-step__header,
  .booking-confirmation__client {
    align-items: flex-start;
    flex-direction: column;
  }

  .booking-context__copy {
    display: grid;
    gap: 1px;
  }

  .booking-context {
    grid-template-columns: 1fr;
  }

  .booking-context__expert {
    border-top: 1px solid var(--ui-border);
    border-left: 0;
  }

  .booking-context__copy > span {
    font-size: 11px;
  }

  .booking-fields {
    grid-template-columns: 1fr;
  }

  .booking-field--wide {
    grid-column: auto;
  }

  .booking-actionbar {
    align-items: stretch;
    flex-direction: column;
    gap: 14px;
    padding-top: 14px;
    padding-bottom: max(14px, env(safe-area-inset-bottom));
  }

  .booking-actionbar__button {
    width: 100%;
  }

  .booking-actionbar__summary strong {
    font-size: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .booking-actionbar__button {
    transition: none;
  }
}
</style>
