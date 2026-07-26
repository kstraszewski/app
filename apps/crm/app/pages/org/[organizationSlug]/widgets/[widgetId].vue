<script setup lang="ts">
import type {
  BookingWidget,
  BookingWidgetAnalyticsPayload,
  BookingWidgetAnalyticsSummary,
  PersonalWidgetDetailPayload,
} from '~/types/scheduling'
import type { BookingWidgetType } from '#shared/types/booking-calculators'
import {
  BOOKING_WIDGET_TYPES,
  bookingWidgetScriptSnippet,
  bookingWidgetTypeMeta,
} from '~/utils/booking-widgets'

definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const widgetId = computed(() => {
  const value = route.params.widgetId
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
})
const saving = ref(false)
const statusSaving = ref(false)
const disableOpen = ref(false)
const previewDevice = ref<'desktop' | 'mobile'>('desktop')
const analyticsDays = ref<7 | 30 | 90>(30)
const analyticsRanges = [7, 30, 90] as const
const loadedWidgetId = ref('')
const savedSnapshot = ref('')

const emptyDetail: PersonalWidgetDetailPayload = {
  currentUserId: '',
  facility: null,
  services: [],
  previewToken: '',
  widget: null,
}
const emptySummary: BookingWidgetAnalyticsSummary = {
  views: 0,
  embeddedViews: 0,
  engagedVisits: 0,
  calculatorStarts: 0,
  calculatorCompletions: 0,
  serviceSelections: 0,
  availabilitySearches: 0,
  availabilityFound: 0,
  slotSelections: 0,
  contactStarts: 0,
  bookingAttempts: 0,
  bookingCompletions: 0,
  bookings: 0,
  confirmedBookings: 0,
  cancelledBookings: 0,
  lastBookingAt: null,
}
const emptyAnalytics: BookingWidgetAnalyticsPayload = {
  days: 30,
  data: {
    period: {
      from: '',
      to: '',
      timeZone: 'Europe/Warsaw',
      trackingStartedAt: '',
    },
    summary: emptySummary,
    daily: [],
    topServices: [],
  },
}

const { data: detail, status, error, refresh } = await useFetch<PersonalWidgetDetailPayload>(
  () => orgApiPath(`/widgets/${encodeURIComponent(widgetId.value)}`),
  {
    key: computed(() => `personal-widget:${widgetId.value}`),
    default: () => emptyDetail,
  },
)
const {
  data: analyticsPayload,
  status: analyticsStatus,
  error: analyticsError,
  refresh: refreshAnalytics,
} = await useFetch<BookingWidgetAnalyticsPayload>(
  () => orgApiPath(`/widgets/${encodeURIComponent(widgetId.value)}/analytics`),
  {
    key: computed(() => `personal-widget-analytics:${widgetId.value}:${analyticsDays.value}`),
    query: computed(() => ({ days: analyticsDays.value })),
    watch: [analyticsDays],
    default: () => emptyAnalytics,
  },
)

const pending = computed(() => status.value === 'pending')
const analyticsPending = computed(() => analyticsStatus.value === 'pending')
const widget = computed(() => detail.value.widget)
const facility = computed(() => detail.value.facility)
const currentView = computed<'personalization' | 'publish' | 'analytics'>(() => {
  const value = String(route.query.view ?? 'personalization')
  return value === 'publish' || value === 'analytics' ? value : 'personalization'
})
const tabs = computed(() => [
  {
    label: 'Personalizacja',
    icon: 'i-lucide-sliders-horizontal',
    to: orgPath(`/widgets/${widgetId.value}`),
  },
  {
    label: 'Podgląd i publikacja',
    icon: 'i-lucide-monitor-up',
    to: orgPath(`/widgets/${widgetId.value}?view=publish`),
  },
  {
    label: 'Analityka',
    icon: 'i-lucide-chart-no-axes-combined',
    to: orgPath(`/widgets/${widgetId.value}?view=analytics`),
  },
])
const pageTitle = computed(() => widget.value?.name || 'Szczegóły widgetu')
const pageDescription = computed(() => widget.value
  ? 'Dostosuj wygląd, publikację i sprawdzaj skuteczność jednego widgetu.'
  : 'Wczytywanie konfiguracji widgetu.')
const typeMeta = computed(() => bookingWidgetTypeMeta(
  widget.value?.widget_type ?? form.widgetType,
))

useHead(() => ({ title: `${pageTitle.value} — OpenExpert CRM` }))

const form = reactive({
  name: '',
  title: '',
  subtitle: '',
  widgetType: 'calendar' as BookingWidgetType,
  theme: 'auto' as 'light' | 'dark' | 'auto',
  accentColor: '#2563eb',
  allowedOrigins: '',
  serviceIds: [] as string[],
  isDirectoryListed: false,
})

const themeItems = [
  { label: 'Automatyczny', value: 'auto' },
  { label: 'Jasny', value: 'light' },
  { label: 'Ciemny', value: 'dark' },
]
const summary = computed<BookingWidgetAnalyticsSummary>(() => ({
  ...emptySummary,
  ...(analyticsPayload.value.data?.summary ?? {}),
}))
const conversionRate = computed(() => summary.value.views
  ? (summary.value.bookingCompletions / summary.value.views) * 100
  : 0)
const engagementRate = computed(() => summary.value.views
  ? (summary.value.engagedVisits / summary.value.views) * 100
  : 0)
const availabilitySuccessRate = computed(() => summary.value.availabilitySearches
  ? (summary.value.availabilityFound / summary.value.availabilitySearches) * 100
  : 0)
const submitSuccessRate = computed(() => summary.value.bookingAttempts
  ? (summary.value.bookingCompletions / summary.value.bookingAttempts) * 100
  : 0)
