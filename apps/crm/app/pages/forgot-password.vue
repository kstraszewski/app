<script setup lang="ts">
import {
  maskOpenExpertPhone,
  normalizeOpenExpertPhone,
} from '@openexpert/auth'

definePageMeta({ middleware: 'guest' })

type RecoveryMode = 'email' | 'phone'
type PhoneStep = 'number' | 'reset'

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const hasAuthConfig = useHasAuthConfig()
const authClient = hasAuthConfig ? useAuthClient() : null
const { errorMessage, passwordIssue } = useAuthFlow()

const mode = ref<RecoveryMode>(route.query.mode === 'phone' ? 'phone' : 'email')
const email = ref(typeof route.query.email === 'string' ? route.query.email : '')
const phone = ref(typeof route.query.phone === 'string' ? route.query.phone : '')
const verifiedPhone = ref('')
const phoneStep = ref<PhoneStep>('number')
const phoneCode = ref<number[]>([])
const password = ref('')
const confirmPassword = ref('')
const passwordVisible = ref(false)
const phoneCooldown = ref(0)
const demoCodeUsed = ref(false)
const loading = ref<'email' | 'phone-send' | 'phone-reset' | null>(null)
const sent = ref(false)
const error = ref<string | null>(null)
let cooldownTimer: ReturnType<typeof setInterval> | null = null

const phoneEnabled = computed(() => runtimeConfig.public.openexpert.phone?.enabled === true)

useHead({ title: 'Odzyskaj hasło — OpenExpert CRM' })

onBeforeUnmount(() => {
  if (cooldownTimer) clearInterval(cooldownTimer)
})

function selectMode(nextMode: RecoveryMode) {
  mode.value = nextMode
  error.value = null
  sent.value = false
}

function startCooldown() {
  phoneCooldown.value = 60
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    phoneCooldown.value = Math.max(0, phoneCooldown.value - 1)
    if (phoneCooldown.value === 0 && cooldownTimer) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }, 1000)
}

function resetPhoneNumber() {
  phoneStep.value = 'number'
  verifiedPhone.value = ''
  phoneCode.value = []
  password.value = ''
  confirmPassword.value = ''
  demoCodeUsed.value = false
  error.value = null
}

async function requestEmailReset() {
  error.value = null
  if (!authClient) return
  loading.value = 'email'
  try {
    const { error: resetError } = await authClient.requestPasswordReset({
      email: email.value.trim().toLowerCase(),
      redirectTo: '/reset-password',
    })
    if (resetError) throw resetError
    sent.value = true
  }
  catch (resetError) {
    error.value = errorMessage(resetError as { message?: string, code?: string })
  }
  finally {
    loading.value = null
  }
}

async function requestPhoneReset() {
  error.value = null
  if (!authClient || !phoneEnabled.value || loading.value) return
  const normalized = normalizeOpenExpertPhone(phone.value)
  if (!normalized) {
    error.value = 'Podaj poprawny numer telefonu z kodem kraju.'
    return
  }

  loading.value = 'phone-send'
  try {
    const result = await authClient.phoneNumber.requestPasswordReset({
      phoneNumber: normalized,
    })
    if (result.error) throw result.error

    verifiedPhone.value = normalized
    phone.value = normalized
    phoneStep.value = 'reset'
    phoneCode.value = []
    demoCodeUsed.value = false

    if (runtimeConfig.public.openexpert.phone?.demo === true) {
      const demo = await $fetch<{ code?: string }>('/api/auth/phone-demo-code', {
        query: { phoneNumber: normalized, purpose: 'password-reset' },
      }).catch(() => null)
      if (demo?.code) {
        phoneCode.value = [...demo.code].map(Number)
        demoCodeUsed.value = true
      }
    }
    startCooldown()
  }
  catch (resetError) {
    error.value = errorMessage(resetError as { message?: string, code?: string })
  }
  finally {
    loading.value = null
  }
}

async function resetPasswordByPhone() {
  error.value = null
  if (!authClient || loading.value) return
  const code = phoneCode.value.join('')
  if (!/^\d{6}$/.test(code)) {
    error.value = 'Wpisz pełny sześciocyfrowy kod.'
    return
  }
  const issue = passwordIssue(password.value)
  if (issue) {
    error.value = issue
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = 'Hasła nie są takie same.'
    return
  }

  loading.value = 'phone-reset'
  try {
    const result = await authClient.phoneNumber.resetPassword({
      phoneNumber: verifiedPhone.value,
      otp: code,
      newPassword: password.value,
    })
    if (result.error) throw result.error
    await navigateTo('/login?passwordChanged=1&mode=phone')
  }
  catch (resetError) {
    error.value = errorMessage(resetError as { message?: string, code?: string })
  }
  finally {
    loading.value = null
  }
}
</script>

