<script setup lang="ts">
import type { BookingWidget, PersonalWidgetFacility, PersonalWidgetsPayload } from '~/types/scheduling'
import type { BookingWidgetType } from '#shared/types/booking-calculators'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Widgety — OpenExpert CRM' })

const { organizationSlug, orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const createOpen = ref(false)
const saving = ref(false)

const widgetTypes: Array<{
  value: BookingWidgetType
  label: string
  description: string
  icon: string
  name: string
  title: string
}> = [
  {
    value: 'mortgage_capacity',
    label: 'Kalkulator zdolności',
    description: 'Klient oblicza orientacyjną zdolność, a następnie wybiera termin spotkania.',
    icon: 'i-lucide-chart-no-axes-combined',
    name: 'Mój kalkulator zdolności',
    title: 'Sprawdź swoją zdolność kredytową',
  },
  {
    value: 'mortgage_payment',
    label: 'Kalkulator raty',
    description: 'Klient szacuje ratę kredytu i przechodzi bezpośrednio do rezerwacji.',
    icon: 'i-lucide-calculator',
    name: 'Mój kalkulator raty',
    title: 'Oblicz ratę kredytu',
  },
  {
    value: 'calendar',
    label: 'Kalendarz',
    description: 'Najkrótsza ścieżka: wybór terminu i rejestracja klienta.',
    icon: 'i-lucide-calendar-days',
    name: 'Mój kalendarz spotkań',
    title: 'Umów spotkanie',
  },
]

const themeItems = [
  { label: 'Automatyczny', value: 'auto' },
  { label: 'Jasny', value: 'light' },
  { label: 'Ciemny', value: 'dark' },
]

const emptyPayload: PersonalWidgetsPayload = { currentUserId: '', data: [] }
const { data: payload, pending, error, refresh } = await useFetch<PersonalWidgetsPayload>(
  () => orgApiPath('/widgets'),
  {
    key: computed(() => `personal-widgets:${organizationSlug.value}`),
    default: () => emptyPayload,
  },
)

const form = reactive({
  facilityId: '',
  widgetType: 'mortgage_capacity' as BookingWidgetType,
  name: widgetTypes[0]!.name,
  title: widgetTypes[0]!.title,
  theme: 'auto' as 'light' | 'dark' | 'auto',
  allowedOrigins: '',
})

const facilityItems = computed(() => payload.value.data.map(item => ({
  label: item.facility.name,
  value: item.facility.id,
})))
const selectedFacility = computed<PersonalWidgetFacility | null>(() => (
  payload.value.data.find(item => item.facility.id === form.facilityId) ?? null
))
const availableServices = computed(() => selectedFacility.value?.services ?? [])
const totalWidgets = computed(() => payload.value.data.reduce(
  (count, item) => count + item.widgets.filter(widget => widget.is_active).length,
  0,
))
const canCreate = computed(() => Boolean(
  form.facilityId
  && form.name.trim()
  && form.title.trim()
  && availableServices.value.length,
))

function widgetType(type: BookingWidgetType) {
  return widgetTypes.find(item => item.value === type) ?? widgetTypes[2]!
}

function openCreate(facilityId?: string) {
  const preferred = payload.value.data.find(item => item.facility.id === facilityId && item.services.length)
    ?? payload.value.data.find(item => item.services.length)
  const defaults = widgetTypes[0]!
  Object.assign(form, {
    facilityId: preferred?.facility.id ?? '',
    widgetType: defaults.value,
    name: defaults.name,
    title: defaults.title,
    theme: 'auto',
    allowedOrigins: '',
  })
  createOpen.value = true
}

function selectWidgetType(type: BookingWidgetType) {
  const previous = widgetType(form.widgetType)
  const next = widgetType(type)
  if (!form.name.trim() || form.name === previous.name) form.name = next.name
  if (!form.title.trim() || form.title === previous.title) form.title = next.title
  form.widgetType = type
}

function parseOrigins(value: string) {
  return [...new Set(value.split(/[\n,]/).map(origin => origin.trim()).filter(Boolean))]
}

function scriptSnippet(widget: BookingWidget) {
  let origin = ''
  try {
    origin = new URL(widget.publicUrl).origin
  } catch {
    if (import.meta.client) origin = window.location.origin
  }
  const tagName = 'script'
  return `<${tagName} src="${origin}/booking-widget.js" data-openexpert-widget="${widget.widgetKey}" data-theme="${widget.theme}" async></${tagName}>`
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

async function copyText(value: string, label: string) {
  if (!value || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: `${label} skopiowany`, color: 'success', icon: 'i-lucide-copy-check' })
  } catch (cause: unknown) {
    actionError('Nie udało się skopiować', cause)
  }
}