const calculatorCompletionRate = computed(() => summary.value.calculatorStarts
  ? (summary.value.calculatorCompletions / summary.value.calculatorStarts) * 100
  : 0)
const embeddedShare = computed(() => summary.value.views
  ? (summary.value.embeddedViews / summary.value.views) * 100
  : 0)
const hasAnalytics = computed(() => (
  summary.value.views
  || summary.value.engagedVisits
  || summary.value.slotSelections
  || summary.value.bookingAttempts
  || summary.value.bookings
))
const isCalculatorWidget = computed(() => widget.value?.widget_type !== 'calendar')
const canListInDirectory = computed(() => (
  Boolean(widget.value?.is_active)
  && form.widgetType === 'calendar'
))
const directoryListingDescription = computed(() => {
  if (!widget.value?.is_active) {
    return 'Najpierw włącz widget. Wyłączony widget jest automatycznie usuwany z katalogu.'
  }
  if (form.widgetType !== 'calendar') {
    return 'W katalogu można publikować wyłącznie widget typu Kalendarz.'
  }
  return 'Włączenie tej opcji pozwala publicznie pokazać powiązanego eksperta, placówkę, wybrane usługi i link do rezerwacji. Wyłączenie usuwa wpis z katalogu. Dane klientów i szczegóły rezerwacji nie są publikowane.'
})
const funnelStages = computed(() => {
  const stages = [
    { key: 'views', label: 'Wizyty', value: summary.value.views },
  ]
  if (isCalculatorWidget.value) {
    stages.push(
      { key: 'calculatorStarts', label: 'Start kalkulatora', value: summary.value.calculatorStarts },
      { key: 'calculatorCompletions', label: 'Ukończony kalkulator', value: summary.value.calculatorCompletions },
    )
  } else {
    stages.push({
      key: 'engagedVisits',
      label: 'Zaangażowane wizyty',
      value: summary.value.engagedVisits,
    })
  }
  stages.push(
    { key: 'slotSelections', label: 'Wybrany termin', value: summary.value.slotSelections },
    { key: 'contactStarts', label: 'Rozpoczęte dane', value: summary.value.contactStarts },
    { key: 'bookingAttempts', label: 'Wysłane rezerwacje', value: summary.value.bookingAttempts },
    { key: 'bookingCompletions', label: 'Udane rezerwacje', value: summary.value.bookingCompletions },
  )
  return stages
})
const funnelMax = computed(() => Math.max(1, ...funnelStages.value.map(stage => stage.value)))
const biggestDrop = computed(() => funnelStages.value
  .slice(1)
  .map((stage, index) => {
    const previous = funnelStages.value[index]!
    const loss = Math.max(0, previous.value - stage.value)
    return {
      from: previous.label,
      to: stage.label,
      loss,
      rate: previous.value ? loss / previous.value * 100 : 0,
    }
  })
  .sort((left, right) => right.loss - left.loss)[0] ?? null)
const previewUrl = computed(() => {
  if (!widget.value) return ''
  const separator = widget.value.embedUrl.includes('?') ? '&' : '?'
  return `${widget.value.embedUrl}${separator}previewToken=${encodeURIComponent(detail.value.previewToken)}`
})
const publicPreviewHeight = computed(() => (
  widget.value?.widget_type === 'calendar' ? 720 : 920
))
const isDirty = computed(() => Boolean(widget.value && savedSnapshot.value !== serializeForm()))

watch(widget, (value) => {
  if (!value || loadedWidgetId.value === value.id) return
  loadWidget(value)
  loadedWidgetId.value = value.id
}, { immediate: true })

watch(() => form.widgetType, (widgetType) => {
  if (widgetType !== 'calendar') form.isDirectoryListed = false
})

onBeforeRouteLeave(() => {
  if (!isDirty.value || !import.meta.client) return true
  return window.confirm('Masz niezapisane zmiany. Czy na pewno chcesz opuścić stronę?')
})

function preventUnsavedUnload(event: BeforeUnloadEvent) {
  if (!isDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', preventUnsavedUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', preventUnsavedUnload))

function serializeForm() {
  return JSON.stringify({
    name: form.name.trim(),
    title: form.title.trim(),
    subtitle: form.subtitle.trim(),
    widgetType: form.widgetType,
    theme: form.theme,
    accentColor: form.accentColor.toLowerCase(),
    allowedOrigins: parseOrigins(form.allowedOrigins),
    serviceIds: [...form.serviceIds].sort(),
    isDirectoryListed: form.isDirectoryListed,
  })
}

function serializeWidget(value: BookingWidget) {
  return JSON.stringify({
    name: value.name.trim(),
    title: value.title.trim(),
    subtitle: (value.subtitle ?? '').trim(),
    widgetType: value.widget_type,
    theme: value.theme,
    accentColor: (value.accent_color || '#2563eb').toLowerCase(),
    allowedOrigins: [...value.allowed_origins],
    serviceIds: [...value.serviceIds].sort(),
    isDirectoryListed: Boolean(
      value.is_directory_listed
      && value.is_active
      && value.widget_type === 'calendar',
    ),
  })
}

function loadWidget(value: BookingWidget) {
  Object.assign(form, {
    name: value.name,
    title: value.title,
    subtitle: value.subtitle ?? '',
    widgetType: value.widget_type,
    theme: value.theme,
    accentColor: value.accent_color || '#2563eb',
    allowedOrigins: value.allowed_origins.join('\n'),
    serviceIds: [...value.serviceIds],
    isDirectoryListed: Boolean(
      value.is_directory_listed
      && value.is_active
      && value.widget_type === 'calendar',
    ),
  })
  nextTick(() => {
    savedSnapshot.value = serializeForm()
  })
}

function parseOrigins(value: string) {
  return [...new Set(value.split(/[\n,]/).map(origin => origin.trim()).filter(Boolean))]
}

