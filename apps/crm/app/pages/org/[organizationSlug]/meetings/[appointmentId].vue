<script setup lang="ts">
import type {
  CaseDetailResponse,
  SavedCaseOffer,
} from '~/types/cases'
import type {
  CrmMeetingRecord,
  CrmMeetingSharedKind,
  CrmMeetingSharedState,
} from '~/types/crm-meeting'
import { mortgageProcessArtifact } from '~/utils/crm-meeting-artifacts'

definePageMeta({ middleware: ['auth', 'organization'] })

const route = useRoute()
const { organizationSlug, crmApiPath, orgPath } = useOrganizationContext()
const requestFetch = useRequestFetch()
const toast = useToast()
const appointmentId = computed(() => String(route.params.appointmentId))
const {
  state: dockState,
  openMeeting,
  minimizeMeeting,
  endMeeting,
} = useCrmMeetingPrototype()

const {
  data: meetingPayload,
  pending,
  error,
  refresh: refreshMeeting,
} = await useAsyncData<{ data: CrmMeetingRecord }>(
  `crm-meeting:${organizationSlug.value}:${appointmentId.value}`,
  () => requestFetch<{ data: CrmMeetingRecord }>(
    crmApiPath(`/meetings/${encodeURIComponent(appointmentId.value)}`),
  ),
  {
    watch: [organizationSlug, appointmentId],
  },
)

const meeting = computed(() => meetingPayload.value?.data ?? null)
const clientPreviewRoute = computed(() => ({
  path: `/client/meetings/${appointmentId.value}`,
  query: {
    preview: 'expert',
    organizationSlug: organizationSlug.value,
  },
}))

const {
  data: casePayload,
  pending: casePending,
  error: caseError,
  refresh: refreshCase,
} = await useAsyncData<CaseDetailResponse | null>(
  `crm-meeting-case:${organizationSlug.value}:${appointmentId.value}`,
  () => meeting.value?.caseId
    ? requestFetch<CaseDetailResponse>(crmApiPath(`/cases/${meeting.value.caseId}`))
    : Promise.resolve(null),
  {
    default: () => null,
    watch: [() => meeting.value?.caseId],
  },
)

const activeCase = computed(() => casePayload.value?.data ?? null)
const offers = computed(() => activeCase.value?.offers ?? [])
const selectedOfferIds = ref<string[]>([])
const activeDraftOfferId = ref<string | null>(null)
const selectedProcessStepId = ref(mortgageProcessArtifact.steps[0]!.id)
const draftKind = ref<Exclude<CrmMeetingSharedKind, 'none'>>('mortgage-offers')
const mutationPending = ref(false)
const copyDone = ref(false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

watch(() => meeting.value?.shared, (shared) => {
  if (!shared) return
  if (shared.offerIds.length) {
    selectedOfferIds.value = [...shared.offerIds]
    activeDraftOfferId.value = shared.activeOfferId ?? shared.offerIds[0] ?? null
  }
  if (shared.processStepId) selectedProcessStepId.value = shared.processStepId
}, { immediate: true, deep: true })

watch(() => meeting.value?.status, (status) => {
  if (status !== 'live' || !meeting.value) return
  openMeeting({
    appointmentId: meeting.value.id,
    caseId: meeting.value.caseId,
    clientName: meeting.value.clientName,
    startedAt: meeting.value.startedAt ?? undefined,
  })
}, { immediate: true })

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1_000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

onBeforeRouteLeave(() => {
  if (meeting.value?.status === 'live' && dockState.value.active) minimizeMeeting()
})

useHead(() => ({
  title: meeting.value
    ? `${meeting.value.clientName} — Spotkanie — OpenExpert CRM`
    : 'Spotkanie — OpenExpert CRM',
}))

const currency = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})
const percent = new Intl.NumberFormat('pl-PL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const elapsedLabel = computed(() => {
  const startedAt = meeting.value?.startedAt
  if (!startedAt) return '00:00'
  const seconds = Math.max(0, Math.floor((now.value - new Date(startedAt).valueOf()) / 1_000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
})

const publishedProcessStep = computed(() => (
  mortgageProcessArtifact.steps.find(step => step.id === meeting.value?.shared.processStepId)
  ?? null
))
const selectedProcessStep = computed(() => (
  mortgageProcessArtifact.steps.find(step => step.id === selectedProcessStepId.value)
  ?? mortgageProcessArtifact.steps[0]!
))
const publishedOffers = computed(() => {
  const ids = new Set(meeting.value?.shared.offerIds ?? [])
  return offers.value.filter(offer => ids.has(offer.id))
})
const publishedActiveOffer = computed(() => (
  publishedOffers.value.find(offer => offer.id === meeting.value?.shared.activeOfferId)
  ?? publishedOffers.value[0]
  ?? null
))
const hasUnpublishedChanges = computed(() => {
  const shared = meeting.value?.shared
  if (!shared) return false
  if (draftKind.value === 'mortgage-process') {
    return shared.kind !== 'mortgage-process'
      || shared.processStepId !== selectedProcessStepId.value
  }
  return shared.kind !== 'mortgage-offers'
    || shared.activeOfferId !== activeDraftOfferId.value
    || selectedOfferIds.value.join('|') !== shared.offerIds.join('|')
})

function meetingDate(value: CrmMeetingRecord) {
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: value.timezone || 'Europe/Warsaw',
  }).format(new Date(value.startsAt))
}

