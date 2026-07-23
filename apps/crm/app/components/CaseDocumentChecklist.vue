<script setup lang="ts">
import type {
  CaseBankApplication,
  CaseDetail,
  CaseDocument,
  DocumentRequirement,
  SavedCaseOffer,
} from '~/types/cases'
import {
  applicableDocumentRequirements,
  documentRequirementIsRequired,
} from '#shared/document-requirements'

const props = withDefaults(defineProps<{
  caseData: CaseDetail
  compact?: boolean
}>(), {
  compact: false,
})

const emit = defineEmits<{
  refresh: []
}>()

const { crmApiPath } = useOrganizationContext()
const toast = useToast()
const selectedApplicationId = ref('')
const selectedDocumentType = ref('')
const selectedClientId = ref('')
const uploadInput = ref<HTMLInputElement | null>(null)
const uploadPanel = ref<HTMLElement | null>(null)
const uploadFile = ref<File | null>(null)
const uploading = ref(false)
const removingDocumentIds = ref<string[]>([])

const applications = computed(() => [...props.caseData.bank_applications]
  .sort((left, right) => left.slot - right.slot))

const selectedApplication = computed<CaseBankApplication | null>(() => (
  applications.value.find(application => application.id === selectedApplicationId.value)
  ?? applications.value[0]
  ?? null
))

const selectedOffer = computed<SavedCaseOffer | null>(() => (
  props.caseData.offers.find(offer => offer.id === selectedApplication.value?.offer_id)
  ?? null
))

const configuredRequirements = computed<DocumentRequirement[]>(() => {
  const value = selectedOffer.value?.catalog_snapshot?.version?.document_requirements
  return Array.isArray(value) ? value as DocumentRequirement[] : []
})

const requirements = computed<DocumentRequirement[]>(() => applicableDocumentRequirements(
  configuredRequirements.value,
  selectedApplication.value?.scenario_snapshot ?? selectedOffer.value?.scenario_snapshot,
))

const uploadableRequirements = computed(() => requirements.value.filter(requirement => (
  requirement.itemKind === 'client_document'
  || (requirement.itemKind === 'bank_document' && !requirement.templateId)
)))

const uploadTypeItems = computed(() => uploadableRequirements.value.map(requirement => ({
  label: requirement.label,
  description: `${categoryLabel(requirement.category)} · ${scopeLabel(requirement.scope)}`,
  value: requirement.code,
})))

const selectedRequirement = computed(() => (
  requirements.value.find(requirement => requirement.code === selectedDocumentType.value) ?? null
))

const uploadAccept = computed(() => (
  selectedRequirement.value?.allowedMimeTypes?.length
    ? selectedRequirement.value.allowedMimeTypes.join(',')
    : 'application/pdf,image/jpeg,image/png'
))

function requirementAcceptsUpload(requirement: DocumentRequirement) {
  return requirement.itemKind === 'client_document'
    || (requirement.itemKind === 'bank_document' && !requirement.templateId)
}

const clientItems = computed(() => props.caseData.clients.map(client => ({
  label: client.display_name,
  value: client.id,
})))

const requirementClientItems = computed(() => {
  if (selectedRequirement.value?.scope !== 'primary_applicant') return clientItems.value
  const primary = props.caseData.clients.find(client => client.is_primary) ?? props.caseData.clients[0]
  return primary ? [{ label: primary.display_name, value: primary.id }] : []
})

const multiformTemplateIds = computed<string[]>(() => {
  const fromVersion = selectedOffer.value?.catalog_snapshot?.version?.multiform_template_ids
  const fromRequirements = requirements.value
    .map(requirement => requirement.templateId)
    .filter((id): id is string => Boolean(id))
  return [...new Set([
    ...(Array.isArray(fromVersion) ? fromVersion.filter((id): id is string => typeof id === 'string') : []),
    ...fromRequirements,
  ])]
})

const requiredRequirements = computed(() => requirements.value.filter(requirement => (
  documentRequirementIsRequired(requirement)
  && requirementAcceptsUpload(requirement)
)))

const requiredUploadProgress = computed(() => requiredRequirements.value.reduce((progress, requirement) => {
  const documents = matchingDocuments(requirement)
  if (requirement.scope === 'case') {
    progress.total += 1
    if (documents.length > 0) progress.satisfied += 1
    return progress
  }

  const relevantClients = requirement.scope === 'primary_applicant'
    ? props.caseData.clients.filter(client => client.is_primary).slice(0, 1)
    : props.caseData.clients
  progress.total += relevantClients.length
  progress.satisfied += relevantClients.filter(client => (
    documents.some(document => document.client_id === client.id)
  )).length
  return progress
}, { satisfied: 0, total: 0 }))