function toggleService(serviceId: string, enabled: boolean) {
  form.serviceIds = enabled
    ? [...new Set([...form.serviceIds, serviceId])]
    : form.serviceIds.filter(id => id !== serviceId)
}

function openDisableDialog() {
  disableOpen.value = true
}

function setPreviewDevice(value: 'desktop' | 'mobile') {
  previewDevice.value = value
}

function setAnalyticsDays(value: 7 | 30 | 90) {
  analyticsDays.value = value
}

function actionError(title: string, cause: unknown) {
  const statusMessage = typeof cause === 'object' && cause !== null && 'data' in cause
    ? (cause as { data?: { statusMessage?: string, message?: string } }).data?.statusMessage
      ?? (cause as { data?: { message?: string } }).data?.message
    : null
  toast.add({
    title,
    description: statusMessage || 'Spróbuj ponownie za chwilę.',
    color: 'error',
    icon: 'i-lucide-circle-alert',
  })
}

async function saveWidget() {
  if (!widget.value || !facility.value || saving.value) return
  if (!form.name.trim() || !form.title.trim()) {
    toast.add({ title: 'Uzupełnij nazwę i nagłówek widgetu', color: 'error' })
    return
  }
  if (!form.serviceIds.length) {
    toast.add({
      title: 'Wybierz co najmniej jedną usługę',
      description: 'Widget bez usługi nie może znaleźć terminu spotkania.',
      color: 'error',
    })
    return
  }
  if (form.isDirectoryListed && !canListInDirectory.value) {
    toast.add({
      title: 'Widget nie może być pokazany w katalogu',
      description: directoryListingDescription.value,
      color: 'error',
    })
    return
  }
  saving.value = true
  try {
    const result = await $fetch<{ data: BookingWidget }>(
      orgApiPath(
        `/facilities/${encodeURIComponent(facility.value.id)}/widgets/${encodeURIComponent(widget.value.id)}`,
      ),
      {
        method: 'PATCH',
        body: {
          name: form.name.trim(),
          title: form.title.trim(),
          subtitle: form.subtitle.trim() || null,
          widgetType: form.widgetType,
          theme: form.theme,
          accentColor: form.accentColor,
          allowedOrigins: parseOrigins(form.allowedOrigins),
          bookingMode: 'expert',
          serviceIds: form.serviceIds,
          isDirectoryListed: form.isDirectoryListed,
        },
      },
    )
    detail.value = { ...detail.value, widget: result.data }
    loadWidget(result.data)
    toast.add({
      title: 'Zapisano personalizację widgetu',
      description: 'Podgląd i kody publikacji korzystają już z nowej konfiguracji.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (cause: unknown) {
    actionError('Nie udało się zapisać widgetu', cause)
  } finally {
    saving.value = false
  }
}

async function updateStatus(isActive: boolean) {
  if (!widget.value || !facility.value || statusSaving.value) return
  const hadUnsavedChanges = isDirty.value
  statusSaving.value = true
  try {
    const result = await $fetch<{ data: BookingWidget }>(
      orgApiPath(
        `/facilities/${encodeURIComponent(facility.value.id)}/widgets/${encodeURIComponent(widget.value.id)}`,
      ),
      { method: 'PATCH', body: { isActive } },
    )
    detail.value = { ...detail.value, widget: result.data }
    if (hadUnsavedChanges) {
      form.isDirectoryListed = Boolean(
        result.data.is_directory_listed
        && result.data.is_active
        && result.data.widget_type === 'calendar',
      )
      savedSnapshot.value = serializeWidget(result.data)
    } else {
      loadWidget(result.data)
    }
    disableOpen.value = false
    toast.add({
      title: isActive ? 'Widget został włączony' : 'Widget został wyłączony',
      description: isActive
        ? 'Publiczny link znów przyjmuje rezerwacje.'
        : 'Zachowaliśmy konfigurację, historię i analitykę. Widget został też usunięty z katalogu.',
      color: isActive ? 'success' : 'neutral',
      icon: isActive ? 'i-lucide-circle-play' : 'i-lucide-circle-pause',
    })
  } catch (cause: unknown) {
    actionError(isActive ? 'Nie udało się włączyć widgetu' : 'Nie udało się wyłączyć widgetu', cause)
  } finally {
    statusSaving.value = false
  }
}

async function copyText(value: string, label: string) {
  if (!value || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: `${label} skopiowany`, color: 'success', icon: 'i-lucide-copy-check' })
  } catch (cause: unknown) {
    actionError('Nie udało się skopiować', cause)
  }
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Brak rezerwacji'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nieznana data'
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: analyticsPayload.value.data.period.timeZone || facility.value?.timezone,
  }).format(date)
}

function formatDate(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeZone: analyticsPayload.value.data.period.timeZone || facility.value?.timezone,
  }).format(date)
}

function percentage(value: number, total: number) {
  return total ? value / total * 100 : 0
}

</script>

