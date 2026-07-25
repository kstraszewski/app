<script setup lang="ts">
import type {
  ClientMeeting,
  ClientMeetingResponse,
  ClientMeetingSharedOffer,
} from '~/types/account'

definePageMeta({
  middleware: 'client-auth',
  layout: false,
  validate: route => typeof route.params.appointmentId === 'string'
    && route.params.appointmentId.trim().length > 0,
})

const route = useRoute()
const authenticatedUser = useSupabaseUser()
const appointmentId = computed(() => String(route.params.appointmentId))
const accountCacheScope = String(authenticatedUser.value?.sub ?? 'anonymous')
const meetingUrl = computed(
  () => `/api/client/meetings/${encodeURIComponent(appointmentId.value)}`,
)

const {
  data: meetingPayload,
  status: requestStatus,
  error,
  refresh,
} = await useFetch<ClientMeetingResponse>(meetingUrl, {
  key: `client-meeting:${accountCacheScope}:${appointmentId.value}`,
})

const meeting = computed(() => meetingPayload.value?.data ?? null)
const shouldPoll = computed(
  () => meeting.value?.status === 'scheduled' || meeting.value?.status === 'live',
)
const isRefreshing = ref(false)
let pollTimer: ReturnType<typeof setInterval> | undefined

const currency = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})
const percent = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const processSteps = [
  {
    id: 'needs',
    label: 'Potrzeby i możliwości',
    summary: 'Wspólnie ustalacie cel, budżet, wkład własny i bezpieczny poziom miesięcznej raty.',
  },
  {
    id: 'comparison',
    label: 'Porównanie ofert',
    summary: 'Ekspert porównuje te same założenia w wybranych bankach i wyjaśnia koszty oraz warunki.',
  },
  {
    id: 'documents',
    label: 'Dokumenty i wniosek',
    summary: 'Kompletujecie dokumenty dotyczące dochodu i nieruchomości, a następnie przygotowujecie wnioski.',
  },
  {
    id: 'analysis',
    label: 'Analiza banku',
    summary: 'Ekspert monitoruje analizę banku, odpowiada na pytania i pomaga uzupełnić ewentualne braki.',
  },
  {
    id: 'agreement',
    label: 'Decyzja i umowa',
    summary: 'Porównujecie decyzje, sprawdzacie warunki umowy i planujecie uruchomienie kredytu.',
  },
] as const

const activeProcessIndex = computed(() => {
  const stepId = meeting.value?.shared.processStepId
  const index = processSteps.findIndex(step => step.id === stepId)
  return index >= 0 ? index : 0
})
const activeProcessStep = computed(() => processSteps[activeProcessIndex.value])
const sharedOffers = computed(() => meeting.value?.shared.offers ?? [])
const hasSharedContent = computed(
  () => meeting.value?.shared.kind !== 'none',
)

useHead({
  title: computed(() => {
    if (!meeting.value) return 'Spotkanie — OpenExpert'
    const serviceName = meeting.value.service?.name ?? 'Spotkanie'
    return `${serviceName} — OpenExpert`
  }),
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

onMounted(() => {
  pollTimer = setInterval(async () => {
    if (!shouldPoll.value || isRefreshing.value || document.visibilityState === 'hidden') {
      return
    }

    isRefreshing.value = true
    try {
      await refresh()
    } finally {
      isRefreshing.value = false
    }
  }, 3000)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})

function meetingDateLabel(value: ClientMeeting) {
  try {
    return new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: value.timezone,
    }).format(new Date(value.startsAt))
  } catch {
    return new Intl.DateTimeFormat('pl-PL', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(new Date(value.startsAt))
  }
}

function sharedAtLabel(value: string | null) {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: meeting.value?.timezone,
    }).format(new Date(value))
  } catch {
    return ''
  }
}

function money(value: number) {
  return currency.format(Number.isFinite(value) ? value : 0)
}

function aprLabel(offer: ClientMeetingSharedOffer) {
  return offer.representativeAprPct == null
    ? 'Brak danych'
    : `${percent.format(offer.representativeAprPct)}%`
}
</script>

