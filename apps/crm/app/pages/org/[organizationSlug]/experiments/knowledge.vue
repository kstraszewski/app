<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'organization', 'experiments-access'],
  crmContentMode: 'workspace',
})

useHead({ title: 'Wiedza — Eksperymenty — OpenExpert CRM' })
</script>

<template>
  <CrmShell
    workspace
    class="experiment-knowledge-page"
    eyebrow="Eksperymenty"
    title="Wiedza"
    description="Jedno miejsce dla dokumentów tekstowych i interaktywnych stron."
  >
    <template #title-trailing>
      <UBadge color="warning" variant="subtle" icon="i-lucide-flask-conical">
        Eksperyment
      </UBadge>
    </template>

    <ClientOnly>
      <ExperimentsKnowledgeLibrary />
      <template #fallback>
        <div class="experiment-knowledge-loading" aria-label="Ładowanie biblioteki wiedzy">
          <USkeleton class="h-full w-full" />
        </div>
      </template>
    </ClientOnly>
  </CrmShell>
</template>

<style scoped>
.experiment-knowledge-page { min-height: 0; }
.experiment-knowledge-loading { flex: 1; min-height: 0; padding: 16px; }
</style>
