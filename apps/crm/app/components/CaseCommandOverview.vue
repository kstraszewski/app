<script setup lang="ts">
import type {
  CaseBankApplication,
  CaseDetail,
  CaseProperty,
  MortgageApplicationStatus,
  SavedCaseOffer,
} from '~/types/cases'
import {
  calculatePropertyOfferComparison,
  getFinancingComparisonBaseline,
  type PropertyOfferComparison,
} from '~/utils/mortgage-property-comparison'

const props = defineProps<{
  caseData: CaseDetail
  activeOffer: SavedCaseOffer | null
  documentProgress: {
    satisfied: number
    verified: number
    total: number
  }
  multiformBlockers: string[]
  multiformPending?: boolean
  selectingPropertyId?: string | null
  selectingFinancingVariantKey?: string | null
  actions: {
    addOffer: () => void
    addProperty: () => void
    editProperty: (property: CaseProperty) => void
    goDocuments: () => void
    goMultiform: () => void
    openRenovation: () => void
    openInsurance: (type: 'insurance_life' | 'insurance_property') => void
    openOffer: (offer: SavedCaseOffer) => void
    openFinancingVariant: (property: CaseProperty, offer: SavedCaseOffer) => void
    selectProperty: (property: CaseProperty) => void
    addApplication: (property: CaseProperty, offer: SavedCaseOffer) => void
  }
}>()

const { orgPath } = useOrganizationContext()

const currency = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})
const shortDate = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const dateTime = new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'short',
  timeStyle: 'short',
})

const properties = computed(() => props.caseData.properties ?? [])
const offers = computed(() => props.caseData.offers ?? [])
const bankApplications = computed(() => (
  [...(props.caseData.bank_applications ?? [])].sort((left, right) => left.slot - right.slot)
))
const finalApplication = computed(() => (
  bankApplications.value.find(application => application.id === props.caseData.contract_application_id) ?? null
))
const finalOffer = computed(() => finalApplication.value ? offerForApplication(finalApplication.value) : null)
const finalProperty = computed(() => finalApplication.value ? propertyForApplication(finalApplication.value) : null)
const activeProperty = computed(() => (
  properties.value.find(property => property.id === props.caseData.selected_property_id) ?? null
))
const financingBaseline = computed(() => getFinancingComparisonBaseline(
  offers.value,
  props.caseData.selected_offer_id,
))
const financingComparisons = computed(() => {
  const baseline = financingBaseline.value
  const byProperty = new Map<string, PropertyOfferComparison[]>()
  if (!baseline) return byProperty

  for (const property of properties.value) {
    byProperty.set(property.id, offers.value.map(offer => calculatePropertyOfferComparison(
      property.id,
      {
        purchasePrice: property.price_amount,
        appraisalValue: property.appraisal_value_amount,
        currency: property.currency,
      },
      offer,
      baseline,
    )))
  }
  return byProperty
})
const items = computed(() => props.caseData.items ?? [])
const renovation = computed(() => items.value.find(item => (
  item.product_type?.code === 'credit_cash' && item.metadata?.purpose === 'renovation'
)) ?? null)
const lifeInsurance = computed(() => items.value.find(item => item.product_type?.code === 'insurance_life') ?? null)
const propertyInsurance = computed(() => items.value.find(item => item.product_type?.code === 'insurance_property') ?? null)
const propertyScenarioValue = computed(() => {
  const value = Number(props.activeOffer?.scenario_snapshot?.propertyValue ?? 0)
  return Number.isFinite(value) && value > 0 ? value : null
})
const nearestTask = computed(() => (
  [...(props.caseData.open_tasks ?? [])]
    .filter(task => task.due_at)
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))[0]
  ?? null
))
const unverifiedDocumentCount = computed(() => Math.max(
  0,
  props.documentProgress.satisfied - props.documentProgress.verified,
))
const blockerCount = computed(() => [
  !activeProperty.value,
  !finalApplication.value && !bankApplications.value.length,
  unverifiedDocumentCount.value > 0,
  props.multiformBlockers.length > 0,
].filter(Boolean).length)
const creditWorkstreamStatus = computed(() => {
  if (finalApplication.value) return 'Umowa podpisana'
  if (bankApplications.value.length) return `${bankApplications.value.length}/3 ${bankApplications.value.length === 1 ? 'wniosek' : 'wnioski'}`
  if (offers.value.length) return 'Shortlista gotowa'
  return 'Do rozpoczęcia'
})
const businessStage = computed(() => {
  if (!props.caseData.clients.length) return 'Dodawanie wnioskodawców'
  if (finalApplication.value) return 'Podpisana umowa kredytowa'
  if (!bankApplications.value.length) {
    return offers.value.length ? 'Wybór banków do wniosków' : 'Budowanie shortlisty ofert'
  }
  if (bankApplications.value.some(application => application.status_code === 'braki')) return 'Uzupełnianie braków bankowych'
  if (bankApplications.value.some(application => application.status_code === 'zaakceptowane')) return 'Wybór finalnej umowy'
  if (props.documentProgress.satisfied < props.documentProgress.total) return 'Kompletowanie dokumentów'
  if (props.documentProgress.verified < props.documentProgress.total) return 'Weryfikacja dokumentów'
  if (bankApplications.value.some(application => ['wyslane', 'w_analizie'].includes(application.status_code))) return 'Analiza wniosków przez banki'
  return 'Przygotowanie wniosków'
})

const attentionItems = computed(() => {
  const items: Array<{
    key: string
    title: string
    detail: string
    icon: string
    action: () => void
  }> = []

  if (unverifiedDocumentCount.value > 0) {
    items.push({
      key: 'documents',
      title: `Zweryfikuj ${unverifiedDocumentCount.value} ${unverifiedDocumentCount.value === 1 ? 'dokument' : 'dokumenty'}`,
      detail: nearestTask.value?.due_at ? `Termin: ${shortDate.format(new Date(nearestTask.value.due_at))}` : 'Dokumenty są załączone, ale jeszcze niezweryfikowane',
      icon: 'i-lucide-file-check-2',
      action: props.actions.goDocuments,
    })
  }

  if (!activeProperty.value) {
    const hasCandidates = properties.value.length > 0
    items.push({
      key: 'property',
      title: hasCandidates ? 'Wybierz nieruchomość do finansowania' : 'Dodaj nieruchomość',
      detail: hasCandidates
        ? `${properties.value.length} ${properties.value.length === 1 ? 'nieruchomość czeka' : 'nieruchomości czekają'} na wybór`
        : propertyScenarioValue.value
          ? `${currency.format(propertyScenarioValue.value)} ze scenariusza oferty`
          : 'Brakuje adresu i parametrów nieruchomości',
      icon: 'i-lucide-house',
      action: hasCandidates ? scrollToPropertyCandidates : props.actions.addProperty,
    })
  }

  if (!finalApplication.value && !bankApplications.value.length) {
    items.push({
      key: 'applications',
      title: offers.value.length ? 'Dodaj banki do wniosków' : 'Zbuduj shortlistę banków',
      detail: offers.value.length
        ? 'Możesz złożyć do trzech wniosków równolegle'
        : 'Zapisz oferty, które chcesz porównać',
      icon: 'i-lucide-files',
      action: offers.value.length ? scrollToPropertyCandidates : props.actions.addOffer,
    })
  }

  items.push({
    key: 'multiform',
    title: props.multiformBlockers.length ? 'Dokończ mapowanie PDF' : 'Sprawdź gotowość Multiwniosku',
    detail: props.multiformPending
      ? 'Sprawdzamy szablony formularzy'
      : props.multiformBlockers[0] ?? 'Wniosek kredytowy',
    icon: 'i-lucide-file-input',
    action: props.actions.goMultiform,
  })

  return items.slice(0, 3)
})

