<script setup lang="ts">
import type {
  CaseBankApplication,
  CaseDetail,
  MortgageApplicationStatus,
  SavedCaseOffer,
} from '~/types/cases'
import { isMortgageOfferApplicationReady } from '~/utils/mortgage-offer-readiness'

const props = defineProps<{
  caseData: CaseDetail
  focusedApplicationId?: string | null
}>()

const emit = defineEmits<{
  refresh: []
  openDocuments: []
}>()

const { crmApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const candidateOfferId = ref('')
const adding = ref(false)
const focusingId = ref('')
const removingId = ref('')
const signingId = ref('')
const draftToRemove = ref<CaseBankApplication | null>(null)
const contractToSign = ref<CaseBankApplication | null>(null)

const applicationBankIds = computed(() => new Set(props.caseData.bank_applications.map(application => application.bank_id)))
const availableOffers = computed(() => props.caseData.offers.filter(offer => (
  Boolean(offer.bank_id)
  && isMortgageOfferApplicationReady(offer.calculation_status)
  && !applicationBankIds.value.has(String(offer.bank_id))
)))
const incompleteOfferCount = computed(() => props.caseData.offers.filter(offer => (
  !isMortgageOfferApplicationReady(offer.calculation_status)
)).length)
const candidateItems = computed(() => availableOffers.value.map(offer => ({
  label: offer.bank_name,
  description: `${offer.product_name} · ${money(offer.first_monthly_outflow, offer.currency)}/mies.`,
  value: offer.id,
})))
const canCreateApplication = computed(() => Boolean(candidateOfferId.value))
const finalApplication = computed(() => props.caseData.bank_applications.find(application => (
  application.id === props.caseData.contract_application_id
)) ?? null)
const finalOffer = computed(() => finalApplication.value ? offerFor(finalApplication.value) : null)
const contractDescription = computed(() => (
  `Finalnym bankiem będzie ${contractToSign.value ? offerFor(contractToSign.value)?.bank_name ?? 'wybrany bank' : 'wybrany bank'}. Pozostałe aktywne wnioski zostaną zachowane w historii jako wycofane.`
))

watch(candidateItems, (items) => {
  if (!items.some(item => item.value === candidateOfferId.value)) {
    candidateOfferId.value = items[0]?.value ?? ''
  }
}, { immediate: true })

function offerFor(application: CaseBankApplication): SavedCaseOffer | null {
  return props.caseData.offers.find(offer => offer.id === application.offer_id) ?? null
}

function propertyFor(application: CaseBankApplication) {
  return props.caseData.properties.find(property => property.id === application.property_id) ?? null
}

function applicationMonthlyOutflow(application: CaseBankApplication) {
  return application.first_monthly_outflow ?? offerFor(application)?.first_monthly_outflow ?? null
}

function applicationGrossAmount(application: CaseBankApplication) {
  return application.gross_loan_amount ?? offerFor(application)?.loan_amount ?? null
}

function applicationNetAmount(application: CaseBankApplication) {
  return application.net_loan_amount ?? offerFor(application)?.loan_amount ?? null
}

function money(value: number | null | undefined, currency = 'PLN') {
  if (value == null) return '—'
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value))
}

function applicationStatus(status: MortgageApplicationStatus) {
  if (status === 'zaakceptowane') return { label: 'Decyzja pozytywna', color: 'success' as const, icon: 'i-lucide-circle-check-big' }
  if (status === 'odrzucone') return { label: 'Odrzucony', color: 'error' as const, icon: 'i-lucide-circle-x' }
  if (status === 'wycofane') return { label: 'Wycofany', color: 'neutral' as const, icon: 'i-lucide-circle-minus' }
  if (status === 'w_analizie') return { label: 'Analiza banku', color: 'info' as const, icon: 'i-lucide-search' }
  if (status === 'braki') return { label: 'Braki', color: 'warning' as const, icon: 'i-lucide-triangle-alert' }
  if (status === 'wyslane') return { label: 'Wysłany', color: 'primary' as const, icon: 'i-lucide-send' }
  return { label: 'Przygotowanie', color: 'neutral' as const, icon: 'i-lucide-file-pen-line' }
}