function offerApr(offer: SavedCaseOffer) {
  return offer.representative_apr_pct == null
    ? 'Brak danych'
    : `${percent.format(Number(offer.representative_apr_pct))}%`
}

function toggleOffer(offerId: string) {
  if (selectedOfferIds.value.includes(offerId)) {
    selectedOfferIds.value = selectedOfferIds.value.filter(id => id !== offerId)
    if (activeDraftOfferId.value === offerId) {
      activeDraftOfferId.value = selectedOfferIds.value[0] ?? null
    }
    return
  }
  if (selectedOfferIds.value.length >= 3) {
    toast.add({
      title: 'Możesz pokazać maksymalnie trzy oferty',
      description: 'Usuń jedną z zaznaczonych ofert, aby dodać kolejną.',
      color: 'warning',
    })
    return
  }
  selectedOfferIds.value = [...selectedOfferIds.value, offerId]
  activeDraftOfferId.value ??= offerId
}

async function mutateMeeting(body: Record<string, unknown>) {
  if (!meeting.value || mutationPending.value) return null
  mutationPending.value = true
  try {
    const result = await $fetch<{ data: CrmMeetingRecord }>(
      crmApiPath(`/meetings/${encodeURIComponent(meeting.value.id)}`),
      { method: 'PATCH', body },
    )
    meetingPayload.value = result
    return result.data
  } catch (caught: unknown) {
    toast.add({
      title: 'Nie udało się zaktualizować spotkania',
      description: apiErrorMessage(caught),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
    return null
  } finally {
    mutationPending.value = false
  }
}

async function startMeeting() {
  const updated = await mutateMeeting({ action: 'start' })
  if (!updated) return
  openMeeting({
    appointmentId: updated.id,
    caseId: updated.caseId,
    clientName: updated.clientName,
    startedAt: updated.startedAt ?? undefined,
  })
  toast.add({
    title: 'Spotkanie rozpoczęte',
    description: 'Klient może teraz otworzyć swój panel konsultacji.',
    color: 'success',
    icon: 'i-lucide-video',
  })
}

async function finishMeeting() {
  const updated = await mutateMeeting({ action: 'end' })
  if (!updated) return
  endMeeting()
  await navigateTo(orgPath('/meetings'))
}

async function publishSelection() {
  if (draftKind.value === 'mortgage-process') {
    const updated = await mutateMeeting({
      action: 'publish',
      kind: 'mortgage-process',
      processStepId: selectedProcessStepId.value,
    })
    if (!updated) return
  } else {
    if (!selectedOfferIds.value.length) {
      toast.add({
        title: 'Wybierz co najmniej jedną ofertę',
        description: 'Zaznaczenie jest robocze, dopóki nie klikniesz „Pokaż klientowi”.',
        color: 'warning',
      })
      return
    }
    const updated = await mutateMeeting({
      action: 'publish',
      kind: 'mortgage-offers',
      offerIds: selectedOfferIds.value,
      activeOfferId: activeDraftOfferId.value ?? selectedOfferIds.value[0],
    })
    if (!updated) return
  }
  toast.add({
    title: 'Widok klienta został zaktualizowany',
    description: 'Udostępnione są wyłącznie wybrane materiały, bez pozostałych danych CRM.',
    color: 'success',
    icon: 'i-lucide-eye',
  })
}

async function copyClientLink() {
  if (!meeting.value || !import.meta.client) return
  const url = new URL('/client/claim', window.location.origin)
  url.searchParams.set('appointmentId', meeting.value.id)
  url.searchParams.set('redirect', `/client/meetings/${meeting.value.id}`)
  const clientUrl = url.toString()
  try {
    await navigator.clipboard.writeText(clientUrl)
    copyDone.value = true
    setTimeout(() => {
      copyDone.value = false
    }, 2_000)
  } catch {
    toast.add({
      title: 'Nie udało się skopiować linku',
      description: clientUrl,
      color: 'warning',
    })
  }
}

async function minimizeToCase() {
  minimizeMeeting()
  await navigateTo(orgPath(`/cases/${meeting.value?.caseId}`))
}
</script>

<template>
  <div class="meeting-room">
    <div v-if="pending" class="room-loading">
      <USkeleton class="h-24 w-full" />
      <USkeleton class="h-[520px] w-full" />
    </div>

    <UAlert
      v-else-if="error || !meeting"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się otworzyć spotkania"
      :description="error ? apiErrorMessage(error) : 'Spotkanie nie istnieje albo nie masz do niego dostępu.'"
      :actions="[{ label: 'Wróć do spotkań', to: orgPath('/meetings') }]"
    />

    <template v-else>
      <header class="room-header">
        <div class="room-header__identity">
          <UButton
            :to="orgPath('/meetings')"
            color="neutral"
            variant="ghost"
            square
            icon="i-lucide-arrow-left"
            aria-label="Wróć do spotkań"
          />
          <span class="room-header__avatar">{{ meeting.clientName.slice(0, 1).toUpperCase() }}</span>
          <span>
            <small>{{ meeting.relationship === 'first' ? 'Pierwsze spotkanie' : 'Kolejne spotkanie' }}</small>
            <h1>{{ meeting.clientName }}</h1>
            <p>{{ meeting.caseTitle }}</p>
          </span>
        </div>
        <div class="room-header__status">
          <span v-if="meeting.status === 'live'" class="room-live">
            <i />
            {{ elapsedLabel }}
          </span>
          <UBadge
            v-else
            :color="meeting.status === 'ended' ? 'neutral' : 'info'"
            variant="soft"
            :icon="meeting.status === 'ended' ? 'i-lucide-check-check' : 'i-lucide-calendar-clock'"
          >
            {{ meeting.status === 'ended' ? 'Zakończone' : 'Zaplanowane' }}
          </UBadge>
        </div>
        <div class="room-header__actions">
          <UButton
            :to="clientPreviewRoute"
            target="_blank"
            rel="noopener noreferrer"
            color="neutral"
            variant="outline"
            icon="i-lucide-external-link"
            label="Otwórz widok klienta"
            data-testid="meeting-client-preview"
          />
          <UButton
            v-if="meeting.status === 'live'"
            color="neutral"
            variant="outline"
            icon="i-lucide-minimize-2"
            label="Minimalizuj"
            @click="minimizeToCase"
          />
          <UButton
            v-if="meeting.status === 'live'"
            color="error"
            variant="soft"
            icon="i-lucide-phone-off"
            label="Zakończ"
            :loading="mutationPending"
            @click="finishMeeting"
          />
        </div>
      </header>

      <section v-if="meeting.status === 'scheduled'" class="prejoin">
        <div class="prejoin__main">
          <span class="prejoin__eyebrow">Przygotowanie</span>
          <h2>Wszystko jest przypisane. Rozmowa jeszcze się nie rozpoczęła.</h2>
          <p>
            Sprawdź klienta, sprawę i termin. Dopiero po wybraniu „Rozpocznij spotkanie”
            uruchomimy wspólny widok materiałów.
          </p>

          <div class="prejoin__checklist">
            <article>
              <span><UIcon name="i-lucide-calendar-check-2" /></span>
              <div>
                <small>Termin</small>
                <strong>{{ meetingDate(meeting) }}</strong>
              </div>
              <UIcon name="i-lucide-check" />
            </article>
            <article>
              <span><UIcon name="i-lucide-briefcase-business" /></span>
              <div>
                <small>Sprawa</small>
                <strong>{{ meeting.caseTitle }}</strong>
              </div>
              <UButton
                :to="orgPath(`/cases/${meeting.caseId}`)"
                color="neutral"
                variant="ghost"
                size="sm"
                label="Otwórz"
              />
            </article>
            <article>
              <span><UIcon name="i-lucide-landmark" /></span>
              <div>
                <small>Oferty gotowe w sprawie</small>
                <strong>{{ casePending ? 'Sprawdzam…' : `${offers.length} ${offers.length === 1 ? 'oferta' : 'ofert'}` }}</strong>
              </div>
              <UIcon :name="offers.length ? 'i-lucide-check' : 'i-lucide-minus'" />
            </article>
          </div>

          <div class="prejoin__actions">
            <UButton
              color="primary"
              size="xl"
              icon="i-lucide-video"
              label="Rozpocznij spotkanie"
              :loading="mutationPending"
              data-testid="meeting-start"
              @click="startMeeting"
            />
            <span>Klient zobaczy poczekalnię, dopóki nie rozpoczniesz spotkania.</span>
          </div>
        </div>

        <aside class="prejoin__aside">
          <div class="prejoin__client">
            <span class="prejoin__client-avatar">{{ meeting.clientName.slice(0, 1).toUpperCase() }}</span>
            <div>
              <small>Klient</small>
              <strong>{{ meeting.clientName }}</strong>
              <span>{{ meeting.serviceName }}</span>
            </div>
          </div>
          <div class="prejoin__link">
            <span>
              <small>Link dla klienta</small>
              <strong>Panel konsultacji</strong>
            </span>
            <UButton
              color="neutral"
              variant="outline"
              :icon="copyDone ? 'i-lucide-check' : 'i-lucide-copy'"
              :label="copyDone ? 'Skopiowano' : 'Kopiuj link'"
              @click="copyClientLink"
            />
          </div>
          <UAlert
            color="neutral"
            variant="subtle"
            icon="i-lucide-headphones"
            title="Kanał rozmowy"
            description="W tym środowisku audio i wideo nie są połączone z wizytą. Materiały CRM i panel klienta działają niezależnie od wybranego kanału rozmowy."
          />
        </aside>
      </section>

      <section v-else-if="meeting.status === 'live'" class="live-workspace">
        <aside class="conversation-panel">
          <header>
            <span>
              <small>Rozmowa</small>
              <strong>{{ meeting.clientName }}</strong>
            </span>
            <span class="conversation-panel__online"><i /> W toku</span>
          </header>

          <div class="conversation-stage">
            <span class="conversation-stage__avatar">{{ meeting.clientName.slice(0, 1).toUpperCase() }}</span>
            <strong>{{ meeting.clientName }}</strong>
            <small>Panel klienta jest gotowy na publikowane materiały.</small>
          </div>

          <div class="conversation-meta">
            <span>
              <UIcon name="i-lucide-clock-3" />
              <span><small>Czas</small><strong>{{ elapsedLabel }}</strong></span>
            </span>
            <span>
              <UIcon name="i-lucide-briefcase-business" />
              <span><small>Sprawa</small><strong>{{ meeting.caseTitle }}</strong></span>
            </span>
          </div>

          <UButton
            :to="orgPath(`/cases/${meeting.caseId}`)"
            block
            color="neutral"
            variant="outline"
            icon="i-lucide-external-link"
            label="Otwórz pełną sprawę"
          />

          <div class="conversation-privacy">
            <UIcon name="i-lucide-lock-keyhole" />
            <span>
              <strong>Prywatny kontekst eksperta</strong>
              <small>Klient nie widzi tej kolumny ani pozostałych danych sprawy.</small>
            </span>
          </div>
        </aside>

        <main class="materials-panel">
          <header class="materials-panel__header">
            <span>
              <small>Materiały spotkania</small>
              <h2>Co chcesz teraz pokazać klientowi?</h2>
            </span>
            <div class="material-tabs" role="tablist" aria-label="Rodzaj materiału">
              <button
                type="button"
                role="tab"
                :aria-selected="draftKind === 'mortgage-offers'"
                :class="{ 'is-active': draftKind === 'mortgage-offers' }"
                @click="draftKind = 'mortgage-offers'"
              >
                <UIcon name="i-lucide-landmark" />
                Oferty
              </button>
              <button
                type="button"
                role="tab"
                :aria-selected="draftKind === 'mortgage-process'"
                :class="{ 'is-active': draftKind === 'mortgage-process' }"
                @click="draftKind = 'mortgage-process'"
              >
                <UIcon name="i-lucide-route" />
                Proces
              </button>
            </div>
          </header>

          <UAlert
            v-if="caseError"
            color="error"
            variant="subtle"
            title="Nie udało się pobrać materiałów sprawy"
            :description="apiErrorMessage(caseError)"
            :actions="[{ label: 'Spróbuj ponownie', onClick: () => refreshCase() }]"
          />

          <template v-else-if="draftKind === 'mortgage-offers'">
            <div class="material-toolbar">
              <span>
                <strong>Wybierz od jednej do trzech ofert</strong>
                <small>{{ selectedOfferIds.length }}/3 zaznaczone · wybór pozostaje prywatny do publikacji</small>
              </span>
              <UButton
                :to="{
                  path: orgPath('/mortgages'),
                  query: {
                    caseId: meeting.caseId,
                    returnTo: orgPath(`/meetings/${meeting.id}`),
                  },
                }"
                color="neutral"
                variant="outline"
                icon="i-lucide-plus"
                label="Dodaj ofertę do sprawy"
              />
            </div>

            <div v-if="casePending" class="offer-list">
              <USkeleton v-for="index in 3" :key="index" class="h-28 w-full" />
            </div>
            <div v-else-if="offers.length" class="offer-list">
              <article
                v-for="offer in offers"
                :key="offer.id"
                :class="{ 'is-selected': selectedOfferIds.includes(offer.id) }"
              >
                <button type="button" class="offer-list__select" @click="toggleOffer(offer.id)">
                  <UIcon :name="selectedOfferIds.includes(offer.id) ? 'i-lucide-square-check-big' : 'i-lucide-square'" />
                  <span>
                    <strong>{{ offer.bank_name }}</strong>
                    <small>{{ offer.product_name }}</small>
                    <small
                      v-if="offer.calculation_status === 'partial'"
                      class="offer-list__quality"
                    >
                      Niepełne dane · warunki i koszty do potwierdzenia
                    </small>
                  </span>
                </button>
                <dl>
                  <div>
                    <dt>Pierwszy wydatek / mies.</dt>
                    <dd>{{ currency.format(Number(offer.first_monthly_outflow ?? 0)) }}</dd>
                  </div>
                  <div>
                    <dt>Koszt 5 lat</dt>
                    <dd>{{ currency.format(Number(offer.cost_first_five_years ?? 0)) }}</dd>
                  </div>
                  <div>
                    <dt>RRSO</dt>
                    <dd>{{ offerApr(offer) }}</dd>
                  </div>
                </dl>
                <button
                  v-if="selectedOfferIds.includes(offer.id)"
                  type="button"
                  class="offer-list__focus"
                  :class="{ 'is-active': activeDraftOfferId === offer.id }"
                  @click="activeDraftOfferId = offer.id"
                >
                  {{ activeDraftOfferId === offer.id ? 'Główna na ekranie klienta' : 'Ustaw jako główną' }}
                </button>
              </article>
            </div>
            <div v-else class="offers-empty">
              <span><UIcon name="i-lucide-landmark" /></span>
              <h3>W sprawie nie ma jeszcze zapisanych ofert</h3>
              <p>Przejdź do porównywarki, policz realny scenariusz i zapisz wybrane produkty w tej sprawie.</p>
              <UButton
                :to="{
                  path: orgPath('/mortgages'),
                  query: {
                    caseId: meeting.caseId,
                    returnTo: orgPath(`/meetings/${meeting.id}`),
                  },
                }"
                color="primary"
                icon="i-lucide-calculator"
                label="Otwórz porównywarkę"
              />
            </div>
          </template>

          <div v-else class="process-selector">
            <button
              v-for="(step, index) in mortgageProcessArtifact.steps"
              :key="step.id"
              type="button"
              :class="{ 'is-selected': selectedProcessStepId === step.id }"
              @click="selectedProcessStepId = step.id"
            >
              <span>{{ index + 1 }}</span>
              <div>
                <strong>{{ step.label }}</strong>
                <small>{{ step.summary }}</small>
              </div>
              <UIcon :name="selectedProcessStepId === step.id ? 'i-lucide-circle-check' : 'i-lucide-circle'" />
            </button>
          </div>

          <footer class="publish-bar">
            <span>
              <UIcon name="i-lucide-shield-check" />
              <span>
                <small>Publikacja jest jawna i odwracalna</small>
                <strong>
                  {{ hasUnpublishedChanges
                    ? 'Masz nieopublikowane zmiany'
                    : 'Widok klienta jest aktualny' }}
                </strong>
              </span>
            </span>
            <UButton
              color="primary"
              icon="i-lucide-eye"
              label="Pokaż klientowi"
              :loading="mutationPending"
              :disabled="draftKind === 'mortgage-offers' && !selectedOfferIds.length"
              data-testid="meeting-publish"
              @click="publishSelection"
            />
          </footer>
        </main>

        <aside class="client-view">
          <header>
            <span>
              <small>Widok klienta</small>
              <strong>Klient widzi teraz</strong>
            </span>
            <UBadge color="success" variant="soft" icon="i-lucide-eye">Na żywo</UBadge>
          </header>

          <div class="client-screen">
            <div class="client-screen__brand">
              <span><UIcon name="i-lucide-sparkles" /></span>
              <span>
                <strong>OpenExpert</strong>
                <small>Konsultacja z ekspertem</small>
              </span>
            </div>

            <div v-if="meeting.shared.kind === 'none'" class="client-screen__waiting">
              <span><UIcon name="i-lucide-coffee" /></span>
              <h3>Rozmowa trwa</h3>
              <p>Ekspert za chwilę pokaże tutaj wybrany materiał.</p>
            </div>

            <template v-else-if="meeting.shared.kind === 'mortgage-process' && publishedProcessStep">
              <span class="client-screen__eyebrow">Twój proces kredytowy</span>
              <h3>{{ publishedProcessStep.label }}</h3>
              <p>{{ publishedProcessStep.summary }}</p>
              <ol class="client-process">
                <li
                  v-for="(step, index) in mortgageProcessArtifact.steps"
                  :key="step.id"
                  :class="{ 'is-active': publishedProcessStep.id === step.id }"
                >
                  <span>{{ index + 1 }}</span>
                  <small>{{ step.label }}</small>
                </li>
              </ol>
            </template>

            <template v-else-if="meeting.shared.kind === 'mortgage-offers' && publishedActiveOffer">
              <span class="client-screen__eyebrow">Oferta omawiana teraz</span>
              <h3>{{ publishedActiveOffer.bank_name }}</h3>
              <p>{{ publishedActiveOffer.product_name }}</p>
              <div class="client-screen__amount">
                <small>Pierwszy wydatek / mies.</small>
                <strong>{{ currency.format(Number(publishedActiveOffer.first_monthly_outflow ?? 0)) }}</strong>
              </div>
              <p
                v-if="publishedActiveOffer.calculation_status === 'partial'"
                class="client-screen__estimate"
              >
                Wyliczenie orientacyjne. Dostępność, limity i część kosztów wymagają potwierdzenia.
              </p>
              <div class="client-screen__offer-tabs">
                <button
                  v-for="offer in publishedOffers"
                  :key="offer.id"
                  type="button"
                  :class="{ 'is-active': offer.id === meeting.shared.activeOfferId }"
                  disabled
                >
                  {{ offer.bank_name }}
                </button>
              </div>
            </template>
          </div>

          <footer>
            <UIcon name="i-lucide-lock-keyhole" />
            <span>Notatki, dane sprawy i roboczy wybór ofert pozostają niewidoczne.</span>
          </footer>
        </aside>
      </section>

      <section v-else class="meeting-summary">
        <span class="meeting-summary__icon"><UIcon name="i-lucide-check-check" /></span>
        <h2>Spotkanie zostało zakończone</h2>
        <p>
          Termin pozostaje w historii sprawy. Możesz wrócić do zapisanych ofert albo
          umówić kolejne spotkanie z tym klientem.
        </p>
        <div class="meeting-summary__facts">
          <span><small>Klient</small><strong>{{ meeting.clientName }}</strong></span>
          <span><small>Sprawa</small><strong>{{ meeting.caseTitle }}</strong></span>
          <span><small>Termin</small><strong>{{ meetingDate(meeting) }}</strong></span>
        </div>
        <div class="meeting-summary__actions">
          <UButton
            :to="orgPath(`/cases/${meeting.caseId}`)"
            color="neutral"
            variant="outline"
            icon="i-lucide-briefcase-business"
            label="Otwórz sprawę"
          />
          <UButton
            :to="orgPath('/meetings')"
            color="primary"
            icon="i-lucide-calendar-plus-2"
            label="Przejdź do spotkań"
          />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.meeting-room {
  display: grid;
  gap: 20px;
  min-height: calc(100vh - 88px);
  padding-bottom: 36px;
}

