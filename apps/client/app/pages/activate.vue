<script setup lang="ts">
import { getOpenExpertPasswordIssue } from '@openexpert/auth'

definePageMeta({ middleware: 'client-auth' })

const route = useRoute()
const authClient = useAuthClient()
const runtimeConfig = useRuntimeConfig()
const { errorMessage, safeRedirect } = usePortalAuth()
const invitationId = computed(() => String(
  route.query.invitationId || route.query.invitation || '',
))
const nextPath = computed(() => safeRedirect(route.query.next, '/'))
const linkedProvider = computed(() => String(route.query.linked || ''))
const social = computed(() => runtimeConfig.public.openexpert.social)

const status = ref<'activating' | 'success' | 'error'>(
  invitationId.value ? 'activating' : 'success',
)
const error = ref('')
const password = ref('')
const passwordRepeat = ref('')
const passwordVisible = ref(false)
const passwordSaving = ref(false)
const passwordSaved = ref(false)
const socialLoading = ref<'google' | 'apple' | null>(null)
const confirmedLinkedProvider = ref('')

useHead({ title: 'Aktywacja panelu — OpenExpert' })

function passwordIssue() {
  const issue = getOpenExpertPasswordIssue(password.value)
  if (issue) return issue
  if (password.value !== passwordRepeat.value) return 'Hasła nie są takie same.'
  return ''
}

async function activate() {
  if (invitationId.value) {
    status.value = 'activating'
    error.value = ''
    try {
      await $fetch('/api/client/activate', {
        method: 'POST',
        body: { invitationId: invitationId.value },
      })
      status.value = 'success'
    }
    catch (activationError) {
      status.value = 'error'
      error.value = errorMessage(activationError as { message?: string, statusCode?: number })
      return
    }
  }
  await verifyLinkedProvider()
}

async function verifyLinkedProvider() {
  const provider = linkedProvider.value
  if (provider !== 'google' && provider !== 'apple') return
  try {
    const result = await authClient.listAccounts()
    if (result.data?.some((account: { providerId?: string }) => account.providerId === provider)) {
      confirmedLinkedProvider.value = provider
    }
  }
  catch {
    // A callback query is only a hint and is never treated as proof of linking.
  }
}

async function linkSocial(provider: 'google' | 'apple') {
  error.value = ''
  socialLoading.value = provider
  const query = new URLSearchParams({ linked: provider })
  if (invitationId.value) query.set('invitation', invitationId.value)
  try {
    const result = await authClient.linkSocial({
      provider,
      callbackURL: `${String(runtimeConfig.public.openexpert.portalBaseUrl).replace(/\/+$/u, '')}/activate?${query.toString()}`,
    })
    if (result.error) throw result.error
  }
  catch (socialError) {
    error.value = errorMessage(socialError as { message?: string, code?: string })
    socialLoading.value = null
  }
}

async function savePassword() {
  error.value = passwordIssue()
  if (error.value) return
  passwordSaving.value = true
  try {
    await $fetch('/api/client/password', {
      method: 'POST',
      body: { password: password.value },
    })
    passwordSaved.value = true
    password.value = ''
    passwordRepeat.value = ''
  }
  catch (passwordError) {
    error.value = errorMessage(passwordError as { message?: string, statusCode?: number })
  }
  finally {
    passwordSaving.value = false
  }
}

onMounted(activate)
</script>

