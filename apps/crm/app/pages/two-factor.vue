<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const authClient = useAuthClient()
const redirectCookie = useAuthCookieRedirect()
const route = useRoute()
const { errorMessage, resolvePostAuthPath, safeRedirect, syncAuthenticatedUser } = useAuthFlow()

const mode = ref<'totp' | 'backup'>('totp')
const code = ref<number[]>([])
const backupCode = ref('')
const trustDevice = ref(true)
const loading = ref(false)
const error = ref('')

useHead({ title: 'Weryfikacja dwuetapowa — OpenExpert CRM' })

function selectMode(nextMode: 'totp' | 'backup') {
  mode.value = nextMode
  code.value = []
  backupCode.value = ''
  error.value = ''
}

async function finishLogin() {
  if (!await syncAuthenticatedUser()) {
    throw new Error('Nie udało się utworzyć sesji po weryfikacji kodu.')
  }
  const savedPath = redirectCookie.pluck()
  const requested = safeRedirect(route.query.redirect, safeRedirect(savedPath))
  await navigateTo(await resolvePostAuthPath(requested))
}

async function verifySecondFactor() {
  error.value = ''
  if (loading.value) return

  const totp = code.value.join('')
  const recovery = backupCode.value.trim()
  if (mode.value === 'totp' && !/^\d{6}$/.test(totp)) {
    error.value = 'Wpisz pełny sześciocyfrowy kod z aplikacji.'
    return
  }
  if (mode.value === 'backup' && !recovery) {
    error.value = 'Wpisz jeden z zapisanych kodów zapasowych.'
    return
  }

  loading.value = true
  try {
    const result = mode.value === 'totp'
      ? await authClient.twoFactor.verifyTotp({ code: totp, trustDevice: trustDevice.value })
      : await authClient.twoFactor.verifyBackupCode({ code: recovery, trustDevice: trustDevice.value })
    if (result.error) throw result.error
    await finishLogin()
  }
  catch (verificationError) {
    code.value = []
    error.value = errorMessage(verificationError as { message?: string, code?: string, status?: number })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthShell
    badge="Drugi krok"
    icon="i-lucide-shield-check"
    title="Potwierdź, że to Ty"
    description="Weryfikacja dwuetapowa chroni konto nawet wtedy, gdy ktoś pozna Twoje hasło."
  >
    <form class="two-factor-login" @submit.prevent="verifySecondFactor">
      <div class="two-factor-login__switch" role="tablist" aria-label="Sposób weryfikacji">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'totp'"
          :class="{ 'two-factor-login__switch-button--active': mode === 'totp' }"
          @click="selectMode('totp')"
        >
          <UIcon name="i-lucide-smartphone" />
          Aplikacja
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'backup'"
          :class="{ 'two-factor-login__switch-button--active': mode === 'backup' }"
          @click="selectMode('backup')"
        >
          <UIcon name="i-lucide-key-square" />
          Kod zapasowy
        </button>
      </div>

      <UFormField
        v-if="mode === 'totp'"
        label="Kod z aplikacji"
        description="Wpisz aktualny sześciocyfrowy kod."
        required
      >
        <UPinInput
          v-model="code"
          type="number"
          otp
          :length="6"
          :separator="3"
          size="xl"
          class="justify-center"
          autofocus
        />
      </UFormField>

      <UFormField
        v-else
        label="Kod zapasowy"
        description="Każdy zapisany kod można wykorzystać tylko raz."
        required
      >
        <UInput
          v-model="backupCode"
          autocomplete="one-time-code"
          spellcheck="false"
          placeholder="XXXXX-XXXXX"
          icon="i-lucide-key-round"
          size="lg"
          class="w-full font-mono"
          autofocus
        />
      </UFormField>

      <UCheckbox
        v-model="trustDevice"
        label="Zapamiętaj to urządzenie na 30 dni"
        description="Wybierz tylko na prywatnym, zaufanym urządzeniu."
      />

      <UAlert
        v-if="error"
        role="alert"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :description="error"
      />

      <UButton type="submit" block size="lg" icon="i-lucide-log-in" :loading="loading">
        Potwierdź i zaloguj
      </UButton>
    </form>

    <template #footer>
      <NuxtLink to="/login" class="font-medium underline underline-offset-4">
        Wróć do logowania
      </NuxtLink>
    </template>
  </AuthShell>
</template>

<style scoped>
.two-factor-login {
  display: grid;
  gap: 18px;
}

.two-factor-login__switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.two-factor-login__switch button {
  display: flex;
  gap: 7px;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  border: 0;
  border-radius: calc(var(--ui-radius) - 3px);
  background: transparent;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.two-factor-login__switch .two-factor-login__switch-button--active {
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
}
</style>
