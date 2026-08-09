<script setup lang="ts">
import type { AccountContexts, ClientAppointment } from '~/types/account'
import type { ClientMultiformCasesResponse } from '~/types/client-multiform'

definePageMeta({ middleware: 'client-auth', layout: false })

const route = useRoute()
const requestUrl = useRequestURL()
const authenticatedUser = useAuthUser()
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
const {
  data: multiformPayload,
  status: multiformStatus,
  error: multiformError,
  refresh: refreshMultiform,
} = await useFetch<ClientMultiformCasesResponse>('/api/client/multiform', {
  key: `client-multiform-cases:${accountCacheScope}`,
  default: () => ({ data: [] }),
})

const appointments = computed(() => appointmentPayload.value.data)
const multiformCases = computed(() => multiformPayload.value.data)
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
  title: 'Panel klienta — OpenExpert',
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

function multiformDate(value: string) {
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function isClientMeetingUrl(value: string | null) {
  if (!value) return false
  try {
    const url = new URL(value, requestUrl.origin)
    return url.origin === requestUrl.origin
      && /^\/client\/meetings\/[^/]+\/?$/u.test(url.pathname)
  } catch {
    return false
  }
}
</script>

<template>
  <ClientPortalShell
    title="Twój panel"
    description="Udostępnione sprawy, formularze Multiwniosku i terminy przypisane do Twojego potwierdzonego konta."
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

    <UAlert
      v-if="multiformError"
      class="mb-6"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać formularzy"
    >
      <template #actions>
        <UButton color="error" variant="soft" @click="refreshMultiform()">
          Spróbuj ponownie
        </UButton>
      </template>
    </UAlert>

    <section
      v-if="multiformStatus === 'pending' || multiformCases.length"
      id="multiwnioski"
      class="appointments-section client-multiform-section"
      aria-labelledby="client-multiform-title"
    >
      <div class="client-section-heading">
        <div>
          <p>Udostępnione przez eksperta</p>
          <h2 id="client-multiform-title">Multiwnioski do uzupełnienia</h2>
        </div>
        <UBadge v-if="multiformCases.length" color="primary" variant="subtle">
          {{ multiformCases.length }}
        </UBadge>
      </div>

      <div v-if="multiformStatus === 'pending'" class="appointments-grid">
        <USkeleton v-for="index in 2" :key="index" class="h-48 w-full" />
      </div>
      <div v-else class="appointments-grid">
        <UCard
          v-for="multiformCase in multiformCases"
          :key="multiformCase.id"
          class="appointment-card client-multiform-card"
        >
          <div class="appointment-card__top">
            <span class="appointment-card__date">{{ multiformCase.organization.name }}</span>
            <UBadge
              :color="multiformCase.completedAt ? 'success' : 'warning'"
              variant="subtle"
              :icon="multiformCase.completedAt ? 'i-lucide-circle-check' : 'i-lucide-pencil-line'"
            >
              {{ multiformCase.completedAt ? 'Przekazany' : 'Do uzupełnienia' }}
            </UBadge>
          </div>
          <h3>{{ multiformCase.title }}</h3>
          <p class="client-multiform-card__person">
            <UIcon name="i-lucide-user-round" />
            {{ multiformCase.applicantLabel }}
          </p>
          <small v-if="multiformCase.updatedAt">
            Ostatni zapis: {{ multiformDate(multiformCase.updatedAt) }}
          </small>
          <small v-else>
            Udostępniono: {{ multiformDate(multiformCase.sharedAt) }}
          </small>
          <UButton
            :to="`/client/multiform/${multiformCase.id}`"
            :icon="multiformCase.completedAt ? 'i-lucide-file-pen-line' : 'i-lucide-arrow-right'"
            trailing
          >
            {{ multiformCase.completedAt ? 'Sprawdź lub popraw' : 'Uzupełnij formularz' }}
          </UButton>
        </UCard>
      </div>
    </section>

    <div id="konsultacje" class="client-section-heading client-section-heading--appointments">
      <div>
        <p>Twój kalendarz</p>
        <h2>Moje konsultacje</h2>
      </div>
    </div>

    <div v-if="status === 'pending'" class="appointments-grid" aria-label="Ładowanie konsultacji">
      <USkeleton v-for="index in 2" :key="index" class="h-52 w-full" />
    </div>

    <OeEmptyState
      v-else-if="!appointments.length"
      icon="i-lucide-calendar-days"
      title="Nie masz jeszcze dodanych konsultacji"
      description="Po rezerwacji użyj przycisku „Aktywuj panel klienta”. Zweryfikujemy kontakt i dodamy właściwe terminy do tego widoku."
      title-tag="h2"
      surface="outline"
    >
      <template #actions>
        <UButton :href="expertsUrl" external icon="i-lucide-search">
          Znajdź eksperta
        </UButton>
      </template>
    </OeEmptyState>

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
                <dd class="appointment-expert">
                  <UAvatar
                    :src="appointment.expert?.avatarUrl || undefined"
                    :alt="appointment.expert?.name ?? 'Ekspert placówki'"
                    size="xs"
                  />
                  <span>{{ appointment.expert?.name ?? 'Ekspert placówki' }}</span>
                </dd>
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
              :href="appointment.meetingUrl || undefined"
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
            <p class="appointment-expert">
              <UAvatar
                :src="appointment.expert?.avatarUrl || undefined"
                :alt="appointment.expert?.name ?? 'Ekspert placówki'"
                size="xs"
              />
              <span>{{ appointment.expert?.name ?? 'Ekspert placówki' }}</span>
              · {{ appointment.meetingMode === 'online'
                ? 'Online'
                : appointment.facility?.name ?? appointment.organization?.name ?? 'Placówka' }}
            </p>
            <UButton
              v-if="appointment.status !== 'cancelled'
                && appointment.meetingMode === 'online'
                && isClientMeetingUrl(appointment.meetingUrl)"
              :href="appointment.meetingUrl || undefined"
              target="_blank"
              rel="noopener noreferrer"
              external
              color="neutral"
              variant="soft"
              icon="i-lucide-file-text"
            >
              Zobacz spotkanie
            </UButton>
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

.client-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.client-section-heading--appointments {
  margin: 38px 0 16px;
}

.client-section-heading p,
.client-section-heading h2 {
  margin: 0;
}

.client-section-heading p {
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.client-section-heading h2 {
  margin-top: 3px;
  color: var(--ui-text-highlighted);
  font-size: 20px;
}

.client-multiform-section {
  margin-bottom: 12px;
}

.client-multiform-card__person {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-toned);
  font-size: 14px;
}

.client-multiform-card small {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.appointment-expert {
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
