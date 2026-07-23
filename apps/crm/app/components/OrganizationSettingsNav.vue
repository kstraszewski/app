<script setup lang="ts">
const route = useRoute()
const { orgPath } = useOrganizationContext()

const items = computed(() => {
  const settingsPath = orgPath('/settings')
  const designPath = orgPath('/settings/design')

  return [
    {
      label: 'Konfiguracja',
      icon: 'i-lucide-sliders-horizontal',
      to: settingsPath,
      active: route.path === settingsPath || route.path === `${settingsPath}/`,
    },
    {
      label: 'Design',
      icon: 'i-lucide-component',
      to: designPath,
      active: route.path.startsWith(designPath),
    },
  ]
})
</script>

<template>
  <nav class="settings-nav" aria-label="Sekcje ustawień organizacji">
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
.settings-nav {
  display: inline-flex;
  gap: 4px;
  width: fit-content;
  margin-bottom: 24px;
  padding: 4px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  background: var(--ui-bg-muted);
}

@media (max-width: 560px) {
  .settings-nav {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
  }
}
</style>
