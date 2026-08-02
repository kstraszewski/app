<script setup lang="ts">
const props = withDefaults(defineProps<{
  preview?: boolean
}>(), {
  preview: false,
})

const route = useRoute()
const currentCaseId = computed(() => typeof route.params.caseId === 'string'
  ? route.params.caseId
  : '')
const messagesTo = computed(() => {
  const base = props.preview ? '/preview/messages' : '/messages'
  return currentCaseId.value
    ? `${base}?case=${encodeURIComponent(currentCaseId.value)}`
    : base
})
const items = computed(() => [
  {
    label: 'Co teraz',
    icon: 'i-lucide-house',
    to: props.preview ? '/preview' : '/',
    active: props.preview
      ? route.path === '/preview'
      : route.path === '/',
  },
  {
    label: 'Wiadomości',
    icon: 'i-lucide-message-circle-more',
    to: messagesTo.value,
    active: props.preview
      ? route.path.startsWith('/preview/messages')
      : route.path.startsWith('/messages'),
  },
])
</script>

<template>
  <nav class="portal-bottom-nav" aria-label="Główna nawigacja mobilna">
    <NuxtLink
      v-for="item in items"
      :key="item.label"
      :to="item.to"
      :class="{ 'is-active': item.active }"
      :aria-current="item.active ? 'page' : undefined"
    >
      <UIcon :name="item.icon" />
      <span>{{ item.label }}</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.portal-bottom-nav {
  display: none;
}

@media (max-width: 640px) {
  .portal-bottom-nav {
    position: fixed;
    z-index: 50;
    right: 16px;
    bottom: max(10px, env(safe-area-inset-bottom));
    left: 16px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: min(320px, calc(100% - 32px));
    min-height: 64px;
    margin-inline: auto;
    padding: 6px;
    border: 1px solid rgb(0 0 0 / 10%);
    border-radius: 20px;
    background: rgb(255 255 255 / 94%);
    box-shadow: 0 18px 48px rgb(0 0 0 / 16%);
    backdrop-filter: blur(18px);
  }

  .portal-bottom-nav a {
    display: grid;
    grid-template-columns: 20px auto;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 0;
    min-height: 50px;
    border-radius: 15px;
    color: var(--ui-text-muted);
    font-size: 12px;
    font-weight: 650;
    text-decoration: none;
    transition: color 160ms ease, background 160ms ease;
  }

  .portal-bottom-nav a.is-active {
    background: var(--ui-bg-inverted);
    color: var(--ui-text-inverted);
  }

  .portal-bottom-nav svg {
    width: 19px;
    height: 19px;
    stroke-width: 1.9;
  }
}
</style>