.room-loading {
  display: grid;
  gap: 16px;
}

.room-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 18px;
  padding: 13px 16px;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--ui-bg-elevated) 94%, transparent);
  box-shadow: 0 14px 40px color-mix(in srgb, var(--ui-text) 5%, transparent);
}

.room-header__identity {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
}

.room-header__avatar {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--ui-primary) 13%, var(--ui-bg));
  color: var(--ui-primary);
  font-weight: 800;
}

.room-header__identity > span:last-child {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.room-header small,
.materials-panel small,
.client-view small,
.conversation-panel small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.room-header h1,
.room-header p,
.materials-panel h2,
.client-view h3,
.client-view p,
.prejoin h2,
.prejoin p,
.meeting-summary h2,
.meeting-summary p {
  margin: 0;
}

.room-header h1 {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-header p {
  overflow: hidden;
  color: var(--ui-text-toned);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-header__actions {
  display: flex;
  gap: 8px;
}

.room-live,
.conversation-panel__online {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-success);
  font-size: 12px;
  font-weight: 800;
}

.room-live i,
.conversation-panel__online i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 13%, transparent);
}

.prejoin {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(300px, .7fr);
  gap: 18px;
  align-items: start;
}

.prejoin__main,
.prejoin__aside,
.meeting-summary {
  border: 1px solid var(--ui-border);
  border-radius: 22px;
  background: var(--ui-bg-elevated);
}

