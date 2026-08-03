<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const { orgPath } = useOrganizationContext()

await navigateTo({
  path: orgPath('/calculator/capacity'),
  query: route.query,
  hash: route.hash,
}, {
  redirectCode: 301,
  replace: true,
})
</script>

<template>
  <div />
</template>