<template>
  <CrmShell
    class="widget-detail-page"
    :title="pageTitle"
    eyebrow="Widget · szczegóły"
    :description="pageDescription"
    :back-to="orgPath('/widgets')"
    back-label="Wróć do widgetów"
    :tabs="widget ? tabs : []"
  >
    <template #meta>
      <div v-if="widget && facility" class="widget-detail__meta">
        <UBadge :color="widget.is_active ? 'success' : 'neutral'" variant="subtle">
          {{ widget.is_active ? 'Aktywny' : 'Wyłączony' }}
        </UBadge>
        <UBadge color="neutral" variant="outline" :icon="typeMeta.icon">
          {{ typeMeta.label }}
        </UBadge>
        <UBadge
          v-if="widget.is_directory_listed"
          color="primary"
          variant="subtle"
          icon="i-lucide-search-check"
        >
          W katalogu
        </UBadge>
        <UBadge color="neutral" variant="outline" icon="i-lucide-building-2">
          {{ facility.name }}
        </UBadge>
        <span v-if="isDirty" class="widget-detail__unsaved">Niezapisane zmiany</span>
      </div>
    </template>

    <template #actions>
      <template v-if="widget">
        <UButton
          v-if="currentView === 'personalization' || isDirty"
          icon="i-lucide-save"
          color="primary"
          variant="solid"
          size="sm"
          :loading="saving"
          :disabled="!isDirty"
          @click="saveWidget"
        >
          Zapisz zmiany
        </UButton>
        <UButton
          v-if="widget.is_active"
          :to="widget.publicUrl"
          target="_blank"
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-external-link"
        >
          Otwórz publicznie
        </UButton>
        <UButton
          v-if="widget.is_active"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-circle-pause"
          :loading="statusSaving"
          @click="openDisableDialog"
        >
          Wyłącz
        </UButton>
        <UButton
          v-else
          color="success"
          variant="soft"
          size="sm"
          icon="i-lucide-circle-play"
          :loading="statusSaving"
          @click="updateStatus(true)"
        >
          Włącz widget
        </UButton>
      </template>
    </template>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się wczytać widgetu"
      description="Widget nie istnieje albo nie masz do niego dostępu."
    >
      <template #actions>
        <UButton :to="orgPath('/widgets')" color="neutral" variant="outline">Wróć do listy</UButton>
        <UButton variant="ghost" icon="i-lucide-refresh-cw" @click="refresh()">Ponów</UButton>
      </template>
    </UAlert>

    <div v-else-if="pending && !widget" class="widget-detail__skeleton">
      <USkeleton class="h-40 w-full" />
      <div><USkeleton class="h-96 w-full" /><USkeleton class="h-96 w-full" /></div>
    </div>

    <template v-else-if="widget && facility">
      <section v-if="!widget.is_active" class="widget-disabled-banner" aria-label="Widget wyłączony">
        <span><UIcon name="i-lucide-circle-pause" /></span>
        <div>
          <strong>Widget jest wyłączony</strong>
          <p>Publiczny link nie przyjmuje nowych rezerwacji. Nadal możesz zmieniać wygląd, kopiować kody i analizować historię.</p>
        </div>
        <UButton color="success" variant="soft" icon="i-lucide-circle-play" @click="updateStatus(true)">
          Włącz ponownie
        </UButton>
      </section>

      <div v-if="currentView === 'personalization'" class="personalization-layout">
        <section class="widget-panel widget-settings-panel">
          <header class="widget-panel__header">
            <div>
              <p>Treść i działanie</p>
              <h2>Personalizacja widgetu</h2>
            </div>
            <UBadge v-if="isDirty" color="warning" variant="subtle">Niezapisane</UBadge>
          </header>

          <form class="widget-settings-form" @submit.prevent="saveWidget">
            <div class="widget-settings-form__grid">
              <UFormField name="name" label="Nazwa wewnętrzna" required>
                <UInput v-model="form.name" class="w-full" />
              </UFormField>
              <UFormField name="title" label="Nagłówek dla klienta" required>
                <UInput v-model="form.title" class="w-full" />
              </UFormField>
            </div>

            <UFormField
              name="subtitle"
              label="Podtytuł"
              hint="Opcjonalnie"
              description="Krótko wyjaśnij klientowi, co wydarzy się w kolejnym kroku."
            >
              <UTextarea v-model="form.subtitle" :rows="2" autoresize :maxrows="4" class="w-full" />
            </UFormField>

            <UFormField name="widgetType" label="Typ doświadczenia" required>
              <div class="widget-type-options">
                <button
                  v-for="type in BOOKING_WIDGET_TYPES"
                  :key="type.value"
                  type="button"
                  class="widget-type-option"
                  :class="{ 'widget-type-option--selected': form.widgetType === type.value }"
                  :aria-pressed="form.widgetType === type.value"
                  @click="form.widgetType = type.value"
                >
                  <UIcon :name="type.icon" />
                  <span><strong>{{ type.label }}</strong><small>{{ type.description }}</small></span>
                </button>
              </div>
            </UFormField>

            <UFormField name="isDirectoryListed" label="Widoczność w katalogu">
              <div
                class="directory-listing-setting"
                :class="{ 'directory-listing-setting--disabled': !canListInDirectory }"
              >
                <div class="directory-listing-setting__control">
                  <span>
                    <strong>Pokaż w katalogu OpenExpert</strong>
                    <small>Ta publikacja jest niezależna od publicznego linku i kodu osadzenia.</small>
                  </span>
                  <USwitch
                    v-model="form.isDirectoryListed"
                    :disabled="!canListInDirectory"
                    aria-label="Pokaż w katalogu OpenExpert"
                  />
                </div>
                <p>
                  <UIcon name="i-lucide-shield-check" />
                  {{ directoryListingDescription }}
                </p>
              </div>
            </UFormField>

            <div class="widget-settings-form__grid">
              <UFormField name="theme" label="Motyw">
                <USelect v-model="form.theme" :items="themeItems" class="w-full" />
              </UFormField>
              <UFormField name="accentColor" label="Kolor akcentu">
                <div class="accent-field">
                  <UPopover :content="{ side: 'right', align: 'start', sideOffset: 10 }">
                    <UButton
                      color="neutral"
                      variant="outline"
                      square
                      class="accent-field__trigger"
                      aria-label="Wybierz kolor akcentu"
                    >
                      <span
                        class="accent-field__swatch"
                        :style="{ backgroundColor: form.accentColor }"
                      />
                    </UButton>
                    <template #content>
                      <div class="accent-field__picker">
                        <UColorPicker v-model="form.accentColor" />
                      </div>
                    </template>
                  </UPopover>
                  <UInput v-model="form.accentColor" class="min-w-0 flex-1" />
                </div>
              </UFormField>
            </div>

            <UFormField
              name="services"
              label="Usługi dostępne w widgetcie"
              description="Klient będzie mógł umówić tylko usługi zaznaczone poniżej."
              required
            >
              <div class="service-options">
                <label v-for="service in detail.services" :key="service.id" class="service-option">
                  <UCheckbox
                    :model-value="form.serviceIds.includes(service.id)"
                    :aria-label="service.name"
                    @update:model-value="toggleService(service.id, Boolean($event))"
                  />
                  <span>
                    <strong>{{ service.name }}</strong>
                    <small>{{ service.duration_minutes }} min{{ service.description ? ` · ${service.description}` : '' }}</small>
                  </span>
                </label>
              </div>
            </UFormField>

            <UFormField
              name="allowedOrigins"
              label="Dozwolone domeny"
              description="Jedna domena w wierszu. Puste pole pozwala osadzić widget na dowolnej stronie."
            >
              <UTextarea
                v-model="form.allowedOrigins"
                :rows="3"
                class="w-full"
                placeholder="https://twoja-strona.pl"
              />
            </UFormField>

            <div class="widget-settings-form__footer">
              <span>{{ isDirty ? 'Masz niezapisane zmiany.' : 'Wszystkie zmiany są zapisane.' }}</span>
            </div>
          </form>
        </section>

        <aside class="preview-column">
          <div class="preview-column__head">
            <div>
              <p>Podgląd na żywo</p>
              <span>Zmiany w formularzu widać tutaj przed zapisem.</span>
            </div>
            <UFieldGroup>
              <UButton
                color="neutral"
                :variant="previewDevice === 'desktop' ? 'soft' : 'ghost'"
                square
                icon="i-lucide-monitor"
                aria-label="Podgląd desktop"
                :aria-pressed="previewDevice === 'desktop'"
                @click="setPreviewDevice('desktop')"
              />
              <UButton
                color="neutral"
                :variant="previewDevice === 'mobile' ? 'soft' : 'ghost'"
                square
                icon="i-lucide-smartphone"
                aria-label="Podgląd mobile"
                :aria-pressed="previewDevice === 'mobile'"
                @click="setPreviewDevice('mobile')"
              />
            </UFieldGroup>
          </div>
          <div class="preview-stage" :class="`preview-stage--${previewDevice}`">
            <WidgetsWidgetAppearancePreview
              :title="form.title"
              :subtitle="form.subtitle"
              :facility-name="facility.name"
              :widget-type="form.widgetType"
              :theme="form.theme"
              :accent-color="form.accentColor"
              :compact="previewDevice === 'mobile'"
            />
          </div>
        </aside>
      </div>

      <div v-else-if="currentView === 'publish'" class="publish-layout">
        <section class="widget-panel publish-preview">
          <header class="widget-panel__header">
            <div>
              <p>Podgląd przed publikacją</p>
              <h2>Podgląd publicznej wersji</h2>
            </div>
            <UBadge :color="widget.is_active ? 'success' : 'neutral'" variant="subtle">
              {{ widget.is_active ? 'Wersja publiczna' : 'Podgląd wyglądu' }}
            </UBadge>
          </header>

          <div v-if="widget.is_active" class="public-preview-frame">
            <iframe
              :key="previewUrl"
              :src="previewUrl"
              :title="`Podgląd ${widget.name}`"
              loading="lazy"
              :style="{ height: `${publicPreviewHeight}px` }"
            />
            <span>Podgląd jest nieinteraktywny i nie wpływa na analitykę.</span>
          </div>
          <div v-else class="inactive-preview">
            <WidgetsWidgetAppearancePreview
              :title="widget.title"
              :subtitle="widget.subtitle"
              :facility-name="facility.name"
              :widget-type="widget.widget_type"
              :theme="widget.theme"
              :accent-color="widget.accent_color || '#2563eb'"
            />
            <UAlert
              color="neutral"
              variant="subtle"
              icon="i-lucide-info"
              title="Podgląd strony publicznej jest dostępny po włączeniu"
              description="Wyłączony widget publicznie zwraca stronę niedostępną, dlatego pokazujemy bezpieczny podgląd wyglądu."
            />
          </div>
        </section>

        <section class="widget-panel publish-codes">
          <header class="widget-panel__header">
            <div>
              <p>Publikacja</p>
              <h2>Link i kody osadzenia</h2>
            </div>
          </header>

          <div class="publish-method">
            <div class="publish-method__head">
              <span><UIcon name="i-lucide-link-2" /><strong>Link publiczny</strong></span>
              <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-copy" @click="copyText(widget.publicUrl, 'Link')">
                Kopiuj
              </UButton>
            </div>
            <p>Najprostsza opcja do wiadomości, stopki e-mail lub przycisku w social media.</p>
            <UInput :model-value="widget.publicUrl" readonly class="w-full" />
          </div>

          <div class="publish-method publish-method--recommended">
            <div class="publish-method__head">
              <span><UIcon name="i-lucide-code-xml" /><strong>Skrypt JavaScript</strong><UBadge color="primary" variant="subtle">Polecane</UBadge></span>
              <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-copy" @click="copyText(bookingWidgetScriptSnippet(widget), 'Kod JavaScript')">
                Kopiuj
              </UButton>
            </div>
            <p>Automatycznie dopasowuje wysokość widgetu do kolejnych kroków.</p>
            <UTextarea :model-value="bookingWidgetScriptSnippet(widget)" readonly :rows="4" class="code-field" />
          </div>

          <div class="publish-method">
            <div class="publish-method__head">
              <span><UIcon name="i-lucide-panel-top" /><strong>Iframe</strong></span>
              <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-copy" @click="copyText(widget.embedCode, 'Kod iframe')">
                Kopiuj
              </UButton>
            </div>
            <p>Wariant dla kreatorów stron, które nie pozwalają dodać własnego skryptu.</p>
            <UTextarea :model-value="widget.embedCode" readonly :rows="5" class="code-field" />
          </div>

          <div class="origin-summary">
            <div>
              <UIcon name="i-lucide-shield-check" />
              <span><strong>Dozwolone domeny</strong><small>Kontrola miejsc, w których widget może działać.</small></span>
            </div>
            <div v-if="widget.allowed_origins.length" class="origin-summary__badges">
              <UBadge v-for="origin in widget.allowed_origins" :key="origin" color="neutral" variant="outline">
                {{ origin }}
              </UBadge>
            </div>
            <span v-else class="origin-summary__all">Dowolna domena</span>
          </div>
        </section>
      </div>

      <div v-else class="analytics-view">
        <div class="analytics-toolbar">
          <div>
            <h2>Skuteczność widgetu</h2>
            <p>
              Etapy łączy losowy identyfikator jednej wizyty, usuwany po odświeżeniu.
              Nie zapisujemy cookies, IP, danych kontaktowych ani adresów stron.
              <template v-if="analyticsPayload.data.period.trackingStartedAt">
                Dane od {{ formatDate(analyticsPayload.data.period.trackingStartedAt) }}.
              </template>
            </p>
          </div>
          <UFieldGroup>
            <UButton
              v-for="days in analyticsRanges"
              :key="days"
              color="neutral"
              :variant="analyticsDays === days ? 'soft' : 'ghost'"
              :aria-pressed="analyticsDays === days"
              @click="setAnalyticsDays(days)"
            >
              {{ days }} dni
            </UButton>
          </UFieldGroup>
        </div>

        <UAlert
          v-if="analyticsError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się pobrać analityki"
          description="Spróbuj odświeżyć dane za chwilę."
        >
          <template #actions>
            <UButton variant="ghost" icon="i-lucide-refresh-cw" @click="refreshAnalytics()">Ponów</UButton>
          </template>
        </UAlert>

        <div class="analytics-cards">
          <article>
            <span><UIcon name="i-lucide-eye" />Wizyty</span>
            <strong>{{ summary.views }}</strong>
            <small>{{ summary.embeddedViews }} przez osadzenie</small>
          </article>
          <article>
            <span><UIcon name="i-lucide-mouse-pointer-click" />Zaangażowane</span>
            <strong>{{ summary.engagedVisits }}</strong>
            <small>{{ engagementRate.toFixed(1) }}% wszystkich wizyt</small>
          </article>
          <article>
            <span><UIcon name="i-lucide-calendar-check-2" />Rezerwacje</span>
            <strong>{{ summary.bookings }}</strong>
            <small>{{ summary.confirmedBookings }} potwierdzonych · {{ summary.cancelledBookings }} anulowanych</small>
          </article>
          <article class="analytics-card--accent">
            <span><UIcon name="i-lucide-chart-no-axes-combined" />Konwersja</span>
            <strong>{{ conversionRate.toFixed(1) }}%</strong>
            <small>wizyta → udana rezerwacja</small>
          </article>
        </div>

        <div v-if="analyticsPending && !hasAnalytics" class="analytics-loading">
          <USkeleton class="h-52 w-full" />
          <USkeleton class="h-72 w-full" />
        </div>

        <template v-else-if="hasAnalytics">
          <section class="analytics-diagnostics" aria-label="Wskaźniki diagnostyczne">
            <article>
              <span><UIcon name="i-lucide-calendar-search" />Dostępność terminów</span>
              <strong>{{ availabilitySuccessRate.toFixed(1) }}%</strong>
              <small>{{ summary.availabilityFound }} z {{ summary.availabilitySearches }} wizyt z wczytanym kalendarzem zobaczyło wolny termin</small>
            </article>
            <article v-if="isCalculatorWidget">
              <span><UIcon name="i-lucide-calculator" />Ukończenie kalkulatora</span>
              <strong>{{ calculatorCompletionRate.toFixed(1) }}%</strong>
              <small>{{ summary.calculatorCompletions }} z {{ summary.calculatorStarts }} rozpoczęć</small>
            </article>
            <article>
              <span><UIcon name="i-lucide-send" />Skuteczność wysłania</span>
              <strong>{{ submitSuccessRate.toFixed(1) }}%</strong>
              <small>{{ summary.bookingCompletions }} z {{ summary.bookingAttempts }} prób zakończyło się sukcesem</small>
            </article>
            <article>
              <span><UIcon name="i-lucide-panel-top" />Ruch osadzony</span>
              <strong>{{ embeddedShare.toFixed(1) }}%</strong>
              <small>{{ summary.embeddedViews }} z {{ summary.views }} wizyt</small>
            </article>
          </section>

          <section class="widget-panel funnel-panel">
            <header class="widget-panel__header">
              <div>
                <p>Lejek unikalnych wizyt</p>
                <h2>Od wejścia do rezerwacji</h2>
              </div>
              <span v-if="biggestDrop?.loss">
                Największy spadek: {{ biggestDrop.from }} → {{ biggestDrop.to }}
                ({{ biggestDrop.rate.toFixed(1) }}%)
              </span>
            </header>
            <div class="funnel">
              <div v-for="(stage, index) in funnelStages" :key="stage.key">
                <span><strong>{{ stage.value }}</strong>{{ stage.label }}</span>
                <div>
                  <i
                    :style="{
                      width: `${percentage(stage.value, funnelMax)}%`,
                      minWidth: stage.value ? '2px' : '0',
                    }"
                  />
                </div>
                <small>
                  {{ index === 0
                    ? '100%'
                    : `${percentage(stage.value, funnelStages[index - 1]?.value ?? 0).toFixed(1)}%` }}
                </small>
              </div>
            </div>
            <footer class="funnel-panel__footer">
              <span>Procent przy etapie pokazuje przejście z poprzedniego kroku.</span>
              <span>Ostatnia rezerwacja w okresie: {{ formatDateTime(summary.lastBookingAt) }}</span>
            </footer>
          </section>

          <section class="widget-panel trend-panel">
            <header class="widget-panel__header">
              <div>
                <p>Trend dzienny</p>
                <h2>Wizyty, wybrane terminy i rezerwacje</h2>
              </div>
              <span>{{ analyticsPayload.data.period.from }} — {{ analyticsPayload.data.period.to }}</span>
            </header>
            <WidgetsWidgetAnalyticsTrend
              :days="analyticsDays"
              :data="analyticsPayload.data.daily"
            />
          </section>

          <section v-if="analyticsPayload.data.topServices.length" class="widget-panel services-analytics">
            <header class="widget-panel__header">
              <div>
                <p>Zainteresowanie usługami</p>
                <h2>Od zainteresowania do rezerwacji</h2>
              </div>
            </header>
            <div class="services-analytics__table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usługa</th>
                    <th>Zainteresowanie</th>
                    <th>Rezerwacje</th>
                    <th>Konwersja</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="service in analyticsPayload.data.topServices" :key="service.serviceId">
                    <th>{{ service.name }}</th>
                    <td>{{ service.interest }}</td>
                    <td>{{ service.bookings }}</td>
                    <td>
                      {{ service.interest
                        ? `${percentage(service.bookings, service.interest).toFixed(1)}%`
                        : '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

        </template>
        <div v-else class="analytics-empty">
          <span><UIcon name="i-lucide-chart-no-axes-combined" /></span>
          <div>
            <strong>Analityka zacznie się wypełniać po pierwszych odwiedzinach</strong>
            <p>Mierzymy anonimowe etapy jednej wizyty — od wejścia, przez wybór terminu i rozpoczęcie danych, aż do rezerwacji.</p>
          </div>
          <UButton
            v-if="widget.is_active"
            :to="widget.publicUrl"
            target="_blank"
            color="neutral"
            variant="outline"
            icon="i-lucide-external-link"
          >
            Otwórz widget
          </UButton>
        </div>
      </div>
    </template>

    <UModal
      v-model:open="disableOpen"
      title="Wyłączyć widget?"
      description="Publiczny link i osadzenie przestaną działać, a widget zostanie usunięty z katalogu OpenExpert. Konfiguracja, analityka i istniejące rezerwacje pozostaną bez zmian."
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-circle-pause"
          :title="widget?.name"
          :description="facility?.name"
        />
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton color="error" variant="soft" icon="i-lucide-circle-pause" :loading="statusSaving" @click="updateStatus(false)">
          Wyłącz widget
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.widget-detail-page {
  container-name: widget-detail;
  container-type: inline-size;
}

.widget-detail__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
}

.widget-detail__unsaved {
  color: var(--ui-warning);
  font-family: var(--font-mono);
  font-size: 10px;
}

.widget-detail__skeleton {
  display: grid;
  gap: 18px;
}

.widget-detail__skeleton > div {
  display: grid;
  grid-template-columns: 1.2fr .8fr;
  gap: 18px;
}

.widget-disabled-banner {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
  padding: 14px 16px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.widget-disabled-banner > span {
  display: grid;
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 10px;
  background: var(--ui-bg-accented);
  color: var(--ui-text-muted);
}

.widget-disabled-banner > div {
  flex: 1;
}

.widget-disabled-banner strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.widget-disabled-banner p {
  margin: 3px 0 0;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.personalization-layout {
  display: grid;
  grid-template-columns: clamp(300px, 31vw, 380px) minmax(360px, 1fr);
  gap: 18px;
  align-items: start;
}

.publish-layout {
  display: grid;
  grid-template-columns: minmax(380px, .9fr) minmax(0, 1.1fr);
  gap: 20px;
  align-items: start;
}

.widget-panel {
  min-width: 0;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg);
}

.widget-settings-panel {
  padding: 18px;
}

.widget-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.widget-panel__header p,
.preview-column__head p {
  margin: 0;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.widget-panel__header h2,
.analytics-toolbar h2 {
  margin: 5px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
}

.widget-panel__header > span {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.widget-settings-form {
  display: grid;
  gap: 18px;
}

.widget-settings-form__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.widget-type-options {
  display: grid;
  grid-template-columns: 1fr;
  gap: 7px;
}

.widget-type-option {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: start;
  gap: 9px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
  transition: border-color var(--oe-motion-fast), background-color var(--oe-motion-fast);
}

.widget-type-option:hover,
.widget-type-option--selected {
  border-color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg));
}

.widget-type-option > svg {
  color: var(--ui-primary);
  font-size: 18px;
}

.widget-type-option span {
  display: grid;
  gap: 3px;
}

.widget-type-option strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.widget-type-option small {
  color: var(--ui-text-muted);
  font-size: 9px;
  line-height: 1.4;
}

.accent-field {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.accent-field__trigger {
  width: 40px;
}

.accent-field__swatch {
  width: 18px;
  height: 18px;
  border: 1px solid rgb(255 255 255 / 28%);
  border-radius: 5px;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 12%);
}

.accent-field__picker {
  padding: 12px;
}

.directory-listing-setting {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 30%, var(--ui-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-primary) 5%, var(--ui-bg));
}

.directory-listing-setting--disabled {
  border-color: var(--ui-border);
  background: var(--ui-bg-muted);
}

.directory-listing-setting__control {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.directory-listing-setting__control > span {
  display: grid;
  gap: 3px;
}

.directory-listing-setting__control strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.directory-listing-setting__control small,
.directory-listing-setting p {
  color: var(--ui-text-muted);
  font-size: 9px;
  line-height: 1.5;
}

.directory-listing-setting p {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
}

.directory-listing-setting p > svg {
  flex: 0 0 auto;
  margin-top: 1px;
  color: var(--ui-primary);
  font-size: 13px;
}

.service-options {
  display: grid;
  gap: 7px;
}

.service-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: var(--ui-bg-muted);
  cursor: pointer;
}

.service-option > span {
  display: grid;
  gap: 3px;
}

.service-option strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.service-option small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.widget-settings-form__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 4px;
}

