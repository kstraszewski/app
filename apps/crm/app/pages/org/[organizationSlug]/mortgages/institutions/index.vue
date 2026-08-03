<script setup lang="ts">
import {
  searchInstitutions,
  type InstitutionSearchAlias,
  type InstitutionSearchMatch,
} from '~/utils/mortgage-institution-search'

definePageMeta({
  middleware: ['auth', 'organization'],
  path: 'settings/institutions',
  alias: ['mortgages/institutions'],
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
  aliases: InstitutionSearchAlias[]
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
const calculatorPath = computed(() => `/org/${organizationSlug.value}/calculator/mortgages`)
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
const searchHits = computed(() => searchInstitutions(data.value.banks, search.value))
const searchMatchByBankId = computed(() => new Map(
  searchHits.value.map(hit => [hit.item.id, hit.matchedOn]),
))
const visibleBanks = computed(() => searchHits.value
  .map(hit => hit.item)
  .filter((bank) => {
    const matchesVisibility = visibilityFilter.value === 'all'
      || (visibilityFilter.value === 'enabled' && bank.isEnabled)
      || (visibilityFilter.value === 'hidden' && !bank.isEnabled)
    const matchesSource = sourceFilter.value === 'all'
      || (sourceFilter.value === 'custom' && Boolean(bank.override))
      || (sourceFilter.value === 'source' && !bank.override)

    return matchesVisibility && matchesSource
  }))
const hasActiveFilters = computed(() => (
  Boolean(search.value.trim())
  || visibilityFilter.value !== 'all'
  || sourceFilter.value !== 'all'
))
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

function websiteHost(value: string) {
  if (!value) return 'Brak adresu'
  try {
    return new URL(value).hostname.replace(/^www\./u, '')
  } catch {
    return value.replace(/^https?:\/\/(www\.)?/u, '').replace(/\/.*$/u, '')
  }
}

function productCountLabel(count: number) {
  if (count === 1) return '1 produkt'
  return `${count} produktów`
}

function formerNames(bank: Bank) {
  return bank.aliases
    .filter(alias => alias.kind === 'former_name')
    .map(alias => alias.name)
}

function formerNamesLabel(bank: Bank) {
  const names = formerNames(bank)
  if (names.length <= 2) return names.join(' · ')
  return `${names.slice(0, 2).join(' · ')} +${names.length - 2}`
}

function searchMatchContext(match: InstitutionSearchMatch | null | undefined) {
  if (!search.value.trim() || !match || match.source === 'name') return null

  const labels: Partial<Record<InstitutionSearchMatch['source'], string>> = {
    base_name: 'Trafienie w nazwie źródłowej',
    former_name: 'Trafienie w dawnej nazwie',
    short_name: 'Trafienie po skrócie',
    legal_name: 'Trafienie w nazwie prawnej',
    former_domain: 'Trafienie w dawnej domenie',
    search_term: 'Trafienie w powiązanym haśle',
    slug: 'Trafienie po kodzie',
    website: 'Trafienie w domenie',
  }
  const label = labels[match.source]
  return label ? `${label}: ${match.label}` : null
}

function clearSearch() {
  search.value = ''
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
        :to="calculatorPath"
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
        <section class="institution-discovery" aria-labelledby="institution-search-title">
          <div class="institution-discovery__intro">
            <span class="institution-discovery__icon" aria-hidden="true">
              <UIcon name="i-lucide-search" />
            </span>
            <div>
              <span>Katalog organizacji</span>
              <h2 id="institution-search-title">Znajdź właściwą instytucję</h2>
              <p>Wyszukuj po obecnej lub dawnej nazwie, skrócie, kodzie albo domenie. Literówki też są tolerowane.</p>
            </div>
          </div>

          <div role="search" class="institution-search">
            <UInput
              v-model="search"
              class="institution-search__input"
              leading-icon="i-lucide-search"
              size="xl"
              placeholder="Np. Erste, Santander, santader lub santander.pl"
              aria-label="Szukaj instytucji"
              aria-describedby="institution-search-help"
            >
              <template #trailing>
                <UButton
                  v-if="search"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  square
                  icon="i-lucide-x"
                  aria-label="Wyczyść wyszukiwanie"
                  @click="clearSearch"
                />
              </template>
            </UInput>
            <p id="institution-search-help">
              <UIcon name="i-lucide-sparkles" aria-hidden="true" />
              Najtrafniejsze wyniki pojawią się jako pierwsze.
            </p>
          </div>

          <div class="institution-filters">
            <div class="institution-filters__fields">
              <USelect
                v-model="visibilityFilter"
                :items="visibilityItems"
                value-key="value"
                aria-label="Filtruj według widoczności"
              />
              <USelect
                v-model="sourceFilter"
                :items="sourceItems"
                value-key="value"
                aria-label="Filtruj według źródła danych"
              />
              <UButton
                v-if="hasActiveFilters"
                color="neutral"
                variant="ghost"
                icon="i-lucide-rotate-ccw"
                @click="clearFilters"
              >
                Wyczyść
              </UButton>
            </div>
            <span class="institution-filters__scope">
              <UIcon name="i-lucide-building-2" aria-hidden="true" />
              Widoczność i zmiany dotyczą tylko tej organizacji
            </span>
          </div>
        </section>

        <div class="institution-results-heading">
          <div>
            <span>Rejestr finansowy</span>
            <h2>{{ search.trim() ? 'Wyniki wyszukiwania' : 'Wszystkie instytucje' }}</h2>
          </div>
          <p aria-live="polite" aria-atomic="true">
            <strong>{{ visibleBanks.length }}</strong> {{ visibleCountLabel }}
            <template v-if="hasActiveFilters"> z {{ data.banks.length }}</template>
          </p>
        </div>

        <div v-if="pending && !data.banks.length" class="institution-skeleton" aria-label="Ładowanie instytucji">
          <USkeleton v-for="index in 6" :key="index" class="institution-skeleton__card" />
        </div>

        <ul
          v-else-if="visibleBanks.length"
          class="institution-grid"
          aria-label="Rejestr instytucji finansowych"
        >
          <li v-for="bank in visibleBanks" :key="bank.id">
            <NuxtLink
              :to="profilePath(bank.id)"
              class="institution-card"
              :class="{ 'institution-card--hidden': !bank.isEnabled }"
            >
              <article>
                <header class="institution-card__header">
                  <span
                    class="institution-logo"
                    :style="bank.logoBackground ? { backgroundColor: bank.logoBackground } : undefined"
                  >
                    <img v-if="bank.logoUrl" :src="bank.logoUrl" alt="">
                    <span v-else>{{ initials(bank.name) }}</span>
                  </span>
                  <span class="institution-card__identity">
                    <strong>{{ bank.name }}</strong>
                    <small>{{ websiteHost(bank.websiteUrl) }}</small>
                  </span>
                  <UBadge
                    :color="bank.isEnabled ? 'success' : 'warning'"
                    variant="subtle"
                    size="sm"
                    class="institution-card__status"
                  >
                    {{ bank.isEnabled ? 'Widoczna' : 'Ukryta' }}
                  </UBadge>
                </header>

                <div v-if="formerNames(bank).length" class="institution-card__history">
                  <UIcon name="i-lucide-history" aria-hidden="true" />
                  <span>
                    <small>Dawniej</small>
                    <strong>{{ formerNamesLabel(bank) }}</strong>
                  </span>
                </div>

                <div
                  v-if="searchMatchContext(searchMatchByBankId.get(bank.id))"
                  class="institution-card__match"
                >
                  <UIcon name="i-lucide-search-check" aria-hidden="true" />
                  <span>{{ searchMatchContext(searchMatchByBankId.get(bank.id)) }}</span>
                </div>

                <dl class="institution-card__facts">
                  <div>
                    <dt>
                      <UIcon name="i-lucide-package" aria-hidden="true" />
                      Produkty
                    </dt>
                    <dd>{{ productCountLabel(bank.productCount) }}</dd>
                  </div>
                  <div>
                    <dt>
                      <UIcon name="i-lucide-database" aria-hidden="true" />
                      Dane
                    </dt>
                    <dd>{{ bank.override ? `Zmiany · r${bank.override.revision}` : 'Źródłowe' }}</dd>
                  </div>
                </dl>

                <footer class="institution-card__footer">
                  <span>{{ bank.slug }}</span>
                  <strong>
                    Otwórz profil
                    <UIcon name="i-lucide-arrow-up-right" aria-hidden="true" />
                  </strong>
                </footer>
              </article>
            </NuxtLink>
          </li>
        </ul>

        <section v-else class="institution-empty">
          <span aria-hidden="true"><UIcon name="i-lucide-search-x" /></span>
          <h2>Nie znaleziono instytucji</h2>
          <p>Spróbuj innej pisowni albo wyczyść aktywne filtry.</p>
          <UButton color="neutral" variant="outline" icon="i-lucide-rotate-ccw" @click="clearFilters">
            Wyczyść filtry
          </UButton>
        </section>
      </div>
    </template>
  </CrmShell>
</template>

<style scoped>
.institution-state {
  margin-bottom: 18px;
}

.institution-content {
  container-name: institution-content;
  container-type: inline-size;
}

.institution-discovery {
  overflow: hidden;
  margin-bottom: 26px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background:
    radial-gradient(circle at 92% 0%, color-mix(in srgb, var(--ui-primary) 10%, transparent), transparent 34%),
    var(--ui-bg);
}

.institution-discovery__intro {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 21px 22px 16px;
}

.institution-discovery__icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 24%, var(--ui-border));
  border-radius: 12px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 9%, var(--ui-bg));
}

