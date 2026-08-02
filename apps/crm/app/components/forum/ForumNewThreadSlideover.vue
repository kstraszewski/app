<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type {
  ForumCategory,
  ForumCreateThreadInput,
  ForumCreateThreadPayload,
  ForumSearchMode,
  ForumThreadListPayload,
  ForumThreadSummary,
  ForumThreadType,
} from '#shared/types/forum'
import { apiErrorMessage } from '~/utils/api-error'

const props = defineProps<{
  open: boolean
  endpoint: string
  categories: ForumCategory[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  created: [payload: ForumCreateThreadPayload]
  selectSimilar: [thread: ForumThreadSummary]
}>()

const toast = useToast()
const openModel = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})

const form = reactive<ForumCreateThreadInput>({
  type: 'question',
  title: '',
  body: '',
  categoryId: '',
  languageCode: 'pl',
  visibility: 'organization',
})
const submitting = ref(false)
const submitError = ref('')
const similarThreads = ref<ForumThreadSummary[]>([])
const similarStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const similarSearchMode = ref<ForumSearchMode>('browse')
let similarityTimer: ReturnType<typeof setTimeout> | undefined
let similarityController: AbortController | null = null

const categoryItems = computed(() => props.categories.map(category => ({
  label: category.name,
  value: category.id,
  icon: category.icon || 'i-lucide-folder',
})))
const similarityQuery = computed(() => {
  const title = form.title.trim()
  const body = form.body.trim()
  if (title.length >= 8) return title
  if (body.length >= 24) return body.slice(0, 240)
  return ''
})

watch(() => props.open, (open) => {
  if (open && !form.categoryId && props.categories[0]) {
    form.categoryId = props.categories[0].id
  }
  if (!open) cancelSimilaritySearch()
})

watch(() => props.categories, (categories) => {
  if (!form.categoryId && categories[0]) form.categoryId = categories[0].id
}, { immediate: true })

watch(similarityQuery, () => {
  if (similarityTimer) clearTimeout(similarityTimer)
  if (!similarityQuery.value || !props.open) {
    cancelSimilaritySearch()
    similarThreads.value = []
    similarStatus.value = 'idle'
    return
  }
  similarityTimer = setTimeout(() => {
    void searchSimilarThreads()
  }, 420)
})

onBeforeUnmount(() => cancelSimilaritySearch())

function validateThread(state: Partial<ForumCreateThreadInput>): FormError[] {
  const errors: FormError[] = []
  const title = state.title?.trim() || ''
  const body = state.body?.trim() || ''
  if (title.length < 8) {
    errors.push({ name: 'title', message: 'Tytuł powinien mieć co najmniej 8 znaków.' })
  } else if (title.length > 180) {
    errors.push({ name: 'title', message: 'Tytuł może mieć maksymalnie 180 znaków.' })
  }
  if (body.length < 20) {
    errors.push({ name: 'body', message: 'Opisz temat w co najmniej 20 znakach.' })
  } else if (body.length > 12_000) {
    errors.push({ name: 'body', message: 'Treść może mieć maksymalnie 12 000 znaków.' })
  }
  if (!state.categoryId) {
    errors.push({ name: 'categoryId', message: 'Wybierz kategorię.' })
  }
  return errors
}

function cancelSimilaritySearch(): void {
  if (similarityTimer) clearTimeout(similarityTimer)
  similarityTimer = undefined
  similarityController?.abort()
  similarityController = null
}

async function searchSimilarThreads(): Promise<void> {
  const q = similarityQuery.value
  if (!q) return
  similarityController?.abort()
  const controller = new AbortController()
  similarityController = controller
  similarStatus.value = 'pending'
  try {
    const payload = await $fetch<ForumThreadListPayload>(props.endpoint, {
      query: {
        q,
        category: form.categoryId || undefined,
        limit: 4,
      },
      signal: controller.signal,
    })
    if (similarityController !== controller) return
    similarThreads.value = payload.threads
    similarSearchMode.value = payload.searchMode
    similarStatus.value = 'success'
  } catch (error) {
    if (controller.signal.aborted) return
    similarStatus.value = 'error'
  } finally {
    if (similarityController === controller) similarityController = null
  }
}

function setType(type: ForumThreadType): void {
  form.type = type
}

function resetForm(): void {
  form.type = 'question'
  form.title = ''
  form.body = ''
  form.categoryId = props.categories[0]?.id || ''
  form.languageCode = 'pl'
  form.visibility = 'organization'
  similarThreads.value = []
  similarStatus.value = 'idle'
  submitError.value = ''
}

