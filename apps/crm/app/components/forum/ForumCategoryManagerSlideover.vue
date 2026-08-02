<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import { apiErrorMessage } from '~/utils/api-error'

interface ForumCategoryManagementRecord {
  id: string
  slug: string
  name: string
  description?: string | null
  icon?: string | null
  color?: string | null
  sortOrder?: number
  isActive?: boolean
  threadCount?: number
  createdAt?: string | null
  updatedAt?: string | null
}

interface ForumCategoryManagementListPayload {
  categories: ForumCategoryManagementRecord[]
}

interface ForumCategoryManagementForm {
  name: string
  slug: string
  description: string
  icon: string
  color: string
  sortOrder: number
  isActive: boolean
}

interface ForumHiddenContentAuthor {
  id: string
  name: string
  avatarUrl?: string | null
  role?: 'expert' | 'admin' | 'member'
  roleLabel?: string | null
}

interface ForumHiddenContentItem {
  targetType: 'thread' | 'post'
  id: string
  threadId: string
  postId?: string
  threadTitle?: string
  title?: string
  excerpt: string
  author: ForumHiddenContentAuthor
  hiddenAt: string
  hiddenBy: ForumHiddenContentAuthor | null
  reason: string | null
}

interface ForumHiddenContentPayload {
  hiddenThreads: ForumHiddenContentItem[]
  hiddenPosts: ForumHiddenContentItem[]
  total: number
}

const props = withDefaults(defineProps<{
  open: boolean
  endpoint: string
  itemsEndpoint: string
  threadsEndpoint: string
  postsEndpoint: string
  canModerate: boolean
  canManageCategories: boolean
  initialCategories?: ForumCategoryManagementRecord[]
  realtimeRevision?: number
  initialSection?: 'hidden' | 'categories'
}>(), {
  initialCategories: () => [],
  realtimeRevision: 0,
  initialSection: 'hidden',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  changed: []
  restored: []
  openThread: [threadId: string]
}>()

const toast = useToast()
const openModel = computed({
  get: () => props.open,
  set: value => emit('update:open', value),
})
const categories = ref<ForumCategoryManagementRecord[]>([])
const status = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const requestError = ref('')
const submitError = ref('')
const saving = ref(false)
const editorMode = ref<'list' | 'create' | 'edit'>('list')
const activeSection = ref<'hidden' | 'categories'>('hidden')
const editedCategoryId = ref('')
const lastGeneratedSlug = ref('')
const hiddenItems = ref<ForumHiddenContentItem[]>([])
const hiddenTotal = ref(0)
const hiddenStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle')
const hiddenError = ref('')
const restoringId = ref('')
const managerRoot = ref<HTMLElement | null>(null)
const form = reactive<ForumCategoryManagementForm>({
  name: '',
  slug: '',
  description: '',
  icon: 'i-lucide-folder',
  color: 'blue',
  sortOrder: 100,
  isActive: true,
})

const iconItems = [
  { label: 'Folder', value: 'i-lucide-folder', icon: 'i-lucide-folder' },
  { label: 'Kredyty i banki', value: 'i-lucide-landmark', icon: 'i-lucide-landmark' },
  { label: 'Nieruchomości', value: 'i-lucide-house', icon: 'i-lucide-house' },
  { label: 'Ubezpieczenia', value: 'i-lucide-shield-check', icon: 'i-lucide-shield-check' },
  { label: 'Obsługa klienta', value: 'i-lucide-messages-square', icon: 'i-lucide-messages-square' },
  { label: 'Procesy', value: 'i-lucide-workflow', icon: 'i-lucide-workflow' },
  { label: 'Wiedza', value: 'i-lucide-book-open-check', icon: 'i-lucide-book-open-check' },
  { label: 'Prawo', value: 'i-lucide-scale', icon: 'i-lucide-scale' },
]
const colorItems = [
  { label: 'Niebieski', value: 'blue' },
  { label: 'Zielony', value: 'emerald' },
  { label: 'Fioletowy', value: 'violet' },
  { label: 'Bursztynowy', value: 'amber' },
  { label: 'Grafitowy', value: 'slate' },
]

watch(() => props.open, (open) => {
  if (!open) return
  editorMode.value = 'list'
  activeSection.value = props.initialSection === 'categories' && props.canManageCategories
    ? 'categories'
    : props.canModerate
      ? 'hidden'
      : 'categories'
  categories.value = props.initialCategories.map(category => ({
    ...category,
    isActive: category.isActive ?? true,
  }))
  if (activeSection.value === 'hidden' && props.canModerate) void loadHiddenItems()
  else if (activeSection.value === 'categories' && props.canManageCategories) void loadCategories()
}, { immediate: true })

watch(() => props.initialSection, (section) => {
  if (!props.open) return
  if (section === 'hidden' && props.canModerate) selectSection('hidden')
  if (section === 'categories' && props.canManageCategories) selectSection('categories')
})

watch(() => props.endpoint, () => {
  if (props.open && activeSection.value === 'categories' && props.canManageCategories) {
    void loadCategories()
  }
})

watch(() => props.itemsEndpoint, () => {
  if (props.open && props.canModerate && activeSection.value === 'hidden') void loadHiddenItems()
})

watch(() => props.realtimeRevision, (revision, previousRevision) => {
  if (!props.open || revision === previousRevision) return
  if (activeSection.value === 'hidden' && props.canModerate) void loadHiddenItems(true)
  if (
    activeSection.value === 'categories'
    && props.canManageCategories
    && editorMode.value === 'list'
  ) void loadCategories(true)
})

watch(() => form.name, (name) => {
  if (editorMode.value !== 'create') return
  if (form.slug && form.slug !== lastGeneratedSlug.value) return
  const generated = normalizedSlug(name)
  form.slug = generated
  lastGeneratedSlug.value = generated
})

function normalizedSlug(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('pl')
    .replace(/ł/gu, 'l')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 100)
}

