<script setup lang="ts">
import { DEFAULT_MORTGAGE_CAPACITY_POLICY } from '@openexpert/mortgage'
import type { BookingCalculatorSnapshot, BookingWidgetSnapshot } from '#shared/types/booking-calculators'
import BookingCapacityCalculator from '~/components/booking/BookingCapacityCalculator.vue'
import BookingPaymentCalculator from '~/components/booking/BookingPaymentCalculator.vue'
import type {
  PublicBookingConfirmation,
  PublicBookingConsent,
  PublicBookingSlot,
  PublicBookingSlotsPayload,
  PublicBookingWidgetPayload,
} from '~/types/booking'

definePageMeta({ layout: false })

const route = useRoute()
const widgetKey = computed(() => String(route.params.widgetKey ?? ''))
const isEmbedded = computed(() => route.query.embed === '1')
const selectedServiceId = ref('')
const selectedExpertId = ref('')
const selectedDate = ref('')
const minimumDate = ref('')
const selectedSlot = ref<PublicBookingSlot | null>(null)
const slots = ref<PublicBookingSlot[]>([])
const slotsTimezone = ref('Europe/Warsaw')
const slotsPending = ref(false)
const slotsError = ref('')
const bookingPending = ref(false)
const bookingError = ref('')
const bookingIdempotencyKey = ref('')
const bookingIdempotencyIntent = ref('')
const confirmation = ref<PublicBookingConfirmation | null>(null)
const calculatorSnapshot = ref<BookingCalculatorSnapshot | null>(null)
const prefersDark = ref(false)
const consentDecisions = reactive<Record<string, boolean>>({})
let resizeObserver: ResizeObserver | null = null
let slotsRequestId = 0
const customer = reactive({
  name: '',
  email: '',
  phone: '',
  notes: '',
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
      title: 'Brak dostępnych usług',
      description: 'Placówka nie udostępniła jeszcze usług, które można zarezerwować przez ten widget.',
    }
  }
  if (!bookableServices.value.length) {
    return data.value.widget.fixedExpertUserId
      ? {
          title: 'Ekspert jest obecnie niedostępny',
          description: 'Wybrany ekspert nie obsługuje obecnie żadnej z usług dostępnych w tym widgecie.',
        }
      : {
          title: 'Brak dostępnych ekspertów',
          description: 'Żaden ekspert nie obsługuje obecnie usług dostępnych w tym widgecie.',
        }
  }
  return null
})

const serviceItems = computed(() => bookableServices.value.map(service => ({
  label: `${service.name} · ${service.durationMinutes} min`,
  value: service.id,
})))

const matchingExperts = computed(() => data.value.experts.filter((expert) => {
  return expertSupportsService(expert, selectedServiceId.value)
}))

const expertItems = computed(() => [
  ...(expertRequired.value ? [] : [{ label: 'Dowolny dostępny ekspert', value: '' }]),
  ...matchingExperts.value.map(expert => ({ label: expert.name, value: expert.userId })),
])

