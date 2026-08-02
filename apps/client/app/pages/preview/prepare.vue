<script setup lang="ts">
import { firstMeetingPreviewPortal } from '~/data/preview'

definePageMeta({ middleware: 'preview-only' })
useHead({ title: 'Przygotowanie do spotkania — podgląd OpenExpert' })
</script>

<template>
  <PortalMeetingPreparationScreen :payload="firstMeetingPreviewPortal" preview />
</template>
