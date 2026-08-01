<script setup lang="ts">
type ConsentCaptureIntent = 'collect' | 'withdraw'
type ConsentCaptureDecision = 'granted' | 'declined' | 'withdrawn'
type ConsentCaptureStage = 'otp' | 'decision' | 'complete' | 'unavailable'

interface ConsentCapturePayload {
  stage: ConsentCaptureStage
  status: string
  intent: ConsentCaptureIntent
  expiresAt: string
  maskedPhone: string
  attemptsRemaining: number
  decision: ConsentCaptureDecision | null
  decidedAt: string | null
  organizationName: string
  consent: {
    version: number
    title: string
    content: string
    purpose: string
    channel: string
    legalBasis: string
    languageCode: string
    contentSha256: string
  }
}

definePageMeta({
  layout: false,
  validate: route => typeof route.params.token === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(route.params.token),
})

const route = useRoute()
const token = computed(() => String(route.params.token ?? ''))
const requestEndpoint = computed(
  () => `/api/consent/requests/${encodeURIComponent(token.value)}`,
)
const {
  data: request,
  error: loadError,
  status: loadStatus,
  refresh,
} = await useFetch<ConsentCapturePayload>(requestEndpoint, {
  key: `consent-capture:${token.value}`,
})

const otpDigits = ref<number[]>([])
const demoAutoFilled = ref(false)
const verifyPending = ref(false)
const decisionPending = ref<ConsentCaptureDecision | null>(null)
const actionError = ref('')

