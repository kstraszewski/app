<script setup lang="ts">
import type { PortalCase, PortalPayload, PortalUser } from '~/types/portal'
import { clientCaseDataKey, clientPortalDataKey } from '~/utils/client-portal-cache'

// Keep the detail page as this directory's index so /multiform remains a
// sibling route instead of a child that would require a nested <NuxtPage>.
definePageMeta({
  middleware: 'client-auth',
  key: route => route.fullPath,
})

const route = useRoute()
const caseId = computed(() => String(route.params.caseId || ''))
const authenticatedUser = useAuthUser()
const userId = authenticatedUser.value?.id
const portalCache = useNuxtData<{ data: PortalPayload }>(clientPortalDataKey(userId))
const cachedCase = computed(() => portalCache.data.value?.data.cases.find(item => item.id === caseId.value))
const caseKey = clientCaseDataKey(userId, caseId.value)

const { data: caseResponse, status, error, refresh } = useFetch<{ data: PortalCase }>(
  () => `/api/client/cases/${encodeURIComponent(caseId.value)}`,
  {
    key: caseKey,
    dedupe: 'defer',
    lazy: true,
  },
)
if (!caseResponse.value && cachedCase.value) {
  caseResponse.value = { data: cachedCase.value }
}
const caseData = computed(() => {
  const requestedCase = caseResponse.value?.data
  if (requestedCase?.id === caseId.value) return requestedCase
  return cachedCase.value?.id === caseId.value ? cachedCase.value : undefined
})

const user = computed<PortalUser>(() => ({
  id: authenticatedUser.value?.id || '',
  name: authenticatedUser.value?.name || 'Klient OpenExpert',
  email: authenticatedUser.value?.email || '',
}))

useHead(() => ({
  title: caseData.value?.title
    ? `${caseData.value.title} — OpenExpert`
    : 'Sprawa — OpenExpert',
}))
</script>

<template>
  <PortalCaseScreen
    v-if="caseData?.id === caseId"
    :key="caseId"
    :case-data="caseData"
    :user="user"
  />

  <div v-else class="case-route-state">
    <PortalHeader :user-name="user.name" :user-email="user.email" />
    <main>
      <template v-if="status === 'pending' && !caseData">
        <USkeleton class="h-10 w-80 max-w-full" />
        <USkeleton class="mt-8 h-80 w-full" />
      </template>
      <UAlert
        v-else
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się otworzyć sprawy"
        :description="error ? 'Spróbuj ponownie. Jeśli problem wróci, skontaktuj się z ekspertem.' : 'Ta sprawa nie jest udostępniona temu kontu.'"
      >
        <template #actions>
          <UButton color="error" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
            Spróbuj ponownie
          </UButton>
        </template>
      </UAlert>
    </main>
  </div>
</template>

<style scoped>
.case-route-state {
  min-height: 100dvh;
  background: var(--ui-bg-muted);
}

.case-route-state main {
  width: min(900px, calc(100% - 32px));
  margin: 0 auto;
  padding: 80px 0 120px;
}
</style>
