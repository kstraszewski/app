<script setup lang="ts">
definePageMeta({ middleware: ['auth', 'organization'] })

useHead({
  title: 'Poczta — OpenExpert CRM',
  meta: [{ name: 'referrer', content: 'no-referrer' }],
})
</script>

<template>
  <MailWorkspace scope-type="mailbox" />
</template>
