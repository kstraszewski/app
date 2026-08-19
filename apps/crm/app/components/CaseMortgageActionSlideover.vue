<script setup lang="ts">
import type {
  CaseBankApplication,
  CaseClient,
  MortgageNextActionKind,
  SavedCaseOffer,
} from '~/types/cases'
import {
  createMortgageConsentBatchIdentity,
  mortgageConsentBatchSteps,
  sortedMortgageConsentClientIds,
  type MortgageConsentBatchIdentity,
} from '~/utils/mortgage-consent-batch'

const props = defineProps<{
  open: boolean
  caseId: string
  application: CaseBankApplication | null
  offer: SavedCaseOffer | null
  clients: CaseClient[]
  actionKind: MortgageNextActionKind | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  refresh: []
}>()

const { crmApiPath } = useOrganizationContext()
const toast = useToast()
const file = ref<File | null>(null)
const deliveredTo = ref<string[]>([])
const occurredAt = ref('')
const receivedAt = ref('')
const issuedAt = ref('')
const validUntil = ref('')
const decisionOutcome = ref<'positive' | 'negative'>('positive')
const consentDecision = ref<'granted' | 'refused' | 'withdrawn'>('granted')
const bindingValidUntil = ref('')
const evidenceReference = ref('')
const submitting = ref(false)
const localError = ref('')
const expertOverrideReason = ref('')
const expertOverrideConfirmed = ref(false)

const maxMortgageArtifactPdfBytes = 4 * 1024 * 1024
const expertOverrideMinLength = 20
const expertOverrideMaxLength = 1_000

interface MortgageAiReviewChallenge {
  safeSummary: string
  reasonLabels: string[]
}

const aiReviewChallenge = ref<MortgageAiReviewChallenge | null>(null)
const uploadCommandId = ref('')
const uploadExpectedRevision = ref(0)
const processCommandId = ref('')
const consentBatchIdentity = ref<MortgageConsentBatchIdentity>({
  baseRevision: 0,
  commandIdsByClientId: {},
})

const process = computed(() => props.application?.mortgage_process ?? null)
const isMockBank = computed(() => (
  props.offer?.bank_is_mock === true
  && props.application?.mock_bank?.enabled === true
))
const recipients = computed(() => {
  if (process.value?.recipients?.length) {
    return process.value.recipients.map(recipient => ({
      id: recipient.client_id,
      label: recipient.display_name,
    }))
  }
  return props.clients.map(client => ({ id: client.id, label: client.display_name }))
})
const revision = computed(() => process.value?.revision ?? 0)
const isUpload = computed(() => ['upload-esis', 'upload-decision', 'upload-agreement'].includes(props.actionKind ?? ''))
const isDelivery = computed(() => ['deliver-esis', 'deliver-decision', 'deliver-agreement'].includes(props.actionKind ?? ''))
const isConsent = computed(() => props.actionKind === 'record-early-consent')
const isClose = computed(() => props.actionKind === 'close-application')
const isCommand = computed(() => ['submit-application', 'confirm-completeness', 'open-documents', 'resume-review', 'complete-application', 'close-application'].includes(props.actionKind ?? ''))
const expertOverrideReasonLength = computed(() => expertOverrideReason.value.trim().length)
const expertOverrideReady = computed(() => !aiReviewChallenge.value || (
  expertOverrideConfirmed.value
  && expertOverrideReasonLength.value >= expertOverrideMinLength
  && expertOverrideReasonLength.value <= expertOverrideMaxLength
))
const consentBatchMaterialFingerprint = computed(() => JSON.stringify({
  applicationId: props.application?.id ?? '',
  actionKind: props.actionKind ?? '',
  clientIds: sortedMortgageConsentClientIds(deliveredTo.value),
  decision: consentDecision.value,
  capturedAt: occurredAt.value.trim(),
  evidenceReference: evidenceReference.value.trim(),
}))

