<script setup lang="ts">
import type { CaseDetail, CaseDocument } from '~/types/cases'
import type {
  MultiformContextDocument,
  MultiformContextRequirement,
  MultiformCrmContext,
} from '~/types/multiform'

const props = defineProps<{
  caseData: CaseDetail
  context: MultiformCrmContext
  requirements: MultiformContextRequirement[]
  selectedDocumentIds: string[]
}>()

const emit = defineEmits<{
  'update:selectedDocumentIds': [value: string[]]
  refresh: []
}>()

const { crmApiPath } = useOrganizationContext()
const toast = useToast()
const uploadingRequirementKeys = ref<string[]>([])
const removingDocumentIds = ref<string[]>([])

const maxFileBytes = 25 * 1024 * 1024
const supportedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'] as const

const categoryMeta: Record<string, { label: string, icon: string, order: number }> = {
  identity: { label: 'Tożsamość', icon: 'i-lucide-contact', order: 10 },
  income_employment: { label: 'Dochód z pracy', icon: 'i-lucide-briefcase-business', order: 20 },
  income_business: { label: 'Działalność gospodarcza', icon: 'i-lucide-building-2', order: 30 },
  income_other: { label: 'Pozostałe dochody', icon: 'i-lucide-wallet-cards', order: 40 },
  liabilities: { label: 'Zobowiązania', icon: 'i-lucide-receipt-text', order: 50 },
  transaction: { label: 'Transakcja', icon: 'i-lucide-handshake', order: 60 },
  property_legal: { label: 'Dokumenty nieruchomości', icon: 'i-lucide-house', order: 70 },
  valuation: { label: 'Wycena nieruchomości', icon: 'i-lucide-chart-no-axes-combined', order: 80 },
  construction_renovation: { label: 'Budowa i remont', icon: 'i-lucide-hammer', order: 90 },
  refinance_discharge: { label: 'Refinansowanie', icon: 'i-lucide-refresh-cw', order: 100 },
  insurance_security: { label: 'Zabezpieczenia', icon: 'i-lucide-shield-check', order: 110 },
  disclosure_privacy: { label: 'Zgody i oświadczenia', icon: 'i-lucide-signature', order: 120 },
  application: { label: 'Dokumenty bankowe', icon: 'i-lucide-landmark', order: 130 },
  disbursement: { label: 'Wypłata kredytu', icon: 'i-lucide-banknote-arrow-down', order: 140 },
  other: { label: 'Pozostałe dokumenty', icon: 'i-lucide-files', order: 999 },
}

function requirementAcceptsUpload(requirement: MultiformContextRequirement) {
  return (
    requirement.itemKind === 'client_document'
    || (requirement.itemKind === 'bank_document' && !requirement.templateId)
  ) && requirement.allowedMimeTypes.length > 0
}

function documentsFor(requirement: MultiformContextRequirement) {
  const documentIds = new Set(requirement.documentIds)
  return props.context.documents.filter(document => documentIds.has(document.id))
}

function eligibleDocumentsFor(requirement: MultiformContextRequirement) {
  return documentsFor(requirement).filter(document => document.eligible)
}

function isDocumentSelected(documentId: string) {
  return props.selectedDocumentIds.includes(documentId)
}

function requirementIsComplete(requirement: MultiformContextRequirement) {
  if (requirementAcceptsUpload(requirement)) {
    return eligibleDocumentsFor(requirement).some(document => isDocumentSelected(document.id))
  }
  return requirement.fulfillment === 'generated' || requirement.fulfillment === 'attached'
}

const requiredRequirements = computed(() => props.requirements.filter(requirement => (
  requirement.required
  && requirementAcceptsUpload(requirement)
)))

const completedRequiredCount = computed(() => (
  requiredRequirements.value.filter(requirementIsComplete).length
))

const selectedEligibleCount = computed(() => {
  const eligibleIds = new Set(
    props.requirements.flatMap(requirement => (
      eligibleDocumentsFor(requirement).map(document => document.id)
    )),
  )
  return props.selectedDocumentIds.filter(documentId => eligibleIds.has(documentId)).length
})

