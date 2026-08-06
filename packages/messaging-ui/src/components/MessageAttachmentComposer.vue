<script setup lang="ts">
import {
  MESSAGE_ATTACHMENT_ACCEPT,
  MESSAGE_ATTACHMENT_MAX_FILES,
  MESSAGE_ATTACHMENT_MAX_FILE_BYTES,
  MESSAGE_ATTACHMENT_MAX_TOTAL_BYTES,
} from '@openexpert/messaging'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
} from 'vue'
import { formatMessageAttachmentBytes } from '../helpers.ts'
import type {
  AddMessageAttachmentDraftsResult,
  MessageAttachmentDraft,
  MessageAttachmentDraftController,
} from '../types.ts'

const props = withDefaults(defineProps<{
  controller: MessageAttachmentDraftController
  clientMessageId: string
  disabled?: boolean
  disabledReason?: string
  accept?: string
  label?: string
}>(), {
  disabled: false,
  accept: MESSAGE_ATTACHMENT_ACCEPT,
  label: 'Dodaj załączniki',
})

const emit = defineEmits<{
  filesAdded: [
    result: AddMessageAttachmentDraftsResult,
    source: 'picker' | 'drop' | 'paste',
  ]
  paste: [event: ClipboardEvent]
  retry: [draft: MessageAttachmentDraft]
  remove: [draft: MessageAttachmentDraft]
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const attachmentButton = ref<HTMLButtonElement | null>(null)
const isDragging = ref(false)
let dragDepth = 0

const drafts = computed(() => props.controller.drafts.value)
const rejections = computed(() => props.controller.rejections.value)
const mayAddFiles = computed(() => (
  !props.disabled && drafts.value.length < MESSAGE_ATTACHMENT_MAX_FILES
))
const limitsDescription = computed(() => [
  `maksymalnie ${MESSAGE_ATTACHMENT_MAX_FILES} plików`,
  `${formatMessageAttachmentBytes(MESSAGE_ATTACHMENT_MAX_FILE_BYTES)} na plik`,
  `${formatMessageAttachmentBytes(MESSAGE_ATTACHMENT_MAX_TOTAL_BYTES)} łącznie`,
].join(', '))
const addButtonTitle = computed(() => {
  if (props.disabled) {
    return props.disabledReason || 'Dodawanie załączników jest teraz niedostępne.'
  }
  if (drafts.value.length >= MESSAGE_ATTACHMENT_MAX_FILES) {
    return 'Osiągnięto limit załączników.'
  }
  return `${props.label} (${limitsDescription.value})`
})

function hasDraggedFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function openPicker(): void {
  if (!mayAddFiles.value) return
  fileInput.value?.click()
}

function addFiles(
  files: Iterable<File> | ArrayLike<File>,
  source: 'picker' | 'drop' | 'paste',
): AddMessageAttachmentDraftsResult {
  const result = props.controller.addFiles(files, props.clientMessageId)
  emit('filesAdded', result, source)
  return result
}

function onFileInput(event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.files?.length) addFiles(input.files, 'picker')
  input.value = ''
  void nextTick(() => attachmentButton.value?.focus())
}

function onDragEnter(event: DragEvent): void {
  if (!mayAddFiles.value || !hasDraggedFiles(event)) return
  event.preventDefault()
  dragDepth += 1
  isDragging.value = true
}