async function createWidget() {
  if (!canCreate.value) return
  saving.value = true
  try {
    const allowedServiceIds = new Set(availableServices.value.map(service => service.id))
    const requestBody = {
      name: form.name.trim(),
      title: form.title.trim(),
      subtitle: null,
      theme: form.theme,
      accentColor: '#2563EB',
      allowedOrigins: parseOrigins(form.allowedOrigins),
      bookingMode: 'expert',
      widgetType: form.widgetType,
      fixedExpertUserId: payload.value.currentUserId,
      locale: 'pl-PL',
      isActive: true,
      serviceIds: [...allowedServiceIds],
    }
    await $fetch(orgApiPath(`/facilities/${encodeURIComponent(form.facilityId)}/widgets`), {
      method: 'POST',
      body: requestBody,
    })
    createOpen.value = false
    await refresh()
    toast.add({ title: 'Widget został utworzony', color: 'success', icon: 'i-lucide-circle-check' })
  } catch (cause: unknown) {
    actionError('Nie udało się utworzyć widgetu', cause)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <CrmShell title="Widgety" eyebrow="Ekspert">
    <template #actions>
      <UButton
        icon="i-lucide-plus"
        :disabled="!payload.data.some(item => item.services.length)"
        @click="openCreate()"
      >
        Nowy widget
      </UButton>
    </template>

    <div class="widgets-page">
      <section class="widgets-intro">
        <div class="widgets-intro__copy">
          <UBadge color="primary" variant="subtle" icon="i-lucide-sparkles">Pozyskiwanie klientów</UBadge>
          <h2>Twoje formularze i kalendarz gotowe do udostępnienia</h2>
          <p>
            Wygeneruj osobny link albo osadź widget na swojej stronie. Rezerwacja zbierze dane klienta,
            telefon, e-mail i wymagane zgody, a spotkanie trafi bezpośrednio do Twojego kalendarza.
          </p>
        </div>
        <div class="widgets-intro__stats">
          <strong>{{ totalWidgets }}</strong>
          <span>{{ totalWidgets === 1 ? 'aktywny widget' : 'aktywnych widgetów' }}</span>
        </div>
      </section>

      <section class="widget-type-grid" aria-label="Dostępne typy widgetów">
        <article v-for="type in widgetTypes" :key="type.value" class="widget-type-card">
          <span class="widget-type-card__icon"><UIcon :name="type.icon" /></span>
          <div>
            <h3>{{ type.label }}</h3>
            <p>{{ type.description }}</p>
          </div>
        </article>
      </section>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się wczytać widgetów"
        description="Odśwież stronę i spróbuj ponownie."
      />

      <div v-else-if="pending" class="widget-skeletons">
        <USkeleton v-for="index in 3" :key="index" class="h-64 w-full" />
      </div>

      <UAlert
        v-else-if="!payload.data.length"
        color="neutral"
        variant="subtle"
        icon="i-lucide-building-2"
        title="Najpierw potrzebujesz placówki"
        description="Administrator musi dodać Cię do aktywnej placówki jako eksperta przyjmującego rezerwacje."
        :actions="[{ label: 'Przejdź do placówek', to: orgPath('/facilities'), color: 'neutral', variant: 'outline' }]"
      />

      <div v-else class="facility-widget-list">
        <section v-for="item in payload.data" :key="item.facility.id" class="facility-widget-section">
          <header class="facility-widget-section__head">
            <div>
              <p>Placówka</p>
              <h2>{{ item.facility.name }}</h2>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-plus"
              :disabled="!item.services.length"
              @click="openCreate(item.facility.id)"
            >
              Utwórz widget
            </UButton>
          </header>

          <div v-if="item.widgets.length" class="widget-card-grid">
            <article v-for="widget in item.widgets" :key="widget.id" class="widget-card">
              <header class="widget-card__head">
                <span class="widget-card__icon"><UIcon :name="widgetType(widget.widget_type).icon" /></span>
                <div>
                  <div class="widget-card__title-row">
                    <h3>{{ widget.name }}</h3>
                    <UBadge :color="widget.is_active ? 'success' : 'neutral'" variant="subtle">
                      {{ widget.is_active ? 'Aktywny' : 'Nieaktywny' }}
                    </UBadge>
                  </div>
                  <p>{{ widgetType(widget.widget_type).label }}</p>
                </div>
              </header>

              <div class="snippet-block">
                <div class="snippet-block__label">
                  <span>Link publiczny</span>
                  <UButton
                    :to="widget.publicUrl"
                    target="_blank"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-external-link"
                  >Otwórz</UButton>
                </div>
                <UFieldGroup class="w-full">
                  <UInput :model-value="widget.publicUrl" readonly class="min-w-0 flex-1" />
                  <UButton color="neutral" variant="outline" icon="i-lucide-copy" @click="copyText(widget.publicUrl, 'Link')">
                    Kopiuj
                  </UButton>
                </UFieldGroup>
              </div>

              <div class="snippet-block">
                <div class="snippet-block__label">
                  <span>Kod iframe</span>
                  <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-copy" @click="copyText(widget.embedCode, 'Kod iframe')">
                    Kopiuj
                  </UButton>
                </div>
                <UTextarea :model-value="widget.embedCode" readonly autoresize :maxrows="4" class="w-full code-field" />
              </div>

              <div class="snippet-block">
                <div class="snippet-block__label">
                  <span>Kod JavaScript</span>
                  <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-copy" @click="copyText(scriptSnippet(widget), 'Kod JavaScript')">
                    Kopiuj
                  </UButton>
                </div>
                <UTextarea :model-value="scriptSnippet(widget)" readonly autoresize :maxrows="4" class="w-full code-field" />
              </div>
            </article>
          </div>

          <div v-else class="facility-widget-empty">
            <UIcon name="i-lucide-panels-top-left" />
            <div>
              <strong>Nie masz jeszcze widgetu dla tej placówki</strong>
              <p>Utwórz pierwszy i od razu skopiuj link lub kod do osadzenia.</p>
            </div>
          </div>
        </section>
      </div>
    </div>

    <UModal
      v-model:open="createOpen"
      title="Nowy widget eksperta"
      description="Widget będzie prowadził klientów bezpośrednio do spotkania z Tobą."
      :ui="{ content: 'sm:max-w-3xl', footer: 'justify-end' }"
    >
      <template #body>
        <form id="personal-widget-form" class="widget-form" @submit.prevent="createWidget">
          <UFormField name="widgetFacility" label="Placówka" required>
            <USelect v-model="form.facilityId" :items="facilityItems" value-key="value" class="w-full" />
          </UFormField>

          <UFormField name="widgetType" label="Typ widgetu" required>
            <div class="widget-type-options">
              <button
                v-for="type in widgetTypes"
                :key="type.value"
                type="button"
                class="widget-type-option"
                :class="{ 'widget-type-option--selected': form.widgetType === type.value }"
                @click="selectWidgetType(type.value)"
              >
                <UIcon :name="type.icon" />
                <span><strong>{{ type.label }}</strong><small>{{ type.description }}</small></span>
              </button>
            </div>
          </UFormField>

          <div class="widget-form__grid">
            <UFormField name="widgetName" label="Nazwa wewnętrzna" required>
              <UInput v-model="form.name" class="w-full" />
            </UFormField>
            <UFormField name="widgetTitle" label="Nagłówek dla klienta" required>
              <UInput v-model="form.title" class="w-full" />
            </UFormField>
          </div>

          <UFormField name="widgetTheme" label="Motyw">
            <USelect v-model="form.theme" :items="themeItems" value-key="value" class="w-full" />
          </UFormField>

          <UFormField
            name="widgetOrigins"
            label="Dozwolone domeny"
            description="Opcjonalnie: jedna domena w wierszu. Puste pole pozwoli użyć widgetu na dowolnej stronie."
          >
            <UTextarea v-model="form.allowedOrigins" :rows="3" class="w-full" placeholder="https://twoja-strona.pl" />
          </UFormField>

        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton
          type="submit"
          form="personal-widget-form"
          icon="i-lucide-code-xml"
          :disabled="!canCreate"
          :loading="saving"
        >
          Utwórz widget
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.widgets-page {
  display: grid;
  gap: 1.5rem;
  padding: 1.5rem;
}

.widgets-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.75rem;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 1rem;
  background: linear-gradient(135deg, color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg)) 0%, var(--ui-bg) 65%);
}

