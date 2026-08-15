<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { MortgageOfferBankSummary, MortgageOfferSummary } from '~/types/mortgage-offer-backoffice'
import {
  extractCreatedMortgageOfferId,
  normalizeMortgageOfferBanksPayload,
} from '~/types/mortgage-offer-backoffice'
import { apiErrorMessage } from '~/utils/api-error'
import { createDefaultMortgageOfferV2 } from '~/utils/mortgage-offer-draft'

definePageMeta({
  middleware: ['auth', 'organization'],
  path: 'settings/products',
  alias: ['mortgages/offers'],
})
useHead({ title: 'Produkty kredytowe — Administracja systemu — OpenExpert' })

const route = useRoute()
const toast = useToast()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const listPath = computed(() => `/org/${organizationSlug.value}/settings/products`)
const { data: organizations } = await useOrganizations()
const isSuperAdmin = computed(() => organizations.value.access.superAdmin)

const { data: rawPayload, status, error, refresh } = await useFetch<unknown>(
  '/api/backoffice/mortgages/banks',
  { default: () => ({ data: [] }) },
)

const banks = computed(() => normalizeMortgageOfferBanksPayload(rawPayload.value))
const search = ref('')
const lifecycleFilter = ref<'all' | 'draft' | 'published' | 'archived'>('all')
const createOpen = ref(false)
const creating = ref(false)
const handledCreateBankId = ref('')

const createSchema = z.object({
  bankId: z.string().min(1, 'Wybierz instytucję.'),
  name: z.string().trim().min(3, 'Nazwa musi mieć co najmniej 3 znaki.').max(160),
  slug: z.string().trim().min(2, 'Kod jest wymagany.').max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Użyj małych liter, cyfr i myślników.'),
  category: z.enum(['mortgage', 'refinance', 'construction', 'secured_loan']),
  distributionChannel: z.enum(['all', 'branch', 'broker', 'online']),
  currency: z.literal('PLN'),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Podaj datę w formacie RRRR-MM-DD.'),
})
type CreateSchema = z.output<typeof createSchema>

const createState = reactive<CreateSchema>({
  bankId: '',
  name: '',
  slug: '',
  category: 'mortgage',
  distributionChannel: 'all',
  currency: 'PLN',
  validFrom: new Date().toISOString().slice(0, 10),
})

const bankItems = computed(() => banks.value.map(bank => ({ label: bank.name, value: bank.id })))
const categoryItems = [
  { label: 'Kredyt mieszkaniowy', value: 'mortgage' },
  { label: 'Refinansowanie', value: 'refinance' },
  { label: 'Budowa domu', value: 'construction' },
  { label: 'Pożyczka hipoteczna', value: 'secured_loan' },
]
const channelItems = [
  { label: 'Wszystkie kanały', value: 'all' },
  { label: 'Oddział', value: 'branch' },
  { label: 'Pośrednik', value: 'broker' },
  { label: 'Online', value: 'online' },
]
const lifecycleItems = [
  { label: 'Wszystkie statusy', value: 'all' },
  { label: 'Robocze', value: 'draft' },
  { label: 'Opublikowane', value: 'published' },
  { label: 'Archiwalne', value: 'archived' },
]

const filteredBanks = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('pl')
  return banks.value.map(bank => ({
    ...bank,
    offers: bank.offers.filter((offer) => {
      const matchesLifecycle = lifecycleFilter.value === 'all'
        || (lifecycleFilter.value === 'draft' && offer.hasDraft && offer.publicationStatus !== 'archived')
        || (lifecycleFilter.value === 'published' && offer.publicationStatus === 'published')
        || (lifecycleFilter.value === 'archived' && offer.publicationStatus === 'archived')
      const haystack = `${bank.name} ${offer.name} ${offer.code}`.toLocaleLowerCase('pl')
      return matchesLifecycle && (!query || haystack.includes(query))
    }),
  })).filter(bank => bank.offers.length || (!query && lifecycleFilter.value === 'all'))
})

const totalOffers = computed(() => banks.value.reduce((total, bank) => total + bank.offers.length, 0))
const publishedOffers = computed(() => banks.value.reduce(
  (total, bank) => total + bank.offers.filter(offer => offer.publicationStatus === 'published').length,
  0,
))
const draftOffers = computed(() => banks.value.reduce(
  (total, bank) => total + bank.offers.filter(offer => offer.hasDraft && offer.publicationStatus !== 'archived').length,
  0,
))