function propertyLabel(application: CaseBankApplication) {
  const property = propertyFor(application)
  if (!property) return 'Nieruchomość opcjonalna — możesz ją uzupełnić później'
  return property.listing_title || [property.address, property.city].filter(Boolean).join(', ')
}

function confirmDraftRemoval(application: CaseBankApplication) {
  draftToRemove.value = application
}

function confirmContractSigning(application: CaseBankApplication) {
  contractToSign.value = application
}

function canSelectFinalContract(application: CaseBankApplication) {
  return !props.caseData.contract_application_id
    && application.status_code === 'zaakceptowane'
    && application.mortgage_process?.stage === 'ready_for_contract'
}

async function addApplication() {
  if (!canCreateApplication.value || adding.value || props.caseData.bank_applications.length >= 3) return
  const offer = props.caseData.offers.find(item => item.id === candidateOfferId.value)
  if (!offer) return
  adding.value = true
  try {
    await ($fetch as any)(crmApiPath(`/cases/${props.caseData.id}/applications`), {
      method: 'POST',
      body: {
        offer_id: offer.id,
      },
    })
    emit('refresh')
    toast.add({
      title: 'Dodano bank do równoległych wniosków',
      description: `${offer.bank_name} · ${props.caseData.bank_applications.length + 1}/3`,
      color: 'success',
      icon: 'i-lucide-files',
    })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się dodać wniosku',
      description: apiErrorMessage(error) || 'Odśwież sprawę i spróbuj ponownie.',
      color: 'error',
    })
  }
  finally {
    adding.value = false
  }
}

async function focusApplication(application: CaseBankApplication) {
  if (focusingId.value) return
  focusingId.value = application.id
  try {
    if (props.caseData.selected_offer_id !== application.offer_id) {
      await ($fetch as any)(crmApiPath(`/cases/${props.caseData.id}/offers/selection`), {
        method: 'PUT',
        body: { offer_id: application.offer_id },
      })
      emit('refresh')
    }
    emit('openDocuments')
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się otworzyć wniosku',
      description: apiErrorMessage(error),
      color: 'error',
    })
  }
  finally {
    focusingId.value = ''
  }
}

async function removeDraft() {
  const application = draftToRemove.value
  if (!application || removingId.value) return
  removingId.value = application.id
  try {
    await ($fetch as any)(crmApiPath(`/cases/${props.caseData.id}/applications/${application.id}`), { method: 'DELETE' })
    draftToRemove.value = null
    emit('refresh')
    toast.add({ title: 'Usunięto roboczy wniosek', color: 'success' })
  }
  catch (error) {
    toast.add({ title: 'Nie udało się usunąć wniosku', description: apiErrorMessage(error), color: 'error' })
  }
  finally {
    removingId.value = ''
  }
}

async function signContract() {
  const application = contractToSign.value
  if (!application || signingId.value) return
  const offer = offerFor(application)
  signingId.value = application.id
  try {
    await ($fetch as any)(crmApiPath(`/cases/${props.caseData.id}/applications/final`), {
      method: 'PUT',
      body: { application_id: application.id },
    })
    contractToSign.value = null
    emit('refresh')
    toast.add({
      title: 'Zapisano podpisaną umowę',
      description: offer ? `${offer.bank_name} · pozostałe wnioski zostały wycofane` : undefined,
      color: 'success',
      icon: 'i-lucide-badge-check',
    })
  }
  catch (error) {
    toast.add({ title: 'Nie udało się zapisać umowy', description: apiErrorMessage(error), color: 'error' })
  }
  finally {
    signingId.value = ''
  }
}
</script>