onMounted(() => {
  const hashParams = new URLSearchParams(window.location.hash.slice(1))
  const demoCode = hashParams.get('demo-code')
  if (demoCode === null) return

  hashParams.delete('demo-code')
  const remainingHash = hashParams.toString()
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${remainingHash ? `#${remainingHash}` : ''}`,
  )

  if (request.value?.stage !== 'otp' || !/^\d{6}$/.test(demoCode)) return
  otpDigits.value = [...demoCode].map(Number)
  demoAutoFilled.value = true
})

useHead(() => ({
  title: request.value?.consent.title
    ? `${request.value.consent.title} — OpenExpert`
    : 'Decyzja dotycząca zgody — OpenExpert',
  meta: [
    { name: 'robots', content: 'noindex, nofollow' },
    { name: 'referrer', content: 'no-referrer' },
  ],
}))

const expiryLabel = computed(() => {
  const value = request.value?.expiresAt
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value))
  } catch {
    return ''
  }
})

const channelLabel = computed(() => ({
  email: 'email',
  sms: 'SMS',
  phone: 'telefon',
  messaging: 'komunikator',
  other: 'inny',
}[request.value?.consent.channel ?? ''] ?? request.value?.consent.channel ?? '—'))

const completedCopy = computed(() => {
  if (request.value?.decision === 'granted') {
    return {
      icon: 'i-lucide-badge-check',
      title: 'Zgoda została udzielona',
      description: 'Twoja decyzja została bezpiecznie zapisana wraz z wersją treści zgody.',
    }
  }
  if (request.value?.decision === 'withdrawn') {
    return {
      icon: 'i-lucide-shield-check',
      title: 'Zgoda została wycofana',
      description: 'Wycofanie zostało zapisane. Od tej chwili obowiązuje Twoja najnowsza decyzja.',
    }
  }
  return {
    icon: 'i-lucide-circle-check-big',
    title: 'Decyzja została zapisana',
    description: 'Nie udzielono zgody. Twoja decyzja została bezpiecznie odnotowana.',
  }
})

const unavailableCopy = computed(() => {
  if (request.value?.status === 'expired') {
    return {
      title: 'Link wygasł',
      description: 'Poproś swojego doradcę o wysłanie nowej wiadomości z kodem.',
    }
  }
  if (request.value?.status === 'cancelled') {
    return {
      title: 'Ten link nie jest już aktywny',
      description: 'Mógł zostać zastąpiony nowszą wiadomością. Użyj ostatniego otrzymanego linku.',
    }
  }
  return {
    title: 'Weryfikacja nie jest dostępna',
    description: 'Kod wykorzystano zbyt wiele razy albo wiadomość nie mogła zostać dostarczona. Poproś doradcę o nowy link.',
  }
})

function errorStatus(input: unknown): number | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  const direct = Number(record.statusCode ?? record.status)
  if (Number.isInteger(direct) && direct > 0) return direct
  if (record.data && typeof record.data === 'object') {
    const nested = Number((record.data as Record<string, unknown>).statusCode)
    if (Number.isInteger(nested) && nested > 0) return nested
  }
  return null
}

function publicErrorMessage(input: unknown, fallback: string): string {
  const status = errorStatus(input)
  if (status === 410) return 'Link wygasł. Poproś doradcę o wysłanie nowej wiadomości.'
  if (status === 422) return 'Kod jest nieprawidłowy. Sprawdź wiadomość SMS i spróbuj ponownie.'
  if (status === 429) return 'Limit prób został wyczerpany. Poproś doradcę o nowy link.'
  if (status === 401 || status === 409) {
    return 'Weryfikacja utraciła ważność. Wpisz ponownie kod z wiadomości SMS.'
  }
  return fallback
}

async function verifyOtp() {
  actionError.value = ''
  const code = otpDigits.value.map(String).join('')
  if (!/^\d{6}$/.test(code)) {
    actionError.value = 'Wpisz wszystkie 6 cyfr kodu.'
    return
  }

  verifyPending.value = true
  try {
    await $fetch(`${requestEndpoint.value}/verify`, {
      method: 'POST',
      body: { code },
    })
    otpDigits.value = []
    await refresh()
  } catch (error) {
    actionError.value = publicErrorMessage(
      error,
      'Nie udało się zweryfikować kodu. Spróbuj ponownie.',
    )
    otpDigits.value = []
    await refresh().catch(() => undefined)
  } finally {
    verifyPending.value = false
  }
}

async function submitDecision(decision: ConsentCaptureDecision) {
  actionError.value = ''
  decisionPending.value = decision
  try {
    await $fetch(`${requestEndpoint.value}/decision`, {
      method: 'POST',
      body: { decision },
    })
    await refresh()
  } catch (error) {
    actionError.value = publicErrorMessage(
      error,
      'Nie udało się zapisać decyzji. Spróbuj ponownie.',
    )
    if (errorStatus(error) === 401 || errorStatus(error) === 409) {
      await refresh().catch(() => undefined)
    }
  } finally {
    decisionPending.value = null
  }
}
</script>

<template>
  <main class="consent-page">
    <UContainer class="consent-page__container">
      <header class="consent-page__brand" aria-label="OpenExpert">
        <span class="consent-page__brand-mark">
          <UIcon name="i-lucide-shield-check" class="size-5" />
        </span>
        <span>
          <strong>OpenExpert</strong>
          <small>bezpieczna decyzja klienta</small>
        </span>
      </header>

      <UCard class="consent-card">
        <template #header>
          <div class="consent-card__header">
            <div>
              <p class="consent-card__eyebrow">
                {{ request?.intent === 'withdraw' ? 'Wycofanie zgody' : 'Decyzja dotycząca zgody' }}
              </p>
              <h1>{{ request?.consent.title ?? 'Potwierdź swoją decyzję' }}</h1>
              <p v-if="request?.organizationName" class="consent-card__organization">
                {{ request.organizationName }}
              </p>
            </div>
            <UBadge
              v-if="request?.consent.version"
              color="neutral"
              variant="subtle"
              :label="`Wersja ${request.consent.version}`"
            />
          </div>
        </template>

        <div v-if="loadStatus === 'pending'" class="consent-loading" aria-live="polite">
          <USkeleton class="h-5 w-3/4" />
          <USkeleton class="h-24 w-full" />
          <USkeleton class="h-12 w-full" />
        </div>

        <UAlert
          v-else-if="loadError || !request"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-link-2-off"
          title="Nie można otworzyć tego linku"
          description="Link jest nieprawidłowy albo nie jest już dostępny. Poproś doradcę o nową wiadomość."
        >
          <template #actions>
            <UButton
              color="error"
              variant="outline"
              icon="i-lucide-refresh-cw"
              label="Spróbuj ponownie"
              @click="refresh()"
            />
          </template>
        </UAlert>

        <template v-else>
          <UAlert
            v-if="request.stage === 'complete'"
            color="success"
            variant="subtle"
            :icon="completedCopy.icon"
            :title="completedCopy.title"
            :description="completedCopy.description"
          />

          <UAlert
            v-else-if="request.stage === 'unavailable'"
            color="warning"
            variant="subtle"
            icon="i-lucide-clock-alert"
            :title="unavailableCopy.title"
            :description="unavailableCopy.description"
          />

          <template v-else>
            <section class="consent-copy" aria-labelledby="consent-content-title">
              <h2 id="consent-content-title">
                Treść zgody
              </h2>
              <p>{{ request.consent.content }}</p>

              <dl class="consent-details">
                <div>
                  <dt>Cel</dt>
                  <dd>{{ request.consent.purpose }}</dd>
                </div>
                <div>
                  <dt>Kanał</dt>
                  <dd>{{ channelLabel }}</dd>
                </div>
                <div>
                  <dt>Podstawa prawna</dt>
                  <dd>{{ request.consent.legalBasis }}</dd>
                </div>
              </dl>
            </section>

            <section v-if="request.stage === 'otp'" class="consent-action">
              <div class="consent-action__heading">
                <span class="consent-action__icon">
                  <UIcon name="i-lucide-message-square-lock" class="size-5" />
                </span>
                <div>
                  <h2>Potwierdź numer telefonu</h2>
                  <p>
                    Wpisz kod wysłany na numer {{ request.maskedPhone }}.
                    <template v-if="expiryLabel">
                      Link jest ważny do <time :datetime="request.expiresAt">{{ expiryLabel }}</time>.
                    </template>
                  </p>
                </div>
              </div>

              <UAlert
                v-if="demoAutoFilled"
                color="warning"
                variant="subtle"
                icon="i-lucide-flask-conical"
                title="Tryb demo"
                description="SMS nie został wysłany. Kod testowy uzupełniliśmy automatycznie; jego weryfikacja nadal działa tak samo jak w docelowym procesie."
              />

              <form class="consent-otp-form" @submit.prevent="verifyOtp">
                <UFormField
                  name="code"
                  label="Kod jednorazowy"
                  :description="demoAutoFilled
                    ? `Kod demo wpisany automatycznie · pozostałe próby: ${request.attemptsRemaining}`
                    : `Pozostałe próby: ${request.attemptsRemaining}`"
                  required
                >
                  <UPinInput
                    v-model="otpDigits"
                    type="number"
                    otp
                    :length="6"
                    :separator="3"
                    size="xl"
                    autofocus
                    fixed
                    :disabled="verifyPending"
                    aria-label="Sześciocyfrowy kod jednorazowy"
                  />
                </UFormField>

                <UButton
                  type="submit"
                  block
                  size="lg"
                  color="primary"
                  icon="i-lucide-shield-check"
                  :loading="verifyPending"
                  label="Zweryfikuj kod"
                />
              </form>
            </section>

            <section v-else class="consent-action consent-decision">
              <div class="consent-action__heading">
                <span class="consent-action__icon">
                  <UIcon name="i-lucide-file-check-2" class="size-5" />
                </span>
                <div>
                  <h2>Wybierz decyzję</h2>
                  <p>Decyzja zostanie zapisana razem z dokładną wersją treści widoczną powyżej.</p>
                </div>
              </div>

              <UButton
                v-if="request.intent === 'withdraw'"
                type="button"
                block
                size="lg"
                color="error"
                icon="i-lucide-shield-off"
                :loading="decisionPending === 'withdrawn'"
                :disabled="Boolean(decisionPending)"
                label="Wycofaj zgodę"
                @click="submitDecision('withdrawn')"
              />

              <div v-else class="consent-decision__buttons">
                <UButton
                  type="button"
                  block
                  size="lg"
                  color="primary"
                  icon="i-lucide-check"
                  :loading="decisionPending === 'granted'"
                  :disabled="Boolean(decisionPending)"
                  label="Wyrażam zgodę"
                  @click="submitDecision('granted')"
                />
                <UButton
                  type="button"
                  block
                  size="lg"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-x"
                  :loading="decisionPending === 'declined'"
                  :disabled="Boolean(decisionPending)"
                  label="Nie wyrażam zgody"
                  @click="submitDecision('declined')"
                />
              </div>
            </section>
          </template>

          <UAlert
            v-if="actionError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :description="actionError"
          />
        </template>
      </UCard>

      <footer class="consent-page__footer">
        <UIcon name="i-lucide-lock-keyhole" class="size-4" />
        Kod jest jednorazowy. OpenExpert nie poprosi Cię w tym miejscu o hasło ani dane płatnicze.
      </footer>
    </UContainer>
  </main>
</template>

<style scoped>
.consent-page {
  min-height: 100dvh;
  padding: 24px 0 32px;
  background:
    radial-gradient(
      circle at 50% 0%,
      color-mix(in srgb, var(--ui-primary) 12%, transparent),
      transparent 42%
    ),
    var(--ui-bg);
}

.consent-page__container {
  width: min(100%, 720px);
}

.consent-page__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  margin: 0 auto 20px;
  color: var(--ui-text-highlighted);
}

.consent-page__brand-mark,
.consent-action__icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 14px;
  color: var(--ui-primary);
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg-elevated));
}

.consent-page__brand > span:last-child {
  display: grid;
  gap: 1px;
}

.consent-page__brand strong {
  font-size: 15px;
  line-height: 1.2;
}

.consent-page__brand small {
  color: var(--ui-text-muted);
  font-size: 11px;
}

.consent-card {
  border-color: var(--ui-border-accented);
  box-shadow: 0 28px 80px color-mix(in srgb, var(--ui-bg-inverted) 10%, transparent);
}

.consent-card :deep(.divide-y) {
  display: grid;
  gap: 24px;
}

.consent-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.consent-card__eyebrow {
  margin: 0 0 6px;
  color: var(--ui-primary);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.consent-card h1 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(22px, 5vw, 30px);
  font-weight: 720;
  line-height: 1.18;
  letter-spacing: -0.025em;
}

.consent-card__organization {
  margin: 7px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.consent-loading,
.consent-copy,
.consent-action,
.consent-otp-form {
  display: grid;
  gap: 16px;
}

.consent-copy h2,
.consent-action h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 680;
}

.consent-copy > p {
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.consent-details {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 14px;
  border: 1px solid var(--ui-border-muted);
  border-radius: 14px;
  background: var(--ui-bg-muted);
}

.consent-details > div {
  display: grid;
  grid-template-columns: minmax(104px, 0.35fr) 1fr;
  gap: 12px;
}

.consent-details dt,
.consent-details dd {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
}

.consent-details dt {
  color: var(--ui-text-muted);
  font-weight: 650;
}

.consent-details dd {
  color: var(--ui-text-toned);
}

.consent-action {
  padding-top: 22px;
  border-top: 1px solid var(--ui-border-muted);
}

.consent-action__heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.consent-action__heading > div:last-child {
  display: grid;
  gap: 4px;
}

.consent-action__heading p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.consent-otp-form :deep([data-slot="root"]) {
  width: 100%;
}

.consent-otp-form :deep([data-slot="base"]) {
  justify-content: center;
}

.consent-decision__buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.consent-page__footer {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  max-width: 560px;
  margin: 18px auto 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
}

.consent-page__footer :deep(svg) {
  flex: 0 0 auto;
  margin-top: 1px;
}

@media (max-width: 520px) {
  .consent-page {
    padding-top: 16px;
  }

  .consent-page__container {
    padding-inline: 14px;
  }

  .consent-card__header {
    display: grid;
  }

  .consent-details > div,
  .consent-decision__buttons {
    grid-template-columns: 1fr;
  }
}
</style>
