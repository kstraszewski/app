<script setup lang="ts">
import type {
  CrmClientConversationAttachment,
  CrmConversationAttachmentsResponse,
} from '#shared/types/case-conversation-attachments'
import {
  formatMessageAttachmentBytes,
  messageAttachmentKindLabel,
  messageAttachmentVisualKind,
} from '@openexpert/messaging-ui'

const props = withDefaults(defineProps<{
  open: boolean
  apiPath: string
  clientName: string
  refreshKey?: number
}>(), {
  refreshKey: 0,
})

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const openModel = computed({
  get: () => props.open,
  set: open => emit('update:open', open),
})
const attachments = ref<CrmClientConversationAttachment[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const loadError = ref(false)
let requestRevision = 0

const hasMore = computed(() => Boolean(nextCursor.value))
const refreshing = computed(() => loading.value && attachments.value.length > 0)
const description = computed(() => props.clientName
  ? `${props.clientName} · pliki przesłane w tej rozmowie`
  : 'Pliki przesłane przez klienta w tej rozmowie')

function resetFiles() {
  requestRevision += 1
  attachments.value = []
  nextCursor.value = null
  loading.value = false
  loadingMore.value = false
  loadError.value = false
}

async function loadFiles(reset = false, preserveExisting = false) {
  if (!props.apiPath || (!reset && (loading.value || loadingMore.value))) return
  const revision = ++requestRevision
  const requestPath = props.apiPath
  const cursor = reset ? null : nextCursor.value

  if (reset) {
    if (!preserveExisting) attachments.value = []
    loading.value = true
    loadingMore.value = false
  }
  else {
    loadingMore.value = true
  }
  loadError.value = false

  try {
    const response = await $fetch<CrmConversationAttachmentsResponse>(requestPath, {
      query: {
        limit: 50,
        ...(cursor ? { cursor } : {}),
      },
    })
    if (revision !== requestRevision || requestPath !== props.apiPath) return

    const incoming = response.data.attachments ?? []
    if (reset) {
      attachments.value = incoming
    }
    else {
      const byId = new Map(attachments.value.map(attachment => [attachment.id, attachment]))
      for (const attachment of incoming) byId.set(attachment.id, attachment)
      attachments.value = [...byId.values()]
    }
    nextCursor.value = response.data.pageInfo?.nextCursor ?? null
  }
  catch {
    if (revision === requestRevision) {
      loadError.value = true
    }
  }
  finally {
    if (revision === requestRevision) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function fileUrl(attachment: CrmClientConversationAttachment, download: boolean) {
  const base = `${props.apiPath}/${encodeURIComponent(attachment.id)}`
  return download ? `${base}?download=1` : base
}

function canPreview(attachment: CrmClientConversationAttachment) {
  return attachment.mimeType.startsWith('image/') || attachment.mimeType === 'application/pdf'
}

function attachmentIcon(attachment: CrmClientConversationAttachment) {
  const kind = messageAttachmentVisualKind(attachment)
  if (kind === 'image') return 'i-lucide-image'
  if (kind === 'pdf') return 'i-lucide-file-text'
  if (kind === 'word') return 'i-lucide-file-type-2'
  if (kind === 'spreadsheet') return 'i-lucide-sheet'
  return 'i-lucide-file'
}

function formatSentAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Warsaw',
  }).format(date)
}

watch(() => props.apiPath, () => {
  resetFiles()
  if (props.open && props.apiPath) void loadFiles(true)
})

watch(() => props.open, (open) => {
  if (open && props.apiPath) void loadFiles(true, attachments.value.length > 0)
})

watch(() => props.refreshKey, () => {
  if (props.open && props.apiPath) void loadFiles(true, true)
})
</script>