.institution-discovery__icon svg {
  width: 20px;
  height: 20px;
}

.institution-discovery__intro > div {
  min-width: 0;
}

.institution-discovery__intro > div > span,
.institution-results-heading > div > span {
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.institution-discovery h2,
.institution-discovery p,
.institution-results-heading h2,
.institution-results-heading p {
  margin: 0;
}

.institution-discovery h2 {
  margin-top: 2px;
  color: var(--ui-text-highlighted);
  font-size: 19px;
  line-height: 1.25;
}

.institution-discovery__intro p {
  max-width: 720px;
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.institution-search {
  padding: 0 22px 20px 78px;
}

.institution-search__input {
  width: 100%;
}

.institution-search > p {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--ui-text-dimmed);
  font-size: 11px;
}

.institution-search > p svg {
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  color: var(--ui-primary);
}

.institution-filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 60px;
  padding: 10px 22px;
  border-top: 1px solid var(--ui-border-muted);
  background: color-mix(in srgb, var(--ui-bg-muted) 62%, transparent);
}

.institution-filters__fields {
  display: flex;
  align-items: center;
  gap: 9px;
}

.institution-filters__fields > :deep(*) {
  min-width: 156px;
}

.institution-filters__fields > :deep(button) {
  min-width: auto;
}