.prejoin__main {
  display: grid;
  gap: 20px;
  padding: clamp(28px, 5vw, 52px);
}

.prejoin__eyebrow,
.client-screen__eyebrow {
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.prejoin h2 {
  max-width: 22ch;
  color: var(--ui-text-highlighted);
  font-size: clamp(28px, 4vw, 44px);
  letter-spacing: -.045em;
  line-height: 1.05;
}

.prejoin__main > p {
  max-width: 68ch;
  color: var(--ui-text-toned);
  line-height: 1.65;
}

.prejoin__checklist {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
}

.prejoin__checklist article {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid var(--ui-border);
}

.prejoin__checklist article:last-child {
  border-bottom: 0;
}

.prejoin__checklist article > span:first-child {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg));
  color: var(--ui-primary);
}

.prejoin__checklist article > div {
  display: grid;
  gap: 2px;
}

.prejoin__checklist strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.prejoin__checklist article > svg {
  color: var(--ui-success);
}

.prejoin__actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.prejoin__actions > span {
  max-width: 35ch;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.prejoin__aside {
  display: grid;
  gap: 14px;
  padding: 20px;
}

.prejoin__client,
.prejoin__link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-radius: 15px;
  background: var(--ui-bg);
}

.prejoin__client {
  justify-content: flex-start;
}