.widget-settings-form__footer > span {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.preview-column {
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 32px);
  min-width: 0;
  overflow-y: auto;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg-muted);
  scrollbar-width: thin;
}

.preview-column__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.preview-column__head > div > span {
  display: block;
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.preview-stage {
  max-width: 680px;
  margin-inline: auto;
  transition: max-width var(--oe-motion-fast);
}

.preview-stage--mobile {
  max-width: 330px;
}

.publish-preview {
  position: sticky;
  top: 20px;
}

.public-preview-frame {
  display: grid;
  gap: 8px;
}

.public-preview-frame iframe {
  width: 100%;
  height: 680px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg);
  pointer-events: none;
}

.public-preview-frame > span {
  color: var(--ui-text-muted);
  font-size: 9px;
  text-align: center;
}

.inactive-preview {
  display: grid;
  gap: 14px;
  max-width: 520px;
  margin-inline: auto;
}

.publish-codes {
  display: grid;
  gap: 14px;
}

.publish-method {
  display: grid;
  gap: 9px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg-muted);
}

.publish-method--recommended {
  border-color: color-mix(in srgb, var(--ui-primary) 35%, var(--ui-border));
}

.publish-method__head,
.publish-method__head > span {
  display: flex;
  align-items: center;
  gap: 8px;
}

