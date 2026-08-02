<script setup lang="ts">
import { firstMeetingPreviewPortal, previewPortal } from '~/data/preview'

definePageMeta({ middleware: 'preview-only' })
useHead({ title: 'Podgląd panelu klienta — OpenExpert' })

const route = useRoute()
const payload = computed(() => (
  route.query.scenario === 'first-meeting'
    ? firstMeetingPreviewPortal
    : previewPortal
))
</script>

<template>
  <PortalDashboardScreen :payload="payload" preview />
</template>
