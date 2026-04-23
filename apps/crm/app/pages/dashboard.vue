<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
const user = useSupabaseUser()
const openexpertConfig = useRuntimeConfig().public.openexpert as { hasSupabaseConfig?: boolean }
const hasSupabaseConfig = Boolean(openexpertConfig.hasSupabaseConfig)
const supabase = hasSupabaseConfig ? useSupabaseClient() : null

async function signOut() {
  if (supabase) await supabase.auth.signOut()
  await navigateTo('/login')
}
</script>

<template>
  <main>
    <h1>Dashboard</h1>
    <p v-if="!hasSupabaseConfig" role="alert">
      Brakuje konfiguracji Supabase — uzupełnij plik .env.
    </p>
    <p>Zalogowany: {{ user?.email }}</p>
    <button @click="signOut">Wyloguj</button>
  </main>
</template>
