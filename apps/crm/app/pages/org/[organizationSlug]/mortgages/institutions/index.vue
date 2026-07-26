<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'organization'],
  path: '/org/:organizationSlug/settings/institutions',
  alias: ['/org/:organizationSlug/mortgages/institutions'],
})
useHead({ title: 'Instytucje — ustawienia administracyjne — OpenExpert' })

type BankOverride = {
  id: string
  is_enabled: boolean
  custom_name: string | null
  custom_website_url: string | null
  logo_path: string | null
  notes: string | null
  revision: number
  updated_at: string
}

type Bank = {
  id: string
  slug: string
  name: string
  baseName: string
  websiteUrl: string
  baseWebsiteUrl: string
  baseLogoUrl: string | null
  logoBackground: string | null
  isEnabled: boolean
  logoUrl: string | null
  productCount: number
  override: BankOverride | null
}

type Payload = {
  banks: Bank[]
  role: 'admin' | 'expert'
  superAdmin: boolean
}

const route = useRoute()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const institutionsPath = computed(() => `/org/${organizationSlug.value}/settings/institutions`)
const productsPath = computed(() => `/org/${organizationSlug.value}/settings/products`)
const mortgagesPath = computed(() => `/org/${organizationSlug.value}/mortgages`)
const apiBase = computed(() => `/api/org/${organizationSlug.value}/mortgages/banks`)

const search = ref('')
const visibilityFilter = ref<'all' | 'enabled' | 'hidden'>('all')
const sourceFilter = ref<'all' | 'custom' | 'source'>('all')

const visibilityItems = [
  { label: 'Wszystkie statusy', value: 'all' },
  { label: 'Widoczne', value: 'enabled' },
  { label: 'Ukryte', value: 'hidden' },
]

const sourceItems = [
  { label: 'Wszystkie dane', value: 'all' },
  { label: 'Ze zmianami', value: 'custom' },
  { label: 'Dane źródłowe', value: 'source' },
]

const tabs = computed(() => [
  { label: 'Instytucje', to: institutionsPath.value, icon: 'i-lucide-landmark' },
  { label: 'Produkty', to: productsPath.value, icon: 'i-lucide-package-search' },
])

const { data, status, error, refresh } = await useFetch<Payload>(apiBase, {
  default: () => ({ banks: [], role: 'expert' as const, superAdmin: false }),
})

const pending = computed(() => status.value === 'pending')
const isSuperAdmin = computed(() => data.value.superAdmin)
const visibleBanks = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('pl')

  return data.value.banks.filter((bank) => {
    const matchesSearch = !query || [
      bank.name,
      bank.baseName,
      bank.slug,
      bank.websiteUrl,
    ].some(value => String(value ?? '').toLocaleLowerCase('pl').includes(query))
    const matchesVisibility = visibilityFilter.value === 'all'
      || (visibilityFilter.value === 'enabled' && bank.isEnabled)
      || (visibilityFilter.value === 'hidden' && !bank.isEnabled)
    const matchesSource = sourceFilter.value === 'all'
      || (sourceFilter.value === 'custom' && Boolean(bank.override))
      || (sourceFilter.value === 'source' && !bank.override)

    return matchesSearch && matchesVisibility && matchesSource
  })
})

const visibleCountLabel = computed(() => {
  const count = visibleBanks.value.length
  if (count === 1) return 'instytucja'
  if (count >= 2 && count <= 4) return 'instytucje'
  return 'instytucji'
})

