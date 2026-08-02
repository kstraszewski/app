<script setup lang="ts">
const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const password = ref('')
const passwordVisible = ref(false)
const loading = ref(false)
const error = ref('')

const redirectPath = computed(() => {
  const value = route.query.redirect
  if (
    typeof value === 'string'
    && value.startsWith('/preview')
    && !value.startsWith('//')
    && !value.includes('\\')
  ) return value
  return '/preview?scenario=first-meeting'
})

if (!import.meta.dev && !runtimeConfig.public.openexpert.demoEnabled) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found' })
}

useHead({ title: 'Wersja demonstracyjna — OpenExpert' })

onMounted(async () => {
  if (!runtimeConfig.public.openexpert.demoEnabled) return
  try {
    const session = await $fetch<{ authenticated: boolean }>('/api/demo/session')
    if (session.authenticated) await navigateTo(redirectPath.value)
  }
  catch {
    // The form remains available and will show a useful error on submit.
  }
})

async function enterDemo() {
  error.value = ''
  if (!password.value) {
    error.value = 'Podaj hasło do wersji demonstracyjnej.'
    return
  }

  loading.value = true
  try {
    await $fetch('/api/demo/login', {
      method: 'POST',
      body: { password: password.value },
    })
    password.value = ''
    await navigateTo(redirectPath.value)
  }
  catch (loginError: any) {
    error.value = loginError?.data?.statusMessage
      || loginError?.statusMessage
      || 'Nie udało się otworzyć wersji demonstracyjnej.'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <PortalAuthShell
    eyebrow="WERSJA DEMONSTRACYJNA"
    title="Zobacz panel oczami klienta"
    description="Użyj hasła do demo. Zobaczysz wyłącznie przykładowe dane — bez połączenia z bazą klientów i bez możliwości zmiany prawdziwych spraw."
  >
    <div class="demo-login">
      <UAlert
        color="info"
        variant="subtle"
        icon="i-lucide-presentation"
        title="Bezpieczny podgląd"
        description="Sesja demo wygasa po 12 godzinach. Wszystkie osoby, sprawy i kwoty w panelu są fikcyjne."
      />

      <form @submit.prevent="enterDemo">
        <UFormField label="Hasło do demo" required>
          <UInput
            v-model="password"
            :type="passwordVisible ? 'text' : 'password'"
            autocomplete="current-password"
            icon="i-lucide-key-round"
            placeholder="Wpisz hasło"
            required
            autofocus
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
          trailing
          icon="i-lucide-arrow-right"
          :loading="loading"
        >
          Wejdź do panelu demo
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

      <p>
        Masz prawdziwe konto klienta?
        <NuxtLink to="/login">Przejdź do zwykłego logowania</NuxtLink>
      </p>
    </div>
  </PortalAuthShell>
</template>

<style scoped>
.demo-login,
.demo-login form {
  display: grid;
  gap: 18px;
}

.demo-login > p {
  margin: 2px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.55;
  text-align: center;
}

.demo-login > p a {
  color: var(--ui-text-highlighted);
  font-weight: 650;
}
</style>
