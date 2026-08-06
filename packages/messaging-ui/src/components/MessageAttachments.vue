<script setup lang="ts">
import type { MessageAttachment } from '@openexpert/messaging'
import {
  computed,
  shallowRef,
} from 'vue'
import {
  formatMessageAttachmentBytes,
  isImageMessageAttachment,
  messageAttachmentKindLabel,
  messageAttachmentVisualKind,
} from '../helpers.ts'

const props = withDefaults(defineProps<{
  attachments: readonly MessageAttachment[]
  urlFor: (attachment: MessageAttachment, download: boolean) => string
  interactive?: boolean
}>(), {
  interactive: true,
})

const unavailableImages = shallowRef<ReadonlySet<string>>(new Set())
const images = computed(() => props.attachments.filter(isImageMessageAttachment))
const files = computed(() => props.attachments.filter(
  attachment => !isImageMessageAttachment(attachment),
))

function markImageUnavailable(id: string): void {
  unavailableImages.value = new Set([...unavailableImages.value, id])
}
</script>

<template>
  <div v-if="attachments.length" class="oe-message-attachments">
    <div
      v-if="images.length"
      class="oe-message-attachments__images"
      :class="{ 'is-single': images.length === 1 }"
      :data-count="Math.min(images.length, 4)"
      aria-label="Załączone obrazy"
    >
      <article v-for="attachment in images" :key="attachment.id">
        <component
          :is="interactive ? 'a' : 'div'"
          class="oe-message-attachments__image"
          :href="interactive ? urlFor(attachment, false) : undefined"
          :target="interactive ? '_blank' : undefined"
          :rel="interactive ? 'noopener' : undefined"
          :aria-label="interactive ? `Otwórz obraz ${attachment.name}` : undefined"
        >
          <img
            v-if="!unavailableImages.has(attachment.id)"
            :src="urlFor(attachment, false)"
            :alt="attachment.name"
            loading="lazy"
            decoding="async"
            @error="markImageUnavailable(attachment.id)"
          >
          <span v-else class="oe-message-attachments__image-error">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="m3 16 5-5 4 4 2-2 7 7M15.5 8.5h.01" />
            </svg>
            Nie udało się wyświetlić obrazu
          </span>
        </component>
        <a
          v-if="interactive"
          class="oe-message-attachments__download oe-message-attachments__icon-button"
          :href="urlFor(attachment, true)"
          download
          :aria-label="`Pobierz obraz ${attachment.name}`"
          title="Pobierz"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14" />
          </svg>
        </a>
      </article>
    </div>

    <div v-if="files.length" class="oe-message-attachments__files" aria-label="Załączone pliki">
      <article
        v-for="attachment in files"
        :key="attachment.id"
        class="oe-message-file"
        :class="{ 'is-static': !interactive }"
      >
        <component
          :is="interactive ? 'a' : 'div'"
          class="oe-message-file__open"
          :href="interactive ? urlFor(attachment, false) : undefined"
          :target="interactive ? '_blank' : undefined"
          :rel="interactive ? 'noopener' : undefined"
          :aria-label="interactive ? `Otwórz plik ${attachment.name}` : undefined"
        >
          <span
            class="oe-message-file__type"
            :class="`is-${messageAttachmentVisualKind(attachment)}`"
            aria-hidden="true"
          >
            {{ messageAttachmentKindLabel(attachment) }}
          </span>
          <span class="oe-message-file__copy">
            <strong :title="attachment.name">{{ attachment.name }}</strong>
            <small>
              {{ messageAttachmentKindLabel(attachment) }}
              <i aria-hidden="true">·</i>
              {{ formatMessageAttachmentBytes(attachment.sizeBytes) }}
            </small>
          </span>
        </component>
        <a
          v-if="interactive"
          class="oe-message-file__download oe-message-attachments__icon-button"
          :href="urlFor(attachment, true)"
          download
          :aria-label="`Pobierz plik ${attachment.name}`"
          title="Pobierz"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14" />
          </svg>
        </a>
      </article>
    </div>
  </div>
</template>

<style scoped>
.oe-message-attachments {
  display: grid;
  max-width: 100%;
  gap: 7px;
  color: var(--oe-message-attachment-text, var(--ui-text-highlighted));
}

.oe-message-attachments__images {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  width: min(420px, 100%);
  overflow: hidden;
  border-radius: 12px;
}

.oe-message-attachments__images.is-single {
  grid-template-columns: minmax(0, 1fr);
  width: min(380px, 100%);
}

.oe-message-attachments__images[data-count="3"] > article:first-child {
  grid-row: span 2;
}

.oe-message-attachments__images > article {
  position: relative;
  min-width: 0;
  min-height: 112px;
  overflow: hidden;
  background: var(--oe-message-attachment-bg, var(--ui-bg-elevated));
}

.oe-message-attachments__images.is-single > article {
  min-height: 180px;
  max-height: 360px;
}

