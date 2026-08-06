<script setup lang="ts">
import type { MessageReplyReference } from '@openexpert/messaging'
import { computed } from 'vue'
import { messageReplyPreviewText } from '../replies.ts'

const props = withDefaults(defineProps<{
  reply: MessageReplyReference
  authorLabel: string
  interactive?: boolean
  showAuthor?: boolean
}>(), {
  interactive: false,
  showAuthor: true,
})

const emit = defineEmits<{
  select: [reply: MessageReplyReference]
}>()

const preview = computed(() => messageReplyPreviewText(props.reply))

function selectReply(): void {
  if (props.interactive) emit('select', props.reply)
}
</script>

<template>
  <component
    :is="interactive ? 'button' : 'div'"
    class="oe-message-reply-quote"
    :class="{ 'is-interactive': interactive }"
    :type="interactive ? 'button' : undefined"
    :aria-label="interactive ? `Przejdź do cytowanej wiadomości: ${preview}` : undefined"
    @click="selectReply"
  >
    <strong v-if="showAuthor">{{ authorLabel }}</strong>
    <span>{{ preview }}</span>
  </component>
</template>

<style scoped>
.oe-message-reply-quote {
  position: relative;
  display: grid;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  gap: 1px;
  padding: 7px 9px 7px 11px;
  border: 0;
  border-radius: 9px;
  background: var(--oe-message-reply-bg, var(--ui-bg-elevated));
  color: var(--oe-message-reply-text, currentColor);
  font: inherit;
  text-align: left;
}

.oe-message-reply-quote::before {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  border-radius: 999px;
  background: var(--oe-message-reply-accent, var(--ui-primary));
  content: '';
}

.oe-message-reply-quote strong,
.oe-message-reply-quote span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.oe-message-reply-quote strong {
  color: var(--oe-message-reply-author, currentColor);
  font-size: 10px;
  font-weight: 740;
  line-height: 1.35;
  white-space: nowrap;
}

.oe-message-reply-quote span {
  display: -webkit-box;
  color: var(--oe-message-reply-muted, var(--ui-text-muted));
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.oe-message-reply-quote.is-interactive {
  cursor: pointer;
  transition:
    background-color var(--oe-duration-fast, 150ms) var(--ease-out, ease-out),
    transform var(--oe-duration-fast, 150ms) var(--ease-out, ease-out);
}

.oe-message-reply-quote.is-interactive:hover {
  background: var(--oe-message-reply-hover, var(--ui-bg-accented));
}

.oe-message-reply-quote.is-interactive:active {
  transform: scale(.99);
}

.oe-message-reply-quote.is-interactive:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-primary) 45%, transparent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .oe-message-reply-quote.is-interactive {
    transition: none;
  }
}
</style>
