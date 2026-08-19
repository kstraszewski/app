<script setup lang="ts">
import type { PortalCase, PortalCaseDocument } from '~/types/portal'
import { clientCaseDataKey, clientPortalDataKey } from '~/utils/client-portal-cache'
import { PORTAL_TIME_ZONE } from '~/utils/portal-date'

const props = withDefaults(defineProps<{
  caseData: PortalCase
  preview?: boolean
}>(), {
  preview: false,
})

const toast = useToast()
const { $portalFetch } = useNuxtApp()
const authenticatedUser = useAuthUser()
const uploadInput = ref<HTMLInputElement | null>(null)
const selectedRequirementId = ref('')
const uploadingRequirementId = ref('')

type IdentityExtractionResponse = {
  status: 'applied' | 'applied_with_review' | 'no_changes' | 'needs_review' | 'unavailable' | 'skipped'
  filledFields: string[]
}

const documents = computed(() => props.caseData.documents?.items ?? [])
const pendingDocuments = computed(() => documents.value.filter(item => item.status === 'missing'))
const uploadedDocuments = computed(() => documents.value.filter(item => item.status !== 'missing'))

function refreshMutatedCase() {
  clearNuxtData(clientPortalDataKey(authenticatedUser.value?.id))
  void refreshNuxtData(clientCaseDataKey(authenticatedUser.value?.id, props.caseData.id))
}

function chooseFile(document: PortalCaseDocument) {
  if (uploadingRequirementId.value) return
  selectedRequirementId.value = document.id
  uploadInput.value?.click()
}

