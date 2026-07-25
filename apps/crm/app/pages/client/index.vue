<script setup lang="ts">
import type { AccountContexts, ClientAppointment } from '~/types/account'

definePageMeta({ middleware: 'client-auth', layout: false })

const route = useRoute()
const authenticatedUser = useSupabaseUser()
const accountCacheScope = String(authenticatedUser.value?.sub ?? 'anonymous')
const runtimeConfig = useRuntimeConfig()
const landingBaseUrl = String(
  runtimeConfig.public.openexpert.landingBaseUrl || 'http://127.0.0.1:3003',
).replace(/\/+$/u, '')
const expertsUrl = `${landingBaseUrl}/eksperci`
const {
  data: appointmentPayload,
  status,
  error,
  refresh,
} = await useFetch<{ data: ClientAppointment[] }>('/api/client/appointments', {
  key: `client-appointments:${accountCacheScope}`,
  default: () => ({ data: [] }),
})
const { data: contexts } = await useFetch<AccountContexts>('/api/me/contexts', {
  key: `account-contexts:${accountCacheScope}`,
})

const appointments = computed(() => appointmentPayload.value.data)
const now = Date.now()
const upcomingAppointments = computed(() => appointments.value
  .filter(appointment => appointment.status !== 'cancelled'
    && new Date(appointment.endsAt).getTime() >= now)
  .sort((left, right) => left.startsAt.localeCompare(right.startsAt)))
const previousAppointments = computed(() => appointments.value
  .filter(appointment => appointment.status === 'cancelled'
    || new Date(appointment.endsAt).getTime() < now)
  .sort((left, right) => right.startsAt.localeCompare(left.startsAt)))

useHead({
  title: 'Moje konsultacje — OpenExpert',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

function dateLabel(appointment: ClientAppointment) {
  try {
    return new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: appointment.timezone,
    }).format(new Date(appointment.startsAt))
  } catch {
    return new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(appointment.startsAt))
  }
}