.prejoin__client-avatar {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border-radius: 15px;
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg-elevated));
  color: var(--ui-primary);
  font-weight: 800;
}

.prejoin__client div,
.prejoin__link > span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.prejoin__client strong,
.prejoin__link strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.prejoin__client span {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.live-workspace {
  display: grid;
  grid-template-columns: minmax(210px, .62fr) minmax(460px, 1.75fr) minmax(280px, .8fr);
  gap: 14px;
  align-items: start;
}

.conversation-panel,
.materials-panel,
.client-view {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 20px;
  background: var(--ui-bg-elevated);
  box-shadow: 0 12px 36px color-mix(in srgb, var(--ui-text) 4%, transparent);
}

.conversation-panel {
  display: grid;
  gap: 14px;
  padding: 16px;
}

.conversation-panel > header,
.client-view > header,
.materials-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.conversation-panel > header > span:first-child,
.client-view > header > span:first-child,
.materials-panel__header > span:first-child {
  display: grid;
  gap: 2px;
}

.conversation-panel strong,
.client-view strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.conversation-stage {
  display: grid;
  justify-items: center;
  gap: 7px;
  min-height: 218px;
  padding: 28px 18px;
  place-content: center;
  border-radius: 16px;
  background:
    radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--ui-primary) 14%, transparent), transparent 48%),
    color-mix(in srgb, var(--ui-bg) 88%, black);
  text-align: center;
}