<template>
  <PortalAuthShell
    eyebrow="AKTYWACJA DOSTĘPU"
    :title="status === 'activating'
      ? 'Łączymy konto z Twoją sprawą'
      : status === 'success' ? 'Twój panel jest gotowy' : 'Nie udało się aktywować dostępu'"
    description="Dostęp zostanie przyznany tylko do sprawy i danych wskazanych przez Twojego eksperta."
  >
    <div class="activation-content">
      <template v-if="status === 'activating'">
        <div class="activation-loader">
          <UIcon name="i-lucide-loader-circle" />
          <p>Bezpiecznie weryfikujemy zaproszenie…</p>
        </div>
      </template>

      <template v-else-if="status === 'error'">
        <UAlert
          color="error"
          variant="subtle"
          icon="i-lucide-link-2-off"
          title="Link nie może zostać użyty"
          :description="error"
        />
        <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="activate">
          Spróbuj ponownie
        </UButton>
        <UButton to="/login" color="neutral" variant="ghost">
          Zaloguj się innym linkiem
        </UButton>
      </template>

      <template v-else>
        <UAlert
          color="success"
          variant="subtle"
          icon="i-lucide-shield-check"
          title="Dostęp potwierdzony"
          description="Możesz od razu przejść do panelu. Ustawienie hasła jest opcjonalne."
        />

        <UAlert
          v-if="confirmedLinkedProvider"
          color="success"
          variant="subtle"
          icon="i-lucide-link"
          title="Sposób logowania został połączony"
          :description="confirmedLinkedProvider === 'apple'
            ? 'Możesz od teraz logować się kontem Apple.'
            : 'Możesz od teraz logować się kontem Google.'"
        />

        <form v-if="!passwordSaved" class="password-form" @submit.prevent="savePassword">
          <div class="password-form__heading">
            <h2>Ustaw hasło <span>opcjonalnie</span></h2>
            <p>Nadal zawsze możesz logować się jednorazowym linkiem.</p>
          </div>
          <UFormField label="Nowe hasło">
            <UInput
              v-model="password"
              :type="passwordVisible ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="Minimum 10 znaków"
              icon="i-lucide-key-round"
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
                  @click="passwordVisible = !passwordVisible"
                />
              </template>
            </UInput>
          </UFormField>
          <UFormField label="Powtórz hasło">
            <UInput
              v-model="passwordRepeat"
              :type="passwordVisible ? 'text' : 'password'"
              autocomplete="new-password"
              class="w-full"
            />
          </UFormField>
          <UButton
            type="submit"
            color="neutral"
            variant="outline"
            block
            icon="i-lucide-lock-keyhole"
            :loading="passwordSaving"
            :disabled="!password || !passwordRepeat"
          >
            Zapisz hasło
          </UButton>
        </form>

        <UAlert
          v-else
          color="success"
          variant="subtle"
          icon="i-lucide-check-circle-2"
          title="Hasło zostało ustawione"
        />

        <section v-if="social.google || social.apple" class="social-linking">
          <div class="social-linking__heading">
            <h2>Połącz sposób logowania <span>opcjonalnie</span></h2>
            <p>Najpierw potwierdziliśmy zaproszenie. Teraz możesz bezpiecznie podpiąć konto społecznościowe do tego samego profilu klienta.</p>
          </div>
          <div class="social-linking__buttons">
            <UButton
              v-if="social.google"
              color="neutral"
              variant="outline"
              block
              :loading="socialLoading === 'google'"
              @click="linkSocial('google')"
            >
              <template #leading>
                <img src="/assets/google-icon.svg" alt="" width="17" height="17">
              </template>
              Połącz z Google
            </UButton>
            <UButton
              v-if="social.apple"
              color="neutral"
              variant="outline"
              block
              :loading="socialLoading === 'apple'"
              @click="linkSocial('apple')"
            >
              Połącz z Apple
            </UButton>
          </div>
        </section>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :description="error"
        />

        <UButton :to="nextPath" block variant="solid" trailing icon="i-lucide-arrow-right">
          Przejdź do panelu
        </UButton>
      </template>
    </div>
  </PortalAuthShell>
</template>

<style scoped>
.activation-content,
.password-form {
  display: grid;
  gap: 17px;
}

.activation-loader {
  display: grid;
  justify-items: center;
  gap: 16px;
  padding: 36px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  color: var(--ui-text-muted);
}

.activation-loader svg {
  width: 38px;
  height: 38px;
  color: var(--ui-text-highlighted);
  animation: spin 1s linear infinite;
}

.activation-loader p {
  margin: 0;
  font-size: 14px;
}

.password-form {
  margin-top: 2px;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
}

.password-form__heading h2,
.password-form__heading p {
  margin: 0;
}

.social-linking {
  display: grid;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
}

.social-linking__heading h2,
.social-linking__heading p {
  margin: 0;
}

.social-linking__heading h2 {
  font-size: 18px;
  font-weight: 600;
}

.social-linking__heading h2 span {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 500;
}

.social-linking__heading p {
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.social-linking__buttons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.social-linking__buttons img {
  width: 17px;
  height: 17px;
}

@media (max-width: 520px) {
  .social-linking__buttons {
    grid-template-columns: 1fr;
  }
}

.password-form__heading h2 {
  font-size: 18px;
  font-weight: 600;
}

.password-form__heading h2 span {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 500;
}

.password-form__heading p {
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
