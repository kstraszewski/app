<script setup lang="ts">
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({
  middleware: ['auth', 'organization'],
  path: '/org/:organizationSlug/settings/institutions/:bankId',
  alias: ['/org/:organizationSlug/mortgages/institutions/:bankId'],
})

type ChecklistItem = {
  code: string
  label: string
  category: string
  itemKind: string
  scope: string
  stage: string
  applicability: string
  evidence: string
  required: boolean
  multiple: boolean
  allowedMimeTypes: string[]
  templateId: string | null
  notes: string | null
}

type VersionSummary = {
  id: string
  revision: number
  lifecycleStatus: string
  validFrom: string | null
  validTo: string | null
  dataStatus: string | null
  completenessScore: number | null
  interestType: string | null
  fixedRatePct: number | null
  fixedPeriodMonths: number | null
  marginPct: number | null
  referenceRateCode: string | null
  referenceRatePct: number | null
  referenceRateAsOf: string | null
  representativeAprPct: number | null
  unknownFields: string[]
  checklistCount: number
  costRuleCount: number
  requirementRuleCount: number
  publishedAt: string | null
  retiredAt: string | null
  retrievedAt: string | null
  updatedAt: string | null
}

type OfferSummary = {
  id: string
  code: string
  slug: string
  name: string
  baseName: string
  category: string
  distributionChannel: string
  isActive: boolean
  organizationEnabled: boolean
  liveInCalculator: boolean
  publicationStatus: 'draft' | 'published' | 'archived'
  hasPublishedVersion: boolean
  hasDraft: boolean
  revision: number
  archivedAt: string | null
  createdAt: string | null
  updatedAt: string | null
  currentVersion: VersionSummary | null
  versions: VersionSummary[]
  publishedChecklist: ChecklistItem[]
  draft: null | {
    id: string
    revision: number
    baseVersionId: string | null
    validationIssueCount: number
    updatedAt: string | null
    configuration: {
      checklist: ChecklistItem[]
      sourceCount: number
      costCount: number
      unknownCostCount: number
      ratePhaseCount: number
      marginModifierCount: number
      featureCount: number
      variantCount: number
      hasBridgeInsurance: boolean
    }
  }
  sourceCount: number
  organizationOverride: null | {
    id: string
    revision: number
    isEnabled: boolean
    customName: string | null
    notes: string | null
    updatedAt: string | null
  }
}

type BankSource = {
  id: string
  productId: string | null
  productName: string | null
  title: string
  url: string | null
  kind: string
  mimeType: string | null
  sha256: string | null
  retrievedAt: string | null
  publishedAt: string | null
  retrievalStatus: string
  extractionStatus: string
  errorMessage: string | null
  links: Array<{
    productVersionId: string
    productId: string | null
    productName: string | null
    versionNumber: number | null
    role: string
  }>
}

type BankProfilePayload = {
  superAdmin: boolean
  bank: {
    id: string
    slug: string
    name: string
    baseName: string
    websiteUrl: string | null
    baseWebsiteUrl: string | null
    logoUrl: string | null
    baseLogoUrl: string | null
    logoBackground: string | null
    isEnabled: boolean
    notes: string | null
    createdAt: string | null
    updatedAt: string | null
    override: null | {
      id: string
      revision: number
      isEnabled: boolean
      customName: string | null
      customWebsiteUrl: string | null
      hasCustomLogo: boolean
      notes: string | null
      createdAt: string | null
      updatedAt: string | null
    }
  }
  metrics: {
    offers: number
    publishedOffers: number
    liveOffers: number
    draftOffers: number
    archivedOffers: number
    versions: number
    sourceDocuments: number
    reviewedSourceDocuments: number
    publishedChecklistItems: number
    draftChecklistItems: number
    unknownFields: number
    averageCompleteness: number | null
  }
  offers: OfferSummary[]
  sources: BankSource[]
  history: Array<{
    id: string
    revision: number
    action: string
    isEnabled: boolean
    customName: string | null
    customWebsiteUrl: string | null
    notes: string | null
    createdAt: string | null
    actor: null | { id: string, name: string | null, email: string | null }
  }>
}

const route = useRoute()
const toast = useToast()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const bankId = computed(() => String(route.params.bankId ?? ''))
const apiPath = computed(() => `/api/org/${organizationSlug.value}/mortgages/banks/${encodeURIComponent(bankId.value)}`)
const institutionsPath = computed(() => `/org/${organizationSlug.value}/settings/institutions`)
const productsPath = computed(() => `/org/${organizationSlug.value}/settings/products`)
const settingsProfilePath = computed(() => `${institutionsPath.value}/${encodeURIComponent(bankId.value)}`)
const mortgageProfilePath = computed(() => `/org/${organizationSlug.value}/mortgages/institutions/${encodeURIComponent(bankId.value)}`)
const profilePath = computed(() => (
  route.path === mortgageProfilePath.value
    ? mortgageProfilePath.value
    : settingsProfilePath.value
))
const productsViewPath = computed(() => `${profilePath.value}?view=products`)
const checklistsPath = computed(() => `${profilePath.value}?view=checklists`)
const pdfTemplatesPath = computed(() => `${profilePath.value}?view=templates`)
const sourcesPath = computed(() => `${profilePath.value}?view=sources`)
const settingsPath = computed(() => `${profilePath.value}?view=settings`)
const historyPath = computed(() => `${profilePath.value}?view=history`)
const createOfferPath = computed(() => `${productsPath.value}?createBank=${encodeURIComponent(bankId.value)}`)

type InstitutionView = 'products' | 'checklists' | 'templates' | 'sources' | 'settings' | 'history'

const legacyHashViews: Record<string, InstitutionView> = {
  '#bank-offers': 'products',
  '#bank-checklists': 'checklists',
  '#bank-templates': 'templates',
  '#bank-sources': 'sources',
  '#bank-settings': 'settings',
  '#bank-history': 'history',
}

function institutionView(value: unknown): InstitutionView | null {
  if (
    value === 'products'
    || value === 'checklists'
    || value === 'templates'
    || value === 'sources'
    || value === 'settings'
    || value === 'history'
  ) {
    return value
  }

  return null
}

const activeView = computed<InstitutionView>(() => {
  const requestedView = Array.isArray(route.query.view)
    ? route.query.view[0]
    : route.query.view

  return institutionView(requestedView) ?? 'products'
})
const settingsView = computed(() => activeView.value === 'settings')
const historyView = computed(() => activeView.value === 'history')

