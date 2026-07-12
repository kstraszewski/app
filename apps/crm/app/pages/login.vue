<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const route = useRoute()
const hasSupabaseConfig = useHasSupabaseConfig()
const supabase = hasSupabaseConfig ? useSupabaseClient() : null
const redirectCookie = useSupabaseCookieRedirect()
const { callbackUrl, errorMessage, resolvePostAuthPath, safeRedirect, syncAuthenticatedUser } = useAuthFlow()

const email = ref(typeof route.query.email === 'string' ? route.query.email : '')
const password = ref('')
const loading = ref<'password' | 'magic' | null>(null)
const error = ref<string | null>(null)
const magicLinkSent = ref(false)

const registered = computed(() => route.query.registered === '1')
const passwordChanged = computed(() => route.query.passwordChanged === '1')
const intendedDestination = computed(() => safeRedirect(route.query.redirect))

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
  if (!supabase) return
  loading.value = 'password'
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: email.value.trim().toLowerCase(),
    password: password.value,
  })
  loading.value = null

  if (signInError) {
    error.value = errorMessage(signInError)
    return
  }

  try {
    await finishLogin()
  } catch (sessionError) {
    error.value = errorMessage(sessionError as { message?: string })
  }
}

async function sendMagicLink() {
  error.value = null
  if (!supabase) return
  if (!email.value.trim()) {
    error.value = 'Podaj adres email.'
    return
  }

  loading.value = 'magic'
  const { error: magicError } = await supabase.auth.signInWithOtp({
    email: email.value.trim().toLowerCase(),
    options: {
      shouldCreateUser: false,
      emailRedirectTo: callbackUrl('/confirm', intendedDestination.value),
    },
  })
  loading.value = null

  if (magicError) {
    error.value = errorMessage(magicError)
    return
  }

  magicLinkSent.value = true
}
</script>

<template>
  <AuthShell
    badge="Bezpieczne logowanie"
    icon="i-lucide-lock-keyhole"
    title="Witaj ponownie"
    description="Zaloguj się hasłem albo wyślij jednorazowy link na swój email."
  >
    <div class="grid gap-4">
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

      <form v-else class="grid gap-4" @submit.prevent="signInWithPassword">
        <UFormField label="Email" required>
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            required
            placeholder="twoj@email.pl"
            icon="i-lucide-mail"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Hasło" required>
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            placeholder="Twoje hasło"
            icon="i-lucide-key-round"
            class="w-full"
          />
        </UFormField>

        <div class="flex justify-end">
          <NuxtLink to="/forgot-password" class="text-sm underline underline-offset-4">
            Nie pamiętam hasła
          </NuxtLink>
        </div>

        <UButton
          type="submit"
          block
          variant="solid"
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
          icon="i-lucide-wand-sparkles"
          :loading="loading === 'magic'"
          @click="sendMagicLink"
        >
          Wyślij magic link
        </UButton>

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