function validateCategory(state: Partial<ForumCategoryManagementForm>): FormError[] {
  const errors: FormError[] = []
  const name = state.name?.trim() || ''
  const slug = state.slug?.trim() || ''
  const description = state.description?.trim() || ''
  if (name.length < 2 || name.length > 120) {
    errors.push({ name: 'name', message: 'Nazwa musi mieć od 2 do 120 znaków.' })
  }
  if (slug.length < 2 || slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    errors.push({ name: 'slug', message: 'Użyj 2–100 małych liter, cyfr i pojedynczych łączników.' })
  }
  if (description.length > 1_000) {
    errors.push({ name: 'description', message: 'Opis może mieć maksymalnie 1 000 znaków.' })
  }
  if (!Number.isSafeInteger(state.sortOrder) || Number(state.sortOrder) < 0 || Number(state.sortOrder) > 100_000) {
    errors.push({ name: 'sortOrder', message: 'Kolejność musi być liczbą od 0 do 100 000.' })
  }
  return errors
}

async function loadCategories(preserveContent = false): Promise<void> {
  if (!props.endpoint) return
  const showPending = !preserveContent || status.value !== 'success'
  if (showPending) status.value = 'pending'
  requestError.value = ''
  try {
    const payload = await $fetch<ForumCategoryManagementListPayload>(props.endpoint)
    categories.value = payload.categories
      .map(category => ({ ...category, isActive: category.isActive ?? true }))
      .sort((left, right) => (
        (left.sortOrder ?? 100) - (right.sortOrder ?? 100)
        || left.name.localeCompare(right.name, 'pl')
      ))
    status.value = 'success'
  } catch (error) {
    requestError.value = apiErrorMessage(error)
    if (showPending) status.value = 'error'
  }
}

