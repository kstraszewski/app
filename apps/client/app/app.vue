<script setup lang="ts">
import { pl } from '@nuxt/ui/locale'

useHead({
  link: [{ rel: 'icon', href: '/assets/logo-mark.svg', type: 'image/svg+xml' }],
})
</script>

<template>
  <UApp :locale="pl">
    <NuxtRouteAnnouncer />
    <NuxtLoadingIndicator color="var(--ui-primary)" :height="2" :throttle="120" />
    <NuxtPage />
  </UApp>
</template>