function money(value: number | null | undefined) {
  return value == null ? '—' : currency.format(Number(value))
}

function percent(value: number | null | undefined) {
  return value == null
    ? '—'
    : `${Number(value).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`
}

function comparisonsForProperty(propertyId: string) {
  return financingComparisons.value.get(propertyId) ?? []
}

function comparisonFor(propertyId: string | null | undefined, offerId: string) {
  if (!propertyId) return null
  return comparisonsForProperty(propertyId).find(comparison => comparison.offerId === offerId) ?? null
}

function offerForComparison(comparison: PropertyOfferComparison): SavedCaseOffer {
  const offer = offers.value.find(item => item.id === comparison.offerId)
  if (!offer) throw new Error(`Missing offer ${comparison.offerId}`)
  return offer
}

function offerForApplication(application: CaseBankApplication) {
  return offers.value.find(offer => offer.id === application.offer_id) ?? null
}

function applicationMonthlyOutflow(application: CaseBankApplication) {
  return application.first_monthly_outflow ?? offerForApplication(application)?.first_monthly_outflow ?? null
}

function propertyForApplication(application: CaseBankApplication) {
  return properties.value.find(property => property.id === application.property_id) ?? null
}

function applicationPropertyLabel(application: CaseBankApplication) {
  const property = propertyForApplication(application)
  return property ? propertyDisplayName(property) : 'Bez przypisanej nieruchomości'
}

function openApplicationOffer(application: CaseBankApplication) {
  const offer = offerForApplication(application)
  if (offer) props.actions.openOffer(offer)
}

function applicationForOffer(offer: SavedCaseOffer) {
  return bankApplications.value.find(application => application.offer_id === offer.id) ?? null
}

function applicationForBank(offer: SavedCaseOffer) {
  if (!offer.bank_id) return null
  return bankApplications.value.find(application => application.bank_id === offer.bank_id) ?? null
}

function applicationsForProperty(property: CaseProperty) {
  return bankApplications.value.filter(application => application.property_id === property.id)
}

function isApplicationVariant(property: CaseProperty, offer: SavedCaseOffer) {
  const application = applicationForOffer(offer)
  return application?.property_id === property.id
}

function isFinalVariant(property: CaseProperty, offer: SavedCaseOffer) {
  const application = applicationForOffer(offer)
  return Boolean(
    application
    && application.id === finalApplication.value?.id
    && application.property_id === property.id,
  )
}

function propertyBadge(property: CaseProperty) {
  if (finalProperty.value?.id === property.id) {
    return { label: 'Podpisana umowa', color: 'success' as const, variant: 'solid' as const }
  }

  const count = applicationsForProperty(property).length
  if (count) {
    return {
      label: `${count} ${count === 1 ? 'wniosek' : count < 5 ? 'wnioski' : 'wniosków'}`,
      color: 'primary' as const,
      variant: 'subtle' as const,
    }
  }

  if (property.id === activeProperty.value?.id) {
    return { label: 'Główna', color: 'neutral' as const, variant: 'subtle' as const }
  }

  return { label: 'Rozważana', color: 'neutral' as const, variant: 'subtle' as const }
}

function applicationStatus(status: MortgageApplicationStatus) {
  if (status === 'zaakceptowane') return { label: 'Decyzja pozytywna', shortLabel: 'Pozytywna', color: 'success' as const, icon: 'i-lucide-circle-check-big' }
  if (status === 'odrzucone') return { label: 'Decyzja negatywna', shortLabel: 'Odrzucony', color: 'error' as const, icon: 'i-lucide-circle-x' }
  if (status === 'wycofane') return { label: 'Wniosek wycofany', shortLabel: 'Wycofany', color: 'neutral' as const, icon: 'i-lucide-circle-minus' }
  if (status === 'w_analizie') return { label: 'Analiza banku', shortLabel: 'W analizie', color: 'info' as const, icon: 'i-lucide-search' }
  if (status === 'braki') return { label: 'Braki do uzupełnienia', shortLabel: 'Braki', color: 'warning' as const, icon: 'i-lucide-triangle-alert' }
  if (status === 'wyslane') return { label: 'Wysłany do banku', shortLabel: 'Wysłany', color: 'primary' as const, icon: 'i-lucide-send' }
  return { label: 'Przygotowanie wniosku', shortLabel: 'Przygotowanie', color: 'neutral' as const, icon: 'i-lucide-file-pen-line' }
}

function shortlistStatus(offer: SavedCaseOffer) {
  const application = applicationForOffer(offer)
  if (!application) {
    if (applicationForBank(offer)) {
      return { label: 'Bank w procesie', color: 'primary' as const, variant: 'subtle' as const, icon: 'i-lucide-files' }
    }
    return { label: 'Na shortliście', color: 'neutral' as const, variant: 'subtle' as const, icon: 'i-lucide-bookmark' }
  }
  if (application.id === finalApplication.value?.id) {
    return { label: 'Finalna umowa', color: 'success' as const, variant: 'solid' as const, icon: 'i-lucide-file-signature' }
  }

  const status = applicationStatus(application.status_code)
  return { label: status.shortLabel, color: status.color, variant: 'subtle' as const, icon: status.icon }
}

function applicationCta(property: CaseProperty, offer: SavedCaseOffer, comparison: PropertyOfferComparison) {
  const application = applicationForOffer(offer)
  const bankApplication = applicationForBank(offer)

  if (finalApplication.value) {
    if (application?.id === finalApplication.value.id) {
      return isFinalVariant(property, offer)
        ? { label: 'Finalna umowa', color: 'success' as const, variant: 'soft' as const, icon: 'i-lucide-file-signature', disabled: true }
        : { label: 'Bank finalny', color: 'success' as const, variant: 'ghost' as const, icon: 'i-lucide-badge-check', disabled: true }
    }
    if (bankApplication?.id === finalApplication.value.id) {
      return { label: 'Bank finalny', color: 'success' as const, variant: 'ghost' as const, icon: 'i-lucide-badge-check', disabled: true }
    }
    return { label: 'Proces zakończony', color: 'neutral' as const, variant: 'ghost' as const, icon: 'i-lucide-lock-keyhole', disabled: true }
  }

  if (application) {
    return isApplicationVariant(property, offer)
      ? { label: 'We wnioskach', color: 'success' as const, variant: 'soft' as const, icon: 'i-lucide-check', disabled: true }
      : { label: 'Bank już w procesie', color: 'neutral' as const, variant: 'ghost' as const, icon: 'i-lucide-files', disabled: true }
  }

  if (bankApplication) {
    return { label: 'Bank już w procesie', color: 'neutral' as const, variant: 'ghost' as const, icon: 'i-lucide-files', disabled: true }
  }

  if (comparison.status !== 'available') {
    return { label: 'Niedostępna', color: 'neutral' as const, variant: 'ghost' as const, icon: 'i-lucide-circle-slash-2', disabled: true }
  }

  if (bankApplications.value.length >= 3) {
    return { label: 'Limit 3 banków', color: 'neutral' as const, variant: 'ghost' as const, icon: 'i-lucide-lock-keyhole', disabled: true }
  }

  return { label: 'Dodaj do wniosków', color: 'primary' as const, variant: 'soft' as const, icon: 'i-lucide-files', disabled: false }
}

