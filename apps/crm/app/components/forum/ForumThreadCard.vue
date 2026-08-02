<script setup lang="ts">
import type {
  ForumMatchLocation,
  ForumThreadStatus,
  ForumThreadSummary,
  ForumThreadType,
} from '#shared/types/forum'

const props = withDefaults(defineProps<{
  thread: ForumThreadSummary
  selected?: boolean
  query?: string
  bestMatch?: boolean
}>(), {
  selected: false,
  query: '',
  bestMatch: false,
})

const emit = defineEmits<{
  select: [thread: ForumThreadSummary]
}>()

const statusPresentation: Record<ForumThreadStatus, { label: string, icon: string, color: 'success' | 'warning' | 'neutral' }> = {
  open: { label: 'Otwarte', icon: 'i-lucide-circle-dot', color: 'warning' },
  answered: { label: 'Odpowiedziane', icon: 'i-lucide-message-circle-check', color: 'success' },
  resolved: { label: 'Rozwiązane', icon: 'i-lucide-circle-check', color: 'success' },
  closed: { label: 'Zamknięte', icon: 'i-lucide-lock-keyhole', color: 'neutral' },
}

const typeLabels: Record<ForumThreadType, string> = {
  question: 'Pytanie',
  discussion: 'Dyskusja',
}

interface ForumThreadCardModerationState {
  isHidden?: boolean
}

const matchLabels: Record<ForumMatchLocation, string> = {
  title: 'Znaleziono w tytule',
  question: 'Znaleziono w treści pytania',
  reply: 'Znaleziono w odpowiedzi',
}

const status = computed(() => statusPresentation[props.thread.status])
const isHidden = computed(() => (
  props.thread as ForumThreadSummary & ForumThreadCardModerationState
).isHidden === true)
const matchLocation = computed<ForumMatchLocation | null>(() => {
  const value = props.thread.matchedIn
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
})
const matchLabel = computed(() => {
  if (props.thread.hasVerifiedExpertAnswer && matchLocation.value === 'reply') {
    return 'Znaleziono w zweryfikowanej odpowiedzi eksperta'
  }
  return matchLocation.value ? matchLabels[matchLocation.value] : ''
})
const previewText = computed(() => props.thread.snippet?.trim() || props.thread.excerpt)

interface TextSegment {
  text: string
  highlighted: boolean
}

function highlightedSegments(value: string): TextSegment[] {
  const tokens = [...new Set(
    props.query
      .trim()
      .split(/\s+/u)
      .map(token => token.replace(/[^\p{L}\p{N}-]/gu, ''))
      .filter(token => token.length >= 3),
  )]
  if (!tokens.length) return [{ text: value, highlighted: false }]

  const pattern = tokens
    .map(token => token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('|')
  if (!pattern) return [{ text: value, highlighted: false }]

  const expression = new RegExp(`(${pattern})`, 'giu')
  return value
    .split(expression)
    .filter(Boolean)
    .map((text, index) => ({
      text,
      highlighted: index % 2 === 1,
    }))
}

function formatShortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date).replace('.', '')
}
</script>

