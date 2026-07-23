<script setup lang="ts">
const route = useRoute()
const { orgPath } = useOrganizationContext()

const items = computed(() => [
  {
    label: 'Placówki',
    icon: 'i-lucide-map-pinned',
    to: orgPath('/facilities'),
    active: route.path.startsWith(orgPath('/facilities')),
  },
  {
    label: 'Zespoły',
    icon: 'i-lucide-network',
    to: orgPath('/teams'),
    active: route.path.startsWith(orgPath('/teams')),
  },
])
</script>

<template>
  <nav class="structure-nav" aria-label="Zespoły i placówki">
    <UButton
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :icon="item.icon"
      color="neutral"
      :variant="item.active ? 'solid' : 'ghost'"
      :aria-current="item.active ? 'page' : undefined"
    >
      {{ item.label }}
    </UButton>
  </nav>
</template>

<style scoped>
.structure-nav {
  display: inline-flex;
  gap: 4px;
  margin-bottom: 20px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  padding: 4px;
  background: var(--ui-bg-muted);
}

@media (max-width: 560px) {
  .structure-nav {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
  }
}
</style>
