<script setup lang="ts">
import type {
  DocumentTemplate,
  TemplateValidationIssue,
  TemplateValidationResult,
} from '@openexpert/multiform'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({
  middleware: ['auth', 'organization'],
  path: '/org/:organizationSlug/settings/institutions/:bankId/pdf-templates/:templateId',
  alias: ['/org/:organizationSlug/mortgages/institutions/:bankId/pdf-templates/:templateId'],
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
  initializedFor.value = key
}, { immediate: true })

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

function historyLabel(action: 'draft_saved' | 'published') {
  return action === 'published' ? 'Opublikowano wersję' : 'Zapisano szkic'
}

async function validateEditor(showSuccess = true) {
  if (!syntax.value.valid) {
    toast.add({
      title: 'JSON ma błąd składni',
      description: syntax.value.line
        ? `Linia ${syntax.value.line}, kolumna ${syntax.value.column}.`
        : syntax.value.message,
      color: 'error',
    })
    return null
  }
  validating.value = true
  try {
    const result = await $fetch<TemplateValidationResult>(`${apiPath.value}/validate`, {
      method: 'POST',
      body: { template: syntax.value.value },
    })
    validation.value = result
    validatedSnapshot.value = editorText.value
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

async function saveDraft() {
  if (!template.value || saving.value) return false
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

  saving.value = true
  try {
    await $fetch(apiPath.value, {
      method: 'PUT',
      body: {
        expectedRevision: template.value.draft?.revision ?? 0,
        template: syntax.value.value,
      },
    })
    await refresh()
    toast.add({
      title: 'Szkic zapisany w CRM',
      description: 'Zmiana została zapisana po stronie serwera i dodana do historii.',
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
  if (!template.value?.draft || !canPublish.value || publishing.value) return
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
    :title="template?.label ?? 'Edytor szablonu PDF'"
    eyebrow="Instytucja · Szablony PDF"
    :description="bank ? `${bank.name} · ${templateId}` : templateId"
    :back-to="profilePath"
    back-label="Wróć do szablonów PDF"
  >
    <template #actions>
      <UFieldGroup>
        <UButton
          color="neutral"
          :variant="editorMode === 'visual' ? 'solid' : 'outline'"
          icon="i-lucide-panels-top-left"
          @click="editorMode = 'visual'"
        >
          Wizualnie
        </UButton>
        <UButton
          color="neutral"
          :variant="editorMode === 'json' ? 'solid' : 'outline'"
          icon="i-lucide-braces"
          @click="editorMode = 'json'"
        >
          JSON
        </UButton>
      </UFieldGroup>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-shield-check"
        :loading="validating"
        @click="validateEditor()"
      >
        Waliduj
      </UButton>
      <UButton
        icon="i-lucide-save"
        :loading="saving"
        :disabled="!dirty || !syntax.valid"
        @click="saveDraft"
      >
        Zapisz szkic
      </UButton>
      <UButton
        color="success"
        icon="i-lucide-rocket"
        :loading="publishing"
        :disabled="!canPublish"
        :title="canPublish ? 'Opublikuj zatwierdzoną rewizję' : 'Najpierw zapisz kompletny szablon bez ostrzeżeń blokujących aktywację'"
        @click="publishDraft"
      >
        Opublikuj
      </UButton>
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

    <div v-else-if="template" class="template-editor-page">
      <section class="editor-status">
        <div>
          <span>Aktywna konfiguracja</span>
          <strong>
            {{ template.active.origin === 'catalog' ? `CRM · rewizja ${template.active.revision}` : 'Rejestr wdrożeniowy' }}
          </strong>
          <small v-if="template.active.publishedAt">{{ formatDate(template.active.publishedAt) }}</small>
        </div>
        <div>
          <span>Edytowany dokument</span>
          <strong>{{ template.editor.template.source.fileName }}</strong>
          <small>{{ template.editor.template.source.pageCount }} stron · SHA-256</small>
        </div>
        <div>
          <span>Szkic</span>
          <strong>{{ template.draft ? `Rewizja ${template.draft.revision}` : 'Nowy' }}</strong>
          <small>{{ template.draft ? formatDate(template.draft.updatedAt) : 'Nie zapisano zmian' }}</small>
        </div>
        <div>
          <span>Walidacja</span>
          <strong :class="{ 'status-ready': validation?.summary.activationReady }">
            {{ validation?.summary.activationReady ? 'Gotowy do publikacji' : 'Wymaga uzupełnienia' }}
          </strong>
          <small>{{ validation?.errors.length ?? 0 }} błędów · {{ validation?.warnings.length ?? 0 }} ostrzeżeń</small>
        </div>
        <UBadge v-if="dirty" color="warning" variant="subtle">Niezapisane zmiany</UBadge>
        <UBadge v-else color="success" variant="subtle">Zapisano</UBadge>
      </section>

      <UAlert
        v-if="validationStale"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Walidacja jest nieaktualna"
        description="Po ostatniej zmianie uruchom walidację ponownie przed publikacją."
      />

      <ClientOnly v-if="editorMode === 'visual'">
        <MortgagesPdfTemplateVisualEditor
          v-model:template-text="editorText"
          :template-id="template.id"
          :source-kind="template.sourceKind"
          :pdf-url="template.pdfUrl"
        />
        <template #fallback>
          <USkeleton class="h-[720px] w-full" />
        </template>
      </ClientOnly>

      <section v-else class="json-editor">
        <header>
          <div>
            <span>Template JSON V2</span>
            <strong>{{ editorText.split('\n').length }} linii · {{ editorText.length }} znaków</strong>
          </div>
          <UBadge :color="syntax.valid ? 'success' : 'error'" variant="subtle">
            {{ syntax.valid ? 'Poprawna składnia' : 'Błąd składni' }}
          </UBadge>
        </header>
        <UTextarea
          v-model="editorText"
          :rows="38"
          autoresize
          :maxrows="60"
          spellcheck="false"
          aria-label="Template JSON"
          class="json-editor__input"
          :ui="{ base: 'font-mono text-xs leading-5' }"
        />
        <UAlert
          v-if="!syntax.valid"
          color="error"
          variant="subtle"
          icon="i-lucide-braces"
          title="Niepoprawny JSON"
          :description="syntax.line ? `Linia ${syntax.line}, kolumna ${syntax.column}: ${syntax.message}` : syntax.message"
        />
      </section>

      <section class="editor-details">
        <UCard>
          <template #header>
            <div class="details-heading">
              <div>
                <span>Kontrola jakości</span>
                <h2>Walidacja mapowania</h2>
              </div>
              <UBadge :color="validation?.summary.activationReady ? 'success' : 'warning'" variant="subtle">
                {{ validation?.summary.activationReady ? 'Można publikować' : 'Publikacja zablokowana' }}
              </UBadge>
            </div>
          </template>
          <div v-if="validation" class="validation-summary">
            <article><span>Bindings</span><strong>{{ validation.summary.bindingCount }}</strong></article>
            <article><span>Zmapowane</span><strong>{{ validation.summary.mappedBindingCount }}</strong></article>
            <article><span>Gotowe</span><strong>{{ validation.summary.readyBindingCount }}</strong></article>
            <article><span>Do przeglądu</span><strong>{{ validation.summary.needsReviewCount }}</strong></article>
            <article><span>Bez targetu</span><strong>{{ validation.summary.unmappedCount }}</strong></article>
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
        </UCard>

        <UCard>
          <template #header>
            <div class="details-heading">
              <div>
                <span>Audyt</span>
                <h2>Historia konfiguracji</h2>
              </div>
              <UBadge color="neutral" variant="outline">{{ template.history.length }}</UBadge>
            </div>
          </template>
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
        </UCard>
      </section>
    </div>
  </CrmShell>
</template>

<style scoped>
.editor-loading, .template-editor-page { display: grid; gap: 16px; min-width: 0; }
.editor-status { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto; align-items: center; overflow: hidden; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.editor-status > div { display: grid; min-width: 0; gap: 3px; padding: 14px 16px; border-right: 1px solid var(--ui-border); }
.editor-status > div > span, .details-heading span, .json-editor header span, .validation-summary span { color: var(--ui-text-muted); font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.editor-status strong { overflow: hidden; color: var(--ui-text-toned); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.editor-status small { color: var(--ui-text-muted); font-size: 10px; }
.editor-status > :deep(.u-badge) { margin: 0 14px; }
.status-ready { color: var(--ui-success) !important; }
.json-editor { display: grid; gap: 12px; min-width: 0; padding: 16px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-bg); }
.json-editor header { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.json-editor header > div { display: grid; gap: 4px; }
.json-editor header strong { color: var(--ui-text-toned); font-size: 12px; }
.json-editor__input { width: 100%; }
.editor-details { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, .75fr); gap: 16px; align-items: start; }
.details-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.details-heading h2 { margin: 4px 0 0; font-size: 17px; }
.validation-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-bottom: 14px; }
.validation-summary article { display: grid; gap: 4px; padding: 10px; border: 1px solid var(--ui-border); border-radius: calc(var(--ui-radius) * .75); background: var(--ui-bg-muted); }
.validation-summary strong { font-size: 19px; }
.validation-issues { display: grid; gap: 7px; max-height: 360px; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.validation-issues li { display: flex; gap: 9px; padding: 9px 10px; border: 1px solid var(--ui-border); border-radius: calc(var(--ui-radius) * .7); }
.validation-issues li > svg { flex: 0 0 auto; margin-top: 2px; color: var(--ui-warning); }
.validation-issues li span { display: grid; gap: 3px; min-width: 0; }
.validation-issues li strong { color: var(--ui-text-toned); font-size: 11px; line-height: 1.4; }
.validation-issues li code { overflow: hidden; color: var(--ui-text-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.validation-empty { display: flex; align-items: center; gap: 8px; min-height: 72px; color: var(--ui-text-muted); font-size: 11px; }
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
@media (max-width: 1100px) {
  .editor-status { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .editor-status > :deep(.u-badge) { margin: 12px 14px; }
  .editor-details { grid-template-columns: 1fr; }
}
@media (max-width: 700px) {
  .editor-status { grid-template-columns: 1fr; }
  .editor-status > div { border-right: 0; border-bottom: 1px solid var(--ui-border); }
  .validation-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
