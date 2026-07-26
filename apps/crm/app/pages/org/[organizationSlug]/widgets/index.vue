<script setup lang="ts">
import type {
  BookingWidget,
  PersonalWidgetFacility,
  PersonalWidgetsPayload,
} from '~/types/scheduling'
import type { BookingWidgetType } from '#shared/types/booking-calculators'
import {
  BOOKING_WIDGET_TYPES,
  bookingWidgetTypeMeta,
} from '~/utils/booking-widgets'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Widgety — OpenExpert CRM' })

interface WidgetListItem {
  facility: PersonalWidgetFacility['facility']
  services: PersonalWidgetFacility['services']
  widget: BookingWidget
}

const { organizationSlug, orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const search = ref('')
const statusFilter = ref<'all' | 'active' | 'inactive'>('all')
const typeFilter = ref<'all' | BookingWidgetType>('all')
const facilityFilter = ref('all')
const createOpen = ref(false)
const creating = ref(false)
const statusSavingId = ref('')
const disableTarget = ref<WidgetListItem | null>(null)

const emptyPayload: PersonalWidgetsPayload = { currentUserId: '', data: [] }
const { data: payload, status, error, refresh } = await useFetch<PersonalWidgetsPayload>(
  () => orgApiPath('/widgets'),
  {
    key: computed(() => `personal-widgets:${organizationSlug.value}`),
    default: () => emptyPayload,
  },
)

const pending = computed(() => status.value === 'pending')
const widgets = computed<WidgetListItem[]>(() => payload.value.data.flatMap(item => (
  item.widgets.map(widget => ({
    facility: item.facility,
    services: item.services,
    widget,
  }))
)))
const visibleWidgets = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('pl')
  return widgets.value.filter((item) => {
    const matchesSearch = !query || [
      item.widget.name,
      item.widget.title,
      item.facility.name,
      bookingWidgetTypeMeta(item.widget.widget_type).label,
    ].some(value => value.toLocaleLowerCase('pl').includes(query))
    const matchesStatus = statusFilter.value === 'all'
      || (statusFilter.value === 'active' ? item.widget.is_active : !item.widget.is_active)
    const matchesType = typeFilter.value === 'all' || item.widget.widget_type === typeFilter.value
    const matchesFacility = facilityFilter.value === 'all' || item.facility.id === facilityFilter.value
    return matchesSearch && matchesStatus && matchesType && matchesFacility
  })
})
const activeCount = computed(() => widgets.value.filter(item => item.widget.is_active).length)
const inactiveCount = computed(() => widgets.value.length - activeCount.value)
const bookings30Days = computed(() => widgets.value.reduce(
  (total, item) => total + (item.widget.bookings30Days ?? 0),
  0,
))
const typeItems = [
  { label: 'Wszystkie typy', value: 'all' },
  ...BOOKING_WIDGET_TYPES.map(item => ({ label: item.label, value: item.value })),
]
const statusItems = [
  { label: 'Wszystkie statusy', value: 'all' },
  { label: 'Aktywne', value: 'active' },
  { label: 'Wyłączone', value: 'inactive' },
]
const facilityItems = computed(() => [
  { label: 'Wszystkie placówki', value: 'all' },
  ...payload.value.data.map(item => ({ label: item.facility.name, value: item.facility.id })),
])
const createFacilityItems = computed(() => payload.value.data.map(item => ({
  label: item.facility.name,
  value: item.facility.id,
})))
const themeItems = [
  { label: 'Automatyczny', value: 'auto' },
  { label: 'Jasny', value: 'light' },
  { label: 'Ciemny', value: 'dark' },
]

const form = reactive({
  facilityId: '',
  widgetType: 'mortgage_capacity' as BookingWidgetType,
  name: BOOKING_WIDGET_TYPES[0]!.defaultName,
  title: BOOKING_WIDGET_TYPES[0]!.defaultTitle,
  theme: 'auto' as 'light' | 'dark' | 'auto',
  allowedOrigins: '',
})
const selectedFacility = computed(() => (
  payload.value.data.find(item => item.facility.id === form.facilityId) ?? null
))
const canCreate = computed(() => Boolean(
  form.facilityId
  && form.name.trim()
  && form.title.trim()
  && selectedFacility.value?.services.length,
))

function clearFilters() {
  search.value = ''
  statusFilter.value = 'all'
  typeFilter.value = 'all'
  facilityFilter.value = 'all'
}

