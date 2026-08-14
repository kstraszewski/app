<script setup lang="ts">
import {
  maskOpenExpertPhone,
  normalizeOpenExpertPhone,
} from '@openexpert/auth'

definePageMeta({ middleware: 'guest' })

type LoginMode = 'email' | 'phone'
type SocialProvider = 'google' | 'apple'
type LoadingAction = 'password' | 'magic' | 'phone-send' | 'phone-verify' | 'passkey' | SocialProvider

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const hasAuthConfig = useHasAuthConfig()
const authClient = hasAuthConfig ? useAuthClient() : null
const redirectCookie = useAuthCookieRedirect()
const { callbackUrl, errorMessage, resolvePostAuthPath, safeRedirect, syncAuthenticatedUser } = useAuthFlow()

const email = ref(typeof route.query.email === 'string' ? route.query.email : '')
const password = ref('')
const passwordVisible = ref(false)
const loginMode = ref<LoginMode>(route.query.mode === 'phone' ? 'phone' : 'email')
const phone = ref(typeof route.query.phone === 'string' ? route.query.phone : '')
const verifiedPhone = ref('')
const phoneStep = ref<'number' | 'code'>('number')
const phoneCode = ref<number[]>([])
const phoneCooldown = ref(0)
const demoCodeUsed = ref(false)
const passkeySupported = ref(false)
const loading = ref<LoadingAction | null>(null)
const error = ref<string | null>(null)
const magicLinkSent = ref(false)
let cooldownTimer: ReturnType<typeof setInterval> | null = null

const registered = computed(() => route.query.registered === '1')
const registrationClosed = computed(() => route.query.registration === 'closed')
const passwordChanged = computed(() => route.query.passwordChanged === '1')
const intendedDestination = computed(() => safeRedirect(route.query.redirect))
const social = computed(() => runtimeConfig.public.openexpert.social)
const phoneEnabled = computed(() => runtimeConfig.public.openexpert.phone?.enabled === true)
const passkeyEnabled = computed(() => runtimeConfig.public.openexpert.passkey?.enabled === true)
const availableSocialProviders = computed<SocialProvider[]>(() => (
  (['google', 'apple'] as const).filter(provider => social.value?.[provider] === true)
))

function togglePasswordVisibility() {
  passwordVisible.value = !passwordVisible.value
}