<template>
  <USlideover
    v-model:open="openModel"
    title="Pliki od klienta"
    :description="description"
    :ui="{ content: 'w-full max-w-full sm:max-w-xl' }"
  >
    <template #body>
      <div
        class="conversation-files"
        :aria-busy="loading || loadingMore"
      >
        <div
          v-if="loading && !attachments.length"
          class="conversation-files__skeletons"
          role="status"
          aria-live="polite"
          aria-label="Ładowanie plików klienta"
        >
          <span class="sr-only">Ładowanie plików klienta</span>
          <div v-for="index in 5" :key="index">
            <USkeleton class="size-11 shrink-0 rounded-xl" />
            <div>
              <USkeleton class="h-4 w-44 max-w-full" />
              <USkeleton class="mt-2 h-3 w-32 max-w-full" />
            </div>
          </div>
        </div>

        <UAlert
          v-else-if="loadError && !attachments.length"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="Nie udało się pobrać plików"
          description="Spróbuj ponownie za chwilę. Historia rozmowy pozostaje bez zmian."
        >
          <template #actions>
            <UButton color="error" variant="soft" size="sm" @click="loadFiles(true)">
              Spróbuj ponownie
            </UButton>
          </template>
        </UAlert>

        <template v-else-if="attachments.length">
          <p
            v-if="refreshing"
            class="conversation-files__refresh"
            role="status"
            aria-live="polite"
          >
            <UIcon name="i-lucide-loader-circle" class="animate-spin" />
            Odświeżanie listy…
          </p>

          <UAlert
            v-if="loadError"
            color="warning"
            variant="subtle"
            icon="i-lucide-wifi-off"
            title="Lista może być nieaktualna"
            description="Zachowaliśmy wcześniej pobrane pliki. Możesz spróbować odświeżyć listę."
          >
            <template #actions>
              <UButton color="warning" variant="soft" size="sm" @click="loadFiles(true, true)">
                Odśwież
              </UButton>
            </template>
          </UAlert>

          <p class="conversation-files__summary" aria-live="polite">
            Załadowano {{ attachments.length }}
            {{ attachments.length === 1 ? 'plik' : 'plików' }}
          </p>

          <ul
            class="conversation-files__list"
            aria-label="Pliki przesłane przez klienta"
          >
            <li v-for="attachment in attachments" :key="attachment.id">
              <span
                class="conversation-files__type"
                :class="`is-${messageAttachmentVisualKind(attachment)}`"
                aria-hidden="true"
              >
                <UIcon :name="attachmentIcon(attachment)" />
              </span>

              <div class="conversation-files__copy">
                <a
                  :href="fileUrl(attachment, !canPreview(attachment))"
                  :target="canPreview(attachment) ? '_blank' : undefined"
                  :rel="canPreview(attachment) ? 'noopener' : undefined"
                  :download="canPreview(attachment) ? undefined : attachment.name"
                  :title="attachment.name"
                >
                  {{ attachment.name }}
                </a>
                <span>
                  {{ messageAttachmentKindLabel(attachment) }}
                  · {{ formatMessageAttachmentBytes(attachment.sizeBytes) }}
                </span>
                <small>
                  {{ attachment.uploaderName || clientName || 'Klient' }} ·
                  <time :datetime="attachment.sentAt">{{ formatSentAt(attachment.sentAt) }}</time>
                </small>
              </div>

              <div class="conversation-files__actions">
                <a
                  v-if="canPreview(attachment)"
                  :href="fileUrl(attachment, false)"
                  target="_blank"
                  rel="noopener"
                  :aria-label="`Otwórz ${attachment.name}`"
                  title="Otwórz"
                >
                  <UIcon name="i-lucide-external-link" />
                </a>
                <a
                  :href="fileUrl(attachment, true)"
                  :download="attachment.name"
                  :aria-label="`Pobierz ${attachment.name}`"
                  title="Pobierz"
                >
                  <UIcon name="i-lucide-download" />
                </a>
              </div>
            </li>
          </ul>

          <UButton
            v-if="hasMore"
            class="conversation-files__more"
            block
            color="neutral"
            variant="outline"
            icon="i-lucide-history"
            :loading="loadingMore"
            @click="loadFiles()"
          >
            Pokaż starsze pliki
          </UButton>
        </template>

        <div v-else class="conversation-files__empty">
          <span><UIcon name="i-lucide-files" /></span>
          <strong>Brak plików od klienta</strong>
          <p>Pliki przesłane w tej rozmowie pojawią się tutaj automatycznie.</p>
        </div>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
.conversation-files {
  min-height: 240px;
}

.conversation-files__skeletons,
.conversation-files__list {
  display: grid;
  gap: 10px;
}

.conversation-files__skeletons > div,
.conversation-files__list li {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
}

.conversation-files__skeletons > div {
  min-height: 66px;
}

.conversation-files__skeletons > div > div {
  min-width: 0;
}

.conversation-files__summary {
  margin: 0 0 10px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.conversation-files__refresh {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 10px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.conversation-files__refresh svg {
  width: 14px;
  height: 14px;
}

.conversation-files__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.conversation-files__list li {
  min-height: 68px;
  padding: 10px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 14px;
  background: var(--ui-bg);
}

.conversation-files__type {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 11px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
}

.conversation-files__type svg {
  width: 20px;
  height: 20px;
}

.conversation-files__type.is-pdf {
  background: color-mix(in srgb, var(--ui-error) 11%, var(--ui-bg));
  color: var(--ui-error);
}

.conversation-files__type.is-word {
  background: color-mix(in srgb, var(--ui-info) 11%, var(--ui-bg));
  color: var(--ui-info);
}

.conversation-files__type.is-spreadsheet {
  background: color-mix(in srgb, var(--ui-success) 11%, var(--ui-bg));
  color: var(--ui-success);
}

.conversation-files__copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.conversation-files__copy a {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-files__copy a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.conversation-files__copy span,
.conversation-files__copy small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-files__copy small {
  color: var(--ui-text-dimmed);
}

.conversation-files__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.conversation-files__actions a {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 10px;
  color: var(--ui-text-muted);
  text-decoration: none;
}

.conversation-files__actions a:hover {
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.conversation-files__actions a:focus-visible,
.conversation-files__copy a:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--ui-primary) 35%, transparent);
  outline-offset: 2px;
}

.conversation-files__more {
  margin-top: 14px;
}

.conversation-files__empty {
  display: grid;
  min-height: 280px;
  place-content: center;
  justify-items: center;
  padding: 24px;
  color: var(--ui-text-muted);
  text-align: center;
}

.conversation-files__empty > span {
  display: grid;
  width: 54px;
  height: 54px;
  margin-bottom: 12px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.conversation-files__empty > span svg {
  width: 24px;
  height: 24px;
}

.conversation-files__empty strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.conversation-files__empty p {
  max-width: 290px;
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 520px) {
  .conversation-files__list li {
    grid-template-columns: 40px minmax(0, 1fr) auto;
    gap: 8px;
    padding: 8px;
  }

  .conversation-files__type {
    width: 40px;
    height: 40px;
  }

  .conversation-files__actions {
    gap: 0;
  }

  .conversation-files__actions a {
    width: 44px;
    height: 44px;
  }
}
</style>