function openCreate(facilityId?: string) {
  const preferred = payload.value.data.find(item => item.facility.id === facilityId && item.services.length)
    ?? payload.value.data.find(item => item.services.length)
  const defaults = BOOKING_WIDGET_TYPES[0]!
  Object.assign(form, {
    facilityId: preferred?.facility.id ?? '',
    widgetType: defaults.value,
    name: defaults.defaultName,
    title: defaults.defaultTitle,
    theme: 'auto',
    allowedOrigins: '',
  })
  createOpen.value = true
}

function selectWidgetType(type: BookingWidgetType) {
  const previous = bookingWidgetTypeMeta(form.widgetType)
  const next = bookingWidgetTypeMeta(type)
  if (!form.name.trim() || form.name === previous.defaultName) form.name = next.defaultName
  if (!form.title.trim() || form.title === previous.defaultTitle) form.title = next.defaultTitle
  form.widgetType = type
}

function parseOrigins(value: string) {
  return [...new Set(value.split(/[\n,]/).map(origin => origin.trim()).filter(Boolean))]
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

function replaceWidget(updated: BookingWidget) {
  payload.value = {
    ...payload.value,
    data: payload.value.data.map(item => ({
      ...item,
      widgets: item.widgets.map(widget => (
        widget.id === updated.id ? { ...widget, ...updated } : widget
      )),
    })),
  }
}

async function createWidget() {
  if (!canCreate.value || !selectedFacility.value) return
  creating.value = true
  try {
    const result = await $fetch<{ data: BookingWidget }>(
      orgApiPath(`/facilities/${encodeURIComponent(form.facilityId)}/widgets`),
      {
        method: 'POST',
        body: {
          name: form.name.trim(),
          title: form.title.trim(),
          subtitle: null,
          theme: form.theme,
          accentColor: '#2563eb',
          allowedOrigins: parseOrigins(form.allowedOrigins),
          bookingMode: 'expert',
          widgetType: form.widgetType,
          fixedExpertUserId: payload.value.currentUserId,
          locale: 'pl-PL',
          isActive: true,
          serviceIds: selectedFacility.value.services.map(service => service.id),
        },
      },
    )
    createOpen.value = false
    await refresh()
    toast.add({ title: 'Widget został utworzony', color: 'success', icon: 'i-lucide-circle-check' })
    await navigateTo(orgPath(`/widgets/${result.data.id}`))
  } catch (cause: unknown) {
    actionError('Nie udało się utworzyć widgetu', cause)
  } finally {
    creating.value = false
  }
}

async function updateStatus(item: WidgetListItem, isActive: boolean) {
  if (statusSavingId.value) return
  statusSavingId.value = item.widget.id
  try {
    const result = await $fetch<{ data: BookingWidget }>(
      orgApiPath(
        `/facilities/${encodeURIComponent(item.facility.id)}/widgets/${encodeURIComponent(item.widget.id)}`,
      ),
      { method: 'PATCH', body: { isActive } },
    )
    replaceWidget(result.data)
    toast.add({
      title: isActive ? 'Widget został włączony' : 'Widget został wyłączony',
      description: isActive
        ? 'Publiczny link i osadzenie znów przyjmują rezerwacje.'
        : 'Konfiguracja i analityka zostały zachowane.',
      color: isActive ? 'success' : 'neutral',
      icon: isActive ? 'i-lucide-circle-check' : 'i-lucide-circle-pause',
    })
  } catch (cause: unknown) {
    actionError(isActive ? 'Nie udało się włączyć widgetu' : 'Nie udało się wyłączyć widgetu', cause)
  } finally {
    statusSavingId.value = ''
    disableTarget.value = null
  }
}

function requestStatus(item: WidgetListItem, isActive: boolean) {
  if (isActive) {
    void updateStatus(item, true)
    return
  }
  disableTarget.value = item
}

function closeDisableDialog() {
  disableTarget.value = null
}

function confirmDisable() {
  if (disableTarget.value) void updateStatus(disableTarget.value, false)
}
</script>

<template>
  <CrmShell
    title="Widgety"
    eyebrow="Ekspert"
    description="Osadzane formularze i konfiguracje pozyskiwania kontaktów."
  >
    <template #actions>
      <UButton
        icon="i-lucide-plus"
        :disabled="!payload.data.some(item => item.services.length)"
        @click="openCreate()"
      >
        Nowy widget
      </UButton>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="outline"
        square
        :loading="pending"
        aria-label="Odśwież widgety"
        title="Odśwież"
        @click="refresh()"
      />
    </template>

    <section class="widget-summary" aria-label="Podsumowanie widgetów">
      <button
        type="button"
        class="widget-summary__item"
        :class="{ 'widget-summary__item--active': statusFilter === 'all' }"
        :aria-pressed="statusFilter === 'all'"
        @click="statusFilter = 'all'"
      >
        <span class="widget-summary__icon"><UIcon name="i-lucide-panels-top-left" /></span>
        <span><strong>{{ widgets.length }}</strong><small>Wszystkie widgety</small></span>
      </button>
      <button
        type="button"
        class="widget-summary__item"
        :class="{ 'widget-summary__item--active': statusFilter === 'active' }"
        :aria-pressed="statusFilter === 'active'"
        @click="statusFilter = 'active'"
      >
        <span class="widget-summary__icon widget-summary__icon--success"><UIcon name="i-lucide-circle-play" /></span>
        <span><strong>{{ activeCount }}</strong><small>Aktywne</small></span>
      </button>
      <button
        type="button"
        class="widget-summary__item"
        :class="{ 'widget-summary__item--active': statusFilter === 'inactive' }"
        :aria-pressed="statusFilter === 'inactive'"
        @click="statusFilter = 'inactive'"
      >
        <span class="widget-summary__icon"><UIcon name="i-lucide-circle-pause" /></span>
        <span><strong>{{ inactiveCount }}</strong><small>Wyłączone</small></span>
      </button>
      <div class="widget-summary__item">
        <span class="widget-summary__icon"><UIcon name="i-lucide-calendar-check-2" /></span>
        <span><strong>{{ bookings30Days }}</strong><small>Rezerwacje · 30 dni</small></span>
      </div>
    </section>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się wczytać widgetów"
      description="Odśwież stronę i spróbuj ponownie."
    >
      <template #actions>
        <UButton variant="ghost" icon="i-lucide-refresh-cw" @click="refresh()">Ponów</UButton>
      </template>
    </UAlert>

    <template v-else>
      <div class="widget-toolbar">
        <UInput
          v-model="search"
          class="widget-toolbar__search"
          icon="i-lucide-search"
          placeholder="Szukaj po nazwie, typie lub placówce"
          aria-label="Szukaj widgetu"
        />
        <USelect v-model="statusFilter" :items="statusItems" aria-label="Filtruj według statusu" />
        <USelect v-model="typeFilter" :items="typeItems" aria-label="Filtruj według typu" />
        <USelect v-model="facilityFilter" :items="facilityItems" aria-label="Filtruj według placówki" />
        <span class="widget-toolbar__count">{{ visibleWidgets.length }} z {{ widgets.length }}</span>
      </div>

      <div v-if="pending && !widgets.length" class="widget-skeleton">
        <USkeleton class="h-14 w-full" />
        <USkeleton v-for="index in 4" :key="index" class="h-20 w-full" />
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

      <section v-else-if="widgets.length && visibleWidgets.length" class="widget-register" aria-label="Lista widgetów">
        <div class="widget-register__head" aria-hidden="true">
          <span>Widget</span>
          <span>Placówka</span>
          <span>Typ</span>
          <span>Rezerwacje · 30 dni</span>
          <span>Status</span>
          <span />
        </div>

        <div v-for="item in visibleWidgets" :key="item.widget.id" class="widget-register__row">
          <NuxtLink :to="orgPath(`/widgets/${item.widget.id}`)" class="widget-register__link">
            <span class="widget-register__identity">
              <span class="widget-register__type-icon">
                <UIcon :name="bookingWidgetTypeMeta(item.widget.widget_type).icon" />
              </span>
              <span>
                <strong>{{ item.widget.name }}</strong>
                <small>{{ item.widget.title }}</small>
              </span>
            </span>
            <span class="widget-register__facility" data-label="Placówka">{{ item.facility.name }}</span>
            <span data-label="Typ">{{ bookingWidgetTypeMeta(item.widget.widget_type).label }}</span>
            <span class="widget-register__metric" data-label="Rezerwacje · 30 dni">{{ item.widget.bookings30Days ?? 0 }}</span>
            <span data-label="Status">
              <UBadge :color="item.widget.is_active ? 'success' : 'neutral'" variant="subtle">
                {{ item.widget.is_active ? 'Aktywny' : 'Wyłączony' }}
              </UBadge>
            </span>
          </NuxtLink>
          <div class="widget-register__actions">
            <USwitch
              :model-value="item.widget.is_active"
              :disabled="Boolean(statusSavingId)"
              :aria-label="item.widget.is_active ? `Wyłącz ${item.widget.name}` : `Włącz ${item.widget.name}`"
              @update:model-value="requestStatus(item, Boolean($event))"
            />
            <UButton
              :to="orgPath(`/widgets/${item.widget.id}`)"
              color="neutral"
              variant="ghost"
              square
              icon="i-lucide-chevron-right"
              :aria-label="`Otwórz ${item.widget.name}`"
            />
          </div>
        </div>
      </section>

      <div v-else-if="widgets.length" class="widget-empty">
        <span class="widget-empty__icon"><UIcon name="i-lucide-search-x" /></span>
        <div>
          <strong>Brak widgetów pasujących do filtrów</strong>
          <p>Zmień kryteria albo wyczyść wszystkie filtry.</p>
        </div>
        <UButton color="neutral" variant="outline" @click="clearFilters">Wyczyść filtry</UButton>
      </div>

      <div v-if="payload.data.length && !widgets.length && !pending" class="widget-empty">
        <span class="widget-empty__icon"><UIcon name="i-lucide-panels-top-left" /></span>
        <div>
          <strong>Utwórz pierwszy widget</strong>
          <p>Po utworzeniu przejdziesz do personalizacji, podglądu i kodów osadzenia.</p>
        </div>
        <UButton icon="i-lucide-plus" @click="openCreate()">Nowy widget</UButton>
      </div>
    </template>

    <UModal
      v-model:open="createOpen"
      title="Nowy widget eksperta"
      description="Utwórz bazową konfigurację, a potem dopracuj ją na osobnej stronie widgetu."
      :ui="{ content: 'sm:max-w-3xl', footer: 'justify-end' }"
    >
      <template #body>
        <form id="personal-widget-form" class="widget-form" @submit.prevent="createWidget">
          <UFormField name="widgetFacility" label="Placówka" required>
            <USelect v-model="form.facilityId" :items="createFacilityItems" class="w-full" />
          </UFormField>

          <UFormField name="widgetType" label="Typ widgetu" required>
            <div class="widget-type-options">
              <button
                v-for="type in BOOKING_WIDGET_TYPES"
                :key="type.value"
                type="button"
                class="widget-type-option"
                :class="{ 'widget-type-option--selected': form.widgetType === type.value }"
                :aria-pressed="form.widgetType === type.value"
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
            <USelect v-model="form.theme" :items="themeItems" class="w-full" />
          </UFormField>

          <UFormField
            name="widgetOrigins"
            label="Dozwolone domeny"
            description="Opcjonalnie: jedna domena w wierszu. Puste pole pozwala użyć widgetu na dowolnej stronie."
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
          :loading="creating"
        >
          Utwórz i personalizuj
        </UButton>
      </template>
    </UModal>

    <UModal
      :open="Boolean(disableTarget)"
      title="Wyłączyć widget?"
      description="Publiczny link i osadzenie przestaną działać, ale konfiguracja, analityka i istniejące rezerwacje pozostaną bez zmian."
      :ui="{ footer: 'justify-end' }"
      @update:open="!$event && closeDisableDialog()"
    >
      <template #body>
        <UAlert
          v-if="disableTarget"
          color="warning"
          variant="subtle"
          icon="i-lucide-circle-pause"
          :title="disableTarget.widget.name"
          :description="disableTarget.facility.name"
        />
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" @click="closeDisableDialog">Anuluj</UButton>
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-circle-pause"
          :loading="statusSavingId === disableTarget?.widget.id"
          @click="confirmDisable"
        >
          Wyłącz widget
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.widget-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.widget-summary__item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 86px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
  transition: border-color var(--oe-motion-fast), background-color var(--oe-motion-fast);
}

