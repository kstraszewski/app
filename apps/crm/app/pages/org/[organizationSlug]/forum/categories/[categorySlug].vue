<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const categorySlug = computed(() => {
  const value = route.params.categorySlug
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
})

</script>

<template>
  <ForumDirectoryPage :category-slug="categorySlug" />
</template>
