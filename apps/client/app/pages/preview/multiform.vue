<script setup lang="ts">
import type { PortalMultiformAnswers, PortalMultiformDraft, PortalMultiformPayload } from '~/types/portal'
import { previewCase, previewMultiform, previewPortal } from '~/data/preview'

definePageMeta({ middleware: 'preview-only' })

const route = useRoute()
const locked = computed(() => route.query.state === 'locked' || route.query.locked === '1')
const payload = computed<PortalMultiformPayload>(() => locked.value
  ? { access: 'locked', grant: { ...previewCase.grant, multiformEnabled: false } }
  : previewMultiform)

async function save(body: {
  answers: PortalMultiformAnswers
  step: number
  revision: number
  completed?: boolean
}): Promise<PortalMultiformDraft> {
  await new Promise(resolve => window.setTimeout(resolve, 380))
  if (previewMultiform.draft) {
    previewMultiform.draft.answers = structuredClone(body.answers)
    previewMultiform.draft.activeStep = body.step
    previewMultiform.draft.revision = body.revision + 1
    if (body.completed) previewMultiform.draft.completedAt = new Date().toISOString()
  }
  return structuredClone(previewMultiform.draft!)
}

useHead({ title: 'Podgląd Multiwniosku — OpenExpert' })
</script>

<template>
  <PortalMultiformScreen
    :case-data="previewCase"
    :user="previewPortal.user"
    :payload="payload"
    :save="save"
    preview
  />
</template>
