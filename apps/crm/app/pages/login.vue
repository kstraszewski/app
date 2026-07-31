<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const route = useRoute()
const hasAuthConfig = useHasAuthConfig()
const authClient = hasAuthConfig ? useAuthClient() : null
const redirectCookie = useAuthCookieRedirect()
const { callbackUrl, errorMessage, resolvePostAuthPath, safeRedirect, syncAuthenticatedUser } = useAuthFlow()

const email = ref(typeof route.query.email === 'string' ? route.query.email : '')
const password = ref('')
const passwordVisible = ref(false)
const loading = ref<'password' | 'magic' | null>(null)
const error = ref<string | null>(null)
const magicLinkSent = ref(false)

const registered = computed(() => route.query.registered === '1')
const passwordChanged = computed(() => route.query.passwordChanged === '1')
const intendedDestination = computed(() => safeRedirect(route.query.redirect))

function togglePasswordVisibility() {
  passwordVisible.value = !passwordVisible.value
}

useHead({ title: 'Logowanie — OpenExpert CRM' })

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
    const { error: signInError } = await authClient.signIn.email({
      email: email.value.trim().toLowerCase(),
      password: password.value,
    })
    if (signInError) {
      error.value = errorMessage(signInError)
      return
    }
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
        description="Wysłaliśmy jednorazowy link logowania. Lokalny adres Mailpit wypisuje komenda pnpm db:start."
      />

      <form v-else class="login-form" @submit.prevent="signInWithPassword">
        <UFormField label="Email" required>
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
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
            autocomplete="current-password"
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
          <NuxtLink to="/forgot-password">
            Nie pamiętam hasła
          </NuxtLink>
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

        <p class="login-form__hint">
          Wyślemy jednorazowy, bezpieczny link na podany adres email.
        </p>

        <UAlert
          v-if="error"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :description="error"
        />
      </form>
    </div>

    <template #footer>
      Nie masz konta?
      <NuxtLink to="/register" class="font-medium underline underline-offset-4">
        Utwórz organizację
      </NuxtLink>
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

.login-form__help {
  margin-top: -5px;
  text-align: right;
}

.login-form__help a {
  color: var(--ui-text-toned);
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  transition: color var(--oe-motion-fast);
}

.login-form__help a:hover {
  color: var(--ui-text-highlighted);
}

.login-form__hint {
  margin-top: -8px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.45;
  text-align: center;
}
</style>