function comparisonStatus(comparison: PropertyOfferComparison) {
  if (comparison.status === 'invalid') return comparison.reasons[0] ?? 'Nie udało się obliczyć'
  if (comparison.status === 'ineligible') return comparison.reasons[0] ?? 'Poza parametrami oferty'
  if (comparison.status === 'partial') return comparison.reasons[0] ?? 'Wynik wymaga uzupełnienia'
  if (comparison.eligibility === 'unknown') return 'Do weryfikacji'
  return 'Dostępna'
}

function bankDisplayName(value: string) {
  return value.split('/')[0]?.trim() || value
}

function bankLogoStyle(offer: SavedCaseOffer) {
  return offer.bank_logo_background
    ? { backgroundColor: offer.bank_logo_background }
    : undefined
}

function propertySource(property: CaseProperty) {
  if (!property.source_url) return 'Dodano ręcznie'

  try {
    return new URL(property.source_url).hostname.replace(/^www\./, '')
  }
  catch {
    return property.source_url
  }
}

function propertyDisplayName(property: CaseProperty) {
  return property.listing_title || [property.address, property.city].filter(Boolean).join(', ') || 'Nieruchomość bez nazwy'
}

function propertyLocation(property: CaseProperty) {
  const location = [property.address, property.city].filter(Boolean).join(', ')
  if (property.listing_title && location) return location

  const secondaryLocation = [property.postal_code, property.city].filter(Boolean).join(' · ')
  return secondaryLocation || property.property_type || 'Dane podstawowe'
}