function selectMode(mode: LoginMode) {
  loginMode.value = mode
  error.value = null
  magicLinkSent.value = false
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

function resetPhoneStep() {
  phoneStep.value = 'number'
  phoneCode.value = []
  verifiedPhone.value = ''
  demoCodeUsed.value = false
  error.value = null
}

useHead({ title: 'Logowanie — OpenExpert CRM' })

onBeforeUnmount(() => {
  if (cooldownTimer) clearInterval(cooldownTimer)
})

onMounted(() => {
  passkeySupported.value = window.isSecureContext && 'PublicKeyCredential' in window
})

async function finishLogin() {
  const authenticated = await syncAuthenticatedUser()
  if (!authenticated) {
    error.value = 'Sesja nie została poprawnie zapisana. Spróbuj ponownie.'
    return
  }
  const savedPath = redirectCookie.pluck()
  const requested = safeRedirect(route.query.redirect, safeRedirect(savedPath))
  await navigateTo(await resolvePostAuthPath(requested))
}

async function signInWithPassword() {
  error.value = null
  if (!authClient) return
  loading.value = 'password'
  try {
    if (intendedDestination.value) redirectCookie.set(intendedDestination.value)
    const result = await authClient.signIn.email({
      email: email.value.trim().toLowerCase(),
      password: password.value,
    })
    if (result.error) {
      error.value = errorMessage(result.error)
      return
    }
    if (
      result.data
      && 'twoFactorRedirect' in result.data
      && result.data.twoFactorRedirect === true
    ) return
    await finishLogin()
  }
  catch (sessionError) {
    error.value = errorMessage(sessionError as { message?: string })
  }
  finally {
    loading.value = null
  }
}

async function sendMagicLink() {
  error.value = null
  if (!authClient) return
  if (!email.value.trim()) {
    error.value = 'Podaj adres email.'
    return
  }

  loading.value = 'magic'
  try {
    await $fetch('/api/auth/existing-magic-link', {
      method: 'POST',
      body: {
        email: email.value.trim().toLowerCase(),
        callbackURL: callbackUrl('/confirm', intendedDestination.value),
        errorCallbackURL: callbackUrl('/confirm', intendedDestination.value),
      },
    })
    magicLinkSent.value = true
  }
  catch (magicError) {
    error.value = errorMessage(magicError as {
      message?: string
      status?: number
      statusCode?: number
      data?: { message?: string, code?: string }
    })
  }
  finally {
    loading.value = null
  }
}

async function requestPhoneCode() {
  error.value = null
  if (!authClient || !phoneEnabled.value || loading.value) return
  const normalized = normalizeOpenExpertPhone(phone.value)
  if (!normalized) {
    error.value = 'Podaj poprawny numer telefonu z kodem kraju.'
    return
  }

  loading.value = 'phone-send'
  try {
    const result = await $fetch<{ status: boolean, devOtp?: string }>(
      '/api/auth/existing-phone-otp',
      { method: 'POST', body: { phoneNumber: normalized } },
    )
    verifiedPhone.value = normalized
    phone.value = normalized
    phoneStep.value = 'code'
    phoneCode.value = result.devOtp ? [...result.devOtp].map(Number) : []
    demoCodeUsed.value = Boolean(result.devOtp)
    startCooldown()
  }
  catch (phoneError) {
    error.value = errorMessage(phoneError as {
      message?: string
      status?: number
      statusCode?: number
      data?: { message?: string, code?: string }
    })
  }
  finally {
    loading.value = null
  }
}

async function verifyPhoneCode() {
  error.value = null
  if (!authClient || loading.value) return
  const code = phoneCode.value.join('')
  if (!/^\d{6}$/.test(code)) {
    error.value = 'Wpisz pełny sześciocyfrowy kod.'
    return
  }

  loading.value = 'phone-verify'
  try {
    const result = await authClient.phoneNumber.verify({
      phoneNumber: verifiedPhone.value,
      code,
    })
    if (result.error) throw result.error
    await finishLogin()
  }
  catch (phoneError) {
    error.value = errorMessage(phoneError as { message?: string, code?: string })
  }
  finally {
    loading.value = null
  }
}

async function signInWithSocial(provider: SocialProvider) {
  error.value = null
  if (!authClient || social.value?.[provider] !== true || loading.value) return
  loading.value = provider
  try {
    const result = await authClient.signIn.social({
      provider,
      callbackURL: callbackUrl('/confirm', intendedDestination.value),
      errorCallbackURL: callbackUrl('/confirm', intendedDestination.value),
    })
    if (result.error) throw result.error
  }
  catch (socialError) {
    error.value = errorMessage(socialError as { message?: string, code?: string })
    loading.value = null
  }
}

async function signInWithPasskey() {
  error.value = null
  if (!authClient || !passkeyEnabled.value || loading.value) return
  if (!passkeySupported.value) {
    error.value = 'Ta przeglądarka lub bieżące połączenie nie obsługuje kluczy dostępu.'
    return
  }

  loading.value = 'passkey'
  try {
    const result = await authClient.signIn.passkey()
    if (result.error) throw result.error
    await finishLogin()
  }
  catch (passkeyError) {
    error.value = errorMessage(passkeyError as { message?: string, code?: string })
  }
  finally {
    loading.value = null
  }
}
</script>

<template>
  <AuthShell
    badge="Bezpieczne logowanie"
    icon="i-lucide-lock-keyhole"
    title="Witaj ponownie"
    description="Zaloguj się do panelu swojej organizacji."
  >
    <div class="login-content">
      <UAlert
        v-if="registered"
        color="success"
        variant="subtle"
        icon="i-lucide-badge-check"
        title="Email potwierdzony"
        description="Twoje konto jest gotowe. Możesz się zalogować."
      />

      <UAlert
        v-if="registrationClosed"
        color="neutral"
        variant="subtle"
        icon="i-lucide-user-lock"
        title="Rejestracja jest wyłączona"
        description="Dostęp do OpenExpert przyznaje administrator."
      />

      <UAlert
        v-if="passwordChanged"
        color="success"
        variant="subtle"
        icon="i-lucide-key-round"
        title="Hasło zostało zmienione"
      />

      <UAlert
        v-if="magicLinkSent"
        color="success"
        variant="subtle"
        icon="i-lucide-mail-check"
        title="Sprawdź skrzynkę"
        description="Jeśli konto istnieje, wysłaliśmy jednorazowy link logowania."
      >
        <template #actions>
          <UButton color="neutral" variant="outline" @click="magicLinkSent = false">
            Użyj innej metody
          </UButton>
        </template>
      </UAlert>

      <template v-else>
        <div class="login-method-switch" role="tablist" aria-label="Metoda logowania">
          <button
            class="login-method-switch__button"
            type="button"
            role="tab"
            :aria-selected="loginMode === 'email'"
            :class="{ 'login-method-switch__button--active': loginMode === 'email' }"
            @click="selectMode('email')"
          >
            <UIcon name="i-lucide-mail" />
            E-mail
          </button>
          <button
            class="login-method-switch__button"
            type="button"
            role="tab"
            :aria-selected="loginMode === 'phone'"
            :disabled="!phoneEnabled"
            :class="{ 'login-method-switch__button--active': loginMode === 'phone' }"
            @click="selectMode('phone')"
          >
            <UIcon name="i-lucide-smartphone" />
            Telefon
          </button>
        </div>

        <form v-if="loginMode === 'email'" class="login-form" @submit.prevent="signInWithPassword">
          <UFormField label="Email" required>
            <UInput
              v-model="email"
              type="email"
              autocomplete="username webauthn"
              required
              placeholder="twoj@email.pl"
              icon="i-lucide-mail"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Hasło" required>
            <UInput
              v-model="password"
              :type="passwordVisible ? 'text' : 'password'"
              autocomplete="current-password webauthn"
              required
              placeholder="Twoje hasło"
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
                  @click="togglePasswordVisibility"
                />
              </template>
            </UInput>
          </UFormField>

          <div class="login-form__help">
            <NuxtLink to="/forgot-password">Nie pamiętam hasła</NuxtLink>
          </div>

          <UButton
            type="submit"
            block
            variant="solid"
            size="lg"
            icon="i-lucide-log-in"
            :loading="loading === 'password'"
          >
            Zaloguj się
          </UButton>

          <UButton
            type="button"
            block
            color="neutral"
            variant="outline"
            size="lg"
            icon="i-lucide-wand-sparkles"
            :loading="loading === 'magic'"
            @click="sendMagicLink"
          >
            Zaloguj się linkiem
          </UButton>

          <p class="login-form__hint">Wyślemy jednorazowy link na podany adres e-mail.</p>
        </form>

        <form v-else-if="phoneStep === 'number'" class="login-form" @submit.prevent="requestPhoneCode">
          <UFormField label="Numer telefonu" description="Użyj numeru wcześniej zweryfikowanego w ustawieniach konta." required>
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
          <UButton
            type="submit"
            block
            size="lg"
            icon="i-lucide-message-square-text"
            :loading="loading === 'phone-send'"
          >
            Wyślij kod SMS
          </UButton>
          <NuxtLink class="login-form__recovery" to="/forgot-password?mode=phone">
            Odzyskaj dostęp telefonem
          </NuxtLink>
        </form>

        <form v-else class="login-form" @submit.prevent="verifyPhoneCode">
          <div class="phone-code-intro">
            <span><UIcon name="i-lucide-message-square-check" /></span>
            <div>
              <strong>Wpisz kod z SMS-a</strong>
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
          <UButton
            type="submit"
            block
            size="lg"
            icon="i-lucide-shield-check"
            :loading="loading === 'phone-verify'"
          >
            Potwierdź i zaloguj
          </UButton>
          <div class="phone-code-actions">
            <UButton type="button" color="neutral" variant="ghost" @click="resetPhoneStep">
              Zmień numer
            </UButton>
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              :disabled="phoneCooldown > 0"
              :loading="loading === 'phone-send'"
              @click="requestPhoneCode"
            >
              {{ phoneCooldown > 0 ? `Wyślij ponownie za ${phoneCooldown} s` : 'Wyślij ponownie' }}
            </UButton>
          </div>
        </form>

        <template v-if="passkeyEnabled || availableSocialProviders.length">
          <div class="login-divider"><span>lub</span></div>
          <UButton
            v-if="passkeyEnabled"
            type="button"
            block
            color="neutral"
            variant="outline"
            size="lg"
            icon="i-lucide-fingerprint"
            :loading="loading === 'passkey'"
            :disabled="!passkeySupported"
            @click="signInWithPasskey"
          >
            Zaloguj się kluczem dostępu
          </UButton>
          <div class="social-login-grid">
            <UButton
              v-for="provider in availableSocialProviders"
              :key="provider"
              type="button"
              block
              color="neutral"
              variant="outline"
              size="lg"
              :icon="provider === 'google' ? 'i-lucide-circle-user-round' : 'i-lucide-scan-face'"
              :loading="loading === provider"
              @click="signInWithSocial(provider)"
            >
              Kontynuuj z {{ provider === 'google' ? 'Google' : 'Apple' }}
            </UButton>
          </div>
        </template>

        <UAlert
          v-if="error"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :description="error"
        />
      </template>
    </div>

    <template #footer>
      Dostęp jest przyznawany przez administratora OpenExpert.
    </template>
  </AuthShell>
</template>

<style scoped>
.login-content,
.login-form {
  display: grid;
}

.login-content {
  gap: 18px;
}

.login-form {
  gap: 16px;
}

.login-method-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.login-method-switch__button {
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

.login-method-switch__button--active {
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}

.login-method-switch__button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.login-form__help {
  margin-top: -5px;
  text-align: right;
}

.login-form__help a,
.login-form__recovery {
  color: var(--ui-text-toned);
  font-size: 13px;
  font-weight: 500;
  text-align: center;
  text-decoration: none;
  transition: color var(--oe-motion-fast);
}

.login-form__help a:hover,
.login-form__recovery:hover {
  color: var(--ui-text-highlighted);
}

.login-form__hint {
  margin-top: -8px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.45;
  text-align: center;
}

.phone-code-intro {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.phone-code-intro > span {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: var(--ui-bg);
  color: var(--ui-text-toned);
}

.phone-code-intro strong,
.phone-code-intro small {
  display: block;
}

.phone-code-intro strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.phone-code-intro small {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.phone-code-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.login-divider {
  display: flex;
  align-items: center;
  color: var(--ui-text-dimmed);
  font-size: 11px;
  text-transform: uppercase;
}

.login-divider::before,
.login-divider::after {
  height: 1px;
  flex: 1;
  background: var(--ui-border-muted);
  content: '';
}

.login-divider span {
  padding: 0 12px;
}

.social-login-grid {
  display: grid;
  gap: 10px;
}
</style>
