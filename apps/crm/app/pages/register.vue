<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'
import { APPLICATION_MONTHLY_PLAN } from '#shared/organization-billing'
import type {
  ApplicationRegistrationDeliveryStatus,
  ApplicationRegistrationDeliveryStatusResponse,
  StartApplicationRegistrationBody,
  StartApplicationRegistrationResponse,
} from '#shared/types/system-organizations'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ layout: false })

useHead({
  title: 'Załóż organizację — OpenExpert CRM',
  meta: [
    { name: 'robots', content: 'noindex, nofollow' },
    { name: 'referrer', content: 'no-referrer' },
  ],
})

const route = useRoute()
const authenticatedUser = useAuthUser()

function firstQueryValue(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function requestedSeatCount(): number {
  const raw = firstQueryValue(route.query.seats)
    || firstQueryValue(route.query.initialSeatCount)
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 1 && value <= 100 ? value : 1
}

const registrationSchema = z.object({
  administratorName: z.string().trim()
    .min(1, 'Podaj imię i nazwisko administratora.')
    .max(200, 'Imię i nazwisko może mieć maksymalnie 200 znaków.'),
  email: z.string().trim()
    .email('Podaj poprawny adres email.')
    .max(320, 'Adres email jest za długi.'),
  organizationName: z.string().trim()
    .min(1, 'Podaj nazwę organizacji.')
    .max(160, 'Nazwa organizacji może mieć maksymalnie 160 znaków.'),
  initialSeatCount: z.number({ message: 'Podaj liczbę użytkowników.' })
    .int('Liczba użytkowników musi być całkowita.')
    .min(1, 'Wybierz co najmniej jednego użytkownika.')
    .max(100, 'W rejestracji możesz wybrać maksymalnie 100 użytkowników.'),
})
type RegistrationSchema = z.output<typeof registrationSchema>

const state = reactive<RegistrationSchema>({
  administratorName: authenticatedUser.value?.name || '',
  email: authenticatedUser.value?.email || firstQueryValue(route.query.email),
  organizationName: '',
  initialSeatCount: requestedSeatCount(),
})
const submitting = ref(false)
const error = ref('')
const submittedRequest = ref<StartApplicationRegistrationBody | null>(null)
const deliveryStatus = ref<ApplicationRegistrationDeliveryStatus | null>(null)
const deliveryStatusUncertain = ref(false)
let deliveryPollTimer: ReturnType<typeof setTimeout> | undefined
let deliveryPollGeneration = 0

function stopDeliveryPolling() {
  deliveryPollGeneration += 1
  if (deliveryPollTimer) clearTimeout(deliveryPollTimer)
  deliveryPollTimer = undefined
}

onBeforeUnmount(stopDeliveryPolling)

watch(authenticatedUser, (user) => {
  if (!user || submittedRequest.value) return
  state.email = user.email
  if (!state.administratorName) state.administratorName = user.name
}, { immediate: true })

const monthlyTotalMinor = computed(() => (
  state.initialSeatCount * APPLICATION_MONTHLY_PLAN.unitAmount
))
const formattedMonthlyTotal = computed(() => new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
}).format(monthlyTotalMinor.value / 100))
const loginTarget = computed(() => ({
  path: '/login',
  query: {
    email: state.email || undefined,
    redirect: `/register?seats=${state.initialSeatCount}`,
  },
}))
const submittedTitle = computed(() => {
  if (deliveryStatus.value === 'sent') return 'Sprawdź swoją skrzynkę'
  if (deliveryStatus.value === 'failed') return 'Nie udało się wysłać wiadomości'
  if (deliveryStatus.value === 'expired') return 'Prośba rejestracyjna wygasła'
  return 'Przygotowujemy wiadomość'
})
const submittedDescription = computed(() => {
  if (deliveryStatus.value === 'sent') {
    return 'Wiadomość z instrukcją potwierdzenia adresu została przyjęta do wysyłki.'
  }
  if (deliveryStatus.value === 'failed') {
    return 'Nie obciążyliśmy karty. Popraw dane lub spróbuj ponownie.'
  }
  if (deliveryStatus.value === 'expired') {
    return 'Rozpocznij rejestrację ponownie, aby otrzymać nowy link.'
  }
  return 'Trwa bezpieczne przygotowanie linku rejestracyjnego.'
})

function maskEmail(value: string): string {
  const [local = '', domain = ''] = value.split('@')
  if (!local || !domain) return value
  return `${local.slice(0, Math.min(2, local.length))}${'•'.repeat(Math.max(3, local.length - 2))}@${domain}`
}

