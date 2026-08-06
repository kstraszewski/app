<script setup lang="ts">
import type { TransitionProps } from 'vue'

const route = useRoute()
const assistantPage = computed(() => route.path.endsWith('/assistant'))
const caseMessagesPage = computed(() => {
  const view = Array.isArray(route.query.view) ? route.query.view[0] : route.query.view
  return /\/org\/[^/]+\/cases\/[^/]+\/?$/.test(route.path) && view === 'messages'
})
const workspacePage = computed(() => (
  /\/pdf-templates\/[^/]+\/?$/.test(route.path)
  || /\/org\/[^/]+\/messages\/?$/.test(route.path)
  || caseMessagesPage.value
))
const contentTransition: TransitionProps = {
  name: 'oe-content',
  mode: 'out-in',
}
</script>

<template>
  <CrmAppShell
    :assistant-page="assistantPage"
    :workspace-page="workspacePage"
  >
    <NuxtPage :transition="contentTransition" />
  </CrmAppShell>
</template>
