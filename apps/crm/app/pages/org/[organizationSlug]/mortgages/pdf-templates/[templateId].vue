<script setup lang="ts">
import type {
  DocumentTemplate,
  TemplateValidationIssue,
  TemplateValidationResult,
} from '@openexpert/multiform'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({
  middleware: ['auth', 'organization'],
  path: 'settings/institutions/:bankId/pdf-templates/:templateId',
  alias: ['mortgages/institutions/:bankId/pdf-templates/:templateId'],
  crmContentMode: 'workspace',
})

type TemplateSummary = {
  pages: number
  fillMode: string
  fieldCount: number
  mappedFieldCount: number
  manualUserActionCount: number
  coverageStatus: string
  activationReady: boolean
  errors: number
  warnings: number
}

type EditorResponse = {
  schemaVersion: 1
  bank: {
    id: string
    slug: string
    name: string
  }
  template: {
    id: string
    label: string
    sourceKind: 'registered'
    pdfUrl: string
    editor: {
      template: DocumentTemplate
      validation: TemplateValidationResult
      basedOn: 'draft' | 'catalog' | 'registry'
    }
    draft: null | {
      revision: number
      updatedAt: string | null
      summary: TemplateSummary
    }
    active: {
      origin: 'catalog' | 'registry'
      revision: number
      publishedAt: string | null
      template: DocumentTemplate
      validation: TemplateValidationResult
      summary: TemplateSummary
    }
    history: Array<{
      id: string
      action: 'draft_saved' | 'published'
      revision: number
      createdAt: string | null
      actor: null | {
        id: string
        name: string | null
        email: string | null
      }
    }>
  }
}

type SyntaxState = {
  valid: boolean
  value?: unknown
  message?: string
  line?: number
  column?: number
}

type SuggestionResponse = {
  schemaVersion: 1
  template: DocumentTemplate
  validation: TemplateValidationResult
  generation: {
    model: string
    proposedCount: number
    addedCount: number
    skippedTargetCount: number
    skippedUnmappedCount: number
  }
}

const route = useRoute()
const toast = useToast()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const bankId = computed(() => String(route.params.bankId ?? ''))
const templateId = computed(() => String(route.params.templateId ?? ''))
const profilePath = computed(() => (
  `/org/${encodeURIComponent(organizationSlug.value)}/settings/institutions/${encodeURIComponent(bankId.value)}?view=templates`
))
const apiPath = computed(() => (
  `/api/org/${encodeURIComponent(organizationSlug.value)}/mortgages/banks/${encodeURIComponent(bankId.value)}/templates/${encodeURIComponent(templateId.value)}`
))

const { data, status, error, refresh } = await useFetch<EditorResponse>(apiPath, {
  key: `pdf-template-editor:${organizationSlug.value}:${bankId.value}:${templateId.value}`,
})

const editorText = ref('')
const savedSnapshot = ref('')
const validation = ref<TemplateValidationResult | null>(null)
const validatedSnapshot = ref('')
const editorMode = ref<'visual' | 'json'>('visual')
const saving = ref(false)
const validating = ref(false)
const publishing = ref(false)
const suggestingMappings = ref(false)
const aiUndoState = ref<{
  beforeText: string
  beforeValidation: TemplateValidationResult | null
  beforeValidatedSnapshot: string
  afterText: string
} | null>(null)
const initializedFor = ref('')

const template = computed(() => data.value?.template ?? null)
const bank = computed(() => data.value?.bank ?? null)
const dirty = computed(() => editorText.value !== savedSnapshot.value)
const validationStale = computed(() => Boolean(validation.value) && validatedSnapshot.value !== editorText.value)
const issueList = computed<TemplateValidationIssue[]>(() => validation.value
  ? [...validation.value.errors, ...validation.value.warnings]
  : [])