const selectedService = computed(() => (
  data.value.services.find(service => service.id === selectedServiceId.value)
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

function fullDate(value: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: slotsTimezone.value,
  }).format(new Date(`${value}T12:00:00Z`))
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

async function continueFromCalculator(snapshot: BookingCalculatorSnapshot) {
  calculatorSnapshot.value = snapshot
  await nextTick()
  if (import.meta.client && !isEmbedded.value) window.scrollTo({ top: 0, behavior: 'smooth' })
  postWidgetHeight()
}

async function returnToCalculator() {
  calculatorSnapshot.value = null
  selectedSlot.value = null
  await nextTick()
  postWidgetHeight()
}

async function loadSlots() {
  const requestId = ++slotsRequestId
  const serviceId = selectedServiceId.value
  const expertId = selectedExpertId.value
  const date = selectedDate.value
  selectedSlot.value = null
  slots.value = []
  slotsError.value = ''
  if (!serviceId || !date) {
    slotsPending.value = false
    return
  }

  slotsPending.value = true
  try {
    const result = await $fetch<PublicBookingSlotsPayload>(
      `/api/booking/widgets/${encodeURIComponent(widgetKey.value)}/slots`,
      {
        query: {
          date,
          serviceId,
          expertId: expertId || undefined,
        },
      },
    )
    if (
      requestId !== slotsRequestId
      || serviceId !== selectedServiceId.value
      || expertId !== selectedExpertId.value
      || date !== selectedDate.value
    ) return
    slots.value = result.slots
    slotsTimezone.value = result.timezone
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

watch([selectedServiceId, selectedExpertId, selectedDate], loadSlots)
watch(selectedServiceId, () => {
  if (
    canChooseExpert.value
    && selectedExpertId.value
    && !matchingExperts.value.some(expert => expert.userId === selectedExpertId.value)
  ) {
    selectedExpertId.value = ''
  }
})
watch(canChooseExpert, (enabled) => {
  if (!enabled) selectedExpertId.value = data.value.widget.fixedExpertUserId ?? ''
})
watch(() => data.value.widget.fixedExpertUserId, (expertUserId) => {
  if (expertUserId) selectedExpertId.value = expertUserId
}, { immediate: true })
watch(bookableServices, (services) => {
  if (services.some(service => service.id === selectedServiceId.value)) return
  selectedServiceId.value = services.length === 1 ? services[0]?.id ?? '' : ''
}, { immediate: true })
watch(() => data.value.consents, (consents) => {
  const versionIds = new Set(consents.map(consent => consent.versionId))
  for (const versionId of Object.keys(consentDecisions)) {
    if (!versionIds.has(versionId)) delete consentDecisions[versionId]
  }
  for (const consent of consents) {
    if (!(consent.versionId in consentDecisions)) consentDecisions[consent.versionId] = false
  }
}, { immediate: true })
watch(() => [customer.email, customer.phone], () => {
  for (const consent of data.value.consents) {
    if (!consentChannelIsAvailable(consent.channel)) consentDecisions[consent.versionId] = false
  }
})

onMounted(() => {
  minimumDate.value = isoDateInTimezone(data.value.facility.timezone)
  selectedDate.value ||= minimumDate.value
  prefersDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  resizeObserver = new ResizeObserver(postWidgetHeight)
  resizeObserver.observe(document.body)
  postWidgetHeight()
})

onBeforeUnmount(() => resizeObserver?.disconnect())
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
          <span class="booking-brand__mark">OE</span>
          <span>OpenExpert</span>
        </div>
        <p class="booking-header__eyebrow">{{ widgetEyebrow }}</p>
        <h1 id="booking-title">{{ data.widget.title }}</h1>
        <p v-if="data.widget.subtitle" class="booking-header__subtitle">{{ data.widget.subtitle }}</p>
        <div v-if="data.facility.name" class="booking-facility">
          <UIcon name="i-lucide-map-pin" aria-hidden="true" />
          <span>
            <strong>{{ data.facility.name }}</strong>
            <small v-if="data.facility.address">{{ data.facility.address }}</small>
          </span>
        </div>
      </header>

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
          <div><dt>Usługa</dt><dd>{{ confirmation.appointment.serviceName }}</dd></div>
          <div><dt>Ekspert</dt><dd>{{ confirmation.appointment.expertName }}</dd></div>
          <div><dt>Placówka</dt><dd>{{ confirmation.appointment.facilityName }}</dd></div>
        </dl>
        <p class="booking-privacy">Rezerwację zapisano dla adresu {{ customer.email }}.</p>
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
        @continue="continueFromCalculator"
      />

      <BookingPaymentCalculator
        v-else-if="showCalculator && data.widget.widgetType === 'mortgage_payment'"
        class="booking-calculator"
        @continue="continueFromCalculator"
      />

      <form v-else class="booking-form" @submit.prevent="submitBooking">
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
        <section class="booking-section" aria-labelledby="booking-details-title">
          <div class="booking-section__heading">
            <span>01</span>
            <div><h2 id="booking-details-title">Wybierz spotkanie</h2><p>Usługa, ekspert i dzień.</p></div>
          </div>

          <div class="booking-fields">
            <UFormField name="service" label="Usługa" required>
              <USelect
                v-model="selectedServiceId"
                class="w-full"
                :items="serviceItems"
                placeholder="Wybierz usługę"
                icon="i-lucide-briefcase-business"
              />
            </UFormField>
            <UFormField v-if="canChooseExpert" name="expert" label="Ekspert" :required="expertRequired">
              <USelect
                v-model="selectedExpertId"
                class="w-full"
                :items="expertItems"
                :placeholder="expertRequired ? 'Wybierz eksperta' : 'Dowolny dostępny ekspert'"
                icon="i-lucide-user-round"
              />
            </UFormField>
            <UFormField name="date" label="Data" required>
              <UInput
                v-model="selectedDate"
                class="w-full"
                type="date"
                :min="minimumDate"
                icon="i-lucide-calendar-days"
              />
            </UFormField>
          </div>
        </section>

        <section class="booking-section" aria-labelledby="booking-slot-title">
          <div class="booking-section__heading">
            <span>02</span>
            <div>
              <h2 id="booking-slot-title">Wybierz godzinę</h2>
              <p>{{ selectedDate ? fullDate(selectedDate) : 'Najpierw wybierz datę.' }}</p>
            </div>
          </div>

          <div v-if="slotsPending" class="booking-slots booking-slots--loading">
            <USkeleton v-for="item in 6" :key="item" class="h-11 w-full" />
          </div>
          <UAlert v-else-if="slotsError" color="error" variant="subtle" :description="slotsError" />
          <div v-else-if="slots.length" class="booking-slots" role="radiogroup" aria-label="Dostępne godziny">
            <button
              v-for="slot in slots"
              :key="`${slot.startsAt}-${slot.expertUserId}`"
              type="button"
              class="booking-slot"
              :class="{ 'booking-slot--selected': selectedSlot?.startsAt === slot.startsAt && selectedSlot?.expertUserId === slot.expertUserId }"
              role="radio"
              :aria-checked="selectedSlot?.startsAt === slot.startsAt && selectedSlot?.expertUserId === slot.expertUserId"
              @click="selectedSlot = slot"
            >
              <strong>{{ slotTime(slot) }}</strong>
              <small>{{ slot.expertName }}</small>
            </button>
          </div>
          <div v-else class="booking-empty">
            <UIcon name="i-lucide-calendar-x-2" />
            <p>{{ selectedServiceId && selectedDate ? 'Brak wolnych terminów tego dnia.' : 'Wybierz usługę i dzień, żeby zobaczyć terminy.' }}</p>
          </div>
        </section>

        <section class="booking-section" aria-labelledby="booking-contact-title">
          <div class="booking-section__heading">
            <span>03</span>
            <div><h2 id="booking-contact-title">Dane kontaktowe</h2><p>Potrzebne do potwierdzenia spotkania.</p></div>
          </div>

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
        </section>

        <section
          v-if="data.consents.length"
          class="booking-section"
          aria-labelledby="booking-consents-title"
        >
          <div class="booking-section__heading">
            <span>04</span>
            <div>
              <h2 id="booking-consents-title">Zgody i oświadczenia</h2>
              <p>Zapoznaj się z aktualną treścią i zaznacz wybrane zgody.</p>
            </div>
          </div>

          <div class="booking-consents">
            <UCheckbox
              v-for="consent in data.consents"
              :id="`booking-consent-${consent.versionId}`"
              :key="consent.versionId"
              v-model="consentDecisions[consent.versionId]"
              :disabled="!consentChannelIsAvailable(consent.channel)"
              :aria-required="consent.isRequired"
              :class="['booking-consent', {
                'booking-consent--required': consent.isRequired,
                'booking-consent--disabled': !consentChannelIsAvailable(consent.channel),
              }]"
              :ui="{
                container: 'pt-0.5',
                wrapper: 'grid gap-2',
                label: 'cursor-pointer',
                description: 'grid gap-1.5',
              }"
            >
              <template #label>
                <span class="booking-consent__title">
                  <strong>{{ consent.title }}</strong>
                  <UBadge color="neutral" variant="subtle">
                    {{ consentChannelLabel(consent.channel) }}
                  </UBadge>
                  <UBadge :color="consent.isRequired ? 'error' : 'neutral'" variant="outline">
                    {{ consent.isRequired ? 'Wymagana' : 'Dobrowolna' }}
                  </UBadge>
                </span>
              </template>
              <template #description>
                <span>{{ consent.content }}</span>
                <small>Cel: {{ consent.purpose }} · Podstawa: {{ consent.legalBasis }}</small>
                <small v-if="!consentChannelIsAvailable(consent.channel)" class="booking-consent__warning">
                  Uzupełnij {{ consent.channel === 'email' ? 'adres e-mail' : 'numer telefonu' }}, aby wybrać tę zgodę.
                </small>
              </template>
            </UCheckbox>
          </div>
        </section>

        <UAlert v-if="bookingError" color="error" variant="subtle" :description="bookingError" />

        <footer class="booking-submit">
          <div>
            <p v-if="selectedSlot && selectedService">
              <strong>{{ slotTime(selectedSlot) }}</strong> · {{ selectedService.name }}
            </p>
            <small>Klient i decyzje dotyczące zgód zostaną zapisane w CRM placówki.</small>
          </div>
          <button
            type="submit"
            class="booking-submit__button"
            :disabled="!selectedSlot || (expertRequired && !selectedExpertId) || !customer.name.trim() || !customer.email.trim() || !phoneRequirementMet || unmetRequiredConsents.length > 0 || bookingPending"
          >
            <UIcon v-if="bookingPending" name="i-lucide-loader-circle" class="booking-spin" />
            <span>{{ bookingPending ? 'Rezerwuję…' : 'Potwierdź rezerwację' }}</span>
            <UIcon v-if="!bookingPending" name="i-lucide-arrow-right" />
          </button>
        </footer>
      </form>
    </section>
  </main>
