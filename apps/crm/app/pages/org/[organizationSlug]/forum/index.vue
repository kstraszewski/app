<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Forum ekspertów — OpenExpert CRM' })

const route = useRoute()
const organizationSlug = Array.isArray(route.params.organizationSlug)
  ? String(route.params.organizationSlug[0] || '')
  : String(route.params.organizationSlug || '')
const legacyThreadId = typeof route.query.thread === 'string' ? route.query.thread : ''

if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(legacyThreadId)) {
  const query = { ...route.query }
  delete query.thread
  await navigateTo({
    path: `/org/${encodeURIComponent(organizationSlug)}/forum/threads/${encodeURIComponent(legacyThreadId)}`,
    query,
  }, { redirectCode: 301, replace: true })
}
</script>

<template>
  <ForumDirectoryPage />
</template>
