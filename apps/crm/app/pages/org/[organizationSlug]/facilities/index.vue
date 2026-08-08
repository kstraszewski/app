<script setup lang="ts">
import type { Facility, FacilityListItem, FacilityListPayload } from '~/types/scheduling'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Placówki — OpenExpert CRM' })

type FacilityCreateForm = {
  name: string
  slug: string
  description: string
  timezone: string
  addressLine1: string
  addressLine2: string
  postalCode: string
  city: string
  countryCode: string
  phone: string
  email: string
}

const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const search = ref('')
const createOpen = ref(false)
const saving = ref(false)
const failedCoverUrls = ref<Set<string>>(new Set())
const form = reactive<FacilityCreateForm>(blankForm())
const timezoneItems = ['Europe/Warsaw', 'Europe/London', 'Europe/Berlin', 'Europe/Prague', 'UTC']

const { data: payload, status, error, refresh } = await useFetch<FacilityListPayload>(
  () => orgApiPath('/facilities'),
  {
    query: { includeCover: 'true' },
    default: (): FacilityListPayload => ({
      data: [],
      role: 'expert',
      canCreate: false,
      defaultFacilityId: null,
    }),
  },
)

const facilities = computed(() => payload.value.data)
const activeFacilities = computed(() => facilities.value.filter(facility => facility.is_active).length)
const cityCount = computed(() => new Set(
  facilities.value
    .map(facility => facility.city?.trim())
    .filter((city): city is string => Boolean(city)),
).size)
const pageTitle = computed(() => payload.value.role === 'admin' ? 'Placówki' : 'Moje placówki')
const pageDescription = computed(() => payload.value.role === 'admin'
  ? 'Pełny rejestr placówek organizacji, ich dostępności i konfiguracji obsługi klienta.'
  : 'Placówki przypisane bezpośrednio do Ciebie lub do zespołów, którymi zarządzasz.')
const visibleFacilities = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('pl')
  if (!query) return facilities.value
  return facilities.value.filter(facility => [
    facility.name,
    facility.city,
    facility.slug,
    facility.address_line1,
  ].some(value => String(value ?? '').toLocaleLowerCase('pl').includes(query)))
})

function blankForm(): FacilityCreateForm {
  return {
    name: '',
    slug: '',
    description: '',
    timezone: 'Europe/Warsaw',
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    city: '',
    countryCode: 'PL',
    phone: '',
    email: '',
  }
}

