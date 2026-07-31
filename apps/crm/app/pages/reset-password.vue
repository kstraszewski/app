<script setup lang="ts">
const route = useRoute()
const hasAuthConfig = useHasAuthConfig()
const authClient = hasAuthConfig ? useAuthClient() : null
const { errorMessage, passwordIssue } = useAuthFlow()

const password = ref('')
const passwordConfirmation = ref('')
const loading = ref(false)
const authReady = ref(false)
const error = ref<string | null>(null)

useHead({ title: 'Nowe hasło — OpenExpert CRM' })

onMounted(() => {
  const providerError = typeof route.query.error === 'string'
    ? route.query.error
    : null
  if (providerError) {
    error.value = errorMessage({
      code: providerError,
      message: providerError,
    })
    return
  }

  const token = typeof route.query.token === 'string' ? route.query.token : ''
  if (!authClient || !token) {
    error.value = 'Link do zmiany hasła jest nieprawidłowy albo wygasł.'
    return
  }
  authReady.value = true
})

async function updatePassword() {
  error.value = null
  if (!authClient) return

  const issue = passwordIssue(password.value)
  if (issue) {
    error.value = issue
    return
  }
  if (password.value !== passwordConfirmation.value) {
    error.value = 'Hasła nie są takie same.'
    return
  }

  loading.value = true
  try {
    const { error: updateError } = await authClient.resetPassword({
      newPassword: password.value,
      token: String(route.query.token),
    })
    if (updateError) {
      error.value = errorMessage(updateError)
      return
    }

    try {
      await signOutAuthenticatedUser()
    }
    catch {
      // Password reset already revokes existing sessions server-side.
    }
    await navigateTo('/login?passwordChanged=1')
  }
  catch (updateError) {
    error.value = errorMessage(updateError as { message?: string })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthShell
    badge="Nowe hasło"
    icon="i-lucide-key-round"
    title="Zabezpiecz konto"
    description="Ustaw nowe hasło. Wymagania są sprawdzane także po stronie serwera."
  >
    <form v-if="authReady" class="grid gap-4" @submit.prevent="updatePassword">
      <UFormField label="Nowe hasło" hint="Min. 10 znaków, mała i wielka litera oraz cyfra" required>
        <UInput v-model="password" type="password" autocomplete="new-password" required icon="i-lucide-key-round" class="w-full" />
      </UFormField>

      <UFormField label="Powtórz nowe hasło" required>
        <UInput v-model="passwordConfirmation" type="password" autocomplete="new-password" required icon="i-lucide-key-round" class="w-full" />
      </UFormField>

      <UButton type="submit" block icon="i-lucide-shield-check" :loading="loading">
        Zapisz nowe hasło
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
  </AuthShell>
</template>