<template>
  <ClientPortalShell
    eyebrow="Bezpieczne spotkanie"
    :title="meeting?.service?.name ?? 'Spotkanie z ekspertem'"
    :description="meeting
      ? `${meetingDateLabel(meeting)} · ${meeting.organization?.name ?? 'OpenExpert'}`
      : 'Ładowanie szczegółów spotkania.'"
  >
    <UAlert
      v-if="error"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się otworzyć spotkania"
      description="Sprawdź, czy korzystasz z właściwego konta klienta, i spróbuj ponownie."
    >
      <template #actions>
        <UButton color="error" variant="soft" @click="refresh()">
          Spróbuj ponownie
        </UButton>
      </template>
    </UAlert>

    <div v-else-if="requestStatus === 'pending' && !meeting" class="meeting-loading" aria-label="Ładowanie spotkania">
      <USkeleton class="h-24 w-full" />
      <USkeleton class="h-80 w-full" />
    </div>

    <template v-else-if="meeting">
      <section class="meeting-status" :class="`meeting-status--${meeting.status}`">
        <span class="meeting-status__icon" aria-hidden="true">
          <UIcon
            :name="meeting.status === 'live'
              ? 'i-lucide-radio'
              : meeting.status === 'ended'
                ? 'i-lucide-circle-check'
                : 'i-lucide-calendar-clock'"
          />
        </span>
        <div>
          <span class="meeting-status__eyebrow">
            {{ meeting.status === 'live'
              ? 'Spotkanie trwa'
              : meeting.status === 'ended'
                ? 'Spotkanie zakończone'
                : 'Spotkanie zaplanowane' }}
          </span>
          <strong>
            {{ meeting.expert?.name ?? 'Twój ekspert' }}
          </strong>
          <small v-if="meeting.status === 'scheduled'">
            Ta strona automatycznie pokaże spotkanie, gdy ekspert je rozpocznie.
          </small>
          <small v-else-if="meeting.status === 'live'">
            Materiały udostępniane przez eksperta pojawiają się poniżej.
          </small>
          <small v-else>
            Poniżej znajdziesz materiały pozostawione przez eksperta.
          </small>
        </div>
        <UBadge
          :color="meeting.status === 'live'
            ? 'success'
            : meeting.status === 'ended'
              ? 'neutral'
              : 'primary'"
          variant="subtle"
        >
          {{ meeting.status === 'live'
            ? 'Na żywo'
            : meeting.status === 'ended'
              ? 'Zakończone'
              : 'Oczekiwanie' }}
        </UBadge>
      </section>

      <UCard v-if="meeting.status === 'scheduled'" class="waiting-card">
        <div class="waiting-card__content">
          <span class="waiting-card__symbol" aria-hidden="true">
            <UIcon name="i-lucide-clock-3" />
          </span>
          <div>
            <h2>Wszystko gotowe</h2>
            <p>
              Możesz pozostawić tę kartę otwartą. Nie musisz instalować dodatkowej
              aplikacji ani ponownie otwierać linku.
            </p>
          </div>
          <dl>
            <div>
              <dt>Termin</dt>
              <dd>{{ meetingDateLabel(meeting) }}</dd>
            </div>
            <div>
              <dt>Prowadzący</dt>
              <dd>{{ meeting.expert?.name ?? 'Ekspert OpenExpert' }}</dd>
            </div>
            <div>
              <dt>Temat</dt>
              <dd>{{ meeting.service?.name ?? 'Konsultacja' }}</dd>
            </div>
          </dl>
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            :loading="isRefreshing"
            @click="refresh()"
          >
            Sprawdź teraz
          </UButton>
        </div>
      </UCard>

      <section v-else class="shared-workspace">
        <header class="shared-workspace__header">
          <div>
            <span>Materiały od eksperta</span>
            <h2>
              {{ meeting.shared.kind === 'mortgage-process'
                ? 'Twoja droga do kredytu'
                : meeting.shared.kind === 'mortgage-offers'
                  ? 'Wybrane oferty'
                  : meeting.status === 'ended'
                    ? 'Brak pozostawionych materiałów'
                    : 'Ekspert przygotowuje materiały' }}
            </h2>
          </div>
          <small v-if="meeting.shared.updatedAt">
            Zaktualizowano o {{ sharedAtLabel(meeting.shared.updatedAt) }}
          </small>
        </header>

        <div v-if="!hasSharedContent" class="shared-empty">
          <span aria-hidden="true"><UIcon name="i-lucide-panels-top-left" /></span>
          <h3>
            {{ meeting.status === 'ended'
              ? 'Podczas spotkania nie udostępniono materiałów'
              : 'Tutaj zobaczysz wybrane informacje' }}
          </h3>
          <p v-if="meeting.status === 'live'">
            Ekspert udostępni tylko te informacje, które są potrzebne do rozmowy.
            Pozostałe dane sprawy pozostają niewidoczne.
          </p>
        </div>

        <div v-else-if="meeting.shared.kind === 'mortgage-process'" class="process-view">
          <div class="process-view__current">
            <span>Krok {{ activeProcessIndex + 1 }} z {{ processSteps.length }}</span>
            <h3>{{ activeProcessStep?.label }}</h3>
            <p>{{ activeProcessStep?.summary }}</p>
          </div>
          <ol class="process-steps" aria-label="Etapy procesu kredytowego">
            <li
              v-for="(step, index) in processSteps"
              :key="step.id"
              :class="{
                'is-current': index === activeProcessIndex,
                'is-complete': index < activeProcessIndex,
              }"
            >
              <span aria-hidden="true">
                <UIcon v-if="index < activeProcessIndex" name="i-lucide-check" />
                <template v-else>{{ index + 1 }}</template>
              </span>
              <div>
                <strong>{{ step.label }}</strong>
                <small v-if="index === activeProcessIndex">Omawiacie teraz</small>
              </div>
            </li>
          </ol>
        </div>

        <div v-else-if="meeting.shared.kind === 'mortgage-offers'" class="offers-view">
          <UAlert
            v-if="!sharedOffers.length"
            color="neutral"
            variant="subtle"
            icon="i-lucide-info"
            title="Ekspert nie opublikował jeszcze szczegółów ofert"
          />
          <template v-else>
            <p class="offers-view__intro">
              Poniżej widzisz wyłącznie warianty wybrane do wspólnego omówienia.
              Zapytaj eksperta o warunki, które mają dla Ciebie największe znaczenie.
            </p>
            <div class="offer-grid">
              <article
                v-for="offer in sharedOffers"
                :key="offer.id"
                class="offer-card"
              >
                <header>
                  <span>{{ offer.bankName }}</span>
                  <h3>{{ offer.productName }}</h3>
                  <UBadge
                    v-if="offer.calculationStatus === 'partial'"
                    class="mt-2 w-fit"
                    color="warning"
                    variant="subtle"
                    size="xs"
                    icon="i-lucide-circle-alert"
                  >
                    Warunki i koszty do potwierdzenia
                  </UBadge>
                </header>
                <div class="offer-card__primary">
                  <span>Pierwsza rata</span>
                  <strong>{{ money(offer.firstInstallment) }}</strong>
                  <small>
                    {{ money(offer.firstMonthlyOutflow) }} pierwszego miesięcznego wypływu
                  </small>
                </div>
                <dl>
                  <div>
                    <dt>Koszt pierwszych 5 lat</dt>
                    <dd>{{ money(offer.costFirstFiveYears) }}</dd>
                  </div>
                  <div>
                    <dt>Łączny koszt</dt>
                    <dd>{{ money(offer.totalCost) }}</dd>
                  </div>
                  <div>
                    <dt>RRSO reprezentatywne</dt>
                    <dd>{{ aprLabel(offer) }}</dd>
                  </div>
                </dl>
              </article>
            </div>
            <p class="offers-view__note">
              Wartości zależą od przyjętych założeń i dostępnych danych. Nie są
              decyzją kredytową ani wiążącą ofertą banku.
            </p>
          </template>
        </div>
      </section>
    </template>
  </ClientPortalShell>
