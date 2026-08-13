<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'organization'],
  path: 'settings/institution-files',
  alias: ['mortgages/files'],
  crmContentMode: 'wide',
})

useHead({ title: 'Pliki z banków — OpenExpert' })

const route = useRoute()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const initialFileId = computed(() => {
  const value = Array.isArray(route.query.file) ? route.query.file[0] : route.query.file
  return typeof value === 'string' && value ? value : null
})
const initialPage = computed(() => {
  const value = Array.isArray(route.query.page) ? route.query.page[0] : route.query.page
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : null
})
const calculatorPath = computed(() => `/org/${organizationSlug.value}/calculator/mortgages`)
</script>

<template>
  <CrmShell
    title="Pliki z banków"
    eyebrow="Ustawienia administracyjne"
    description="Wspólne repozytorium procedur, formularzy i materiałów źródłowych instytucji finansowych."
  >
    <template #actions>
      <UButton
        :to="calculatorPath"
        color="neutral"
        variant="outline"
        icon="i-lucide-calculator"
      >
        Porównywarka
      </UButton>
    </template>

    <MortgagesBankFileRepository
      :organization-slug="organizationSlug"
      :initial-file-id="initialFileId"
      :initial-page="initialPage"
      title="Repozytorium dokumentów"
      description="Wyszukuj w nazwach i treści plików, filtruj po instytucji, produkcie i statusie oraz otwieraj podgląd bez opuszczania strony."
    />
  </CrmShell>
</template>