.conversation-stage__avatar {
  display: grid;
  width: 76px;
  height: 76px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 28%, transparent);
  border-radius: 25px;
  background: color-mix(in srgb, var(--ui-primary) 14%, var(--ui-bg-elevated));
  color: var(--ui-primary);
  font-size: 25px;
  font-weight: 800;
}

.conversation-stage small {
  max-width: 28ch;
  line-height: 1.45;
}

.conversation-meta {
  display: grid;
  gap: 8px;
}

.conversation-meta > span {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px;
  border-radius: 12px;
  background: var(--ui-bg);
  color: var(--ui-primary);
}

.conversation-meta > span > span {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.conversation-meta strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-privacy {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-bg));
  color: var(--ui-primary);
}

.conversation-privacy span {
  display: grid;
  gap: 2px;
}

.conversation-privacy strong {
  font-size: 11px;
}

.conversation-privacy small {
  line-height: 1.4;
}

.materials-panel {
  display: grid;
  gap: 17px;
  padding: 18px;
}

.materials-panel h2 {
  color: var(--ui-text-highlighted);
  font-size: 19px;
  letter-spacing: -.025em;
}

.material-tabs {
  display: flex;
  padding: 3px;
  border-radius: 11px;
  background: var(--ui-bg);
}

.material-tabs button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.material-tabs button.is-active {
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--ui-text) 8%, transparent);
}

