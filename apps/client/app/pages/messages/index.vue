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
} = await useFetch<{ data: PortalPayload }>('/api/client/portal', {
  key: clientPortalDataKey(authenticatedUser.value?.id),
  dedupe: 'defer',
  getCachedData: getClientSessionCachedData,
})

const payload = computed(() => response.value?.data)
useHead({ title: 'Wiadomości — OpenExpert' })
</script>

<template>
  <PortalMessagesScreen v-if="payload" :payload="payload" />

  <div v-else class="messages-route-state">
    <PortalHeader
      :user-name="authenticatedUser?.name"
      :user-email="authenticatedUser?.email"
    />
    <main>
      <template v-if="status === 'pending'">
        <USkeleton class="h-12 w-64 max-w-full" />
        <USkeleton class="mt-7 h-[560px] w-full" />
      </template>
      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się otworzyć wiadomości"
        description="Spróbuj ponownie za chwilę."
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
.messages-route-state {
  min-height: 100dvh;
  background: var(--ui-bg-muted);
}

.messages-route-state main {
  width: min(1000px, calc(100% - 32px));
  margin: 0 auto;
  padding: 56px 0 var(--portal-mobile-nav-clearance);
}
</style>