.publish-method__head {
  justify-content: space-between;
}

.publish-method__head > span > svg {
  color: var(--ui-primary);
}

.publish-method__head strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.publish-method p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.5;
}

.code-field {
  width: 100%;
}

.code-field :deep(textarea) {
  font-family: var(--font-mono);
  font-size: 10px;
}

.origin-summary {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 11px;
}

.origin-summary > div:first-child {
  display: flex;
  align-items: center;
  gap: 9px;
}

.origin-summary > div:first-child > svg {
  color: var(--ui-success);
}

.origin-summary > div:first-child > span {
  display: grid;
}

.origin-summary strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.origin-summary small,
.origin-summary__all {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.origin-summary__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.analytics-view {
  display: grid;
  gap: 18px;
}

.analytics-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.analytics-toolbar h2 {
  margin: 0;
}

.analytics-toolbar p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.analytics-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.analytics-cards article {
  display: grid;
  min-height: 116px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg);
}

.analytics-cards article > span {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.analytics-cards article > span > svg {
  color: var(--ui-primary);
}

.analytics-cards article > strong {
  align-self: end;
  margin-top: 14px;
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 26px;
  line-height: 1;
}

.analytics-cards article > small {
  margin-top: 7px;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.analytics-card--accent {
  border-color: color-mix(in srgb, var(--ui-primary) 35%, var(--ui-border)) !important;
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-bg)) !important;
}

