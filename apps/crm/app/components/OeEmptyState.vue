<script setup lang="ts">
type EmptyStateKind = 'empty' | 'filtered' | 'error' | 'selection' | 'success'
type EmptyStateSize = 'compact' | 'default' | 'spacious'
type EmptyStateSurface = 'plain' | 'subtle' | 'outline'

const props = withDefaults(defineProps<{
  title: string
  description?: string
  eyebrow?: string
  icon?: string
  kind?: EmptyStateKind
  size?: EmptyStateSize
  surface?: EmptyStateSurface
  align?: 'start' | 'center'
  titleTag?: 'h2' | 'h3' | 'h4'
}>(), {
  description: undefined,
  eyebrow: undefined,
  icon: undefined,
  kind: 'empty',
  size: 'default',
  surface: 'plain',
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
const role = computed(() => props.kind === 'error' ? 'alert' : 'status')
</script>

<template>
  <section
    class="oe-empty-state"
    :class="[
      `oe-empty-state--${size}`,
      `oe-empty-state--${surface}`,
      `oe-empty-state--${align}`,
      `oe-empty-state--${kind}`,
    ]"
    :role="role"
    :aria-live="kind === 'error' ? 'assertive' : 'polite'"
    :aria-labelledby="titleId"
    :aria-describedby="description || slots.description ? descriptionId : undefined"
    data-empty-state
    :data-empty-state-kind="kind"
  >
    <span class="oe-empty-state__icon" aria-hidden="true">
      <UIcon :name="resolvedIcon" />
    </span>

    <div class="oe-empty-state__copy">
      <p v-if="eyebrow" class="oe-empty-state__eyebrow">{{ eyebrow }}</p>
      <component :is="titleTag" :id="titleId">{{ title }}</component>
      <p v-if="description || slots.description" :id="descriptionId" class="oe-empty-state__description">
        <slot name="description">{{ description }}</slot>
      </p>
      <div v-if="slots.default" class="oe-empty-state__details">
        <slot />
      </div>
    </div>

    <div v-if="slots.actions" class="oe-empty-state__actions">
      <slot name="actions" />
    </div>
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
  min-width: 0;
  min-height: 248px;
  padding: clamp(32px, 6vw, 64px) clamp(20px, 4vw, 48px);
  border-radius: var(--oe-radius-surface);
  color: var(--ui-text);
  text-align: center;
}

.oe-empty-state--spacious {
  min-height: 360px;
}

.oe-empty-state--subtle {
  background: var(--ui-bg-muted);
}

.oe-empty-state--outline {
  border: 1px dashed var(--ui-border-accented);
  background: color-mix(in srgb, var(--ui-bg-muted) 62%, transparent);
}

.oe-empty-state__icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--ui-text-highlighted) 8%, transparent);
}

.oe-empty-state__icon :deep(svg) {
  width: 24px;
  height: 24px;
}

.oe-empty-state--error .oe-empty-state__icon {
  border-color: color-mix(in srgb, var(--ui-error) 24%, var(--ui-border));
  color: var(--ui-error);
  background: color-mix(in srgb, var(--ui-error) 7%, var(--ui-bg));
}

.oe-empty-state--success .oe-empty-state__icon {
  border-color: color-mix(in srgb, var(--ui-success) 24%, var(--ui-border));
  color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-success) 7%, var(--ui-bg));
}

.oe-empty-state__copy {
  display: grid;
  justify-items: center;
  gap: 7px;
  max-width: 520px;
}

.oe-empty-state__eyebrow {
  margin: 0 0 2px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.oe-empty-state__copy h2,
.oe-empty-state__copy h3,
.oe-empty-state__copy h4,
.oe-empty-state__description,
.oe-empty-state__details {
  margin: 0;
}

.oe-empty-state__copy h2,
.oe-empty-state__copy h3,
.oe-empty-state__copy h4 {
  color: var(--ui-text-highlighted);
  font-size: clamp(18px, 2vw, 22px);
  font-weight: 600;
  letter-spacing: -.02em;
  line-height: 1.25;
}

.oe-empty-state__description,
.oe-empty-state__details {
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 1.55;
}

.oe-empty-state__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

.oe-empty-state--start {
  align-items: flex-start;
  text-align: left;
}

.oe-empty-state--start .oe-empty-state__copy {
  justify-items: start;
}

.oe-empty-state--start .oe-empty-state__actions {
  justify-content: flex-start;
}

.oe-empty-state--compact {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  justify-content: initial;
  gap: 14px;
  min-height: 0;
  padding: 18px;
  text-align: left;
}

.oe-empty-state--compact .oe-empty-state__icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
}

.oe-empty-state--compact .oe-empty-state__icon :deep(svg) {
  width: 20px;
  height: 20px;
}

.oe-empty-state--compact .oe-empty-state__copy {
  justify-items: start;
  max-width: none;
}

.oe-empty-state--compact .oe-empty-state__copy h2,
.oe-empty-state--compact .oe-empty-state__copy h3,
.oe-empty-state--compact .oe-empty-state__copy h4 {
  font-size: 15px;
}

.oe-empty-state--compact .oe-empty-state__description,
.oe-empty-state--compact .oe-empty-state__details {
  font-size: 12px;
}

.oe-empty-state--compact .oe-empty-state__actions {
  grid-column: 1 / -1;
  justify-content: flex-start;
}

@media (max-width: 640px) {
  .oe-empty-state {
    min-height: 220px;
    padding: 32px 18px;
  }

  .oe-empty-state--compact { min-height: 0; padding: 16px; }

  .oe-empty-state--compact .oe-empty-state__actions {
    grid-column: 1 / -1;
    justify-content: stretch;
  }

  .oe-empty-state--compact .oe-empty-state__actions :deep(button),
  .oe-empty-state--compact .oe-empty-state__actions :deep(a) {
    flex: 1 1 auto;
  }
}
</style>