</template>

<style scoped>
.booking-page {
  min-height: 100vh;
  padding: clamp(16px, 4vw, 48px);
  background:
    radial-gradient(circle at 10% 0%, color-mix(in srgb, var(--booking-accent) 9%, transparent), transparent 36rem),
    var(--ui-bg-muted);
  color: var(--ui-text);
}
.booking-page--embedded { min-height: auto; padding: 0; background: transparent; }
.booking-widget { width: min(100%, 880px); margin: 0 auto; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 24px; background: var(--ui-bg); box-shadow: 0 24px 70px color-mix(in srgb, var(--ui-text-highlighted) 9%, transparent); }
.booking-page--calculator .booking-widget { width: min(100%, 1120px); }
.booking-page--embedded .booking-widget { width: 100%; border-radius: 16px; box-shadow: none; }
.booking-header { padding: clamp(24px, 5vw, 48px); border-bottom: 1px solid var(--ui-border); background: linear-gradient(135deg, color-mix(in srgb, var(--booking-accent) 7%, var(--ui-bg)), var(--ui-bg)); }
.booking-brand { display: flex; align-items: center; gap: 9px; margin-bottom: 36px; color: var(--ui-text-highlighted); font-size: 13px; font-weight: 750; }
.booking-brand__mark { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--booking-accent); color: white; font-size: 10px; letter-spacing: -.04em; }
.booking-header__eyebrow, .booking-kicker { margin: 0 0 8px; color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.booking-header h1 { max-width: 680px; margin: 0; color: var(--ui-text-highlighted); font-size: clamp(34px, 6vw, 58px); font-weight: 350; letter-spacing: -.045em; line-height: 1; }
.booking-header__subtitle { max-width: 600px; margin: 16px 0 0; color: var(--ui-text-muted); font-size: 17px; }
.booking-facility { display: flex; align-items: flex-start; gap: 10px; margin-top: 28px; color: var(--ui-text); }
.booking-facility > .icon { margin-top: 3px; color: var(--booking-accent); }
.booking-facility strong, .booking-facility small { display: block; }
.booking-facility small { margin-top: 2px; color: var(--ui-text-muted); }
.booking-loading, .booking-form, .booking-calculator { display: grid; gap: 0; padding: clamp(20px, 4vw, 40px); }
.booking-loading { gap: 12px; }
.booking-calculator-return { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--ui-border); color: var(--ui-text-muted); font-size: 12px; }
.booking-section { padding: 28px 0; border-bottom: 1px solid var(--ui-border); }
.booking-section:first-child { padding-top: 0; }
.booking-section__heading { display: grid; grid-template-columns: 36px minmax(0, 1fr); align-items: start; gap: 12px; margin-bottom: 22px; }
.booking-section__heading > span { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid color-mix(in srgb, var(--booking-accent) 24%, var(--ui-border)); border-radius: 10px; color: var(--booking-accent); font-family: var(--font-mono); font-size: 10px; font-weight: 700; }
.booking-section h2, .booking-confirmation h2, .booking-unavailable h2 { margin: 0; color: var(--ui-text-highlighted); font-size: 22px; font-weight: 550; letter-spacing: -.02em; }
.booking-section__heading p { margin: 3px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.booking-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.booking-fields--contact { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.booking-field--wide { grid-column: 1 / -1; }
.booking-consents { display: grid; gap: 12px; }
.booking-consent { padding: 15px; border: 1px solid var(--ui-border); border-radius: 14px; background: var(--ui-bg-muted); }
.booking-consent--required { border-color: var(--ui-error); }
.booking-consent--disabled { opacity: .68; }
.booking-consent__title { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; color: var(--ui-text-highlighted); }
.booking-consent__title strong { margin-right: auto; }
.booking-consent small { color: var(--ui-text-dimmed); font-size: 11px; line-height: 1.45; }
.booking-consent__warning { color: var(--ui-text-error) !important; }
.booking-slots { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.booking-slots--loading { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.booking-slot { display: grid; gap: 1px; min-height: 58px; padding: 9px 12px; border: 1px solid var(--ui-border); border-radius: 12px; background: var(--ui-bg); color: var(--ui-text); text-align: left; cursor: pointer; transition: border-color var(--oe-motion-fast), transform var(--oe-motion-fast), background var(--oe-motion-fast); }
.booking-slot:hover { border-color: var(--booking-accent); transform: translateY(-1px); }
.booking-slot--selected { border-color: var(--booking-accent); background: color-mix(in srgb, var(--booking-accent) 8%, var(--ui-bg)); box-shadow: inset 0 0 0 1px var(--booking-accent); }
.booking-slot strong { color: var(--ui-text-highlighted); font-size: 15px; }
.booking-slot small { overflow: hidden; color: var(--ui-text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.booking-empty { display: grid; place-items: center; min-height: 120px; padding: 24px; border: 1px dashed var(--ui-border-accented); border-radius: 14px; color: var(--ui-text-muted); text-align: center; }
.booking-empty > .icon { font-size: 24px; }
.booking-empty p { margin: 8px 0 0; }
.booking-submit { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding-top: 28px; }
.booking-submit p { margin: 0 0 3px; color: var(--ui-text-highlighted); }
.booking-submit small, .booking-privacy { color: var(--ui-text-muted); font-size: 12px; }
.booking-submit__button { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 50px; padding: 0 20px; border: 0; border-radius: 14px; background: var(--booking-accent); color: white; font-weight: 700; cursor: pointer; transition: opacity var(--oe-motion-fast), transform var(--oe-motion-fast); }
.booking-submit__button:hover:not(:disabled) { transform: translateY(-1px); }
.booking-submit__button:disabled { opacity: .4; cursor: not-allowed; }
.booking-confirmation { display: grid; justify-items: start; padding: clamp(32px, 7vw, 72px); }
.booking-confirmation__icon { display: grid; place-items: center; width: 58px; height: 58px; margin-bottom: 26px; border-radius: 18px; background: var(--booking-accent); color: white; font-size: 26px; }
.booking-confirmation dl { display: grid; width: 100%; margin: 32px 0 18px; border-top: 1px solid var(--ui-border); }
.booking-confirmation dl div { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 18px; padding: 14px 0; border-bottom: 1px solid var(--ui-border); }
.booking-confirmation dt { color: var(--ui-text-muted); font-size: 13px; }
.booking-confirmation dd { margin: 0; color: var(--ui-text-highlighted); font-weight: 600; }
.booking-unavailable { display: grid; justify-items: center; gap: 10px; min-height: 360px; padding: clamp(40px, 8vw, 88px); text-align: center; }
.booking-unavailable__icon { display: grid; width: 62px; height: 62px; margin-bottom: 12px; place-items: center; border: 1px solid var(--ui-border-accented); border-radius: 19px; background: var(--ui-bg-muted); color: var(--booking-accent); font-size: 27px; }
.booking-unavailable > p:not(.booking-kicker), .booking-unavailable > small { max-width: 520px; margin: 0; color: var(--ui-text-muted); line-height: 1.55; }
.booking-unavailable > small { font-size: 12px; }
.booking-spin { animation: booking-spin 1s linear infinite; }
@keyframes booking-spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) {
  .booking-page { padding: 0; }
  .booking-widget { min-height: 100vh; border: 0; border-radius: 0; box-shadow: none; }
  .booking-page--embedded .booking-widget { min-height: auto; }
  .booking-fields, .booking-fields--contact { grid-template-columns: 1fr; }
  .booking-calculator-return { align-items: flex-start; flex-direction: column; }
  .booking-field--wide { grid-column: auto; }
  .booking-slots { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .booking-submit { align-items: stretch; flex-direction: column; }
  .booking-submit__button { width: 100%; }
}
</style>