async function createThread(_event: FormSubmitEvent<ForumCreateThreadInput>): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  submitError.value = ''
  try {
    const payload = await $fetch<ForumCreateThreadPayload>(props.endpoint, {
      method: 'POST',
      body: {
        type: form.type,
        title: form.title.trim(),
        body: form.body.trim(),
        categoryId: form.categoryId,
        languageCode: form.languageCode,
        visibility: form.visibility,
        clientRequestId: crypto.randomUUID(),
      } satisfies ForumCreateThreadInput,
    })
    emit('created', payload)
    toast.add({
      title: form.type === 'question' ? 'Pytanie zostało opublikowane' : 'Dyskusja została rozpoczęta',
      description: 'Temat jest już widoczny dla uprawnionych osób w organizacji.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
    openModel.value = false
    resetForm()
  } catch (error) {
    submitError.value = apiErrorMessage(error)
  } finally {
    submitting.value = false
  }
}

function selectSimilar(thread: ForumThreadSummary): void {
  emit('selectSimilar', thread)
  openModel.value = false
}
</script>

<template>
  <USlideover
    v-model:open="openModel"
    title="Nowy temat na forum"
    description="Zadaj pytanie ekspertom albo rozpocznij dyskusję w całej organizacji."
    :dismissible="!submitting"
    :ui="{ content: 'max-w-full sm:max-w-2xl' }"
  >
    <template #body>
      <div class="forum-new-thread">
        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się opublikować tematu"
          :description="submitError"
        />

        <UForm
          id="forum-new-thread-form"
          :state="form"
          :validate="validateThread"
          :validate-on="['blur', 'change']"
          class="forum-new-thread__form"
          @submit="createThread"
        >
          <fieldset class="forum-new-thread__type">
            <legend>Rodzaj tematu</legend>
            <button
              type="button"
              :class="{ 'forum-new-thread__type-option--active': form.type === 'question' }"
              :aria-pressed="form.type === 'question'"
              @click="setType('question')"
            >
              <UIcon name="i-lucide-circle-help" aria-hidden="true" />
              <span>
                <strong>Pytanie</strong>
                <small>Szukasz konkretnej, sprawdzonej odpowiedzi</small>
              </span>
            </button>
            <button
              type="button"
              :class="{ 'forum-new-thread__type-option--active': form.type === 'discussion' }"
              :aria-pressed="form.type === 'discussion'"
              @click="setType('discussion')"
            >
              <UIcon name="i-lucide-messages-square" aria-hidden="true" />
              <span>
                <strong>Dyskusja</strong>
                <small>Chcesz wymienić się praktyką i doświadczeniem</small>
              </span>
            </button>
          </fieldset>

          <UFormField
            name="title"
            label="Tytuł"
            :hint="`${form.title.length} / 180`"
            required
          >
            <UInput
              v-model="form.title"
              class="w-full"
              :maxlength="180"
              :disabled="submitting"
              placeholder="Np. Jak udokumentować dochód z działalności B2B?"
              autocomplete="off"
            />
          </UFormField>

          <UFormField
            name="categoryId"
            label="Kategoria"
            description="Dobra kategoria ułatwia ekspertom odnalezienie tematu."
            required
          >
            <USelect
              v-model="form.categoryId"
              class="w-full"
              :items="categoryItems"
              value-key="value"
              :disabled="submitting"
              placeholder="Wybierz kategorię"
            />
          </UFormField>

          <UFormField
            name="body"
            :label="form.type === 'question' ? 'Treść pytania' : 'Punkt wyjścia do dyskusji'"
            :hint="`${form.body.length.toLocaleString('pl-PL')} / 12 000`"
            required
          >
            <UTextarea
              v-model="form.body"
              class="w-full"
              autoresize
              :rows="8"
              :maxrows="16"
              :maxlength="12000"
              :disabled="submitting"
              placeholder="Dodaj kontekst, opisz dotychczasowe ustalenia i wskaż, jakiej odpowiedzi potrzebujesz…"
            />
          </UFormField>

          <UAlert
            color="neutral"
            variant="subtle"
            icon="i-lucide-building-2"
            title="Widoczność: cała organizacja"
            description="Temat zobaczą eksperci i pracownicy administracyjni z odpowiednimi uprawnieniami."
          />
        </UForm>

        <section
          v-if="similarityQuery"
          class="forum-similar"
          aria-labelledby="forum-similar-heading"
        >
          <div class="forum-similar__heading">
            <div>
              <span>
                <UIcon name="i-lucide-sparkles" aria-hidden="true" />
                Wyszukiwanie semantyczne
              </span>
              <h3 id="forum-similar-heading">Czy podobny temat już istnieje?</h3>
            </div>
            <UBadge v-if="similarStatus === 'success'" color="neutral" variant="subtle" size="xs">
              {{ similarSearchMode === 'hybrid' ? 'Wektory + słowa kluczowe' : 'Słowa kluczowe' }}
            </UBadge>
          </div>

          <div v-if="similarStatus === 'pending'" class="forum-similar__loading" aria-label="Szukanie podobnych tematów">
            <USkeleton v-for="index in 3" :key="index" class="h-16 w-full" />
          </div>
          <p v-else-if="similarStatus === 'error'" class="forum-similar__state" role="status">
            Nie udało się teraz sprawdzić podobnych tematów. Nadal możesz opublikować wpis.
          </p>
          <p v-else-if="similarStatus === 'success' && !similarThreads.length" class="forum-similar__state" role="status">
            Nie znaleźliśmy podobnych tematów.
          </p>
          <div v-else-if="similarThreads.length" class="forum-similar__list">
            <button
              v-for="thread in similarThreads"
              :key="thread.id"
              type="button"
              @click="selectSimilar(thread)"
            >
              <UIcon :name="thread.type === 'question' ? 'i-lucide-circle-help' : 'i-lucide-messages-square'" aria-hidden="true" />
              <span>
                <strong>{{ thread.title }}</strong>
                <small>{{ thread.category.name }} · {{ thread.replyCount }} odpowiedzi</small>
              </span>
              <UIcon name="i-lucide-arrow-up-right" aria-hidden="true" />
            </button>
          </div>
        </section>
      </div>
    </template>

    <template #footer>
      <div class="forum-new-thread__footer">
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="submitting"
          @click="openModel = false"
        >
          Anuluj
        </UButton>
        <UButton
          type="submit"
          form="forum-new-thread-form"
          icon="i-lucide-send"
          :loading="submitting"
        >
          {{ form.type === 'question' ? 'Opublikuj pytanie' : 'Rozpocznij dyskusję' }}
        </UButton>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
.forum-new-thread,
.forum-new-thread__form,
.forum-similar,
.forum-similar__loading,
.forum-similar__list {
  display: grid;
}

.forum-new-thread {
  gap: 24px;
}

.forum-new-thread__form {
  gap: 20px;
}

.forum-new-thread__type {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}

.forum-new-thread__type legend {
  grid-column: 1 / -1;
  margin-bottom: 7px;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.forum-new-thread__type button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  min-height: 84px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text-muted);
  background: var(--ui-bg);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--oe-motion-fast),
    background-color var(--oe-motion-fast);
}