function scrollToPropertyCandidates() {
  document.getElementById('property-candidates-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function itemStatusLabel(status: string | undefined) {
  const labels: Record<string, string> = {
    analiza_potrzeb: 'Analiza potrzeb',
    kwalifikacja: 'Kwalifikacja',
    dokumenty: 'Dokumenty',
    oferty: 'Oferty',
    wnioski_wyslane: 'Wnioski wysłane',
    decyzja: 'Decyzja',
    umowa: 'Umowa',
    uruchomiony: 'Uruchomiony',
    utracony: 'Utracony',
    kalkulacja: 'Kalkulacja',
    oferta: 'Oferta',
    wniosek: 'Wniosek',
    aktywna: 'Aktywne',
    zakonczone: 'Zakończone',
  }
  return status ? labels[status] ?? status.replaceAll('_', ' ') : 'Nie rozpoczęto'
}

function activityIcon(type: string) {
  if (type.includes('document')) return 'i-lucide-paperclip'
  if (type.includes('offer') || type.includes('item')) return 'i-lucide-landmark'
  if (type.includes('client')) return 'i-lucide-user-round'
  return 'i-lucide-clock-3'
}
</script>

<template>
  <div class="command-overview">
    <section class="case-health" aria-label="Stan sprawy">
      <div class="case-health__item">
        <span class="case-health__icon"><UIcon name="i-lucide-flag" /></span>
        <div>
          <small>Etap biznesowy</small>
          <strong><span class="status-dot status-dot--success" />{{ businessStage }}</strong>
        </div>
      </div>
      <div class="case-health__item">
        <span class="case-health__icon"><UIcon name="i-lucide-calendar-days" /></span>
        <div>
          <small>Najbliższy termin</small>
          <strong>{{ nearestTask?.due_at ? shortDate.format(new Date(nearestTask.due_at)) : 'Brak terminu' }}</strong>
          <span>{{ nearestTask?.title ?? 'Dodaj zadanie, gdy pojawi się termin' }}</span>
        </div>
      </div>
      <div class="case-health__item">
        <span class="case-health__icon"><UIcon name="i-lucide-files" /></span>
        <div>
          <small>Weryfikacja dokumentów</small>
          <strong>{{ documentProgress.verified }} z {{ documentProgress.total }}</strong>
          <span>{{ documentProgress.satisfied }}/{{ documentProgress.total }} załączone</span>
        </div>
        <span class="case-health__progress" aria-hidden="true">
          <span :style="{ width: `${documentProgress.total ? documentProgress.verified / documentProgress.total * 100 : 0}%` }" />
        </span>
      </div>
      <div class="case-health__item case-health__item--warning">
        <span class="case-health__icon"><UIcon name="i-lucide-triangle-alert" /></span>
        <div>
          <small>Blokery</small>
          <strong>{{ blockerCount }} {{ blockerCount === 1 ? 'do rozwiązania' : 'do rozwiązania' }}</strong>
        </div>
      </div>
    </section>

    <div class="command-overview__grid">
      <div class="command-overview__main">
        <section class="case-plan" aria-labelledby="case-plan-title">
          <header class="case-panel-heading">
            <h2 id="case-plan-title">Plan sprawy</h2>
          </header>

          <div class="workstream workstream--credit">
            <div class="workstream__heading">
              <span class="workstream__icon"><UIcon name="i-lucide-landmark" /></span>
              <div>
                <h3>Kredyt</h3>
                <span class="workstream__status">
                  <span class="status-dot" :class="{ 'status-dot--success': Boolean(finalApplication), 'status-dot--primary': bankApplications.length > 0 && !finalApplication }" />
                  {{ creditWorkstreamStatus }}
                </span>
              </div>
              <UIcon name="i-lucide-chevron-up" class="workstream__chevron" />
            </div>

            <div v-if="finalApplication && finalOffer" class="signed-contract" data-testid="signed-credit-contract">
              <span class="signed-contract__icon"><UIcon name="i-lucide-file-signature" /></span>
              <div>
                <small>Podpisana umowa · jeden finalny bank</small>
                <strong>{{ bankDisplayName(finalOffer.bank_name) }}</strong>
                <span>{{ finalProperty ? propertyDisplayName(finalProperty) : finalOffer.product_name }}</span>
              </div>
              <UBadge color="success" variant="solid" icon="i-lucide-badge-check">Finalna</UBadge>
              <UButton color="neutral" variant="ghost" size="sm" trailing-icon="i-lucide-arrow-up-right" @click="actions.openOffer(finalOffer)">
                Zobacz ofertę
              </UButton>
            </div>

            <div v-if="bankApplications.length" class="credit-applications" aria-label="Równoległe wnioski bankowe">
              <header class="credit-applications__heading">
                <div>
                  <strong>Równoległe wnioski bankowe</strong>
                  <small>{{ bankApplications.length }}/3 banki · wybór finalny dopiero przy podpisaniu umowy</small>
                </div>
                <UBadge :color="finalApplication ? 'success' : 'primary'" variant="subtle" size="xs">
                  {{ finalApplication ? 'Proces sfinalizowany' : `${3 - bankApplications.length} wolne` }}
                </UBadge>
              </header>

              <div class="credit-applications__list">
                <article
                  v-for="application in bankApplications"
                  :key="application.id"
                  class="credit-application"
                  :class="{
                    'credit-application--final': application.id === finalApplication?.id,
                    'credit-application--withdrawn': application.status_code === 'wycofane',
                  }"
                >
                  <span
                    class="credit-application__logo"
                    :style="offerForApplication(application)?.bank_logo_background
                      ? { backgroundColor: offerForApplication(application)?.bank_logo_background ?? undefined }
                      : undefined"
                  >
                    <img
                      v-if="offerForApplication(application)?.bank_logo_url"
                      :src="offerForApplication(application)?.bank_logo_url ?? undefined"
                      :alt="`Logo ${offerForApplication(application)?.bank_name}`"
                    >
                    <UIcon v-else name="i-lucide-landmark" />
                  </span>
                  <div class="credit-application__identity">
                    <small>Wniosek {{ application.slot }}/3</small>
                    <strong>{{ bankDisplayName(offerForApplication(application)?.bank_name ?? 'Bank') }}</strong>
                    <span>{{ applicationPropertyLabel(application) }}</span>
                  </div>
                  <div class="credit-application__amount">
                    <small>Wydatek / mies.</small>
                    <strong>{{ money(applicationMonthlyOutflow(application)) }}</strong>
                  </div>
                  <UBadge
                    class="credit-application__status"
                    :color="application.id === finalApplication?.id ? 'success' : applicationStatus(application.status_code).color"
                    :variant="application.id === finalApplication?.id ? 'solid' : 'subtle'"
                    :icon="application.id === finalApplication?.id ? 'i-lucide-file-signature' : applicationStatus(application.status_code).icon"
                    size="xs"
                  >
                    {{ application.id === finalApplication?.id ? 'Podpisana umowa' : applicationStatus(application.status_code).label }}
                  </UBadge>
                  <UButton
                    v-if="offerForApplication(application)"
                    class="credit-application__action"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-arrow-up-right"
                    aria-label="Otwórz ofertę"
                    @click="openApplicationOffer(application)"
                  />
                </article>
              </div>
            </div>

            <div v-else class="credit-empty">
              <div>
                <strong>Nie uruchomiono jeszcze wniosku bankowego</strong>
                <span v-if="offers.length">{{ offers.length }} {{ offers.length === 1 ? 'oferta jest' : 'oferty są' }} na shortliście. Dodaj maksymalnie trzy banki z porównania poniżej.</span>
                <span v-else>Najpierw zapisz oferty na shortliście, potem dodaj banki do równoległych wniosków.</span>
              </div>
              <UButton
                :icon="offers.length ? 'i-lucide-arrow-down' : 'i-lucide-plus'"
                @click="offers.length ? scrollToPropertyCandidates() : actions.addOffer()"
              >
                {{ offers.length ? 'Wybierz banki' : 'Dodaj ofertę do shortlisty' }}
              </UButton>
            </div>
          </div>

          <section class="property-candidates" aria-labelledby="property-candidates-title">
            <header class="property-candidates__heading">
              <div>
                <h3 id="property-candidates-title">Nieruchomości i finansowanie</h3>
                <span>
                  {{ properties.length || offers.length
                    ? `${properties.length} ${properties.length === 1 ? 'nieruchomość' : 'nieruchomości'} · ${offers.length} ${offers.length === 1 ? 'oferta bankowa' : 'ofert bankowych'}`
                    : 'Dodaj pierwszą nieruchomość do porównania' }}
                </span>
              </div>
              <div class="property-candidates__actions">
                <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-landmark" @click="actions.addOffer()">
                  Dodaj ofertę banku
                </UButton>
                <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-plus" @click="actions.addProperty()">
                  Dodaj nieruchomość
                </UButton>
              </div>
            </header>

            <div v-if="financingBaseline && offers.length" class="financing-assumptions">
              <span><UIcon name="i-lucide-calculator" /></span>
              <div>
                <strong>Wspólne założenia porównania</strong>
                <small>
                  Stały wkład {{ money(financingBaseline.contributionAmount) }} · {{ financingBaseline.years }} lat ·
                  {{ financingBaseline.installmentType === 'decreasing' ? 'raty malejące' : 'raty równe' }}
                </small>
              </div>
              <UBadge color="warning" variant="subtle" size="xs">Szacunek</UBadge>
            </div>

            <div v-if="properties.length" class="property-candidates__grid">
              <article
                v-for="candidate in properties"
                :key="candidate.id"
                class="property-card"
                :class="{
                  'property-card--active': applicationsForProperty(candidate).length > 0,
                  'property-card--final': candidate.id === finalProperty?.id,
                }"
              >
                <div class="property-card__media">
                  <img
                    v-if="candidate.images?.[0]?.url"
                    :src="candidate.images[0].url"
                    :alt="candidate.images[0].alt_text || propertyDisplayName(candidate)"
                  >
                  <span v-else class="property-card__placeholder" aria-hidden="true">
                    <UIcon name="i-lucide-house" />
                  </span>
                  <UBadge
                    class="property-card__badge"
                    :color="propertyBadge(candidate).color"
                    :variant="propertyBadge(candidate).variant"
                    size="xs"
                  >
                    {{ propertyBadge(candidate).label }}
                  </UBadge>
                </div>

                <div class="property-card__body">
                  <div class="property-card__title">
                    <strong :title="propertyDisplayName(candidate)">{{ propertyDisplayName(candidate) }}</strong>
                    <span :title="propertyLocation(candidate)">{{ propertyLocation(candidate) }}</span>
                  </div>

                  <dl>
                    <div>
                      <dt>Cena</dt>
                      <dd>{{ money(candidate.price_amount) }}</dd>
                    </div>
                    <div>
                      <dt>Metraż</dt>
                      <dd>{{ candidate.area_m2 != null ? `${Number(candidate.area_m2).toLocaleString('pl-PL')} m²` : '—' }}</dd>
                    </div>
                    <div>
                      <dt>Pokoje</dt>
                      <dd>{{ candidate.rooms ?? '—' }}</dd>
                    </div>
                  </dl>

                  <span class="property-card__source" :title="candidate.source_url ?? undefined">
                    <UIcon name="i-lucide-link-2" />
                    {{ propertySource(candidate) }}
                  </span>

                  <section v-if="offers.length" class="property-card__financing" :aria-label="`Raty banków dla ${propertyDisplayName(candidate)}`">
                    <header>
                      <strong>Raty w bankach</strong>
                      <span>{{ comparisonsForProperty(candidate.id).length }}</span>
                    </header>
                    <div class="bank-comparison-list">
                      <template v-for="comparison in comparisonsForProperty(candidate.id)" :key="comparison.offerId">
                        <button
                          type="button"
                          class="bank-comparison-row"
                          :class="{
                            'bank-comparison-row--active': isApplicationVariant(candidate, offerForComparison(comparison)),
                            'bank-comparison-row--final': isFinalVariant(candidate, offerForComparison(comparison)),
                            'bank-comparison-row--blocked': comparison.status !== 'available',
                          }"
                          :aria-label="`${bankDisplayName(offerForComparison(comparison).bank_name)}, ${propertyDisplayName(candidate)}: ${comparison.firstInstallment == null ? comparisonStatus(comparison) : money(comparison.firstInstallment)}`"
                          @click="actions.openFinancingVariant(candidate, offerForComparison(comparison))"
                        >
                          <span
                            class="bank-comparison-row__logo"
                            :style="bankLogoStyle(offerForComparison(comparison))"
                          >
                            <img
                              v-if="offerForComparison(comparison).bank_logo_url"
                              :src="offerForComparison(comparison).bank_logo_url ?? undefined"
                              :alt="`Logo ${offerForComparison(comparison).bank_name}`"
                            >
                            <UIcon v-else name="i-lucide-landmark" />
                          </span>
                          <span class="bank-comparison-row__bank">
                            <strong :title="offerForComparison(comparison).bank_name">{{ bankDisplayName(offerForComparison(comparison).bank_name) }}</strong>
                            <small>{{ comparisonStatus(comparison) }}</small>
                          </span>
                          <span class="bank-comparison-row__payment">
                            <strong>{{ comparison.firstInstallment == null ? '—' : money(comparison.firstInstallment) }}</strong>
                            <small v-if="comparison.firstMonthlyOutflow != null">z kosztami {{ money(comparison.firstMonthlyOutflow) }}</small>
                          </span>
                          <span class="bank-comparison-row__ltv">LTV {{ percent(comparison.ltvPct) }}</span>
                          <UIcon name="i-lucide-chevron-right" />
                        </button>
                        <UButton
                          class="bank-comparison-select"
                          :color="applicationCta(candidate, offerForComparison(comparison), comparison).color"
                          :variant="applicationCta(candidate, offerForComparison(comparison), comparison).variant"
                          size="xs"
                          :icon="applicationCta(candidate, offerForComparison(comparison), comparison).icon"
                          :aria-label="`${applicationCta(candidate, offerForComparison(comparison), comparison).label}: ${bankDisplayName(offerForComparison(comparison).bank_name)} dla ${propertyDisplayName(candidate)}`"
                          :loading="selectingFinancingVariantKey === `${candidate.id}:${comparison.offerId}`"
                          :disabled="applicationCta(candidate, offerForComparison(comparison), comparison).disabled || Boolean(selectingFinancingVariantKey)"
                          @click="actions.addApplication(candidate, offerForComparison(comparison))"
                        >
                          {{ applicationCta(candidate, offerForComparison(comparison), comparison).label }}
                        </UButton>
                      </template>
                    </div>
                    <small class="property-card__financing-note">Rata dla wkładu {{ money(financingBaseline?.contributionAmount) }}; warunki cenowe banku wymagają potwierdzenia.</small>
                  </section>

                  <button v-else type="button" class="property-card__add-offer" @click="actions.addOffer()">
                    <UIcon name="i-lucide-landmark" />
                    Dodaj oferty, aby zobaczyć raty
                  </button>

                  <div class="property-card__actions">
                    <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-pencil" @click="actions.editProperty(candidate)">
                      Edytuj
                    </UButton>
                    <UButton
                      v-if="!offers.length"
                      :color="candidate.id === activeProperty?.id ? 'success' : 'primary'"
                      :variant="candidate.id === activeProperty?.id ? 'soft' : 'solid'"
                      size="xs"
                      :icon="candidate.id === activeProperty?.id ? 'i-lucide-check' : 'i-lucide-circle-check-big'"
                      :loading="selectingPropertyId === candidate.id"
                      :disabled="candidate.id === activeProperty?.id || Boolean(selectingPropertyId)"
                      @click="actions.selectProperty(candidate)"
                    >
                      {{ candidate.id === activeProperty?.id ? 'Wybrana' : 'Wybierz' }}
                    </UButton>
                  </div>
                </div>
              </article>
            </div>

            <div v-else class="property-candidates__empty">
              <span><UIcon name="i-lucide-house-plus" /></span>
              <div>
                <strong>Brak rozważanych nieruchomości</strong>
                <small>Zaimportuj link do ogłoszenia lub dodaj dane ręcznie.</small>
              </div>
              <UButton size="sm" icon="i-lucide-plus" @click="actions.addProperty()">Dodaj nieruchomość</UButton>
            </div>
          </section>

          <button type="button" class="workstream-row" @click="actions.openInsurance('insurance_life')">
            <span class="workstream__icon"><UIcon name="i-lucide-heart-pulse" /></span>
            <span class="workstream-row__copy">
              <strong>Ubezpieczenie na życie</strong>
              <small>{{ itemStatusLabel(lifeInsurance?.status_code) }}</small>
            </span>
            <span class="workstream-row__action">{{ lifeInsurance ? 'Otwórz proces' : 'Dodaj ubezpieczenie' }}</span>
            <UIcon name="i-lucide-chevron-right" />
          </button>

          <button type="button" class="workstream-row" @click="actions.openInsurance('insurance_property')">
            <span class="workstream__icon"><UIcon name="i-lucide-shield-check" /></span>
            <span class="workstream-row__copy">
              <strong>Ubezpieczenie nieruchomości</strong>
              <small>{{ itemStatusLabel(propertyInsurance?.status_code) }}</small>
            </span>
            <span class="workstream-row__action">{{ propertyInsurance ? 'Otwórz proces' : 'Dodaj ubezpieczenie' }}</span>
            <UIcon name="i-lucide-chevron-right" />
          </button>

          <button type="button" class="workstream-row" @click="actions.openRenovation()">
            <span class="workstream__icon"><UIcon name="i-lucide-paint-roller" /></span>
            <span class="workstream-row__copy">
              <strong>Remont</strong>
              <small>Kredyt gotówkowy · {{ itemStatusLabel(renovation?.status_code) }}</small>
            </span>
            <span class="workstream-row__action">{{ renovation ? 'Otwórz proces' : 'Dodaj kredyt gotówkowy' }}</span>
            <UIcon name="i-lucide-chevron-right" />
          </button>
        </section>

        <section class="selected-offers" aria-labelledby="selected-offers-title">
          <header class="case-panel-heading">
            <div>
              <h2 id="selected-offers-title">Shortlista ofert bankowych</h2>
              <span>
                {{ caseData.offers.length }} {{ caseData.offers.length === 1 ? 'zapisana oferta' : 'zapisane oferty' }} ·
                {{ bankApplications.length }}/3 we wnioskach
              </span>
            </div>
          </header>
          <div v-if="caseData.offers.length" class="selected-offers__list">
            <button
              v-for="offer in caseData.offers"
              :key="offer.id"
              type="button"
              class="selected-offer-row"
              @click="actions.openOffer(offer)"
            >
              <span
                class="selected-offer-row__logo"
                :style="offer.bank_logo_background ? { backgroundColor: offer.bank_logo_background } : undefined"
              >
                <img v-if="offer.bank_logo_url" :src="offer.bank_logo_url" :alt="`Logo ${offer.bank_name}`">
                <UIcon v-else name="i-lucide-landmark" />
              </span>
              <span class="selected-offer-row__name"><strong :title="offer.bank_name">{{ bankDisplayName(offer.bank_name) }}</strong><small>{{ offer.product_name }}</small></span>
              <span><small>Środki netto / saldo brutto</small><strong>{{ money(comparisonFor(activeProperty?.id, offer.id)?.netLoanAmount ?? offer.loan_amount) }} / {{ money(comparisonFor(activeProperty?.id, offer.id)?.grossLoanAmount ?? offer.loan_amount) }}</strong></span>
              <span><small>Wydatek / mies.</small><strong>{{ money(comparisonFor(activeProperty?.id, offer.id)?.firstMonthlyOutflow ?? offer.first_monthly_outflow) }}</strong></span>
              <span><small>Okres</small><strong>{{ Number(offer.scenario_snapshot?.years ?? 0) || '—' }} lat</strong></span>
              <span><small>LTV wybranej nieruchomości</small><strong>{{ percent(comparisonFor(activeProperty?.id, offer.id)?.ltvPct) }}</strong></span>
              <span class="selected-offer-row__status">
                <UBadge
                  :color="shortlistStatus(offer).color"
                  :variant="shortlistStatus(offer).variant"
                  :icon="shortlistStatus(offer).icon"
                  size="xs"
                >
                  {{ shortlistStatus(offer).label }}
                </UBadge>
              </span>
              <UIcon name="i-lucide-chevron-right" />
            </button>
          </div>
          <button type="button" class="add-offer-row" @click="actions.addOffer()">
            <UIcon name="i-lucide-plus" />
            Dodaj ofertę do shortlisty
          </button>
        </section>
      </div>

      <aside class="command-sidebar" aria-label="Skrót sprawy">
        <section class="command-side-panel">
          <header><h2>Co teraz</h2></header>
          <div class="attention-list">
            <button v-for="(item, index) in attentionItems" :key="item.key" type="button" @click="item.action()">
              <span class="attention-list__number" :class="{ 'attention-list__number--primary': index === 0 }">{{ index + 1 }}</span>
              <UIcon :name="item.icon" />
              <span><strong>{{ item.title }}</strong><small>{{ item.detail }}</small></span>
              <UIcon name="i-lucide-chevron-right" />
            </button>
          </div>
        </section>

        <section class="command-side-panel">
          <header><h2>Wnioskodawcy</h2></header>
          <div class="applicant-list">
            <NuxtLink v-for="client in caseData.clients" :key="client.id" :to="orgPath(`/clients/${client.id}`)">
              <span class="applicant-list__avatar"><UIcon name="i-lucide-user-round" /></span>
              <span><strong>{{ client.display_name }}</strong><small>{{ client.primary_email || client.primary_phone || 'Brak danych kontaktowych' }}</small></span>
              <UBadge v-if="client.is_primary" color="neutral" variant="subtle" size="xs">Główny</UBadge>
            </NuxtLink>
          </div>
        </section>

        <section class="command-side-panel">
          <header><h2>Ostatnia aktywność</h2></header>
          <ol v-if="caseData.recent_activities?.length" class="activity-list">
            <li v-for="activity in caseData.recent_activities.slice(0, 4)" :key="activity.id">
              <span><UIcon :name="activityIcon(activity.activity_type)" /></span>
              <div>
                <strong>{{ activity.title }}</strong>
                <small>{{ dateTime.format(new Date(activity.created_at)) }}<template v-if="activity.actor?.full_name"> · {{ activity.actor.full_name }}</template></small>
              </div>
            </li>
          </ol>
          <div v-else class="activity-empty">
            <UIcon name="i-lucide-clock-3" />
            <span>Historia działań pojawi się tutaj.</span>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.command-overview {
  display: grid;
  gap: 16px;
}

