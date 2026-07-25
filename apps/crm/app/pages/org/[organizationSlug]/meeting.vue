<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const { orgPath } = useOrganizationContext()

await navigateTo({
  path: orgPath('/meetings'),
  query: route.query,
}, { replace: true })
</script>

<template>
  <div class="p-6">
    <USkeleton class="h-24 w-full" />
  </div>
</template>