const consentDecisionPresentation = computed(() => {
  if (consentDecision.value === 'refused') {
    return {
      dateLabel: 'Data odmowy',
      peopleLabel: 'Odmowę złożyli',
      peopleHelp: 'Zaznacz osoby, które odmówiły wcześniejszego otrzymania decyzji.',
      evidenceLabel: 'Dowód odmowy',
    }
  }
  if (consentDecision.value === 'withdrawn') {
    return {
      dateLabel: 'Data wycofania zgody',
      peopleLabel: 'Zgodę wycofali',
      peopleHelp: 'Zaznacz osoby, które wycofały wcześniej udzieloną zgodę.',
      evidenceLabel: 'Dowód wycofania zgody',
    }
  }
  return {
    dateLabel: 'Data udzielenia zgody',
    peopleLabel: 'Zgodę udzielili',
    peopleHelp: 'Zaznacz wyłącznie osoby, od których uzyskano udokumentowaną zgodę.',
    evidenceLabel: 'Dowód zgody',
  }
})

const title = computed(() => {
  const bank = props.offer?.bank_name ?? 'banku'
  if (props.actionKind === 'upload-esis') return `Załącz ESIS — ${bank}`
  if (props.actionKind === 'deliver-esis') return `Przekaż ESIS — ${bank}`
  if (props.actionKind === 'upload-decision') return `Załącz decyzję — ${bank}`
  if (props.actionKind === 'deliver-decision') return `Przekaż decyzję — ${bank}`
  if (props.actionKind === 'upload-agreement') return `Załącz projekt umowy — ${bank}`
  if (props.actionKind === 'deliver-agreement') return `Przekaż projekt umowy — ${bank}`
  if (props.actionKind === 'record-early-consent') return `Decyzje klientów o wcześniejszym terminie — ${bank}`
  if (props.actionKind === 'resume-review') return `Wznów analizę — ${bank}`
  if (props.actionKind === 'complete-application') return `Zakończ walidację — ${bank}`
  if (props.actionKind === 'close-application') return `Wycofaj wniosek — ${bank}`
  if (props.actionKind === 'confirm-completeness') return `Potwierdź kompletność — ${bank}`
  if (props.actionKind === 'open-documents') return `Zarejestruj braki — ${bank}`
  if (props.actionKind === 'submit-application') {
    return isMockBank.value ? `Złóż wniosek — ${bank}` : `Wyślij wniosek — ${bank}`
  }
  return `Proces hipoteczny — ${bank}`
})

const description = computed(() => {
  if (props.actionKind === 'upload-esis') return 'Dodaj oficjalny PDF otrzymany z banku. Gemini odczyta dokument i sprawdzi jego typ, czytelność, bank, wnioskodawców oraz kluczowe sekcje przed zapisaniem.'
  if (props.actionKind === 'upload-decision') return 'Dodaj oryginalną decyzję banku. Gemini sprawdzi dokument, wynik decyzji i zgodność ze sprawą przed zapisaniem.'
  if (props.actionKind === 'upload-agreement') return 'Dodaj projekt umowy zgodny z warunkami decyzji banku.'
  if (isDelivery.value) return 'Zapisz przekazanie dokumentu na trwałym nośniku oddzielnie dla każdego wnioskodawcy.'
  if (props.actionKind === 'record-early-consent') return 'Zapisz udokumentowaną zgodę, odmowę albo wycofanie zgody na otrzymanie decyzji przed upływem ustawowego terminu.'
  if (props.actionKind === 'resume-review') return 'Potwierdź, że informacje lub dokumenty wskazane przez bank zostały uzupełnione i analiza może być kontynuowana.'
  if (props.actionKind === 'confirm-completeness') return 'Wprowadź datę, którą bank potwierdził jako otrzymanie wszystkich informacji potrzebnych do oceny zdolności. Od niej system wyliczy termin decyzji.'
  if (props.actionKind === 'open-documents') return 'Zapisz datę wezwania banku do uzupełnienia informacji lub dokumentów.'
  if (props.actionKind === 'complete-application') return 'System ponownie sprawdzi kompletność decyzji, okres związania ofertą i przekazanie projektu umowy przed dopuszczeniem wyboru finalnej umowy.'
  if (props.actionKind === 'close-application') return 'Wycofanie kończy tę ścieżkę bankową i pozostaje w audytowalnej historii sprawy.'
  if (props.actionKind === 'submit-application' && isMockBank.value) {
    return 'System złoży wniosek w testowym OpenExpert Banku. Bank potwierdzi odbiór i kompletność, a następnie wyśle mockową decyzję do podłączonej skrzynki.'
  }
  return 'Wysłanie zostanie zapisane dopiero po walidacji ważnego ESIS i dowodu przekazania go wszystkim wnioskodawcom.'
})