const syntax = computed<SyntaxState>(() => parseJson(editorText.value))
const canPublish = computed(() => Boolean(
  template.value?.draft
  && !dirty.value
  && !validationStale.value
  && validation.value?.summary.activationReady,
))
const reviewCount = computed(() => validation.value?.summary.needsReviewCount ?? 0)
const releaseAttentionCount = computed(() => (
  reviewCount.value
  + (validation.value?.summary.unmappedCount ?? 0)
))
const saveStateLabel = computed(() => {
  if (saving.value) return 'Zapisywanie…'
  if (dirty.value) return 'Niezapisane'
  if (template.value?.draft?.updatedAt) return `Zapisano ${formatTime(template.value.draft.updatedAt)}`
  return 'Zapisano'
})
const validationStateLabel = computed(() => {
  if (validating.value) return 'Sprawdzanie…'
  if (validationStale.value) return 'Walidacja nieaktualna'
  if (validation.value?.summary.activationReady) return 'Walidacja aktualna'
  if (releaseAttentionCount.value > 0) return `${releaseAttentionCount.value} pól wymaga weryfikacji`
  return 'Wymaga uzupełnienia'
})
const saveStateDetailLabel = computed(() => {
  if (dirty.value || validationStale.value || validating.value) return validationStateLabel.value
  return template.value?.draft ? `Szkic r${template.value.draft.revision}` : 'Nowy szkic'
})
const studioDescription = computed(() => {
  if (!template.value) return bank.value?.name ?? 'Szablon PDF'
  return `${bank.value?.name ?? 'Instytucja'} · ${template.value.editor.template.source.pageCount} stron`
})

useHead(() => ({
  title: `${template.value?.label ?? 'Szablon PDF'} — ${bank.value?.name ?? 'Instytucja'} — OpenExpert`,
}))

watch(data, (payload) => {
  if (!payload?.template) return
  const key = `${payload.template.id}:${payload.template.draft?.revision ?? 0}:${payload.template.active.revision}`
  if (initializedFor.value === key && dirty.value) return
  const text = JSON.stringify(payload.template.editor.template, null, 2)
  editorText.value = text
  savedSnapshot.value = text
  validation.value = payload.template.editor.validation
  validatedSnapshot.value = text
  aiUndoState.value = null
  initializedFor.value = key
}, { immediate: true })

watch(editorText, (text) => {
  if (aiUndoState.value && text !== aiUndoState.value.afterText) {
    aiUndoState.value = null
  }
})

onBeforeRouteLeave(() => {
  if (!dirty.value || !import.meta.client) return true
  return window.confirm('Masz niezapisane zmiany w Template JSON. Czy na pewno chcesz opuścić edytor?')
})

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('keydown', handleSaveShortcut)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('keydown', handleSaveShortcut)
})

function parseJson(text: string): SyntaxState {
  if (!text.trim()) return { valid: false, message: 'Edytor jest pusty.' }
  try {
    return { valid: true, value: JSON.parse(text) as unknown }
  }
  catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Nie udało się odczytać JSON-u.'
    const positionMatch = message.match(/position\s+(\d+)/i)
    if (!positionMatch) return { valid: false, message }
    const beforeError = text.slice(0, Number(positionMatch[1]))
    const lines = beforeError.split('\n')
    return {
      valid: false,
      message,
      line: lines.length,
      column: (lines.at(-1)?.length ?? 0) + 1,
    }
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
}

function handleSaveShortcut(event: KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 's') return
  event.preventDefault()
  void saveDraft()
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function historyLabel(action: 'draft_saved' | 'published') {
  return action === 'published' ? 'Opublikowano wersję' : 'Zapisano szkic'
}

