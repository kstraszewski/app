<script setup lang="ts">
import type { PortalPayload } from '~/types/portal'
import { clientPortalDataKey, getClientSessionCachedData } from '~/utils/client-portal-cache'
import type {
  MeetingPreparationAnswers,
  PortalMeetingPreparation,
} from '#shared/types/meeting-preparation'

definePageMeta({ middleware: 'client-auth' })

const route = useRoute()
const authenticatedUser = useAuthUser()
const { $portalFetch } = useNuxtApp()
const {
  data: response,
  status: portalStatus,
  error: portalError,
  refresh: refreshPortal,
} = usePortalFetch<{ data: PortalPayload }>('/api/client/portal', {
  key: clientPortalDataKey(authenticatedUser.value?.id),
  dedupe: 'defer',
  getCachedData: getClientSessionCachedData,
  lazy: true,
})

const payload = computed(() => response.value?.data)
const requestedAppointmentId = computed(() => {
  const value = Array.isArray(route.query.appointmentId)
    ? route.query.appointmentId[0]
    : route.query.appointmentId
  return typeof value === 'string' ? value.trim() : ''
})
const preferredAppointmentId = computed(() => (
  requestedAppointmentId.value
  || (payload.value?.nextStep?.kind === 'prepare_appointment'
    ? payload.value.nextStep.appointmentId || ''
    : '')
))
const appointmentId = computed(() => {
  const id = preferredAppointmentId.value
  if (!id || !payload.value) return ''
  return payload.value.appointments?.some(appointment => appointment.id === id) ? id : ''
})

const preparationRequest = usePortalFetch<{ data: PortalMeetingPreparation }>(
  () => `/api/client/appointments/${encodeURIComponent(appointmentId.value || 'missing')}/preparation`,
  {
    key: `client-meeting-preparation:${authenticatedUser.value?.id || 'session'}`,
    dedupe: 'defer',
    immediate: false,
    watch: false,
  },
)

watch(appointmentId, (next, previous) => {
  if (!next) {
    if (previous) preparationRequest.clear()
    return
  }
  preparationRequest.clear()
  void preparationRequest.execute()
}, { immediate: true })

const preparation = computed(() => {
  const current = preparationRequest.data.value?.data
  return current?.appointmentId === appointmentId.value ? current : undefined
})
const pending = computed(() => (
  portalStatus.value === 'pending'
  || Boolean(appointmentId.value && (
    preparationRequest.status.value === 'idle'
    || preparationRequest.status.value === 'pending'
  ))
))
const unavailable = computed(() => Boolean(
  payload.value
  && portalStatus.value === 'success'
  && !appointmentId.value,
))

async function savePreparation(body: {
  answers: MeetingPreparationAnswers
  revision: number
  completed?: boolean
}): Promise<PortalMeetingPreparation> {
  const targetAppointmentId = appointmentId.value
  if (
    !targetAppointmentId
    || preparation.value?.appointmentId !== targetAppointmentId
  ) {
    throw new Error('Termin przygotowania zmienił się. Otwórz przygotowanie ponownie.')
  }

  const saved = await $portalFetch<{ data: PortalMeetingPreparation }>(
    `/api/client/appointments/${encodeURIComponent(targetAppointmentId)}/preparation`,
    { method: 'PUT', body },
  )
  if (appointmentId.value === targetAppointmentId) {
    preparationRequest.data.value = saved
  }
  return saved.data
}

function retry() {
  if (portalError.value) {
    void refreshPortal()
    return
  }
  if (appointmentId.value) void preparationRequest.execute()
}

useHead({ title: 'Przygotuj się do spotkania — OpenExpert' })
</script>

<template>
  <PortalMeetingPreparationScreen
    v-if="payload && appointmentId && preparation"
    :key="appointmentId"
    :payload="payload"
    :appointment-id="appointmentId"
    :preparation="preparation"
    :save="savePreparation"
  />

  <div v-else class="preparation-route-state">
    <PortalHeader
      :user-name="authenticatedUser?.name"
      :user-email="authenticatedUser?.email"
    />
    <main>
      <template v-if="pending">
        <USkeleton class="h-5 w-40 max-w-full" />
        <USkeleton class="mt-6 h-96 w-full" />
        <div class="preparation-route-state__grid">
          <USkeleton class="h-80 w-full" />
          <USkeleton class="h-96 w-full" />
        </div>
      </template>
      <UAlert
        v-else
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="unavailable ? 'Nie znaleźliśmy tego spotkania' : 'Nie udało się otworzyć przygotowania'"
        :description="unavailable
          ? 'Otwórz przygotowanie z kafla najbliższego spotkania albo wróć do panelu.'
          : 'Nie pobraliśmy zapisanych odpowiedzi. Spróbuj ponownie — nie nadpiszemy ich pustym formularzem.'"
      >
        <template #actions>
          <UButton
            v-if="!unavailable"
            color="error"
            variant="outline"
            icon="i-lucide-refresh-cw"
            @click="retry"
          >
            Pobierz ponownie
          </UButton>
          <UButton v-else to="/" color="error" variant="outline" icon="i-lucide-arrow-left">
            Wróć do panelu
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
