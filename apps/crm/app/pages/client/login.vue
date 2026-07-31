<script setup lang="ts">
definePageMeta({ layout: false })

const route = useRoute()
const hasAuthConfig = useHasAuthConfig()
const authClient = hasAuthConfig ? useAuthClient() : null
const user = useAuthUser()
const {
  callbackUrl,
  errorMessage,
  resolvePostAuthPath,
  safeRedirect,
} = useAuthFlow()

const fullName = ref('')
const email = ref(typeof route.query.email === 'string' ? route.query.email : '')
const loading = ref(false)
const continuing = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)
const intendedDestination = computed(() => safeRedirect(
  route.query.redirect ?? route.query.next,
  '/client',
))

useHead({
  title: 'Logowanie klienta — OpenExpert',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

async function sendMagicLink() {
  error.value = null
  if (!authClient) return
  if (!email.value.trim()) {
    error.value = 'Podaj adres email użyty przy rezerwacji.'
    return
  }

  loading.value = true
  try {
    const { error: signInError } = await authClient.signIn.magicLink({
      email: email.value.trim().toLowerCase(),
      name: fullName.value.trim() || undefined,
      callbackURL: callbackUrl('/confirm', intendedDestination.value),
      newUserCallbackURL: callbackUrl('/confirm', intendedDestination.value),
      errorCallbackURL: callbackUrl('/confirm', intendedDestination.value),
    })
    if (signInError) {
      error.value = errorMessage(signInError)
      return
    }
    sent.value = true
  }
  catch (signInError) {
    error.value = errorMessage(signInError as { message?: string })
  }
  finally {
    loading.value = false
  }
}

async function continueWithSession() {
  continuing.value = true
  try {
    await navigateTo(await resolvePostAuthPath(intendedDestination.value))
  } catch (sessionError) {
    error.value = errorMessage(sessionError as { message?: string })
  } finally {
    continuing.value = false
  }
}
</script>

<template>
  <ClientPortalShell
    compact
    :show-navigation="false"
    :show-logout="false"
    eyebrow="Dostęp do wizyt"
    title="Twoje konsultacje w jednym miejscu"
    description="Wyślemy jednorazowy link na adres użyty podczas rezerwacji. Nie musisz tworzyć ani pamiętać hasła."
  >
    <UCard class="client-login-card">
      <UAlert
        v-if="user"
        color="info"
        variant="subtle"
        icon="i-lucide-user-check"
        title="Masz już aktywną sesję"
        description="Możesz przejść dalej bez wysyłania kolejnego linku."
      />

      <UAlert
        v-else-if="sent"
        color="success"
        variant="subtle"
        icon="i-lucide-mail-check"
        title="Sprawdź skrzynkę"
        description="Kliknij link w wiadomości, aby bezpiecznie potwierdzić adres i przejść do swoich konsultacji."
      />

      <form v-else class="client-login-form" @submit.prevent="sendMagicLink">
        <UFormField label="Imię i nazwisko" hint="Opcjonalnie — do wyświetlania na koncie">
          <UInput
            v-model="fullName"
            autocomplete="name"
            icon="i-lucide-user"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Email użyty przy rezerwacji" required>
          <UInput
            v-model="email"
            type="email"
            autocomplete="email"
            required
            icon="i-lucide-mail"
            placeholder="twoj@email.pl"
            class="w-full"
          />
        </UFormField>

        <UButton
          type="submit"
          block
          size="lg"
          icon="i-lucide-send"
          :loading="loading"
        >
          Wyślij bezpieczny link
        </UButton>
      </form>

      <UButton
        v-if="user"
        type="button"
        block
        size="lg"
        icon="i-lucide-arrow-right"
        :loading="continuing"
        @click="continueWithSession"
      >
        Przejdź dalej
      </UButton>

      <UAlert
        v-if="error"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :description="error"
      />

      <p class="client-login-card__privacy">
        Konto klienta nie daje dostępu do panelu eksperta ani danych innych osób.
      </p>
    </UCard>
  </ClientPortalShell>
</template>

<style scoped>
.client-login-card {
  border-color: color-mix(in srgb, var(--ui-border-accented) 80%, transparent);
  box-shadow: 0 28px 80px rgb(0 0 0 / 8%);
}

.client-login-card :deep(.divide-y) {
  display: grid;
  gap: 20px;
}

.client-login-form {
  display: grid;
  gap: 18px;
}

.client-login-card__privacy {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}
</style>