.forum-new-thread__type button:hover {
  background: var(--ui-bg-muted);
}

.forum-new-thread__type button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.forum-new-thread__type .forum-new-thread__type-option--active {
  border-color: var(--ui-text-highlighted);
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
}

.forum-new-thread__type button > :deep(svg) {
  width: 20px;
  height: 20px;
}

.forum-new-thread__type button span {
  display: grid;
  gap: 4px;
}

.forum-new-thread__type button strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.forum-new-thread__type button small {
  font-size: 10px;
  line-height: 1.45;
}

.forum-similar {
  gap: 12px;
  padding-top: 22px;
  border-top: 1px solid var(--ui-border);
}

.forum-similar__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.forum-similar__heading > div > span {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-warning);
  font-size: 10px;
  font-weight: 650;
}

.forum-similar__heading h3 {
  margin: 5px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 650;
}

.forum-similar__loading,
.forum-similar__list {
  gap: 8px;
}

.forum-similar__state {
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.forum-similar__list button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text-muted);
  background: var(--ui-bg);
  text-align: left;
  cursor: pointer;
}

.forum-similar__list button:hover {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.forum-similar__list button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.forum-similar__list button span {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.forum-similar__list button strong,
.forum-similar__list button small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forum-similar__list button strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.forum-similar__list button small {
  font-size: 9px;
}

.forum-new-thread__footer {
  display: flex;
  width: 100%;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 560px) {
  .forum-new-thread__type {
    grid-template-columns: 1fr;
  }

  .forum-new-thread__type legend {
    grid-column: 1;
  }

  .forum-similar__heading {
    flex-direction: column;
  }

  .forum-new-thread__footer {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .forum-new-thread__footer :deep(button) {
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .forum-new-thread__type button {
    transition: none;
  }
}
</style>