const { data, status, error, refresh } = await useFetch<BankProfilePayload>(apiPath)
const bank = computed(() => data.value?.bank ?? null)
const metrics = computed(() => data.value?.metrics ?? null)
const offers = computed(() => data.value?.offers ?? [])
const sources = computed(() => data.value?.sources ?? [])
const history = computed(() => data.value?.history ?? [])
const checklistOffers = computed(() => offers.value.filter(offer => (
  offer.publishedChecklist.length || offer.draft?.configuration.checklist.length
)))
const tabs = computed(() => [
  {
    label: 'Produkty',
    to: productsViewPath.value,
    icon: 'i-lucide-badge-percent',
    count: offers.value.length,
  },
  {
    label: 'Checklisty',
    to: checklistsPath.value,
    icon: 'i-lucide-list-checks',
    count: metrics.value?.publishedChecklistItems ?? 0,
  },
  {
    label: 'Szablony PDF',
    to: pdfTemplatesPath.value,
    icon: 'i-lucide-file-json-2',
  },
  {
    label: 'Źródła',
    to: sourcesPath.value,
    icon: 'i-lucide-files',
    count: sources.value.length,
  },
  {
    label: 'Ustawienia',
    to: settingsPath.value,
    icon: 'i-lucide-settings-2',
  },
  {
    label: 'Historia',
    to: historyPath.value,
    icon: 'i-lucide-history',
    count: history.value.length,
  },
])
const expandedChecklists = ref<string[]>([])
const saving = ref(false)
const uploading = ref(false)
const removingLogo = ref(false)
const resetting = ref(false)
const refreshing = ref(false)
const resetArmed = ref(false)
const logoFile = ref<File | null>(null)
const failedLogoUrls = ref<Set<string>>(new Set())
const hasCustomLogo = computed(() => Boolean(bank.value?.override?.hasCustomLogo))
const displayedLogoUrl = computed(() => firstAvailableImageSource(
  [bank.value?.logoUrl, bank.value?.baseLogoUrl],
  failedLogoUrls.value,
))
const settingsForm = reactive({
  is_enabled: true,
  custom_name: '',
  custom_website_url: '',
  notes: '',
})

useHead(() => ({ title: `${bank.value?.name ?? 'Profil instytucji'} — OpenExpert` }))

onMounted(() => {
  watch(
    () => route.fullPath,
    () => {
      const requestedView = Array.isArray(route.query.view)
        ? route.query.view[0]
        : route.query.view
      const canonicalView = institutionView(requestedView)
        ?? legacyHashViews[route.hash]
        ?? 'products'
      const canonicalQuery = typeof route.query.view === 'string'
        && requestedView === canonicalView
        && Object.keys(route.query).length === 1

      if (route.path === profilePath.value && canonicalQuery && !route.hash) return

      void navigateTo({
        path: profilePath.value,
        query: { view: canonicalView },
      }, { replace: true })
    },
    { immediate: true },
  )
})

