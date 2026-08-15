<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'organization'],
  path: 'settings/institution-files',
  alias: ['mortgages/files'],
  crmContentMode: 'wide',
})

useHead({ title: 'Dokumenty bankowe — Administracja systemu — OpenExpert' })

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
const uploadModalOpen = ref(false)

function openFileUpload() {
  uploadModalOpen.value = true
}
</script>

<template>
  <CrmShell
    compact
    full-bleed
    title="Dokumenty bankowe"
    eyebrow="Administracja systemu"
    description="Globalne repozytorium procedur, formularzy i materiałów źródłowych instytucji finansowych."
  >
    <template #actions>
      <UButton
        icon="i-lucide-file-plus-2"
        @click="openFileUpload"
      >
        Dodaj plik
      </UButton>
    </template>

    <MortgagesBankFileRepository
      v-model:upload-open="uploadModalOpen"
      class="bank-files--full-bleed"
      :organization-slug="organizationSlug"
      :initial-file-id="initialFileId"
      :initial-page="initialPage"
      :show-upload-action="false"
      title="Repozytorium dokumentów"
      description="Wyszukuj w nazwach i treści plików, filtruj po instytucji, produkcie i statusie oraz otwieraj podgląd bez opuszczania strony."
    />
  </CrmShell>
</template>
