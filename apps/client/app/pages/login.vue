<script setup lang="ts">
const route = useRoute()
const authClient = useAuthClient()
const runtimeConfig = useRuntimeConfig()
const { absoluteCallback, errorMessage, safeRedirect } = usePortalAuth()

const mode = ref<'magic' | 'password'>('magic')
const email = ref(typeof route.query.email === 'string' ? route.query.email : '')
const password = ref('')
const loading = ref<'magic' | 'password' | 'google' | 'apple' | null>(null)
const sent = ref(false)
const error = ref('')
const passwordVisible = ref(false)

const redirectPath = computed(() => safeRedirect(
  route.query.redirect ?? route.query.next,
  '/',
))
const social = computed(() => runtimeConfig.public.openexpert.social)

useHead({ title: 'Zaloguj się — panel klienta OpenExpert' })

async function sendMagicLink() {
  error.value = ''
  if (!email.value.trim()) {
    error.value = 'Podaj adres email przypisany do Twojej sprawy.'
    return
  }
  loading.value = 'magic'
  try {
    const callbackURL = absoluteCallback(redirectPath.value)
    const result = await authClient.signIn.magicLink({
      email: email.value.trim().toLowerCase(),
      callbackURL,
      newUserCallbackURL: callbackURL,
      errorCallbackURL: absoluteCallback(`/login?email=${encodeURIComponent(email.value)}`),
    })
    if (result.error) throw result.error
    sent.value = true
  }
  catch (signInError) {
    error.value = errorMessage(signInError as { message?: string, code?: string })
  }
  finally {
    loading.value = null
  }
}

async function signInWithPassword() {
  error.value = ''
  if (!email.value.trim() || !password.value) {
    error.value = 'Podaj email i hasło.'
    return
  }
  loading.value = 'password'
  try {
    const result = await authClient.signIn.email({
      email: email.value.trim().toLowerCase(),
      password: password.value,
    })
    if (result.error) throw result.error
    await refreshAuthUser()
    await navigateTo(redirectPath.value)
  }
  catch (signInError) {
    error.value = errorMessage(signInError as { message?: string, code?: string })
  }
  finally {
    loading.value = null
  }
}

async function signInSocial(provider: 'google' | 'apple') {
  error.value = ''
  loading.value = provider
  try {
    const result = await authClient.signIn.social({
      provider,
      callbackURL: absoluteCallback(redirectPath.value),
      errorCallbackURL: absoluteCallback('/login'),
    })
    if (result.error) throw result.error
  }
  catch (signInError) {
    error.value = errorMessage(signInError as { message?: string, code?: string })
    loading.value = null
  }
}

function changeMode(nextMode: 'magic' | 'password') {
  mode.value = nextMode
  error.value = ''
  sent.value = false
}
</script>

<template>
  <PortalAuthShell
    title="Witaj w swoim panelu"
    description="Zaloguj się tym samym adresem email, który został podany ekspertowi lub podczas rezerwacji spotkania."
  >
    <UAlert
      v-if="sent"
      color="success"
      variant="subtle"
      icon="i-lucide-mail-check"
      title="Sprawdź swoją skrzynkę"
      description="Wysłaliśmy jednorazowy link logowania. Dla bezpieczeństwa link może zostać użyty tylko raz."
      class="login-alert"
    >
      <template #actions>
        <UButton color="success" variant="ghost" @click="sent = false">
          Wyślij ponownie
        </UButton>
      </template>
    </UAlert>

    <div v-else class="login-form-wrap">
      <div class="login-modes" role="tablist" aria-label="Sposób logowania">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'magic'"
          :class="{ 'is-active': mode === 'magic' }"
          @click="changeMode('magic')"
        >
          Link na email
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'password'"
          :class="{ 'is-active': mode === 'password' }"
          @click="changeMode('password')"
        >
          Hasło
        </button>
      </div>

      <form class="login-form" @submit.prevent="mode === 'magic' ? sendMagicLink() : signInWithPassword()">
        <UFormField label="Adres email" required>
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            icon="i-lucide-mail"
            placeholder="twoj@email.pl"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField v-if="mode === 'password'" label="Hasło" required>
          <UInput
            v-model="password"
            :type="passwordVisible ? 'text' : 'password'"
            autocomplete="current-password"
            icon="i-lucide-key-round"
            placeholder="Twoje hasło"
            required
            class="w-full"
          >
            <template #trailing>
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                square
                size="xs"
                :icon="passwordVisible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="passwordVisible ? 'Ukryj hasło' : 'Pokaż hasło'"
                @click="passwordVisible = !passwordVisible"
              />
            </template>
          </UInput>
        </UFormField>

        <UButton
          type="submit"
          block
          variant="solid"
          :icon="mode === 'magic' ? 'i-lucide-arrow-right' : 'i-lucide-log-in'"
          trailing
          :loading="loading === mode"
        >
          {{ mode === 'magic' ? 'Wyślij bezpieczny link' : 'Zaloguj się' }}
        </UButton>
      </form>

      <UAlert
        v-if="error"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :description="error"
      />

      <template v-if="social.google || social.apple">
        <div class="login-separator"><span>lub</span></div>
        <div class="login-social">
          <UButton
            v-if="social.google"
            block
            color="neutral"
            variant="outline"
            :loading="loading === 'google'"
            @click="signInSocial('google')"
          >
            <template #leading>
              <img src="/assets/google-icon.svg" alt="" width="18" height="18">
            </template>
            Kontynuuj z Google
          </UButton>
          <UButton
            v-if="social.apple"
            block
            color="neutral"
            variant="outline"
            :loading="loading === 'apple'"
            @click="signInSocial('apple')"
          >
            Kontynuuj z Apple
          </UButton>
        </div>
      </template>

      <p class="login-help">
        Nie masz osobnego konta? To w porządku — pierwsze logowanie linkiem
        bezpiecznie powiąże Cię ze sprawą udostępnioną przez eksperta.
      </p>
    </div>
  </PortalAuthShell>
</template>

<style scoped>
.login-form-wrap,
.login-form {
  display: grid;
  gap: 18px;
}

.login-modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: 13px;
  background: var(--ui-bg-elevated);
}

.login-modes button {
  min-height: 42px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--ui-text-muted);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.login-modes button.is-active {
  background: #fff;
  color: var(--ui-text-highlighted);
  box-shadow: 0 1px 4px rgb(0 0 0 / 7%);
}

.login-form :deep(button[type="submit"]) {
  min-height: 52px;
  background: #000;
  color: #fff;
}

.login-separator {
  position: relative;
  display: grid;
  place-items: center;
  height: 24px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.login-separator::before {
  position: absolute;
  right: 0;
  left: 0;
  height: 1px;
  background: var(--ui-border);
  content: "";
}

.login-separator span {
  position: relative;
  padding: 0 12px;
  background: #fff;
}

.login-social {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.login-social img {
  width: 18px;
  height: 18px;
}

.login-help {
  margin: 3px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

.login-alert {
  padding: 8px;
}

@media (max-width: 540px) {
  .login-social {
    grid-template-columns: 1fr;
  }
}
</style>