function initials(name: string) {
  return name.split(/\s+/u).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function handleLogoError(event: Event) {
  const image = event.currentTarget as HTMLImageElement | null
  failedLogoUrls.value = withFailedImageSource(
    failedLogoUrls.value,
    image?.getAttribute('src'),
  )
}

function loadSettingsForm() {
  if (!bank.value) return
  settingsForm.is_enabled = bank.value.override?.isEnabled ?? true
  settingsForm.custom_name = bank.value.override?.customName ?? ''
  settingsForm.custom_website_url = bank.value.override?.customWebsiteUrl ?? ''
  settingsForm.notes = bank.value.override?.notes ?? ''
  logoFile.value = null
  resetArmed.value = false
}

function invalidateMortgageCatalog() {
  clearNuxtData(`mortgage-catalog:${organizationSlug.value}`)
}

async function refreshProfile() {
  refreshing.value = true
  try {
    await refresh()
  } finally {
    refreshing.value = false
  }
}

function armReset() {
  resetArmed.value = true
}

function cancelReset() {
  resetArmed.value = false
}

async function saveSettings() {
  if (!bank.value) return
  saving.value = true
  try {
    await $fetch(apiPath.value, {
      method: 'PATCH',
      body: {
        is_enabled: Boolean(settingsForm.is_enabled),
        custom_name: settingsForm.custom_name.trim() || null,
        custom_website_url: settingsForm.custom_website_url.trim() || null,
        notes: settingsForm.notes.trim() || null,
      },
    })
    await refresh()
    invalidateMortgageCatalog()
    toast.add({ title: 'Zapisano ustawienia instytucji', color: 'success' })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się zapisać',
      description: caught?.data?.statusMessage ?? caught?.message ?? 'Sprawdź dane formularza.',
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

async function uploadLogo() {
  if (!logoFile.value) return
  uploading.value = true
  try {
    const body = new FormData()
    body.append('logo', logoFile.value)
    await $fetch(`${apiPath.value}/logo`, { method: 'POST', body })
    logoFile.value = null
    await refresh()
    invalidateMortgageCatalog()
    toast.add({ title: 'Logo zostało zapisane', color: 'success' })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się przesłać logo',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    uploading.value = false
  }
}

async function removeLogo() {
  if (!hasCustomLogo.value) return
  removingLogo.value = true
  try {
    await $fetch(`${apiPath.value}/logo`, { method: 'DELETE' })
    await refresh()
    invalidateMortgageCatalog()
    toast.add({ title: 'Przywrócono logo źródłowe', color: 'success' })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się usunąć logo',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    removingLogo.value = false
  }
}

async function performReset() {
  if (!bank.value?.override) return
  resetting.value = true
  try {
    await $fetch(apiPath.value, { method: 'DELETE' })
    await refresh()
    invalidateMortgageCatalog()
    toast.add({ title: 'Przywrócono dane źródłowe instytucji', color: 'success' })
  } catch (caught: any) {
    toast.add({
      title: 'Nie udało się przywrócić danych',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  } finally {
    resetting.value = false
    resetArmed.value = false
  }
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return '—'
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pl-PL', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date)
}

function formatPercent(value: number | null) {
  if (value === null) return '—'
  return `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value)}%`
}

function validityLabel(version: VersionSummary | null) {
  if (!version?.validFrom && !version?.validTo) return 'Bez określonego terminu'
  if (version.validFrom && version.validTo) return `${formatDate(version.validFrom)} – ${formatDate(version.validTo)}`
  if (version.validFrom) return `Od ${formatDate(version.validFrom)}`
  return `Do ${formatDate(version.validTo)}`
}

function statusLabel(statusValue: OfferSummary['publicationStatus']) {
  return ({ draft: 'Nieopublikowana', published: 'Opublikowana', archived: 'Archiwalna' })[statusValue]
}

function statusColor(statusValue: OfferSummary['publicationStatus']): 'warning' | 'success' | 'neutral' {
  return statusValue === 'published' ? 'success' : statusValue === 'draft' ? 'warning' : 'neutral'
}

function versionStatusLabel(statusValue: string) {
  return ({ published: 'Opublikowana', retired: 'Wycofana', superseded: 'Zastąpiona', draft: 'Robocza' } as Record<string, string>)[statusValue] ?? statusValue
}

function versionStatusColor(statusValue: string): 'success' | 'warning' | 'neutral' {
  return statusValue === 'published' ? 'success' : statusValue === 'draft' ? 'warning' : 'neutral'
}

function categoryLabel(category: string) {
  return ({
    housing: 'Kredyt mieszkaniowy',
    mortgage: 'Kredyt mieszkaniowy',
    refinance: 'Refinansowanie',
    construction: 'Budowa domu',
    secured_loan: 'Pożyczka hipoteczna',
    eco: 'Oferta ekologiczna',
    family: 'Oferta rodzinna',
  } as Record<string, string>)[category] ?? category
}

function channelLabel(channel: string) {
  return ({
    all: 'Wszystkie kanały', branch: 'Oddział', broker: 'Pośrednik', online: 'Online',
    bank_public_website: 'Strona banku',
  } as Record<string, string>)[channel] ?? channel
}

function stageLabel(stage: string) {
  return ({
    analysis: 'Analiza', agreement: 'Umowa', disbursement: 'Uruchomienie',
    tranche: 'Transza', maintenance: 'Obsługa',
  } as Record<string, string>)[stage] ?? stage
}

function categoryDocumentLabel(category: string) {
  return ({
    application: 'Wniosek', identity: 'Tożsamość', income_employment: 'Dochód z etatu',
    income_business: 'Działalność', income_other: 'Inny dochód', liabilities: 'Zobowiązania',
    transaction: 'Transakcja', property_legal: 'Nieruchomość', valuation: 'Wycena',
    construction_renovation: 'Budowa i remont', refinance_discharge: 'Refinansowanie',
    insurance_security: 'Ubezpieczenia', disbursement: 'Uruchomienie',
    disclosure_privacy: 'Zgody i informacje', other: 'Inne',
  } as Record<string, string>)[category] ?? category
}

function requirementLabel(item: ChecklistItem) {
  if (item.applicability === 'conditional') return 'Warunkowy'
  if (item.applicability === 'case_requested') return 'Na żądanie'
  if (item.applicability === 'optional' || !item.required) return 'Opcjonalny'
  return 'Wymagany'
}

function requirementColor(item: ChecklistItem): 'primary' | 'warning' | 'neutral' {
  if (item.applicability === 'conditional' || item.applicability === 'case_requested') return 'warning'
  return item.required ? 'primary' : 'neutral'
}

function sourceKindLabel(kind: string) {
  return ({
    pricing_table: 'Tabela oprocentowania', product_page: 'Strona produktu',
    promotion_rules: 'Warunki promocji', general_information: 'Informacje banku',
    bank_tariff: 'Taryfa opłat', bank_terms: 'Regulamin', other: 'Inne źródło',
  } as Record<string, string>)[kind] ?? kind
}

function sourceRoleLabel(role: string) {
  return ({
    primary: 'główne', pricing: 'oprocentowanie', eligibility: 'dostępność', costs: 'koszty',
    documents: 'dokumenty', legal: 'warunki prawne', general: 'ogólne',
    representative_example: 'przykład reprezentatywny', other: 'inne',
  } as Record<string, string>)[role] ?? role
}

function extractionLabel(statusValue: string) {
  return ({ reviewed: 'Zweryfikowane', extracted: 'Odczytane', pending: 'Oczekuje', failed: 'Błąd' } as Record<string, string>)[statusValue] ?? statusValue
}

function extractionColor(statusValue: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (statusValue === 'reviewed') return 'success'
  if (statusValue === 'failed') return 'error'
  if (statusValue === 'pending') return 'warning'
  return 'neutral'
}

function historyActionLabel(action: string) {
  return ({ created: 'Utworzono ustawienia', updated: 'Zmieniono ustawienia', reset: 'Przywrócono dane źródłowe' } as Record<string, string>)[action] ?? action
}

function offerPath(offerId: string) {
  return `${productsPath.value}/${encodeURIComponent(offerId)}`
}

function offerDocumentsPath(offerId: string) {
  return `${offerPath(offerId)}?step=documents`
}

function checklistKey(offerId: string, kind: 'published' | 'draft') {
  return `${offerId}:${kind}`
}

function checklistExpanded(key: string) {
  return expandedChecklists.value.includes(key)
}

function visibleChecklist(items: ChecklistItem[], key: string) {
  return checklistExpanded(key) ? items : items.slice(0, 6)
}

function toggleChecklist(key: string) {
  expandedChecklists.value = checklistExpanded(key)
    ? expandedChecklists.value.filter(item => item !== key)
    : [...expandedChecklists.value, key]
}

watch(bank, loadSettingsForm, { immediate: true })
</script>

<template>
  <CrmShell
    :title="bank?.name ?? 'Instytucja'"
    eyebrow="Ustawienia administracyjne"
    description="Profil instytucji, jej produkty oraz ustawienia obowiązujące w organizacji."
    :back-to="institutionsPath"
    back-label="Wróć do instytucji"
    :tabs="tabs"
  >
    <template #actions>
      <UButton v-if="bank && activeView === 'products'" :to="createOfferPath" icon="i-lucide-plus">
        Dodaj produkt
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        square
        icon="i-lucide-refresh-cw"
        aria-label="Odśwież profil instytucji"
        title="Odśwież"
        :loading="refreshing"
        @click="refreshProfile"
      />
    </template>

    <span id="bank-offers" class="sr-only" aria-hidden="true" />
    <span id="bank-checklists" class="sr-only" aria-hidden="true" />
    <span id="bank-templates" class="sr-only" aria-hidden="true" />
    <span id="bank-sources" class="sr-only" aria-hidden="true" />
    <span id="bank-settings" class="sr-only" aria-hidden="true" />
    <span id="bank-history" class="sr-only" aria-hidden="true" />

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać profilu instytucji"
      :description="apiErrorMessage(error)"
      :actions="[{ label: 'Ponów', onClick: () => refresh() }]"
    />

    <div v-else-if="status === 'pending' || status === 'idle'" class="profile-loading">
      <USkeleton class="h-52 w-full" />
      <div class="profile-loading__metrics">
        <USkeleton v-for="index in 6" :key="index" class="h-28 w-full" />
      </div>
      <USkeleton class="h-96 w-full" />
    </div>

    <div v-else-if="bank && metrics && !settingsView && !historyView" class="bank-profile">
      <section v-if="activeView === 'products'" class="bank-hero">
        <div
          class="bank-hero__logo"
          :style="bank.logoBackground ? { backgroundColor: bank.logoBackground } : undefined"
        >
          <img
            v-if="displayedLogoUrl"
            :key="displayedLogoUrl"
            :src="displayedLogoUrl"
            :alt="`Logo ${bank.name}`"
            @error="handleLogoError"
          >
          <span v-else>{{ initials(bank.name) }}</span>
        </div>
        <div class="bank-hero__body">
          <div class="bank-hero__headline">
            <div>
              <div class="bank-hero__badges">
                <UBadge :color="bank.isEnabled ? 'success' : 'warning'" variant="subtle">
                  {{ bank.isEnabled ? 'Widoczna w organizacji' : 'Ukryta w organizacji' }}
                </UBadge>
                <UBadge v-if="bank.override" color="primary" variant="outline">
                  Ustawienia własne · r{{ bank.override.revision }}
                </UBadge>
                <UBadge v-else color="neutral" variant="outline">Dane źródłowe</UBadge>
              </div>
              <h2>{{ bank.name }}</h2>
              <p v-if="bank.name !== bank.baseName" class="bank-hero__source-name">Nazwa źródłowa: {{ bank.baseName }}</p>
            </div>
            <UButton
              v-if="bank.websiteUrl"
              :to="bank.websiteUrl"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="ghost"
              trailing-icon="i-lucide-external-link"
            >
              Strona banku
            </UButton>
          </div>
          <p v-if="bank.notes" class="bank-hero__notes">{{ bank.notes }}</p>
          <p v-else class="bank-hero__notes bank-hero__notes--empty">
            Brak notatki organizacyjnej. Możesz dodać opiekuna, zakres współpracy lub ważne ustalenia w ustawieniach banku.
          </p>
          <div class="bank-hero__meta">
            <span><UIcon name="i-lucide-building-2" />{{ bank.slug }}</span>
            <span><UIcon name="i-lucide-clock-3" />Aktualizacja {{ formatDate(bank.updatedAt, true) }}</span>
          </div>
        </div>
      </section>

      <section v-if="activeView === 'products'" class="profile-metrics" aria-label="Podsumowanie instytucji">
        <article>
          <span>Wszystkie produkty</span>
          <strong>{{ metrics.offers }}</strong>
          <small>{{ metrics.versions }} {{ metrics.versions === 1 ? 'wersja' : 'wersji' }} w historii</small>
        </article>
        <article>
          <span>W kalkulatorze</span>
          <strong>{{ metrics.liveOffers }}</strong>
          <small>{{ metrics.publishedOffers }} {{ metrics.publishedOffers === 1 ? 'opublikowana łącznie' : 'opublikowanych łącznie' }}</small>
        </article>
        <article>
          <span>Szkice</span>
          <strong>{{ metrics.draftOffers }}</strong>
          <small>Zmiany oczekujące na publikację</small>
        </article>
        <article>
          <span>Checklisty</span>
          <strong>{{ metrics.publishedChecklistItems }}</strong>
          <small v-if="metrics.draftChecklistItems">+ {{ metrics.draftChecklistItems }} pozycji w szkicach</small>
          <small v-else>Pozycje wersji opublikowanych</small>
        </article>
        <article>
          <span>Źródła</span>
          <strong>{{ metrics.sourceDocuments }}</strong>
          <small>{{ metrics.reviewedSourceDocuments }} zweryfikowanych</small>
        </article>
        <article>
          <span>Kompletność danych</span>
          <strong>{{ metrics.averageCompleteness === null ? '—' : `${metrics.averageCompleteness}%` }}</strong>
          <small>{{ metrics.unknownFields }} niewypełnionych pól</small>
        </article>
      </section>

      <section v-if="activeView === 'products'" class="profile-section">
        <div class="section-heading">
          <div>
            <span>Produkty</span>
            <h2>Produkty i wersje kalkulatora</h2>
            <p>Każdy produkt zachowuje własną stopę, koszty, warianty, checklistę i historię publikacji.</p>
          </div>
          <UButton :to="createOfferPath" icon="i-lucide-plus" variant="outline">Dodaj produkt tej instytucji</UButton>
        </div>

        <div v-if="offers.length" class="offer-cards">
          <article v-for="offer in offers" :key="offer.id" class="offer-card">
            <header class="offer-card__header">
              <div class="offer-card__identity">
                <span class="offer-card__icon"><UIcon name="i-lucide-house" /></span>
                <div>
                  <div class="offer-card__badges">
                    <UBadge v-if="offer.liveInCalculator" color="primary" variant="subtle">Aktywna dziś w kalkulatorze</UBadge>
                    <UBadge :color="statusColor(offer.publicationStatus)" variant="subtle">
                      {{ statusLabel(offer.publicationStatus) }}
                    </UBadge>
                    <UBadge v-if="offer.hasDraft" color="warning" variant="outline">Szkic r{{ offer.draft?.revision }}</UBadge>
                  </div>
                  <h3>{{ offer.name }}</h3>
                  <p>
                    {{ categoryLabel(offer.category) }} · {{ channelLabel(offer.distributionChannel) }} · {{ offer.code }}
                    <template v-if="offer.name !== offer.baseName"> · nazwa źródłowa: {{ offer.baseName }}</template>
                  </p>
                </div>
              </div>
              <UButton :to="offerPath(offer.id)" color="neutral" variant="outline" trailing-icon="i-lucide-arrow-right">
                Ustawienia produktu
              </UButton>
            </header>

            <div class="offer-card__facts">
              <div>
                <span>Oprocentowanie stałe</span>
                <strong>{{ formatPercent(offer.currentVersion?.fixedRatePct ?? null) }}</strong>
                <small v-if="offer.currentVersion?.fixedPeriodMonths">{{ offer.currentVersion.fixedPeriodMonths }} mies.</small>
                <small v-else>Brak wartości w publikacji</small>
              </div>
              <div>
                <span>Marża po okresie stałym</span>
                <strong>{{ formatPercent(offer.currentVersion?.marginPct ?? null) }}</strong>
                <small>{{ offer.currentVersion?.referenceRateCode || 'Brak indeksu referencyjnego' }}</small>
              </div>
              <div>
                <span>RRSO reprezentatywne</span>
                <strong>{{ formatPercent(offer.currentVersion?.representativeAprPct ?? null) }}</strong>
                <small>Według danych wersji</small>
              </div>
              <div>
                <span>Ważność wersji</span>
                <strong class="offer-card__fact-text">{{ validityLabel(offer.currentVersion) }}</strong>
                <small v-if="offer.currentVersion">v{{ offer.currentVersion.revision }} · {{ offer.versions.length }} {{ offer.versions.length === 1 ? 'wersja' : 'wersji' }}</small>
                <small v-else>Brak opublikowanej wersji</small>
              </div>
              <div>
                <span>Kompletność</span>
                <strong>{{ offer.currentVersion?.completenessScore === null || !offer.currentVersion ? '—' : `${offer.currentVersion.completenessScore}%` }}</strong>
                <small>{{ offer.currentVersion?.unknownFields.length ?? 0 }} niewypełnionych pól</small>
              </div>
              <div>
                <span>Dokumentacja</span>
                <strong>{{ offer.publishedChecklist.length }}</strong>
                <small>{{ offer.sourceCount }} {{ offer.sourceCount === 1 ? 'źródło' : 'źródeł' }}</small>
              </div>
            </div>

            <div v-if="offer.draft" class="offer-card__draft">
              <div>
                <UIcon name="i-lucide-pencil-ruler" />
                <span><strong>Szkic r{{ offer.draft.revision }}</strong><small>Aktualizacja {{ formatDate(offer.draft.updatedAt, true) }}</small></span>
              </div>
              <span>{{ offer.draft.configuration.costCount }} kosztów</span>
              <span>{{ offer.draft.configuration.marginModifierCount }} zmian marży</span>
              <span>{{ offer.draft.configuration.variantCount }} wariantów</span>
              <span>{{ offer.draft.configuration.checklist.length }} dokumentów</span>
              <UBadge v-if="offer.draft.configuration.hasBridgeInsurance" color="primary" variant="subtle">Pomostowe</UBadge>
              <UBadge v-if="offer.draft.validationIssueCount" color="warning" variant="subtle">
                {{ offer.draft.validationIssueCount }} uwag walidacji
              </UBadge>
            </div>

            <div v-if="offer.currentVersion?.unknownFields.length" class="offer-card__unknown">
              <span>Do uzupełnienia:</span>
              <UBadge v-for="field in offer.currentVersion.unknownFields" :key="field" color="warning" variant="outline">{{ field }}</UBadge>
            </div>

            <details v-if="offer.versions.length" class="offer-card__versions">
              <summary>
                <span><UIcon name="i-lucide-history" />Historia publikacji</span>
                <span>{{ offer.versions.length }} {{ offer.versions.length === 1 ? 'wersja' : 'wersji' }} <UIcon name="i-lucide-chevron-down" /></span>
              </summary>
              <div class="version-list">
                <div v-for="version in offer.versions" :key="version.id" class="version-row">
                  <strong>v{{ version.revision }}</strong>
                  <UBadge :color="versionStatusColor(version.lifecycleStatus)" variant="subtle">{{ versionStatusLabel(version.lifecycleStatus) }}</UBadge>
                  <span>{{ validityLabel(version) }}</span>
                  <span>Kompletność {{ version.completenessScore === null ? '—' : `${version.completenessScore}%` }}</span>
                  <small>Publikacja {{ formatDate(version.publishedAt, true) }}</small>
                </div>
              </div>
            </details>
          </article>
        </div>

        <div v-else class="section-empty">
          <UIcon name="i-lucide-package-plus" />
          <h3>Ta instytucja nie ma jeszcze produktu</h3>
          <p>Utwórz pierwszy szkic, skonfiguruj kalkulację i opublikuj go po walidacji.</p>
          <UButton :to="createOfferPath" icon="i-lucide-plus">Dodaj pierwszy produkt</UButton>
        </div>
      </section>

      <section v-if="activeView === 'checklists'" class="profile-section">
        <div class="section-heading">
          <div>
            <span>Dokumenty</span>
            <h2>Checklisty wymagane przez bank</h2>
            <p>Pozycje są przypisane do konkretnego produktu i wersji, dlatego nie tracą kontekstu wariantu kredytu.</p>
          </div>
        </div>

        <div v-if="checklistOffers.length" class="checklist-groups">
          <article v-for="offer in checklistOffers" :key="offer.id" class="checklist-group">
            <header class="checklist-group__header">
              <div>
                <h3>{{ offer.name }}</h3>
                <p>{{ offer.code }} · {{ offer.currentVersion ? `wersja v${offer.currentVersion.revision}` : 'bez publikacji' }}</p>
              </div>
              <div>
                <UBadge color="success" variant="subtle">{{ offer.publishedChecklist.length }} opublikowanych</UBadge>
                <UBadge v-if="offer.draft" color="warning" variant="subtle">{{ offer.draft.configuration.checklist.length }} w szkicu</UBadge>
                <UButton :to="offerDocumentsPath(offer.id)" color="neutral" variant="outline" size="xs" icon="i-lucide-pencil-line">
                  Edytuj checklistę
                </UButton>
              </div>
            </header>

            <div v-if="offer.publishedChecklist.length" class="checklist-variant">
              <div class="checklist-variant__title">
                <span><UIcon name="i-lucide-badge-check" />Checklista używana w kalkulatorze</span>
                <small>Opublikowana {{ formatDate(offer.currentVersion?.publishedAt ?? null) }}</small>
              </div>
              <div class="checklist-list">
                <div
                  v-for="item in visibleChecklist(offer.publishedChecklist, checklistKey(offer.id, 'published'))"
                  :key="item.code"
                  class="checklist-item"
                >
                  <span class="checklist-item__icon"><UIcon :name="item.required ? 'i-lucide-file-check-2' : 'i-lucide-file-question'" /></span>
                  <span class="checklist-item__copy">
                    <strong>{{ item.label }}</strong>
                    <small>{{ item.notes || item.code }}</small>
                  </span>
                  <span class="checklist-item__meta">
                    <UBadge color="neutral" variant="outline">{{ stageLabel(item.stage) }}</UBadge>
                    <UBadge color="neutral" variant="subtle">{{ categoryDocumentLabel(item.category) }}</UBadge>
                  </span>
                  <UBadge :color="requirementColor(item)" variant="subtle">
                    {{ requirementLabel(item) }}
                  </UBadge>
                </div>
              </div>
              <UButton
                v-if="offer.publishedChecklist.length > 6"
                color="neutral"
                variant="ghost"
                size="sm"
                :trailing-icon="checklistExpanded(checklistKey(offer.id, 'published')) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                @click="toggleChecklist(checklistKey(offer.id, 'published'))"
              >
                {{ checklistExpanded(checklistKey(offer.id, 'published')) ? 'Pokaż mniej' : `Pokaż wszystkie (${offer.publishedChecklist.length})` }}
              </UButton>
            </div>

            <details v-if="offer.draft?.configuration.checklist.length" class="draft-checklist">
              <summary>
                <span><UIcon name="i-lucide-pencil-line" />Robocza checklista · szkic r{{ offer.draft.revision }}</span>
                <UBadge color="warning" variant="subtle">{{ offer.draft.configuration.checklist.length }} pozycji</UBadge>
              </summary>
              <div class="checklist-list">
                <div
                  v-for="item in offer.draft.configuration.checklist"
                  :key="item.code"
                  class="checklist-item"
                >
                  <span class="checklist-item__icon"><UIcon :name="item.required ? 'i-lucide-file-check-2' : 'i-lucide-file-question'" /></span>
                  <span class="checklist-item__copy"><strong>{{ item.label }}</strong><small>{{ item.notes || item.code }}</small></span>
                  <span class="checklist-item__meta"><UBadge color="neutral" variant="outline">{{ stageLabel(item.stage) }}</UBadge></span>
                  <UBadge :color="requirementColor(item)" variant="subtle">{{ requirementLabel(item) }}</UBadge>
                </div>
              </div>
            </details>
          </article>
        </div>

        <div v-else class="section-empty section-empty--compact">
          <UIcon name="i-lucide-list-x" />
          <h3>Brak checklist dokumentów</h3>
          <p>Dodaj wymagania dokumentowe w edytorze konkretnego produktu.</p>
        </div>
      </section>

      <section v-if="activeView === 'sources'" class="profile-section">
        <div class="section-heading">
          <div>
            <span>Pochodzenie danych</span>
            <h2>Dokumenty i strony źródłowe</h2>
            <p>Materiały, na podstawie których zdefiniowano oprocentowanie, koszty, warunki i checklisty.</p>
          </div>
        </div>

        <div v-if="sources.length" class="source-list">
          <article v-for="source in sources" :key="source.id" class="source-item">
            <span class="source-item__icon"><UIcon name="i-lucide-file-search-2" /></span>
            <div class="source-item__body">
              <div class="source-item__title">
                <div>
                  <h3>{{ source.title }}</h3>
                  <p>{{ source.productName || 'Materiał ogólny instytucji' }} · {{ sourceKindLabel(source.kind) }}</p>
                </div>
                <UBadge :color="extractionColor(source.extractionStatus)" variant="subtle">
                  {{ extractionLabel(source.extractionStatus) }}
                </UBadge>
              </div>
              <div class="source-item__meta">
                <span><UIcon name="i-lucide-calendar-check" />Pobrano {{ formatDate(source.retrievedAt) }}</span>
                <span v-if="source.publishedAt"><UIcon name="i-lucide-calendar" />Publikacja {{ formatDate(source.publishedAt) }}</span>
                <span v-if="source.sha256" :title="source.sha256"><UIcon name="i-lucide-fingerprint" />SHA-256 potwierdzony</span>
              </div>
              <div v-if="source.links.length" class="source-item__roles">
                <UBadge v-for="link in source.links" :key="`${link.productVersionId}:${link.role}`" color="neutral" variant="outline">
                  {{ sourceRoleLabel(link.role) }}<template v-if="link.versionNumber"> · v{{ link.versionNumber }}</template>
                </UBadge>
              </div>
              <UAlert v-if="source.errorMessage" color="error" variant="subtle" :description="source.errorMessage" />
            </div>
            <UButton
              v-if="source.url"
              :to="source.url"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="ghost"
              square
              icon="i-lucide-external-link"
              :aria-label="`Otwórz źródło: ${source.title}`"
            />
          </article>
        </div>

        <div v-else class="section-empty section-empty--compact">
          <UIcon name="i-lucide-file-x-2" />
          <h3>Brak materiałów źródłowych</h3>
          <p>Źródła dodasz w zakładce Dokumenty wewnątrz edytora produktu.</p>
        </div>
      </section>

      <MortgagesInstitutionPdfTemplates
        v-if="activeView === 'templates'"
        :organization-slug="organizationSlug"
        :bank-id="bankId"
      />

    </div>

    <div v-else-if="bank && metrics && settingsView" class="bank-settings-editor">
      <section class="settings-notice" aria-label="Zakres ustawień">
        <UIcon name="i-lucide-building-2" />
        <div>
          <strong>Edytujesz ustawienia tylko dla tej organizacji</strong>
          <p>Nazwa, strona, logo i widoczność nadpisują dane źródłowe wyłącznie w bieżącym CRM.</p>
        </div>
        <UBadge v-if="bank.override" color="primary" variant="outline">
          Rewizja {{ bank.override.revision }}
        </UBadge>
        <UBadge v-else color="neutral" variant="outline">Dane źródłowe</UBadge>
      </section>

      <form class="bank-settings-form" @submit.prevent="saveSettings">
        <UCard>
          <template #header>
            <div class="settings-editor-head">
              <div>
                <span>Konfiguracja organizacji</span>
                <h2>Widoczność i dane instytucji</h2>
              </div>
              <UBadge :color="settingsForm.is_enabled ? 'success' : 'warning'" variant="subtle">
                {{ settingsForm.is_enabled ? 'Widoczna' : 'Ukryta' }}
              </UBadge>
            </div>
          </template>

          <div class="settings-form-grid">
            <UFormField
              label="Widoczna w porównywarce"
              description="Wyłączenie ukrywa wszystkie produkty tej instytucji w organizacji."
            >
              <USwitch v-model="settingsForm.is_enabled" />
            </UFormField>
            <UFormField
              label="Nazwa w organizacji"
              description="Puste pole zachowuje nazwę źródłową."
            >
              <UInput v-model="settingsForm.custom_name" :placeholder="bank.baseName" />
            </UFormField>
            <UFormField
              class="settings-form-grid__full"
              label="Strona internetowa"
              description="Puste pole zachowuje adres źródłowy."
            >
              <UInput
                v-model="settingsForm.custom_website_url"
                type="url"
                :placeholder="bank.baseWebsiteUrl || 'https://'"
                icon="i-lucide-globe"
              />
            </UFormField>
            <UFormField class="settings-form-grid__full" label="Notatka administratora">
              <UTextarea
                v-model="settingsForm.notes"
                :rows="4"
                placeholder="Np. opiekun instytucji, zakres współpracy lub źródło zmiany"
              />
            </UFormField>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="settings-editor-head">
              <div>
                <span>Identyfikacja wizualna</span>
                <h2>Logo instytucji</h2>
              </div>
              <small>PNG, JPEG lub WebP · maks. 2 MB</small>
            </div>
          </template>

          <div class="settings-logo-editor">
            <div
              class="settings-logo-preview"
              :style="bank.logoBackground ? { backgroundColor: bank.logoBackground } : undefined"
            >
              <img
                v-if="displayedLogoUrl"
                :key="displayedLogoUrl"
                :src="displayedLogoUrl"
                :alt="`Aktualne logo ${bank.name}`"
                @error="handleLogoError"
              >
              <div v-else>
                <UIcon name="i-lucide-image" />
                <span>{{ bank.logoUrl ? 'Logo jest niedostępne' : 'Brak logo' }}</span>
              </div>
            </div>
            <div class="settings-logo-upload">
              <UFileUpload
                v-model="logoFile"
                accept="image/png,image/jpeg,image/webp"
                icon="i-lucide-image-up"
                label="Wybierz lub upuść logo"
                description="Nowy plik zastąpi obecne logo po zatwierdzeniu."
                :disabled="uploading"
              />
              <div class="settings-logo-actions">
                <UButton
                  type="button"
                  icon="i-lucide-upload"
                  :disabled="!logoFile"
                  :loading="uploading"
                  @click="uploadLogo"
                >
                  Prześlij logo
                </UButton>
                <UButton
                  v-if="hasCustomLogo"
                  type="button"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  :loading="removingLogo"
                  @click="removeLogo"
                >
                  Przywróć logo źródłowe
                </UButton>
              </div>
            </div>
          </div>
        </UCard>

        <div class="settings-sticky-actions">
          <div>
            <strong>{{ metrics.offers }}</strong> {{ metrics.offers === 1 ? 'produkt' : 'produktów' }}
            <span v-if="bank.override?.updatedAt"> · aktualizacja {{ formatDate(bank.override.updatedAt, true) }}</span>
          </div>
          <UButton
            v-if="resetArmed"
            type="button"
            color="neutral"
            variant="ghost"
            @click="cancelReset"
          >
            Anuluj
          </UButton>
          <UButton
            v-if="bank.override && !resetArmed"
            type="button"
            color="error"
            variant="ghost"
            icon="i-lucide-rotate-ccw"
            @click="armReset"
          >
            Przywróć źródło
          </UButton>
          <UButton
            v-else-if="bank.override"
            type="button"
            color="error"
            icon="i-lucide-rotate-ccw"
            :loading="resetting"
            @click="performReset"
          >
            Potwierdź przywrócenie
          </UButton>
          <UButton type="submit" icon="i-lucide-save" :loading="saving">
            Zapisz ustawienia
          </UButton>
        </div>
      </form>

    </div>

    <div v-else-if="bank && metrics && historyView" class="bank-settings-editor">
      <UCard class="settings-history-card">
        <template #header>
          <div class="settings-editor-head">
            <div>
              <span>Audyt</span>
              <h2>Historia zmian</h2>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              square
              icon="i-lucide-refresh-cw"
              aria-label="Odśwież historię"
              :loading="refreshing"
              @click="refreshProfile"
            />
          </div>
        </template>
        <ol v-if="history.length" class="history-list history-list--full">
          <li v-for="entry in history" :key="entry.id">
            <span class="history-list__dot" />
            <div>
              <strong>{{ historyActionLabel(entry.action) }} · r{{ entry.revision }}</strong>
              <p>{{ entry.actor?.name || entry.actor?.email || 'SuperAdmin' }}</p>
              <small>{{ formatDate(entry.createdAt, true) }}</small>
            </div>
          </li>
        </ol>
        <div v-else class="settings-empty">Nie zapisano jeszcze zmian dla tej instytucji.</div>
      </UCard>
    </div>
  </CrmShell>
</template>

<style scoped>
.profile-loading, .bank-profile, .bank-settings-editor { display: grid; gap: 22px; min-width: 0; }
.profile-loading__metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 14px; }
.bank-hero { display: grid; grid-template-columns: 126px minmax(0, 1fr); gap: 24px; padding: 24px; overflow: hidden; border: 1px solid var(--ui-border); border-radius: calc(var(--ui-radius) * 1.35); background: linear-gradient(135deg, var(--ui-bg) 55%, var(--ui-bg-muted)); }
.bank-hero__logo { display: grid; place-items: center; width: 126px; height: 126px; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 22px; color: var(--ui-color-neutral-900); background: white; font-size: 26px; font-weight: 800; }
.bank-hero__logo img { width: 100%; height: 100%; padding: 18px; object-fit: contain; }
.bank-hero__body { display: grid; align-content: center; gap: 14px; min-width: 0; }
.bank-hero__headline { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.bank-hero__headline h2 { margin: 8px 0 0; font-size: clamp(25px, 3vw, 38px); line-height: 1.05; }
.bank-hero__badges, .offer-card__badges { display: flex; flex-wrap: wrap; gap: 7px; }
.bank-hero__source-name { margin: 6px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.bank-hero__notes { max-width: 850px; margin: 0; color: var(--ui-text-toned); line-height: 1.55; }
.bank-hero__notes--empty { color: var(--ui-text-muted); }
.bank-hero__meta { display: flex; flex-wrap: wrap; gap: 16px; color: var(--ui-text-muted); font-size: 12px; }
.bank-hero__meta span { display: inline-flex; align-items: center; gap: 6px; }
.profile-metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
.profile-metrics article { display: grid; gap: 5px; min-width: 0; padding: 17px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.profile-metrics span, .section-heading > div > span { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.profile-metrics strong { font-size: 28px; line-height: 1; }
.profile-metrics small { overflow: hidden; color: var(--ui-text-muted); font-size: 11px; text-overflow: ellipsis; }
.profile-section { display: grid; gap: 16px; min-width: 0; }
.section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding: 10px 2px 3px; }
.section-heading h2 { margin: 5px 0 0; font-size: 25px; }
.section-heading p { max-width: 760px; margin: 5px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.offer-cards, .checklist-groups, .source-list { display: grid; gap: 13px; }
.offer-card, .checklist-group, .source-item { min-width: 0; overflow: hidden; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.offer-card__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 18px; border-bottom: 1px solid var(--ui-border); }
.offer-card__identity { display: flex; gap: 13px; min-width: 0; }
.offer-card__icon { display: grid; place-items: center; flex: 0 0 auto; width: 44px; height: 44px; border-radius: 12px; color: var(--ui-primary); background: var(--ui-bg-muted); }
.offer-card__identity h3 { margin: 7px 0 0; font-size: 18px; }
.offer-card__identity p { margin: 3px 0 0; color: var(--ui-text-muted); font-size: 12px; }
.offer-card__facts { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); }
.offer-card__facts > div { display: grid; align-content: start; gap: 5px; min-width: 0; padding: 16px 18px; border-right: 1px solid var(--ui-border); }
.offer-card__facts > div:last-child { border-right: 0; }
.offer-card__facts span { color: var(--ui-text-muted); font-size: 10px; font-weight: 700; text-transform: uppercase; }
.offer-card__facts strong { font-size: 19px; }
.offer-card__facts small { overflow: hidden; color: var(--ui-text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.offer-card__facts .offer-card__fact-text { font-size: 13px; line-height: 1.35; }
.offer-card__draft { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--ui-border); background: var(--ui-bg-muted); color: var(--ui-text-muted); font-size: 11px; }
.offer-card__draft > div { display: flex; align-items: center; gap: 8px; margin-right: auto; color: var(--ui-text-toned); }
.offer-card__draft > div span { display: grid; }
.offer-card__draft > div small { color: var(--ui-text-muted); }
.offer-card__draft > span { padding: 4px 7px; border: 1px solid var(--ui-border); border-radius: 7px; background: var(--ui-bg); }
.offer-card__unknown { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; padding: 11px 18px; border-top: 1px solid var(--ui-border); }
.offer-card__unknown > span { color: var(--ui-text-muted); font-size: 11px; font-weight: 700; }
.offer-card__versions { border-top: 1px solid var(--ui-border); }
.offer-card__versions summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px; color: var(--ui-text-muted); cursor: pointer; list-style: none; font-size: 11px; }
.offer-card__versions summary::-webkit-details-marker { display: none; }
.offer-card__versions summary span { display: inline-flex; align-items: center; gap: 7px; }
.offer-card__versions[open] summary { color: var(--ui-text-toned); background: var(--ui-bg-muted); }
.version-list { display: grid; padding: 0 18px 13px; }
.version-row { display: grid; grid-template-columns: 38px auto minmax(160px, 1fr) minmax(140px, auto) minmax(175px, auto); align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--ui-border); color: var(--ui-text-muted); font-size: 11px; }
.version-row strong { color: var(--ui-text-toned); }
.version-row small { text-align: right; }
.section-empty { display: grid; place-items: center; gap: 9px; min-height: 260px; padding: 32px; border: 1px dashed var(--ui-border-accented); border-radius: var(--ui-radius); background: var(--ui-bg); text-align: center; }
.section-empty--compact { min-height: 190px; }
.section-empty > svg { width: 32px; height: 32px; color: var(--ui-text-muted); }
.section-empty h3, .section-empty p { margin: 0; }
.section-empty p { color: var(--ui-text-muted); }
.checklist-group__header { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 18px; background: var(--ui-bg-muted); }
.checklist-group__header h3, .checklist-group__header p { margin: 0; }
.checklist-group__header p { margin-top: 3px; color: var(--ui-text-muted); font-size: 11px; }
.checklist-group__header > div:last-child { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.checklist-variant { display: grid; gap: 10px; padding: 16px 18px; border-top: 1px solid var(--ui-border); }
.checklist-variant__title { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.checklist-variant__title span { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; }
.checklist-variant__title small { color: var(--ui-text-muted); }
.checklist-list { display: grid; border: 1px solid var(--ui-border); border-radius: calc(var(--ui-radius) * .8); }
.checklist-item { display: grid; grid-template-columns: 34px minmax(220px, 1fr) minmax(220px, auto) auto; align-items: center; gap: 11px; padding: 11px 12px; border-top: 1px solid var(--ui-border); }
.checklist-item:first-child { border-top: 0; }
.checklist-item__icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; color: var(--ui-text-toned); background: var(--ui-bg-muted); }
.checklist-item__copy { display: grid; min-width: 0; }
.checklist-item__copy strong, .checklist-item__copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.checklist-item__copy strong { font-size: 12px; }
.checklist-item__copy small { color: var(--ui-text-muted); font-size: 10px; }
.checklist-item__meta { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.draft-checklist { border-top: 1px solid var(--ui-border); }
.draft-checklist summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; cursor: pointer; list-style: none; }
.draft-checklist summary::-webkit-details-marker { display: none; }
.draft-checklist summary > span { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; }
.draft-checklist[open] summary { border-bottom: 1px solid var(--ui-border); background: var(--ui-bg-muted); }
.draft-checklist > .checklist-list { margin: 16px 18px; }
.source-item { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: start; gap: 13px; padding: 16px; }
.source-item__icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 11px; color: var(--ui-primary); background: var(--ui-bg-muted); }
.source-item__body { display: grid; gap: 9px; min-width: 0; }
.source-item__title { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.source-item__title h3, .source-item__title p { margin: 0; }
.source-item__title h3 { font-size: 14px; }
.source-item__title p { margin-top: 3px; color: var(--ui-text-muted); font-size: 11px; }
.source-item__meta, .source-item__roles { display: flex; flex-wrap: wrap; gap: 8px 14px; }
.source-item__meta { color: var(--ui-text-muted); font-size: 11px; }
.source-item__meta span { display: inline-flex; align-items: center; gap: 5px; }
.history-list { display: grid; margin: 0; padding: 0; list-style: none; }
.history-list li { position: relative; display: flex; gap: 12px; padding: 0 0 17px; }
.history-list li:not(:last-child)::before { position: absolute; top: 9px; bottom: 0; left: 4px; width: 1px; background: var(--ui-border); content: ''; }
.history-list__dot { z-index: 1; flex: 0 0 auto; width: 9px; height: 9px; margin-top: 4px; border-radius: 99px; background: var(--ui-primary); }
.history-list strong { font-size: 12px; }
.history-list p { margin: 2px 0; color: var(--ui-text-muted); font-size: 11px; }
.history-list small, .settings-empty { color: var(--ui-text-muted); font-size: 11px; }
.settings-notice { display: flex; align-items: flex-start; gap: 14px; padding: 17px 19px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.settings-notice > svg { flex: 0 0 auto; width: 21px; height: 21px; margin-top: 1px; color: var(--ui-primary); }
.settings-notice > div { flex: 1 1 auto; }
.settings-notice strong { font-size: 14px; }
.settings-notice p { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 13px; }
.bank-settings-form { display: grid; gap: 16px; }
.settings-editor-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.settings-editor-head > div > span { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.settings-editor-head h2 { margin: 4px 0 0; font-size: 19px; }
.settings-editor-head small { color: var(--ui-text-muted); }
.settings-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.settings-form-grid :deep(input), .settings-form-grid :deep(textarea) { width: 100%; }
.settings-form-grid__full { grid-column: 1 / -1; }
.settings-logo-editor { display: grid; grid-template-columns: minmax(180px, 260px) minmax(0, 1fr); gap: 20px; }
.settings-logo-preview { display: grid; place-items: center; min-height: 180px; padding: 24px; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 12px; color: var(--ui-color-neutral-900); background: white; }
.settings-logo-preview img { width: 100%; max-height: 120px; object-fit: contain; }
.settings-logo-preview div { display: grid; place-items: center; gap: 8px; color: var(--ui-text-muted); font-size: 13px; }
.settings-logo-preview svg { width: 28px; height: 28px; }
.settings-logo-upload { display: grid; align-content: start; gap: 12px; }
.settings-logo-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.settings-sticky-actions { position: sticky; bottom: 12px; z-index: 5; display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 12px 14px; border: 1px solid var(--ui-border-accented); border-radius: var(--ui-radius); background: color-mix(in srgb, var(--ui-bg) 94%, transparent); box-shadow: 0 12px 30px rgb(0 0 0 / 9%); backdrop-filter: blur(14px); }
.settings-sticky-actions > div { margin-right: auto; color: var(--ui-text-muted); font-size: 13px; }
.settings-history-card { margin-top: 2px; }
.history-list--full li:last-child { padding-bottom: 0; }
@media (max-width: 1280px) {
  .profile-metrics, .profile-loading__metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .offer-card__facts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .offer-card__facts > div:nth-child(3) { border-right: 0; }
  .offer-card__facts > div:nth-child(n + 4) { border-top: 1px solid var(--ui-border); }
}
@media (max-width: 860px) {
  .bank-hero { grid-template-columns: 88px minmax(0, 1fr); padding: 18px; }
  .bank-hero__logo { width: 88px; height: 88px; border-radius: 17px; }
  .bank-hero__logo img { padding: 12px; }
  .bank-hero__headline, .section-heading, .offer-card__header { align-items: stretch; flex-direction: column; }
  .settings-logo-editor { grid-template-columns: 220px minmax(0, 1fr); }
  .checklist-item { grid-template-columns: 34px minmax(0, 1fr) auto; }
  .checklist-item__meta { display: none; }
  .version-row { grid-template-columns: 38px auto minmax(0, 1fr); }
  .version-row > :nth-child(4), .version-row > :nth-child(5) { display: none; }
}
@media (max-width: 620px) {
  .bank-hero { grid-template-columns: 1fr; }
  .bank-hero__logo { width: 76px; height: 76px; }
  .profile-metrics, .profile-loading__metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .offer-card__facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .offer-card__facts > div { border-top: 1px solid var(--ui-border); }
  .offer-card__facts > div:nth-child(odd) { border-right: 1px solid var(--ui-border); }
  .offer-card__facts > div:nth-child(even) { border-right: 0; }
  .checklist-group__header, .checklist-variant__title, .source-item__title { align-items: flex-start; flex-direction: column; }
  .checklist-group__header > div:last-child, .checklist-item__meta { justify-content: flex-start; }
  .checklist-item { grid-template-columns: 34px minmax(0, 1fr); }
  .checklist-item > .badge { grid-column: 2; justify-self: start; }
  .source-item { grid-template-columns: 38px minmax(0, 1fr); }
  .source-item > :last-child { grid-column: 2; justify-self: start; }
  .settings-notice, .settings-editor-head { align-items: flex-start; flex-direction: column; }
  .settings-form-grid, .settings-logo-editor { grid-template-columns: 1fr; }
  .settings-form-grid__full { grid-column: 1; }
  .settings-sticky-actions { align-items: stretch; flex-direction: column; }
  .settings-sticky-actions > div { margin-right: 0; }
}
</style>