async function pollDeliveryStatus(token: string, generation: number, attempt = 0) {
  if (generation !== deliveryPollGeneration) return
  try {
    const response = await $fetch<ApplicationRegistrationDeliveryStatusResponse>(
      '/api/registration/status',
      { method: 'POST', body: { token } },
    )
    if (generation !== deliveryPollGeneration) return
    deliveryStatus.value = response.status
    deliveryStatusUncertain.value = false
    if (response.status !== 'queued') return
  }
  catch {
    if (generation !== deliveryPollGeneration) return
    if (attempt >= 2) deliveryStatusUncertain.value = true
  }

  if (attempt >= 20) {
    deliveryStatusUncertain.value = true
    return
  }
  deliveryPollTimer = setTimeout(() => {
    void pollDeliveryStatus(token, generation, attempt + 1)
  }, attempt < 4 ? 1_000 : 2_000)
}

function startDeliveryPolling(token: string) {
  stopDeliveryPolling()
  deliveryStatus.value = 'queued'
  deliveryStatusUncertain.value = false
  const generation = deliveryPollGeneration
  void pollDeliveryStatus(token, generation)
}

async function startRegistration(event: FormSubmitEvent<RegistrationSchema>) {
  if (submitting.value) return
  submitting.value = true
  error.value = ''
  const body: StartApplicationRegistrationBody = {
    administratorName: event.data.administratorName,
    email: event.data.email.trim().toLowerCase(),
    organizationName: event.data.organizationName,
    initialSeatCount: event.data.initialSeatCount,
  }

  try {
    const response = await $fetch<StartApplicationRegistrationResponse>('/api/registration/start', {
      method: 'POST',
      body,
    })
    if (!response.statusToken) throw new Error('Registration status token is missing')
    submittedRequest.value = body
    startDeliveryPolling(response.statusToken)
  }
  catch (caught: unknown) {
    error.value = apiErrorMessage(caught) || 'Nie udało się rozpocząć rejestracji. Spróbuj ponownie.'
  }
  finally {
    submitting.value = false
  }
}

function editRegistration() {
  stopDeliveryPolling()
  submittedRequest.value = null
  deliveryStatus.value = null
  deliveryStatusUncertain.value = false
  error.value = ''
}
</script>