.widgets-intro__copy {
  max-width: 48rem;
}

.widgets-intro h2 {
  margin: .75rem 0 .5rem;
  color: var(--ui-text-highlighted);
  font-size: clamp(1.35rem, 2vw, 2rem);
  line-height: 1.15;
}

.widgets-intro p,
.widget-type-card p,
.facility-widget-empty p,
.service-selection p {
  margin: 0;
  color: var(--ui-text-muted);
}

.widgets-intro__stats {
  display: grid;
  min-width: 9rem;
  place-items: center;
  padding: 1.25rem;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 24%, transparent);
  border-radius: .875rem;
  background: color-mix(in srgb, var(--ui-bg) 80%, transparent);
  text-align: center;
}

.widgets-intro__stats strong {
  color: var(--ui-primary);
  font-size: 2.25rem;
  line-height: 1;
}

.widgets-intro__stats span {
  margin-top: .35rem;
  color: var(--ui-text-muted);
  font-size: .8rem;
}

.widget-type-grid,
.widget-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.widget-type-card {
  display: flex;
  gap: .875rem;
  padding: 1rem;
  border: 1px solid var(--ui-border);
  border-radius: .875rem;
  background: var(--ui-bg);
}

.widget-type-card__icon,
.widget-card__icon {
  display: grid;
  flex: 0 0 auto;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  border-radius: .75rem;
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg));
  color: var(--ui-primary);
  font-size: 1.15rem;
}

