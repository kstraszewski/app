<script setup lang="ts">
import { authErrorCode, isFreshSessionRequired } from '~/utils/auth-error'
import { reauthenticationRedirect } from '~/utils/auth-reauthentication'

type AuthAccount = {
  id: string
  providerId: string
  accountId: string
}

type AuthSession = {
  id: string
  token: string
  createdAt: string | Date
  updatedAt: string | Date
  expiresAt: string | Date
  ipAddress?: string | null
  userAgent?: string | null
}

const authClient = useAuthClient()
const authUser = useAuthUser()
const route = useRoute()
const toast = useToast()
const { errorMessage, passwordIssue } = useAuthFlow()
const currentPassword = ref('')
const newPassword = ref('')
const newPasswordConfirmation = ref('')
const revokeOtherSessions = ref(true)
const changingPassword = ref(false)
const resetSending = ref(false)
const accounts = ref<AuthAccount[]>([])
const sessions = ref<AuthSession[]>([])
const currentSessionId = ref('')
const securityLoading = ref(true)
const loadError = ref('')
const requiresFreshSession = ref(false)
const passwordError = ref('')
const revokingSessionId = ref('')
const revokingOthers = ref(false)

const hasPassword = computed(() => accounts.value.some(account => account.providerId === 'credential'))
const otherSessions = computed(() => sessions.value.filter(session => session.id !== currentSessionId.value))
const newPasswordRequirements = computed(() => getPasswordRequirements(newPassword.value))
const newPasswordChecks = computed(() => [
  {
    key: 'minimumLength',
    label: 'Co najmniej 10 znaków',
    met: newPasswordRequirements.value.minimumLength,
  },
  {
    key: 'lowercase',
    label: 'Mała litera',
    met: newPasswordRequirements.value.lowercase,
  },
  {
    key: 'uppercase',
    label: 'Wielka litera',
    met: newPasswordRequirements.value.uppercase,
  },
  {
    key: 'number',
    label: 'Cyfra',
    met: newPasswordRequirements.value.number,
  },
])
const newPasswordTooLong = computed(() => (
  newPassword.value.length > 0 && !newPasswordRequirements.value.acceptableLength
))
const passwordsMatch = computed(() => (
  newPasswordConfirmation.value.length > 0
  && newPasswordConfirmation.value === newPassword.value
))

watch([currentPassword, newPassword, newPasswordConfirmation], () => {
  passwordError.value = ''
})

useHead({ title: 'Bezpieczeństwo — Ustawienia konta — OpenExpert CRM' })

