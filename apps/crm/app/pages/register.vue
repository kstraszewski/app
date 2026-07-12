<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const openexpertConfig = useRuntimeConfig().public.openexpert as { hasSupabaseConfig?: boolean }
const hasSupabaseConfig = Boolean(openexpertConfig.hasSupabaseConfig)
const supabase = hasSupabaseConfig ? useSupabaseClient() : null
const { callbackUrl, errorMessage, passwordIssue, resolvePostAuthPath, syncAuthenticatedUser } = useAuthFlow()

const fullName = ref('')
const organizationName = ref('')
const email = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const acceptedTerms = ref(false)
const loading = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)

useHead({ title: 'Utwórz konto — OpenExpert CRM' })

async function register() {
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
  if (!acceptedTerms.value) {
    error.value = 'Zaakceptuj warunki korzystania z wersji testowej.'
    return
  }

  loading.value = true
  const { data, error: signUpError } = await supabase.auth.signUp({
    email: email.value.trim().toLowerCase(),
    password: password.value,
    options: {
      emailRedirectTo: callbackUrl('/confirm'),
      data: {
        full_name: fullName.value.trim(),
        organization_name: organizationName.value.trim(),
      },
    },
  })
  loading.value = false

  if (signUpError) {
    error.value = errorMessage(signUpError)
    return
  }

  if (data.session) {
    await syncAuthenticatedUser()
    await navigateTo(await resolvePostAuthPath())
    return
  }

  sent.value = true
}
</script>

<template>
  <AuthShell
    badge="Nowa organizacja"
    icon="i-lucide-building-2"
    title="Załóż OpenExpert"
    description="Pierwsze konto zostanie administratorem nowej, odseparowanej organizacji."
  >
    <UAlert
      v-if="sent"
      color="success"
      variant="subtle"
      icon="i-lucide-mail-check"
      title="Potwierdź adres email"
      description="Wysłaliśmy wiadomość aktywacyjną. Lokalny adres Mailpit wypisuje komenda pnpm db:start."
    />

    <form v-else class="grid gap-4" @submit.prevent="register">
      <UFormField label="Imię i nazwisko" required>
        <UInput v-model="fullName" autocomplete="name" required icon="i-lucide-user" class="w-full" />
      </UFormField>

      <UFormField label="Nazwa organizacji" required>
        <UInput v-model="organizationName" autocomplete="organization" required icon="i-lucide-building-2" class="w-full" />
      </UFormField>

      <UFormField label="Email" required>
        <UInput v-model="email" type="email" autocomplete="email" required icon="i-lucide-mail" class="w-full" />
      </UFormField>

      <UFormField label="Hasło" hint="Min. 10 znaków, mała i wielka litera oraz cyfra" required>
        <UInput v-model="password" type="password" autocomplete="new-password" required icon="i-lucide-key-round" class="w-full" />
      </UFormField>

      <UFormField label="Powtórz hasło" required>
        <UInput v-model="passwordConfirmation" type="password" autocomplete="new-password" required icon="i-lucide-key-round" class="w-full" />
      </UFormField>

      <label class="flex items-start gap-3 text-sm text-toned">
        <input v-model="acceptedTerms" type="checkbox" class="mt-1" required>
        <span>Akceptuję warunki korzystania z wersji testowej i przetwarzanie danych konta.</span>
      </label>

      <UButton type="submit" block icon="i-lucide-user-plus" :loading="loading">
        Utwórz konto
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

    <template #footer>
      Masz już konto?
      <NuxtLink to="/login" class="font-medium underline underline-offset-4">
        Zaloguj się
      </NuxtLink>
    </template>
  </AuthShell>
</template>