const submitLabel = computed(() => {
  if (aiReviewChallenge.value) return 'Potwierdź ręczną weryfikację i załącz'
  if (props.actionKind === 'upload-esis' || props.actionKind === 'upload-decision') return 'Analizuj i załącz'
  if (isUpload.value) return 'Załącz dokument'
  if (isDelivery.value) return 'Zapisz przekazanie'
  if (props.actionKind === 'record-early-consent') return 'Zapisz decyzje klientów'
  if (props.actionKind === 'resume-review') return 'Wznów analizę'
  if (props.actionKind === 'confirm-completeness') return 'Potwierdź kompletność'
  if (props.actionKind === 'open-documents') return 'Zapisz wezwanie'
  if (props.actionKind === 'complete-application') return 'Zakończ walidację'
  if (props.actionKind === 'close-application') return 'Wycofaj wniosek'
  if (props.actionKind === 'submit-application' && isMockBank.value) return 'Złóż wniosek'
  return 'Zapisz wysłanie wniosku'
})

function localDateTimeNow() {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
  return now.toISOString().slice(0, 16)
}

function resetForm() {
  file.value = null
  deliveredTo.value = isDelivery.value || isConsent.value
    ? recipients.value.map(recipient => recipient.id)
    : []
  occurredAt.value = localDateTimeNow()
  receivedAt.value = localDateTimeNow()
  issuedAt.value = ''
  validUntil.value = ''
  decisionOutcome.value = 'positive'
  consentDecision.value = 'granted'
  bindingValidUntil.value = ''
  evidenceReference.value = ''
  localError.value = ''
  aiReviewChallenge.value = null
  expertOverrideReason.value = ''
  expertOverrideConfirmed.value = false
  processCommandId.value = newCommandId()
  resetUploadCommandIdentity()
  resetConsentBatchIdentity()
}

watch(() => [props.open, props.actionKind, props.application?.id], ([open]) => {
  if (open) resetForm()
}, { immediate: true })

watch([file, issuedAt, validUntil, decisionOutcome, bindingValidUntil], () => {
  aiReviewChallenge.value = null
  expertOverrideReason.value = ''
  expertOverrideConfirmed.value = false
}, { flush: 'sync' })

watch([
  file,
  deliveredTo,
  occurredAt,
  receivedAt,
  issuedAt,
  validUntil,
  decisionOutcome,
  bindingValidUntil,
  evidenceReference,
  expertOverrideReason,
], () => {
  resetUploadCommandIdentity()
}, { deep: true, flush: 'sync' })

watch(consentBatchMaterialFingerprint, () => {
  if (isConsent.value) resetConsentBatchIdentity()
}, { flush: 'sync' })

function close() {
  emit('update:open', false)
}

