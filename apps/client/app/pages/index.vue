<script setup lang="ts">
import type { PortalPayload } from '~/types/portal'
import { clientPortalDataKey, getClientSessionCachedData } from '~/utils/client-portal-cache'

definePageMeta({ middleware: 'client-auth' })

const authenticatedUser = useAuthUser()
const {
  data: response,
  status,
  error,
  refresh,
} = await usePortalFetch<{ data: PortalPayload }>('/api/client/portal', {
  key: clientPortalDataKey(authenticatedUser.value?.id),
  dedupe: 'defer',
  getCachedData: getClientSessionCachedData,
})

const payload = computed(() => response.value?.data)

useHead({ title: 'Co teraz — OpenExpert' })
</script>

<template>
  <PortalDashboardScreen v-if="payload" :payload="payload" />

  <div v-else class="portal-state-page">
    <PortalHeader
      :user-name="authenticatedUser?.name"
      :user-email="authenticatedUser?.email"
    />
    <main>
      <template v-if="status === 'pending'">
        <USkeleton class="h-12 w-72 max-w-full" />
        <USkeleton class="mt-3 h-5 w-96 max-w-full" />
        <div class="portal-state-page__skeleton">
          <USkeleton class="h-96 w-full" />
          <div class="portal-state-page__skeleton-row">
            <USkeleton class="h-52 w-full" />
            <USkeleton class="h-52 w-full" />
          </div>
        </div>
      </template>

      <UCard v-else-if="error" class="portal-state-card">
        <div class="portal-state-card__icon"><UIcon name="i-lucide-wifi-off" /></div>
        <h1>Nie udało się pobrać Twojego panelu</h1>
        <p>Połączenie zostało przerwane. Twoje dane są bezpieczne.</p>
        <UButton variant="solid" icon="i-lucide-refresh-cw" @click="refresh()">
          Spróbuj ponownie
        </UButton>
      </UCard>
    </main>
  </div>
</template>

<style scoped>
.portal-state-page {
  min-height: 100dvh;
  background: var(--ui-bg-muted);
}

.portal-state-page main {
  width: min(980px, calc(100% - 32px));
  margin: 0 auto;
  padding: 70px 0 120px;
}

.portal-state-page__skeleton {
  display: grid;
  gap: 20px;
  margin-top: 36px;
}

.portal-state-page__skeleton-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.portal-state-card,
.portal-state-card :deep(.divide-y) {
  display: grid;
  justify-items: center;
  gap: 18px;
  text-align: center;
}

.portal-state-card {
  padding: 34px;
  border-color: var(--ui-border-accented);
  background: var(--ui-bg);
}

.portal-state-card__icon {
  display: grid;
  width: 62px;
  height: 62px;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  color: var(--ui-text-highlighted);
}

.portal-state-card__icon svg {
  width: 27px;
  height: 27px;
}

.portal-state-card h1,
.portal-state-card p {
  margin: 0;
}

.portal-state-card h1 { font-size: 28px; }
.portal-state-card p { max-width: 500px; color: var(--ui-text-muted); font-size: 15px; }

@media (max-width: 640px) {
  .portal-state-page main { padding-top: 42px; }
  .portal-state-page__skeleton-row { grid-template-columns: 1fr; }
}
</style>