.oe-message-attachments__image {
  display: block;
  width: 100%;
  height: 100%;
  color: inherit;
  text-decoration: none;
}

.oe-message-attachments__image:focus-visible,
.oe-message-file__open:focus-visible,
.oe-message-attachments__icon-button:focus-visible {
  z-index: 2;
  outline: 3px solid color-mix(in srgb, var(--ui-primary) 35%, transparent);
  outline-offset: -3px;
}

.oe-message-attachments__image img {
  display: block;
  width: 100%;
  height: 100%;
  min-height: inherit;
  object-fit: cover;
  transition: transform var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.oe-message-attachments__image-error {
  display: grid;
  min-height: inherit;
  padding: 16px;
  place-content: center;
  justify-items: center;
  gap: 6px;
  color: var(--oe-message-attachment-muted, var(--ui-text-muted));
  font-size: 11px;
  text-align: center;
}

.oe-message-attachments__image-error svg {
  width: 26px;
  height: 26px;
}

.oe-message-attachments__download {
  position: absolute;
  z-index: 2;
  top: 5px;
  right: 5px;
  background: color-mix(in srgb, var(--ui-bg-inverted) 76%, transparent);
  color: var(--ui-text-inverted);
  opacity: 0;
  backdrop-filter: blur(5px);
}

.oe-message-attachments__download:focus-visible {
  opacity: 1;
}

.oe-message-attachments__files {
  display: grid;
  gap: 5px;
  width: min(420px, 100%);
}

.oe-message-file {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 44px;
  align-items: stretch;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--oe-message-attachment-border, var(--ui-border-muted));
  border-radius: 11px;
  background: var(--oe-message-attachment-bg, var(--ui-bg-elevated));
}

.oe-message-file.is-static {
  grid-template-columns: minmax(0, 1fr);
}

.oe-message-file__open {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-width: 0;
  min-height: 54px;
  padding: 6px 8px;
  color: inherit;
  text-decoration: none;
  transition: background-color var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.oe-message-file__type {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 9px;
  background: var(--ui-bg-muted);
  color: var(--oe-message-attachment-muted, var(--ui-text-muted));
  font-size: 8px;
  font-weight: 800;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.oe-message-file__type.is-pdf {
  background: color-mix(in srgb, var(--ui-error) 11%, var(--ui-bg));
  color: var(--ui-error);
}

.oe-message-file__type.is-word {
  background: color-mix(in srgb, var(--ui-info) 11%, var(--ui-bg));
  color: var(--ui-info);
}

.oe-message-file__type.is-spreadsheet {
  background: color-mix(in srgb, var(--ui-success) 11%, var(--ui-bg));
  color: var(--ui-success);
}

.oe-message-file__copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.oe-message-file__copy strong {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oe-message-file__copy small {
  overflow: hidden;
  color: var(--oe-message-attachment-muted, var(--ui-text-muted));
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.oe-message-file__copy i {
  padding-inline: 2px;
  font-style: normal;
}

.oe-message-file__download {
  border-left: 1px solid var(--oe-message-attachment-border, var(--ui-border-muted));
  color: var(--oe-message-attachment-muted, var(--ui-text-muted));
}

.oe-message-attachments__icon-button {
  display: grid;
  width: 44px;
  min-height: 44px;
  place-items: center;
  border-radius: 9px;
  text-decoration: none;
  transition:
    color var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    background-color var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    transform var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.oe-message-attachments__download.oe-message-attachments__icon-button {
  transition:
    opacity var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    transform var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.oe-message-attachments__icon-button:active {
  transform: scale(.97);
}

.oe-message-attachments__icon-button svg,
.oe-message-attachments__image-error svg {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.oe-message-attachments__icon-button svg {
  width: 18px;
  height: 18px;
}

@media (hover: hover) and (pointer: fine) {
  .oe-message-attachments__image:hover img {
    transform: scale(1.015);
  }

  .oe-message-attachments__images > article:hover .oe-message-attachments__download {
    opacity: 1;
  }

  .oe-message-file__open:hover {
    background: var(--oe-message-attachment-hover, var(--ui-bg-accented));
  }

  .oe-message-file__download:hover {
    background: var(--oe-message-attachment-hover, var(--ui-bg-accented));
    color: var(--oe-message-attachment-text, var(--ui-text-highlighted));
  }
}

@media (hover: none) {
  .oe-message-attachments__download {
    opacity: 1;
  }
}

@media (max-width: 480px) {
  .oe-message-attachments__images > article {
    min-height: 96px;
  }

  .oe-message-attachments__images.is-single > article {
    min-height: 160px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .oe-message-attachments__image img {
    transform: none;
    transition: none;
  }

  .oe-message-attachments__download {
    transition: opacity var(--oe-duration-fast, 150ms) var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)) !important;
  }

  .oe-message-attachments__icon-button:active {
    transform: none;
  }
}
</style>