function offerPath(offerId: string) {
  return `${listPath.value}/${encodeURIComponent(offerId)}`
}

function bankPath(bankId: string) {
  return `/org/${organizationSlug.value}/settings/institutions/${encodeURIComponent(bankId)}`
}

function openCreate(bank?: MortgageOfferBankSummary) {
  Object.assign(createState, {
    bankId: bank?.id ?? banks.value[0]?.id ?? '',
    name: '',
    slug: '',
    category: 'mortgage',
    distributionChannel: 'all',
    currency: 'PLN',
    validFrom: new Date().toISOString().slice(0, 10),
  })
  createOpen.value = true
}

watch([banks, () => route.query.createBank], ([availableBanks, rawBankId]) => {
  const requestedBankId = Array.isArray(rawBankId) ? rawBankId[0] : rawBankId
  if (typeof requestedBankId !== 'string' || requestedBankId === handledCreateBankId.value) return
  const requestedBank = availableBanks.find(bank => bank.id === requestedBankId)
  if (!requestedBank) return
  handledCreateBankId.value = requestedBankId
  openCreate(requestedBank)
}, { immediate: true })

function slugFromName() {
  if (createState.slug) return
  createState.slug = createState.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('pl')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
}

async function createOffer(event: FormSubmitEvent<CreateSchema>) {
  creating.value = true
  try {
    const draftData = createDefaultMortgageOfferV2({
      currency: event.data.currency,
      validFrom: event.data.validFrom,
    })
    const response = await $fetch<unknown>(
      `/api/backoffice/mortgages/banks/${encodeURIComponent(event.data.bankId)}/offers`,
      {
        method: 'POST',
        body: {
          name: event.data.name,
          slug: event.data.slug,
          code: event.data.slug,
          category: event.data.category,
          distributionChannel: event.data.distributionChannel,
          currency: event.data.currency,
          draftData,
        },
      },
    )
    const offerId = extractCreatedMortgageOfferId(response)
    if (!offerId) throw new Error('Serwer nie zwrócił identyfikatora nowego produktu.')

    createOpen.value = false
    toast.add({
      title: 'Utworzono szkic produktu',
      description: 'Uzupełnij parametry i opublikuj wersję po sprawdzeniu kalkulacji.',
      color: 'success',
      icon: 'i-lucide-file-plus-2',
    })
    await navigateTo(offerPath(offerId))
  } catch (caught: unknown) {
    toast.add({
      title: 'Nie udało się utworzyć produktu',
      description: apiErrorMessage(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    creating.value = false
  }
}

function statusLabel(status: MortgageOfferSummary['publicationStatus']) {
  return ({ draft: 'Nieopublikowana', published: 'Opublikowana', archived: 'Archiwalna' })[status]
}

function statusColor(status: MortgageOfferSummary['publicationStatus']): 'warning' | 'success' | 'neutral' {
  return status === 'published' ? 'success' : status === 'draft' ? 'warning' : 'neutral'
}

function validityLabel(offer: MortgageOfferSummary) {
  if (!offer.validFrom && !offer.validTo) return 'Brak ustawionej ważności'
  const format = (value: string) => new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`))
  if (offer.validFrom && offer.validTo) return `${format(offer.validFrom)} – ${format(offer.validTo)}`
  if (offer.validFrom) return `od ${format(offer.validFrom)}`
  return `do ${format(offer.validTo!)}`
}
</script>

<template>
  <CrmShell
    title="Produkty kredytowe"
    eyebrow="Administracja systemu"
    description="Globalny katalog produktów, ich wersji, statusów publikacji i ustawień kalkulatora."
  >
    <template #actions>
      <UButton v-if="isSuperAdmin" icon="i-lucide-plus" @click="openCreate()">
        Dodaj produkt
      </UButton>
    </template>

    <div class="offer-catalog">
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się pobrać katalogu produktów"
        :description="apiErrorMessage(error)"
        :actions="[{ label: 'Ponów', onClick: () => refresh() }]"
      />

      <UAlert
        v-else-if="!isSuperAdmin"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Panel tylko dla SuperAdmina"
        description="Tworzenie i publikacja globalnych produktów wymagają roli SuperAdmin."
      />

      <template v-else>
        <section class="offer-catalog__metrics" aria-label="Podsumowanie katalogu">
          <article>
            <span>Instytucje</span>
            <strong>{{ banks.length }}</strong>
            <small>Z co najmniej jednym miejscem w katalogu</small>
          </article>
          <article>
            <span>Produkty</span>
            <strong>{{ totalOffers }}</strong>
            <small>Wszystkie produkty w katalogu</small>
          </article>
          <article>
            <span>Opublikowane</span>
            <strong>{{ publishedOffers }}</strong>
            <small>Widoczne dla kalkulatora</small>
          </article>
          <article>
            <span>Szkice</span>
            <strong>{{ draftOffers }}</strong>
            <small>Wymagają przeglądu lub publikacji</small>
          </article>
        </section>

        <UCard>
          <template #header>
            <div class="offer-catalog__toolbar">
              <div>
                <h2>Katalog według instytucji</h2>
                <p>Każdy produkt ma niezależny szkic, historię publikacji i pełny model kosztów.</p>
              </div>
              <div class="offer-catalog__filters">
                <UInput
                  v-model="search"
                  icon="i-lucide-search"
                  placeholder="Szukaj instytucji lub produktu"
                  aria-label="Szukaj instytucji lub produktu"
                />
                <USelect v-model="lifecycleFilter" :items="lifecycleItems" aria-label="Filtr statusu" />
              </div>
            </div>
          </template>

          <div v-if="status === 'pending' || status === 'idle'" class="offer-catalog__loading">
            <USkeleton v-for="index in 5" :key="index" class="h-28 w-full" />
          </div>

          <div v-else-if="filteredBanks.length" class="bank-groups">
            <section v-for="bank in filteredBanks" :key="bank.id" class="bank-group">
              <header class="bank-group__header">
                <NuxtLink :to="bankPath(bank.id)" class="bank-group__identity">
                  <span class="bank-group__logo">
                    <img v-if="bank.logoUrl" :src="bank.logoUrl" alt="">
                    <UIcon v-else name="i-lucide-landmark" />
                  </span>
                  <div>
                    <h3>{{ bank.name }}</h3>
                    <p>{{ bank.offers.length }} {{ bank.offers.length === 1 ? 'produkt' : 'produktów' }}</p>
                  </div>
                </NuxtLink>
                <div class="bank-group__actions">
                  <UButton
                    :to="bankPath(bank.id)"
                    icon="i-lucide-layout-dashboard"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                  >
                    Profil banku
                  </UButton>
                  <UButton
                    icon="i-lucide-plus"
                    color="neutral"
                    variant="outline"
                    size="xs"
                    @click="openCreate(bank)"
                  >
                    Dodaj produkt
                  </UButton>
                </div>
              </header>

              <div v-if="bank.offers.length" class="bank-group__offers">
                <NuxtLink
                  v-for="offer in bank.offers"
                  :key="offer.id"
                  :to="offerPath(offer.id)"
                  class="offer-row"
                >
                  <span class="offer-row__icon"><UIcon name="i-lucide-house" /></span>
                  <span class="offer-row__identity">
                    <strong>{{ offer.name }}</strong>
                    <small>{{ offer.code || 'Bez kodu produktu' }}</small>
                  </span>
                  <span class="offer-row__validity">
                    <small>Obowiązuje</small>
                    <strong>{{ validityLabel(offer) }}</strong>
                  </span>
                  <span class="offer-row__revision">
                    <small>{{ offer.hasDraft ? 'Rewizja szkicu' : 'Wersja opublikowana' }}</small>
                    <strong>{{ offer.hasDraft ? `r${offer.draftRevision}` : offer.publishedRevision ? `v${offer.publishedRevision}` : '—' }}</strong>
                  </span>
                  <span class="offer-row__statuses">
                    <UBadge v-if="offer.publicationStatus !== 'draft'" :color="statusColor(offer.publicationStatus)" variant="subtle">
                      {{ statusLabel(offer.publicationStatus) }}
                    </UBadge>
                    <UBadge v-if="offer.hasDraft && offer.publicationStatus !== 'archived'" color="warning" variant="subtle">
                      Szkic r{{ offer.draftRevision }}
                    </UBadge>
                    <UBadge v-else-if="offer.publicationStatus === 'draft'" color="warning" variant="subtle">
                      {{ statusLabel(offer.publicationStatus) }}
                    </UBadge>
                  </span>
                  <UIcon name="i-lucide-chevron-right" class="offer-row__arrow" />
                </NuxtLink>
              </div>

              <button v-else type="button" class="bank-group__empty" @click="openCreate(bank)">
                <UIcon name="i-lucide-file-plus-2" />
                <span><strong>Brak produktów</strong><small>Dodaj pierwszy produkt tej instytucji</small></span>
                <UIcon name="i-lucide-chevron-right" />
              </button>
            </section>
          </div>

          <OeEmptyState
            v-else
            :kind="totalOffers ? 'filtered' : 'empty'"
            icon="i-lucide-package-search"
            :title="totalOffers ? 'Brak pasujących produktów' : 'Katalog jest pusty'"
            :description="totalOffers
              ? 'Zmień frazę lub filtr statusu, aby zobaczyć inne produkty.'
              : 'Dodaj pierwszy produkt, aby rozpocząć konfigurację kalkulatora.'"
          >
            <template #actions>
              <UButton
                v-if="totalOffers"
                color="neutral"
                variant="outline"
                icon="i-lucide-rotate-ccw"
                @click="search = ''; lifecycleFilter = 'all'"
              >
                Wyczyść filtry
              </UButton>
              <UButton v-else icon="i-lucide-plus" @click="openCreate()">Dodaj produkt</UButton>
            </template>
          </OeEmptyState>
        </UCard>
      </template>
    </div>

    <UModal
      v-model:open="createOpen"
      title="Nowy produkt kredytowy"
      description="Najpierw utworzymy bezpieczny szkic. Publikacja nastąpi dopiero po walidacji kalkulacji."
      :ui="{ content: 'sm:max-w-2xl', footer: 'justify-end' }"
    >
      <template #body>
        <UForm
          id="mortgage-offer-create-form"
          :schema="createSchema"
          :state="createState"
          class="offer-create-form"
          @submit="createOffer"
        >
          <UFormField name="bankId" label="Instytucja" required class="sm:col-span-2">
            <USelectMenu v-model="createState.bankId" :items="bankItems" value-key="value" class="w-full" />
          </UFormField>
          <UFormField name="name" label="Nazwa produktu" required class="sm:col-span-2">
            <UInput
              v-model="createState.name"
              class="w-full"
              placeholder="np. Kredyt mieszkaniowy — wariant standardowy"
              autofocus
              @blur="slugFromName"
            />
          </UFormField>
          <UFormField name="slug" label="Kod techniczny" description="Stały identyfikator w integracjach." required>
            <UInput v-model="createState.slug" class="w-full" placeholder="kredyt-standardowy" />
          </UFormField>
          <UFormField name="currency" label="Waluta" required>
            <USelect v-model="createState.currency" :items="[{ label: 'PLN', value: 'PLN' }]" class="w-full" />
          </UFormField>
          <UFormField name="category" label="Rodzaj kredytu" required>
            <USelect v-model="createState.category" :items="categoryItems" class="w-full" />
          </UFormField>
          <UFormField name="distributionChannel" label="Kanał dystrybucji" required>
            <USelect v-model="createState.distributionChannel" :items="channelItems" class="w-full" />
          </UFormField>
          <UFormField name="validFrom" label="Ważna od" required class="sm:col-span-2">
            <UInput v-model="createState.validFrom" type="date" class="w-full" />
          </UFormField>
        </UForm>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" :disabled="creating" @click="close">Anuluj</UButton>
        <UButton
          type="submit"
          form="mortgage-offer-create-form"
          icon="i-lucide-arrow-right"
          trailing
          :loading="creating"
        >
          Utwórz i konfiguruj
        </UButton>
      </template>
    </UModal>
  </CrmShell>
</template>

<style scoped>
.offer-catalog { display: grid; gap: 22px; }
.offer-catalog__metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.offer-catalog__metrics article { display: grid; gap: 5px; padding: 18px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.offer-catalog__metrics span { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.offer-catalog__metrics strong { color: var(--ui-text-highlighted); font-size: 30px; line-height: 1; }
.offer-catalog__metrics small { color: var(--ui-text-muted); }
.offer-catalog__toolbar { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, .85fr); align-items: end; gap: 20px; min-width: 0; }
.offer-catalog__toolbar > :first-child { min-width: 0; }
.offer-catalog__toolbar h2, .offer-catalog__toolbar p { margin: 0; }
.offer-catalog__toolbar p { margin-top: 4px; color: var(--ui-text-muted); font-size: 13px; }
.offer-catalog__filters { display: grid; grid-template-columns: minmax(200px, 1fr) minmax(160px, .65fr); gap: 10px; min-width: 0; }
.offer-catalog__filters > * { min-width: 0; width: 100%; }
.offer-catalog__loading, .bank-groups { display: grid; gap: 14px; }
.bank-group { overflow: hidden; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); }
.bank-group__header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; border-bottom: 1px solid var(--ui-border); background: var(--ui-bg-muted); }
.bank-group__identity { display: flex; align-items: center; gap: 12px; min-width: 0; color: inherit; text-decoration: none; }
.bank-group__identity:hover h3 { color: var(--ui-primary); }
.bank-group__actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.bank-group__identity h3, .bank-group__identity p { margin: 0; }
.bank-group__identity p { margin-top: 2px; color: var(--ui-text-muted); font-size: 12px; }
.bank-group__logo { display: grid; place-items: center; flex: 0 0 auto; width: 42px; height: 42px; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 10px; background: var(--ui-bg); }
.bank-group__logo img { width: 82%; height: 82%; object-fit: contain; }
.bank-group__logo .iconify { width: 21px; height: 21px; color: var(--ui-text-muted); }
.bank-group__offers { display: grid; }
.offer-row { display: grid; grid-template-columns: 38px minmax(200px, 1.4fr) minmax(180px, 1fr) 100px auto 18px; align-items: center; gap: 14px; padding: 13px 16px; border-top: 1px solid var(--ui-border); color: inherit; text-decoration: none; transition: background var(--oe-motion-fast); }
.offer-row__statuses { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.offer-row:first-child { border-top: 0; }
.offer-row:hover { background: var(--ui-bg-muted); }
.offer-row__icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; color: var(--ui-text-toned); background: var(--ui-bg-elevated); }
.offer-row__identity, .offer-row__validity, .offer-row__revision { display: grid; gap: 2px; min-width: 0; }
.offer-row__identity strong, .offer-row__identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.offer-row small { color: var(--ui-text-muted); font-size: 11px; }
.offer-row__validity strong, .offer-row__revision strong { color: var(--ui-text-toned); font-size: 12px; font-weight: 600; }
.offer-row__arrow { color: var(--ui-text-muted); }
.bank-group__empty { display: flex; align-items: center; gap: 12px; width: 100%; padding: 16px; border: 0; color: var(--ui-text-muted); background: transparent; text-align: left; cursor: pointer; }
.bank-group__empty:hover { background: var(--ui-bg-muted); }
.bank-group__empty > :last-child { margin-left: auto; }
.bank-group__empty span { display: grid; gap: 2px; }
.bank-group__empty strong { color: var(--ui-text-toned); }
.bank-group__empty small { font-size: 12px; }
.offer-catalog__empty { display: grid; place-items: center; gap: 10px; min-height: 300px; text-align: center; }
.offer-catalog__empty > .iconify { width: 36px; height: 36px; color: var(--ui-text-muted); }
.offer-catalog__empty h3, .offer-catalog__empty p { margin: 0; }
.offer-catalog__empty p { color: var(--ui-text-muted); }
.offer-create-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 1100px) {
  .offer-catalog__metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .offer-catalog__toolbar { grid-template-columns: 1fr; align-items: stretch; }
  .offer-catalog__filters { width: min(100%, 680px); }
  .offer-row { grid-template-columns: 38px minmax(0, 1fr) auto 18px; }
  .offer-row__validity, .offer-row__revision { display: none; }
}
@media (max-width: 720px) {
  .offer-catalog__metrics { grid-template-columns: 1fr; }
  .offer-catalog__filters { grid-template-columns: 1fr; width: 100%; }
  .offer-row { grid-template-columns: 34px minmax(0, 1fr) 18px; padding-inline: 12px; }
  .offer-row > .badge { display: none; }
  .bank-group__header { align-items: flex-start; }
  .bank-group__actions > :first-child { display: none; }
  .offer-create-form { grid-template-columns: 1fr; }
  .offer-create-form > * { grid-column: auto !important; }
}
</style>
