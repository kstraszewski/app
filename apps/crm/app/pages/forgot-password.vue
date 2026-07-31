<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const hasAuthConfig = useHasAuthConfig()
const authClient = hasAuthConfig ? useAuthClient() : null
const { errorMessage } = useAuthFlow()

const email = ref('')
const loading = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)

useHead({ title: 'Odzyskaj hasło — OpenExpert CRM' })

async function requestReset() {
  error.value = null
  if (!authClient) return
  loading.value = true
  try {
    const { error: resetError } = await authClient.requestPasswordReset({
      email: email.value.trim().toLowerCase(),
      redirectTo: '/reset-password',
    })
    if (resetError) {
      error.value = errorMessage(resetError)
      return
    }
    sent.value = true
  }
  catch (resetError) {
    error.value = errorMessage(resetError as { message?: string })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthShell
    badge="Odzyskiwanie dostępu"
    icon="i-lucide-life-buoy"
    title="Ustaw nowe hasło"
    description="Wyślemy bezpieczny link do zmiany hasła, jeśli konto istnieje."
  >
    <UAlert
      v-if="sent"
      color="success"
      variant="subtle"
      icon="i-lucide-mail-check"
      title="Sprawdź skrzynkę"
      description="Jeśli konto istnieje, otrzymasz wiadomość z dalszymi instrukcjami."
    />

    <form v-else class="grid gap-4" @submit.prevent="requestReset">
      <UFormField label="Email" required>
        <UInput v-model="email" type="email" autocomplete="email" required icon="i-lucide-mail" class="w-full" />
      </UFormField>

      <UButton type="submit" block icon="i-lucide-send" :loading="loading">
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

    <template #footer>
      <NuxtLink to="/login" class="font-medium underline underline-offset-4">
        Wróć do logowania
      </NuxtLink>
    </template>
  </AuthShell>
</template>