function facilityAddress(facility: Facility) {
  return [
    facility.address_line1,
    facility.address_line2,
    [facility.postal_code, facility.city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
}

function facilityCoverSource(facility: FacilityListItem) {
  const candidates = [
    facility.coverImage?.thumbnailUrl,
    facility.coverImage?.fallbackUrl,
  ]
  return candidates.find((url): url is string => Boolean(
    url && !failedCoverUrls.value.has(url),
  )) ?? ''
}

function handleFacilityCoverError(event: Event) {
  const image = event.currentTarget as HTMLImageElement | null
  const failedUrl = image?.getAttribute('src')
  if (!failedUrl) return
  failedCoverUrls.value = new Set([...failedCoverUrls.value, failedUrl])
}

function openCreate() {
  Object.assign(form, blankForm())
  createOpen.value = true
}

async function createFacility() {
  if (!payload.value.canCreate || !form.name.trim()) return
  saving.value = true
  try {
    const result = await $fetch<{ data: Facility }>(orgApiPath('/facilities'), {
      method: 'POST',
      body: {
        name: form.name.trim(),
        slug: form.slug.trim() || undefined,
        description: form.description.trim() || undefined,
        timezone: form.timezone,
        addressLine1: form.addressLine1.trim() || undefined,
        addressLine2: form.addressLine2.trim() || undefined,
        postalCode: form.postalCode.trim() || undefined,
        city: form.city.trim() || undefined,
        countryCode: form.countryCode.trim().toUpperCase() || 'PL',
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
      },
    })
    createOpen.value = false
    await refresh()
    toast.add({ title: 'Placówka została utworzona', color: 'success', icon: 'i-lucide-building-2' })
    await navigateTo(orgPath(`/facilities/${result.data.id}`))
  } catch (createError: unknown) {
    toast.add({
      title: 'Nie udało się utworzyć placówki',
      description: apiErrorMessage(createError),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <CrmShell
    :title="pageTitle"
    eyebrow="Administracja zespołu"
    :description="pageDescription"
  >
    <template #meta>
      <div class="facility-index__scope">
        <UBadge
          color="neutral"
          variant="outline"
          :icon="payload.role === 'admin' ? 'i-lucide-building-2' : 'i-lucide-shield-check'"
        >
          {{ payload.role === 'admin' ? 'Cała organizacja' : 'Twój zakres dostępu' }}
        </UBadge>
        <span>Widok listy prowadzi do szczegółów placówki.</span>
      </div>
    </template>

    <template #actions>
      <UButton v-if="payload.canCreate" icon="i-lucide-plus" @click="openCreate">
        Nowa placówka
      </UButton>
    </template>

    <section class="facility-index">
      <div class="facility-index__summary">
        <article class="facility-stat">
          <span class="facility-stat__icon"><UIcon name="i-lucide-building-2" /></span>
          <div>
            <small>Dostępne placówki</small>
            <strong>{{ facilities.length }}</strong>
            <p>{{ payload.role === 'admin' ? 'w całej organizacji' : 'w Twoim zakresie' }}</p>
          </div>
        </article>
        <article class="facility-stat">
          <span class="facility-stat__icon"><UIcon name="i-lucide-circle-check-big" /></span>
          <div>
            <small>Aktywne</small>
            <strong>{{ activeFacilities }}</strong>
            <p>gotowe do obsługi</p>
          </div>
        </article>
        <article class="facility-stat">
          <span class="facility-stat__icon"><UIcon name="i-lucide-map-pinned" /></span>
          <div>
            <small>Miasta</small>
            <strong>{{ cityCount }}</strong>
            <p>lokalizacje operacyjne</p>
          </div>
        </article>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się pobrać placówek"
        :description="apiErrorMessage(error)"
        :actions="[{ label: 'Ponów', onClick: () => refresh() }]"
      />

      <UCard class="facility-index__card">
        <template #header>
          <div class="facility-index__toolbar">
            <div class="facility-index__toolbar-copy">
              <span>Rejestr operacyjny</span>
              <h2>Dostępne placówki</h2>
              <p>Otwórz placówkę, aby zobaczyć jej zespół, grafik, usługi i kalendarze.</p>
            </div>
            <UInput
              v-model="search"
              icon="i-lucide-search"
              placeholder="Szukaj po nazwie, mieście lub adresie"
              aria-label="Szukaj placówek"
            />
          </div>
        </template>

        <div v-if="status === 'pending'" class="facility-index__rows">
          <USkeleton v-for="index in 4" :key="index" class="h-20 w-full" />
        </div>

        <div v-else-if="visibleFacilities.length" class="facility-index__rows">
          <NuxtLink
            v-for="facility in visibleFacilities"
            :key="facility.id"
            :to="orgPath(`/facilities/${facility.id}`)"
            class="facility-row"
          >
            <span class="facility-row__cover" aria-hidden="true">
              <img
                v-if="facilityCoverSource(facility)"
                :key="facilityCoverSource(facility)"
                :src="facilityCoverSource(facility)"
                alt=""
                width="72"
                height="54"
                loading="lazy"
                decoding="async"
                @error="handleFacilityCoverError"
              >
              <UIcon v-else name="i-lucide-building-2" />
            </span>
            <span class="facility-row__identity">
              <strong>{{ facility.name }}</strong>
              <small>{{ facilityAddress(facility) || 'Adres nie został uzupełniony' }}</small>
            </span>
            <span class="facility-row__meta">
              <span><UIcon name="i-lucide-map-pin" /> {{ facility.city || 'Miasto nieuzupełnione' }}</span>
              <span><UIcon name="i-lucide-clock-3" /> {{ facility.timezone }}</span>
            </span>
            <UBadge class="facility-row__status" :color="facility.is_active ? 'success' : 'neutral'" variant="subtle">
              {{ facility.is_active ? 'Aktywna' : 'Nieaktywna' }}
            </UBadge>
            <span class="facility-row__open" aria-hidden="true">
              Otwórz
              <UIcon name="i-lucide-arrow-right" />
            </span>
          </NuxtLink>
        </div>

        <OeEmptyState
          v-else
          :kind="facilities.length ? 'filtered' : 'empty'"
          :icon="facilities.length ? 'i-lucide-search-x' : 'i-lucide-map-pinned'"
          :title="facilities.length ? 'Brak pasujących placówek' : 'Nie ma jeszcze placówek'"
          :description="facilities.length
            ? 'Zmień wyszukiwaną frazę lub wyczyść wyszukiwanie.'
            : 'Dodaj pierwszą placówkę i skonfiguruj dostępność zespołu.'"
        >
          <template #actions>
            <UButton v-if="facilities.length" color="neutral" variant="outline" icon="i-lucide-x" @click="search = ''">
              Wyczyść wyszukiwanie
            </UButton>
            <UButton v-if="payload.canCreate && !facilities.length" icon="i-lucide-plus" @click="openCreate">
              Dodaj placówkę
            </UButton>
          </template>
        </OeEmptyState>
      </UCard>
    </section>

    <UModal
      v-model:open="createOpen"
      title="Nowa placówka"
      description="Podaj podstawowe dane. Pozostałe ustawienia uzupełnisz w widoku szczegółów."
      :ui="{ content: 'sm:max-w-3xl', footer: 'justify-end' }"
    >
      <template #body>
        <form id="facility-create-form" class="facility-form" @submit.prevent="createFacility">
          <div class="facility-form__grid">
            <UFormField label="Nazwa" required>
              <UInput v-model="form.name" class="w-full" autofocus />
            </UFormField>
            <UFormField label="Slug" description="Opcjonalny — wygeneruje się z nazwy.">
              <UInput v-model="form.slug" class="w-full" />
            </UFormField>
            <UFormField label="Miasto">
              <UInput v-model="form.city" class="w-full" />
            </UFormField>
            <UFormField label="Kod pocztowy">
              <UInput v-model="form.postalCode" class="w-full" />
            </UFormField>
            <UFormField label="Adres">
              <UInput v-model="form.addressLine1" class="w-full" />
            </UFormField>
            <UFormField label="Lokal / piętro">
              <UInput v-model="form.addressLine2" class="w-full" />
            </UFormField>
            <UFormField label="Strefa czasowa" required>
              <USelect v-model="form.timezone" :items="timezoneItems" class="w-full" />
            </UFormField>
            <UFormField label="Kod kraju">
              <UInput v-model="form.countryCode" class="w-full" maxlength="2" />
            </UFormField>
            <UFormField label="Telefon">
              <UInput v-model="form.phone" type="tel" class="w-full" />
            </UFormField>
            <UFormField label="E-mail">
              <UInput v-model="form.email" type="email" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="Opis">
            <UTextarea v-model="form.description" class="w-full" :rows="3" />
          </UFormField>
        </form>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">Anuluj</UButton>
        <UButton
          type="submit"
          form="facility-create-form"
          icon="i-lucide-building-2"
          :disabled="!form.name.trim()"
          :loading="saving"
        >
          Utwórz placówkę
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.facility-index {
  display: grid;
  gap: 22px;
  container-name: facility-index;
  container-type: inline-size;
}

.facility-index__scope {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-dimmed);
  font-size: 11px;
}

.facility-index__summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  gap: 14px;
}

.facility-stat {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
}

.facility-stat__icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
  font-size: 17px;
}

.facility-stat > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.facility-stat small,
.facility-index__toolbar-copy > span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.facility-stat strong {
  color: var(--ui-text-highlighted);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.05;
}

.facility-stat p {
  margin: 0;
  color: var(--ui-text-dimmed);
  font-size: 10px;
}

.facility-index__card :deep(.divide-y) { border-color: var(--ui-border); }
.facility-index__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.facility-index__toolbar h2 { margin: 0; }
.facility-index__toolbar p { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.facility-index__toolbar > :last-child { width: min(360px, 100%); }
.facility-index__toolbar-copy > span { display: block; margin-bottom: 5px; }
.facility-index__rows { display: grid; gap: 8px; }
.facility-row { display: grid; grid-template-columns: 72px minmax(220px, 1.5fr) minmax(170px, .8fr) auto auto; align-items: center; gap: 14px; padding: 14px; border: 1px solid transparent; border-radius: var(--ui-radius); color: inherit; text-decoration: none; transition: background var(--oe-motion-fast), border-color var(--oe-motion-fast); }
.facility-row:hover { border-color: var(--ui-border-accented); background: var(--ui-bg-muted); }
.facility-row__cover { display: grid; overflow: hidden; place-items: center; width: 72px; height: 54px; aspect-ratio: 4 / 3; border: 1px solid var(--ui-border); border-radius: 10px; background: var(--ui-bg-muted); color: var(--ui-text-highlighted); }
.facility-row__cover img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }
.facility-row__identity, .facility-row__meta { display: grid; gap: 3px; min-width: 0; }
.facility-row__identity strong, .facility-row__identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.facility-row__identity strong { color: var(--ui-text-highlighted); }
.facility-row__identity small, .facility-row__meta { color: var(--ui-text-muted); font-size: 11px; }
.facility-row__meta span { display: flex; align-items: center; gap: 6px; }
.facility-row__meta .iconify { flex: none; font-size: 12px; }
.facility-row__open { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-width: 44px; min-height: 44px; color: var(--ui-text-muted); font-size: 11px; font-weight: 600; transition: color var(--oe-motion-fast); }
.facility-row:hover .facility-row__open { color: var(--ui-text-highlighted); }
.facility-index__empty { display: grid; place-items: center; gap: 10px; min-height: 280px; text-align: center; }
.facility-index__empty > .iconify { width: 34px; height: 34px; color: var(--ui-text-muted); }
.facility-index__empty h3, .facility-index__empty p { margin: 0; }
.facility-index__empty p { color: var(--ui-text-muted); }
.facility-form { display: grid; gap: 18px; }
.facility-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
@container facility-index (max-width: 760px) {
  .facility-index__toolbar { align-items: stretch; flex-direction: column; }
  .facility-index__toolbar > :last-child { width: 100%; }
  .facility-row {
    grid-template-columns: 56px minmax(0, 1fr) 44px;
    gap: 10px 12px;
    padding: 14px;
    border-color: var(--ui-border);
    background: var(--ui-bg);
  }
  .facility-row__cover { width: 56px; height: 42px; border-radius: 9px; }
  .facility-row__cover { grid-column: 1; grid-row: 1 / span 3; }
  .facility-row__identity { grid-column: 2; grid-row: 1; align-self: center; }
  .facility-row__meta {
    display: grid;
    grid-column: 2 / -1;
    grid-row: 2;
    gap: 6px;
  }
  .facility-row__meta span { min-width: 0; overflow-wrap: anywhere; }
  .facility-row__status { grid-column: 2 / -1; grid-row: 3; justify-self: start; }
  .facility-row__open {
    grid-column: 3;
    grid-row: 1;
    width: 44px;
    height: 44px;
    font-size: 0;
  }
  .facility-row__open .iconify { font-size: 15px; }
}
@media (max-width: 780px) {
  .facility-form__grid { grid-template-columns: 1fr; }
}
</style>