function requiredIso(value: string, label: string) {
  if (!value.trim()) throw new Error(`Uzupełnij pole „${label}”.`)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Pole „${label}” zawiera nieprawidłową datę.`)
  return parsed.toISOString()
}

function newCommandId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256) })
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function resetUploadCommandIdentity() {
  uploadCommandId.value = newCommandId()
  uploadExpectedRevision.value = revision.value
}

function resetConsentBatchIdentity() {
  consentBatchIdentity.value = createMortgageConsentBatchIdentity(
    deliveredTo.value,
    revision.value,
    newCommandId,
  )
}

function mortgageAiReviewError(error: unknown): (MortgageAiReviewChallenge & {
  requiresExpertOverride: boolean
}) | null {
  const candidate = error && typeof error === 'object'
    ? error as Record<string, any>
    : {}
  const sources = [
    candidate.data?.data,
    candidate.data,
    candidate.response?._data?.data,
    candidate.response?._data,
  ]
  const source = sources.find(value => value && typeof value === 'object') as Record<string, unknown> | undefined
  const code = typeof source?.code === 'string' ? source.code : ''
  if (code !== 'mortgage_document_needs_review' && code !== 'mortgage_document_rejected') return null

  const safeSummary = typeof source?.safeSummary === 'string' && source.safeSummary.trim()
    ? source.safeSummary.trim().slice(0, 500)
    : 'Automatyczna analiza nie potwierdziła dokumentu.'
  const reasonLabels = Array.isArray(source?.reasonLabels)
    ? source.reasonLabels
        .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
        .slice(0, 5)
        .map(value => value.trim().slice(0, 200))
    : []
  return {
    safeSummary,
    reasonLabels,
    requiresExpertOverride: source?.requiresExpertOverride === true,
  }
}

function deliveries() {
  if (deliveredTo.value.length && !evidenceReference.value.trim()) {
    throw new Error('Podaj dowód lub numer referencyjny przekazania dokumentu.')
  }
  const at = requiredIso(occurredAt.value, 'Data przekazania')
  return deliveredTo.value.map(recipientClientId => ({
    recipientClientId,
    deliveredAt: at,
    channel: 'other_durable_medium',
    ...(evidenceReference.value.trim() ? { evidenceReference: evidenceReference.value.trim() } : {}),
  }))
}

async function uploadArtifact() {
  if (!props.application || !props.actionKind || !file.value) {
    throw new Error('Wybierz plik PDF.')
  }
  if (file.value.size > maxMortgageArtifactPdfBytes) {
    throw new Error('Plik PDF nie może przekraczać 4 MiB.')
  }
  if (aiReviewChallenge.value) {
    if (!expertOverrideConfirmed.value) {
      throw new Error('Potwierdź odpowiedzialność za ręczną weryfikację dokumentu.')
    }
    if (expertOverrideReasonLength.value < expertOverrideMinLength) {
      throw new Error(`Uzasadnienie ręcznej weryfikacji musi mieć co najmniej ${expertOverrideMinLength} znaków.`)
    }
    if (expertOverrideReasonLength.value > expertOverrideMaxLength) {
      throw new Error(`Uzasadnienie ręcznej weryfikacji nie może przekraczać ${expertOverrideMaxLength} znaków.`)
    }
  }
  if (!uploadCommandId.value) resetUploadCommandIdentity()
  const kind = props.actionKind === 'upload-esis'
    ? 'esis'
    : props.actionKind === 'upload-decision'
      ? 'credit_decision'
      : 'draft_credit_agreement'
  const receivedAtIso = requiredIso(receivedAt.value, 'Data otrzymania z banku')
  const artifact: Record<string, unknown> = {
    receivedAt: receivedAtIso,
    ...(issuedAt.value ? { issuedAt: requiredIso(`${issuedAt.value}T12:00`, 'Data wystawienia') } : {}),
  }
  if (kind === 'esis') {
    if (!validUntil.value) throw new Error('Podaj datę ważności ESIS wskazaną przez bank.')
    const validUntilIso = requiredIso(`${validUntil.value}T23:59`, 'ESIS ważny do')
    if (Date.parse(validUntilIso) <= Date.parse(receivedAtIso)) {
      throw new Error('Data ważności ESIS musi przypadać po dacie otrzymania dokumentu.')
    }
    artifact.validUntil = validUntilIso
  }
  if (kind === 'credit_decision') {
    artifact.decisionOutcome = decisionOutcome.value
    if (decisionOutcome.value === 'positive' && !bindingValidUntil.value) {
      throw new Error('Dla decyzji pozytywnej podaj datę, do której bank jest związany ofertą.')
    }
    if (bindingValidUntil.value) {
      const bindingValidUntilIso = requiredIso(`${bindingValidUntil.value}T23:59`, 'Bank związany ofertą do')
      if (Date.parse(bindingValidUntilIso) <= Date.parse(receivedAtIso)) {
        throw new Error('Okres związania ofertą musi kończyć się po dacie otrzymania decyzji.')
      }
      const decisionDueAt = process.value?.decision_due_at
      const bindingStart = Math.max(
        Date.parse(receivedAtIso),
        typeof decisionDueAt === 'string' && Number.isFinite(Date.parse(decisionDueAt))
          ? Date.parse(decisionDueAt)
          : Date.parse(receivedAtIso),
      )
      if (Date.parse(bindingValidUntilIso) < bindingStart + 14 * 24 * 60 * 60 * 1_000) {
        throw new Error('Okres związania banku ofertą musi obejmować co najmniej 14 dni od późniejszej z dat: otrzymania decyzji albo ustawowego terminu jej przekazania.')
      }
      artifact.validUntil = bindingValidUntilIso
    }
  }

  const body = new FormData()
  body.append('file', file.value)
  body.append('kind', kind)
  body.append('commandId', uploadCommandId.value)
  body.append('expectedRevision', String(uploadExpectedRevision.value))
  body.append('artifact', JSON.stringify(artifact))
  body.append('deliveries', JSON.stringify(deliveredTo.value.length ? deliveries() : []))
  if (aiReviewChallenge.value) {
    body.append('expertOverrideReason', expertOverrideReason.value.trim())
  }
  await $fetch(crmApiPath(`/cases/${props.caseId}/applications/${props.application.id}/artifacts`), {
    method: 'POST',
    body,
  })
}

async function executeCommand() {
  if (!props.application || !props.actionKind) return
  const at = requiredIso(
    occurredAt.value,
    props.actionKind === 'close-application' ? 'Data wycofania' : 'Data wykonania kroku',
  )
  const type = props.actionKind === 'confirm-completeness'
    ? 'confirm_completeness'
    : props.actionKind === 'open-documents'
      ? 'request_additional_information'
      : props.actionKind === 'resume-review'
        ? 'resume_review'
      : props.actionKind === 'complete-application'
        ? 'complete_application'
      : props.actionKind === 'close-application'
        ? 'close_application'
      : 'submit_application'
  const command: Record<string, unknown> = { type }
  if (type === 'confirm_completeness') command.confirmedAt = at
  if (type === 'request_additional_information') command.requestedAt = at
  if (type === 'resume_review') command.resumedAt = at
  if (type === 'submit_application') command.submittedAt = at
  if (type === 'complete_application') command.completedAt = at
  if (type === 'close_application') command.closedAt = at
  if (type === 'submit_application' && isMockBank.value) {
    if (!processCommandId.value) processCommandId.value = newCommandId()
    await $fetch(crmApiPath(`/cases/${props.caseId}/applications/${props.application.id}/mock-bank/submit`), {
      method: 'POST',
      body: {
        requestId: processCommandId.value,
        expectedRevision: revision.value,
        submittedAt: at,
      },
    })
    return
  }
  await $fetch(crmApiPath(`/cases/${props.caseId}/applications/${props.application.id}/commands`), {
    method: 'POST',
    body: {
      commandId: newCommandId(),
      expectedRevision: revision.value,
      command,
    },
  })
}

async function recordEarlyConsent() {
  if (!props.application) return
  const applicationId = props.application.id
  const decision = consentDecision.value
  const evidence = evidenceReference.value.trim()
  const clientIds = [...deliveredTo.value]
  if (!['granted', 'refused', 'withdrawn'].includes(decision)) {
    throw new Error('Wybierz decyzję klienta.')
  }
  if (!clientIds.length) throw new Error('Wybierz co najmniej jednego wnioskodawcę.')
  if (!evidence) {
    throw new Error('Podaj dowód lub numer referencyjny zgody.')
  }
  const capturedAt = requiredIso(occurredAt.value, consentDecisionPresentation.value.dateLabel)
  let steps: ReturnType<typeof mortgageConsentBatchSteps>
  try {
    steps = mortgageConsentBatchSteps(clientIds, consentBatchIdentity.value)
  }
  catch {
    throw new Error('Nie udało się potwierdzić tożsamości tej serii zgód. Zamknij formularz, otwórz go ponownie i spróbuj jeszcze raz.')
  }
  for (const step of steps) {
    const response = await ($fetch as any)(crmApiPath(`/cases/${props.caseId}/applications/${applicationId}/commands`), {
      method: 'POST',
      body: {
        commandId: step.commandId,
        expectedRevision: step.expectedRevision,
        command: {
          type: 'record_early_decision_consent',
          clientId: step.clientId,
          decision,
          capturedAt,
          channel: 'other',
          evidenceReference: evidence,
        },
      },
    })
    const nextRevision = Number(response?.data?.revision)
    if (!Number.isSafeInteger(nextRevision) || nextRevision !== step.expectedRevision + 1) {
      throw new Error('Serwer zwrócił nieprawidłową rewizję procesu. Odśwież sprawę.')
    }
  }
}

async function deliverArtifact() {
  if (!props.application || !props.actionKind) return
  const steps = process.value?.steps
  const artifactId = props.actionKind === 'deliver-esis'
    ? steps?.esis?.artifact_id
    : props.actionKind === 'deliver-decision'
      ? steps?.decision?.artifact_id
      : steps?.agreement?.artifact_id
  if (typeof artifactId !== 'string') {
    throw new Error('Brakuje identyfikatora aktualnej wersji dokumentu. Odśwież sprawę i spróbuj ponownie.')
  }
  if (!deliveredTo.value.length) throw new Error('Wybierz co najmniej jednego wnioskodawcę.')
  await $fetch(crmApiPath(`/cases/${props.caseId}/applications/${props.application.id}/commands`), {
    method: 'POST',
    body: {
      commandId: newCommandId(),
      expectedRevision: revision.value,
      command: {
        type: 'deliver_artifact',
        artifactId,
        recipients: deliveries(),
      },
    },
  })
}

async function submit() {
  if (submitting.value) return
  submitting.value = true
  localError.value = ''
  try {
    if (isUpload.value) await uploadArtifact()
    else if (isDelivery.value) await deliverArtifact()
    else if (isConsent.value) await recordEarlyConsent()
    else if (isCommand.value) await executeCommand()
    else throw new Error('Ta akcja procesu nie jest obsługiwana. Odśwież sprawę i spróbuj ponownie.')
    if (isUpload.value) resetUploadCommandIdentity()
    if (isConsent.value) resetConsentBatchIdentity()
    emit('refresh')
    toast.add({
      title: props.actionKind === 'upload-esis' || props.actionKind === 'upload-decision'
        ? 'Dokument przeanalizowany i zapisany'
        : props.actionKind === 'submit-application' && isMockBank.value
          ? 'Wniosek złożony, decyzja wysłana e-mailem'
        : 'Zapisano krok procesu hipotecznego',
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
    close()
  }
  catch (caught) {
    const aiReview = mortgageAiReviewError(caught)
    if (aiReview?.requiresExpertOverride) {
      aiReviewChallenge.value = {
        safeSummary: aiReview.safeSummary,
        reasonLabels: aiReview.reasonLabels,
      }
      expertOverrideReason.value = ''
      expertOverrideConfirmed.value = false
      localError.value = ''
      // An expert override is a new material command. Keep this new ID stable
      // across retransmissions until the reviewed payload changes.
      resetUploadCommandIdentity()
    }
    else {
      if (aiReview) {
        aiReviewChallenge.value = null
        expertOverrideReason.value = ''
        expertOverrideConfirmed.value = false
        const reasons = aiReview.reasonLabels.length
          ? ` Wykryte problemy: ${aiReview.reasonLabels.join('; ')}.`
          : ''
        localError.value = `${aiReview.safeSummary}${reasons} Plik nie został zapisany.`
      }
      else {
        localError.value = apiErrorMessage(caught) || (caught instanceof Error ? caught.message : 'Nie udało się zapisać kroku.')
      }
      if (props.actionKind === 'submit-application' && isMockBank.value) {
        // The lifecycle transitions may already have committed before an email
        // provider failure. A retry needs a fresh dispatch lease/request ID.
        processCommandId.value = newCommandId()
        emit('refresh')
      }
    }
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-if="isClose"
    :open="open"
    :title="title"
    :description="description"
    :dismissible="!submitting"
    :ui="{ footer: 'justify-end' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="mortgage-action-form">
        <UAlert
          v-if="localError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie można wycofać wniosku"
          :description="localError"
        />
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Potwierdź wycofanie tej ścieżki"
          description="Wniosek zostanie oznaczony jako wycofany. Zapis audytowy, dokumenty i dotychczasowy przebieg pozostaną w historii sprawy."
        />
        <UFormField label="Data wycofania" required>
          <UInput v-model="occurredAt" type="datetime-local" class="w-full" />
        </UFormField>
      </div>
    </template>
    <template #footer="{ close: closeModal }">
      <UButton color="neutral" variant="outline" :disabled="submitting" @click="closeModal">Anuluj</UButton>
      <UButton color="error" icon="i-lucide-circle-minus" :loading="submitting" @click="submit">
        Wycofaj wniosek
      </UButton>
    </template>
  </UModal>

  <USlideover v-else :open="open" :title="title" :description="description" :dismissible="!submitting" @update:open="emit('update:open', $event)">
    <template #body>
      <div class="mortgage-action-form">
        <UAlert
          v-if="localError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie można zapisać tego kroku"
          :description="localError"
        />

        <template v-if="isUpload">
          <UAlert
            v-if="actionKind === 'upload-esis' || actionKind === 'upload-decision'"
            color="info"
            variant="subtle"
            icon="i-lucide-scan-text"
            title="Automatyczna kontrola dokumentu"
            description="Gemini 3.5 Flash-Lite przeanalizuje cały PDF. Pusty, nieczytelny, błędnego typu lub niezgodny ze sprawą plik nie zostanie zapisany. Przy wyniku niejednoznacznym system poprosi o udokumentowaną ręczną weryfikację. Wynik jest kontrolą pomocniczą — nie zastępuje oceny eksperta ani reguł prawnych systemu."
          />
          <UFormField label="Dokument z banku" required help="Akceptowany jest oryginalny plik PDF, maksymalnie 4 MiB.">
            <UFileUpload v-model="file" accept="application/pdf,.pdf" class="w-full" label="Wybierz PDF" />
          </UFormField>
          <template v-if="aiReviewChallenge">
            <UAlert
              color="warning"
              variant="subtle"
              icon="i-lucide-user-check"
              title="Dokument wymaga ręcznej weryfikacji eksperta"
              :description="`${aiReviewChallenge.safeSummary}${aiReviewChallenge.reasonLabels.length ? ` Wykryte problemy: ${aiReviewChallenge.reasonLabels.join('; ')}.` : ''} Plik nie został jeszcze zapisany.`"
            />
            <UFormField
              label="Uzasadnienie ręcznej weryfikacji"
              description="Opisz, co zostało sprawdzone w całym dokumencie i dlaczego mimo ostrzeżeń można go przypisać do tej sprawy. Uzasadnienie, Twoje konto oraz czas potwierdzenia trafią do historii audytowej."
              :hint="`${expertOverrideReasonLength} / ${expertOverrideMaxLength}`"
              :error="expertOverrideReasonLength > 0 && expertOverrideReasonLength < expertOverrideMinLength ? `Wpisz co najmniej ${expertOverrideMinLength} znaków.` : undefined"
              required
            >
              <UTextarea
                v-model="expertOverrideReason"
                class="w-full"
                :rows="4"
                autoresize
                :maxrows="8"
                :maxlength="expertOverrideMaxLength"
                placeholder="Np. ręcznie sprawdziłem wszystkie strony, dane banku i wnioskodawców…"
                :disabled="submitting"
              />
            </UFormField>
            <UCheckbox
              v-model="expertOverrideConfirmed"
              :disabled="submitting"
              label="Potwierdzam, że samodzielnie zweryfikowałem cały dokument i przyjmuję odpowiedzialność za jego ręczną ocenę."
            />
          </template>
          <UFormField label="Data wystawienia">
            <UInput v-model="issuedAt" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Data otrzymania z banku" required>
            <UInput v-model="receivedAt" type="datetime-local" class="w-full" />
          </UFormField>
          <UFormField v-if="actionKind === 'upload-esis'" label="ESIS ważny do" required>
            <UInput v-model="validUntil" type="date" class="w-full" />
          </UFormField>
          <template v-if="actionKind === 'upload-decision'">
            <UFormField label="Wynik decyzji" required>
              <USelect
                v-model="decisionOutcome"
                :items="[{ label: 'Pozytywna', value: 'positive' }, { label: 'Negatywna', value: 'negative' }]"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField v-if="decisionOutcome === 'positive'" label="Bank związany ofertą do" required>
              <UInput v-model="bindingValidUntil" type="date" class="w-full" />
            </UFormField>
          </template>
        </template>

        <UFormField v-if="isCommand" :label="actionKind === 'confirm-completeness' ? 'Data potwierdzonej kompletności' : actionKind === 'open-documents' ? 'Data wezwania banku' : actionKind === 'resume-review' ? 'Data uzupełnienia braków' : actionKind === 'complete-application' ? 'Data zakończenia walidacji' : 'Data wysłania do banku'" required>
          <UInput v-model="occurredAt" type="datetime-local" class="w-full" />
        </UFormField>

        <UFormField v-if="isConsent" label="Decyzja klienta" required>
          <USelect
            v-model="consentDecision"
            :items="[
              { label: 'Zgoda udzielona', value: 'granted' },
              { label: 'Odmowa', value: 'refused' },
              { label: 'Wycofanie zgody', value: 'withdrawn' },
            ]"
            value-key="value"
            class="w-full"
            :disabled="submitting"
          />
        </UFormField>

        <UFormField v-if="isConsent" :label="consentDecisionPresentation.dateLabel" required>
          <UInput v-model="occurredAt" type="datetime-local" class="w-full" :disabled="submitting" />
        </UFormField>

        <template v-if="isDelivery || isUpload || isConsent">
          <UFormField :label="isConsent ? consentDecisionPresentation.peopleLabel : 'Przekazano wnioskodawcom'" :help="isConsent ? consentDecisionPresentation.peopleHelp : 'Pozostaw puste, jeśli na tym etapie tylko załączasz dokument.'">
            <UCheckboxGroup
              v-model="deliveredTo"
              :items="recipients.map(recipient => ({ label: recipient.label, value: recipient.id }))"
              value-key="value"
              :disabled="submitting"
            />
          </UFormField>
          <UFormField v-if="deliveredTo.length" :label="isConsent ? consentDecisionPresentation.evidenceLabel : 'Dowód lub numer referencyjny'" required help="Np. identyfikator wiadomości e-mail, przesyłki albo podpisanego potwierdzenia.">
            <UInput v-model="evidenceReference" class="w-full" :maxlength="500" :disabled="submitting" />
          </UFormField>
          <UFormField v-if="deliveredTo.length && !isConsent" label="Data przekazania" required>
            <UInput v-model="occurredAt" type="datetime-local" class="w-full" />
          </UFormField>
        </template>

        <UAlert
          v-if="actionKind === 'submit-application'"
          color="info"
          variant="subtle"
          icon="i-lucide-shield-check"
          title="Walidacja przed wysłaniem"
          :description="isMockBank ? 'System sprawdzi ważność i doręczenie ESIS. Po złożeniu OpenExpert Bank potwierdzi kompletność i wyśle pozytywną decyzję jako PDF w ZIP-ie zabezpieczonym PESEL-em głównego wnioskodawcy.' : 'System sprawdzi ważność ESIS oraz dowód przekazania go każdemu wnioskodawcy. Braków nie da się ominąć zmianą statusu.'"
        />
      </div>
    </template>

    <template #footer>
      <div class="mortgage-action-footer">
        <UButton color="neutral" variant="ghost" :disabled="submitting" @click="close">Anuluj</UButton>
        <UButton :loading="submitting" :disabled="!expertOverrideReady" icon="i-lucide-check" @click="submit">{{ submitLabel }}</UButton>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
.mortgage-action-form { display: grid; gap: 18px; }
.mortgage-action-footer { display: flex; width: 100%; justify-content: flex-end; gap: 8px; }
</style>
