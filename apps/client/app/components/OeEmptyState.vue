<script setup lang="ts">
type EmptyStateKind = 'empty' | 'filtered' | 'error' | 'selection' | 'success'

const props = withDefaults(defineProps<{
  title: string
  description?: string
  icon?: string
  kind?: EmptyStateKind
  compact?: boolean
  align?: 'start' | 'center'
  titleTag?: 'h2' | 'h3' | 'h4'
}>(), {
  description: undefined,
  icon: undefined,
  kind: 'empty',
  compact: false,
  align: 'center',
  titleTag: 'h3',
})

const slots = useSlots()
const titleId = useId()
const descriptionId = useId()
const defaultIcons: Record<EmptyStateKind, string> = {
  empty: 'i-lucide-inbox',
  filtered: 'i-lucide-search-x',
  error: 'i-lucide-cloud-off',
  selection: 'i-lucide-mouse-pointer-2',
  success: 'i-lucide-circle-check',
}
const resolvedIcon = computed(() => props.icon || defaultIcons[props.kind])
</script>

<template>
  <section
    class="oe-empty-state"
    :class="[
      `oe-empty-state--${kind}`,
      `oe-empty-state--${align}`,
      { 'oe-empty-state--compact': compact },
    ]"
    :role="kind === 'error' ? 'alert' : 'status'"
    :aria-live="kind === 'error' ? 'assertive' : 'polite'"
    :aria-labelledby="titleId"
    :aria-describedby="description || slots.description ? descriptionId : undefined"
    data-empty-state
    :data-empty-state-kind="kind"
  >
    <span class="oe-empty-state__icon" aria-hidden="true"><UIcon :name="resolvedIcon" /></span>
    <div class="oe-empty-state__copy">
      <component :is="titleTag" :id="titleId">{{ title }}</component>
      <p v-if="description || slots.description" :id="descriptionId">
        <slot name="description">{{ description }}</slot>
      </p>
      <slot />
    </div>
    <div v-if="slots.actions" class="oe-empty-state__actions"><slot name="actions" /></div>
  </section>
</template>

<style scoped>
.oe-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  width: 100%;
  min-height: 260px;
  padding: clamp(32px, 7vw, 64px) clamp(20px, 5vw, 48px);
  border: 1px dashed var(--ui-border-accented);
  border-radius: 18px;
  background: color-mix(in srgb, var(--portal-warm-surface) 76%, var(--ui-bg));
  text-align: center;
}

.oe-empty-state__icon {
  display: grid;
  place-items: center;
  width: 58px;
  height: 58px;
  border: 1px solid var(--ui-border);
  border-radius: 17px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg);
  box-shadow: 0 12px 30px rgb(0 0 0 / 7%);
}

.oe-empty-state__icon :deep(svg) { width: 25px; height: 25px; }
.oe-empty-state--error .oe-empty-state__icon { color: var(--ui-error); }
.oe-empty-state--success .oe-empty-state__icon { color: var(--ui-success); }
.oe-empty-state__copy { display: grid; justify-items: center; gap: 7px; max-width: 500px; }
.oe-empty-state__copy h2,
.oe-empty-state__copy h3,
.oe-empty-state__copy h4,
.oe-empty-state__copy p { margin: 0; }
.oe-empty-state__copy h2,
.oe-empty-state__copy h3,
.oe-empty-state__copy h4 { color: var(--ui-text-highlighted); font-size: clamp(19px, 2vw, 23px); font-weight: 600; line-height: 1.25; }
.oe-empty-state__copy p { color: var(--ui-text-muted); font-size: 14px; line-height: 1.55; }
.oe-empty-state__actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.oe-empty-state--start { align-items: flex-start; text-align: left; }
.oe-empty-state--start .oe-empty-state__copy { justify-items: start; }
.oe-empty-state--start .oe-empty-state__actions { justify-content: flex-start; }
.oe-empty-state--compact { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 14px; min-height: 0; padding: 18px; text-align: left; }
.oe-empty-state--compact .oe-empty-state__icon { width: 44px; height: 44px; border-radius: 12px; }
.oe-empty-state--compact .oe-empty-state__copy { justify-items: start; }
.oe-empty-state--compact .oe-empty-state__copy h2,
.oe-empty-state--compact .oe-empty-state__copy h3,
.oe-empty-state--compact .oe-empty-state__copy h4 { font-size: 15px; }
.oe-empty-state--compact .oe-empty-state__copy p { font-size: 12px; }
.oe-empty-state--compact .oe-empty-state__actions { grid-column: 1 / -1; justify-content: flex-start; }

@media (max-width: 640px) {
  .oe-empty-state--compact .oe-empty-state__actions { grid-column: 1 / -1; justify-content: stretch; }
}
</style>