<template>
  <UCard class="bank-applications" data-testid="case-bank-applications">
    <template #header>
      <div class="bank-applications__heading">
        <div>
          <p>Równoległy proces kredytowy</p>
          <h2>Wnioski bankowe <span>{{ caseData.bank_applications.length }}/3</span></h2>
          <small>Możesz prowadzić trzy banki jednocześnie. Podpisana umowa może być tylko jedna.</small>
        </div>
        <UBadge
          v-if="finalOffer"
          color="success"
          variant="subtle"
          icon="i-lucide-badge-check"
          size="lg"
        >
          Umowa: {{ finalOffer.bank_name }}
        </UBadge>
        <UBadge v-else color="neutral" variant="subtle" icon="i-lucide-pen-line" size="lg">
          Umowa jeszcze niewybrana
        </UBadge>
      </div>
    </template>

    <div v-if="caseData.bank_applications.length" class="bank-applications__grid">
      <article
        v-for="application in caseData.bank_applications"
        :key="application.id"
        class="bank-application"
        :class="{
          'bank-application--focused': application.offer_id === caseData.selected_offer_id,
          'bank-application--deep-linked': application.id === focusedApplicationId,
          'bank-application--contract': application.id === caseData.contract_application_id,
        }"
        :data-application-id="application.id"
      >
        <div class="bank-application__topline">
          <span>Wniosek {{ application.slot }}/3</span>
          <UBadge
            v-if="application.id === caseData.contract_application_id"
            color="success"
            variant="solid"
            icon="i-lucide-file-signature"
            size="xs"
          >
            Podpisana umowa
          </UBadge>
          <UBadge
            v-else
            :color="applicationStatus(application.status_code).color"
            variant="subtle"
            :icon="applicationStatus(application.status_code).icon"
            size="xs"
          >
            {{ applicationStatus(application.status_code).label }}
          </UBadge>
        </div>

        <div class="bank-application__identity">
          <span class="bank-application__logo">
            <img
              v-if="offerFor(application)?.bank_logo_url"
              :src="offerFor(application)?.bank_logo_url ?? undefined"
              :alt="`Logo ${offerFor(application)?.bank_name}`"
            >
            <UIcon v-else name="i-lucide-landmark" />
          </span>
          <div>
            <strong>{{ offerFor(application)?.bank_name ?? 'Bank' }}</strong>
            <small>{{ offerFor(application)?.product_name ?? 'Oferta kredytowa' }}</small>
          </div>
        </div>

        <dl>
          <div><dt>Rata z kosztami</dt><dd>{{ money(applicationMonthlyOutflow(application), offerFor(application)?.currency) }}</dd></div>
          <div><dt>Saldo brutto</dt><dd>{{ money(applicationGrossAmount(application), offerFor(application)?.currency) }}</dd><small v-if="application.gross_loan_amount != null && application.net_loan_amount != null">netto {{ money(applicationNetAmount(application), offerFor(application)?.currency) }}</small></div>
        </dl>

        <p class="bank-application__property"><UIcon name="i-lucide-house" />{{ propertyLabel(application) }}</p>

        <div class="bank-application__actions">
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            icon="i-lucide-folder-open"
            :loading="focusingId === application.id"
            :disabled="Boolean(focusingId)"
            @click="focusApplication(application)"
          >
            Dokumenty
          </UButton>
          <UButton
            v-if="canSelectFinalContract(application)"
            color="success"
            variant="soft"
            size="sm"
            icon="i-lucide-file-signature"
            @click="confirmContractSigning(application)"
          >
            Wybierz umowę finalną
          </UButton>
          <UButton
            v-if="!caseData.contract_application_id && application.status_code === 'draft'"
            color="error"
            variant="ghost"
            size="sm"
            icon="i-lucide-trash-2"
            aria-label="Usuń roboczy wniosek"
            @click="confirmDraftRemoval(application)"
          />
        </div>
      </article>
    </div>

    <div v-else class="bank-applications__empty">
      <span><UIcon name="i-lucide-files" /></span>
      <div>
        <strong>Nie uruchomiono jeszcze wniosku bankowego</strong>
        <small>Nowa oferta tworzy szkic automatycznie. Wcześniej zapisaną ofertę możesz dodać poniżej.</small>
      </div>
    </div>

    <div v-if="!caseData.contract_application_id && caseData.bank_applications.length < 3" class="bank-applications__add">
      <div>
        <strong>Dodaj kolejny bank</strong>
        <small>{{ 3 - caseData.bank_applications.length }} {{ 3 - caseData.bank_applications.length === 1 ? 'wolny slot' : 'wolne sloty' }}</small>
      </div>
      <USelectMenu
        v-if="candidateItems.length"
        v-model="candidateOfferId"
        :items="candidateItems"
        value-key="value"
        placeholder="Wybierz ofertę z shortlisty"
        class="bank-applications__select"
      />
      <UButton
        v-if="candidateItems.length"
        icon="i-lucide-plus"
        :loading="adding"
        :disabled="!canCreateApplication"
        @click="addApplication"
      >
        Dodaj do wniosków
      </UButton>
      <small v-if="!candidateItems.length && incompleteOfferCount">
        {{ incompleteOfferCount }} {{ incompleteOfferCount === 1 ? 'wariant wymaga' : 'warianty wymagają' }}
        poprawienia warunków oferty przed uruchomieniem wniosku.
      </small>
      <UButton
        v-if="!candidateItems.length"
        :to="{ path: orgPath('/calculator/mortgages'), query: { caseId: caseData.id } }"
        color="neutral"
        variant="outline"
        icon="i-lucide-bookmark-plus"
      >
        Dodaj ofertę do shortlisty
      </UButton>
    </div>

    <template #footer>
      <p class="bank-applications__note">
        <UIcon name="i-lucide-info" />
        Przełączanie dokumentów lub statusu nie wybiera banku finalnego. Umowa jest zapisywana dopiero jawną akcją po pozytywnej decyzji.
      </p>
    </template>
  </UCard>

  <UModal
    :open="Boolean(draftToRemove)"
    title="Usunąć roboczy wniosek?"
    description="Oferta pozostanie na shortliście. Usunięty zostanie tylko nierozpoczęty proces bankowy."
    :dismissible="!removingId"
    :ui="{ footer: 'justify-end' }"
    @update:open="draftToRemove = $event ? draftToRemove : null"
  >
    <template #footer="{ close }">
      <UButton color="neutral" variant="outline" :disabled="Boolean(removingId)" @click="close">Anuluj</UButton>
      <UButton color="error" icon="i-lucide-trash-2" :loading="Boolean(removingId)" @click="removeDraft">Usuń wniosek</UButton>
    </template>
  </UModal>

  <UModal
    :open="Boolean(contractToSign)"
    title="Potwierdź podpisaną umowę"
    :description="contractDescription"
    :dismissible="!signingId"
    :ui="{ footer: 'justify-end' }"
    @update:open="contractToSign = $event ? contractToSign : null"
  >
    <template #body>
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-file-lock-2"
        title="Ta akcja jest finalna"
        description="W jednej sprawie można zapisać tylko jedną podpisaną umowę kredytową."
      />
    </template>
    <template #footer="{ close }">
      <UButton color="neutral" variant="outline" :disabled="Boolean(signingId)" @click="close">Anuluj</UButton>
      <UButton color="success" icon="i-lucide-file-signature" :loading="Boolean(signingId)" @click="signContract">Potwierdź podpis</UButton>
    </template>
  </UModal>