async function loadHiddenItems(preserveContent = false): Promise<void> {
  if (!props.itemsEndpoint) return
  const showPending = !preserveContent || hiddenStatus.value !== 'success'
  if (showPending) hiddenStatus.value = 'pending'
  hiddenError.value = ''
  try {
    const payload = await $fetch<ForumHiddenContentPayload>(props.itemsEndpoint, {
      query: { limit: 50 },
    })
    hiddenItems.value = [...payload.hiddenThreads, ...payload.hiddenPosts]
      .sort((left, right) => (
        new Date(right.hiddenAt).getTime() - new Date(left.hiddenAt).getTime()
      ))
    hiddenTotal.value = payload.total
    hiddenStatus.value = 'success'
  } catch (error) {
    hiddenError.value = apiErrorMessage(error)
    if (showPending) hiddenStatus.value = 'error'
  }
}

function selectSection(section: 'hidden' | 'categories'): void {
  if (section === 'hidden' && !props.canModerate) return
  if (section === 'categories' && !props.canManageCategories) return
  activeSection.value = section
  editorMode.value = 'list'
  if (section === 'categories') void loadCategories()
  if (section === 'hidden') void loadHiddenItems()
}

function hiddenItemTargetId(item: ForumHiddenContentItem): string {
  return item.targetType === 'thread' ? item.threadId : item.postId || item.id
}

function hiddenItemKey(item: ForumHiddenContentItem): string {
  return `${item.targetType}:${item.id}`
}

function hiddenItemTitle(item: ForumHiddenContentItem): string {
  if (item.targetType === 'thread') return item.title || 'Ukryty wątek'
  return item.threadTitle || item.title || 'Odpowiedź na forum'
}

function hiddenItemRole(author: ForumHiddenContentAuthor): string {
  if (author.role === 'admin') return 'Administracja'
  if (author.roleLabel === 'Administrator forum') return 'Administrator forum'
  if (author.role === 'expert') return 'Ekspert'
  return author.roleLabel || 'Pracownik organizacji'
}

function formatHiddenDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace('.', '')
}

async function restoreHiddenItem(item: ForumHiddenContentItem): Promise<void> {
  if (restoringId.value) return
  const targetId = hiddenItemTargetId(item)
  const endpoint = item.targetType === 'thread'
    ? `${props.threadsEndpoint}/${encodeURIComponent(targetId)}/moderation`
    : `${props.postsEndpoint}/${encodeURIComponent(targetId)}/moderation`
  restoringId.value = hiddenItemKey(item)
  hiddenError.value = ''
  try {
    await $fetch(endpoint, {
      method: 'PATCH',
      body: { action: 'restore' },
    })
    toast.add({
      title: item.targetType === 'thread' ? 'Wątek został przywrócony' : 'Wpis został przywrócony',
      description: 'Treść jest ponownie widoczna dla członków organizacji.',
      color: 'success',
      icon: 'i-lucide-eye',
    })
    await loadHiddenItems()
    emit('restored')
  } catch (error) {
    hiddenError.value = apiErrorMessage(error)
  } finally {
    restoringId.value = ''
  }
}

function openCreate(): void {
  const lastOrder = categories.value.reduce(
    (maximum, category) => Math.max(maximum, category.sortOrder ?? 0),
    0,
  )
  editedCategoryId.value = ''
  lastGeneratedSlug.value = ''
  form.name = ''
  form.slug = ''
  form.description = ''
  form.icon = 'i-lucide-folder'
  form.color = 'blue'
  form.sortOrder = Math.min(100_000, lastOrder + 10)
  form.isActive = true
  submitError.value = ''
  editorMode.value = 'create'
  focusCategoryEditor()
}

function openEdit(category: ForumCategoryManagementRecord): void {
  editedCategoryId.value = category.id
  lastGeneratedSlug.value = ''
  form.name = category.name
  form.slug = category.slug
  form.description = category.description || ''
  form.icon = category.icon || 'i-lucide-folder'
  form.color = category.color || 'blue'
  form.sortOrder = category.sortOrder ?? 100
  form.isActive = category.isActive ?? true
  submitError.value = ''
  editorMode.value = 'edit'
  focusCategoryEditor()
}