.case-health,
.command-overview__grid,
.credit-workspace,
.signed-contract,
.credit-applications__heading,
.credit-application,
.case-health__item,
.workstream__heading,
.workstream-row,
.active-offer-summary__heading,
.selected-offer-row,
.applicant-list a,
.activity-list li,
.attention-list button {
  display: flex;
}

.case-health {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.case-health__item {
  position: relative;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 80px;
  padding: 15px 18px;
}

.case-health__item + .case-health__item {
  border-left: 1px solid var(--ui-border);
}

.case-health__icon,
.workstream__icon,
.active-offer-summary__logo,
.selected-offer-row__logo,
.applicant-list__avatar,
.activity-list > li > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
}

.case-health__icon {
  width: 34px;
  height: 34px;
  color: var(--ui-text-toned);
  font-size: 20px;
}

.case-health__item > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.case-health small,
.case-health span,
.workstream-row small,
.active-offer-summary small,
.active-offer-summary dt,
.selected-offer-row small,
.case-panel-heading span,
.applicant-list small,
.activity-list small,
.attention-list small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.case-health strong {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.case-health__item--warning .case-health__icon,
.case-health__item--warning strong {
  color: var(--ui-warning);
}

.case-health__progress {
  position: absolute;
  right: 18px;
  bottom: 13px;
  left: 64px;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ui-bg-accented);
}

