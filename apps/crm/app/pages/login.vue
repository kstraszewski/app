<script setup lang="ts">
const openexpertConfig = useRuntimeConfig().public.openexpert as { hasSupabaseConfig?: boolean }
const hasSupabaseConfig = Boolean(openexpertConfig.hasSupabaseConfig)
const supabase = hasSupabaseConfig ? useSupabaseClient() : null
const email = ref('')
const sent = ref(false)
const error = ref<string | null>(null)

async function signIn() {
  error.value = null
  if (!supabase) {
    error.value = 'Brakuje konfiguracji Supabase — uzupełnij plik .env.'
    return
  }
  const { error: err } = await supabase.auth.signInWithOtp({ email: email.value })
  if (err) {
    error.value = err.message
    return
  }
  sent.value = true
}
</script>

<template>
  <main>
    <h1>Zaloguj się</h1>
    <p v-if="!hasSupabaseConfig" role="alert">
      Brakuje konfiguracji Supabase — uzupełnij plik .env.
    </p>
    <form v-else-if="!sent" @submit.prevent="signIn">
      <label>
        Email
        <input v-model="email" type="email" required>
      </label>
      <button type="submit">Wyślij link</button>
      <p v-if="error" role="alert">{{ error }}</p>
    </form>
    <p v-else>Sprawdź skrzynkę — wysłaliśmy link logowania.</p>
  </main>
</template>