async function validateEditor(showSuccess = true) {
  if (
    validating.value
    || suggestingMappings.value
    || saving.value
    || publishing.value
  ) {
    return null
  }
  const submittedText = editorText.value
  const submittedSyntax = parseJson(submittedText)
  if (!submittedSyntax.valid) {
    toast.add({
      title: 'JSON ma błąd składni',
      description: submittedSyntax.line
        ? `Linia ${submittedSyntax.line}, kolumna ${submittedSyntax.column}.`
        : submittedSyntax.message,
      color: 'error',
    })
    return null
  }
  validating.value = true
  try {
    const result = await $fetch<TemplateValidationResult>(`${apiPath.value}/validate`, {
      method: 'POST',
      body: { template: submittedSyntax.value },
    })
    if (editorText.value !== submittedText) {
      if (showSuccess) {
        toast.add({
          title: 'Treść zmieniła się podczas walidacji',
          description: 'Wynik starszej wersji został pominięty. Uruchom walidację ponownie.',
          color: 'warning',
        })
      }
      return null
    }
    validation.value = result
    validatedSnapshot.value = submittedText
    if (showSuccess) {
      toast.add({
        title: result.valid ? 'Walidacja zakończona' : 'Template wymaga poprawek',
        description: result.summary.activationReady
          ? 'Mapowanie jest gotowe do publikacji.'
          : `${result.errors.length} błędów i ${result.warnings.length} ostrzeżeń.`,
        color: result.summary.activationReady ? 'success' : result.valid ? 'warning' : 'error',
      })
    }
    return result
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się zwalidować szablonu',
      description: apiErrorMessage(caught),
      color: 'error',
    })
    return null
  }
  finally {
    validating.value = false
  }
}

async function suggestMappings() {
  if (
    !template.value
    || suggestingMappings.value
    || validating.value
    || saving.value
    || publishing.value
  ) {
    return
  }
  const submittedText = editorText.value
  const submittedSyntax = parseJson(submittedText)
  if (!submittedSyntax.valid) return
  suggestingMappings.value = true
  const beforeAi = {
    text: submittedText,
    validation: validation.value,
    validatedSnapshot: validatedSnapshot.value,
  }
  try {
    const response = await $fetch<SuggestionResponse>(`${apiPath.value}/suggest`, {
      method: 'POST',
      body: {
        expectedRevision: template.value.draft?.revision ?? 0,
        template: submittedSyntax.value,
      },
    })
    if (editorText.value !== submittedText) {
      toast.add({
        title: 'Edytor zmienił się podczas analizy AI',
        description: 'Propozycje dla starszej wersji zostały pominięte. Uruchom analizę ponownie.',
        color: 'warning',
      })
      return
    }
    const nextText = JSON.stringify(response.template, null, 2)
    editorText.value = nextText
    validation.value = response.validation
    validatedSnapshot.value = nextText
    editorMode.value = 'visual'
    aiUndoState.value = response.generation.addedCount > 0
      ? {
          beforeText: beforeAi.text,
          beforeValidation: beforeAi.validation,
          beforeValidatedSnapshot: beforeAi.validatedSnapshot,
          afterText: nextText,
        }
      : null
    toast.add({
      title: response.generation.addedCount > 0
        ? 'Agent AI dodał propozycje mapowań'
        : 'Agent AI nie znalazł nowych targetów',
      description: response.generation.addedCount > 0
        ? `Dodano ${response.generation.addedCount} pól jako „do przeglądu”. Pominięto ${response.generation.skippedTargetCount} zajętych targetów.`
        : 'Istniejące mapowania pozostawiono bez zmian.',
      color: response.generation.addedCount > 0 ? 'success' : 'neutral',
    })
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się wygenerować mapowań AI',
      description: apiErrorMessage(caught),
      color: 'error',
    })
  }
  finally {
    suggestingMappings.value = false
  }
}

function undoAiSuggestions() {
  const previous = aiUndoState.value
  if (!previous || editorText.value !== previous.afterText) return
  editorText.value = previous.beforeText
  validation.value = previous.beforeValidation
  validatedSnapshot.value = previous.beforeValidatedSnapshot
  aiUndoState.value = null
  toast.add({
    title: 'Cofnięto propozycje Agenta AI',
    description: 'Przywrócono stan edytora sprzed analizy PDF.',
    color: 'neutral',
  })
}

