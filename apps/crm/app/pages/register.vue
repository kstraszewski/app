<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'
import { APPLICATION_MONTHLY_PLAN } from '#shared/organization-billing'
import type {
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

function maskEmail(value: string): string {
  const [local = '', domain = ''] = value.split('@')
  if (!local || !domain) return value
  return `${local.slice(0, Math.min(2, local.length))}${'•'.repeat(Math.max(3, local.length - 2))}@${domain}`
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
    await $fetch<StartApplicationRegistrationResponse>('/api/registration/start', {
      method: 'POST',
      body,
    })
    submittedRequest.value = body
  }
  catch (caught: unknown) {
    error.value = apiErrorMessage(caught) || 'Nie udało się rozpocząć rejestracji. Spróbuj ponownie.'
  }
  finally {
    submitting.value = false
  }
}

function editRegistration() {
  submittedRequest.value = null
  error.value = ''
}
</script>

<template>
  <AuthShell
    badge="Aplikacja dla zespołu"
    icon="i-lucide-building-2"
    :title="submittedRequest ? 'Sprawdź swoją skrzynkę' : 'Załóż organizację'"
    :description="submittedRequest
      ? 'Wysłaliśmy instrukcję potwierdzenia adresu i dokończenia onboardingu.'
      : 'Wybierz liczbę użytkowników, potwierdź email i opłać subskrypcję w Stripe.'"
  >
    <div v-if="submittedRequest" class="registration-resume" aria-live="polite">
      <UAlert
        color="success"
        variant="subtle"
        icon="i-lucide-mail-check"
        title="Link rejestracyjny został zlecony"
        :description="`Jeśli dane są poprawne, wiadomość trafi na ${maskEmail(submittedRequest.email)}.`"
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
        Zmień dane lub wyślij ponownie
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