.material-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--ui-bg);
}

.material-toolbar > span {
  display: grid;
  gap: 2px;
}

.material-toolbar strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.offer-list {
  display: grid;
  gap: 9px;
}

.offer-list article {
  display: grid;
  grid-template-columns: minmax(180px, .8fr) minmax(300px, 1.2fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg);
}

.offer-list article.is-selected {
  border-color: color-mix(in srgb, var(--ui-primary) 48%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-bg));
}

.offer-list__select {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 9px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
  text-align: left;
}

.offer-list__select > svg {
  flex: 0 0 auto;
  color: var(--ui-primary);
  font-size: 18px;
}

.offer-list__select span {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.offer-list__select strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offer-list__quality {
  color: var(--ui-warning);
  font-size: 9px;
  font-weight: 700;
}

.offer-list dl {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
  margin: 0;
}

.offer-list dl div {
  display: grid;
  gap: 2px;
}

.offer-list dt {
  color: var(--ui-text-muted);
  font-size: 9px;
}

.offer-list dd {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 11px;
  font-weight: 750;
}

.offer-list__focus {
  padding: 7px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-muted);
  font-size: 9px;
  font-weight: 700;
}

.offer-list__focus.is-active {
  border-color: color-mix(in srgb, var(--ui-success) 40%, var(--ui-border));
  color: var(--ui-success);
}

.offers-empty {
  display: grid;
  justify-items: center;
  gap: 9px;
  padding: 38px 18px;
  border: 1px dashed var(--ui-border);
  border-radius: 16px;
  text-align: center;
}

.offers-empty > span {
  display: grid;
  width: 50px;
  height: 50px;
  place-items: center;
  border-radius: 16px;
  background: color-mix(in srgb, var(--ui-primary) 11%, var(--ui-bg));
  color: var(--ui-primary);
  font-size: 22px;
}

.offers-empty h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 17px;
}

.offers-empty p {
  max-width: 55ch;
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 1.55;
}

.process-selector {
  display: grid;
  gap: 8px;
}

.process-selector button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 13px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg);
  color: var(--ui-text);
  text-align: left;
}

.process-selector button:hover,
.process-selector button.is-selected {
  border-color: color-mix(in srgb, var(--ui-primary) 48%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-bg));
}

.process-selector button > span {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 10px;
  background: var(--ui-bg-elevated);
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 800;
}

.process-selector button > div {
  display: grid;
  gap: 3px;
}

.process-selector strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.process-selector small {
  line-height: 1.4;
}

.process-selector button > svg {
  color: var(--ui-primary);
}

