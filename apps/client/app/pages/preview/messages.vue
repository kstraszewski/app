<script setup lang="ts">
import { previewPortal } from '~/data/preview'

definePageMeta({ middleware: 'preview-only' })
useHead({ title: 'Wiadomości — podgląd OpenExpert' })
</script>

<template>
  <PortalMessagesScreen :payload="previewPortal" preview />
</template>