watch(() => props.caseData.selected_offer_id, (offerId) => {
  const focusedApplication = applications.value.find(application => application.offer_id === offerId)
  if (focusedApplication) selectedApplicationId.value = focusedApplication.id
}, { immediate: true })

watch(() => props.caseData.bank_applications.map(application => `${application.id}:${application.offer_id}:${application.slot}`).join('|'), () => {
  if (applications.value.some(application => application.id === selectedApplicationId.value)) return
  const focusedApplication = applications.value.find(application => (
    application.offer_id === props.caseData.selected_offer_id
  ))
  selectedApplicationId.value = focusedApplication?.id ?? applications.value[0]?.id ?? ''
}, { immediate: true })

watch(uploadTypeItems, (items) => {
  if (!items.some(item => item.value === selectedDocumentType.value)) {
    selectedDocumentType.value = items[0]?.value ?? ''
  }
}, { immediate: true })

watch(selectedRequirement, (requirement) => {
  if (requirement?.scope === 'primary_applicant') {
    selectedClientId.value = props.caseData.clients.find(client => client.is_primary)?.id
      ?? props.caseData.clients[0]?.id
      ?? ''
  }
  else if (requirement?.scope === 'each_applicant' && !selectedClientId.value) {
    selectedClientId.value = props.caseData.clients[0]?.id ?? ''
  }
  else if (requirement?.scope === 'case') {
    selectedClientId.value = ''
  }
}, { immediate: true })

function matchingDocuments(requirement: DocumentRequirement): CaseDocument[] {
  return props.caseData.documents.filter(document => (
    document.document_type === requirement.code
    && (requirement.itemKind === 'bank_document'
      ? document.submission_id === selectedApplication.value?.id
      : requirement.itemKind === 'client_document'
        ? document.submission_id === null
        : false)
  ))
}

function offerFor(application: CaseBankApplication): SavedCaseOffer | null {
  return props.caseData.offers.find(offer => offer.id === application.offer_id) ?? null
}

function applicationStatusLabel(status: CaseBankApplication['status_code']) {
  return ({
    draft: 'przygotowanie',
    wyslane: 'wysłany do banku',
    w_analizie: 'analiza banku',
    braki: 'braki do uzupełnienia',
    zaakceptowane: 'decyzja pozytywna',
    odrzucone: 'decyzja negatywna',
    wycofane: 'wycofany',
  })[status]
}

function requirementClients(requirement: DocumentRequirement) {
  if (requirement.scope === 'case') return []
  if (requirement.scope === 'primary_applicant') {
    const primary = props.caseData.clients.find(client => client.is_primary) ?? props.caseData.clients[0]
    return primary ? [primary] : []
  }
  return props.caseData.clients
}

function clientDocuments(requirement: DocumentRequirement, clientId: string) {
  return matchingDocuments(requirement).filter(document => document.client_id === clientId)
}

function requirementIsSatisfied(requirement: DocumentRequirement) {
  const documents = matchingDocuments(requirement)
  if (requirement.scope === 'case') return documents.length > 0
  const relevantClients = requirement.scope === 'primary_applicant'
    ? props.caseData.clients.filter(client => client.is_primary).slice(0, 1)
    : props.caseData.clients
  return relevantClients.length > 0 && relevantClients.every(client => (
    documents.some(document => document.client_id === client.id)
  ))
}

function documentOwner(document: CaseDocument) {
  if (!document.client_id) return ''
  return props.caseData.clients.find(client => client.id === document.client_id)?.display_name ?? ''
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    application: 'Wniosek bankowy',
    identity: 'Tożsamość',
    income_employment: 'Dochód z pracy',
    income_business: 'Działalność gospodarcza',
    income_other: 'Inne dochody',
    liabilities: 'Zobowiązania',
    transaction: 'Transakcja',
    property_legal: 'Nieruchomość',
    valuation: 'Wycena',
    construction_renovation: 'Budowa / remont',
    refinance_discharge: 'Refinansowanie',
    insurance_security: 'Zabezpieczenia',
    disbursement: 'Wypłata',
    disclosure_privacy: 'Informacje i zgody',
    other: 'Inne',
  }
  return labels[category] ?? category
}