const groupedRequirements = computed(() => {
  const groups = new Map<string, MultiformContextRequirement[]>()
  for (const requirement of props.requirements) {
    groups.set(requirement.category, [...(groups.get(requirement.category) ?? []), requirement])
  }

  return [...groups.entries()]
    .map(([category, requirements]) => {
      const meta = categoryMeta[category] ?? {
        label: category.replaceAll('_', ' '),
        icon: 'i-lucide-folder',
        order: 900,
      }
      const sortedRequirements = [...requirements].sort((left, right) => (
        Number(right.required) - Number(left.required)
        || left.label.localeCompare(right.label, 'pl')
        || (left.ownerLabel ?? '').localeCompare(right.ownerLabel ?? '', 'pl')
      ))
      const required = sortedRequirements.filter(requirement => (
        requirement.required
        && requirementAcceptsUpload(requirement)
      ))
      return {
        category,
        ...meta,
        requirements: sortedRequirements,
        requiredCount: required.length,
        completedCount: required.filter(requirementIsComplete).length,
      }
    })
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'pl'))
})

function ownerLabel(requirement: MultiformContextRequirement) {
  if (requirement.ownerLabel) return requirement.ownerLabel
  if (requirement.scope === 'case') return 'Cała sprawa'
  if (requirement.scope === 'primary_applicant') {
    return props.context.applicants.find(applicant => applicant.isPrimary)?.label
      ?? 'Główny wnioskodawca'
  }
  return 'Każdy wnioskodawca'
}

function bankScopeLabel(requirement: MultiformContextRequirement) {
  const names = requirement.bankName
    ? [requirement.bankName]
    : [...new Set(requirement.bankNames.filter(Boolean))]
  if (!names.length) return 'Wszystkie wybrane banki'
  if (names.length === 1) return names[0]!
  return `Wspólne dla: ${names.join(', ')}`
}