.analytics-loading {
  display: grid;
  gap: 18px;
}

.analytics-diagnostics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.analytics-diagnostics article {
  display: grid;
  gap: 7px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.analytics-diagnostics span {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.analytics-diagnostics strong {
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 19px;
}

.analytics-diagnostics small {
  color: var(--ui-text-muted);
  font-size: 9px;
  line-height: 1.45;
}

.funnel {
  display: grid;
  gap: 13px;
}

.funnel > div {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) 54px;
  align-items: center;
  gap: 12px;
}

.funnel > div > span {
  display: flex;
  align-items: baseline;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.funnel strong {
  min-width: 30px;
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 14px;
}

.funnel > div > div {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ui-bg-accented);
}

.funnel i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ui-primary);
}

.funnel small {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  text-align: right;
}

.funnel-panel__footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border-muted);
  color: var(--ui-text-muted);
  font-size: 9px;
}

.trend-panel {
  overflow: hidden;
}

.services-analytics {
  display: grid;
}

.services-analytics__table-wrap {
  overflow-x: auto;
}

.services-analytics table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}

.services-analytics th,
.services-analytics td {
  padding: 11px 8px;
  border-top: 1px solid var(--ui-border-muted);
  text-align: right;
}

.services-analytics th:first-child {
  text-align: left;
}