.widget-type-card h3,
.widget-card h3,
.facility-widget-section h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
}

.widget-type-card p {
  margin-top: .25rem;
  font-size: .825rem;
  line-height: 1.45;
}

.widget-skeletons,
.facility-widget-list {
  display: grid;
  gap: 1rem;
}

.facility-widget-section {
  padding: 1.25rem;
  border: 1px solid var(--ui-border);
  border-radius: 1rem;
  background: var(--ui-bg);
}

.facility-widget-section__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.facility-widget-section__head > div > p {
  margin: 0 0 .15rem;
  color: var(--ui-text-muted);
  font-size: .7rem;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.service-badges,
.widget-card__services {
  display: flex;
  flex-wrap: wrap;
  gap: .4rem;
  margin-top: .65rem;
}

.facility-widget-section__warning {
  display: block;
  margin-top: .5rem;
  color: var(--ui-warning);
  font-size: .825rem;
}

.widget-card-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.widget-card {
  display: grid;
  align-content: start;
  gap: 1rem;
  min-width: 0;
  padding: 1rem;
  border: 1px solid var(--ui-border);
  border-radius: .875rem;
  background: var(--ui-bg-muted);
}

.widget-card__head {
  display: flex;
  gap: .75rem;
}

.widget-card__head > div {
  min-width: 0;
  flex: 1;
}

.widget-card__title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: .5rem;
}

.widget-card__title-row h3 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widget-card__head p {
  margin: .2rem 0 0;
  color: var(--ui-text-muted);
  font-size: .825rem;
}

.widget-card__services span {
  padding: .2rem .45rem;
  border-radius: .4rem;
  background: var(--ui-bg-accented);
  color: var(--ui-text-muted);
  font-size: .72rem;
}

.snippet-block {
  display: grid;
  gap: .35rem;
  min-width: 0;
}

.snippet-block__label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--ui-text-muted);
  font-size: .75rem;
  font-weight: 600;
}

.code-field :deep(textarea) {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: .72rem;
}

.facility-widget-empty {
  display: flex;
  align-items: center;
  gap: .875rem;
  padding: 1rem;
  border: 1px dashed var(--ui-border-accented);
  border-radius: .75rem;
  color: var(--ui-text-muted);
}

.facility-widget-empty > svg {
  flex: 0 0 auto;
  font-size: 1.5rem;
}

.facility-widget-empty strong {
  color: var(--ui-text-highlighted);
}

.facility-widget-empty p {
  margin-top: .15rem;
  font-size: .825rem;
}

.widget-form {
  display: grid;
  gap: 1rem;
}

.widget-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.widget-type-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: .625rem;
}

.widget-type-option {
  display: grid;
  gap: .5rem;
  min-width: 0;
  padding: .75rem;
  border: 1px solid var(--ui-border);
  border-radius: .75rem;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
  transition: border-color .15s ease, background .15s ease;
}

.widget-type-option:hover,
.widget-type-option--selected {
  border-color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-bg));
}

.widget-type-option > svg {
  color: var(--ui-primary);
  font-size: 1.2rem;
}

.widget-type-option span {
  display: grid;
  gap: .2rem;
}

.widget-type-option small {
  color: var(--ui-text-muted);
  font-size: .7rem;
  line-height: 1.35;
}

.service-selection {
  display: grid;
  gap: .75rem;
  padding: 1rem;
  border: 1px solid var(--ui-border);
  border-radius: .75rem;
  background: var(--ui-bg-muted);
}

.service-selection p {
  margin-top: .15rem;
  font-size: .8rem;
}

.service-selection__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .625rem;
}

@media (max-width: 900px) {
  .widget-type-grid,
  .widget-card-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .widgets-page {
    padding: 1rem;
  }

  .widgets-intro,
  .facility-widget-section__head {
    align-items: stretch;
    flex-direction: column;
  }

  .widgets-intro__stats {
    min-width: 0;
  }

  .widget-form__grid,
  .widget-type-options,
  .service-selection__options {
    grid-template-columns: 1fr;
  }
}
</style>