async function saveDraft() {
  if (
    !template.value
    || saving.value
    || validating.value
    || suggestingMappings.value
    || publishing.value
  ) {
    return false
  }
  const currentValidation = validatedSnapshot.value === editorText.value
    ? validation.value
    : await validateEditor(false)
  if (!currentValidation?.valid || !syntax.value.valid) {
    toast.add({
      title: 'Szkic nie został zapisany',
      description: 'Popraw błędy Template JSON wskazane przez walidator.',
      color: 'error',
    })
    return false
  }

  const submittedText = editorText.value
  const submittedSyntax = parseJson(submittedText)
  if (!submittedSyntax.valid || validatedSnapshot.value !== submittedText) return false
  saving.value = true
  try {
    await $fetch(apiPath.value, {
      method: 'PUT',
      body: {
        expectedRevision: template.value.draft?.revision ?? 0,
        template: submittedSyntax.value,
      },
    })
    const textChangedDuringSave = editorText.value !== submittedText
      ? editorText.value
      : null
    await refresh()
    if (textChangedDuringSave !== null) {
      editorText.value = textChangedDuringSave
      savedSnapshot.value = JSON.stringify(
        data.value?.template.editor.template ?? submittedSyntax.value,
        null,
        2,
      )
      validation.value = null
      validatedSnapshot.value = ''
    }
    toast.add({
      title: 'Szkic zapisany w CRM',
      description: textChangedDuringSave === null
        ? 'Zmiana została zapisana po stronie serwera i dodana do historii.'
        : 'Zapisano wysłaną wersję. Późniejsze zmiany nadal czekają w edytorze na zapis.',
      color: 'success',
    })
    return true
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się zapisać szkicu',
      description: apiErrorMessage(caught),
      color: 'error',
    })
    return false
  }
  finally {
    saving.value = false
  }
}

async function publishDraft() {
  if (
    !template.value?.draft
    || !canPublish.value
    || publishing.value
    || validating.value
    || suggestingMappings.value
    || saving.value
  ) {
    return
  }
  publishing.value = true
  try {
    await $fetch(`${apiPath.value}/publish`, {
      method: 'POST',
      body: { expectedRevision: template.value.draft.revision },
    })
    await refresh()
    toast.add({
      title: 'Opublikowano wersję szablonu',
      description: 'Utworzono niemutowalną rewizję gotową do przypięcia do wersji produktu.',
      color: 'success',
    })
  }
  catch (caught) {
    toast.add({
      title: 'Nie udało się opublikować szablonu',
      description: apiErrorMessage(caught),
      color: 'error',
    })
  }
  finally {
    publishing.value = false
  }
}
</script>

