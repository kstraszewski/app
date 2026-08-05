<script setup lang="ts">
import type {
  PortalCase,
  PortalMultiformAnswers,
  PortalMultiformDraft,
  PortalMultiformPayload,
  PortalPayload,
  PortalUser,
} from '~/types/portal'
import {
  clientCaseDataKey,
  clientMultiformDataKey,
  clientPortalDataKey,
} from '~/utils/client-portal-cache'

definePageMeta({
  middleware: 'client-auth',
  key: route => route.fullPath,
})

const route = useRoute()
const caseId = computed(() => String(route.params.caseId || ''))
const authenticatedUser = useAuthUser()
const { $portalFetch } = useNuxtApp()
const userId = authenticatedUser.value?.id
const portalCache = useNuxtData<{ data: PortalPayload }>(clientPortalDataKey(userId))
const cachedCase = computed(() => portalCache.data.value?.data.cases.find(item => item.id === caseId.value))
const caseKey = clientCaseDataKey(userId, caseId.value)
const multiformKey = clientMultiformDataKey(userId, caseId.value)

const caseRequest = usePortalFetch<{ data: PortalCase }>(
  () => `/api/client/cases/${encodeURIComponent(caseId.value)}`,
  {
    key: caseKey,
    dedupe: 'defer',
    lazy: true,
  },
)
if (!caseRequest.data.value && cachedCase.value) {
  caseRequest.data.value = { data: cachedCase.value }
}
const multiformRequest = usePortalFetch<{ data: PortalMultiformPayload }>(
  () => `/api/client/cases/${encodeURIComponent(caseId.value)}/multiform`,
  {
    key: multiformKey,
    dedupe: 'defer',
    lazy: true,
  },
)

const caseData = computed(() => {
  const requestedCase = caseRequest.data.value?.data
  if (requestedCase?.id === caseId.value) return requestedCase
  return cachedCase.value?.id === caseId.value ? cachedCase.value : undefined
})
const user = computed<PortalUser>(() => ({
  id: authenticatedUser.value?.id || '',
  name: authenticatedUser.value?.name || 'Klient OpenExpert',
  email: authenticatedUser.value?.email || '',
}))
const pending = computed(() => (
  (!caseData.value && caseRequest.status.value === 'pending')
  || multiformRequest.status.value === 'pending'
))
const failed = computed(() => caseRequest.error.value || multiformRequest.error.value)

async function save(body: {
  answers: PortalMultiformAnswers
  step: number
  revision: number
  completed?: boolean
}): Promise<PortalMultiformDraft> {
  const loadedCaseId = caseData.value?.id
  if (
    !loadedCaseId
    || loadedCaseId !== caseId.value
    || multiformRequest.status.value !== 'success'
  ) {
    throw new Error('Sprawa formularza zmieniła się. Otwórz formularz ponownie.')
  }
  const response = await $portalFetch<{ data: PortalMultiformPayload }>(
    `/api/client/cases/${encodeURIComponent(loadedCaseId)}/multiform`,
    { method: 'PUT', body },
  )
  if (!response.data.draft) throw new Error('Missing updated multiform draft')
  if (
    caseId.value === loadedCaseId
    && caseData.value?.id === loadedCaseId
    && multiformRequest.data.value?.data
  ) {
    multiformRequest.data.value.data.draft = response.data.draft
  }
  if (body.completed) {
    clearNuxtData(clientPortalDataKey(authenticatedUser.value?.id))
    void refreshNuxtData(clientCaseDataKey(authenticatedUser.value?.id, loadedCaseId))
  }
  return response.data.draft
}

useHead({ title: 'Formularz Multiwniosku — OpenExpert' })
</script>

<template>
  <PortalMultiformScreen
    v-if="
      !pending
        && multiformRequest.status.value === 'success'
        && caseData?.id === caseId
        && multiformRequest.data.value?.data
    "
    :key="caseId"
    :case-data="caseData"
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