function requirementStatus(requirement: MultiformContextRequirement) {
  const eligible = eligibleDocumentsFor(requirement)
  const selected = eligible.filter(document => isDocumentSelected(document.id))

  if (selected.length) {
    return {
      label: selected.length === 1 ? 'Gotowe' : `Gotowe · ${selected.length}`,
      color: 'success' as const,
      icon: 'i-lucide-circle-check',
    }
  }
  if (eligible.length) {
    return {
      label: 'Wybierz plik',
      color: 'warning' as const,
      icon: 'i-lucide-circle-dashed',
    }
  }
  if (requirement.fulfillment === 'generated') {
    return {
      label: 'Wygeneruje formularz',
      color: 'primary' as const,
      icon: 'i-lucide-wand-sparkles',
    }
  }
  if (requirement.fulfillment === 'manual') {
    return {
      label: 'Czynność ręczna',
      color: 'neutral' as const,
      icon: 'i-lucide-list-checks',
    }
  }
  if (requirement.fulfillment === 'conditional') {
    return {
      label: 'Do ustalenia',
      color: 'warning' as const,
      icon: 'i-lucide-circle-help',
    }
  }
  if (!requirement.required || requirement.fulfillment === 'optional') {
    return {
      label: 'Opcjonalny',
      color: 'neutral' as const,
      icon: 'i-lucide-circle-dashed',
    }
  }
  return {
    label: 'Brakuje pliku',
    color: 'error' as const,
    icon: 'i-lucide-circle-alert',
  }
}

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes < 1) return ''
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('pl-PL', {
    maximumFractionDigits: 1,
  })} MB`
}

function fileTypeLabel(mimeType: string | null) {
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType === 'image/jpeg') return 'JPG'
  if (mimeType === 'image/png') return 'PNG'
  return 'Plik'
}

function fileMeta(document: MultiformContextDocument) {
  return [fileTypeLabel(document.mime_type), formatFileSize(document.size_bytes)]
    .filter(Boolean)
    .join(' · ')
}

function fileInputId(requirement: MultiformContextRequirement) {
  return `multiform-document-${requirement.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

function uploadAccept(requirement: MultiformContextRequirement) {
  return requirement.allowedMimeTypes
    .filter(mimeType => supportedMimeTypes.includes(mimeType as typeof supportedMimeTypes[number]))
    .join(',')
}

function requirementIsUploading(requirement: MultiformContextRequirement) {
  return uploadingRequirementKeys.value.includes(requirement.key)
}

function openFilePicker(requirement: MultiformContextRequirement) {
  if (requirementIsUploading(requirement)) return
  document.getElementById(fileInputId(requirement))?.click()
}

function validateFile(file: File, requirement: MultiformContextRequirement) {
  if (file.size > maxFileBytes) return 'Plik może mieć maksymalnie 25 MiB.'
  if (!supportedMimeTypes.includes(file.type as typeof supportedMimeTypes[number])) {
    return 'Dozwolone formaty to PDF, JPG i PNG.'
  }
  if (!requirement.allowedMimeTypes.includes(file.type)) {
    return 'Ten format nie jest dozwolony dla tej pozycji.'
  }
  return ''
}

function updateSelectedDocument(
  requirement: MultiformContextRequirement,
  documentId: string,
  checked: boolean,
) {
  const document = props.context.documents.find(item => item.id === documentId)
  if (!document?.eligible) return

  const selected = new Set(props.selectedDocumentIds)
  if (checked) {
    if (!requirement.multiple) {
      for (const requirementDocument of documentsFor(requirement)) {
        selected.delete(requirementDocument.id)
      }
    }
    selected.add(documentId)
  }
  else {
    selected.delete(documentId)
  }
  emit('update:selectedDocumentIds', [...selected])
}

function documentDownloadUrl(documentId: string) {
  return crmApiPath(`/cases/${props.caseData.id}/documents/${documentId}`)
}

async function deleteDocumentRequest(documentId: string) {
  await $fetch(crmApiPath(`/cases/${props.caseData.id}/documents/${documentId}`), {
    method: 'DELETE',
  })
}

async function removeDocument(document: MultiformContextDocument) {
  if (removingDocumentIds.value.includes(document.id)) return
  if (!window.confirm(`Usunąć plik „${document.name}”? Tej operacji nie można cofnąć.`)) return

  removingDocumentIds.value = [...removingDocumentIds.value, document.id]
  try {
    await deleteDocumentRequest(document.id)
    emit(
      'update:selectedDocumentIds',
      props.selectedDocumentIds.filter(documentId => documentId !== document.id),
    )
    emit('refresh')
    toast.add({
      title: 'Dokument został usunięty',
      color: 'success',
      icon: 'i-lucide-trash-2',
    })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się usunąć dokumentu',
      description: apiErrorMessage(error),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    removingDocumentIds.value = removingDocumentIds.value.filter(id => id !== document.id)
  }
}

async function uploadDocument(file: File, requirement: MultiformContextRequirement) {
  const validationError = validateFile(file, requirement)
  if (validationError) {
    toast.add({
      title: 'Nie można załączyć pliku',
      description: validationError,
      color: 'error',
      icon: 'i-lucide-file-warning',
    })
    return
  }

  const offerId = requirement.offerId ?? requirement.offerIds[0]
  if (!offerId) {
    toast.add({
      title: 'Nie można przypisać dokumentu',
      description: 'Pozycja checklisty nie wskazuje oferty bankowej.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    return
  }
  if (requirement.scope === 'each_applicant' && !requirement.ownerClientId) {
    toast.add({
      title: 'Nie można przypisać dokumentu',
      description: 'Pozycja checklisty nie wskazuje wnioskodawcy.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    return
  }

  const previousDocuments = documentsFor(requirement)
  uploadingRequirementKeys.value = [...uploadingRequirementKeys.value, requirement.key]

  try {
    const body = new FormData()
    body.append('file', file)
    body.append('documentType', requirement.code)
    body.append('offerId', offerId)
    if (requirement.ownerClientId) body.append('clientId', requirement.ownerClientId)

    const response = await $fetch<{ data: CaseDocument }>(
      crmApiPath(`/cases/${props.caseData.id}/documents`),
      { method: 'POST', body },
    )
    const selected = new Set(props.selectedDocumentIds)
    if (!requirement.multiple) {
      for (const document of previousDocuments) selected.delete(document.id)
    }
    selected.add(response.data.id)
    emit('update:selectedDocumentIds', [...selected])
    emit('refresh')
    toast.add({
      title: previousDocuments.length ? 'Dodano nowszą wersję' : 'Dokument został załączony',
      description: file.name,
      color: 'success',
      icon: 'i-lucide-file-check-2',
    })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się załączyć dokumentu',
      description: apiErrorMessage(error),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    uploadingRequirementKeys.value = uploadingRequirementKeys.value
      .filter(key => key !== requirement.key)
  }
}

async function onFileSelected(event: Event, requirement: MultiformContextRequirement) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await uploadDocument(file, requirement)
}
</script>

<template>
  <section class="multiform-documents" aria-labelledby="multiform-documents-title">
    <header class="documents-header">
      <div class="documents-header__copy">
        <span class="documents-header__eyebrow">Dokumenty do wniosków</span>
        <h3 id="multiform-documents-title">
          Załącz dokumenty zgodnie z checklistą
        </h3>
        <p>
          Plik dodajesz tylko raz. Zaznaczone dokumenty trafią do paczki dla właściwych banków.
        </p>
      </div>
      <div class="documents-summary" aria-live="polite">
        <strong>{{ completedRequiredCount }}/{{ requiredRequirements.length }}</strong>
        <span>wymaganych pozycji gotowych</span>
        <small>{{ selectedEligibleCount }} {{ selectedEligibleCount === 1 ? 'plik wybrany' : 'plików wybranych' }}</small>
      </div>
    </header>

    <UAlert
      v-if="!requirements.length"
      color="neutral"
      variant="subtle"
      icon="i-lucide-list-checks"
      title="Brak dokumentów do załączenia"
      description="Na podstawie formularza wstępnego nie znaleźliśmy dodatkowych wymagań."
    />

    <div v-else class="document-groups">
      <section
        v-for="group in groupedRequirements"
        :key="group.category"
        class="document-group"
        :aria-labelledby="`document-group-${group.category}`"
      >
        <header class="document-group__header">
          <span class="document-group__icon" aria-hidden="true">
            <UIcon :name="group.icon" />
          </span>
          <div>
            <h4 :id="`document-group-${group.category}`">
              {{ group.label }}
            </h4>
            <p v-if="group.requiredCount">
              {{ group.completedCount }}/{{ group.requiredCount }} wymaganych pozycji gotowych
            </p>
            <p v-else>
              {{ group.requirements.length }} {{ group.requirements.length === 1 ? 'pozycja' : 'pozycje' }}
            </p>
          </div>
        </header>

        <div class="document-group__rows">
          <article
            v-for="requirement in group.requirements"
            :key="requirement.key"
            class="document-requirement"
            :class="{ 'document-requirement--missing': requirementStatus(requirement).color === 'error' }"
          >
            <span
              class="document-requirement__status-icon"
              :class="`is-${requirementStatus(requirement).color}`"
              aria-hidden="true"
            >
              <UIcon :name="requirementStatus(requirement).icon" />
            </span>

            <div class="document-requirement__main">
              <div class="document-requirement__heading">
                <div>
                  <h5>{{ requirement.label }}</h5>
                  <p>
                    <span><UIcon name="i-lucide-user-round" />{{ ownerLabel(requirement) }}</span>
                    <span><UIcon name="i-lucide-landmark" />{{ bankScopeLabel(requirement) }}</span>
                  </p>
                </div>
                <UBadge
                  :color="requirementStatus(requirement).color"
                  variant="subtle"
                  size="sm"
                >
                  {{ requirementStatus(requirement).label }}
                </UBadge>
              </div>

              <p v-if="requirement.notes" class="document-requirement__notes">
                {{ requirement.notes }}
              </p>

              <div
                v-if="documentsFor(requirement).length"
                class="requirement-files"
                aria-label="Dostępne pliki"
              >
                <div
                  v-for="requirementDocument in documentsFor(requirement)"
                  :key="requirementDocument.id"
                  class="requirement-file"
                  :class="{ 'requirement-file--unavailable': !requirementDocument.eligible }"
                >
                  <UCheckbox
                    :model-value="isDocumentSelected(requirementDocument.id)"
                    :disabled="!requirementDocument.eligible"
                    :aria-label="`${isDocumentSelected(requirementDocument.id) ? 'Pomiń' : 'Dołącz'} plik ${requirementDocument.name}`"
                    @update:model-value="updateSelectedDocument(requirement, requirementDocument.id, Boolean($event))"
                  />
                  <span class="requirement-file__icon" aria-hidden="true">
                    <UIcon :name="requirementDocument.mime_type === 'application/pdf' ? 'i-lucide-file-text' : 'i-lucide-file-image'" />
                  </span>
                  <span class="requirement-file__copy">
                    <strong>{{ requirementDocument.name }}</strong>
                    <small v-if="requirementDocument.eligible">{{ fileMeta(requirementDocument) }}</small>
                    <small v-else>{{ requirementDocument.blocker || 'Pliku nie można dołączyć do paczki' }}</small>
                  </span>
                  <a
                    :href="documentDownloadUrl(requirementDocument.id)"
                    class="requirement-file__action"
                    target="_blank"
                    rel="noopener"
                    :aria-label="`Pobierz ${requirementDocument.name}`"
                  >
                    <UIcon name="i-lucide-download" />
                    <span>Pobierz</span>
                  </a>
                  <UButton
                    color="error"
                    variant="ghost"
                    size="xs"
                    square
                    icon="i-lucide-trash-2"
                    :loading="removingDocumentIds.includes(requirementDocument.id)"
                    :aria-label="`Usuń ${requirementDocument.name}`"
                    @click="removeDocument(requirementDocument)"
                  />
                </div>
              </div>
            </div>

            <div v-if="requirementAcceptsUpload(requirement)" class="document-requirement__action">
              <input
                :id="fileInputId(requirement)"
                class="document-file-input"
                type="file"
                :accept="uploadAccept(requirement)"
                :aria-label="`Wybierz plik: ${requirement.label}`"
                @change="onFileSelected($event, requirement)"
              >
              <UButton
                :color="eligibleDocumentsFor(requirement).length ? 'neutral' : requirement.required ? 'primary' : 'neutral'"
                :variant="eligibleDocumentsFor(requirement).length || !requirement.required ? 'outline' : 'solid'"
                size="sm"
                :icon="eligibleDocumentsFor(requirement).length ? 'i-lucide-refresh-cw' : 'i-lucide-upload'"
                :loading="requirementIsUploading(requirement)"
                @click="openFilePicker(requirement)"
              >
                {{ eligibleDocumentsFor(requirement).length ? 'Dodaj nowszą wersję' : 'Załącz plik' }}
              </UButton>
              <small>{{ uploadAccept(requirement).includes('application/pdf') ? 'PDF' : '' }}<template v-if="uploadAccept(requirement).includes('image/')">{{ uploadAccept(requirement).includes('application/pdf') ? ', ' : '' }}JPG lub PNG</template> · maks. 25 MiB</small>
            </div>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.multiform-documents {
  display: grid;
  gap: 24px;
}

.documents-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 32px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--ui-border);
}

.documents-header__copy {
  display: grid;
  gap: 6px;
  max-width: 680px;
}

.documents-header__eyebrow {
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 750;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.documents-header h3,
.documents-header p,
.document-group h4,
.document-group p,
.document-requirement h5,
.document-requirement p {
  margin: 0;
}

.documents-header h3 {
  color: var(--ui-text-highlighted);
  font-size: 22px;
  line-height: 1.25;
}

.documents-header p {
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.55;
}

.documents-summary {
  display: grid;
  flex: 0 0 auto;
  justify-items: end;
  min-width: 190px;
}

.documents-summary strong {
  color: var(--ui-text-highlighted);
  font-size: 24px;
  line-height: 1.1;
}

.documents-summary span,
.documents-summary small {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.documents-summary small {
  margin-top: 5px;
  color: var(--ui-primary);
  font-weight: 650;
}

.document-groups {
  display: grid;
  gap: 30px;
}

.document-group {
  display: grid;
  gap: 10px;
}

.document-group__header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.document-group__icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--ui-bg-muted);
  color: var(--ui-primary);
  font-size: 17px;
}

.document-group__header h4 {
  color: var(--ui-text-highlighted);
  font-size: 15px;
  line-height: 1.3;
}

.document-group__header p {
  margin-top: 1px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.document-group__rows {
  border-top: 1px solid var(--ui-border);
}

.document-requirement {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: start;
  gap: 12px;
  padding: 18px 4px;
  border-bottom: 1px solid var(--ui-border-muted);
}

.document-requirement--missing {
  background: var(--ui-bg-muted);
}

.document-requirement__status-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 17px;
}

.document-requirement__status-icon.is-success {
  background: color-mix(in srgb, var(--ui-success) 12%, var(--ui-bg));
  color: var(--ui-success);
}

.document-requirement__status-icon.is-primary {
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg));
  color: var(--ui-primary);
}