function initials(name: string) {
  return name.split(/\s+/u).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function profilePath(bankId: string) {
  return `${institutionsPath.value}/${encodeURIComponent(bankId)}`
}

function clearFilters() {
  search.value = ''
  visibilityFilter.value = 'all'
  sourceFilter.value = 'all'
}
</script>

<template>
  <CrmShell
    title="Instytucje"
    eyebrow="Ustawienia administracyjne"
    description="Katalog instytucji finansowych i produktów dostępnych w organizacji."
    :tabs="tabs"
  >
    <template #actions>
      <UButton
        :to="mortgagesPath"
        color="neutral"
        variant="outline"
        icon="i-lucide-calculator"
      >
        Porównywarka
      </UButton>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="outline"
        square
        :loading="pending"
        aria-label="Odśwież instytucje"
        title="Odśwież"
        @click="refresh()"
      />
    </template>

    <UAlert
      v-if="error"
      class="institution-state"
      color="error"
      variant="subtle"
      icon="i-lucide-database"
      title="Nie udało się pobrać instytucji"
      description="Sprawdź połączenie i spróbuj ponownie."
    >
      <template #actions>
        <UButton variant="ghost" icon="i-lucide-refresh-cw" @click="refresh()">Ponów</UButton>
      </template>
    </UAlert>

    <UAlert
      v-else-if="!pending && !isSuperAdmin"
      class="institution-state"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Panel tylko dla SuperAdmina"
      description="Edycja instytucji finansowych wymaga globalnej roli SuperAdmin."
    />

    <template v-else>
      <div class="institution-content">
      <section class="organization-notice" aria-label="Zakres ustawień">
        <UIcon name="i-lucide-building-2" />
        <div>
          <strong>Ustawienia obowiązują tylko w tej organizacji</strong>
          <p>Zmiana widoczności instytucji wpływa na wszystkie jej produkty w porównywarce. Dane globalne pozostają bez zmian.</p>
        </div>
      </section>

      <div class="institution-toolbar">
        <UInput
          v-model="search"
          class="institution-toolbar__search"
          icon="i-lucide-search"
          placeholder="Szukaj po nazwie, kodzie lub adresie"
          aria-label="Szukaj instytucji"
        />
        <USelect
          v-model="visibilityFilter"
          :items="visibilityItems"
          aria-label="Filtruj według widoczności"
        />
        <USelect
          v-model="sourceFilter"
          :items="sourceItems"
          aria-label="Filtruj według źródła danych"
        />
        <span class="institution-toolbar__count">
          {{ visibleBanks.length }} {{ visibleCountLabel }}
        </span>
      </div>

      <div v-if="pending && !data.banks.length" class="institution-skeleton">
        <USkeleton class="h-14 w-full" />
        <USkeleton v-for="index in 5" :key="index" class="h-20 w-full" />
      </div>

      <section
        v-else-if="visibleBanks.length"
        class="institution-register"
        aria-label="Rejestr instytucji finansowych"
      >
        <div class="institution-register__head" aria-hidden="true">
          <span>Instytucja</span>
          <span>Produkty</span>
          <span>Widoczność</span>
          <span>Dane organizacji</span>
          <span>Strona</span>
          <span />
        </div>

        <NuxtLink
          v-for="bank in visibleBanks"
          :key="bank.id"
          :to="profilePath(bank.id)"
          class="institution-register__row"
        >
          <span class="institution-register__identity">
            <span
              class="institution-logo"
              :style="bank.logoBackground ? { backgroundColor: bank.logoBackground } : undefined"
            >
              <img v-if="bank.logoUrl" :src="bank.logoUrl" :alt="`Logo ${bank.name}`">
              <span v-else>{{ initials(bank.name) }}</span>
            </span>
            <span>
              <strong>{{ bank.name }}</strong>
              <small>{{ bank.slug }}</small>
            </span>
          </span>
          <span class="institution-register__details">
            <span class="institution-register__products" data-label="Produkty">
              <strong>{{ bank.productCount }}</strong>
              <small>{{ bank.productCount === 1 ? 'produkt' : 'produktów' }}</small>
            </span>
            <span class="institution-register__field" data-label="Widoczność">
              <UBadge :color="bank.isEnabled ? 'success' : 'warning'" variant="subtle">
                {{ bank.isEnabled ? 'Widoczna' : 'Ukryta' }}
              </UBadge>
            </span>
            <span class="institution-register__field" data-label="Dane organizacji">
              <UBadge v-if="bank.override" color="primary" variant="outline">
                Zmienione · r{{ bank.override.revision }}
              </UBadge>
              <span v-else class="institution-register__muted">Dane źródłowe</span>
            </span>
            <span class="institution-register__website" data-label="Strona">
              {{ bank.websiteUrl || 'Brak adresu' }}
            </span>
          </span>
          <span class="institution-register__open" aria-hidden="true">
            <UIcon name="i-lucide-chevron-right" />
          </span>
        </NuxtLink>
      </section>

      <section v-else class="institution-empty">
        <UIcon name="i-lucide-search-x" />
        <h2>Nie znaleziono instytucji</h2>
        <p>Zmień wyszukiwaną frazę lub wyczyść filtry rejestru.</p>
        <UButton color="neutral" variant="outline" @click="clearFilters">Wyczyść filtry</UButton>
      </section>
      </div>
    </template>
  </CrmShell>
</template>

<style scoped>
.institution-state { margin-bottom: 18px; }
.institution-content { container-name: institution-content; container-type: inline-size; }
.organization-notice { display: flex; align-items: flex-start; gap: 14px; padding: 17px 19px; margin-bottom: 18px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.organization-notice > svg { flex: 0 0 auto; width: 21px; height: 21px; margin-top: 1px; color: var(--ui-primary); }
.organization-notice strong { font-size: 14px; }
.organization-notice p { max-width: 860px; margin: 4px 0 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.5; }
.institution-toolbar { display: grid; grid-template-columns: minmax(260px, 1fr) 180px 180px auto; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--ui-border); border-bottom: 0; border-radius: var(--ui-radius) var(--ui-radius) 0 0; background: var(--ui-bg); }
.institution-toolbar__search { width: 100%; }
.institution-toolbar__count { padding: 0 8px; color: var(--ui-text-muted); font-size: 12px; font-weight: 650; white-space: nowrap; }
.institution-skeleton { display: grid; gap: 1px; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 0 0 var(--ui-radius) var(--ui-radius); }
.institution-register { overflow: hidden; border: 1px solid var(--ui-border); border-radius: 0 0 var(--ui-radius) var(--ui-radius); background: var(--ui-bg); }
.institution-register__head, .institution-register__row { display: grid; grid-template-columns: minmax(260px, 1.45fr) minmax(88px, .45fr) minmax(116px, .6fr) minmax(160px, .8fr) minmax(180px, 1fr) 44px; align-items: center; gap: 18px; }
.institution-register__head { min-height: 42px; padding: 0 18px; border-bottom: 1px solid var(--ui-border); color: var(--ui-text-muted); background: var(--ui-bg-muted); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.institution-register__row { min-height: 76px; padding: 11px 18px; border-top: 1px solid var(--ui-border); color: var(--ui-text-toned); text-decoration: none; transition: background-color var(--oe-motion-fast), box-shadow var(--oe-motion-fast); }
.institution-register__row:first-of-type { border-top: 0; }
.institution-register__row:hover { background: var(--ui-bg-muted); box-shadow: inset 3px 0 0 var(--ui-primary); }
.institution-register__identity { display: flex; align-items: center; gap: 13px; min-width: 0; }
.institution-register__identity > span:last-child, .institution-register__products, .institution-register__field, .institution-register__website { display: grid; min-width: 0; }
.institution-register__details { display: contents; }
.institution-register__identity strong, .institution-register__identity small, .institution-register__website { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.institution-register__identity strong { color: var(--ui-text-highlighted); font-size: 14px; }
.institution-register__identity small, .institution-register__products small { color: var(--ui-text-muted); font-size: 11px; }
.institution-register__products strong { color: var(--ui-text-highlighted); font-size: 14px; }
.institution-register__website, .institution-register__muted { color: var(--ui-text-muted); font-size: 12px; }
.institution-register__open { display: grid; place-items: center; width: 44px; height: 44px; color: var(--ui-text-muted); }
.institution-logo { display: grid; place-items: center; flex: 0 0 auto; width: 48px; height: 48px; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 11px; color: var(--ui-color-neutral-900); background: white; font-size: 11px; font-weight: 750; }
.institution-logo img { width: 100%; height: 100%; padding: 7px; object-fit: contain; }
.institution-empty { display: grid; place-items: center; min-height: 290px; padding: 36px; border: 1px dashed var(--ui-border-accented); border-radius: 0 0 var(--ui-radius) var(--ui-radius); background: var(--ui-bg); text-align: center; }
.institution-empty > svg { width: 34px; height: 34px; margin-bottom: 10px; color: var(--ui-text-muted); }
.institution-empty h2, .institution-empty p { margin: 0; }
.institution-empty h2 { font-size: 19px; }
.institution-empty p { margin: 6px 0 16px; color: var(--ui-text-muted); font-size: 13px; }
@container institution-content (max-width: 980px) {
  .institution-register { display: grid; gap: 10px; overflow: visible; border: 0; background: transparent; }
  .institution-register__head { display: none; }
  .institution-register__row {
    grid-template-columns: minmax(0, 1fr) 44px;
    gap: 14px;
    min-height: 0;
    padding: 15px;
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius);
    background: var(--ui-bg);
  }
  .institution-register__row:first-of-type { border-top: 1px solid var(--ui-border); }
  .institution-register__identity { grid-column: 1; grid-row: 1; }
  .institution-register__details {
    display: grid;
    grid-column: 1 / -1;
    grid-row: 2;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 18px;
    padding-top: 12px;
    border-top: 1px solid var(--ui-border-muted);
  }
  .institution-register__details > span { align-content: start; gap: 4px; min-width: 0; }
  .institution-register__details > span::before {
    content: attr(data-label);
    color: var(--ui-text-dimmed);
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
  }
  .institution-register__website { overflow: visible; text-overflow: clip; white-space: normal; overflow-wrap: anywhere; }
  .institution-register__open { grid-column: 2; grid-row: 1; }
}
@container institution-content (max-width: 820px) {
  .institution-toolbar { grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--ui-border); border-radius: var(--ui-radius); }
  .institution-toolbar__search { grid-column: 1 / -1; }
  .institution-toolbar__count { justify-self: end; }
  .institution-register { margin-top: 12px; border-radius: var(--ui-radius); }
}
@container institution-content (max-width: 540px) {
  .institution-toolbar { grid-template-columns: 1fr; }
  .institution-toolbar__search { grid-column: 1; }
  .institution-toolbar__count { justify-self: start; }
  .organization-notice { padding: 15px; }
  .institution-register__row { padding: 11px 13px; }
  .institution-register__details { grid-template-columns: 1fr; }
  .institution-logo { width: 44px; height: 44px; }
}
</style>
