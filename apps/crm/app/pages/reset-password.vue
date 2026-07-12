<script setup lang="ts">
const route = useRoute()
const openexpertConfig = useRuntimeConfig().public.openexpert as { hasSupabaseConfig?: boolean }
const hasSupabaseConfig = Boolean(openexpertConfig.hasSupabaseConfig)
const supabase = hasSupabaseConfig ? useSupabaseClient() : null
const user = useSupabaseUser()
const { errorMessage, passwordIssue, syncAuthenticatedUser } = useAuthFlow()

const password = ref('')
const passwordConfirmation = ref('')
const loading = ref(false)
const authReady = ref(Boolean(user.value))
const error = ref<string | null>(null)

useHead({ title: 'Nowe hasło — OpenExpert CRM' })

onMounted(async () => {
  if (!supabase || user.value) {
    authReady.value = Boolean(user.value)
    return
  }

  const tokenHash = typeof route.query.token_hash === 'string'
    ? route.query.token_hash
    : null
  if (tokenHash) {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'recovery',
    })
    if (verifyError) {
      error.value = errorMessage(verifyError)
      return
    }
  } else {
    const code = typeof route.query.code === 'string' ? route.query.code : null
    if (!code) {
      error.value = 'Link do zmiany hasła jest nieprawidłowy albo wygasł.'
      return
    }

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      error.value = errorMessage(exchangeError)
      return
    }
  }
  await syncAuthenticatedUser()
  authReady.value = true
})

async function updatePassword() {
  error.value = null
  if (!supabase) return

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
  const { error: updateError } = await supabase.auth.updateUser({ password: password.value })
  loading.value = false

  if (updateError) {
    error.value = errorMessage(updateError)
    return
  }

  await supabase.auth.signOut({ scope: 'local' })
  user.value = null
  await navigateTo('/login?passwordChanged=1')
}
</script>

<template>
  <AuthShell
    badge="Nowe hasło"
    icon="i-lucide-key-round"
    title="Zabezpiecz konto"
    description="Ustaw nowe hasło. Wszystkie wymagania są sprawdzane także przez Supabase Auth."
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