.institution-filters__scope {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-muted);
  font-size: 11px;
  text-align: right;
}

.institution-filters__scope svg {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
}

.institution-results-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
  padding: 0 2px;
}

.institution-results-heading h2 {
  margin-top: 2px;
  color: var(--ui-text-highlighted);
  font-size: 18px;
}

.institution-results-heading > p {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.institution-results-heading > p strong {
  color: var(--ui-text-highlighted);
  font-size: 15px;
}

.institution-skeleton,
.institution-grid {
  display: grid;
  gap: 12px;
}

.institution-skeleton {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
}

.institution-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr));
}

.institution-skeleton__card {
  height: 230px;
  border-radius: var(--oe-radius-surface);
}

.institution-grid {
  margin: 0;
  padding: 0;
  list-style: none;
}

.institution-grid > li {
  display: flex;
  min-width: 0;
}

.institution-card {
  display: block;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  color: inherit;
  background: var(--ui-bg);
  text-decoration: none;
  transition:
    border-color var(--oe-motion-fast),
    background-color var(--oe-motion-fast),
    box-shadow var(--oe-motion-fast),
    transform var(--oe-motion-fast);
}

.institution-card:hover {
  border-color: color-mix(in srgb, var(--ui-primary) 42%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-primary) 2.5%, var(--ui-bg));
  box-shadow: 0 12px 28px color-mix(in srgb, var(--ui-color-neutral-950) 8%, transparent);
  transform: translateY(-2px);
}

