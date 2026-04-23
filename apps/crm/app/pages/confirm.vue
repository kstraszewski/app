<script setup lang="ts">
const user = useSupabaseUser()
watch(user, (val) => {
  if (val) navigateTo('/dashboard')
}, { immediate: true })
</script>

<template>
  <main>
    <p>Logowanie…</p>
  </main>
</template>