.services-analytics thead th {
  color: var(--ui-text-muted);
  font-size: 8px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.services-analytics tbody th {
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.services-analytics tbody td {
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
}

.analytics-empty {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.analytics-empty > span {
  display: grid;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 10px;
  background: var(--ui-bg-accented);
  color: var(--ui-primary);
}

.analytics-empty > div {
  flex: 1;
}

.analytics-empty strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.analytics-empty p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 10px;
}

@container widget-detail (max-width: 820px) {
  .personalization-layout {
    grid-template-columns: 1fr;
  }

  .preview-column {
    position: static;
    max-height: none;
  }
}

@media (max-width: 1160px) {
  .publish-layout {
    grid-template-columns: 1fr;
  }

  .publish-preview {
    position: static;
  }

  .analytics-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .analytics-diagnostics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .widget-detail__skeleton > div,
  .widget-settings-form__grid,
  .widget-type-options,
  .analytics-cards,
  .analytics-diagnostics {
    grid-template-columns: 1fr;
  }

  .widget-disabled-banner,
  .analytics-toolbar,
  .analytics-empty {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .widget-settings-form__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .funnel > div {
    grid-template-columns: 1fr 46px;
  }

  .funnel > div > div {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .funnel-panel__footer {
    flex-direction: column;
  }
}
</style>
