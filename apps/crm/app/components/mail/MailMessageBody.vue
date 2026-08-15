<script setup lang="ts">
import { mailBodyParagraphs } from '~/utils/mail-body-display'
import {
  buildMailHtmlSrcdoc,
  MAIL_HTML_IFRAME_SANDBOX,
} from '~/utils/mail-html-display'

const props = defineProps<{
  bodyText: string
  bodyHtml: string | null
  hasRemoteImages: boolean
  remoteImageProxyPath: string
}>()

const paragraphs = computed(() => mailBodyParagraphs(props.bodyText))
const hasHtml = computed(() => Boolean(props.bodyHtml?.trim()))
const remoteImagesPresent = computed(() => (
  props.hasRemoteImages === true
  || props.bodyHtml?.includes('data-mail-remote-src') === true
))
const displayMode = ref<'html' | 'text'>(hasHtml.value ? 'html' : 'text')
const remoteImagesLoaded = ref(false)
const iframeElement = ref<HTMLIFrameElement | null>(null)
const iframeHeight = ref(160)
const MAX_IFRAME_HEIGHT = 12_000
let iframeResizeObserver: ResizeObserver | null = null
let iframeResizeFrame: number | null = null

const htmlSrcdoc = computed(() => buildMailHtmlSrcdoc(props.bodyHtml || '', {
  loadRemoteImages: remoteImagesLoaded.value,
  remoteImageProxyPath: props.remoteImageProxyPath,
}))

watch(() => props.bodyHtml, (bodyHtml) => {
  displayMode.value = bodyHtml?.trim() ? 'html' : 'text'
  remoteImagesLoaded.value = false
  disconnectIframeResizeObserver()
  iframeHeight.value = 160
})

watch(displayMode, (mode) => {
  if (mode !== 'html') disconnectIframeResizeObserver()
})

onBeforeUnmount(() => disconnectIframeResizeObserver())

function loadRemoteImages() {
  remoteImagesLoaded.value = true
  disconnectIframeResizeObserver()
}

function observeIframeSize() {
  disconnectIframeResizeObserver()
  const iframe = iframeElement.value
  const document = iframe?.contentDocument
  if (!iframe || !document) return

  const updateHeight = () => {
    iframeResizeFrame = null
    const bodyHeight = Math.ceil(Math.max(
      document.body?.scrollHeight || 0,
      document.body?.offsetHeight || 0,
    ))
    const nextHeight = Math.min(
      MAX_IFRAME_HEIGHT,
      Math.max(1, bodyHeight),
    )
    if (Math.abs(nextHeight - iframeHeight.value) > 1) {
      iframeHeight.value = nextHeight
    }
  }

  const scheduleHeightUpdate = () => {
    if (iframeResizeFrame !== null) return
    iframeResizeFrame = window.requestAnimationFrame(updateHeight)
  }

  updateHeight()
  if (!('ResizeObserver' in window)) return

  iframeResizeObserver = new ResizeObserver(scheduleHeightUpdate)
  if (document.body) iframeResizeObserver.observe(document.body)
}

function disconnectIframeResizeObserver() {
  iframeResizeObserver?.disconnect()
  iframeResizeObserver = null
  if (iframeResizeFrame !== null) {
    window.cancelAnimationFrame(iframeResizeFrame)
    iframeResizeFrame = null
  }
}
</script>

