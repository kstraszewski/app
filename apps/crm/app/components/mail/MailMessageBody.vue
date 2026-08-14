<script setup lang="ts">
import { mailBodyParagraphs } from '~/utils/mail-body-display'

const props = defineProps<{
  bodyText: string
}>()

const paragraphs = computed(() => mailBodyParagraphs(props.bodyText))
</script>

<template>
  <div class="mail-body-content">
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
.mail-body-content {
  width: 100%;
  color: var(--ui-text);
  font-size: 15px;
  line-height: 1.72;
}

.mail-body-content__paragraph {
  margin: 0;
  overflow-wrap: break-word;
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
  .mail-body-content {
    font-size: 14px;
    line-height: 1.68;
  }
}
</style>
