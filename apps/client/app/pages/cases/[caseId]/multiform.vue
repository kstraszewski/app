<script setup lang="ts">
import type {
  PortalCase,
  PortalMultiformAnswers,
  PortalMultiformDraft,
  PortalMultiformPayload,
  PortalPayload,
} from '~/types/portal'

definePageMeta({
  middleware: 'client-auth',
  key: route => route.fullPath,
})

const route = useRoute()
const caseId = computed(() => String(route.params.caseId || ''))

const [caseRequest, multiformRequest, portalRequest] = await Promise.all([
  useFetch<{ data: PortalCase }>(
    () => `/api/client/cases/${encodeURIComponent(caseId.value)}`,
    { key: `client-multiform-case:${caseId.value}` },
  ),
  useFetch<{ data: PortalMultiformPayload }>(
    () => `/api/client/cases/${encodeURIComponent(caseId.value)}/multiform`,
    { key: `client-multiform:${caseId.value}` },
  ),
  useFetch<{ data: PortalPayload }>('/api/client/portal', {
    key: 'client-portal:multiform-user',
  }),
])

const user = computed(() => portalRequest.data.value?.data.user || {
  id: useAuthUser().value?.id || '',
  name: useAuthUser().value?.name || 'Klient OpenExpert',
  email: useAuthUser().value?.email || '',
})
const pending = computed(() => caseRequest.status.value === 'pending'
  || multiformRequest.status.value === 'pending')
const failed = computed(() => caseRequest.error.value || multiformRequest.error.value)

async function save(body: {
  answers: PortalMultiformAnswers
  step: number
  revision: number
  completed?: boolean
}): Promise<PortalMultiformDraft> {
  const loadedCaseId = caseRequest.data.value?.data.id
  if (
    !loadedCaseId
    || loadedCaseId !== caseId.value
    || caseRequest.status.value !== 'success'
    || multiformRequest.status.value !== 'success'
  ) {
    throw new Error('Sprawa formularza zmieniła się. Otwórz formularz ponownie.')
  }
  const response = await $fetch<{ data: PortalMultiformPayload }>(
    `/api/client/cases/${encodeURIComponent(loadedCaseId)}/multiform`,
    { method: 'PUT', body },
  )
  if (!response.data.draft) throw new Error('Missing updated multiform draft')
  if (
    caseId.value === loadedCaseId
    && caseRequest.data.value?.data.id === loadedCaseId
    && multiformRequest.data.value?.data
  ) {
    multiformRequest.data.value.data.draft = response.data.draft
  }
  return response.data.draft
}

useHead({ title: 'Formularz Multiwniosku — OpenExpert' })
</script>

<template>
  <PortalMultiformScreen
    v-if="
      !pending
        && caseRequest.status.value === 'success'
        && multiformRequest.status.value === 'success'
        && caseRequest.data.value?.data.id === caseId
        && multiformRequest.data.value?.data
    "
    :key="caseId"
    :case-data="caseRequest.data.value.data"
    :user="user"
    :payload="multiformRequest.data.value.data"
    :save="save"
  />

  <div v-else class="multiform-route-state">
    <PortalHeader :user-name="user.name" :user-email="user.email" />
    <main>
      <template v-if="pending">
        <USkeleton class="h-10 w-96 max-w-full" />
        <USkeleton class="mt-8 h-96 w-full" />
      </template>
      <UAlert
        v-else
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się otworzyć formularza"
        :description="failed ? 'Spróbuj ponownie lub wróć do aktualności sprawy.' : 'Formularz nie jest dostępny.'"
      >
        <template #actions>
          <UButton :to="`/cases/${encodeURIComponent(caseId)}`" color="error" variant="outline">
            Wróć do sprawy
          </UButton>
        </template>
      </UAlert>
    </main>
  </div>
</template>

<style scoped>
.multiform-route-state {
  min-height: 100dvh;
  background: var(--ui-bg-muted);
}

.multiform-route-state main {
  width: min(900px, calc(100% - 32px));
  margin: 0 auto;
  padding: 70px 0;
}
</style>
