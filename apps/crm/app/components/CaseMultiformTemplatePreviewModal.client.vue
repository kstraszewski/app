<script setup lang="ts">
import type { DocumentTemplate, TemplateValidationResult } from '@openexpert/multiform'
import { apiErrorMessage } from '~/utils/api-error'
import { approveTemplateLayoutRevision } from '~/utils/multiform-template-layout'

interface EditorResponse {
  schemaVersion: 1
  bank: { id: string, slug: string, name: string }
  template: {
    id: string
    label: string
    sourceKind: 'registered' | 'bank-file'
    pdfUrl: string
    editor: {
      template: DocumentTemplate
      validation: TemplateValidationResult
    }
    draft: null | {
      revision: number
      updatedAt: string | null
    }
    active: {
      revision: number
      template: DocumentTemplate
    }
  }
}

const props = defineProps<{
  open: boolean
  organizationSlug: string
  bankId: string
  templateId: string
  title: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'saved': []
}>()

const toast = useToast()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const saveNotice = ref('')
const payload = shallowRef<EditorResponse | null>(null)
const editorText = ref('')
const savedText = ref('')

const openModel = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})

const apiPath = computed(() => (
  `/api/org/${encodeURIComponent(props.organizationSlug)}`
  + `/mortgages/banks/${encodeURIComponent(props.bankId)}`
  + `/templates/${encodeURIComponent(props.templateId)}`
))

const dirty = computed(() => editorText.value !== savedText.value)
const editor = computed(() => payload.value?.template ?? null)

watch(() => props.open, (open) => {
  if (open) void loadEditor()
  else resetModal()
}, { immediate: true })

function resetModal() {
  error.value = ''
  saveNotice.value = ''
  payload.value = null
  editorText.value = ''
  savedText.value = ''
}

function applyPayload(next: EditorResponse, preferredText?: string) {
  payload.value = next
  const text = preferredText ?? JSON.stringify(next.template.editor.template, null, 2)
  editorText.value = text
  savedText.value = text
}

async function loadEditor() {
  if (!props.bankId || !props.templateId || loading.value) return
  loading.value = true
  error.value = ''
  saveNotice.value = ''
  try {
    applyPayload(await $fetch<EditorResponse>(apiPath.value))
  }
  catch (caught) {
    error.value = apiErrorMessage(caught) || 'Nie udało się otworzyć podglądu szablonu.'
  }
  finally {
    loading.value = false
  }
}

function parsedTemplate() {
  try {
    return JSON.parse(editorText.value) as DocumentTemplate
  }
  catch (caught) {
    throw new Error(caught instanceof Error ? caught.message : 'Template JSON jest nieprawidłowy.')
  }
}

async function saveAndApply() {
  const current = payload.value
  if (!current || !dirty.value || saving.value) return
  saving.value = true
  error.value = ''
  saveNotice.value = ''
  let draftSaved = false
  try {
    const submittedText = editorText.value
    const active = current.template.active.template
    const template = approveTemplateLayoutRevision(active, parsedTemplate())
    await $fetch(apiPath.value, {
      method: 'PUT',
      body: {
        expectedRevision: current.template.draft?.revision ?? 0,
        template,
      },
    })
    draftSaved = true

    const refreshed = await $fetch<EditorResponse>(apiPath.value)
    applyPayload(refreshed, submittedText)
    const revision = refreshed.template.draft?.revision
    if (revision === undefined) throw new Error('Serwer nie zwrócił rewizji zapisanego szkicu.')

    await $fetch(`${apiPath.value}/publish`, {
      method: 'POST',
      body: { expectedRevision: revision },
    })
    toast.add({
      title: 'Pozycje pól zostały zapisane',
      description: 'Nowa wersja szablonu jest aktywna dla kolejnych generowań formularza.',
      color: 'success',
    })
    emit('saved')
    openModel.value = false
  }
  catch (caught) {
    const message = caught instanceof Error && !('statusCode' in caught)
      ? caught.message
      : apiErrorMessage(caught)
    error.value = draftSaved
      ? `Szkic został zapisany, ale nie jest jeszcze aktywny. ${message || 'Zatwierdź zmienione mapowanie i zapisz ponownie.'}`
      : message || 'Nie udało się zapisać zmian szablonu.'
    if (draftSaved) {
      saveNotice.value = 'Zmienione pole może wymagać ustawienia statusu „Zweryfikowane” w inspektorze po prawej stronie.'
    }
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="openModel"
    :title="`Podgląd i popraw pola - ${title}`"
    description="Przeciągnij pole na PDF-ie albo ustaw dokładne X, Y, szerokość i wysokość w inspektorze."
    :dismissible="!saving"
    :ui="{
      content: 'sm:max-w-[96vw] w-[96vw]',
      body: 'p-0 overflow-hidden',
      footer: 'justify-between',
    }"
  >
    <template #body>
      <div v-if="loading" class="template-preview__loading">
        <USkeleton class="h-14 w-full" />
        <USkeleton class="h-[68vh] w-full" />
      </div>

      <div v-else-if="error && !editor" class="template-preview__error">
        <UAlert
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się otworzyć edytora"
          :description="error"
        />
        <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="loadEditor">
          Spróbuj ponownie
        </UButton>
      </div>

      <div v-else-if="editor" class="template-preview__studio">
        <MortgagesPdfTemplateVisualEditor
          v-model:template-text="editorText"
          :template-id="editor.id"
          :source-kind="editor.sourceKind"
          :pdf-url="editor.pdfUrl"
          layout-only
        >
          <template #studio-actions>
            <UBadge :color="dirty ? 'warning' : 'success'" variant="subtle">
              {{ dirty ? 'Niezapisane zmiany' : 'Bez zmian' }}
            </UBadge>
          </template>
        </MortgagesPdfTemplateVisualEditor>
      </div>
    </template>

    <template #footer="{ close }">
      <div class="template-preview__footer-copy">
        <strong>{{ dirty ? 'Zmiany wpłyną na kolejne generowania tego formularza.' : 'Przeciągnij wybrane pole, aby zmienić jego położenie.' }}</strong>
        <small v-if="saveNotice">{{ saveNotice }}</small>
        <small v-else-if="error && editor" class="template-preview__footer-error">{{ error }}</small>
        <small v-else>Źródłowy PDF pozostanie bez zmian; zapisujemy wyłącznie mapowanie pól.</small>
      </div>
      <div class="template-preview__footer-actions">
        <UButton color="neutral" variant="ghost" :disabled="saving" @click="close">
          Anuluj
        </UButton>
        <UButton
          icon="i-lucide-save"
          :loading="saving"
          :disabled="!editor || !dirty"
          @click="saveAndApply"
        >
          Zapisz i zastosuj
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.template-preview__loading,
.template-preview__error {
  display: grid;
  gap: 14px;
  padding: 18px;
}

.template-preview__error {
  justify-items: start;
}

.template-preview__studio {
  height: calc(100dvh - 190px);
  min-height: 600px;
  overflow: hidden;
}

.template-preview__studio :deep(.visual-editor) {
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0;
}

.template-preview__footer-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.template-preview__footer-copy strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.template-preview__footer-copy small {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.template-preview__footer-copy .template-preview__footer-error {
  color: var(--ui-error);
}

.template-preview__footer-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

@media (max-width: 760px) {
  .template-preview__studio {
    height: calc(100dvh - 210px);
    min-height: 0;
  }

  .template-preview__footer-copy {
    display: none;
  }
}
</style>
