<script setup lang="ts">
import type { PortalPayload } from '~/types/portal'

definePageMeta({ middleware: 'client-auth' })

const authenticatedUser = useAuthUser()
const {
  data: response,
  status,
  error,
  refresh,
} = await useFetch<{ data: PortalPayload }>('/api/client/portal', {
  key: `client-meeting-preparation:${authenticatedUser.value?.id || 'session'}`,
})

const payload = computed(() => response.value?.data)

useHead({ title: 'Przygotuj się do spotkania — OpenExpert' })
</script>

<template>
  <PortalMeetingPreparationScreen v-if="payload" :payload="payload" />

  <div v-else class="preparation-route-state">
    <PortalHeader
      :user-name="authenticatedUser?.name"
      :user-email="authenticatedUser?.email"
    />
    <main>
      <template v-if="status === 'pending'">
        <USkeleton class="h-5 w-40 max-w-full" />
        <USkeleton class="mt-6 h-96 w-full" />
        <div class="preparation-route-state__grid">
          <USkeleton class="h-80 w-full" />
          <USkeleton class="h-96 w-full" />
        </div>
      </template>
      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Nie udało się otworzyć przygotowania"
        description="Twoje zapisane odpowiedzi pozostają na tym urządzeniu. Spróbuj ponownie."
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
.preparation-route-state {
  min-height: 100dvh;
  background: var(--ui-bg-muted);
}

.preparation-route-state main {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
  padding: 48px 0 100px;
}

.preparation-route-state__grid {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 20px;
  margin-top: 24px;
}

@media (max-width: 760px) {
  .preparation-route-state main { width: calc(100% - 32px); }
  .preparation-route-state__grid { grid-template-columns: 1fr; }
}
</style>