.case-health__progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ui-success);
}

.status-dot {
  display: inline-block;
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--ui-text-dimmed);
}

.status-dot--success { background: var(--ui-success); }
.status-dot--primary { background: var(--ui-primary); }

.command-overview__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(350px, .85fr);
  gap: 16px;
  align-items: start;
}

.command-overview__main,
.command-sidebar {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.command-sidebar {
  position: sticky;
  top: 16px;
}

.case-plan,
.selected-offers,
.command-side-panel {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg);
}

.case-panel-heading,
.command-side-panel > header {
  padding: 16px 18px;
  border-bottom: 1px solid var(--ui-border);
}

.case-panel-heading h2,
.command-side-panel h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 680;
}

.workstream {
  padding: 16px 18px 18px;
}

.workstream__heading {
  align-items: center;
  gap: 11px;
}

.workstream__icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  color: var(--ui-text-toned);
  font-size: 20px;
}

.workstream__icon--photo {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.workstream__icon--photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.workstream__heading > div,
.workstream-row__copy,
.applicant-list a > span:nth-child(2),
.attention-list button > span:nth-child(3) {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.workstream__heading h3,
.workstream-row strong,
.active-offer-summary strong,
.selected-offer-row strong,
.applicant-list strong,
.activity-list strong,
.attention-list strong {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.workstream__status {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-success);
  font-size: 11px;
}

.workstream__status:has(.status-dot--primary) { color: var(--ui-primary); }
.workstream__status:has(.status-dot:not(.status-dot--primary, .status-dot--success)) { color: var(--ui-text-muted); }

.workstream__chevron {
  margin-left: auto;
  color: var(--ui-text-muted);
}

.signed-contract {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 11px 12px;
  border: 1px solid color-mix(in srgb, var(--ui-success) 48%, var(--ui-border));
  border-radius: 11px;
  background: color-mix(in srgb, var(--ui-success) 6%, var(--ui-bg));
}

.signed-contract__icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--ui-success) 14%, var(--ui-bg));
  color: var(--ui-success);
  font-size: 18px;
}

