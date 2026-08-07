<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'organization', 'experiments-access'],
  crmContentMode: 'workspace',
})

useHead({ title: 'Dynamiczny content — Eksperymenty — OpenExpert CRM' })
</script>

<template>
  <CrmShell
    workspace
    class="experiment-dynamic-content-editor-page"
    eyebrow="Eksperymenty"
    title="Dynamiczny content"
    description="Twórz razem z Eve interaktywne strony HTML i od razu sprawdzaj je w podglądzie."
  >
    <template #meta>
      <UBadge color="warning" variant="subtle" icon="i-lucide-flask-conical">
        Eksperyment
      </UBadge>
    </template>

    <ClientOnly>
      <ExperimentsDynamicContentEditorCanvas />
      <template #fallback>
        <div
          class="experiment-dynamic-content-editor-loading"
          aria-label="Ładowanie edytora dynamicznego contentu"
        >
          <USkeleton class="h-full w-full" />
        </div>
      </template>
    </ClientOnly>
  </CrmShell>
</template>

<style scoped>
.experiment-dynamic-content-editor-page {
  min-height: 0;
}

.experiment-dynamic-content-editor-loading {
  flex: 1;
  min-height: 0;
  padding: 16px;
}
</style>