function focusCategoryEditor(): void {
  void nextTick(() => {
    managerRoot.value?.querySelector<HTMLInputElement>('#forum-category-form input')?.focus()
  })
}

function focusCategoryListItem(categoryId = ''): void {
  void nextTick(() => {
    const selector = categoryId
      ? `[data-forum-category-id="${categoryId}"]`
      : '[data-forum-category-new]'
    managerRoot.value?.querySelector<HTMLElement>(selector)?.focus()
  })
}

function returnToCategoryList(): void {
  const categoryId = editedCategoryId.value
  editorMode.value = 'list'
  focusCategoryListItem(categoryId)
}

async function saveCategory(_event: FormSubmitEvent<ForumCategoryManagementForm>): Promise<void> {
  if (saving.value) return
  saving.value = true
  submitError.value = ''
  const description = form.description.trim()
  const commonPayload = {
    name: form.name.trim(),
    slug: form.slug.trim(),
    icon: form.icon || null,
    color: form.color || null,
    sortOrder: form.sortOrder,
  }
  let savedCategoryId = editedCategoryId.value
  try {
    if (editorMode.value === 'create') {
      const payload = await $fetch<{ category?: { id?: string } }>(props.endpoint, {
        method: 'POST',
        body: {
          ...commonPayload,
          ...(description ? { description } : {}),
        },
      })
      savedCategoryId = payload.category?.id || ''
    } else if (editedCategoryId.value) {
      await $fetch(`${props.endpoint}/${encodeURIComponent(editedCategoryId.value)}`, {
        method: 'PATCH',
        body: {
          ...commonPayload,
          description: description || null,
          isActive: form.isActive,
        },
      })
    }
    toast.add({
      title: editorMode.value === 'create' ? 'Kategoria została dodana' : 'Kategoria została zapisana',
      description: 'Lista kategorii forum została zaktualizowana.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
    editorMode.value = 'list'
    await loadCategories()
    focusCategoryListItem(savedCategoryId)
    emit('changed')
  } catch (error) {
    submitError.value = apiErrorMessage(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="openModel"
    title="Panel moderacji"
    description="Przywracaj ukryte treści i zarządzaj strukturą wiedzy forum."
    :dismissible="!saving && !restoringId"
    :close="saving || restoringId ? false : undefined"
    :ui="{ content: 'max-w-full sm:max-w-2xl' }"
  >
    <template #body>
      <div ref="managerRoot" class="forum-category-manager">
        <nav class="forum-moderation-sections" aria-label="Sekcje panelu moderacji">
          <button
            v-if="canModerate"
            type="button"
            :disabled="saving || Boolean(restoringId)"
            :class="{ 'forum-moderation-sections__item--active': activeSection === 'hidden' }"
            :aria-current="activeSection === 'hidden' ? 'page' : undefined"
            @click="selectSection('hidden')"
          >
            <UIcon name="i-lucide-eye-off" aria-hidden="true" />
            <span>Ukryte treści</span>
            <small>{{ hiddenTotal }}</small>
          </button>
          <button
            v-if="canManageCategories"
            type="button"
            :disabled="saving || Boolean(restoringId)"
            :class="{ 'forum-moderation-sections__item--active': activeSection === 'categories' }"
            :aria-current="activeSection === 'categories' ? 'page' : undefined"
            @click="selectSection('categories')"
          >
            <UIcon name="i-lucide-folders" aria-hidden="true" />
            <span>Kategorie</span>
            <small>{{ categories.length }}</small>
          </button>
        </nav>

        <section v-if="activeSection === 'hidden'" class="forum-hidden-content" aria-labelledby="forum-hidden-content-heading">
          <div class="forum-category-manager__toolbar">
            <div>
              <strong id="forum-hidden-content-heading">Ukryte treści</strong>
              <span>Widoczne tylko dla moderatorów. Każdą pozycję możesz bezpiecznie przywrócić.</span>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-refresh-cw"
              :loading="hiddenStatus === 'pending'"
              @click="loadHiddenItems()"
            >
              Odśwież
            </UButton>
          </div>

          <UAlert
            v-if="hiddenError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Nie udało się obsłużyć ukrytych treści"
            :description="hiddenError"
            :actions="[{ label: 'Spróbuj ponownie', onClick: () => loadHiddenItems() }]"
          />

          <div v-if="hiddenStatus === 'idle' || hiddenStatus === 'pending'" class="forum-category-manager__loading" aria-label="Ładowanie ukrytych treści">
            <USkeleton v-for="index in 4" :key="index" class="h-40 w-full" />
          </div>

          <div v-else-if="!hiddenItems.length" class="forum-category-manager__empty">
            <UIcon name="i-lucide-shield-check" aria-hidden="true" />
            <h3>Brak ukrytych treści</h3>
            <p>Wszystkie aktualne wątki i odpowiedzi są widoczne dla uprawnionych członków organizacji.</p>
          </div>

          <ul v-else class="forum-hidden-content__list" aria-label="Ukryte wątki i odpowiedzi">
            <li v-for="item in hiddenItems" :key="hiddenItemKey(item)">
              <article class="forum-hidden-content__item">
                <header>
                  <div>
                    <UBadge
                      :color="item.targetType === 'thread' ? 'warning' : 'neutral'"
                      variant="subtle"
                      size="xs"
                      :icon="item.targetType === 'thread' ? 'i-lucide-message-square-off' : 'i-lucide-message-circle-off'"
                    >
                      {{ item.targetType === 'thread' ? 'Ukryty wątek' : 'Ukryta odpowiedź' }}
                    </UBadge>
                    <span>{{ formatHiddenDate(item.hiddenAt) }}</span>
                  </div>
                  <h3>{{ hiddenItemTitle(item) }}</h3>
                  <p v-if="item.targetType === 'post'" class="forum-hidden-content__context">
                    Odpowiedź w wątku · {{ item.threadTitle || 'Forum ekspertów' }}
                  </p>
                </header>

                <p class="forum-hidden-content__excerpt">{{ item.excerpt }}</p>

                <dl class="forum-hidden-content__metadata">
                  <div>
                    <dt>Autor</dt>
                    <dd>{{ item.author.name }} · {{ hiddenItemRole(item.author) }}</dd>
                  </div>
                  <div>
                    <dt>Ukrył(a)</dt>
                    <dd>{{ item.hiddenBy?.name || 'Nieznany moderator' }}</dd>
                  </div>
                </dl>

                <div class="forum-hidden-content__reason">
                  <UIcon name="i-lucide-message-square-warning" aria-hidden="true" />
                  <span>
                    <strong>Powód moderacji</strong>
                    <span>{{ item.reason || 'Brak zapisanego powodu' }}</span>
                  </span>
                </div>

                <div class="forum-hidden-content__actions">
                  <UButton
                    color="neutral"
                    variant="outline"
                    size="sm"
                    icon="i-lucide-message-square-text"
                    :disabled="Boolean(restoringId)"
                    @click="emit('openThread', item.threadId)"
                  >
                    Sprawdź wątek
                  </UButton>
                  <UButton
                    color="success"
                    variant="soft"
                    size="sm"
                    icon="i-lucide-eye"
                    :loading="restoringId === hiddenItemKey(item)"
                    :disabled="Boolean(restoringId) && restoringId !== hiddenItemKey(item)"
                    @click="restoreHiddenItem(item)"
                  >
                    Przywróć treść
                  </UButton>
                </div>
              </article>
            </li>
          </ul>
        </section>

        <template v-else-if="editorMode === 'list'">
          <div class="forum-category-manager__toolbar">
            <div>
              <strong>{{ categories.length }} {{ categories.length === 1 ? 'kategoria' : 'kategorii' }}</strong>
              <span>Kliknij kategorię, aby zmienić jej ustawienia.</span>
            </div>
            <UButton data-forum-category-new icon="i-lucide-folder-plus" size="sm" @click="openCreate">
              Nowa kategoria
            </UButton>
          </div>

          <UAlert
            v-if="requestError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Nie udało się pobrać kategorii"
            :description="requestError"
            :actions="[{ label: 'Spróbuj ponownie', onClick: () => loadCategories() }]"
          />

          <div v-if="status === 'idle' || status === 'pending'" class="forum-category-manager__loading" aria-label="Ładowanie kategorii">
            <USkeleton v-for="index in 5" :key="index" class="h-20 w-full" />
          </div>

          <div v-else-if="!categories.length" class="forum-category-manager__empty">
            <UIcon name="i-lucide-folders" aria-hidden="true" />
            <h3>Nie ma jeszcze kategorii</h3>
            <p>Dodaj pierwszy obszar, aby pracownicy mogli poprawnie oznaczać nowe tematy.</p>
            <UButton data-forum-category-new icon="i-lucide-folder-plus" @click="openCreate">Dodaj kategorię</UButton>
          </div>

          <ul v-else class="forum-category-manager__list" aria-label="Kategorie forum">
            <li v-for="category in categories" :key="category.id">
              <button
                type="button"
                :data-forum-category-id="category.id"
                @click="openEdit(category)"
              >
                <span class="forum-category-manager__icon">
                  <UIcon :name="category.icon || 'i-lucide-folder'" aria-hidden="true" />
                </span>
                <span class="forum-category-manager__summary">
                  <span>
                    <strong>{{ category.name }}</strong>
                    <UBadge
                      :color="category.isActive === false ? 'neutral' : 'success'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ category.isActive === false ? 'Nieaktywna' : 'Aktywna' }}
                    </UBadge>
                  </span>
                  <small>{{ category.description || `Identyfikator: ${category.slug}` }}</small>
                  <span class="forum-category-manager__meta">
                    {{ category.threadCount || 0 }} tematów · kolejność {{ category.sortOrder ?? 100 }}
                  </span>
                </span>
                <UIcon name="i-lucide-chevron-right" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </template>

        <template v-else>
          <div class="forum-category-manager__editor-heading">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-arrow-left"
              :disabled="saving"
              @click="returnToCategoryList"
            >
              Wszystkie kategorie
            </UButton>
            <div>
              <h3>{{ editorMode === 'create' ? 'Nowa kategoria' : 'Edytuj kategorię' }}</h3>
              <p>Krótka i jednoznaczna nazwa ułatwia wybór podczas publikowania tematu.</p>
            </div>
          </div>

          <UAlert
            v-if="submitError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Nie udało się zapisać kategorii"
            :description="submitError"
          />

          <UForm
            id="forum-category-form"
            :state="form"
            :validate="validateCategory"
            :validate-on="['blur', 'change']"
            class="forum-category-manager__form"
            @submit="saveCategory"
          >
            <UFormField name="name" label="Nazwa" required>
              <UInput
                v-model="form.name"
                class="w-full"
                :maxlength="120"
                :disabled="saving"
                placeholder="Np. Prawo i zgodność"
              />
            </UFormField>

            <UFormField
              name="slug"
              label="Identyfikator"
              description="Stabilna, techniczna nazwa używana przez forum."
              required
            >
              <UInput
                v-model="form.slug"
                class="w-full"
                :maxlength="100"
                :disabled="saving"
                placeholder="prawo-i-zgodnosc"
              />
            </UFormField>

            <UFormField
              name="description"
              label="Opis"
              :hint="`${form.description.length} / 1 000`"
            >
              <UTextarea
                v-model="form.description"
                class="w-full"
                autoresize
                :rows="3"
                :maxrows="7"
                :maxlength="1000"
                :disabled="saving"
                placeholder="Jakiego rodzaju pytania i dyskusje należą do tej kategorii?"
              />
            </UFormField>

            <div class="forum-category-manager__form-grid">
              <UFormField name="icon" label="Ikona">
                <USelect
                  v-model="form.icon"
                  class="w-full"
                  :items="iconItems"
                  value-key="value"
                  :icon="form.icon"
                  :disabled="saving"
                />
              </UFormField>
              <UFormField name="color" label="Kolor">
                <USelect
                  v-model="form.color"
                  class="w-full"
                  :items="colorItems"
                  value-key="value"
                  :disabled="saving"
                />
              </UFormField>
              <UFormField name="sortOrder" label="Kolejność" description="Niższa liczba pojawia się wcześniej.">
                <UInputNumber
                  v-model="form.sortOrder"
                  class="w-full"
                  :min="0"
                  :max="100000"
                  :step="10"
                  :disabled="saving"
                />
              </UFormField>
            </div>

            <div v-if="editorMode === 'edit'" class="forum-category-manager__availability">
              <div>
                <strong>Kategoria aktywna</strong>
                <span>Wyłączenie ukryje kategorię i jej tematy na forum oraz w wyszukiwarce. Możesz ją później przywrócić.</span>
              </div>
              <USwitch v-model="form.isActive" :disabled="saving" aria-label="Kategoria aktywna" />
            </div>
          </UForm>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="forum-category-manager__footer">
        <UButton
          v-if="activeSection === 'categories' && editorMode !== 'list'"
          color="neutral"
          variant="outline"
          :disabled="saving"
          @click="returnToCategoryList"
        >
          Anuluj
        </UButton>
        <UButton
          v-if="activeSection === 'categories' && editorMode !== 'list'"
          type="submit"
          form="forum-category-form"
          icon="i-lucide-save"
          :loading="saving"
        >
          Zapisz kategorię
        </UButton>
        <UButton v-else color="neutral" variant="outline" :disabled="Boolean(restoringId)" @click="openModel = false">
          Gotowe
        </UButton>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
.forum-category-manager,
.forum-category-manager__loading,
.forum-category-manager__form {
  display: grid;
}

.forum-category-manager {
  gap: 18px;
}

.forum-moderation-sections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 4px;
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}

.forum-moderation-sections button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: calc(var(--oe-radius-control) - 3px);
  color: var(--ui-text-muted);
  background: transparent;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

.forum-moderation-sections button:only-child {
  grid-column: 1 / -1;
}

.forum-moderation-sections button:hover {
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
}

.forum-moderation-sections button:disabled {
  opacity: .55;
  cursor: not-allowed;
}

.forum-moderation-sections button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.forum-moderation-sections .forum-moderation-sections__item--active {
  border-color: var(--ui-border);
  color: var(--ui-text-highlighted);
  background: var(--ui-bg);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--ui-text) 9%, transparent);
}

.forum-moderation-sections button > :deep(svg) {
  width: 16px;
  height: 16px;
}

.forum-moderation-sections button small {
  display: grid;
  place-items: center;
  min-width: 22px;
  height: 20px;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  font-family: var(--font-mono);
  font-size: 9px;
}

.forum-hidden-content,
.forum-hidden-content__list {
  display: grid;
  gap: 12px;
}

.forum-hidden-content__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.forum-hidden-content__item {
  display: grid;
  gap: 13px;
  padding: 16px;
  border: 1px dashed color-mix(in srgb, var(--ui-error) 42%, var(--ui-border));
  border-radius: var(--oe-radius-control);
  background: color-mix(in srgb, var(--ui-error) 3%, var(--ui-bg));
}

.forum-hidden-content__item header {
  display: grid;
  gap: 6px;
}

.forum-hidden-content__item header > div,
.forum-hidden-content__actions {
  display: flex;
  align-items: center;
}

.forum-hidden-content__item header > div {
  justify-content: space-between;
  gap: 10px;
  color: var(--ui-text-muted);
  font-size: 9px;
}

.forum-hidden-content__item h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.forum-hidden-content__context,
.forum-hidden-content__excerpt {
  margin: 0;
  color: var(--ui-text-muted);
  overflow-wrap: anywhere;
}

.forum-hidden-content__context {
  font-size: 9px;
}

.forum-hidden-content__excerpt {
  display: -webkit-box;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.forum-hidden-content__metadata {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.forum-hidden-content__metadata > div {
  display: grid;
  gap: 2px;
}

.forum-hidden-content__metadata dt {
  color: var(--ui-text-muted);
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: .05em;
}

.forum-hidden-content__metadata dd {
  margin: 0;
  color: var(--ui-text);
  font-size: 10px;
}

.forum-hidden-content__reason {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  color: var(--ui-error);
  background: color-mix(in srgb, var(--ui-error) 8%, transparent);
}

.forum-hidden-content__reason > :deep(svg) {
  width: 15px;
  height: 15px;
  margin-top: 1px;
}

.forum-hidden-content__reason > span {
  display: grid;
  gap: 2px;
  font-size: 10px;
  line-height: 1.45;
}

.forum-hidden-content__actions {
  justify-content: flex-end;
}

.forum-category-manager__toolbar,
.forum-category-manager__editor-heading,
.forum-category-manager__availability,
.forum-category-manager__footer {
  display: flex;
  align-items: center;
}

.forum-category-manager__toolbar {
  justify-content: space-between;
  gap: 16px;
}

.forum-category-manager__toolbar > div,
.forum-category-manager__editor-heading > div,
.forum-category-manager__availability > div {
  display: grid;
  gap: 3px;
}

.forum-category-manager__toolbar strong,
.forum-category-manager__availability strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.forum-category-manager__toolbar span,
.forum-category-manager__availability span {
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.45;
}

.forum-category-manager__loading {
  gap: 9px;
}

.forum-category-manager__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.forum-category-manager__list button {
  display: grid;
  width: 100%;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px;
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

.forum-category-manager__list button:hover {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.forum-category-manager__list button:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.forum-category-manager__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
}

.forum-category-manager__summary {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.forum-category-manager__summary > span:first-child {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
}

.forum-category-manager__summary strong,
.forum-category-manager__summary small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forum-category-manager__summary strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.forum-category-manager__summary small,
.forum-category-manager__meta {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.forum-category-manager__editor-heading {
  align-items: flex-start;
  flex-direction: column;
  gap: 14px;
}

.forum-category-manager__editor-heading h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.forum-category-manager__editor-heading p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.forum-category-manager__form {
  gap: 18px;
}

.forum-category-manager__form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.forum-category-manager__form-grid > :last-child {
  grid-column: 1 / -1;
}

.forum-category-manager__availability {
  justify-content: space-between;
  gap: 16px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}

.forum-category-manager__empty {
  display: flex;
  min-height: 280px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px;
  text-align: center;
}

.forum-category-manager__empty > :deep(svg) {
  width: 34px;
  height: 34px;
  color: var(--ui-text-dimmed);
}

.forum-category-manager__empty h3 {
  margin: 14px 0 5px;
  color: var(--ui-text-highlighted);
  font-size: 16px;
}

.forum-category-manager__empty p {
  max-width: 340px;
  margin: 0 0 18px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.forum-category-manager__footer {
  width: 100%;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 560px) {
  .forum-moderation-sections {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-hidden-content__metadata {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-hidden-content__actions :deep(button) {
    width: 100%;
    justify-content: center;
  }

  .forum-category-manager__toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .forum-category-manager__form-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-category-manager__form-grid > :last-child {
    grid-column: auto;
  }

  .forum-category-manager__footer {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .forum-category-manager__footer :deep(button) {
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .forum-category-manager__list button {
    transition: none;
  }
}
</style>