button.widget-summary__item {
  cursor: pointer;
}

button.widget-summary__item:hover,
.widget-summary__item--active {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.widget-summary__icon,
.widget-register__type-icon,
.widget-empty__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: var(--ui-bg-accented);
  color: var(--ui-text-muted);
}

.widget-summary__icon {
  width: 38px;
  height: 38px;
}

.widget-summary__icon--success {
  color: var(--ui-success);
}

.widget-summary__item > span:last-child {
  display: grid;
  min-width: 0;
}

.widget-summary__item strong {
  color: var(--ui-text-highlighted);
  font-family: var(--font-mono);
  font-size: 22px;
  line-height: 1;
}

.widget-summary__item small {
  margin-top: 7px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.widget-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) repeat(3, minmax(150px, auto)) auto;
  gap: 10px;
  align-items: center;
  margin-bottom: 14px;
}

.widget-toolbar__search {
  min-width: 0;
}

.widget-toolbar__count {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.widget-skeleton {
  display: grid;
  gap: 8px;
}

.widget-register {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg);
  container-name: widget-register;
  container-type: inline-size;
}

.widget-register__head,
.widget-register__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 140px;
  min-width: 0;
}

.widget-register__head {
  grid-template-columns: minmax(260px, 1.4fr) minmax(150px, .8fr) minmax(150px, .8fr) 130px 100px 140px;
  align-items: center;
  min-height: 42px;
  padding: 0 14px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.widget-register__row + .widget-register__row {
  border-top: 1px solid var(--ui-border-muted);
}

.widget-register__row:hover {
  background: var(--ui-bg-muted);
}

.widget-register__link {
  display: grid;
  grid-template-columns: minmax(260px, 1.4fr) minmax(150px, .8fr) minmax(150px, .8fr) 130px 100px;
  align-items: center;
  min-width: 0;
  min-height: 76px;
  padding: 10px 0 10px 14px;
  color: var(--ui-text);
  text-decoration: none;
}

.widget-register__identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding-right: 14px;
}

