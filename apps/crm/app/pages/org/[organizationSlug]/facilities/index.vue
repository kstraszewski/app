<script setup lang="ts">
import type { Facility, FacilityListPayload } from '~/types/scheduling'
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
const form = reactive<FacilityCreateForm>(blankForm())
const timezoneItems = ['Europe/Warsaw', 'Europe/London', 'Europe/Berlin', 'Europe/Prague', 'UTC']

const { data: payload, status, error, refresh } = await useFetch<FacilityListPayload>(
  () => orgApiPath('/facilities'),
  { default: (): FacilityListPayload => ({ data: [], role: 'expert', canCreate: false }) },
)

const facilities = computed(() => payload.value.data)
const activeFacilities = computed(() => facilities.value.filter(facility => facility.is_active).length)
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
    title="Placówki"
    eyebrow="Administracja organizacji"
    description="Rejestr miejsc pracy, usług, dostępności i konfiguracji rezerwacji."
  >
    <template #actions>
      <UButton v-if="payload.canCreate" icon="i-lucide-plus" @click="openCreate">
        Nowa placówka
      </UButton>
    </template>

    <section class="facility-index">
      <div class="facility-index__summary">
        <article>
          <span>Wszystkie placówki</span>
          <strong>{{ facilities.length }}</strong>
          <small>Miejsca pracy w organizacji</small>
        </article>
        <article>
          <span>Aktywne</span>
          <strong>{{ activeFacilities }}</strong>
          <small>Dostępne w konfiguracji rezerwacji</small>
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
            <div>
              <h2>Lista placówek</h2>
              <p>Wybierz placówkę, aby otworzyć jej zespół, godziny, usługi, kalendarze i wizyty.</p>
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
            <span class="facility-row__icon"><UIcon name="i-lucide-building-2" /></span>
            <span class="facility-row__identity">
              <strong>{{ facility.name }}</strong>
              <small>{{ facilityAddress(facility) || 'Adres nie został uzupełniony' }}</small>
            </span>
            <span class="facility-row__meta">
              <span>{{ facility.timezone }}</span>
              <code>{{ facility.slug }}</code>
            </span>
            <UBadge :color="facility.is_active ? 'success' : 'neutral'" variant="subtle">
              {{ facility.is_active ? 'Aktywna' : 'Nieaktywna' }}
            </UBadge>
            <UIcon name="i-lucide-chevron-right" class="facility-row__arrow" />
          </NuxtLink>
        </div>

        <div v-else class="facility-index__empty">
          <UIcon name="i-lucide-map-pinned" />
          <h3>{{ facilities.length ? 'Brak wyników' : 'Nie ma jeszcze placówek' }}</h3>
          <p>{{ facilities.length ? 'Zmień wyszukiwaną frazę.' : 'Dodaj pierwszą placówkę i skonfiguruj dostępność zespołu.' }}</p>
          <UButton v-if="payload.canCreate && !facilities.length" icon="i-lucide-plus" @click="openCreate">
            Dodaj placówkę
          </UButton>
        </div>
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
.facility-index { display: grid; gap: 22px; }
.facility-index__summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.facility-index__summary article { display: grid; gap: 4px; padding: 18px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.facility-index__summary span { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.facility-index__summary strong { color: var(--ui-text-highlighted); font-size: 30px; line-height: 1; }
.facility-index__summary small { color: var(--ui-text-muted); }
.facility-index__card :deep(.divide-y) { border-color: var(--ui-border); }
.facility-index__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.facility-index__toolbar h2 { margin: 0; }
.facility-index__toolbar p { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.facility-index__toolbar > :last-child { width: min(360px, 100%); }
.facility-index__rows { display: grid; gap: 8px; }
.facility-row { display: grid; grid-template-columns: 42px minmax(220px, 1.5fr) minmax(150px, .8fr) auto 20px; align-items: center; gap: 14px; padding: 14px; border: 1px solid transparent; border-radius: var(--ui-radius); color: inherit; text-decoration: none; transition: background var(--oe-motion-fast), border-color var(--oe-motion-fast); }
.facility-row:hover { border-color: var(--ui-border-accented); background: var(--ui-bg-muted); }
.facility-row__icon { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid var(--ui-border); border-radius: 11px; background: var(--ui-bg-muted); color: var(--ui-text-highlighted); }
.facility-row__identity, .facility-row__meta { display: grid; gap: 3px; min-width: 0; }
.facility-row__identity strong, .facility-row__identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.facility-row__identity strong { color: var(--ui-text-highlighted); }
.facility-row__identity small, .facility-row__meta { color: var(--ui-text-muted); font-size: 12px; }
.facility-row__meta code { overflow: hidden; text-overflow: ellipsis; }
.facility-row__arrow { color: var(--ui-text-muted); }
.facility-index__empty { display: grid; place-items: center; gap: 10px; min-height: 280px; text-align: center; }
.facility-index__empty > .iconify { width: 34px; height: 34px; color: var(--ui-text-muted); }
.facility-index__empty h3, .facility-index__empty p { margin: 0; }
.facility-index__empty p { color: var(--ui-text-muted); }
.facility-form { display: grid; gap: 18px; }
.facility-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
@media (max-width: 780px) {
  .facility-index__summary, .facility-form__grid { grid-template-columns: 1fr; }
  .facility-index__toolbar { align-items: stretch; flex-direction: column; }
  .facility-index__toolbar > :last-child { width: 100%; }
  .facility-row { grid-template-columns: 42px minmax(0, 1fr) auto; }
  .facility-row__meta { display: none; }
  .facility-row > .badge { display: none; }
}
</style>