<template>
  <AuthShell
    badge="Aplikacja dla zespołu"
    icon="i-lucide-building-2"
    :title="submittedRequest ? submittedTitle : 'Załóż organizację'"
    :description="submittedRequest
      ? submittedDescription
      : 'Wybierz liczbę użytkowników, potwierdź email i opłać subskrypcję w Stripe.'"
  >
    <div v-if="submittedRequest" class="registration-resume" aria-live="polite">
      <UAlert
        v-if="deliveryStatus === 'sent'"
        color="success"
        variant="subtle"
        icon="i-lucide-mail-check"
        title="Wiadomość została wysłana"
        :description="`Link rejestracyjny został przekazany na ${maskEmail(submittedRequest.email)}.`"
      />
      <UAlert
        v-else-if="deliveryStatus === 'failed'"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-mail-x"
        title="Wysyłka nie powiodła się"
        description="Nie obciążyliśmy karty. Sprawdź adres email i wyślij formularz ponownie."
      />
      <UAlert
        v-else-if="deliveryStatus === 'expired'"
        role="alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-clock-alert"
        title="Link nie jest już dostępny"
        description="Rozpocznij rejestrację ponownie, aby otrzymać nową wiadomość."
      />
      <UAlert
        v-else
        color="info"
        variant="subtle"
        icon="i-lucide-loader-circle"
        title="Wysyłka wiadomości trwa"
        :description="`Przygotowujemy bezpieczny link dla ${maskEmail(submittedRequest.email)}.`"
      />
      <UAlert
        v-if="deliveryStatusUncertain && deliveryStatus === 'queued'"
        role="status"
        color="warning"
        variant="subtle"
        icon="i-lucide-wifi-off"
        title="Nie możemy teraz potwierdzić wysyłki"
        description="Sprawdź skrzynkę i spam. Jeśli wiadomość nie dotrze, wróć do formularza i spróbuj ponownie."
      />

      <ol class="registration-steps">
        <li>
          <span>1</span>
          <div><strong>Otwórz wiadomość</strong><small>Link jest jednorazowy i ważny przez godzinę.</small></div>
        </li>
        <li>
          <span>2</span>
          <div><strong>Potwierdź konto administratora</strong><small>Jeśli masz już konto, użyjemy tej samej tożsamości.</small></div>
        </li>
        <li>
          <span>3</span>
          <div><strong>Opłać {{ submittedRequest.initialSeatCount }} miejsc</strong><small>Checkout Stripe uruchomi organizację po płatności.</small></div>
        </li>
      </ol>

      <UButton
        block
        color="neutral"
        variant="outline"
        icon="i-lucide-pencil"
        @click="editRegistration"
      >
        {{ deliveryStatus === 'failed' || deliveryStatus === 'expired'
          ? 'Popraw dane i spróbuj ponownie'
          : 'Zmień dane lub wyślij ponownie' }}
      </UButton>
    </div>

    <UForm
      v-else
      :schema="registrationSchema"
      :state="state"
      class="registration-form"
      @submit="startRegistration"
    >
      <UAlert
        v-if="authenticatedUser"
        color="info"
        variant="subtle"
        icon="i-lucide-user-check"
        title="Użyjemy Twojego obecnego konta"
        :description="`Nowa organizacja zostanie przypisana do ${authenticatedUser.email}.`"
      />

      <UFormField name="administratorName" label="Imię i nazwisko administratora" required>
        <UInput
          v-model="state.administratorName"
          autocomplete="name"
          maxlength="200"
          icon="i-lucide-user"
          class="w-full"
          :disabled="submitting"
        />
      </UFormField>

      <UFormField name="email" label="Email administratora" required>
        <UInput
          v-model="state.email"
          type="email"
          autocomplete="email"
          maxlength="320"
          icon="i-lucide-mail"
          class="w-full"
          :readonly="Boolean(authenticatedUser)"
          :disabled="submitting"
        />
      </UFormField>

      <UFormField name="organizationName" label="Nazwa organizacji" required>
        <UInput
          v-model="state.organizationName"
          autocomplete="organization"
          maxlength="160"
          icon="i-lucide-building-2"
          class="w-full"
          :disabled="submitting"
        />
      </UFormField>

      <UFormField
        name="initialSeatCount"
        label="Liczba użytkowników na start"
        description="Administrator zajmuje pierwsze miejsce. Pozostałe osoby zaprosisz po aktywacji."
        required
      >
        <UInputNumber
          v-model="state.initialSeatCount"
          :min="1"
          :max="100"
          :step="1"
          class="w-full"
          :disabled="submitting"
        />
      </UFormField>

      <div class="registration-price" aria-live="polite">
        <div>
          <span>{{ state.initialSeatCount }} × 200 zł</span>
          <strong>{{ formattedMonthlyTotal }}<small> / miesiąc</small></strong>
        </div>
        <ul>
          <li><UIcon name="i-lucide-check" /> Płatność kartą w bezpiecznym Stripe Checkout</li>
          <li><UIcon name="i-lucide-check" /> Opcjonalny kod promocyjny wpiszesz przy płatności</li>
          <li><UIcon name="i-lucide-check" /> Dopiero miejsca ponad zakupiony limit zwiększą subskrypcję</li>
        </ul>
      </div>

      <UAlert
        v-if="error"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :description="error"
      />

      <UButton
        type="submit"
        block
        size="lg"
        icon="i-lucide-arrow-right"
        :loading="submitting"
      >
        Wyślij link i przejdź do płatności
      </UButton>

      <p class="registration-consent">
        Płatność nastąpi dopiero po potwierdzeniu adresu email. Samo wysłanie formularza nie obciąża karty.
      </p>
    </UForm>

    <template #footer>
      Masz już konto?
      <NuxtLink :to="loginTarget">Zaloguj się</NuxtLink>
    </template>
  </AuthShell>
</template>

<style scoped>
.registration-form,
.registration-resume {
  display: grid;
  gap: 18px;
}

.registration-price {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--ui-border-accented);
  border-radius: 14px;
  background: var(--ui-bg-muted);
}

.registration-price > div {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.registration-price span,
.registration-price strong,
.registration-price small {
  display: block;
}

.registration-price span {
  color: var(--ui-text-toned);
  font-size: 13px;
}

.registration-price strong {
  color: var(--ui-text-highlighted);
  font-size: 22px;
  letter-spacing: -.025em;
  text-align: right;
}

.registration-price strong small {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
}

.registration-price ul,
.registration-steps {
  display: grid;
  gap: 9px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.registration-price li {
  display: flex;
  gap: 8px;
  align-items: start;
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 1.45;
}

.registration-price li :deep(svg) {
  margin-top: 2px;
  flex: 0 0 auto;
  color: var(--ui-success);
}

.registration-consent {
  margin: -6px 0 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
}

.registration-steps li {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.registration-steps li > span {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 50%;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 700;
}

.registration-steps strong,
.registration-steps small {
  display: block;
}

.registration-steps strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.registration-steps small {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

:deep(.auth-footer a) {
  margin-left: 4px;
  color: var(--ui-text-highlighted);
  font-weight: 600;
  text-decoration: none;
}
</style>
