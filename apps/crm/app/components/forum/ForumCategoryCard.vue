<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { ForumCategory } from '#shared/types/forum'

defineProps<{
  category: ForumCategory
  to: RouteLocationRaw
}>()

function threadCountLabel(count: number): string {
  if (count === 1) return 'wątek'
  const lastTwoDigits = count % 100
  return count % 10 >= 2 && count % 10 <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
    ? 'wątki'
    : 'wątków'
}
</script>

<template>
  <NuxtLink :to="to" class="forum-category-card">
    <span class="forum-category-card__icon">
      <UIcon :name="category.icon || 'i-lucide-folder'" aria-hidden="true" />
    </span>
    <span class="forum-category-card__content">
      <span class="forum-category-card__heading">
        <strong>{{ category.name }}</strong>
        <span>
          {{ category.threadCount || 0 }}
          {{ threadCountLabel(category.threadCount || 0) }}
        </span>
      </span>
      <span class="forum-category-card__description">
        {{ category.description || 'Rozmowy i sprawdzone odpowiedzi z tego obszaru.' }}
      </span>
      <span class="forum-category-card__link">
        Zobacz kategorię
        <UIcon name="i-lucide-arrow-right" aria-hidden="true" />
      </span>
    </span>
  </NuxtLink>
</template>

<style scoped>
.forum-category-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  min-height: 106px;
  padding: 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text);
  background: var(--ui-bg);
  text-decoration: none;
  transition:
    border-color var(--oe-motion-fast),
    background-color var(--oe-motion-fast),
    transform var(--oe-motion-fast);
}

.forum-category-card:hover {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
  transform: translateY(-1px);
}

.forum-category-card:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

.forum-category-card__icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
}

.forum-category-card__icon :deep(svg) {
  width: 18px;
  height: 18px;
}

.forum-category-card__content {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.forum-category-card__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.forum-category-card__heading strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  line-height: 1.35;
}

.forum-category-card__heading > span {
  flex: 0 0 auto;
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 9px;
}

.forum-category-card__description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.forum-category-card__link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 1px;
  color: var(--ui-text-toned);
  font-size: 10px;
  font-weight: 650;
}

.forum-category-card__link :deep(svg) {
  width: 13px;
  height: 13px;
}

@media (max-width: 520px) {
  .forum-category-card {
    min-height: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .forum-category-card {
    transition: none;
  }
}
</style>