</template>

<style scoped>
.bank-applications { margin-block: 18px; }
.bank-applications__heading, .bank-applications__topline, .bank-application__identity, .bank-application__actions, .bank-applications__add, .bank-applications__empty, .bank-applications__note { display: flex; align-items: center; }
.bank-applications__heading { justify-content: space-between; gap: 18px; }
.bank-applications__heading > div:first-child { display: grid; gap: 3px; }
.bank-applications__heading p, .bank-applications__heading h2, .bank-applications__heading small, .bank-application p, .bank-applications__note { margin: 0; }
.bank-applications__heading p { color: var(--ui-primary); font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.bank-applications__heading h2 { color: var(--ui-text-highlighted); font-size: 18px; }
.bank-applications__heading h2 span { color: var(--ui-primary); font-family: var(--font-mono); }
.bank-applications__heading small, .bank-applications__empty small, .bank-applications__add small, .bank-applications__note { color: var(--ui-text-muted); font-size: 11px; }
.bank-applications__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.bank-application { display: grid; gap: 12px; min-width: 0; padding: 14px; border: 1px solid var(--ui-border); border-radius: 12px; background: var(--ui-bg); }
.bank-application--focused { border-color: color-mix(in srgb, var(--ui-primary) 58%, var(--ui-border)); box-shadow: inset 3px 0 var(--ui-primary); }
.bank-application--deep-linked { border-color: color-mix(in srgb, var(--ui-warning) 70%, var(--ui-border)); box-shadow: inset 3px 0 var(--ui-warning), 0 0 0 2px color-mix(in srgb, var(--ui-warning) 16%, transparent); }
.bank-application--contract { border-color: color-mix(in srgb, var(--ui-success) 68%, var(--ui-border)); background: color-mix(in srgb, var(--ui-success) 5%, var(--ui-bg)); box-shadow: inset 3px 0 var(--ui-success); }
.bank-applications__topline { justify-content: space-between; gap: 8px; }
.bank-applications__topline > span:first-child { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; }
.bank-application__identity { gap: 9px; min-width: 0; }
.bank-application__logo { display: grid; flex: 0 0 auto; place-items: center; width: 36px; height: 36px; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 9px; background: #fff; color: var(--ui-text-muted); }
.bank-application__logo img { width: 100%; height: 100%; padding: 4px; object-fit: contain; }
.bank-application__identity > div { display: grid; min-width: 0; }
.bank-application__identity strong, .bank-application__identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bank-application__identity strong { color: var(--ui-text-highlighted); font-size: 13px; }
.bank-application__identity small, .bank-application dt, .bank-application__property { color: var(--ui-text-muted); font-size: 10px; }
.bank-application dl { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0; }
.bank-application dl > div { display: grid; gap: 2px; }
.bank-application dd { margin: 0; color: var(--ui-text-highlighted); font-size: 12px; font-weight: 650; }
.bank-application__property { display: flex; align-items: flex-start; gap: 6px; min-height: 28px; line-height: 1.4; }
.bank-application__property svg { flex: 0 0 auto; margin-top: 1px; }
.bank-application__actions { flex-wrap: wrap; gap: 6px; margin-top: auto; }
.bank-applications__empty { gap: 12px; min-height: 108px; justify-content: center; padding: 20px; border: 1px dashed var(--ui-border); border-radius: 12px; background: var(--ui-bg-muted); }
.bank-applications__empty > span { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 11px; background: var(--ui-bg); color: var(--ui-primary); font-size: 21px; }
.bank-applications__empty > div, .bank-applications__add > div { display: grid; gap: 2px; }
.bank-applications__empty strong, .bank-applications__add strong { color: var(--ui-text-highlighted); font-size: 12px; }
.bank-applications__add { gap: 10px; margin-top: 14px; padding: 12px; border: 1px dashed var(--ui-border-accented); border-radius: 11px; background: var(--ui-bg-muted); }
.bank-applications__add > div { margin-right: auto; }
.bank-applications__select { width: min(330px, 100%); }
.bank-applications__note { gap: 7px; }
.bank-applications__note svg { flex: 0 0 auto; }
@media (max-width: 980px) { .bank-applications__grid { grid-template-columns: 1fr; } }
@media (max-width: 680px) { .bank-applications__heading, .bank-applications__add { align-items: stretch; flex-direction: column; } .bank-applications__add > div { margin-right: 0; } .bank-applications__select { width: 100%; } }
</style>