function addressLabel(appointment: ClientAppointment) {
  const facility = appointment.facility
  if (!facility) return ''
  return [
    facility.addressLine1,
    facility.addressLine2,
    [facility.postalCode, facility.city].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
}

function statusLabel(statusValue: string) {
  if (statusValue === 'confirmed') return 'Potwierdzona'
  if (statusValue === 'cancelled') return 'Anulowana'
  return 'Oczekuje'
}
</script>

<template>
  <ClientPortalShell
    title="Moje konsultacje"
    description="Terminy zarezerwowane na potwierdzony kontakt Twojego konta."
    :show-account-switcher="Boolean(contexts?.hasStaff)"
  >
    <UAlert
      v-if="route.query.claimed === '1'"
      class="mb-6"
      color="success"
      variant="subtle"
      icon="i-lucide-badge-check"
      title="Konsultacja została dodana"
      description="Od teraz zobaczysz tutaj wizyty powiązane z tym samym profilem klienta."
    />

    <UAlert
      v-if="error"
      class="mb-6"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać konsultacji"
    >
      <template #actions>
        <UButton color="error" variant="soft" @click="refresh()">
          Spróbuj ponownie
        </UButton>
      </template>
    </UAlert>

    <div v-if="status === 'pending'" class="appointments-grid" aria-label="Ładowanie konsultacji">
      <USkeleton v-for="index in 2" :key="index" class="h-52 w-full" />
    </div>

    <UCard v-else-if="!appointments.length" class="empty-state">
      <span class="empty-state__icon" aria-hidden="true">
        <UIcon name="i-lucide-calendar-days" />
      </span>
      <h2>Nie masz jeszcze dodanych konsultacji</h2>
      <p>
        Po rezerwacji użyj przycisku „Aktywuj panel klienta”. Zweryfikujemy kontakt
        i dodamy właściwe terminy do tego widoku.
      </p>
      <UButton :href="expertsUrl" external icon="i-lucide-search">
        Znajdź eksperta
      </UButton>
    </UCard>

    <template v-else>
      <section v-if="upcomingAppointments.length" class="appointments-section">
        <h2>Nadchodzące</h2>
        <div class="appointments-grid">
          <UCard
            v-for="appointment in upcomingAppointments"
            :key="appointment.id"
            class="appointment-card"
          >
            <div class="appointment-card__top">
              <span class="appointment-card__date">{{ dateLabel(appointment) }}</span>
              <UBadge
                :color="appointment.status === 'confirmed' ? 'success' : 'warning'"
                variant="subtle"
              >
                {{ statusLabel(appointment.status) }}
              </UBadge>
            </div>
            <h3>{{ appointment.service?.name ?? 'Konsultacja' }}</h3>
            <dl>
              <div>
                <dt><UIcon name="i-lucide-user-round" /> Ekspert</dt>
                <dd>{{ appointment.expert?.name ?? 'Ekspert placówki' }}</dd>
              </div>
              <div>
                <dt>
                  <UIcon :name="appointment.meetingMode === 'online' ? 'i-lucide-video' : 'i-lucide-building-2'" />
                  {{ appointment.meetingMode === 'online' ? 'Forma spotkania' : 'Placówka' }}
                </dt>
                <dd>
                  {{ appointment.meetingMode === 'online'
                    ? 'Spotkanie online'
                    : appointment.facility?.name ?? appointment.organization?.name ?? 'Placówka' }}
                  <small v-if="appointment.meetingMode === 'office' && addressLabel(appointment)">
                    {{ addressLabel(appointment) }}
                  </small>
                </dd>
              </div>
            </dl>
            <UButton
              v-if="appointment.meetingMode === 'online' && appointment.meetingUrl"
              :href="appointment.meetingUrl"
              target="_blank"
              rel="noopener noreferrer"
              external
              icon="i-lucide-video"
            >
              Dołącz do spotkania
            </UButton>
          </UCard>
        </div>
      </section>

      <section v-if="previousAppointments.length" class="appointments-section appointments-section--previous">
        <h2>Historia</h2>
        <div class="appointments-grid">
          <UCard
            v-for="appointment in previousAppointments"
            :key="appointment.id"
            class="appointment-card appointment-card--previous"
          >
            <div class="appointment-card__top">
              <span class="appointment-card__date">{{ dateLabel(appointment) }}</span>
              <UBadge
                :color="appointment.status === 'cancelled' ? 'error' : 'neutral'"
                variant="subtle"
              >
                {{ statusLabel(appointment.status) }}
              </UBadge>
            </div>
            <h3>{{ appointment.service?.name ?? 'Konsultacja' }}</h3>
            <p>
              {{ appointment.expert?.name ?? 'Ekspert placówki' }}
              · {{ appointment.meetingMode === 'online'
                ? 'Online'
                : appointment.facility?.name ?? appointment.organization?.name ?? 'Placówka' }}
            </p>
          </UCard>
        </div>
      </section>
    </template>
  </ClientPortalShell>
</template>

<style scoped>
.appointments-section {
  display: grid;
  gap: 16px;
  margin-bottom: 42px;
}

.appointments-section > h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
}

.appointments-section--previous {
  opacity: .78;
}

.appointments-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.appointment-card :deep(.divide-y) {
  display: grid;
  gap: 20px;
}

.appointment-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.appointment-card__date {
  color: var(--ui-primary);
  font-size: 13px;
  font-weight: 750;
  line-height: 1.45;
}

.appointment-card h3,
.appointment-card p {
  margin: 0;
}

.appointment-card h3 {
  color: var(--ui-text-highlighted);
  font-size: 21px;
  letter-spacing: -.02em;
}

.appointment-card dl {
  display: grid;
  gap: 13px;
  margin: 0;
}

.appointment-card dl div {
  display: grid;
  gap: 3px;
}

.appointment-card dt {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.appointment-card dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.appointment-card dd small {
  display: block;
  margin-top: 2px;
  color: var(--ui-text-toned);
}

.appointment-card--previous p {
  color: var(--ui-text-toned);
  font-size: 14px;
}

.empty-state {
  text-align: center;
}

.empty-state :deep(.divide-y) {
  display: grid;
  justify-items: center;
  gap: 14px;
  padding: 22px;
}

.empty-state__icon {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 18px;
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg-elevated));
  color: var(--ui-primary);
  font-size: 25px;
}

.empty-state h2,
.empty-state p {
  margin: 0;
}

.empty-state h2 {
  color: var(--ui-text-highlighted);
  font-size: 21px;
}

.empty-state p {
  max-width: 54ch;
  color: var(--ui-text-toned);
  line-height: 1.6;
}

@media (max-width: 700px) {
  .appointments-grid {
    grid-template-columns: 1fr;
  }
}
</style>