function onDragOver(event: DragEvent): void {
  if (!mayAddFiles.value || !hasDraggedFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  isDragging.value = true
}

function onDragLeave(event: DragEvent): void {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isDragging.value = false
}

function resetDragState(): void {
  dragDepth = 0
  isDragging.value = false
}

function onDrop(event: DragEvent): void {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  const files = event.dataTransfer?.files
  resetDragState()
  if (!props.disabled && files?.length) addFiles(files, 'drop')
}

function onPaste(event: ClipboardEvent): void {
  emit('paste', event)
  if (props.disabled || event.defaultPrevented) return
  const result = props.controller.addPasteEvent(event, props.clientMessageId)
  if (result.acceptedDraftIds.length || result.rejected.length) {
    emit('filesAdded', result, 'paste')
  }
}

function retry(draft: MessageAttachmentDraft): void {
  emit('retry', draft)
  void props.controller.retry(draft.draftId)
}

function remove(draft: MessageAttachmentDraft): void {
  emit('remove', draft)
  void props.controller.remove(draft.draftId)
}

function draftStatus(draft: MessageAttachmentDraft): string {
  if (draft.status === 'queued') return 'Oczekuje na przesłanie'
  if (draft.status === 'uploading') return `Przesyłanie ${draft.progress}%`
  if (draft.status === 'verifying') return 'Sprawdzanie pliku…'
  if (draft.status === 'ready') return 'Gotowy do wysłania'
  return 'Nie udało się przesłać'
}

onBeforeUnmount(resetDragState)

defineExpose({
  openPicker,
  addFiles,
  handlePaste: onPaste,
  handleDragEnter: onDragEnter,
  handleDragOver: onDragOver,
  handleDragLeave: onDragLeave,
  handleDrop: onDrop,
})
</script>

<template>
  <div
    class="oe-attachment-composer"
    :aria-busy="controller.isBusy.value || undefined"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @paste.capture="onPaste"
  >
    <TransitionGroup
      name="oe-attachment-draft"
      tag="div"
      class="oe-attachment-composer__tray"
      :aria-label="drafts.length ? 'Załączniki przygotowywane do wysłania' : undefined"
    >
      <article
        v-for="draft in drafts"
        :key="draft.draftId"
        class="oe-attachment-draft"
        :class="`is-${draft.status}`"
      >
        <img
          v-if="draft.previewUrl"
          class="oe-attachment-draft__preview"
          :src="draft.previewUrl"
          alt=""
        >
        <span v-else class="oe-attachment-draft__type" aria-hidden="true">
          {{ draft.mimeType === 'application/pdf' ? 'PDF' : 'PLIK' }}
        </span>

        <div class="oe-attachment-draft__copy">
          <strong :title="draft.name">{{ draft.name }}</strong>
          <span>
            {{ formatMessageAttachmentBytes(draft.sizeBytes) }}
            <i aria-hidden="true">·</i>
            {{ draftStatus(draft) }}
          </span>
          <progress
            v-if="draft.status === 'queued' || draft.status === 'uploading' || draft.status === 'verifying'"
            class="oe-attachment-draft__progress"
            max="100"
            :value="draft.status === 'verifying' ? undefined : draft.progress"
            :aria-label="`${draftStatus(draft)}: ${draft.name}`"
          />
          <p v-if="draft.error" role="alert">{{ draft.error }}</p>
        </div>

        <div class="oe-attachment-draft__actions">
          <button
            v-if="draft.status === 'failed'"
            type="button"
            class="oe-icon-button"
            :aria-label="`Ponów przesyłanie pliku ${draft.name}`"
            title="Ponów"
            @click="retry(draft)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11a8.1 8.1 0 1 0-2.4 5.8M20 4v7h-7" />
            </svg>
          </button>
          <button
            type="button"
            class="oe-icon-button"
            :aria-label="`${draft.status === 'uploading' ? 'Anuluj przesyłanie' : 'Usuń'} pliku ${draft.name}`"
            :title="draft.status === 'uploading' ? 'Anuluj' : 'Usuń'"
            @click="remove(draft)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m18 6-12 12M6 6l12 12" />
            </svg>
          </button>
        </div>
      </article>
    </TransitionGroup>

    <TransitionGroup
      name="oe-attachment-rejection"
      tag="div"
      class="oe-attachment-composer__errors"
      :aria-label="rejections.length ? 'Odrzucone pliki' : undefined"
    >
      <div v-for="rejection in rejections" :key="rejection.id" role="alert">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5m0 3h.01" />
        </svg>
        <p><strong>{{ rejection.name }}</strong> — {{ rejection.reason }}</p>
        <button
          type="button"
          class="oe-icon-button"
          :aria-label="`Zamknij błąd pliku ${rejection.name}`"
          @click="controller.dismissRejection(rejection.id)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m18 6-12 12M6 6l12 12" />
          </svg>
        </button>
      </div>
    </TransitionGroup>

    <div class="oe-attachment-composer__row">
      <input
        ref="fileInput"
        class="oe-sr-only"
        type="file"
        :accept="accept"
        multiple
        :disabled="!mayAddFiles"
        tabindex="-1"
        @change="onFileInput"
      >
      <button
        ref="attachmentButton"
        type="button"
        class="oe-attachment-composer__add oe-icon-button"
        :disabled="!mayAddFiles"
        :aria-label="label"
        :aria-describedby="`${clientMessageId}-attachment-limits`"
        :title="addButtonTitle"
        @click="openPicker"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9" />
        </svg>
      </button>
      <div class="oe-attachment-composer__input">
        <slot name="input" />
      </div>
      <div class="oe-attachment-composer__submit">
        <slot name="submit" />
      </div>
      <span :id="`${clientMessageId}-attachment-limits`" class="oe-sr-only">
        {{ limitsDescription }}. Możesz też przeciągnąć pliki lub wkleić obraz.
      </span>
    </div>

    <Transition name="oe-attachment-drop">
      <div v-if="isDragging" class="oe-attachment-composer__drop" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" />
        </svg>
        <strong>Upuść pliki, aby je dołączyć</strong>
        <span>{{ limitsDescription }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.oe-attachment-composer {
  position: relative;
  display: grid;
  min-width: 0;
  gap: 8px;
  color: var(--ui-text);
}

.oe-attachment-composer__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: end;
  gap: 8px;
  min-width: 0;
}

.oe-attachment-composer__input,
.oe-attachment-composer__submit {
  min-width: 0;
}

.oe-attachment-composer__tray {
  display: flex;
  gap: 8px;
  max-width: 100%;
  padding: 2px;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  scrollbar-width: thin;
}

.oe-attachment-composer__tray:empty,
.oe-attachment-composer__errors:empty {
  display: none;
}

.oe-attachment-draft-enter-active,
.oe-attachment-rejection-enter-active,
.oe-attachment-drop-enter-active {
  transition:
    opacity var(--oe-duration-base, 220ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    transform var(--oe-duration-base, 220ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  will-change: opacity, transform;
}

.oe-attachment-draft-leave-active,
.oe-attachment-rejection-leave-active,
.oe-attachment-drop-leave-active {
  transition:
    opacity var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    transform var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  will-change: opacity, transform;
}

.oe-attachment-draft-enter-from,
.oe-attachment-draft-leave-to,
.oe-attachment-rejection-enter-from,
.oe-attachment-rejection-leave-to,
.oe-attachment-drop-enter-from,
.oe-attachment-drop-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(.98);
}

.oe-attachment-draft {
  display: grid;
  flex: 0 0 min(310px, 82vw);
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-height: 64px;
  padding: 7px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
}

.oe-attachment-draft.is-failed {
  border-color: var(--ui-error);
  background: color-mix(in srgb, var(--ui-error) 7%, var(--ui-bg));
}

.oe-attachment-draft__preview,
.oe-attachment-draft__type {
  width: 48px;
  height: 48px;
  border-radius: 9px;
}

.oe-attachment-draft__preview {
  display: block;
  object-fit: cover;
  background: var(--ui-bg-muted);
}

.oe-attachment-draft__type {
  display: grid;
  place-items: center;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-size: 9px;
  font-weight: 800;
  letter-spacing: .06em;
}

.oe-attachment-draft__copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.oe-attachment-draft__copy strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oe-attachment-draft__copy > span {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oe-attachment-draft__copy i {
  padding-inline: 2px;
  font-style: normal;
}

.oe-attachment-draft__copy p {
  margin: 2px 0 0;
  color: var(--ui-error);
  font-size: 10px;
  line-height: 1.3;
}

.oe-attachment-draft__progress {
  width: 100%;
  height: 3px;
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  appearance: none;
  background: var(--ui-bg-accented);
}

.oe-attachment-draft__progress::-webkit-progress-bar {
  border-radius: inherit;
  background: var(--ui-bg-accented);
}

.oe-attachment-draft__progress::-webkit-progress-value {
  border-radius: inherit;
  background: var(--ui-primary);
}

.oe-attachment-draft__progress::-moz-progress-bar {
  border-radius: inherit;
  background: var(--ui-primary);
}

.oe-attachment-draft__actions {
  display: flex;
  align-items: center;
}

.oe-icon-button {
  display: inline-grid;
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
  transition:
    color var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    background-color var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    transform var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.oe-icon-button:active:not(:disabled) {
  transform: scale(.97);
}

.oe-icon-button:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--ui-primary) 30%, transparent);
  outline-offset: 1px;
}

.oe-icon-button:disabled {
  cursor: not-allowed;
  opacity: .45;
}

.oe-icon-button svg,
.oe-attachment-composer__drop svg,
.oe-attachment-composer__errors svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.oe-attachment-composer__add {
  border: 1px solid var(--ui-border-muted);
  background: var(--ui-bg);
}

.oe-attachment-composer__errors {
  display: grid;
  gap: 5px;
}

.oe-attachment-composer__errors > div {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 44px;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  padding-inline-start: 10px;
  border: 1px solid color-mix(in srgb, var(--ui-error) 35%, var(--ui-border-muted));
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-error) 7%, var(--ui-bg));
  color: var(--ui-error);
}