</template>

<style scoped>
.meeting-loading {
  display: grid;
  gap: 18px;
}

.meeting-status {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  margin-bottom: 18px;
  padding: 18px 20px;
  background: var(--ui-bg-elevated);
}

.meeting-status--live {
  border-color: color-mix(in srgb, var(--ui-success) 28%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-success) 5%, var(--ui-bg-elevated));
}

.meeting-status__icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 13px;
  background: color-mix(in srgb, var(--ui-primary) 11%, var(--ui-bg));
  color: var(--ui-primary);
  font-size: 20px;
}

.meeting-status--live .meeting-status__icon {
  background: color-mix(in srgb, var(--ui-success) 12%, var(--ui-bg));
  color: var(--ui-success);
}

.meeting-status > div {
  display: grid;
  gap: 2px;
}

.meeting-status__eyebrow {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.meeting-status strong {
  color: var(--ui-text-highlighted);
  font-size: 17px;
}

.meeting-status small {
  color: var(--ui-text-toned);
  line-height: 1.5;
}

.waiting-card :deep(.divide-y) {
  display: block;
}

.waiting-card__content {
  display: grid;
  justify-items: center;
  gap: 20px;
  padding: clamp(24px, 5vw, 50px);
  text-align: center;
}

.waiting-card__symbol {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  border-radius: 22px;
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg-elevated));
  color: var(--ui-primary);
  font-size: 28px;
}

.waiting-card h2,
.waiting-card p {
  margin: 0;
}

.waiting-card h2 {
  color: var(--ui-text-highlighted);
  font-size: 26px;
  letter-spacing: -.025em;
}

.waiting-card p {
  max-width: 55ch;
  color: var(--ui-text-toned);
  line-height: 1.65;
}

.waiting-card dl {
  display: grid;
  width: min(100%, 680px);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-block: 1px solid var(--ui-border);
  margin: 4px 0;
  padding: 18px 0;
}

.waiting-card dl div {
  display: grid;
  align-content: start;
  gap: 5px;
  padding: 0 18px;
}

.waiting-card dl div + div {
  border-left: 1px solid var(--ui-border);
}

.waiting-card dt,
.waiting-card dd {
  margin: 0;
}

