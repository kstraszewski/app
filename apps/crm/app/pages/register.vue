<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

await navigateTo({
  path: '/login',
  query: { registration: 'closed' },
}, { replace: true })
</script>

<template>
  <div />
</template>