function sessionDevice(userAgent: string | null | undefined): { label: string, icon: string } {
  const source = String(userAgent || '')
  const mobile = /android|iphone|ipad|mobile/iu.test(source)
  let browser = 'Przeglądarka'
  if (/edg\//iu.test(source)) browser = 'Microsoft Edge'
  else if (/chrome\//iu.test(source) && !/chromium/iu.test(source)) browser = 'Google Chrome'
  else if (/safari\//iu.test(source) && !/chrome|chromium/iu.test(source)) browser = 'Safari'
  else if (/firefox\//iu.test(source)) browser = 'Firefox'
  return {
    label: mobile ? `${browser} · urządzenie mobilne` : `${browser} · komputer`,
    icon: mobile ? 'i-lucide-smartphone' : 'i-lucide-monitor',
  }
}

function formatDate(value: string | Date): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nieznana data'
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

async function loadSecurityData() {
  securityLoading.value = true
  loadError.value = ''
  requiresFreshSession.value = false
  try {
    const [accountsResult, sessionsResult, currentSessionResult] = await Promise.all([
      authClient.listAccounts(),
      authClient.listSessions(),
      authClient.getSession(),
    ])
    if (accountsResult.error) throw accountsResult.error
    accounts.value = (accountsResult.data ?? []) as AuthAccount[]
    if (currentSessionResult.error) throw currentSessionResult.error
    currentSessionId.value = String(currentSessionResult.data?.session.id || '')
    if (sessionsResult.error) {
      requiresFreshSession.value = isFreshSessionRequired(sessionsResult.error)
      throw sessionsResult.error
    }
    sessions.value = (sessionsResult.data ?? []) as AuthSession[]
  }
  catch (error) {
    loadError.value = errorMessage(error as { message?: string, code?: string })
  }
  finally {
    securityLoading.value = false
  }
}

async function reauthenticate() {
  const redirect = reauthenticationRedirect(route.fullPath)
  try {
    await signOutAuthenticatedUser({ requireServerSuccess: true })
    await navigateTo({ path: '/login', query: { redirect } })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się zakończyć bieżącej sesji',
      description: errorMessage(error as { message?: string, code?: string }),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
}

async function changePassword() {
  passwordError.value = passwordIssue(newPassword.value) || ''
  if (!passwordError.value && newPassword.value !== newPasswordConfirmation.value) {
    passwordError.value = 'Nowe hasła nie są takie same.'
  }
  if (!passwordError.value && currentPassword.value === newPassword.value) {
    passwordError.value = 'Nowe hasło musi różnić się od obecnego.'
  }
  if (passwordError.value || changingPassword.value) return

  changingPassword.value = true
  try {
    const result = await authClient.changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
      revokeOtherSessions: revokeOtherSessions.value,
    })
    if (result.error) throw result.error
    currentPassword.value = ''
    newPassword.value = ''
    newPasswordConfirmation.value = ''
    toast.add({
      title: 'Hasło zostało zmienione',
      description: revokeOtherSessions.value
        ? 'Pozostałe urządzenia zostały wylogowane.'
        : 'Nowe hasło działa od teraz.',
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
    await loadSecurityData()
  }
  catch (error) {
    passwordError.value = authErrorCode(error) === 'INVALID_PASSWORD'
      ? 'Obecne hasło jest nieprawidłowe.'
      : errorMessage(error as { message?: string, code?: string })
  }
  finally {
    changingPassword.value = false
  }
}

async function sendPasswordReset() {
  if (!authUser.value?.email || resetSending.value) return
  resetSending.value = true
  passwordError.value = ''
  try {
    const redirectTo = new URL('/reset-password', window.location.origin).toString()
    await $fetch('/api/auth/password-reset', {
      method: 'POST',
      body: {
        email: authUser.value.email,
        redirectTo,
      },
    })
    toast.add({
      title: 'Link wysłany',
      description: `Sprawdź skrzynkę ${authUser.value.email}.`,
      color: 'success',
      icon: 'i-lucide-mail-check',
    })
  }
  catch (error) {
    passwordError.value = errorMessage(error as { message?: string, code?: string })
  }
  finally {
    resetSending.value = false
  }
}

async function revokeSession(session: AuthSession) {
  if (!session.token || session.id === currentSessionId.value || revokingSessionId.value) return
  revokingSessionId.value = session.id
  try {
    const result = await authClient.revokeSession({ token: session.token })
    if (result.error) throw result.error
    sessions.value = sessions.value.filter(candidate => candidate.id !== session.id)
    toast.add({ title: 'Urządzenie wylogowane', color: 'success', icon: 'i-lucide-log-out' })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się wylogować urządzenia',
      description: errorMessage(error as { message?: string, code?: string }),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    revokingSessionId.value = ''
  }
}

async function revokeAllOtherSessions() {
  if (!otherSessions.value.length || revokingOthers.value) return
  revokingOthers.value = true
  try {
    const result = await authClient.revokeOtherSessions()
    if (result.error) throw result.error
    sessions.value = sessions.value.filter(session => session.id === currentSessionId.value)
    toast.add({
      title: 'Pozostałe urządzenia wylogowane',
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się zakończyć sesji',
      description: errorMessage(error as { message?: string, code?: string }),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    revokingOthers.value = false
  }
}

onMounted(loadSecurityData)
</script>

<template>
  <div class="security-page">
    <UAlert
      v-if="loadError"
      :color="requiresFreshSession ? 'warning' : 'error'"
      variant="subtle"
      icon="i-lucide-shield-alert"
      :title="requiresFreshSession ? 'Potwierdź ponownie swoją tożsamość' : 'Nie udało się pobrać ustawień bezpieczeństwa'"
      :description="loadError"
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          :icon="requiresFreshSession ? 'i-lucide-log-in' : 'i-lucide-refresh-cw'"
          @click="requiresFreshSession ? reauthenticate() : loadSecurityData()"
        >
          {{ requiresFreshSession ? 'Zaloguj się ponownie' : 'Ponów' }}
        </UButton>
      </template>
    </UAlert>

    <div class="security-layout">
      <section class="security-panel">
        <header class="security-panel__header">
          <span class="security-panel__icon"><UIcon name="i-lucide-key-round" /></span>
          <div>
            <p>Hasło</p>
            <h2>{{ hasPassword ? 'Zmień hasło' : 'Ustaw hasło do konta' }}</h2>
            <small>{{ authUser?.email }}</small>
          </div>
          <UBadge
            class="password-status"
            :color="hasPassword ? 'success' : 'neutral'"
            variant="soft"
            size="sm"
            :icon="hasPassword ? 'i-lucide-circle-check' : 'i-lucide-circle-minus'"
            :label="hasPassword ? 'Aktywne' : 'Nieustawione'"
          />
        </header>

        <div v-if="securityLoading" class="security-panel__loading">
          <USkeleton class="h-11 w-full" />
          <USkeleton class="h-11 w-full" />
          <USkeleton class="h-11 w-full" />
        </div>

        <form v-else-if="hasPassword" class="password-form" @submit.prevent="changePassword">
          <UFormField label="Obecne hasło" name="currentPassword" required>
            <UInput
              v-model="currentPassword"
              class="w-full"
              type="password"
              autocomplete="current-password"
              icon="i-lucide-lock-keyhole"
              required
            />
          </UFormField>
          <UFormField
            label="Nowe hasło"
            name="newPassword"
            required
          >
            <UInput
              v-model="newPassword"
              class="w-full"
              type="password"
              autocomplete="new-password"
              aria-describedby="new-password-requirements"
              icon="i-lucide-key-round"
              required
            />
            <ul
              id="new-password-requirements"
              class="password-requirements"
              aria-label="Wymagania nowego hasła"
            >
              <li
                v-for="requirement in newPasswordChecks"
                :key="requirement.key"
                :class="{ 'password-requirements__item--met': requirement.met }"
              >
                <UIcon
                  class="password-validation__icon"
                  :name="requirement.met ? 'i-lucide-circle-check' : 'i-lucide-circle'"
                  aria-hidden="true"
                />
                {{ requirement.label }}
              </li>
            </ul>
            <p
              v-if="newPasswordTooLong"
              class="password-feedback password-feedback--error"
              role="status"
            >
              <UIcon class="password-validation__icon" name="i-lucide-circle-alert" aria-hidden="true" />
              Hasło jest za długie — skróć je, szczególnie jeśli zawiera polskie znaki lub symbole.
            </p>
          </UFormField>
          <UFormField label="Powtórz nowe hasło" name="newPasswordConfirmation" required>
            <UInput
              v-model="newPasswordConfirmation"
              class="w-full"
              type="password"
              autocomplete="new-password"
              icon="i-lucide-key-round"
              required
            />
            <p
              v-if="newPasswordConfirmation"
              class="password-feedback"
              :class="passwordsMatch ? 'password-feedback--success' : 'password-feedback--error'"
              aria-live="polite"
            >
              <UIcon
                class="password-validation__icon"
                :name="passwordsMatch ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                aria-hidden="true"
              />
              {{ passwordsMatch ? 'Hasła są takie same.' : 'Hasła nie są takie same.' }}
            </p>
          </UFormField>

          <label class="revoke-switch">
            <span>
              <strong>Wyloguj pozostałe urządzenia</strong>
              <small>Zostanie tylko ta sesja, z której zmieniasz hasło.</small>
            </span>
            <USwitch v-model="revokeOtherSessions" aria-label="Wyloguj pozostałe urządzenia" />
          </label>

          <UAlert
            v-if="passwordError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :description="passwordError"
          />

          <div class="password-form__actions">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              icon="i-lucide-mail"
              :loading="resetSending"
              @click="sendPasswordReset"
            >
              Nie pamiętam obecnego hasła
            </UButton>
            <UButton
              type="submit"
              color="neutral"
              variant="solid"
              icon="i-lucide-shield-check"
              :loading="changingPassword"
            >
              Zmień hasło
            </UButton>
          </div>
        </form>

        <div v-else class="password-empty-state">
          <span><UIcon name="i-lucide-mail" /></span>
          <div>
            <h3>Logujesz się bez hasła</h3>
            <p>Możesz nadal używać linku jednorazowego lub połączonego konta. Jeśli chcesz, ustaw hasło przez bezpieczny link wysłany na e-mail.</p>
          </div>
          <UButton
            color="neutral"
            variant="solid"
            icon="i-lucide-send"
            :loading="resetSending"
            @click="sendPasswordReset"
          >
            Wyślij link ustawienia hasła
          </UButton>
          <UAlert
            v-if="passwordError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :description="passwordError"
          />
        </div>
      </section>

      <section class="security-panel">
        <header class="security-panel__header">
          <span class="security-panel__icon"><UIcon name="i-lucide-monitor-smartphone" /></span>
          <div>
            <p>Aktywne sesje</p>
            <h2>Zalogowane urządzenia</h2>
            <small>Sesje wygasają automatycznie po okresie bezczynności.</small>
          </div>
          <UBadge color="neutral" variant="subtle">{{ sessions.length }}</UBadge>
        </header>

        <div v-if="securityLoading" class="session-list">
          <USkeleton v-for="index in 2" :key="index" class="h-20 w-full" />
        </div>
        <div v-else-if="sessions.length" class="session-list">
          <article v-for="session in sessions" :key="session.id" class="session-row">
            <span class="session-row__icon"><UIcon :name="sessionDevice(session.userAgent).icon" /></span>
            <div>
              <h3>
                {{ sessionDevice(session.userAgent).label }}
                <UBadge
                  v-if="session.id === currentSessionId"
                  color="success"
                  variant="subtle"
                  size="xs"
                >
                  To urządzenie
                </UBadge>
              </h3>
              <p>
                {{ session.ipAddress || 'Adres IP niedostępny' }}
                <span>·</span>
                Aktywna do {{ formatDate(session.expiresAt) }}
              </p>
            </div>
            <UButton
              v-if="session.id !== currentSessionId"
              color="error"
              variant="ghost"
              icon="i-lucide-log-out"
              :loading="revokingSessionId === session.id"
              @click="revokeSession(session)"
            >
              Wyloguj
            </UButton>
          </article>
        </div>
        <div v-else class="session-empty">Brak aktywnych sesji do wyświetlenia.</div>

        <footer v-if="otherSessions.length" class="security-panel__footer">
          <p>Możesz zakończyć wszystkie sesje poza bieżącą jednym kliknięciem.</p>
          <UButton
            color="error"
            variant="soft"
            icon="i-lucide-log-out"
            label="Wyloguj pozostałe urządzenia"
            :loading="revokingOthers"
            :ui="{ base: 'shrink-0', label: 'whitespace-nowrap' }"
            @click="revokeAllOtherSessions"
          />
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.security-page {
  display: grid;
  gap: 18px;
}

.security-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  align-items: start;
}

.security-panel {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: calc(var(--ui-radius) * 1.25);
  background: var(--ui-bg);
}

.security-panel__header {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--ui-border-muted);
}

.security-panel__icon,
.password-empty-state > span,
.session-row__icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: var(--ui-radius);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-toned);
}

.security-panel__header p {
  margin: 0 0 3px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.security-panel__header h2,
.password-empty-state h3,
.session-row h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 650;
}

.security-panel__header small,
.password-empty-state p,
.session-row p,
.security-panel__footer p {
  display: block;
  margin: 4px 0 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.password-status {
  justify-self: end;
  white-space: nowrap;
}

.password-requirements {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 12px;
  margin: 9px 0 0;
  padding: 0;
  list-style: none;
}

.password-requirements li,
.password-feedback {
  display: flex;
  gap: 6px;
  align-items: center;
  color: var(--ui-text-muted);
  font-size: 10px;
  line-height: 1.4;
}

.password-validation__icon {
  flex: none;
}

.password-requirements__item--met,
.password-feedback--success {
  color: var(--ui-success);
}

.password-feedback {
  margin: 8px 0 0;
}

.password-feedback--error {
  color: var(--ui-error);
}

.security-panel__loading,
.password-form,
.password-empty-state,
.session-list {
  display: grid;
  gap: 16px;
  padding: 20px;
}

.revoke-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 14px;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.revoke-switch span {
  display: grid;
  gap: 3px;
}

.revoke-switch strong {
  color: var(--ui-text-highlighted);
  font-size: 12px;
}

.revoke-switch small {
  color: var(--ui-text-muted);
  font-size: 10px;
}

.password-form__actions,
.security-panel__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.password-empty-state {
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: start;
}

.password-empty-state > button,
.password-empty-state > [role='alert'] {
  grid-column: 1 / -1;
}

.session-list {
  gap: 0;
}

.session-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding-block: 14px;
}

.session-row + .session-row {
  border-top: 1px solid var(--ui-border-muted);
}

.session-row h3 {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}

.session-row p span {
  margin-inline: 3px;
}

.session-empty {
  padding: 28px 20px;
  color: var(--ui-text-muted);
  font-size: 12px;
  text-align: center;
}

.security-panel__footer {
  padding: 16px 20px;
  border-top: 1px solid var(--ui-border-muted);
  background: var(--ui-bg-muted);
}

.security-panel__footer p {
  max-width: 330px;
  margin: 0;
}

@media (max-width: 1080px) {
  .security-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .password-form__actions,
  .security-panel__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .password-form__actions :deep(button),
  .security-panel__footer :deep(button) {
    width: 100%;
  }

  .session-row {
    grid-template-columns: 40px minmax(0, 1fr);
  }

  .session-row > button {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
