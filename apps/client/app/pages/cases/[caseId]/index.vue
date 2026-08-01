<script setup lang="ts">
import type { PortalCase, PortalPayload } from '~/types/portal'

// Keep the detail page as this directory's index so /multiform remains a
// sibling route instead of a child that would require a nested <NuxtPage>.
definePageMeta({
  middleware: 'client-auth',
  key: route => route.fullPath,
})

const route = useRoute()
const caseId = computed(() => String(route.params.caseId || ''))
const { data: caseResponse, status, error, refresh } = await useFetch<{ data: PortalCase }>(
  () => `/api/client/cases/${encodeURIComponent(caseId.value)}`,
  { key: `client-case:${caseId.value}` },
)
const { data: portalResponse } = await useFetch<{ data: PortalPayload }>('/api/client/portal', {
  key: 'client-portal:case-user',
})

const fallbackUser = useAuthUser()
const user = computed(() => portalResponse.value?.data.user || {
  id: fallbackUser.value?.id || '',
  name: fallbackUser.value?.name || 'Klient OpenExpert',
  email: fallbackUser.value?.email || '',
})

useHead(() => ({
  title: caseResponse.value?.data.title
    ? `${caseResponse.value.data.title} — OpenExpert`
    : 'Sprawa — OpenExpert',
}))
</script>

<template>
  <PortalCaseScreen
    v-if="status === 'success' && caseResponse?.data?.id === caseId"
    :key="caseId"
    :case-data="caseResponse.data"
    :user="user"
  />

  <div v-else class="case-route-state">
    <PortalHeader :user-name="user.name" :user-email="user.email" />
    <main>
      <template v-if="status === 'pending'">
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