function scopeLabel(scope: DocumentRequirement['scope']) {
  return ({
    case: 'dla sprawy',
    primary_applicant: 'główny wnioskodawca',
    each_applicant: 'każdy wnioskodawca',
  })[scope]
}

function applicabilityLabel(requirement: DocumentRequirement) {
  if (requirement.applicability === 'conditional') {
    return requirement.when
      ? requirement.required ? 'wymagany w tym wariancie' : 'dotyczy tego wariantu'
      : 'do potwierdzenia'
  }
  if (requirement.applicability === 'optional') return 'opcjonalny'
  if (requirement.applicability === 'case_requested') return 'na żądanie banku'
  return requirement.required ? 'wymagany' : 'opcjonalny'
}

function evidenceLabel(evidence: DocumentRequirement['evidence']) {
  return ({
    confirmed_bank_source: 'potwierdzone przez bank',
    inferred: 'wynika z materiałów',
    expert_default: 'standard eksperta',
    organization_custom: 'reguła organizacji',
  })[evidence]
}

function requirementState(requirement: DocumentRequirement) {
  const documents = matchingDocuments(requirement)
  if (documents.length) {
    if (requirement.scope === 'each_applicant' && !requirementIsSatisfied(requirement)) {
      const covered = new Set(documents.map(document => document.client_id).filter(Boolean)).size
      return { label: `${covered}/${props.caseData.clients.length} osób`, color: 'warning' as const, icon: 'i-lucide-users-round' }
    }
    const relevantClients = requirement.scope === 'case'
      ? []
      : requirement.scope === 'primary_applicant'
        ? props.caseData.clients.filter(client => client.is_primary).slice(0, 1)
        : props.caseData.clients
    const verified = requirement.scope === 'case'
      ? documents.some(document => document.status_code === 'verified' || document.verified_at)
      : relevantClients.length > 0 && relevantClients.every(client => documents.some(document => (
          document.client_id === client.id
          && (document.status_code === 'verified' || document.verified_at)
        )))
    if (verified) {
      return { label: 'Zweryfikowano', color: 'success' as const, icon: 'i-lucide-badge-check' }
    }
    return { label: `${documents.length} załączono`, color: 'info' as const, icon: 'i-lucide-paperclip' }
  }
  if (requirement.itemKind === 'bank_document' && requirement.templateId) {
    return { label: 'Wygeneruje Multiwniosek', color: 'primary' as const, icon: 'i-lucide-wand-sparkles' }
  }
  if (requirement.itemKind === 'manual_action') {
    return { label: 'Czynność ręczna', color: 'neutral' as const, icon: 'i-lucide-list-checks' }
  }
  if (requirement.itemKind === 'external_check') {
    return { label: 'Weryfikacja zewnętrzna', color: 'neutral' as const, icon: 'i-lucide-search-check' }
  }
  if (requirement.applicability === 'conditional' && !requirement.when) {
    return { label: 'Do potwierdzenia', color: 'warning' as const, icon: 'i-lucide-circle-help' }
  }
  if (requirement.applicability === 'case_requested') {
    return { label: 'Na żądanie banku', color: 'neutral' as const, icon: 'i-lucide-circle-help' }
  }
  return { label: requirement.required ? 'Brakuje' : 'Opcjonalny', color: requirement.required ? 'error' as const : 'neutral' as const, icon: requirement.required ? 'i-lucide-circle-alert' : 'i-lucide-circle-dashed' }
}

function missingDocumentState(requirement: DocumentRequirement) {
  if (documentRequirementIsRequired(requirement)) {
    return { label: 'Brakuje', color: 'error' as const }
  }
  if (requirement.applicability === 'conditional' && !requirement.when) {
    return { label: 'Do potwierdzenia', color: 'warning' as const }
  }
  if (requirement.applicability === 'case_requested') {
    return { label: 'Na żądanie', color: 'neutral' as const }
  }
  return { label: 'Opcjonalny', color: 'neutral' as const }
}

function previewApplication(applicationId: string) {
  selectedApplicationId.value = applicationId
  uploadFile.value = null
  if (uploadInput.value) uploadInput.value.value = ''
}