.publish-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 2px -18px -18px;
  padding: 14px 18px;
  border-top: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-bg) 85%, var(--ui-bg-elevated));
}

.publish-bar > span {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--ui-success);
}

.publish-bar > span > span {
  display: grid;
  gap: 2px;
}

.publish-bar strong {
  color: var(--ui-text-highlighted);
  font-size: 11px;
}

.client-view {
  display: grid;
}

.client-view > header {
  padding: 15px;
  border-bottom: 1px solid var(--ui-border);
}

.client-screen {
  display: grid;
  align-content: start;
  gap: 13px;
  min-height: 430px;
  padding: 20px;
  background:
    radial-gradient(circle at 100% 0, color-mix(in srgb, var(--ui-primary) 9%, transparent), transparent 40%),
    var(--ui-bg);
}

.client-screen__brand {
  display: flex;
  align-items: center;
  gap: 9px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--ui-border);
}

.client-screen__brand > span:first-child {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 11px;
  background: var(--ui-primary);
  color: var(--ui-bg);
}

.client-screen__brand > span:last-child {
  display: grid;
  gap: 1px;
}

.client-screen__waiting {
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 9px;
  min-height: 300px;
  text-align: center;
}

.client-screen__waiting > span {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  border-radius: 19px;
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg-elevated));
  color: var(--ui-primary);
  font-size: 25px;
}

.client-screen h3 {
  color: var(--ui-text-highlighted);
  font-size: 24px;
  letter-spacing: -.035em;
}

.client-screen p {
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 1.55;
}

.client-process {
  display: grid;
  gap: 7px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.client-process li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 10px;
  color: var(--ui-text-muted);
}

.client-process li.is-active {
  background: color-mix(in srgb, var(--ui-primary) 9%, var(--ui-bg-elevated));
  color: var(--ui-text-highlighted);
}

.client-process li span {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 8px;
  background: var(--ui-bg-elevated);
  color: var(--ui-primary);
  font-size: 9px;
  font-weight: 800;
}

.client-screen__amount {
  display: grid;
  gap: 4px;
  padding: 17px;
  border-radius: 15px;
  background: color-mix(in srgb, var(--ui-primary) 9%, var(--ui-bg-elevated));
}

.client-screen__amount strong {
  font-size: 24px;
}

.client-screen__estimate {
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 28%, var(--ui-border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-warning) 7%, var(--ui-bg));
  color: var(--ui-text-toned);
}

.client-screen__offer-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.client-screen__offer-tabs button {
  padding: 7px 9px;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-muted);
  font-size: 9px;
}

.client-screen__offer-tabs button.is-active {
  border-color: var(--ui-primary);
  color: var(--ui-primary);
}

.client-view > footer {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 15px;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-success);
  font-size: 10px;
  line-height: 1.4;
}

.client-view > footer span {
  color: var(--ui-text-muted);
}

.meeting-summary {
  display: grid;
  justify-items: center;
  gap: 13px;
  padding: clamp(40px, 7vw, 80px) 24px;
  text-align: center;
}

.meeting-summary__icon {
  display: grid;
  width: 66px;
  height: 66px;
  place-items: center;
  border-radius: 22px;
  background: color-mix(in srgb, var(--ui-success) 11%, var(--ui-bg));
  color: var(--ui-success);
  font-size: 29px;
}

.meeting-summary h2 {
  color: var(--ui-text-highlighted);
  font-size: 28px;
  letter-spacing: -.035em;
}

.meeting-summary > p {
  max-width: 58ch;
  color: var(--ui-text-toned);
  line-height: 1.6;
}

.meeting-summary__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: min(760px, 100%);
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 15px;
}

.meeting-summary__facts span {
  display: grid;
  gap: 4px;
  padding: 15px;
  border-right: 1px solid var(--ui-border);
}

.meeting-summary__facts span:last-child {
  border-right: 0;
}

.meeting-summary__facts small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.meeting-summary__facts strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.meeting-summary__actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

@media (max-width: 1250px) {
  .live-workspace {
    grid-template-columns: minmax(210px, .55fr) minmax(440px, 1.45fr);
  }

  .client-view {
    grid-column: 1 / -1;
  }

  .client-screen {
    min-height: 320px;
  }
}

@media (max-width: 850px) {
  .room-header {
    grid-template-columns: 1fr auto;
  }

  .room-header__actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }

  .prejoin,
  .live-workspace {
    grid-template-columns: 1fr;
  }

  .client-view {
    grid-column: auto;
  }

  .offer-list article {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .room-header__status {
    display: none;
  }

  .prejoin__actions,
  .material-toolbar,
  .publish-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .offer-list dl,
  .meeting-summary__facts {
    grid-template-columns: 1fr;
  }

  .meeting-summary__facts span {
    border-right: 0;
    border-bottom: 1px solid var(--ui-border);
  }

  .meeting-summary__facts span:last-child {
    border-bottom: 0;
  }
}
</style>