.widget-register__type-icon {
  width: 38px;
  height: 38px;
  color: var(--ui-primary);
}

.widget-register__identity > span:last-child {
  display: grid;
  min-width: 0;
}

.widget-register__identity strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widget-register__identity small {
  overflow: hidden;
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widget-register__facility,
.widget-register__link > span {
  overflow: hidden;
  padding-right: 14px;
  color: var(--ui-text-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.widget-register__metric {
  color: var(--ui-text-highlighted) !important;
  font-family: var(--font-mono);
  font-size: 13px !important;
}

.widget-register__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-height: 76px;
  padding-right: 10px;
}

.widget-empty {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 112px;
  padding: 20px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 12px;
  background: var(--ui-bg-muted);
}

.widget-empty__icon {
  width: 42px;
  height: 42px;
  font-size: 18px;
}

.widget-empty > div {
  flex: 1;
}

.widget-empty strong {
  color: var(--ui-text-highlighted);
}

.widget-empty p {
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.widget-form {
  display: grid;
  gap: 16px;
}

.widget-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.widget-type-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.widget-type-option {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 12px;
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
  font-size: 20px;
}

.widget-type-option span {
  display: grid;
  gap: 4px;
}

.widget-type-option strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.widget-type-option small {
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.45;
}

@media (max-width: 1180px) {
  .widget-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .widget-toolbar {
    grid-template-columns: minmax(220px, 1fr) repeat(2, minmax(140px, auto));
  }

  .widget-toolbar__count {
    justify-self: end;
  }

  .widget-register__head {
    grid-template-columns: minmax(240px, 1.3fr) minmax(140px, .8fr) minmax(140px, .8fr) 110px 130px;
  }

  .widget-register__head span:nth-child(4),
  .widget-register__link > span:nth-child(4) {
    display: none;
  }

  .widget-register__head span:nth-child(5) {
    grid-column: 4;
  }

  .widget-register__link {
    grid-template-columns: minmax(240px, 1.3fr) minmax(140px, .8fr) minmax(140px, .8fr) 110px;
  }
}

@media (max-width: 820px) {
  .widget-toolbar {
    grid-template-columns: 1fr 1fr;
  }

  .widget-toolbar__search {
    grid-column: 1 / -1;
  }

  .widget-register__head {
    display: none;
  }

  .widget-register__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .widget-register__link {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 14px;
    min-height: 86px;
    padding-block: 14px;
  }

  .widget-register__identity {
    grid-column: 1 / -1;
  }

  .widget-register__link > span:not(.widget-register__identity) {
    display: grid;
    gap: 3px;
    padding-right: 0;
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
  }

  .widget-register__link > span:not(.widget-register__identity)::before {
    content: attr(data-label);
    color: var(--ui-text-dimmed);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 650;
    letter-spacing: .04em;
    text-transform: uppercase;
  }
}

@container widget-register (max-width: 820px) {
  .widget-register__head {
    display: none;
  }

  .widget-register__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .widget-register__link {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 14px;
    min-height: 86px;
    padding-block: 14px;
  }

  .widget-register__identity {
    grid-column: 1 / -1;
  }

  .widget-register__link > span:not(.widget-register__identity) {
    display: grid;
    gap: 3px;
    padding-right: 0;
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
  }

  .widget-register__link > span:not(.widget-register__identity)::before {
    content: attr(data-label);
    color: var(--ui-text-dimmed);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 650;
    letter-spacing: .04em;
    text-transform: uppercase;
  }
}

@media (max-width: 620px) {
  .widget-summary,
  .widget-toolbar,
  .widget-form__grid,
  .widget-type-options {
    grid-template-columns: 1fr;
  }

  .widget-toolbar__search {
    grid-column: auto;
  }

  .widget-toolbar__count {
    justify-self: start;
  }

  .widget-empty {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .widget-register__link {
    grid-template-columns: 1fr;
  }
}
</style>