<template>
  <CrmShell
    class="template-studio-shell"
    :title="template?.id ?? templateId"
    :description="studioDescription"
    :back-to="profilePath"
    back-label="Wróć"
  >
    <template #actions>
      <div
        class="studio-save-state"
        :class="{
          'studio-save-state--dirty': dirty,
          'studio-save-state--ready': !dirty && !validationStale && validation?.summary.activationReady,
        }"
        role="status"
        aria-live="polite"
      >
        <span aria-hidden="true" />
        <div>
          <strong>{{ saveStateLabel }}</strong>
          <small>{{ saveStateDetailLabel }}</small>
        </div>
      </div>
      <UButton
        class="studio-header-action"
        color="neutral"
        variant="ghost"
        icon="i-lucide-shield-check"
        :loading="validating"
        :disabled="suggestingMappings || validating || saving || publishing"
        @click="validateEditor()"
      >
        Sprawdź
      </UButton>
      <UButton
        class="studio-header-action"
        color="neutral"
        variant="solid"
        icon="i-lucide-save"
        :loading="saving"
        :disabled="!dirty || !syntax.valid || suggestingMappings || validating || publishing"
        @click="saveDraft"
      >
        Zapisz
      </UButton>
      <UButton
        class="studio-header-action"
        color="success"
        variant="outline"
        icon="i-lucide-rocket"
        :loading="publishing"
        :disabled="!canPublish || suggestingMappings || validating || saving"
        :title="canPublish ? 'Opublikuj zatwierdzoną rewizję' : 'Najpierw zapisz kompletny szablon bez ostrzeżeń blokujących aktywację'"
        @click="publishDraft"
      >
        Opublikuj
      </UButton>
      <span v-if="!canPublish" class="studio-publish-blocker">
        {{ releaseAttentionCount || (validation?.errors.length ?? 0) }}
        {{ releaseAttentionCount === 1 ? 'pole wymaga weryfikacji' : 'pól wymaga weryfikacji' }}
      </span>
    </template>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się otworzyć edytora PDF"
      :description="apiErrorMessage(error)"
      :actions="[{ label: 'Ponów', onClick: () => refresh() }]"
    />

    <div v-else-if="status === 'pending' || status === 'idle'" class="editor-loading">
      <USkeleton class="h-20 w-full" />
      <USkeleton class="h-[720px] w-full" />
    </div>

    <div
      v-else-if="template"
      class="template-editor-page"
      :class="{
        'template-editor-page--visual': editorMode === 'visual',
        'template-editor-page--json': editorMode === 'json',
      }"
    >
      <ClientOnly v-if="editorMode === 'visual'">
        <div class="studio-workspace">
          <MortgagesPdfTemplateVisualEditor
            v-model:template-text="editorText"
            :template-id="template.id"
            :source-kind="template.sourceKind"
            :pdf-url="template.pdfUrl"
            :semantic-hints-url="`${apiPath}/semantic-hints`"
            :semantic-hints-expected-revision="template.draft?.revision ?? 0"
          >
            <template #studio-actions>
              <div class="studio-embedded-actions" aria-label="Tryb i narzędzia szablonu">
                <UFieldGroup>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="solid"
                    icon="i-lucide-panels-top-left"
                    size="sm"
                  >
                    Widok
                  </UButton>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-braces"
                    size="sm"
                    @click="editorMode = 'json'"
                  >
                    JSON
                  </UButton>
                </UFieldGroup>
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-sparkles"
                  size="sm"
                  :loading="suggestingMappings"
                  :disabled="!syntax.valid || suggestingMappings || validating || saving || publishing"
                  title="Przeanalizuj źródłowy PDF i dodaj propozycje wymagające ręcznego zatwierdzenia"
                  @click="suggestMappings"
                >
                  AI
                </UButton>
                <UButton
                  v-if="aiUndoState"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-undo-2"
                  size="sm"
                  :disabled="suggestingMappings || validating || saving || publishing"
                  @click="undoAiSuggestions"
                >
                  Cofnij AI
                </UButton>

                <UPopover :content="{ align: 'end', side: 'bottom', sideOffset: 8 }">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-list-checks"
                    size="sm"
                    aria-label="Szczegóły wersji"
                    title="Szczegóły wersji"
                  />
                  <template #content>
                    <section class="version-popover" aria-label="Szczegóły wersji i walidacji">
                      <header class="version-popover__header">
                        <div>
                          <span>Szkic</span>
                          <strong>{{ template.draft ? `Rewizja ${template.draft.revision}` : 'Nowy' }}</strong>
                        </div>
                        <UBadge :color="validation?.summary.activationReady ? 'success' : 'warning'" variant="subtle">
                          {{ validation?.summary.activationReady && !validationStale ? 'Gotowy' : 'Wymaga uwagi' }}
                        </UBadge>
                      </header>

                      <dl class="version-metadata">
                        <div>
                          <dt>Aktywna konfiguracja</dt>
                          <dd>{{ template.active.origin === 'catalog' ? `CRM · rewizja ${template.active.revision}` : 'Rejestr wdrożeniowy' }}</dd>
                        </div>
                        <div>
                          <dt>Dokument</dt>
                          <dd>{{ template.editor.template.source.fileName }}</dd>
                        </div>
                        <div>
                          <dt>Ostatni zapis</dt>
                          <dd>{{ template.draft ? formatDate(template.draft.updatedAt) : 'Nie zapisano' }}</dd>
                        </div>
                      </dl>

                      <div v-if="validation" class="validation-summary">
                        <article><span>Mapowania</span><strong>{{ validation.summary.bindingCount }}</strong></article>
                        <article><span>Gotowe</span><strong>{{ validation.summary.readyBindingCount }}</strong></article>
                        <article><span>Do weryfikacji</span><strong>{{ validation.summary.needsReviewCount }}</strong></article>
                        <article><span>Bez targetu</span><strong>{{ validation.summary.unmappedCount }}</strong></article>
                      </div>

                      <div class="version-popover__section">
                        <div class="details-heading">
                          <div>
                            <span>Kontrola jakości</span>
                            <h2>Walidacja mapowania</h2>
                          </div>
                          <UBadge color="neutral" variant="outline">
                            {{ validation?.errors.length ?? 0 }} / {{ validation?.warnings.length ?? 0 }}
                          </UBadge>
                        </div>
                        <ul v-if="issueList.length" class="validation-issues">
                          <li v-for="(issue, index) in issueList" :key="`${issue.code}:${issue.path}:${index}`">
                            <UIcon :name="issue.severity === 'error' ? 'i-lucide-circle-x' : 'i-lucide-triangle-alert'" />
                            <span><strong>{{ issue.message }}</strong><code>{{ issue.path || issue.code }}</code></span>
                          </li>
                        </ul>
                        <div v-else class="validation-empty">
                          <UIcon name="i-lucide-circle-check-big" />
                          <span>Walidator nie zgłasza problemów.</span>
                        </div>
                      </div>

                      <div class="version-popover__section">
                        <div class="details-heading">
                          <div>
                            <span>Audyt</span>
                            <h2>Historia konfiguracji</h2>
                          </div>
                          <UBadge color="neutral" variant="outline">{{ template.history.length }}</UBadge>
                        </div>
                        <ol v-if="template.history.length" class="template-history">
                          <li v-for="entry in template.history" :key="entry.id">
                            <span :class="{ 'history-published': entry.action === 'published' }" />
                            <div>
                              <strong>{{ historyLabel(entry.action) }} · r{{ entry.revision }}</strong>
                              <p>{{ entry.actor?.name || entry.actor?.email || 'SuperAdmin' }}</p>
                              <small>{{ formatDate(entry.createdAt) }}</small>
                            </div>
                          </li>
                        </ol>
                        <div v-else class="validation-empty">
                          Historia rozpocznie się po pierwszym zapisie szkicu.
                        </div>
                      </div>
                    </section>
                  </template>
                </UPopover>
              </div>
            </template>
          </MortgagesPdfTemplateVisualEditor>
        </div>
        <template #fallback>
          <USkeleton class="h-[calc(100dvh-160px)] w-full" />
        </template>
      </ClientOnly>

      <section v-else class="json-editor" aria-label="Edytor Template JSON">
        <header class="json-editor__toolbar">
          <div class="json-editor__meta">
            <span>Template JSON V2</span>
            <strong>{{ editorText.split('\n').length }} linii · {{ editorText.length }} znaków</strong>
          </div>
          <div class="json-editor__actions">
            <UBadge :color="syntax.valid ? 'success' : 'error'" variant="subtle">
              {{ syntax.valid ? 'Poprawna składnia' : 'Błąd składni' }}
            </UBadge>
            <UFieldGroup aria-label="Tryb edytora szablonu">
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                icon="i-lucide-panels-top-left"
                size="sm"
                title="Wróć do widoku wizualnego"
                @click="editorMode = 'visual'"
              >
                Widok
              </UButton>
              <UButton
                type="button"
                color="neutral"
                variant="solid"
                icon="i-lucide-braces"
                size="sm"
                aria-current="page"
              >
                JSON
              </UButton>
            </UFieldGroup>
          </div>
        </header>
        <div class="json-editor__body">
          <textarea
            v-model="editorText"
            spellcheck="false"
            aria-label="Template JSON"
            aria-describedby="json-editor-help"
            class="json-editor__input"
            @keydown.esc.stop="editorMode = 'visual'"
          />
        </div>
        <p id="json-editor-help" class="json-editor__help">
          Edytujesz roboczą wersję szablonu. Naciśnij Esc albo wybierz „Widok”, aby wrócić bez utraty zmian.
        </p>
        <UAlert
          v-if="!syntax.valid"
          color="error"
          variant="subtle"
          icon="i-lucide-braces"
          title="Niepoprawny JSON"
          :description="syntax.line ? `Linia ${syntax.line}, kolumna ${syntax.column}: ${syntax.message}` : syntax.message"
        />
      </section>
    </div>
  </CrmShell>