<template>
  <div v-if="hasHtml" class="mail-body-display">
    <div class="mail-body-display__toolbar" role="group" aria-label="Sposób wyświetlania wiadomości">
      <button
        type="button"
        class="mail-body-display__mode"
        :class="{ 'mail-body-display__mode--active': displayMode === 'html' }"
        :aria-pressed="displayMode === 'html'"
        @click="displayMode = 'html'"
      >
        Wersja HTML
      </button>
      <button
        type="button"
        class="mail-body-display__mode"
        :class="{ 'mail-body-display__mode--active': displayMode === 'text' }"
        :aria-pressed="displayMode === 'text'"
        @click="displayMode = 'text'"
      >
        Wersja tekstowa
      </button>
    </div>

    <template v-if="displayMode === 'html'">
      <div
        v-if="remoteImagesPresent && !remoteImagesLoaded"
        class="mail-body-display__privacy-notice"
        role="note"
      >
        <UIcon name="i-lucide-shield-alert" aria-hidden="true" />
        <span>
          Zdalne obrazy są zablokowane. Ich pobranie może poinformować nadawcę,
          że wiadomość została otwarta.
        </span>
        <button
          type="button"
          class="mail-body-display__load-images"
          @click="loadRemoteImages"
        >
          Wczytaj zdalne obrazy
        </button>
      </div>

      <iframe
        ref="iframeElement"
        class="mail-body-display__frame"
        :srcdoc="htmlSrcdoc"
        :sandbox="MAIL_HTML_IFRAME_SANDBOX"
        referrerpolicy="no-referrer"
        title="Treść wiadomości HTML"
        scrolling="auto"
        :style="{ height: `${iframeHeight}px` }"
        @load="observeIframeSize"
      />
    </template>

    <div v-else class="mail-body-content">
      <template v-if="paragraphs.length">
        <p
          v-for="(paragraph, paragraphIndex) in paragraphs"
          :key="paragraphIndex"
          class="mail-body-content__paragraph"
          :class="`mail-body-content__paragraph--${paragraph.kind}`"
        >
          <template v-for="(segment, segmentIndex) in paragraph.segments" :key="segmentIndex">
            <span v-if="segment.type === 'text'">{{ segment.value }}</span>
            <span
              v-else
              class="mail-body-content__url"
              :title="`Nieaktywny odnośnik do ${segment.domain}. Otwórz wiadomość u dostawcy, aby przejść dalej.`"
              :aria-label="`Nieaktywny odnośnik do ${segment.domain}`"
            >
              <UIcon name="i-lucide-link-2" aria-hidden="true" />
              <bdi>{{ segment.label }}</bdi>
            </span>
          </template>
        </p>
      </template>
      <p v-else class="mail-body-content__empty">
        Ta wiadomość nie zawiera tekstu możliwego do wyświetlenia.
      </p>
    </div>
  </div>

  <div v-else class="mail-body-content">
    <template v-if="paragraphs.length">
      <p
        v-for="(paragraph, paragraphIndex) in paragraphs"
        :key="paragraphIndex"
        class="mail-body-content__paragraph"
        :class="`mail-body-content__paragraph--${paragraph.kind}`"
      >
        <template v-for="(segment, segmentIndex) in paragraph.segments" :key="segmentIndex">
          <span v-if="segment.type === 'text'">{{ segment.value }}</span>
          <span
            v-else
            class="mail-body-content__url"
            :title="`Nieaktywny odnośnik do ${segment.domain}. Otwórz wiadomość u dostawcy, aby przejść dalej.`"
            :aria-label="`Nieaktywny odnośnik do ${segment.domain}`"
          >
            <UIcon name="i-lucide-link-2" aria-hidden="true" />
            <bdi>{{ segment.label }}</bdi>
          </span>
        </template>
      </p>
    </template>
    <p v-else class="mail-body-content__empty">
      Ta wiadomość nie zawiera tekstu możliwego do wyświetlenia.
    </p>
  </div>
</template>

<style scoped>
.mail-body-display {
  width: 100%;
  min-width: 0;
}

.mail-body-display__toolbar {
  display: flex;
  width: fit-content;
  max-width: 100%;
  gap: 3px;
  margin-bottom: 16px;
  padding: 3px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-bg-muted);
}

.mail-body-display__mode,
.mail-body-display__load-images {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.mail-body-display__mode {
  padding: 5px 10px;
  border-radius: 7px;
  color: var(--ui-text-muted);
  background: transparent;
  font-size: 12px;
  font-weight: 600;
}

.mail-body-display__mode:hover,
.mail-body-display__mode:focus-visible {
  color: var(--ui-text);
}

.mail-body-display__mode--active {
  color: var(--ui-text);
  background: var(--ui-bg);
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
}

.mail-body-display__privacy-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
  font-size: 12px;
  line-height: 1.5;
}

.mail-body-display__privacy-notice :deep(svg) {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: var(--ui-warning);
}

.mail-body-display__privacy-notice span {
  min-width: 0;
  flex: 1 1 auto;
}

.mail-body-display__load-images {
  flex: 0 0 auto;
  padding: 5px 9px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 7px;
  color: var(--ui-text);
  background: var(--ui-bg);
  font-size: 12px;
  font-weight: 600;
}

.mail-body-display__load-images:hover,
.mail-body-display__load-images:focus-visible {
  border-color: var(--ui-border-inverted);
}

.mail-body-display__mode:focus-visible,
.mail-body-display__load-images:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.mail-body-display__frame {
  display: block;
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
}

.mail-body-content {
  width: 100%;
  max-width: none;
  min-width: 0;
  color: var(--ui-text);
  font-size: 15px;
  line-height: 1.72;
}

.mail-body-content__paragraph {
  width: 100%;
  max-width: none;
  margin: 0;
  overflow-wrap: anywhere;
  unicode-bidi: plaintext;
  white-space: pre-wrap;
}

.mail-body-content__paragraph + .mail-body-content__paragraph {
  margin-top: 1.15em;
}

.mail-body-content__paragraph--quote {
  padding-left: 14px;
  border-left: 2px solid var(--ui-border-accented);
  color: var(--ui-text-muted);
}

.mail-body-content__paragraph--signature {
  color: var(--ui-text-muted);
  font-size: .94em;
}

.mail-body-content__url {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 5px;
  padding: 1px 7px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
  font-family: var(--font-mono);
  font-size: .78em;
  line-height: 1.65;
  vertical-align: -.24em;
  white-space: nowrap;
}

.mail-body-content__url :deep(svg) {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
}

.mail-body-content__url bdi {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mail-body-content__empty {
  margin: 0;
  color: var(--ui-text-muted);
  font-style: italic;
}

@media (max-width: 680px) {
  .mail-body-display__privacy-notice {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .mail-body-display__load-images {
    margin-left: 26px;
  }

  .mail-body-content {
    font-size: 14px;
    line-height: 1.68;
  }
}
</style>