.institution-card:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

.institution-card--hidden {
  background: color-mix(in srgb, var(--ui-bg-muted) 42%, var(--ui-bg));
}

.institution-card article {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: 16px;
}

.institution-card__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
}

.institution-logo {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 50px;
  height: 50px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 13px;
  color: var(--ui-color-neutral-900);
  background: white;
  font-size: 11px;
  font-weight: 750;
}

.institution-logo img {
  width: 100%;
  height: 100%;
  padding: 7px;
  object-fit: contain;
}

.institution-card__identity {
  display: grid;
  min-width: 0;
}

.institution-card__identity strong,
.institution-card__identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.institution-card__identity strong {
  color: var(--ui-text-highlighted);
  font-size: 15px;
  line-height: 1.35;
}

.institution-card__identity small {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.institution-card__status {
  justify-self: end;
  width: max-content;
}

.institution-card__history,
.institution-card__match {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 13px;
  border-radius: 10px;
}

.institution-card__history {
  padding: 10px 11px;
  border: 1px solid var(--ui-border-muted);
  background: var(--ui-bg-muted);
}

.institution-card__history > svg,
.institution-card__match > svg {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
}

.institution-card__history > svg {
  color: var(--ui-text-muted);
}

.institution-card__history > span {
  display: grid;
  min-width: 0;
}

.institution-card__history small {
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 8px;
  font-weight: 750;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.institution-card__history strong {
  overflow: hidden;
  color: var(--ui-text-toned);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.institution-card__match {
  padding: 8px 10px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 9%, transparent);
  font-size: 11px;
  font-weight: 650;
  line-height: 1.35;
}

.institution-card__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 15px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border-muted);
}

.institution-card__facts > div {
  min-width: 0;
}

.institution-card__facts dt {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .05em;
  text-transform: uppercase;
}

.institution-card__facts dt svg {
  width: 13px;
  height: 13px;
}

.institution-card__facts dd {
  overflow: hidden;
  margin: 5px 0 0;
  color: var(--ui-text-toned);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.institution-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding-top: 15px;
}

.institution-card__footer > span {
  overflow: hidden;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.institution-card__footer > strong {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
  transition: color var(--oe-motion-fast);
}

.institution-card:hover .institution-card__footer > strong {
  color: var(--ui-primary);
}

.institution-card__footer svg {
  width: 14px;
  height: 14px;
}

.institution-empty {
  display: grid;
  place-items: center;
  min-height: 290px;
  padding: 36px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
  text-align: center;
}

.institution-empty > span {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  margin-bottom: 12px;
  border-radius: 14px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
}

.institution-empty > span svg {
  width: 23px;
  height: 23px;
}

.institution-empty h2,
.institution-empty p {
  margin: 0;
}

.institution-empty h2 {
  color: var(--ui-text-highlighted);
  font-size: 19px;
}

.institution-empty p {
  margin: 6px 0 16px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

@container institution-content (max-width: 760px) {
  .institution-search {
    padding-left: 22px;
  }

  .institution-filters {
    align-items: stretch;
    flex-direction: column;
  }

  .institution-filters__scope {
    text-align: left;
  }
}

@container institution-content (max-width: 540px) {
  .institution-discovery__intro {
    padding: 17px 16px 13px;
  }

  .institution-discovery__icon {
    width: 38px;
    height: 38px;
  }

  .institution-discovery h2 {
    font-size: 17px;
  }

  .institution-search {
    padding: 0 16px 16px;
  }

  .institution-filters {
    padding: 12px 16px;
  }

  .institution-filters__fields {
    display: grid;
    grid-template-columns: 1fr;
  }

  .institution-filters__fields > :deep(*) {
    width: 100%;
    min-width: 0;
  }

  .institution-results-heading {
    align-items: flex-start;
  }

  .institution-card__header {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .institution-card__status {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
