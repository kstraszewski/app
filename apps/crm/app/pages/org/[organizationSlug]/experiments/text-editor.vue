<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'organization', 'experiments-access'],
  crmContentMode: 'workspace',
})

useHead({ title: 'Edytor tekstu — Eksperymenty — OpenExpert CRM' })
</script>

<template>
  <CrmShell
    workspace
    class="experiment-text-editor-page"
    eyebrow="Eksperymenty"
    title="Edytor tekstu"
    description="Pisz samodzielnie albo pracuj nad tekstem razem z Eve."
  >
    <template #meta>
      <UBadge color="warning" variant="subtle" icon="i-lucide-flask-conical">
        Eksperyment
      </UBadge>
    </template>

    <ClientOnly>
      <ExperimentsTextEditorCanvas />
      <template #fallback>
        <div class="experiment-text-editor-loading" aria-label="Ładowanie edytora">
          <USkeleton class="h-full w-full" />
        </div>
      </template>
    </ClientOnly>
  </CrmShell>
</template>

<style scoped>
.experiment-text-editor-page {
  min-height: 0;
}

.experiment-text-editor-loading {
  flex: 1;
  min-height: 0;
  padding: 16px;
}
</style>
