<script setup lang="ts">
const openexpertConfig = useRuntimeConfig().public.openexpert as { hasSupabaseConfig?: boolean }
const hasSupabaseConfig = Boolean(openexpertConfig.hasSupabaseConfig)
const supabase = hasSupabaseConfig ? useSupabaseClient() : null
const email = ref('')
const sent = ref(false)
const error = ref<string | null>(null)
const loading = ref(false)

useHead({ title: 'Logowanie — OpenExpert CRM' })

async function signIn() {
  error.value = null
  if (!supabase) {
    error.value = 'Brakuje konfiguracji Supabase — uzupełnij plik .env.'
    return
  }
  loading.value = true
  const { error: err } = await supabase.auth.signInWithOtp({ email: email.value })
  loading.value = false
  if (err) {
    error.value = err.message
    return
  }
  sent.value = true
}
</script>

<template>
  <main class="auth-page oe-grid-bg">
    <NuxtLink to="/design" class="auth-logo">
      <picture>
        <source srcset="/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
        <img src="/assets/logo-light.svg" alt="" class="auth-logo__mark">
      </picture>
      <span>OpenExpert CRM</span>
    </NuxtLink>

    <UCard class="auth-card oe-animate-in">
      <template #header>
        <div class="auth-header">
          <UBadge color="neutral" variant="outline" icon="i-lucide-shield-check">
            Magic link
          </UBadge>
          <h1>Zaloguj się</h1>
          <p>Dostęp do CRM jest zabezpieczony przez Supabase Auth.</p>
        </div>
      </template>

      <UAlert
        v-if="!hasSupabaseConfig"
        role="alert"
        color="warning"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        title="Brakuje konfiguracji Supabase"
        description="Uzupełnij plik .env, żeby włączyć logowanie."
      />

      <form v-else-if="!sent" class="auth-form" @submit.prevent="signIn">
        <UFormField label="Email">
          <UInput v-model="email" type="email" required placeholder="twoj@email.pl" icon="i-lucide-mail" class="w-full" />
        </UFormField>

        <UButton type="submit" block variant="solid" icon="i-lucide-send" :loading="loading">
          Wyślij link
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

      <UAlert
        v-else
        color="success"
        variant="subtle"
        icon="i-lucide-mail-check"
        title="Sprawdź skrzynkę"
        description="Wysłaliśmy link logowania na podany adres email."
      />
    </UCard>
  </main>
</template>

<style scoped>
.auth-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 80px 20px;
}

.auth-logo {
  position: absolute;
  top: 24px;
  left: 24px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ui-text-highlighted);
  font-weight: 600;
  text-decoration: none;
}

.auth-logo__mark {
  height: 22px;
  filter: var(--oe-logo-filter);
}

.auth-card {
  width: min(100%, 440px);
}

.auth-header {
  display: grid;
  gap: 12px;
}

.auth-header h1 {
  color: var(--ui-text-highlighted);
  font-size: 34px;
  font-weight: 300;
  line-height: 1.1;
}

.auth-header p {
  color: var(--ui-text-toned);
  line-height: 1.6;
}

.auth-form {
  display: grid;
  gap: 16px;
}

@media (max-width: 560px) {
  .auth-logo {
    left: 20px;
  }
}
</style>
