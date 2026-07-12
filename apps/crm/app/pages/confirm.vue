<script setup lang="ts">
const route = useRoute()
const openexpertConfig = useRuntimeConfig().public.openexpert as { hasSupabaseConfig?: boolean }
const hasSupabaseConfig = Boolean(openexpertConfig.hasSupabaseConfig)
const supabase = hasSupabaseConfig ? useSupabaseClient() : null
const user = useSupabaseUser()
const redirectCookie = useSupabaseCookieRedirect()
const { errorMessage, resolvePostAuthPath, safeRedirect, syncAuthenticatedUser } = useAuthFlow()

const error = ref<string | null>(null)
const completed = ref(false)

useHead({ title: 'Potwierdzanie logowania — OpenExpert CRM' })

async function finish() {
  if (completed.value) return
  completed.value = true
  const savedPath = redirectCookie.pluck()
  const destination = await resolvePostAuthPath(safeRedirect(route.query.next, safeRedirect(savedPath)))
  await navigateTo(destination)
}

onMounted(async () => {
  if (!supabase) return

  const providerError = typeof route.query.error_description === 'string'
    ? route.query.error_description
    : null
  if (providerError) {
    error.value = providerError
    return
  }

  const tokenHash = typeof route.query.token_hash === 'string'
    ? route.query.token_hash
    : null
  if (tokenHash) {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'email',
    })
    if (verifyError) {
      error.value = errorMessage(verifyError)
      return
    }
  } else {
    const code = typeof route.query.code === 'string' ? route.query.code : null
    if (code) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
      if (exchangeError) {
        error.value = errorMessage(exchangeError)
        return
      }
    } else if (!user.value) {
      error.value = 'Link jest nieprawidłowy albo wygasł. Poproś o nowy link.'
      return
    }
  }

  await syncAuthenticatedUser()
  await finish()
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
