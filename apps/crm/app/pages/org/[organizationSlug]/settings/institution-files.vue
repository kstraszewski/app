<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'organization'],
  path: 'settings/institution-files',
  alias: ['mortgages/files'],
})

useHead({ title: 'Pliki z banków — OpenExpert' })

const route = useRoute()
const organizationSlug = computed(() => String(route.params.organizationSlug ?? ''))
const institutionsPath = computed(() => `/org/${organizationSlug.value}/settings/institutions`)
const productsPath = computed(() => `/org/${organizationSlug.value}/settings/products`)
const repositoryPath = computed(() => `/org/${organizationSlug.value}/settings/institution-files`)
const mortgagesPath = computed(() => `/org/${organizationSlug.value}/mortgages`)

const tabs = computed(() => [
  { label: 'Instytucje', to: institutionsPath.value, icon: 'i-lucide-landmark' },
  { label: 'Produkty', to: productsPath.value, icon: 'i-lucide-package-search' },
  { label: 'Pliki z banków', to: repositoryPath.value, icon: 'i-lucide-folder-search-2' },
])
</script>

<template>
  <CrmShell
    title="Pliki z banków"
    eyebrow="Ustawienia administracyjne"
    description="Wspólne repozytorium procedur, formularzy i materiałów źródłowych instytucji finansowych."
    :tabs="tabs"
  >
    <template #actions>
      <UButton
        :to="mortgagesPath"
        color="neutral"
        variant="outline"
        icon="i-lucide-calculator"
      >
        Porównywarka
      </UButton>
    </template>

    <MortgagesBankFileRepository
      :organization-slug="organizationSlug"
      title="Repozytorium dokumentów"
      description="Wyszukuj w nazwach i treści plików, filtruj po instytucji, produkcie i statusie oraz otwieraj podgląd bez opuszczania strony."
    />
  </CrmShell>
</template>
