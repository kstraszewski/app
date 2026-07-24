<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const rawOrganizationSlug = route.params.organizationSlug
const organizationSlug = Array.isArray(rawOrganizationSlug)
  ? String(rawOrganizationSlug[0] ?? '')
  : String(rawOrganizationSlug ?? '')

await navigateTo(`/org/${encodeURIComponent(organizationSlug)}/settings/institutions`, {
  replace: true,
  redirectCode: 302,
})
</script>

<template>
  <div />
</template>