</template>

<style scoped>
.template-studio-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  max-width: none;
}

.template-studio-shell :deep(.crm-page-header) {
  flex: 0 0 auto;
  grid-template-columns: minmax(250px, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-height: 64px;
  margin-bottom: 0;
  padding: 8px 0 10px;
}

.template-studio-shell :deep(.crm-page-header__copy) {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: center;
  column-gap: 10px;
}

.template-studio-shell :deep(.crm-page-header__back) {
  grid-row: 1 / span 2;
  align-self: center;
  justify-content: center;
  width: 40px;
  min-height: 40px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  font-size: 0;
}

.template-studio-shell :deep(.crm-page-header h1) {
  overflow: hidden;
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-studio-shell :deep(.crm-page-header__description) {
  overflow: hidden;
  max-width: none;
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-studio-shell :deep(.crm-page-header__actions) {
  gap: 8px;
}

.editor-loading,
.template-editor-page {
  display: grid;
  min-width: 0;
}

.editor-loading {
  gap: 12px;
  padding-top: 12px;
}

.template-editor-page--visual {
  flex: 1 1 auto;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}

.template-editor-page--json {
  flex: 1 1 auto;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}

.studio-save-state {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 150px;
  padding-right: 4px;
}

.studio-save-state > span {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ui-text-muted);
}

.studio-save-state--dirty > span {
  background: var(--ui-warning);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-warning) 12%, transparent);
}