.document-requirement__status-icon.is-warning {
  background: color-mix(in srgb, var(--ui-warning) 12%, var(--ui-bg));
  color: var(--ui-warning);
}

.document-requirement__status-icon.is-error {
  background: color-mix(in srgb, var(--ui-error) 12%, var(--ui-bg));
  color: var(--ui-error);
}

.document-requirement__main {
  display: grid;
  gap: 9px;
  min-width: 0;
}

.document-requirement__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.document-requirement__heading > div {
  min-width: 0;
}

.document-requirement h5 {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  line-height: 1.4;
}

.document-requirement__heading p {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 14px;
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.document-requirement__heading p span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.document-requirement__notes {
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.requirement-files {
  display: grid;
  gap: 5px;
}

.requirement-file {
  display: grid;
  grid-template-columns: auto 26px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 6px 7px 6px 10px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 9px;
  background: var(--ui-bg-muted);
}

.requirement-file--unavailable {
  opacity: .72;
}

.requirement-file__icon {
  display: grid;
  place-items: center;
  color: var(--ui-primary);
  font-size: 17px;
}

.requirement-file__copy {
  display: grid;
  min-width: 0;
}

.requirement-file__copy strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.requirement-file__copy small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.requirement-file__action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px;
  border-radius: 6px;
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 650;
  text-decoration: none;
}

.requirement-file__action:hover,
.requirement-file__action:focus-visible {
  background: var(--ui-bg-accented);
  outline: 2px solid var(--ui-primary);
  outline-offset: 1px;
}

.document-requirement__action {
  display: grid;
  justify-items: end;
  gap: 5px;
  min-width: 174px;
}

.document-requirement__action small {
  color: var(--ui-text-dimmed);
  font-size: 10px;
}

.document-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 820px) {
  .document-requirement {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .document-requirement__action {
    grid-column: 2;
    justify-items: start;
    min-width: 0;
  }
}

@media (max-width: 620px) {
  .documents-header {
    flex-direction: column;
    gap: 16px;
  }

  .documents-summary {
    justify-items: start;
  }

  .document-requirement {
    grid-template-columns: 28px minmax(0, 1fr);
    padding: 16px 0;
  }

  .document-requirement__status-icon {
    width: 28px;
    height: 28px;
  }

  .document-requirement__heading {
    flex-direction: column;
    gap: 8px;
  }

  .requirement-file {
    grid-template-columns: auto 24px minmax(0, 1fr) auto auto;
  }

  .requirement-file__action {
    padding-inline: 5px;
  }

  .requirement-file__action span {
    display: none;
  }
}
</style>
