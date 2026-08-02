<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'organization'],
  validate: route => {
    const value = Array.isArray(route.params.threadId)
      ? String(route.params.threadId[0] || '')
      : String(route.params.threadId || '')
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  },
})

const route = useRoute()
const threadId = computed(() => {
  const value = route.params.threadId
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
})
</script>

<template>
  <ForumThreadPage :thread-id="threadId" />
</template>