.oe-attachment-composer__errors p {
  min-width: 0;
  margin: 0;
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.oe-attachment-composer__errors svg {
  width: 18px;
  height: 18px;
}

.oe-attachment-composer__drop {
  position: absolute;
  z-index: 30;
  inset: -8px;
  display: grid;
  min-height: 96px;
  padding: 18px;
  place-content: center;
  justify-items: center;
  border: 2px dashed var(--ui-primary);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ui-bg) 92%, transparent);
  color: var(--ui-text-highlighted);
  text-align: center;
  pointer-events: none;
  backdrop-filter: blur(5px);
}

.oe-attachment-composer__drop svg {
  width: 25px;
  height: 25px;
  margin-bottom: 5px;
  color: var(--ui-primary);
}

.oe-attachment-composer__drop strong {
  font-size: 13px;
}

.oe-attachment-composer__drop span {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.oe-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 640px) {
  .oe-attachment-composer__tray {
    margin-inline: -2px;
  }

  .oe-attachment-draft {
    flex-basis: min(270px, 78vw);
  }

  .oe-attachment-draft__actions {
    flex-direction: column;
  }
}

@media (hover: hover) and (pointer: fine) {
  .oe-icon-button:hover:not(:disabled) {
    background: var(--ui-bg-accented);
    color: var(--ui-text-highlighted);
  }
}

@media (prefers-reduced-motion: reduce) {
  .oe-attachment-draft-enter-active,
  .oe-attachment-draft-leave-active,
  .oe-attachment-rejection-enter-active,
  .oe-attachment-rejection-leave-active,
  .oe-attachment-drop-enter-active,
  .oe-attachment-drop-leave-active {
    transition: opacity var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) !important;
  }

  .oe-attachment-draft-enter-from,
  .oe-attachment-draft-leave-to,
  .oe-attachment-rejection-enter-from,
  .oe-attachment-rejection-leave-to,
  .oe-attachment-drop-enter-from,
  .oe-attachment-drop-leave-to {
    opacity: 0;
    transform: none;
  }

  .oe-icon-button:active:not(:disabled) {
    transform: none;
  }

  .oe-attachment-draft__progress {
    animation: none;
  }
}
</style>