.signed-contract > div {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.signed-contract small,
.signed-contract span,
.credit-applications small,
.credit-application small,
.credit-application__identity span {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.signed-contract strong,
.credit-applications strong,
.credit-application strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.signed-contract > div > span,
.credit-application__identity span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.credit-applications {
  display: grid;
  gap: 9px;
  margin-top: 14px;
}

.signed-contract + .credit-applications { margin-top: 9px; }

.credit-applications__heading {
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.credit-applications__heading > div {
  display: grid;
  gap: 2px;
}

.credit-applications__list {
  display: grid;
  gap: 7px;
}

.credit-application {
  display: grid;
  grid-template-columns: 34px minmax(130px, 1fr) minmax(90px, auto) auto 28px;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-muted);
}

.credit-application--final {
  border-color: color-mix(in srgb, var(--ui-success) 55%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-success) 5%, var(--ui-bg));
  box-shadow: inset 3px 0 var(--ui-success);
}

.credit-application--withdrawn { opacity: .72; }

.credit-application__logo {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: #fff;
  color: var(--ui-text-muted);
}

.credit-application__logo img {
  width: 100%;
  height: 100%;
  padding: 4px;
  object-fit: contain;
}

.credit-application__identity,
.credit-application__amount {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.credit-application__amount { justify-items: end; text-align: right; }

.credit-workspace {
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  gap: 22px;
  align-items: center;
  margin-top: 14px;
}

.active-offer-summary {
  display: grid;
  gap: 13px;
  padding: 13px;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg-muted);
}

.active-offer-summary__heading {
  align-items: center;
  gap: 9px;
}

.active-offer-summary__logo,
.selected-offer-row__logo {
  width: 32px;
  height: 32px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: #fff;
  color: var(--ui-text-toned);
}

.active-offer-summary__logo img,
.selected-offer-row__logo img {
  width: 100%;
  height: 100%;
  padding: 4px;
  object-fit: contain;
}

.active-offer-summary__heading > div {
  display: grid;
  min-width: 0;
}

.active-offer-summary__heading > div > span {
  overflow: hidden;
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-offer-summary dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin: 0;
}

.active-offer-summary dl div { display: grid; gap: 2px; }
.active-offer-summary dd { margin: 0; color: var(--ui-text-highlighted); font-size: 13px; font-weight: 650; }
.active-offer-summary :deep(button) { justify-self: start; }

.credit-process > p {
  margin: 0 0 16px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.credit-process ol {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
}

.credit-process li {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 5px;
  min-width: 0;
  text-align: center;
}

.credit-process li::before {
  position: absolute;
  top: 13px;
  right: 50%;
  left: -50%;
  z-index: 0;
  height: 1px;
  background: var(--ui-border-accented);
  content: '';
}

.credit-process li:first-child::before { display: none; }
.credit-process li.is-complete::before,
.credit-process li.is-current::before { background: var(--ui-success); }

.credit-process__point {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 999px;
  background: var(--ui-bg);
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.credit-process li.is-complete .credit-process__point,
.credit-process li.is-current .credit-process__point {
  border-color: var(--ui-success);
}

.credit-process li.is-complete .credit-process__point {
  background: color-mix(in srgb, var(--ui-success) 16%, var(--ui-bg));
  color: var(--ui-success);
}

.credit-process li.is-current .credit-process__point {
  background: var(--ui-success);
  color: var(--ui-text-inverted);
}

.credit-process li strong { color: var(--ui-text-highlighted); font-size: 10px; font-weight: 600; }
.credit-process li small { overflow: hidden; max-width: 100%; color: var(--ui-text-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }

.credit-empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border);
}

.credit-empty > div { display: grid; gap: 3px; }
.credit-empty strong { color: var(--ui-text-highlighted); font-size: 13px; }
.credit-empty span { color: var(--ui-text-muted); font-size: 11px; }

.property-candidates {
  padding: 16px 18px 18px;
  border-top: 1px solid var(--ui-border);
}

.property-candidates__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 13px;
}

.property-candidates__heading > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.property-candidates__heading h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.property-candidates__heading span,
.property-candidates__empty small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.property-candidates__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
}

.financing-assumptions {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 38%, var(--ui-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-warning) 7%, var(--ui-bg));
}

.financing-assumptions > span {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--ui-warning) 13%, var(--ui-bg));
  color: var(--ui-warning);
  font-size: 17px;
}

.financing-assumptions > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.financing-assumptions strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
}

.financing-assumptions small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.property-candidates__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(248px, 1fr));
  gap: 12px;
}

.property-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg);
}

.property-card--active {
  border-color: color-mix(in srgb, var(--ui-success) 60%, var(--ui-border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-success) 22%, transparent);
}

.property-card--final {
  border-color: color-mix(in srgb, var(--ui-success) 70%, var(--ui-border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-success) 32%, transparent);
}

.property-card__media {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--ui-bg-muted);
}

.property-card__media img,
.property-card__placeholder {
  width: 100%;
  height: 100%;
}

.property-card__media img { object-fit: cover; }

.property-card__placeholder {
  display: grid;
  place-items: center;
  color: var(--ui-text-dimmed);
  font-size: 28px;
}

.property-card__badge {
  position: absolute;
  top: 9px;
  right: 9px;
  box-shadow: 0 1px 4px color-mix(in srgb, var(--ui-text-highlighted) 14%, transparent);
}

.property-card__body {
  display: grid;
  gap: 11px;
  padding: 12px;
}

.property-card__title {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.property-card__title strong,
.property-card__title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.property-card__title strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.property-card__title span,
.property-card__source,
.property-card dt {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.property-card dl {
  display: grid;
  grid-template-columns: 1.25fr repeat(2, minmax(42px, .65fr));
  gap: 8px;
  margin: 0;
}

.property-card dl > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.property-card dd {
  overflow: hidden;
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.property-card__source {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.property-card__source svg { flex: 0 0 auto; }

.property-card__financing {
  display: grid;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--ui-border);
}

.property-card__financing > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.property-card__financing > header strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 650;
}

.property-card__financing > header span {
  display: grid;
  place-items: center;
  min-width: 19px;
  height: 19px;
  padding-inline: 5px;
  border-radius: 999px;
  background: var(--ui-bg-accented);
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 8px;
}

.bank-comparison-list {
  display: grid;
  gap: 6px;
}

.bank-comparison-row {
  display: grid;
  grid-template-columns: 28px minmax(72px, 1fr) auto;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  padding: 7px;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: var(--ui-bg);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.bank-comparison-row:hover,
.bank-comparison-row:focus-visible {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
  outline: none;
}

.bank-comparison-row--active {
  border-color: color-mix(in srgb, var(--ui-success) 58%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-success) 7%, var(--ui-bg));
  box-shadow: inset 3px 0 var(--ui-success);
}

.bank-comparison-row--final {
  border-color: color-mix(in srgb, var(--ui-success) 72%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-success) 10%, var(--ui-bg));
  box-shadow: inset 3px 0 var(--ui-success);
}

.bank-comparison-row--blocked {
  background: var(--ui-bg-muted);
}

.bank-comparison-row__logo {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: #fff;
  color: var(--ui-text-muted);
  font-size: 14px;
}

.bank-comparison-row__logo img {
  width: 100%;
  height: 100%;
  padding: 3px;
  object-fit: contain;
}

.bank-comparison-row__bank,
.bank-comparison-row__payment {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.bank-comparison-row__bank strong,
.bank-comparison-row__bank small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bank-comparison-row__bank strong,
.bank-comparison-row__payment strong {
  color: var(--ui-text-highlighted);
  font-size: 10px;
  font-weight: 650;
}

.bank-comparison-row__bank small,
.bank-comparison-row__payment small,
.bank-comparison-row__ltv,
.property-card__financing-note {
  color: var(--ui-text-muted);
  font-size: 8px;
}

.bank-comparison-row__payment {
  justify-items: end;
  text-align: right;
}

.bank-comparison-row__payment strong {
  font-size: 12px;
}

.bank-comparison-row__ltv {
  grid-column: 2;
}

.bank-comparison-row > svg {
  grid-column: 3;
  grid-row: 2;
  justify-self: end;
  color: var(--ui-text-dimmed);
  font-size: 13px;
}

.bank-comparison-select {
  justify-self: stretch;
}

.property-card__financing-note {
  line-height: 1.4;
}

.property-card__add-offer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 38px;
  padding: 7px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 9px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 10px;
  cursor: pointer;
}

.property-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--ui-border);
}