async function prepareUpload(requirement: DocumentRequirement, clientId = '') {
  selectedDocumentType.value = requirement.code
  selectedClientId.value = requirement.scope === 'case'
    ? ''
    : clientId
      || requirementClients(requirement).find(client => !clientDocuments(requirement, client.id).length)?.id
      || requirementClients(requirement)[0]?.id
      || ''
  await nextTick()
  uploadPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  uploadInput.value?.focus()
}

function onFileSelected(event: Event) {
  uploadFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

async function uploadDocument() {
  if (!selectedApplication.value || !selectedOffer.value || !selectedRequirement.value || !uploadFile.value) return
  if (selectedRequirement.value.scope !== 'case' && !selectedClientId.value) {
    toast.add({ title: 'Wybierz wnioskodawcę', color: 'warning' })
    return
  }

  uploading.value = true
  try {
    const body = new FormData()
    body.append('file', uploadFile.value)
    body.append('documentType', selectedRequirement.value.code)
    body.append('offerId', selectedOffer.value.id)
    if (selectedClientId.value) body.append('clientId', selectedClientId.value)
    await $fetch(crmApiPath(`/cases/${props.caseData.id}/documents`), {
      method: 'POST',
      body,
    })
    uploadFile.value = null
    if (uploadInput.value) uploadInput.value.value = ''
    emit('refresh')
    toast.add({ title: 'Dodano dokument', description: selectedRequirement.value.label, color: 'success' })
  }
  catch (caught: any) {
    toast.add({
      title: 'Nie udało się dodać dokumentu',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  }
  finally {
    uploading.value = false
  }
}

async function removeDocument(document: CaseDocument) {
  if (removingDocumentIds.value.includes(document.id)) return
  removingDocumentIds.value = [...removingDocumentIds.value, document.id]
  try {
    await $fetch(crmApiPath(`/cases/${props.caseData.id}/documents/${document.id}`), { method: 'DELETE' })
    emit('refresh')
    toast.add({ title: 'Usunięto dokument', color: 'success' })
  }
  catch (caught: any) {
    toast.add({
      title: 'Nie udało się usunąć dokumentu',
      description: caught?.data?.statusMessage ?? caught?.message,
      color: 'error',
    })
  }
  finally {
    removingDocumentIds.value = removingDocumentIds.value.filter(id => id !== document.id)
  }
}

function documentDownloadUrl(documentId: string) {
  return crmApiPath(`/cases/${props.caseData.id}/documents/${documentId}`)
}
</script>

<template>
  <UCard
    v-if="applications.length"
    :class="['document-checklist', { 'document-checklist--compact': compact }]"
    data-testid="case-document-checklist"
  >
    <template #header>
      <div class="checklist-head">
        <div>
          <p>{{ applications.length }}/3 banków w procesie</p>
          <h2>Checklista dokumentów</h2>
        </div>
        <div v-if="requiredUploadProgress.total" class="checklist-progress">
          <strong>{{ requiredUploadProgress.satisfied }}/{{ requiredUploadProgress.total }}</strong>
          <span>obowiązkowych plików</span>
        </div>
      </div>
    </template>

    <div class="offer-tabs" role="tablist" aria-label="Wniosek bankowy dla checklisty">
      <button
        v-for="application in applications"
        :key="application.id"
        type="button"
        role="tab"
        :aria-selected="application.id === selectedApplication?.id"
        :class="['offer-tab', { active: application.id === selectedApplication?.id }]"
        @click="previewApplication(application.id)"
      >
        <span>Wniosek {{ application.slot }} · {{ offerFor(application)?.bank_name ?? 'Bank' }}</span>
        <strong>{{ offerFor(application)?.product_name ?? 'Oferta niedostępna' }}</strong>
        <small>
          {{ applicationStatusLabel(application.status_code) }}<template v-if="application.offer_id === caseData.selected_offer_id"> · otwarty teraz</template>
        </small>
      </button>
    </div>

    <UAlert
      v-if="!selectedOffer"
      class="checklist-context-alert"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Nie można odczytać oferty tego wniosku"
      description="Odśwież sprawę albo sprawdź, czy zapisana oferta nadal istnieje."
    />

    <UAlert
      v-else-if="configuredRequirements.length && !requirements.length"
      class="checklist-context-alert"
      color="success"
      variant="subtle"
      icon="i-lucide-list-checks"
      title="Wybrany wariant nie wymaga dodatkowych dokumentów"
      description="Warunkowe pozycje tej oferty nie dotyczą opcji zapisanych w scenariuszu wniosku."
    />

    <UAlert
      v-else-if="!configuredRequirements.length"
      class="checklist-context-alert"
      color="warning"
      variant="subtle"
      icon="i-lucide-list-x"
      title="Ten wniosek nie ma jeszcze checklisty"
      description="Administrator może dodać typy dokumentów w katalogu produktów hipotecznych."
    />

    <UAlert
      v-if="selectedOffer"
      class="checklist-context-alert"
      color="info"
      variant="subtle"
      icon="i-lucide-folders"
      title="Dokumenty klienta dodajesz tylko raz"
      description="Dokumenty wnioskodawców są wspólne dla wszystkich banków. Pliki bankowe pozostają przypisane wyłącznie do otwartego wniosku."
    />

    <div v-if="selectedOffer && requirements.length" class="requirements">
      <article v-for="requirement in requirements" :key="requirement.code" class="requirement-row">
        <span class="requirement-icon"><UIcon :name="requirementState(requirement).icon" /></span>
        <div class="requirement-copy">
          <div>
            <strong>{{ requirement.label }}</strong>
            <div class="requirement-actions">
              <UBadge :color="requirementState(requirement).color" variant="subtle" size="xs">
                {{ requirementState(requirement).label }}
              </UBadge>
              <UButton
                v-if="requirementAcceptsUpload(requirement) && requirement.scope === 'case' && (!matchingDocuments(requirement).length || requirement.multiple)"
                color="neutral"
                variant="soft"
                size="xs"
                icon="i-lucide-paperclip"
                @click="prepareUpload(requirement)"
              >
                Dodaj plik
              </UButton>
            </div>
          </div>
          <p>{{ categoryLabel(requirement.category) }} · {{ scopeLabel(requirement.scope) }} · {{ applicabilityLabel(requirement) }}</p>
          <small>{{ evidenceLabel(requirement.evidence) }}<template v-if="requirement.notes"> · {{ requirement.notes }}</template></small>
          <div v-if="requirementAcceptsUpload(requirement) && requirement.scope !== 'case'" class="applicant-document-list">
            <div v-for="client in requirementClients(requirement)" :key="client.id" class="applicant-document-row">
              <span class="applicant-document-row__person">
                <UIcon name="i-lucide-user-round" />
                <strong>{{ client.display_name }}</strong>
              </span>
              <div v-if="clientDocuments(requirement, client.id).length" class="applicant-document-row__files">
                <span
                  v-for="document in clientDocuments(requirement, client.id)"
                  :key="document.id"
                  class="applicant-document-file"
                >
                  <UIcon name="i-lucide-file-check-2" />
                  <span>{{ document.name }}</span>
                  <a :href="documentDownloadUrl(document.id)" target="_blank" rel="noopener">Pobierz</a>
                  <button type="button" :disabled="removingDocumentIds.includes(document.id)" @click="removeDocument(document)">
                    Usuń
                  </button>
                </span>
              </div>
              <UBadge v-else :color="missingDocumentState(requirement).color" variant="subtle" size="xs">
                {{ missingDocumentState(requirement).label }}
              </UBadge>
              <UButton
                v-if="!clientDocuments(requirement, client.id).length || requirement.multiple"
                color="neutral"
                variant="soft"
                size="xs"
                :icon="clientDocuments(requirement, client.id).length ? 'i-lucide-plus' : 'i-lucide-upload'"
                @click="prepareUpload(requirement, client.id)"
              >
                {{ clientDocuments(requirement, client.id).length ? 'Dodaj kolejny' : 'Dodaj plik' }}
              </UButton>
            </div>
          </div>
          <div v-else-if="matchingDocuments(requirement).length" class="attached-files">
            <div v-for="document in matchingDocuments(requirement)" :key="document.id">
              <UIcon name="i-lucide-file-check-2" />
              <span>{{ document.name }}</span>
              <small v-if="documentOwner(document)">{{ documentOwner(document) }}</small>
              <a :href="documentDownloadUrl(document.id)" target="_blank" rel="noopener">Pobierz</a>
              <button type="button" :disabled="removingDocumentIds.includes(document.id)" @click="removeDocument(document)">
                Usuń
              </button>
            </div>
          </div>
        </div>
      </article>
    </div>

    <div v-if="uploadableRequirements.length" ref="uploadPanel" class="upload-panel">
      <div class="upload-panel__heading">
        <UIcon name="i-lucide-paperclip" />
        <div>
          <strong>Dodaj dokument do otwartego wniosku</strong>
          <small>Dokument klienta będzie wspólny dla banków, a dokument bankowy trafi tylko tutaj · PDF, JPG lub PNG · maksymalnie 25 MB</small>
        </div>
      </div>
      <UFormField label="Typ dokumentu">
        <USelectMenu
          v-model="selectedDocumentType"
          :items="uploadTypeItems"
          value-key="value"
          label-key="label"
          aria-label="Typ dokumentu"
          placeholder="Wybierz typ dokumentu"
          class="w-full"
        />
      </UFormField>
      <UFormField
        v-if="selectedRequirement && selectedRequirement.scope !== 'case'"
        label="Wnioskodawca"
      >
        <USelectMenu
          v-model="selectedClientId"
          :items="requirementClientItems"
          value-key="value"
          label-key="label"
          aria-label="Wnioskodawca"
          placeholder="Wybierz wnioskodawcę"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Plik">
        <input ref="uploadInput" type="file" :accept="uploadAccept" @change="onFileSelected">
      </UFormField>
      <UButton
        icon="i-lucide-upload"
        :loading="uploading"
        :disabled="!uploadFile || !selectedDocumentType || (selectedRequirement?.scope !== 'case' && !selectedClientId)"
        @click="uploadDocument"
      >
        Załącz dokument
      </UButton>
    </div>

    <template #footer>
      <div class="checklist-footer">
        <p v-if="requiredUploadProgress.satisfied < requiredUploadProgress.total">
          Brakuje {{ requiredUploadProgress.total - requiredUploadProgress.satisfied }} wymaganych {{ requiredUploadProgress.total - requiredUploadProgress.satisfied === 1 ? 'plik' : 'plików' }}. Dodaj je przed uruchomieniem formularzy.
        </p>
        <p v-else-if="multiformTemplateIds.length">
          Multiwniosek sprawdzi mapowanie {{ multiformTemplateIds.length }} {{ multiformTemplateIds.length === 1 ? 'formularza bankowego' : 'formularzy bankowych' }}, a po zatwierdzeniu dołączy wybrane załączniki do ZIP-a.
        </p>
        <p v-else>Brak powiązanego szablonu Multiwniosku. Załączniki nadal pozostają w teczce sprawy.</p>
        <UButton
          v-if="multiformTemplateIds.length && requiredUploadProgress.satisfied >= requiredUploadProgress.total"
          to="#case-applications"
          icon="i-lucide-wand-sparkles"
          trailing-icon="i-lucide-arrow-down"
        >
          Przejdź do wspólnego formularza w CRM
        </UButton>
        <UButton
          v-else-if="multiformTemplateIds.length"
          icon="i-lucide-wand-sparkles"
          disabled
        >
          Uzupełnij wnioski i przygotuj ZIP
        </UButton>
      </div>
    </template>
  </UCard>
</template>

<style scoped>
.document-checklist { margin: 20px 0; }
.document-checklist--compact .requirements { max-height: 460px; overflow-y: auto; padding-right: 3px; }
.checklist-head, .checklist-footer, .upload-panel__heading, .requirement-row, .attached-files>div { display: flex; align-items: center; }
.checklist-head, .checklist-footer { justify-content: space-between; gap: 18px; }
.checklist-head p, .checklist-head h2, .checklist-footer p { margin: 0; }
.checklist-head p { color: var(--ui-primary); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.checklist-head h2 { margin-top: 3px; color: var(--ui-text-highlighted); font-size: 18px; }
.checklist-progress { display: grid; justify-items: end; }
.checklist-progress strong { color: var(--ui-text-highlighted); font-size: 19px; }
.checklist-progress span, .checklist-footer p { color: var(--ui-text-muted); font-size: 11px; }
.offer-tabs { display: flex; gap: 8px; margin-bottom: 16px; overflow-x: auto; padding-bottom: 3px; }
.checklist-context-alert { margin-bottom: 16px; }
.offer-tab { display: grid; flex: 0 0 min(230px, 75vw); gap: 2px; padding: 11px 13px; border: 1px solid var(--ui-border); border-radius: 10px; background: var(--ui-bg); color: inherit; text-align: left; cursor: pointer; }
.offer-tab:hover, .offer-tab:focus-visible { border-color: var(--ui-primary); outline: none; }
.offer-tab.active { border-color: var(--ui-primary); background: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg)); box-shadow: inset 0 0 0 1px var(--ui-primary); }
.offer-tab span, .offer-tab small { color: var(--ui-text-muted); font-size: 10px; }
.offer-tab strong { color: var(--ui-text-highlighted); font-size: 12px; }
.offer-tab small { color: var(--ui-primary); font-weight: 700; }
.requirements { display: grid; gap: 8px; }
.requirement-row { align-items: flex-start; gap: 11px; padding: 12px; border: 1px solid var(--ui-border); border-radius: 10px; }
.requirement-icon { display: grid; flex: 0 0 auto; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: var(--ui-bg-muted); color: var(--ui-primary); }
.requirement-copy { display: grid; flex: 1; gap: 3px; min-width: 0; }
.requirement-copy>div:first-child { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.requirement-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 7px; }
.requirement-copy strong { color: var(--ui-text-highlighted); font-size: 13px; }
.requirement-copy p, .requirement-copy small { margin: 0; color: var(--ui-text-muted); font-size: 11px; }
.attached-files { display: grid; gap: 5px; margin-top: 7px; }
.attached-files>div { gap: 7px; padding: 7px 9px; border-radius: 7px; background: var(--ui-bg-muted); font-size: 10px; }
.attached-files span { flex: 1; min-width: 0; overflow: hidden; color: var(--ui-text-highlighted); text-overflow: ellipsis; white-space: nowrap; }
.attached-files a, .attached-files button { border: 0; background: none; color: var(--ui-primary); cursor: pointer; font: inherit; }
.attached-files button { color: var(--ui-error); }
.applicant-document-list { display: grid; gap: 6px; margin-top: 8px; }
.applicant-document-row { display: grid; grid-template-columns: minmax(150px, .8fr) minmax(240px, 1.8fr) auto; align-items: center; gap: 10px; padding: 8px 9px; border-radius: 8px; background: var(--ui-bg-muted); }
.applicant-document-row__person { display: flex; align-items: center; gap: 7px; min-width: 0; }
.applicant-document-row__person>svg { flex: 0 0 auto; color: var(--ui-text-muted); }
.applicant-document-row__person strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.applicant-document-row__files { display: grid; gap: 4px; min-width: 0; }
.applicant-document-file { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 10px; }
.applicant-document-file>span { flex: 1; min-width: 0; overflow: hidden; color: var(--ui-text-highlighted); text-overflow: ellipsis; white-space: nowrap; }
.applicant-document-file>a, .applicant-document-file>button { flex: 0 0 auto; border: 0; background: none; color: var(--ui-primary); cursor: pointer; font: inherit; }
.applicant-document-file>button { color: var(--ui-error); }
.upload-panel { display: grid; grid-template-columns: minmax(180px, 1.2fr) minmax(150px, .8fr) minmax(210px, 1fr) auto; gap: 12px; align-items: end; margin-top: 14px; padding: 14px; border: 1px dashed var(--ui-border); border-radius: 11px; background: var(--ui-bg-muted); }
.upload-panel__heading { grid-column: 1/-1; gap: 9px; }
.upload-panel__heading>svg { color: var(--ui-primary); font-size: 21px; }
.upload-panel__heading>div { display: grid; gap: 2px; }
.upload-panel__heading strong { color: var(--ui-text-highlighted); font-size: 12px; }
.upload-panel__heading small { color: var(--ui-text-muted); font-size: 10px; }
.upload-panel input[type=file] { width: 100%; min-height: 32px; color: var(--ui-text); font-size: 11px; }
.checklist-footer p { max-width: 680px; }
@media (max-width: 900px) { .upload-panel { grid-template-columns: 1fr 1fr; } .applicant-document-row { grid-template-columns: 1fr auto; } .applicant-document-row__files { grid-column: 1/-1; grid-row: 2; } }
@media (max-width: 620px) { .checklist-head, .checklist-footer { align-items: stretch; flex-direction: column; } .checklist-progress { justify-items: start; } .upload-panel { grid-template-columns: 1fr; } .requirement-copy>div:first-child { align-items: flex-start; flex-direction: column; } .requirement-actions { align-items: flex-start; flex-wrap: wrap; } .applicant-document-row { grid-template-columns: 1fr; } .applicant-document-row__files { grid-column: 1; } }
</style>