.waiting-card dt {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.waiting-card dd {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  line-height: 1.45;
}

.shared-workspace {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 20px;
  background: var(--ui-bg-elevated);
}

.shared-workspace__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  border-bottom: 1px solid var(--ui-border);
  padding: 22px 24px;
}

.shared-workspace__header > div {
  display: grid;
  gap: 3px;
}

.shared-workspace__header span {
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.shared-workspace__header h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 25px;
  letter-spacing: -.025em;
}

.shared-workspace__header small {
  color: var(--ui-text-muted);
  white-space: nowrap;
}

.shared-empty {
  display: grid;
  min-height: 340px;
  align-content: center;
  justify-items: center;
  gap: 10px;
  padding: 40px 24px;
  text-align: center;
}

.shared-empty > span {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 18px;
  background: var(--ui-bg);
  color: var(--ui-text-muted);
  font-size: 25px;
}

.shared-empty h3,
.shared-empty p {
  margin: 0;
}

.shared-empty h3 {
  color: var(--ui-text-highlighted);
  font-size: 20px;
}

.shared-empty p {
  max-width: 54ch;
  color: var(--ui-text-toned);
  line-height: 1.65;
}

.process-view {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, .8fr);
  gap: 40px;
  padding: clamp(24px, 5vw, 46px);
}

.process-view__current {
  display: grid;
  align-content: start;
  gap: 10px;
}

.process-view__current > span {
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.process-view__current h3,
.process-view__current p {
  margin: 0;
}

.process-view__current h3 {
  color: var(--ui-text-highlighted);
  font-size: clamp(28px, 5vw, 40px);
  font-weight: 500;
  letter-spacing: -.035em;
  line-height: 1.08;
}

.process-view__current p {
  max-width: 48ch;
  color: var(--ui-text-toned);
  font-size: 16px;
  line-height: 1.7;
}

.process-steps {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.process-steps li {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  min-height: 58px;
  color: var(--ui-text-muted);
}

.process-steps li:not(:last-child)::after {
  position: absolute;
  top: 31px;
  bottom: 0;
  left: 15px;
  width: 1px;
  background: var(--ui-border-accented);
  content: '';
}

.process-steps li > span {
  z-index: 1;
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid var(--ui-border-accented);
  border-radius: 50%;
  background: var(--ui-bg-elevated);
  font-size: 12px;
  font-weight: 800;
}

.process-steps li > div {
  display: grid;
  gap: 2px;
  padding-top: 5px;
}

.process-steps strong {
  font-size: 14px;
  font-weight: 650;
}

.process-steps small {
  color: var(--ui-primary);
  font-size: 11px;
}

.process-steps .is-current {
  color: var(--ui-text-highlighted);
}

.process-steps .is-current > span {
  border-color: var(--ui-primary);
  background: var(--ui-primary);
  color: var(--ui-bg);
}

.process-steps .is-complete > span {
  border-color: color-mix(in srgb, var(--ui-success) 45%, var(--ui-border));
  color: var(--ui-success);
}

.offers-view {
  padding: clamp(22px, 4vw, 36px);
}

.offers-view__intro {
  max-width: 70ch;
  margin: 0 0 24px;
  color: var(--ui-text-toned);
  line-height: 1.65;
}

.offer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.offer-card {
  display: grid;
  gap: 20px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  padding: 20px;
  background: var(--ui-bg);
}

.offer-card header {
  display: grid;
  gap: 3px;
}

.offer-card header span {
  color: var(--ui-primary);
  font-size: 12px;
  font-weight: 800;
}

.offer-card h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 18px;
  line-height: 1.3;
}

.offer-card__primary {
  display: grid;
  gap: 2px;
}

.offer-card__primary span,
.offer-card__primary small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.offer-card__primary strong {
  color: var(--ui-text-highlighted);
  font-size: 26px;
  letter-spacing: -.03em;
}

.offer-card dl {
  display: grid;
  gap: 10px;
  border-top: 1px solid var(--ui-border);
  margin: 0;
  padding-top: 15px;
}

.offer-card dl div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 14px;
}

.offer-card dt,
.offer-card dd {
  margin: 0;
  font-size: 12px;
}

.offer-card dt {
  color: var(--ui-text-muted);
}

.offer-card dd {
  color: var(--ui-text-highlighted);
  font-weight: 700;
  text-align: right;
}

.offers-view__note {
  margin: 22px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

@media (max-width: 720px) {
  .meeting-status {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .meeting-status > :last-child {
    grid-column: 2;
    justify-self: start;
  }

  .waiting-card dl,
  .process-view {
    grid-template-columns: 1fr;
  }

  .waiting-card dl {
    gap: 14px;
  }

  .waiting-card dl div {
    padding: 0;
  }

  .waiting-card dl div + div {
    border-left: 0;
  }

  .shared-workspace__header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
