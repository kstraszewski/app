<script setup lang="ts">
defineProps<{
  eyebrow: string
  title: string
  description?: string
  icon?: string
}>()
</script>

<template>
  <div class="sales-panel-heading">
    <div>
      <p>{{ eyebrow }}</p>
      <h2>{{ title }}</h2>
    </div>

    <slot name="trailing">
      <UIcon v-if="icon" :name="icon" aria-hidden="true" />
      <span v-else-if="description">{{ description }}</span>
    </slot>
  </div>
</template>

<style scoped>
.sales-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}

.sales-panel-heading > div {
  min-width: 0;
}

.sales-panel-heading p,
.sales-panel-heading h2 {
  margin: 0;
}

.sales-panel-heading p {
  color: var(--ui-text-dimmed);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.sales-panel-heading h2 {
  margin-top: 4px;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  font-weight: 650;
}

.sales-panel-heading > span {
  max-width: 280px;
  color: var(--ui-text-dimmed);
  font-size: 10px;
  line-height: 1.4;
  text-align: right;
}

.sales-panel-heading > :deep(.iconify) {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
  font-size: 20px;
}

@media (max-width: 560px) {
  .sales-panel-heading {
    align-items: flex-start;
  }

  .sales-panel-heading > span {
    display: none;
  }
}
</style>
