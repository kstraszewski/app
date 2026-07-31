<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const hasAuthConfig = useHasAuthConfig()
const authClient = hasAuthConfig ? useAuthClient() : null
const { callbackUrl, errorMessage, passwordIssue } = useAuthFlow()

const fullName = ref('')
const organizationName = ref('')
const email = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const acceptedTerms = ref(false)
const pendingOrganizationName = useCookie<string | null>('openexpert-pending-organization', {
  maxAge: 60 * 60 * 24,
  sameSite: 'lax',
  secure: import.meta.env.PROD,
})
const loading = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)

useHead({ title: 'Utwórz konto — OpenExpert CRM' })

async function register() {
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
  if (!acceptedTerms.value) {
    error.value = 'Zaakceptuj warunki korzystania z wersji testowej.'
    return
  }

  loading.value = true
  try {
    const { error: signUpError } = await authClient.signUp.email({
      name: fullName.value.trim(),
      email: email.value.trim().toLowerCase(),
      password: password.value,
      callbackURL: callbackUrl('/confirm'),
    })
    if (signUpError) {
      error.value = errorMessage(signUpError)
      return
    }

    pendingOrganizationName.value = organizationName.value.trim()
    sent.value = true
  }
  catch (signUpError) {
    error.value = errorMessage(signUpError as { message?: string })
  }
  finally {
    loading.value = false
  }
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