.studio-save-state--ready > span {
  background: var(--ui-success);
}

.studio-save-state > div {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.studio-save-state strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
  line-height: 1.25;
}

.studio-save-state small,
.studio-publish-blocker {
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.25;
  white-space: nowrap;
}

.studio-publish-blocker {
  max-width: 126px;
  white-space: normal;
}

.studio-embedded-actions,
.json-editor__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.studio-workspace {
  min-height: 0;
  overflow: hidden;
  background: var(--ui-bg);
}

.studio-workspace :deep(.visual-editor) {
  height: 100%;
  min-height: 0;
}

.json-editor {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.json-editor__toolbar {
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 64px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.json-editor__meta {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.json-editor__meta span,
.details-heading span,
.validation-summary span,
.version-metadata dt,
.version-popover__header span {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.json-editor__meta strong {
  color: var(--ui-text-toned);
  font-size: 12px;
}

.json-editor__body {
  min-height: 0;
  padding: 12px 14px 8px;
  overflow: hidden;
}

.json-editor__input {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 14px 16px;
  resize: none;
  overflow: auto;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg);
  border: 1px solid var(--ui-border);
  border-radius: calc(var(--ui-radius) * .75);
  outline: none;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.65;
  tab-size: 2;
  caret-color: var(--ui-primary);
}

.json-editor__input:focus-visible {
  border-color: var(--ui-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-primary) 18%, transparent);
}

.json-editor__help {
  margin: 0;
  padding: 0 14px 12px;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.4;
}

.json-editor > :deep([data-slot='root'][role='alert']) {
  margin: 0 14px 12px;
}

.version-popover {
  width: min(440px, calc(100vw - 32px));
  max-height: min(720px, calc(100dvh - 96px));
  overflow-y: auto;
  background: var(--ui-bg);
}

.version-popover__header {
  position: sticky;
  z-index: 2;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.version-popover__header > div {
  display: grid;
  gap: 3px;
}

.version-popover__header strong {
  font-size: 15px;
}

.version-metadata {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ui-border);
}

.version-metadata > div {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
}

.version-metadata dd {
  overflow: hidden;
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-popover__section {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid var(--ui-border);
}

.details-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.details-heading h2 { margin: 3px 0 0; font-size: 14px; font-weight: 650; }
.validation-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; padding: 14px 16px; }
.validation-summary article { display: grid; gap: 4px; padding: 10px; border: 1px solid var(--ui-border); border-radius: calc(var(--ui-radius) * .75); background: var(--ui-bg-muted); }
.validation-summary strong { font-size: 17px; }
.validation-issues { display: grid; gap: 7px; max-height: 360px; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.validation-issues li { display: flex; gap: 9px; padding: 9px 10px; border: 1px solid var(--ui-border); border-radius: calc(var(--ui-radius) * .7); }
.validation-issues li > svg { flex: 0 0 auto; margin-top: 2px; color: var(--ui-warning); }
.validation-issues li span { display: grid; gap: 3px; min-width: 0; }
.validation-issues li strong { color: var(--ui-text-toned); font-size: 12px; line-height: 1.4; }
.validation-issues li code { overflow: hidden; color: var(--ui-text-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.validation-empty { display: flex; align-items: center; gap: 8px; min-height: 52px; color: var(--ui-text-muted); font-size: 11px; }
.validation-empty > svg { color: var(--ui-success); }
.template-history { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.template-history li { position: relative; display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 9px; padding: 2px 0 14px; }
.template-history li > span { z-index: 1; width: 9px; height: 9px; margin-top: 4px; border: 2px solid var(--ui-bg); border-radius: 50%; background: var(--ui-primary); box-shadow: 0 0 0 1px var(--ui-border); }
.template-history li > span::after { position: absolute; top: 15px; bottom: -4px; left: 4px; width: 1px; background: var(--ui-border); content: ''; }
.template-history li:last-child > span::after { display: none; }
.template-history .history-published { background: var(--ui-success); }
.template-history li div { display: grid; gap: 2px; }
.template-history strong { font-size: 11px; }
.template-history p, .template-history small { margin: 0; color: var(--ui-text-muted); font-size: 10px; }

@media (max-width: 1260px) {
  .template-studio-shell :deep(.crm-page-header) {
    grid-template-columns: minmax(220px, 1fr) auto;
  }

  .template-studio-shell :deep(.crm-page-header__actions) {
    justify-content: flex-end;
  }

}

@media (max-width: 900px) {
  .template-studio-shell :deep(.crm-page-header) {
    grid-template-columns: 1fr;
    min-height: 0;
    padding: 8px;
  }

  .template-studio-shell :deep(.crm-page-header__actions) {
    display: grid;
    grid-column: 1;
    grid-row: 2;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: auto auto;
    gap: 6px;
    width: 100%;
    overflow: visible;
  }

  .studio-save-state {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
    padding: 0 2px;
  }

  .studio-save-state small {
    display: none;
  }

  .studio-header-action {
    grid-row: 2;
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding-inline: 8px;
    justify-content: center;
  }

  .studio-publish-blocker {
    grid-column: 2 / -1;
    grid-row: 1;
    justify-self: end;
    max-width: none;
    padding-right: 2px;
    text-align: right;
  }

  .template-editor-page--visual {
    min-height: 0;
    overflow: hidden;
  }

  .template-editor-page--json {
    min-height: 0;
  }

  .json-editor__toolbar {
    align-items: flex-start;
  }

  .json-editor__actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .studio-embedded-actions {
    flex: 0 0 auto;
  }

  .validation-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
