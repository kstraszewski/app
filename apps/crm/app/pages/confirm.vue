<script setup lang="ts">
const route = useRoute()
const redirectCookie = useAuthCookieRedirect()
const { errorMessage, resolvePostAuthPath, safeRedirect, syncAuthenticatedUser } = useAuthFlow()

const error = ref<string | null>(null)
const completed = ref(false)

useHead({ title: 'Potwierdzanie logowania — OpenExpert CRM' })

async function finish() {
  if (completed.value) return
  const savedPath = redirectCookie.pluck()
  const destination = await resolvePostAuthPath(safeRedirect(route.query.next, safeRedirect(savedPath)))
  completed.value = true
  await navigateTo(destination)
}

onMounted(async () => {
  const providerError = typeof route.query.error_description === 'string'
    ? route.query.error_description
    : typeof route.query.error === 'string'
      ? route.query.error
      : null
  if (providerError) {
    error.value = errorMessage({
      code: providerError,
      message: providerError,
    })
    return
  }

  if (!await syncAuthenticatedUser()) {
    error.value = errorMessage({
      message: 'Link jest nieprawidłowy albo wygasł. Poproś o nowy link.',
    })
    return
  }

  try {
    await finish()
  }
  catch (finishError) {
    completed.value = false
    error.value = errorMessage(finishError as { message?: string })
  }
})
</script>

<template>
  <AuthShell
    badge="Weryfikacja"
    icon="i-lucide-loader-circle"
    title="Potwierdzamy konto"
    description="Weryfikujemy link i przygotowujemy bezpieczną sesję CRM."
  >
    <UAlert
      v-if="error"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się potwierdzić konta"
      :description="error"
    />

    <div v-else class="flex items-center gap-3 text-toned">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
      <span>To potrwa tylko chwilę…</span>
    </div>

    <template #footer>
      <NuxtLink to="/login" class="font-medium underline underline-offset-4">
        Wróć do logowania
      </NuxtLink>
    </template>
  </AuthShell>
</template>
