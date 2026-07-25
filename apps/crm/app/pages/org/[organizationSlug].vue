<script setup lang="ts">
import type { TransitionProps } from 'vue'

const route = useRoute()
const assistantPage = ref(route.path.endsWith('/assistant'))
const contentTransition: TransitionProps = {
  name: 'oe-content',
  mode: 'out-in',
  onBeforeEnter: () => {
    assistantPage.value = route.path.endsWith('/assistant')
  },
}
</script>

<template>
  <CrmAppShell :assistant-page="assistantPage">
    <NuxtPage :transition="contentTransition" />
  </CrmAppShell>
</template>