async function uploadDocument(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  const requirementId = selectedRequirementId.value
  if (!file || !requirementId) return
  if (file.size > 20 * 1024 * 1024) {
    toast.add({
      title: 'Plik jest zbyt duży',
      description: 'Maksymalny rozmiar pliku to 20 MB.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    input.value = ''
    return
  }

  uploadingRequirementId.value = requirementId
  try {
    let identityExtraction: IdentityExtractionResponse | null = null
    if (!props.preview) {
      const body = new FormData()
      body.append('file', file)
      body.append('requirementId', requirementId)
      const response = await $portalFetch<{
        data: { identityExtraction?: IdentityExtractionResponse | null }
      }>(`/api/client/cases/${encodeURIComponent(props.caseData.id)}/documents`, {
        method: 'POST',
        body,
      })
      identityExtraction = response.data.identityExtraction ?? null
      refreshMutatedCase()
    }
    const extractionApplied = identityExtraction
      && ['applied', 'applied_with_review'].includes(identityExtraction.status)
    toast.add({
      title: extractionApplied
        ? 'Dokument i dane klienta zostały zapisane'
        : 'Dokument został przesłany',
      description: identityExtraction?.status === 'applied_with_review'
        ? 'Pewne dane uzupełniliśmy automatycznie, a pozostałe sprawdzi ekspert.'
        : identityExtraction && ['needs_review', 'unavailable', 'skipped'].includes(identityExtraction.status)
          ? 'Dane z dokumentu sprawdzi ekspert.'
          : file.name,
      color: 'success',
      icon: 'i-lucide-file-check-2',
    })
  }
  catch (caught) {
    if (isUnauthorizedRequestError(caught)) return
    toast.add({
      title: 'Nie udało się przesłać dokumentu',
      description: 'Spróbuj ponownie lub skontaktuj się ze swoim ekspertem.',
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    uploadingRequirementId.value = ''
    selectedRequirementId.value = ''
    input.value = ''
  }
}

function documentDate(document: PortalCaseDocument) {
  const value = document.verifiedAt || document.receivedAt || document.updatedAt
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: PORTAL_TIME_ZONE,
  }).format(date)
}

function statusLabel(document: PortalCaseDocument) {
  if (document.status === 'verified') return 'Zweryfikowany'
  if (document.status === 'received') return 'Czeka na weryfikację'
  return 'Do przesłania'
}

function isIdentityDocument(document: PortalCaseDocument) {
  return ['identity.document', 'identity_document', 'identity']
    .includes(document.documentType.trim().toLowerCase())
}

function downloadUrl(document: PortalCaseDocument) {
  return `/api/client/cases/${encodeURIComponent(props.caseData.id)}/documents/${encodeURIComponent(document.id)}?download=1`
}
</script>

<template>
  <section class="portal-documents" aria-labelledby="portal-documents-title">
    <input
      ref="uploadInput"
      class="portal-sr-only"
      type="file"
      accept="application/pdf,image/jpeg,image/png"
      @change="uploadDocument"
    >

    <header class="portal-documents__header">
      <div>
        <p>DOKUMENTY SPRAWY</p>
        <h2 id="portal-documents-title">Wszystkie dokumenty w jednym miejscu</h2>
        <span>Sprawdź braki, prześlij plik i śledź status weryfikacji przez eksperta.</span>
      </div>
      <dl>
        <div>
          <dt>Do przesłania</dt>
          <dd>{{ pendingDocuments.length }}</dd>
        </div>
        <div>
          <dt>Przesłane</dt>
          <dd>{{ uploadedDocuments.length }}</dd>
        </div>
      </dl>
    </header>

    <OeEmptyState
      v-if="!documents.length"
      icon="i-lucide-folder-open"
      title="Nie ma jeszcze dokumentów w tej sprawie"
      description="Zakładka pojawi się, gdy ekspert poprosi o dokument albo gdy prześlesz pierwszy plik."
    />

    <template v-else>
      <section class="portal-documents__section" aria-labelledby="pending-documents-title">
        <header>
          <div>
            <h3 id="pending-documents-title">Do przesłania</h3>
            <p>Dokumenty, na które czeka ekspert.</p>
          </div>
          <span>{{ pendingDocuments.length }}</span>
        </header>

        <div v-if="pendingDocuments.length" class="portal-documents__list">
          <article v-for="document in pendingDocuments" :key="document.id" class="portal-document-row is-missing">
            <span class="portal-document-row__icon"><UIcon name="i-lucide-file-clock" /></span>
            <div class="portal-document-row__copy">
              <strong>{{ document.name }}</strong>
              <small>
                {{ isIdentityDocument(document)
                  ? 'PDF, JPG lub PNG · dane odczytamy automatycznie'
                  : 'PDF, JPG lub PNG · maksymalnie 20 MB' }}
              </small>
            </div>
            <span class="portal-document-row__status">Do przesłania</span>
            <UButton
              icon="i-lucide-upload"
              :loading="uploadingRequirementId === document.id"
              :disabled="Boolean(uploadingRequirementId)"
              @click="chooseFile(document)"
            >
              Dodaj plik
            </UButton>
          </article>
        </div>

        <OeEmptyState
          v-else
          compact
          align="start"
          kind="success"
          title="Wszystkie wymagane dokumenty są przesłane"
          description="Jeśli ekspert będzie potrzebował kolejnego dokumentu, pojawi się on tutaj automatycznie."
        />
      </section>

      <section class="portal-documents__section" aria-labelledby="uploaded-documents-title">
        <header>
          <div>
            <h3 id="uploaded-documents-title">Przesłane</h3>
            <p>Pliki dodane przez Ciebie w tej sprawie.</p>
          </div>
          <span>{{ uploadedDocuments.length }}</span>
        </header>

        <div v-if="uploadedDocuments.length" class="portal-documents__list">
          <article v-for="document in uploadedDocuments" :key="document.id" class="portal-document-row">
            <span class="portal-document-row__icon"><UIcon name="i-lucide-file-check-2" /></span>
            <div class="portal-document-row__copy">
              <strong>{{ document.name }}</strong>
              <small>{{ documentDate(document) }}</small>
            </div>
            <span :class="['portal-document-row__status', `is-${document.status}`]">
              {{ statusLabel(document) }}
            </span>
            <UButton
              v-if="document.canDownload && !preview"
              :to="downloadUrl(document)"
              external
              color="neutral"
              variant="outline"
              icon="i-lucide-download"
            >
              Pobierz
            </UButton>
          </article>
        </div>

        <OeEmptyState
          v-else
          compact
          align="start"
          icon="i-lucide-file-up"
          title="Nie przesłano jeszcze żadnego dokumentu"
          description="Dodaj pierwszy plik przy odpowiedniej pozycji powyżej."
        />
      </section>
    </template>
  </section>
</template>

<style scoped>
.portal-documents { display: grid; gap: 34px; }
.portal-documents__header { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; padding: 26px; border: 1px solid var(--portal-line); border-radius: 20px; background: var(--portal-warm-surface); }
.portal-documents__header p, .portal-documents__header h2, .portal-documents__header span, .portal-documents__section h3, .portal-documents__section p { margin: 0; }
.portal-documents__header p { color: var(--ui-text-muted); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; }
.portal-documents__header h2 { margin-top: 7px; font-size: clamp(22px, 2.5vw, 30px); font-weight: 500; line-height: 1.2; }
.portal-documents__header > div > span { display: block; margin-top: 8px; color: var(--ui-text-muted); font-size: 13px; line-height: 1.5; }
.portal-documents__header dl { display: grid; grid-template-columns: repeat(2, minmax(100px, 1fr)); flex: 0 0 auto; gap: 8px; margin: 0; }
.portal-documents__header dl > div { min-width: 112px; padding: 13px 15px; border: 1px solid var(--ui-border); border-radius: 13px; background: var(--ui-bg); }
.portal-documents__header dt { color: var(--ui-text-muted); font-size: 10px; }
.portal-documents__header dd { margin: 3px 0 0; font-size: 24px; font-weight: 600; }
.portal-documents__section { display: grid; gap: 14px; }
.portal-documents__section > header { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.portal-documents__section h3 { font-size: 18px; font-weight: 650; }
.portal-documents__section p { margin-top: 3px; color: var(--ui-text-muted); font-size: 12px; }
.portal-documents__section > header > span { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 999px; background: var(--ui-bg-elevated); color: var(--ui-text-toned); font-size: 11px; font-weight: 700; }
.portal-documents__list { overflow: hidden; border: 1px solid var(--portal-line); border-radius: 16px; }
.portal-document-row { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto auto; align-items: center; gap: 14px; min-height: 78px; padding: 14px 16px; border-top: 1px solid var(--portal-line); background: var(--ui-bg); }
.portal-document-row:first-child { border-top: 0; }
.portal-document-row__icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 12px; background: var(--ui-bg-elevated); color: var(--ui-text-toned); }
.portal-document-row__icon svg { width: 20px; height: 20px; }
.portal-document-row__copy { min-width: 0; }
.portal-document-row__copy strong, .portal-document-row__copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.portal-document-row__copy strong { color: var(--ui-text-highlighted); font-size: 13px; }
.portal-document-row__copy small { margin-top: 4px; color: var(--ui-text-muted); font-size: 10px; }
.portal-document-row__status { display: inline-flex; align-items: center; min-height: 25px; padding: 0 9px; border-radius: 999px; background: color-mix(in srgb, var(--ui-warning) 12%, var(--ui-bg)); color: var(--ui-warning); font-size: 9px; font-weight: 700; white-space: nowrap; }
.portal-document-row__status.is-received { background: color-mix(in srgb, var(--ui-info) 11%, var(--ui-bg)); color: var(--ui-info); }
.portal-document-row__status.is-verified { background: color-mix(in srgb, var(--ui-success) 11%, var(--ui-bg)); color: var(--ui-success); }

@media (max-width: 720px) {
  .portal-documents { gap: 28px; }
  .portal-documents__header { align-items: stretch; flex-direction: column; padding: 20px; }
  .portal-documents__header dl { width: 100%; }
  .portal-documents__header dl > div { min-width: 0; }
  .portal-document-row { grid-template-columns: 38px minmax(0, 1fr) auto; gap: 11px; padding: 13px; }
  .portal-document-row__icon { width: 38px; height: 38px; }
  .portal-document-row__status { grid-column: 2; justify-self: start; }
  .portal-document-row :deep(button), .portal-document-row :deep(a) { grid-column: 3; grid-row: 1 / span 2; }
}

@media (max-width: 470px) {
  .portal-document-row { grid-template-columns: 38px minmax(0, 1fr); }
  .portal-document-row__status { grid-column: 2; }
  .portal-document-row :deep(button), .portal-document-row :deep(a) { grid-column: 1 / -1; grid-row: auto; width: 100%; }
}
</style>