.property-candidates__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 76px;
  padding: 13px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 10px;
  background: var(--ui-bg-muted);
}

.property-candidates__empty > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--ui-bg);
  color: var(--ui-text-toned);
  font-size: 19px;
}

.property-candidates__empty > div {
  display: grid;
  flex: 1;
  gap: 2px;
}

.property-candidates__empty strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
}

.workstream-row {
  width: 100%;
  align-items: center;
  gap: 12px;
  min-height: 66px;
  padding: 12px 18px;
  border: 0;
  border-top: 1px solid var(--ui-border);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.workstream-row:hover,
.workstream-row:focus-visible,
.attention-list button:hover,
.attention-list button:focus-visible,
.selected-offer-row:hover,
.selected-offer-row:focus-visible,
.applicant-list a:hover,
.applicant-list a:focus-visible {
  background: var(--ui-bg-muted);
  outline: none;
}

.workstream-row__copy { flex: 1; }
.workstream-row__value { color: var(--ui-text-highlighted); font-size: 12px; }
.workstream-row__action {
  padding: 4px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  color: var(--ui-text);
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
}
.workstream-row > svg { color: var(--ui-text-muted); }

.selected-offers__list { padding: 8px 12px 0; }

.selected-offer-row {
  display: grid;
  grid-template-columns: 32px minmax(150px, 1.35fr) repeat(4, minmax(70px, .7fr)) auto 18px;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 64px;
  padding: 8px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.selected-offer-row > span:not(.selected-offer-row__logo) { display: grid; gap: 2px; min-width: 0; }
.selected-offer-row__name strong,
.selected-offer-row__name small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected-offer-row__status { display: flex!important; align-items: center; grid-auto-flow: column; justify-content: start; color: var(--ui-text); font-size: 11px; white-space: nowrap; }

.add-offer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 46px;
  margin: 10px 12px 12px;
  padding: 0 12px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: 9px;
  background: transparent;
  color: var(--ui-text);
  font-size: 12px;
  cursor: pointer;
}

.add-offer-row:hover,
.add-offer-row:focus-visible { border-color: var(--ui-text-muted); background: var(--ui-bg-muted); outline: none; }

.command-side-panel > header { padding-block: 14px; }

.attention-list,
.applicant-list,
.activity-list { display: grid; margin: 0; padding: 8px 12px; list-style: none; }

.attention-list button {
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.attention-list__number {
  display: grid!important;
  flex: 0 0 auto;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 999px;
  background: var(--ui-bg-accented);
  color: var(--ui-text);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
}

.attention-list__number--primary { background: var(--ui-success); color: var(--ui-text-inverted); }
.attention-list button > svg { flex: 0 0 auto; color: var(--ui-text-toned); font-size: 18px; }
.attention-list button > span:nth-child(3) { flex: 1; }
.attention-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.applicant-list a {
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 7px 8px;
  border-radius: 9px;
  color: inherit;
  text-decoration: none;
}

.applicant-list__avatar,
.activity-list > li > span {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
}

.applicant-list a > span:nth-child(2) { flex: 1; }

.activity-list { gap: 2px; }
.activity-list li { align-items: flex-start; gap: 10px; padding: 8px; }
.activity-list li > div { display: grid; gap: 2px; }
.activity-list > li > span { width: 26px; height: 26px; background: transparent; font-size: 15px; }

.activity-empty {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 22px 18px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

@media (max-width: 1280px) {
  .case-health { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .case-health__item:nth-child(3) { border-left: 0; border-top: 1px solid var(--ui-border); }
  .case-health__item:nth-child(4) { border-top: 1px solid var(--ui-border); }
  .selected-offer-row { grid-template-columns: 32px minmax(150px, 1.4fr) repeat(2, minmax(80px, .8fr)) auto 18px; }
  .selected-offer-row > span:nth-child(5),
  .selected-offer-row > span:nth-child(6) { display: none; }
}

@media (max-width: 1080px) {
  .command-overview__grid { grid-template-columns: 1fr; }
  .command-sidebar { position: static; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .credit-workspace { grid-template-columns: minmax(180px, 230px) minmax(0, 1fr); }
}

@media (max-width: 760px) {
  .case-health { grid-template-columns: 1fr; }
  .case-health__item + .case-health__item { border-top: 1px solid var(--ui-border); border-left: 0; }
  .credit-workspace { grid-template-columns: 1fr; }
  .signed-contract { grid-template-columns: 38px minmax(0, 1fr) auto; }
  .signed-contract :deep(button) { grid-column: 1 / -1; justify-content: center; }
  .credit-applications__heading { align-items: flex-start; }
  .credit-application { grid-template-columns: 34px minmax(0, 1fr) 28px; }
  .credit-application__amount { grid-column: 2; justify-items: start; text-align: left; }
  .credit-application__status { grid-column: 1 / 3; justify-self: start; }
  .credit-application__action { grid-column: 3; grid-row: 1; }
  .credit-process ol { overflow-x: auto; grid-template-columns: repeat(5, minmax(88px, 1fr)); padding-bottom: 4px; }
  .property-candidates__heading { align-items: flex-start; flex-direction: column; }
  .property-candidates__actions { width: 100%; }
  .property-candidates__actions :deep(button) { flex: 1; justify-content: center; }
  .financing-assumptions { grid-template-columns: 34px minmax(0, 1fr); }
  .financing-assumptions > :last-child { display: none; }
  .property-candidates__grid { grid-template-columns: 1fr; }
  .property-candidates__empty { align-items: flex-start; flex-wrap: wrap; }
  .property-candidates__empty :deep(button) { width: 100%; justify-content: center; }
  .workstream-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; }
  .workstream-row__value { grid-column: 2 / -1; }
  .workstream-row__action { display: none; }
  .workstream-row > svg { grid-column: 3; grid-row: 1; }
  .command-sidebar { grid-template-columns: 1fr; }
  .selected-offer-row { grid-template-columns: 32px minmax(0, 1fr) 18px; }
  .selected-offer-row > span:not(.selected-offer-row__logo):not(.selected-offer-row__name) { display: none!important; }
}
</style>
