<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { ForumCategory } from '#shared/types/forum'

withDefaults(defineProps<{
  category: ForumCategory
  to: RouteLocationRaw
  active?: boolean
}>(), {
  active: false,
})

function threadCountLabel(count: number): string {
  if (count === 1) return 'wątek'
  const lastTwoDigits = count % 100
  return count % 10 >= 2 && count % 10 <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
    ? 'wątki'
    : 'wątków'
}
</script>

<template>
  <NuxtLink
    :to="to"
    class="forum-category-card"
    :class="{ 'forum-category-card--active': active }"
    :aria-current="active ? 'page' : undefined"
    :aria-label="`${category.name}, ${category.threadCount || 0} ${threadCountLabel(category.threadCount || 0)}`"
  >
    <UIcon :name="category.icon || 'i-lucide-folder'" class="forum-category-card__icon" aria-hidden="true" />
    <strong>{{ category.name }}</strong>
    <span class="forum-category-card__count" aria-hidden="true">
      {{ category.threadCount || 0 }}
    </span>
  </NuxtLink>
</template>

<style scoped>
.forum-category-card {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 7px;
  min-height: 34px;
  padding: 6px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  color: var(--ui-text-muted);
  background: var(--ui-bg);
  font-size: 11px;
  text-decoration: none;
  white-space: nowrap;
  transition:
    border-color var(--oe-motion-fast),
    color var(--oe-motion-fast),
    background-color var(--oe-motion-fast);
}

.forum-category-card:hover {
  border-color: var(--ui-border-accented);
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
}

.forum-category-card--active {
  border-color: color-mix(in srgb, var(--ui-primary) 45%, var(--ui-border));
  color: var(--ui-text-highlighted);
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
}

.forum-category-card:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.forum-category-card__icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--ui-primary);
}

.forum-category-card strong {
  color: var(--ui-text-highlighted);
  font-weight: 620;
}

.forum-category-card__count {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  color: var(--ui-text-dimmed);
  background: var(--ui-bg-muted);
  font-family: var(--font-mono);
  font-size: 9px;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .forum-category-card {
    transition: none;
  }
}
</style>