<template>
  <AuthShell
    badge="Odzyskiwanie dostępu"
    icon="i-lucide-life-buoy"
    title="Ustaw nowe hasło"
    description="Wybierz bezpieczny sposób potwierdzenia swojej tożsamości."
  >
    <div class="recovery-content">
      <div class="recovery-method-switch" role="tablist" aria-label="Sposób odzyskania dostępu">
        <button
          class="recovery-method-switch__button"
          type="button"
          role="tab"
          :aria-selected="mode === 'email'"
          :class="{ 'recovery-method-switch__button--active': mode === 'email' }"
          @click="selectMode('email')"
        >
          <UIcon name="i-lucide-mail" />
          E-mail
        </button>
        <button
          class="recovery-method-switch__button"
          type="button"
          role="tab"
          :aria-selected="mode === 'phone'"
          :disabled="!phoneEnabled"
          :class="{ 'recovery-method-switch__button--active': mode === 'phone' }"
          @click="selectMode('phone')"
        >
          <UIcon name="i-lucide-smartphone" />
          Telefon
        </button>
      </div>

      <UAlert
        v-if="sent"
        color="success"
        variant="subtle"
        icon="i-lucide-mail-check"
        title="Sprawdź skrzynkę"
        description="Jeśli konto istnieje, otrzymasz wiadomość z dalszymi instrukcjami."
      >
        <template #actions>
          <UButton color="neutral" variant="outline" @click="sent = false">
            Użyj innej metody
          </UButton>
        </template>
      </UAlert>

      <form v-else-if="mode === 'email'" class="recovery-form" @submit.prevent="requestEmailReset">
        <UFormField label="Email" required>
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            required
            icon="i-lucide-mail"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UButton type="submit" block size="lg" icon="i-lucide-send" :loading="loading === 'email'">
          Wyślij link
        </UButton>

        <p class="recovery-hint">Jeśli konto istnieje, wyślemy jednorazowy link do ustawienia nowego hasła.</p>
      </form>

      <form v-else-if="phoneStep === 'number'" class="recovery-form" @submit.prevent="requestPhoneReset">
        <UFormField label="Zweryfikowany numer telefonu" required>
          <UInput
            v-model="phone"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            required
            placeholder="+48 501 234 567"
            icon="i-lucide-smartphone"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UButton type="submit" block size="lg" icon="i-lucide-message-square-text" :loading="loading === 'phone-send'">
          Wyślij kod SMS
        </UButton>

        <p class="recovery-hint">Kod otrzyma tylko numer wcześniej potwierdzony w ustawieniach konta.</p>
      </form>

      <form v-else class="recovery-form" @submit.prevent="resetPasswordByPhone">
        <div class="recovery-phone-intro">
          <span><UIcon name="i-lucide-message-square-check" /></span>
          <div>
            <strong>Kod z SMS-a</strong>
            <small>Wysłaliśmy go na {{ maskOpenExpertPhone(verifiedPhone) }}.</small>
          </div>
        </div>

        <UFormField label="Kod jednorazowy" required>
          <UPinInput
            v-model="phoneCode"
            type="number"
            otp
            :length="6"
            :separator="3"
            size="xl"
            class="justify-center"
          />
        </UFormField>

        <UAlert
          v-if="demoCodeUsed"
          color="warning"
          variant="subtle"
          icon="i-lucide-flask-conical"
          title="Tryb lokalny"
          description="SMS nie został wysłany; kod testowy uzupełniliśmy automatycznie."
        />

        <UFormField label="Nowe hasło" description="Minimum 10 znaków, mała i wielka litera oraz cyfra." required>
          <UInput
            v-model="password"
            :type="passwordVisible ? 'text' : 'password'"
            autocomplete="new-password"
            required
            icon="i-lucide-key-round"
            size="lg"
            class="w-full"
          >
            <template #trailing>
              <UButton
                type="button"
                color="neutral"
                variant="link"
                size="xs"
                :icon="passwordVisible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="passwordVisible ? 'Ukryj hasło' : 'Pokaż hasło'"
                @click="passwordVisible = !passwordVisible"
              />
            </template>
          </UInput>
        </UFormField>

        <UFormField label="Powtórz nowe hasło" required>
          <UInput
            v-model="confirmPassword"
            :type="passwordVisible ? 'text' : 'password'"
            autocomplete="new-password"
            required
            icon="i-lucide-shield-check"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <UButton type="submit" block size="lg" icon="i-lucide-key-round" :loading="loading === 'phone-reset'">
          Ustaw nowe hasło
        </UButton>

        <div class="recovery-actions">
          <UButton type="button" color="neutral" variant="ghost" @click="resetPhoneNumber">
            Zmień numer
          </UButton>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="phoneCooldown > 0"
            :loading="loading === 'phone-send'"
            @click="requestPhoneReset"
          >
            {{ phoneCooldown > 0 ? `Wyślij ponownie za ${phoneCooldown} s` : 'Wyślij ponownie' }}
          </UButton>
        </div>
      </form>

      <UAlert
        v-if="error"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :description="error"
      />
    </div>

    <template #footer>
      <NuxtLink to="/login" class="font-medium underline underline-offset-4">
        Wróć do logowania
      </NuxtLink>
    </template>
  </AuthShell>
</template>

<style scoped>
.recovery-content,
.recovery-form {
  display: grid;
}

.recovery-content {
  gap: 18px;
}

.recovery-form {
  gap: 16px;
}

.recovery-method-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.recovery-method-switch__button {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  border: 0;
  border-radius: calc(var(--ui-radius) - 3px);
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
}

.recovery-method-switch__button--active {
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.recovery-method-switch__button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.recovery-hint {
  margin: -6px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}

.recovery-phone-intro {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.recovery-phone-intro > span {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: var(--ui-bg);
  color: var(--ui-text-toned);
}

.recovery-phone-intro strong,
.recovery-phone-intro small {
  display: block;
}

.recovery-phone-intro strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.recovery-phone-intro small {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.recovery-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}
</style>
