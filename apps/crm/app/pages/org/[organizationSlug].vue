<script setup lang="ts">
import type { TransitionProps } from 'vue'

const route = useRoute()
const assistantPage = computed(() => route.path.endsWith('/assistant'))
const contentTransition: TransitionProps = {
  name: 'oe-content',
  mode: 'out-in',
}
</script>

<template>
  <CrmAppShell :assistant-page="assistantPage">
    <NuxtPage :transition="contentTransition" />
  </CrmAppShell>
</template>