<template>
  <button
    :id="`forum-thread-card-${thread.id}`"
    type="button"
    class="forum-thread-card"
    :class="{
      'forum-thread-card--selected': selected,
      'forum-thread-card--best': bestMatch,
      'forum-thread-card--hidden': isHidden,
    }"
    :aria-current="selected ? 'true' : undefined"
    :aria-label="`${typeLabels[thread.type]}: ${thread.title}. Status: ${status.label}${isHidden ? '. Wątek ukryty' : ''}`"
    @click="emit('select', thread)"
  >
    <span v-if="bestMatch" class="forum-thread-card__best">
      <UIcon name="i-lucide-star" aria-hidden="true" />
      Najlepsze dopasowanie
    </span>

    <span class="forum-thread-card__heading">
      <span class="forum-thread-card__title">
        <template v-for="(segment, index) in highlightedSegments(thread.title)" :key="`${segment.text}:${index}`">
          <mark v-if="segment.highlighted">{{ segment.text }}</mark>
          <template v-else>{{ segment.text }}</template>
        </template>
      </span>
      <span class="forum-thread-card__badges">
        <UBadge
          v-if="isHidden"
          color="error"
          variant="subtle"
          size="xs"
          icon="i-lucide-eye-off"
        >
          Ukryty
        </UBadge>
        <UBadge
          class="forum-thread-card__status"
          :color="status.color"
          variant="subtle"
          size="xs"
          :icon="status.icon"
        >
          {{ status.label }}
        </UBadge>
      </span>
    </span>

    <span v-if="matchLabel" class="forum-thread-card__match">
      <UIcon name="i-lucide-shield-check" aria-hidden="true" />
      {{ matchLabel }}
    </span>

    <span class="forum-thread-card__preview">
      <template v-for="(segment, index) in highlightedSegments(previewText)" :key="`${segment.text}:${index}`">
        <mark v-if="segment.highlighted">{{ segment.text }}</mark>
        <template v-else>{{ segment.text }}</template>
      </template>
    </span>

    <span class="forum-thread-card__meta">
      <span>{{ typeLabels[thread.type] }}</span>
      <span>{{ thread.category.name }}</span>
      <span>{{ thread.author.name }}</span>
      <span>{{ formatShortDate(thread.lastActivityAt) }}</span>
      <span class="forum-thread-card__replies">
        <UIcon name="i-lucide-message-circle" aria-hidden="true" />
        {{ thread.replyCount }}
        <span class="sr-only">odpowiedzi</span>
      </span>
    </span>
  </button>
</template>

<style scoped>
.forum-thread-card {
  display: grid;
  width: 100%;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text);
  background: var(--ui-bg);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--oe-motion-fast),
    background-color var(--oe-motion-fast),
    box-shadow var(--oe-motion-fast);
}

.forum-thread-card:hover {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
}

.forum-thread-card:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.forum-thread-card--selected {
  border-color: var(--ui-text-highlighted);
  box-shadow: inset 3px 0 0 var(--ui-primary);
}

.forum-thread-card--best {
  border-color: color-mix(in srgb, var(--ui-warning) 58%, var(--ui-border));
}

.forum-thread-card--hidden {
  border-style: dashed;
  border-color: color-mix(in srgb, var(--ui-error) 45%, var(--ui-border));
}

.forum-thread-card__best,
.forum-thread-card__match,
.forum-thread-card__meta,
.forum-thread-card__replies {
  display: flex;
  align-items: center;
}

.forum-thread-card__best {
  gap: 6px;
  color: var(--ui-warning);
  font-size: 11px;
  font-weight: 650;
}

.forum-thread-card__heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
}

.forum-thread-card__title {
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.forum-thread-card__status {
  flex: 0 0 auto;
}

.forum-thread-card__badges {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 5px;
}

.forum-thread-card__match {
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.35;
}

.forum-thread-card__match :deep(svg),
.forum-thread-card__replies :deep(svg),
.forum-thread-card__best :deep(svg) {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
}

.forum-thread-card__preview {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.52;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.forum-thread-card mark {
  border-radius: 2px;
  color: var(--ui-text-highlighted);
  background: color-mix(in srgb, var(--ui-warning) 22%, transparent);
}

.forum-thread-card__meta {
  flex-wrap: wrap;
  gap: 5px 0;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.forum-thread-card__meta > span:not(:last-child)::after {
  margin-inline: 6px;
  content: "·";
}

.forum-thread-card__replies {
  gap: 4px;
}

@media (max-width: 560px) {
  .forum-thread-card {
    padding: 15px 14px;
  }

  .forum-thread-card__heading {
    grid-template-columns: minmax(0, 1fr);
  }

  .forum-thread-card__badges {
    justify-self: start;
    justify-content: flex-start;
  }
}

@media (prefers-reduced-motion: reduce) {
  .forum-thread-card {
    transition: none;
  }
}
</style>
