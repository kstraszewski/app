<script setup lang="ts">
import { previewPortal } from '~/data/preview'

definePageMeta({ middleware: 'preview-only' })

const route = useRoute()
const caseData = computed(() => previewPortal.cases.find(item => item.id === String(route.params.caseId))
  || previewPortal.cases[0]!)

useHead(() => ({ title: `${caseData.value.title} — podgląd OpenExpert` }))
</script>

<template>
  <PortalCaseScreen
    :case-data="caseData"
    :user="previewPortal.user"
    preview
  />
</template>
