<script setup lang="ts">
import { previewPortal } from '~/data/preview'

definePageMeta({ middleware: 'preview-only' })
useHead({ title: 'Podgląd panelu klienta — OpenExpert' })
</script>

<template>
  <PortalDashboardScreen :payload="previewPortal" preview />
</template>
