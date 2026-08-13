<script setup lang="ts">
import { getOpenExpertPasswordIssue } from '@openexpert/auth'
import type {
  PortalAccountConsent,
  PortalAccountConsentDecision,
  PortalAccountResponse,
} from '~~/shared/types/portal-account'
import { PORTAL_ACCOUNT_ARCHIVE_CONFIRMATION } from '~~/shared/utils/portal-account'

type AuthProvider = 'google' | 'apple'

interface AuthAccount {
  id: string
  providerId: string
  accountId: string
}

const providers: AuthProvider[] = ['google', 'apple']
const archivePhrase = PORTAL_ACCOUNT_ARCHIVE_CONFIRMATION

definePageMeta({ middleware: 'client-auth' })

const authClient = useAuthClient()
const authenticatedUser = useAuthUser()
const runtimeConfig = useRuntimeConfig()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { $portalFetch } = useNuxtApp()
const { errorMessage } = usePortalAuth()
const portalMutationFetch = $portalFetch as unknown as <T = unknown>(
  request: string,
  options: { method: 'POST', body: Record<string, unknown> },
) => Promise<T>

const {
  data: response,
  status,
  error: accountRequestError,
  refresh,
} = await usePortalFetch<PortalAccountResponse>('/api/client/account', {
  key: `portal-account-${authenticatedUser.value?.id || 'anonymous'}`,
  dedupe: 'defer',
})

const payload = computed(() => response.value?.data)
const accounts = ref<AuthAccount[]>([])
const accountsLoading = ref(true)
const accountsError = ref('')
const linkingProvider = ref<AuthProvider | null>(null)
const unlinkingProvider = ref<AuthProvider | null>(null)
const pendingUnlinkProvider = ref<AuthProvider | null>(null)

const passwordModalOpen = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const repeatedPassword = ref('')
const passwordVisible = ref(false)
const passwordSaving = ref(false)
const passwordError = ref('')

const pendingConsent = ref<PortalAccountConsent | null>(null)
const consentIdempotencyKey = ref('')
const consentWithdrawing = ref(false)
const consentError = ref('')

const archiveModalOpen = ref(false)
const archiveConfirmation = ref('')
const archivePassword = ref('')
const archivePasswordVisible = ref(false)
const archiveIdempotencyKey = ref('')
const archiving = ref(false)
const archiveError = ref('')
const failedExpertAvatars = reactive(new Set<string>())

const social = computed(() => runtimeConfig.public.openexpert.social)
const hasPassword = computed(() => providerLinked('credential'))
const withdrawModalOpen = computed({
  get: () => pendingConsent.value !== null,
  set: (open: boolean) => {
    if (!open && !consentWithdrawing.value) pendingConsent.value = null
  },
})
const unlinkModalOpen = computed({
  get: () => pendingUnlinkProvider.value !== null,
  set: (open: boolean) => {
    if (!open && !unlinkingProvider.value) pendingUnlinkProvider.value = null
  },
})
const passwordFormReady = computed(() => (
  Boolean(newPassword.value && repeatedPassword.value)
  && newPassword.value === repeatedPassword.value
  && (!hasPassword.value || Boolean(currentPassword.value))
))
const archiveReady = computed(() => (
  archiveConfirmation.value === archivePhrase
  && (!hasPassword.value || Boolean(archivePassword.value))
))

useHead({ title: 'Ustawienia konta — OpenExpert' })

function providerLinked(provider: string): boolean {
  return accounts.value.some(account => account.providerId === provider)
}

function providerConfigured(provider: AuthProvider): boolean {
  return social.value?.[provider] === true
}

function providerLabel(provider: AuthProvider): string {
  return provider === 'google' ? 'Google' : 'Apple'
}

function providerIcon(provider: AuthProvider): string {
  return provider === 'google' ? 'i-lucide-circle-user-round' : 'i-lucide-apple'
}

function canUnlinkProvider(provider: AuthProvider): boolean {
  return providerLinked(provider) && accounts.value.length > 1
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    primary: 'Główny kontakt',
    primary_contact: 'Główny kontakt',
    contact: 'Osoba kontaktowa',
    representative: 'Pełnomocnik',
    owner: 'Właściciel profilu',
  }
  return labels[role] || role.replaceAll('_', ' ')
}

function bookingKey(organizationId: string, expertId: string): string {
  return `${organizationId}:${expertId}`
}

function expertInitials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .map(part => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'OE'
}

function expertAvatarUrl(organizationId: string, expertId: string, avatarUrl: string | null): string {
  return avatarUrl && !failedExpertAvatars.has(bookingKey(organizationId, expertId))
    ? avatarUrl
    : ''
}

function handleExpertAvatarError(organizationId: string, expertId: string) {
  failedExpertAvatars.add(bookingKey(organizationId, expertId))
}

function decisionPresentation(decision: PortalAccountConsentDecision): {
  label: string
  color: 'success' | 'warning' | 'error' | 'neutral'
  icon: string
} {
  if (decision === 'granted') {
    return { label: 'Wyrażona', color: 'success', icon: 'i-lucide-circle-check' }
  }
  if (decision === 'withdrawn') {
    return { label: 'Cofnięta', color: 'error', icon: 'i-lucide-circle-x' }
  }
  if (decision === 'declined') {
    return { label: 'Niewyrażona', color: 'neutral', icon: 'i-lucide-circle-minus' }
  }
  return { label: 'Brak decyzji', color: 'warning', icon: 'i-lucide-circle-help' }
}

function formatDate(value: string | null): string {
  if (!value) return 'Brak daty'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Nieznana data'
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function sourceLabel(source: string | null): string {
  const labels: Record<string, string> = {
    client_portal: 'Panel klienta',
    sms_verification: 'Weryfikacja SMS',
    booking_widget: 'Rezerwacja spotkania',
    crm: 'OpenExpert CRM',
    staff: 'Doradca w CRM',
    import: 'Import danych',
    form: 'Formularz',
  }
  if (!source) return 'Źródło nieznane'
  return labels[source] || source.replaceAll('_', ' ')
}

function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    email: 'E-mail',
    sms: 'SMS',
    phone: 'Telefon',
    marketing: 'Marketing',
    all: 'Wszystkie kanały',
  }
  return labels[channel] || channel.replaceAll('_', ' ')
}

function authErrorCode(error: unknown): string {
  const candidate = error as {
    code?: unknown
    data?: { code?: unknown, data?: { code?: unknown } }
  } | null
  return String(
    candidate?.code
    ?? candidate?.data?.code
    ?? candidate?.data?.data?.code
    ?? '',
  ).toUpperCase()
}

function resetPasswordForm() {
  currentPassword.value = ''
  newPassword.value = ''
  repeatedPassword.value = ''
  passwordVisible.value = false
  passwordError.value = ''
}

async function loadAccounts() {
  accountsLoading.value = true
  accountsError.value = ''
  try {
    const result = await authClient.listAccounts()
    if (result.error) throw result.error
    accounts.value = (result.data ?? []) as AuthAccount[]

    const linked = String(route.query.linked || '')
    if ((linked === 'google' || linked === 'apple') && providerLinked(linked)) {
      toast.add({
        title: `Konto ${providerLabel(linked)} połączone`,
        description: 'Nowa metoda logowania jest już aktywna.',
        color: 'success',
        icon: 'i-lucide-link-2',
      })
      const query = { ...route.query }
      delete query.linked
      delete query.linkError
      await router.replace({ query })
    }
    else if (route.query.linkError) {
      toast.add({
        title: 'Nie udało się połączyć konta',
        description: String(route.query.linkError),
        color: 'error',
        icon: 'i-lucide-link-2-off',
      })
      const query = { ...route.query }
      delete query.linkError
      await router.replace({ query })
    }
  }
  catch (error) {
    accountsError.value = errorMessage(error as { message?: string, code?: string })
  }
  finally {
    accountsLoading.value = false
  }
}

async function linkProvider(provider: AuthProvider) {
  if (
    !providerConfigured(provider)
    || providerLinked(provider)
    || linkingProvider.value
  ) return

  linkingProvider.value = provider
  try {
    const callbackURL = new URL('/account', window.location.origin)
    callbackURL.searchParams.set('linked', provider)
    const errorCallbackURL = new URL('/account', window.location.origin)
    errorCallbackURL.searchParams.set(
      'linkError',
      `Połączenie z ${providerLabel(provider)} zostało anulowane.`,
    )
    const result = await authClient.linkSocial({
      provider,
      callbackURL: callbackURL.toString(),
      errorCallbackURL: errorCallbackURL.toString(),
    })
    if (result.error) throw result.error
  }
  catch (error) {
    toast.add({
      title: `Nie udało się połączyć konta ${providerLabel(provider)}`,
      description: errorMessage(error as { message?: string, code?: string }),
      color: 'error',
      icon: 'i-lucide-link-2-off',
    })
    linkingProvider.value = null
  }
}

function askToUnlink(provider: AuthProvider) {
  if (!canUnlinkProvider(provider)) return
  pendingUnlinkProvider.value = provider
}

async function unlinkProvider() {
  const provider = pendingUnlinkProvider.value
  if (!provider || unlinkingProvider.value || !canUnlinkProvider(provider)) return

  unlinkingProvider.value = provider
  try {
    const result = await authClient.unlinkAccount({ providerId: provider })
    if (result.error) throw result.error
    accounts.value = accounts.value.filter(account => account.providerId !== provider)
    pendingUnlinkProvider.value = null
    toast.add({
      title: `Konto ${providerLabel(provider)} odłączone`,
      description: 'Pozostałe metody logowania nadal działają.',
      color: 'success',
      icon: 'i-lucide-unlink',
    })
  }
  catch (error) {
    toast.add({
      title: `Nie udało się odłączyć konta ${providerLabel(provider)}`,
      description: authErrorCode(error) === 'SESSION_NOT_FRESH'
        ? 'Dla bezpieczeństwa wyloguj się, zaloguj ponownie i spróbuj jeszcze raz.'
        : errorMessage(error as { message?: string, code?: string }),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    unlinkingProvider.value = null
  }
}

function openPasswordEditor() {
  resetPasswordForm()
  passwordModalOpen.value = true
}

async function savePassword() {
  const changingExistingPassword = hasPassword.value
  passwordError.value = getOpenExpertPasswordIssue(newPassword.value) || ''
  if (!passwordError.value && newPassword.value !== repeatedPassword.value) {
    passwordError.value = 'Nowe hasła nie są takie same.'
  }
  if (
    !passwordError.value
    && hasPassword.value
    && currentPassword.value === newPassword.value
  ) {
    passwordError.value = 'Nowe hasło musi różnić się od obecnego.'
  }
  if (!passwordError.value && hasPassword.value && !currentPassword.value) {
    passwordError.value = 'Wpisz obecne hasło.'
  }
  if (passwordError.value || passwordSaving.value) return

  passwordSaving.value = true
  try {
    if (hasPassword.value) {
      const result = await authClient.changePassword({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value,
        revokeOtherSessions: false,
      })
      if (result.error) throw result.error
    }
    else {
      await $portalFetch('/api/client/password', {
        method: 'POST',
        body: { password: newPassword.value },
      })
      await loadAccounts()
    }

    passwordModalOpen.value = false
    resetPasswordForm()
    toast.add({
      title: changingExistingPassword ? 'Hasło zostało zmienione' : 'Hasło zostało ustawione',
      description: 'Możesz używać go przy kolejnym logowaniu.',
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
  }
  catch (error) {
    passwordError.value = authErrorCode(error) === 'INVALID_PASSWORD'
      ? 'Obecne hasło jest nieprawidłowe.'
      : errorMessage(error as { message?: string, code?: string, statusCode?: number })
  }
  finally {
    passwordSaving.value = false
  }
}

function askToWithdraw(consent: PortalAccountConsent) {
  if (!consent.canWithdraw) return
  consentError.value = ''
  consentIdempotencyKey.value = crypto.randomUUID()
  pendingConsent.value = consent
}

async function withdrawConsent() {
  const consent = pendingConsent.value
  if (!consent || !consent.canWithdraw || consentWithdrawing.value) return

  consentWithdrawing.value = true
  consentError.value = ''
  try {
    await portalMutationFetch('/api/client/account/consents/withdraw', {
      method: 'POST',
      body: {
        organizationId: consent.organizationId,
        clientId: consent.clientId,
        clientPersonId: consent.clientPersonId,
        definitionId: consent.definitionId,
        idempotencyKey: consentIdempotencyKey.value,
      },
    })
    pendingConsent.value = null
    await refresh()
    toast.add({
      title: 'Zgoda została cofnięta',
      description: 'Zmiana została zapisana w historii i przekazana do CRM.',
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
  }
  catch (error) {
    const code = authErrorCode(error)
    consentError.value = code === 'CONSENT_NOT_ACTIVE'
      ? 'Ta zgoda została już cofnięta albo jej stan zmienił się w CRM.'
      : code === 'CONSENT_NOT_FOUND'
        ? 'Nie znaleziono tej zgody w aktualnym profilu klienta.'
        : errorMessage(error as {
            message?: string
            code?: string
            statusCode?: number
            data?: { message?: string, code?: string }
          })
  }
  finally {
    consentWithdrawing.value = false
  }
}

function openArchiveModal() {
  archiveConfirmation.value = ''
  archivePassword.value = ''
  archivePasswordVisible.value = false
  archiveError.value = ''
  archiveIdempotencyKey.value = crypto.randomUUID()
  archiveModalOpen.value = true
}

async function archiveAccount() {
  if (!archiveReady.value || archiving.value) return

  archiving.value = true
  archiveError.value = ''
  try {
    await portalMutationFetch('/api/client/account/archive', {
      method: 'POST',
      body: {
        confirmation: archivePhrase,
        ...(hasPassword.value ? { password: archivePassword.value } : {}),
        idempotencyKey: archiveIdempotencyKey.value,
      },
    })
    await signOutAuthenticatedUser()
    await navigateTo('/login?accountArchived=1')
  }
  catch (error) {
    const code = authErrorCode(error)
    archiveError.value = code === 'INVALID_PASSWORD' || code === 'INVALID_CURRENT_PASSWORD'
      ? 'Hasło jest nieprawidłowe.'
      : code === 'SESSION_NOT_FRESH' || code === 'FRESH_AUTHENTICATION_REQUIRED'
        ? 'Dla bezpieczeństwa wyloguj się, zaloguj ponownie i spróbuj jeszcze raz.'
        : errorMessage(error as {
            message?: string
            code?: string
            statusCode?: number
            data?: { message?: string, code?: string }
          })
  }
  finally {
    archiving.value = false
  }
}

watch(passwordModalOpen, (open) => {
  if (!open && !passwordSaving.value) resetPasswordForm()
})

watch(archiveModalOpen, (open) => {
  if (!open && !archiving.value) {
    archiveConfirmation.value = ''
    archivePassword.value = ''
    archiveIdempotencyKey.value = ''
    archiveError.value = ''
  }
})

onMounted(loadAccounts)
</script>

<template>
  <div class="account-page">
    <PortalHeader
      :user-name="payload?.user.name || authenticatedUser?.name"
      :user-email="payload?.user.email || authenticatedUser?.email"
    />

    <main class="account-shell">
      <header class="account-intro">
        <NuxtLink to="/" class="account-intro__back">
          <UIcon name="i-lucide-arrow-left" />
          Wróć do panelu
        </NuxtLink>
        <div>
          <p class="account-eyebrow">TWOJE KONTO</p>
          <h1>Ustawienia konta</h1>
          <p>Zarządzaj sposobami logowania, sprawdź swoje zgody i kontroluj dostęp do panelu.</p>
        </div>
      </header>

      <div v-if="status === 'pending'" class="account-loading" aria-label="Ładowanie ustawień konta">
        <USkeleton class="h-40 w-full" />
        <USkeleton class="h-72 w-full" />
        <USkeleton class="h-64 w-full" />
      </div>

      <UAlert
        v-else-if="accountRequestError"
        class="account-load-error"
        color="error"
        variant="subtle"
        icon="i-lucide-wifi-off"
        title="Nie udało się pobrać ustawień konta"
        description="Połączenie zostało przerwane. Spróbuj ponownie — żadne dane nie zostały zmienione."
      >
        <template #actions>
          <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
            Ponów
          </UButton>
        </template>
      </UAlert>

      <div v-else-if="payload" class="account-layout">
        <aside class="account-nav" aria-label="Sekcje ustawień konta">
          <nav>
            <a href="#profile"><UIcon name="i-lucide-user-round" />Dane konta</a>
            <a href="#appointments"><UIcon name="i-lucide-calendar-plus-2" />Spotkania</a>
            <a href="#login"><UIcon name="i-lucide-key-round" />Logowanie</a>
            <a href="#consents"><UIcon name="i-lucide-shield-check" />Zgody</a>
            <a href="#security"><UIcon name="i-lucide-shield-alert" />Bezpieczeństwo</a>
          </nav>
          <div class="account-nav__hint">
            <UIcon name="i-lucide-lock-keyhole" />
            <p><strong>Bezpieczne ustawienia</strong><span>Wrażliwe zmiany wymagają ponownego potwierdzenia tożsamości.</span></p>
          </div>
        </aside>

        <div class="account-content">
          <section id="profile" class="settings-section">
            <header class="settings-section__header">
              <span class="settings-section__icon"><UIcon name="i-lucide-user-round" /></span>
              <div>
                <p>Profil</p>
                <h2>Dane konta</h2>
                <span>Informacje przypisane do Twojego dostępu w OpenExpert.</span>
              </div>
            </header>

            <dl class="identity-fields">
              <div>
                <dt>Imię i nazwisko</dt>
                <dd>{{ payload.user.name }}</dd>
              </div>
              <div>
                <dt>Adres e-mail</dt>
                <dd>{{ payload.user.email }}</dd>
              </div>
            </dl>

            <div v-if="payload.profiles.length" class="profile-access-list">
              <div class="subsection-heading">
                <h3>Powiązane profile klienta</h3>
                <UBadge color="neutral" variant="subtle">{{ payload.profiles.length }}</UBadge>
              </div>
              <article v-for="profile in payload.profiles" :key="`${profile.organizationId}-${profile.clientPersonId}`" class="profile-access-row">
                <span class="profile-access-row__mark"><UIcon name="i-lucide-building-2" /></span>
                <div>
                  <strong>{{ profile.organizationName }}</strong>
                  <p>{{ profile.displayName }} · {{ roleLabel(profile.role) }}</p>
                </div>
                <UBadge
                  :color="profile.status === 'active' ? 'success' : 'neutral'"
                  variant="subtle"
                  :icon="profile.status === 'active' ? 'i-lucide-circle-check' : 'i-lucide-archive'"
                >
                  {{ profile.status === 'active' ? 'Aktywny dostęp' : 'Zarchiwizowany' }}
                </UBadge>
              </article>
            </div>
          </section>

          <section id="appointments" class="settings-section settings-section--appointments">
            <header class="settings-section__header">
              <span class="settings-section__icon settings-section__icon--appointments"><UIcon name="i-lucide-calendar-plus-2" /></span>
              <div>
                <p>Spotkania</p>
                <h2>Umów się z moim ekspertem</h2>
                <span>Wybierz rodzaj konsultacji, a następnie dogodny dzień i godzinę.</span>
              </div>
            </header>

            <div v-if="payload.expertBookings.length" class="expert-booking-list">
              <article
                v-for="booking in payload.expertBookings"
                :key="bookingKey(booking.organizationId, booking.expert.id)"
                class="expert-booking-card"
              >
                <div class="expert-booking-card__identity">
                  <span class="expert-booking-card__avatar">
                    <img
                      v-if="expertAvatarUrl(booking.organizationId, booking.expert.id, booking.expert.avatarUrl)"
                      :src="expertAvatarUrl(booking.organizationId, booking.expert.id, booking.expert.avatarUrl)"
                      alt=""
                      @error="handleExpertAvatarError(booking.organizationId, booking.expert.id)"
                    >
                    <template v-else>{{ expertInitials(booking.expert.name) }}</template>
                  </span>
                  <div>
                    <UBadge color="neutral" variant="subtle">{{ booking.organizationName }}</UBadge>
                    <h3>{{ booking.expert.name }}</h3>
                    <p>{{ booking.expert.professionalTitle || 'Ekspert prowadzący Twoją sprawę' }}</p>
                  </div>
                </div>

                <div class="expert-booking-card__details">
                  <div>
                    <span><UIcon name="i-lucide-map-pin" />Miejsce spotkania</span>
                    <strong>{{ booking.facility.name }}</strong>
                    <small v-if="booking.facility.address">{{ booking.facility.address }}</small>
                  </div>
                  <div>
                    <span><UIcon name="i-lucide-briefcase-business" />Dostępne konsultacje</span>
                    <ul>
                      <li v-for="service in booking.services" :key="service.id">
                        {{ service.name }}
                        <small v-if="service.durationMinutes">{{ service.durationMinutes }} min</small>
                      </li>
                    </ul>
                  </div>
                </div>

                <div class="expert-booking-card__footer">
                  <p><UIcon name="i-lucide-shield-check" />Rezerwacja zostanie powiązana z Twoim kontem klienta.</p>
                  <UButton
                    :to="booking.bookingPath"
                    color="neutral"
                    variant="solid"
                    icon="i-lucide-calendar-check-2"
                    trailing
                  >
                    Wybierz termin
                  </UButton>
                </div>
              </article>
            </div>

            <UAlert
              v-else-if="payload.expertBookingStatus === 'unavailable'"
              color="warning"
              variant="subtle"
              icon="i-lucide-calendar-x-2"
              title="Nie udało się pobrać kalendarza eksperta"
              description="Odśwież stronę za chwilę. Pozostałe ustawienia konta pozostają dostępne."
            >
              <template #actions>
                <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
                  Ponów
                </UButton>
              </template>
            </UAlert>

            <OeEmptyState
              v-else
              compact
              align="start"
              icon="i-lucide-calendar-clock"
              title="Rezerwacja online nie jest jeszcze dostępna"
              description="Gdy Twój ekspert udostępni kalendarz konsultacji, możliwość wyboru terminu pojawi się właśnie tutaj."
              title-tag="h3"
            />
          </section>

          <section id="login" class="settings-section">
            <header class="settings-section__header">
              <span class="settings-section__icon"><UIcon name="i-lucide-key-round" /></span>
              <div>
                <p>Autoryzacja</p>
                <h2>Logowanie i hasło</h2>
                <span>Połączone metody prowadzą do tego samego konta klienta.</span>
              </div>
            </header>

            <UAlert
              v-if="accountsError"
              color="error"
              variant="subtle"
              icon="i-lucide-key-round"
              title="Nie udało się pobrać metod logowania"
              :description="accountsError"
            >
              <template #actions>
                <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="loadAccounts">
                  Ponów
                </UButton>
              </template>
            </UAlert>

            <div v-else-if="accountsLoading" class="method-skeletons">
              <USkeleton v-for="item in 4" :key="item" class="h-24 w-full" />
            </div>

            <div v-else class="login-methods">
              <article class="login-method">
                <span class="login-method__icon"><UIcon name="i-lucide-mail" /></span>
                <div class="login-method__copy">
                  <div><h3>Link jednorazowy e-mail</h3><UBadge color="success" variant="subtle">Aktywny</UBadge></div>
                  <p>Bezpieczny link możesz otrzymać na adres {{ payload.user.email }}.</p>
                </div>
                <span class="login-method__fixed"><UIcon name="i-lucide-check" />Zawsze dostępny</span>
              </article>

              <article class="login-method">
                <span class="login-method__icon"><UIcon name="i-lucide-lock-keyhole" /></span>
                <div class="login-method__copy">
                  <div>
                    <h3>Hasło</h3>
                    <UBadge :color="hasPassword ? 'success' : 'neutral'" variant="subtle">
                      {{ hasPassword ? 'Ustawione' : 'Nieustawione' }}
                    </UBadge>
                  </div>
                  <p>{{ hasPassword ? 'Możesz logować się adresem e-mail i hasłem.' : 'Dodaj hasło, jeśli chcesz korzystać z klasycznego logowania.' }}</p>
                </div>
                <UButton
                  color="neutral"
                  variant="outline"
                  :icon="hasPassword ? 'i-lucide-pencil' : 'i-lucide-plus'"
                  @click="openPasswordEditor"
                >
                  {{ hasPassword ? 'Zmień' : 'Dodaj' }}
                </UButton>
              </article>

              <article v-for="provider in providers" :key="provider" class="login-method">
                <span class="login-method__icon login-method__icon--social">
                  <img v-if="provider === 'google'" src="/assets/google-icon.svg" alt="" width="19" height="19">
                  <UIcon v-else :name="providerIcon(provider)" />
                </span>
                <div class="login-method__copy">
                  <div>
                    <h3>{{ providerLabel(provider) }}</h3>
                    <UBadge
                      :color="providerLinked(provider) ? 'success' : 'neutral'"
                      variant="subtle"
                    >
                      {{ providerLinked(provider) ? 'Połączone' : (providerConfigured(provider) ? 'Dostępne' : 'Niedostępne') }}
                    </UBadge>
                  </div>
                  <p v-if="providerLinked(provider)">Możesz używać konta {{ providerLabel(provider) }} do logowania.</p>
                  <p v-else-if="providerConfigured(provider)">Połącz konto, aby dodać wygodny sposób logowania.</p>
                  <p v-else>Ta metoda nie jest obecnie dostępna.</p>
                </div>
                <UButton
                  v-if="providerLinked(provider)"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-unlink"
                  :disabled="!canUnlinkProvider(provider)"
                  :title="canUnlinkProvider(provider) ? 'Odłącz konto' : 'Najpierw dodaj inną metodę logowania'"
                  @click="askToUnlink(provider)"
                >
                  Odłącz
                </UButton>
                <UButton
                  v-else
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-link-2"
                  :loading="linkingProvider === provider"
                  :disabled="!providerConfigured(provider)"
                  @click="linkProvider(provider)"
                >
                  Połącz
                </UButton>
              </article>
            </div>

            <p class="section-footnote">
              <UIcon name="i-lucide-info" />
              Nie możesz odłączyć ostatniej metody logowania. Najpierw dodaj inną, aby nie utracić dostępu.
            </p>
          </section>

          <section id="consents" class="settings-section">
            <header class="settings-section__header settings-section__header--with-count">
              <span class="settings-section__icon"><UIcon name="i-lucide-shield-check" /></span>
              <div>
                <p>Prywatność</p>
                <h2>Zgody i upoważnienia</h2>
                <span>Aktualny stan i pełna historia zmian zapisana w CRM.</span>
              </div>
              <UBadge color="neutral" variant="subtle" size="lg">{{ payload.consents.length }}</UBadge>
            </header>

            <div v-if="payload.consents.length" class="consent-list">
              <article v-for="consent in payload.consents" :key="`${consent.clientPersonId}-${consent.definitionId}`" class="consent-card">
                <div class="consent-card__top">
                  <div class="consent-card__title">
                    <span><UIcon name="i-lucide-file-check-2" /></span>
                    <div>
                      <h3>{{ consent.title }}</h3>
                      <p>{{ consent.organizationName }} · {{ consent.personName }}</p>
                    </div>
                  </div>
                  <UBadge
                    :color="decisionPresentation(consent.decision).color"
                    variant="subtle"
                    :icon="decisionPresentation(consent.decision).icon"
                  >
                    {{ decisionPresentation(consent.decision).label }}
                  </UBadge>
                </div>

                <p class="consent-card__content">{{ consent.content }}</p>

                <dl class="consent-meta">
                  <div><dt>Cel</dt><dd>{{ consent.purpose }}</dd></div>
                  <div><dt>Kanał</dt><dd>{{ channelLabel(consent.channel) }}</dd></div>
                  <div><dt>Podstawa</dt><dd>{{ consent.legalBasis }}</dd></div>
                  <div><dt>Ostatnia zmiana</dt><dd>{{ formatDate(consent.decidedAt) }}</dd></div>
                </dl>

                <div class="consent-card__footer">
                  <div class="consent-tags">
                    <UBadge v-if="consent.isRequired" color="warning" variant="subtle">Wymagana do realizacji usługi</UBadge>
                    <span v-if="consent.source">Źródło: {{ sourceLabel(consent.source) }}</span>
                  </div>
                  <UButton
                    v-if="consent.canWithdraw"
                    color="error"
                    variant="outline"
                    icon="i-lucide-shield-x"
                    @click="askToWithdraw(consent)"
                  >
                    Cofnij zgodę
                  </UButton>
                </div>

                <details v-if="consent.history.length" class="consent-history">
                  <summary>
                    <span><UIcon name="i-lucide-history" />Historia zmian ({{ consent.history.length }})</span>
                    <UIcon name="i-lucide-chevron-down" class="consent-history__chevron" />
                  </summary>
                  <ol>
                    <li v-for="historyItem in consent.history" :key="historyItem.id">
                      <span :class="`is-${historyItem.decision}`"><UIcon :name="decisionPresentation(historyItem.decision).icon" /></span>
                      <div>
                        <strong>{{ decisionPresentation(historyItem.decision).label }}</strong>
                        <p>{{ formatDate(historyItem.occurredAt) }} · {{ sourceLabel(historyItem.source) }}<template v-if="historyItem.version"> · wersja {{ historyItem.version }}</template></p>
                      </div>
                    </li>
                  </ol>
                </details>
              </article>
            </div>

            <div v-else class="empty-consents">
              <span><UIcon name="i-lucide-shield-check" /></span>
              <h3>Brak zapisanych zgód</h3>
              <p>Gdy pojawi się zgoda wymagająca Twojej decyzji, zobaczysz ją w tym miejscu.</p>
            </div>
          </section>

          <section id="security" class="settings-section settings-section--danger">
            <header class="settings-section__header">
              <span class="settings-section__icon settings-section__icon--danger"><UIcon name="i-lucide-shield-alert" /></span>
              <div>
                <p>Strefa bezpieczeństwa</p>
                <h2>Usunięcie konta</h2>
                <span>Usuń dostęp do panelu przez bezpieczną archiwizację.</span>
              </div>
            </header>

            <div class="archive-explanation">
              <div>
                <h3>Usuń dostęp do konta klienta</h3>
                <p>
                  Ta operacja <strong>nie usuwa danych na stałe</strong>. Konto i dostęp do panelu zostaną zarchiwizowane,
                  a historia spraw oraz wymagane dane pozostaną w OpenExpert CRM zgodnie z zasadami retencji.
                </p>
                <ul>
                  <li><UIcon name="i-lucide-check" />Dostęp do wszystkich powiązanych profili zostanie wyłączony.</li>
                  <li><UIcon name="i-lucide-check" />Zmiana będzie od razu widoczna dla zespołu w CRM.</li>
                  <li><UIcon name="i-lucide-check" />Historia zgód i obsługi pozostanie audytowalna.</li>
                </ul>
              </div>
              <UButton color="error" variant="solid" icon="i-lucide-archive" @click="openArchiveModal">
                Usuń konto
              </UButton>
            </div>
          </section>
        </div>
      </div>
    </main>

    <UModal
      v-model:open="passwordModalOpen"
      :title="hasPassword ? 'Zmień hasło' : 'Dodaj hasło'"
      :description="hasPassword ? 'Podaj obecne hasło i ustaw nowe.' : 'Hasło będzie dodatkową metodą logowania do tego samego konta.'"
      :dismissible="!passwordSaving"
    >
      <template #body>
        <form class="modal-form" @submit.prevent="savePassword">
          <UFormField v-if="hasPassword" label="Obecne hasło" required>
            <UInput
              v-model="currentPassword"
              type="password"
              autocomplete="current-password"
              icon="i-lucide-lock-keyhole"
              size="lg"
              class="w-full"
              required
              autofocus
            />
          </UFormField>
          <UFormField label="Nowe hasło" description="Minimum 10 znaków, mała i wielka litera oraz cyfra." required>
            <UInput
              v-model="newPassword"
              :type="passwordVisible ? 'text' : 'password'"
              autocomplete="new-password"
              icon="i-lucide-key-round"
              size="lg"
              class="w-full"
              required
              :autofocus="!hasPassword"
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
          <UFormField label="Powtórz nowe hasło" required>
            <UInput
              v-model="repeatedPassword"
              :type="passwordVisible ? 'text' : 'password'"
              autocomplete="new-password"
              icon="i-lucide-key-round"
              size="lg"
              class="w-full"
              required
            />
          </UFormField>
          <UAlert v-if="passwordError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="passwordError" />
          <div class="modal-actions">
            <UButton type="button" color="neutral" variant="ghost" :disabled="passwordSaving" @click="passwordModalOpen = false">
              Anuluj
            </UButton>
            <UButton type="submit" icon="i-lucide-save" :loading="passwordSaving" :disabled="!passwordFormReady">
              {{ hasPassword ? 'Zmień hasło' : 'Dodaj hasło' }}
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      v-model:open="unlinkModalOpen"
      :title="pendingUnlinkProvider ? `Odłączyć konto ${providerLabel(pendingUnlinkProvider)}?` : 'Odłączyć metodę logowania?'"
      description="Ta metoda przestanie działać przy logowaniu. Pozostałe połączone metody pozostaną aktywne."
      :dismissible="!unlinkingProvider"
    >
      <template #body>
        <div class="modal-form">
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-unlink"
            title="Sprawdź pozostałe metody"
            description="Przed odłączeniem upewnij się, że znasz hasło lub masz dostęp do innego połączonego konta."
          />
          <div class="modal-actions">
            <UButton color="neutral" variant="ghost" :disabled="Boolean(unlinkingProvider)" @click="pendingUnlinkProvider = null">Anuluj</UButton>
            <UButton color="error" icon="i-lucide-unlink" :loading="Boolean(unlinkingProvider)" @click="unlinkProvider">Odłącz konto</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="withdrawModalOpen"
      title="Cofnąć zgodę?"
      :description="pendingConsent?.title || 'Wybrana zgoda zostanie cofnięta.'"
      :dismissible="!consentWithdrawing"
    >
      <template #body>
        <div class="modal-form">
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-alert"
            title="Zmiana zostanie zapisana w historii"
            description="Cofnięcie zgody trafi do OpenExpert CRM i może ograniczyć komunikację lub realizację działań opartych na tej zgodzie."
          />
          <UAlert v-if="consentError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="consentError" />
          <div class="modal-actions">
            <UButton color="neutral" variant="ghost" :disabled="consentWithdrawing" @click="pendingConsent = null">Anuluj</UButton>
            <UButton color="error" icon="i-lucide-shield-x" :loading="consentWithdrawing" @click="withdrawConsent">Cofnij zgodę</UButton>
          </div>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="archiveModalOpen"
      title="Usunąć konto klienta?"
      description="Dostęp do panelu zostanie wyłączony natychmiast po potwierdzeniu."
      :dismissible="!archiving"
    >
      <template #body>
        <form class="modal-form" @submit.prevent="archiveAccount">
          <UAlert
            color="error"
            variant="subtle"
            icon="i-lucide-archive"
            title="To nie jest twarde usunięcie danych"
            description="Konto zostanie zarchiwizowane. Historia spraw, zgód i wymagane dane pozostaną w CRM zgodnie z zasadami retencji."
          />
          <UFormField v-if="hasPassword" label="Aktualne hasło" description="Potwierdź, że to Ty wykonujesz tę operację." required>
            <UInput
              v-model="archivePassword"
              :type="archivePasswordVisible ? 'text' : 'password'"
              autocomplete="current-password"
              icon="i-lucide-lock-keyhole"
              size="lg"
              class="w-full"
              required
              autofocus
            >
              <template #trailing>
                <UButton
                  type="button"
                  color="neutral"
                  variant="ghost"
                  square
                  size="xs"
                  :icon="archivePasswordVisible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  :aria-label="archivePasswordVisible ? 'Ukryj hasło' : 'Pokaż hasło'"
                  @click="archivePasswordVisible = !archivePasswordVisible"
                />
              </template>
            </UInput>
          </UFormField>
          <UAlert
            v-else
            color="warning"
            variant="subtle"
            icon="i-lucide-shield-check"
            title="Potwierdzamy bieżącą sesję"
            description="Jeśli logowanie jest zbyt stare, poprosimy Cię o ponowne zalogowanie przed archiwizacją."
          />
          <UFormField required>
            <template #label>
              Wpisz <strong>{{ archivePhrase }}</strong>, aby potwierdzić
            </template>
            <UInput
              v-model="archiveConfirmation"
              autocomplete="off"
              :placeholder="archivePhrase"
              icon="i-lucide-keyboard"
              size="lg"
              class="w-full"
              required
              :autofocus="!hasPassword"
            />
          </UFormField>
          <UAlert v-if="archiveError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="archiveError" />
          <div class="modal-actions">
            <UButton type="button" color="neutral" variant="ghost" :disabled="archiving" @click="archiveModalOpen = false">Anuluj</UButton>
            <UButton type="submit" color="error" icon="i-lucide-archive" :loading="archiving" :disabled="!archiveReady">Usuń i zarchiwizuj konto</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.account-page {
  min-height: 100dvh;
  background:
    radial-gradient(circle at 82% 9%, rgb(0 0 0 / 2.5%), transparent 24rem),
    var(--ui-bg-muted);
}

.account-shell {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
  padding: 54px 0 130px;
}

.account-intro {
  display: grid;
  gap: 26px;
  margin-bottom: 42px;
}

.account-intro__back {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  color: var(--ui-text-muted);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: color var(--oe-motion-fast);
}

.account-intro__back:hover { color: var(--ui-text-highlighted); }
.account-intro__back svg { width: 16px; height: 16px; }
.account-intro h1,
.account-intro p { margin: 0; }
.account-intro h1 { margin-top: 3px; font-size: clamp(36px, 5vw, 54px); line-height: 1.05; }
.account-intro > div > p:last-child { max-width: 660px; margin-top: 12px; color: var(--ui-text-muted); font-size: 17px; }

.account-eyebrow {
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.18em;
}

.account-loading,
.method-skeletons { display: grid; gap: 18px; }
.account-load-error { max-width: 760px; }

.account-layout {
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  align-items: start;
  gap: clamp(30px, 5vw, 68px);
}

.account-nav {
  position: sticky;
  top: 24px;
  display: grid;
  gap: 24px;
}

.account-nav nav {
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  background: rgb(255 255 255 / 82%);
  box-shadow: 0 12px 36px rgb(0 0 0 / 3%);
  backdrop-filter: blur(12px);
}

.account-nav nav a {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 11px;
  border-radius: 10px;
  color: var(--ui-text-toned);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: color var(--oe-motion-fast), background var(--oe-motion-fast);
}

.account-nav nav a:hover { background: var(--ui-bg-elevated); color: var(--ui-text-highlighted); }
.account-nav nav svg { width: 16px; height: 16px; }

.account-nav__hint {
  display: flex;
  gap: 10px;
  padding: 4px 10px;
  color: var(--ui-text-muted);
}

.account-nav__hint > svg { flex: 0 0 auto; width: 16px; height: 16px; margin-top: 2px; }
.account-nav__hint p { display: grid; gap: 2px; margin: 0; font-size: 11px; line-height: 1.5; }
.account-nav__hint strong { color: var(--ui-text-toned); font-size: 12px; }

.account-content { display: grid; gap: 24px; min-width: 0; }

.settings-section {
  scroll-margin-top: 24px;
  padding: clamp(24px, 3.5vw, 36px);
  border: 1px solid var(--ui-border);
  border-radius: 22px;
  background: var(--ui-bg);
  box-shadow: 0 18px 54px rgb(0 0 0 / 3.5%);
}

.settings-section__header {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 15px;
  margin-bottom: 28px;
}

.settings-section__header--with-count { grid-template-columns: auto 1fr auto; }
.settings-section__header h2,
.settings-section__header p,
.settings-section__header span { margin: 0; }
.settings-section__header h2 { font-size: 25px; font-weight: 560; line-height: 1.2; }
.settings-section__header p { margin-bottom: 2px; color: var(--ui-text-muted); font-size: 10px; font-weight: 750; letter-spacing: 0.16em; text-transform: uppercase; }
.settings-section__header > div > span { display: block; margin-top: 5px; color: var(--ui-text-muted); font-size: 13px; }

.settings-section__icon {
  display: grid;
  width: 46px;
  height: 46px;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.settings-section__icon svg { width: 20px; height: 20px; }
.settings-section__icon--appointments {
  border-color: color-mix(in srgb, var(--ui-text-highlighted) 14%, var(--ui-border));
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
}
.settings-section__icon--danger { border-color: rgb(220 38 38 / 18%); background: rgb(254 242 242); color: var(--ui-error); }

.identity-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.identity-fields > div {
  padding: 16px 17px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-bg-muted);
}

.identity-fields dt { color: var(--ui-text-muted); font-size: 11px; font-weight: 650; }
.identity-fields dd { overflow: hidden; margin: 4px 0 0; color: var(--ui-text-highlighted); font-size: 15px; font-weight: 600; text-overflow: ellipsis; }

.profile-access-list { display: grid; gap: 10px; margin-top: 25px; }

.expert-booking-list { display: grid; gap: 14px; }

.expert-booking-card {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  background: var(--ui-bg);
}

.expert-booking-card__identity {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px;
  border-bottom: 1px solid var(--ui-border);
  background: linear-gradient(135deg, var(--ui-bg-muted), var(--ui-bg));
}

.expert-booking-card__avatar {
  display: grid;
  overflow: hidden;
  flex: 0 0 auto;
  width: 58px;
  height: 58px;
  place-items: center;
  border: 1px solid var(--ui-border-accented);
  border-radius: 18px;
  background: var(--ui-bg-inverted);
  color: var(--ui-text-inverted);
  font-size: 17px;
  font-weight: 750;
  letter-spacing: 0.04em;
}

.expert-booking-card__avatar img { width: 100%; height: 100%; object-fit: cover; }
.expert-booking-card__identity > div { min-width: 0; }
.expert-booking-card__identity h3 { margin: 8px 0 0; font-size: 20px; font-weight: 650; }
.expert-booking-card__identity p { margin: 3px 0 0; color: var(--ui-text-muted); font-size: 12px; }

.expert-booking-card__details {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 0;
  padding: 18px 20px;
}

.expert-booking-card__details > div { min-width: 0; padding: 2px 18px 2px 0; }
.expert-booking-card__details > div + div { padding: 2px 0 2px 20px; border-left: 1px solid var(--ui-border); }
.expert-booking-card__details span,
.expert-booking-card__details strong,
.expert-booking-card__details small { display: block; }
.expert-booking-card__details span { color: var(--ui-text-muted); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.expert-booking-card__details span svg { display: inline; width: 13px; height: 13px; margin: -2px 5px 0 0; vertical-align: middle; }
.expert-booking-card__details strong { margin-top: 8px; font-size: 13px; font-weight: 650; }
.expert-booking-card__details > div > small { margin-top: 4px; color: var(--ui-text-muted); font-size: 11px; line-height: 1.5; }
.expert-booking-card__details ul { display: grid; gap: 7px; margin: 8px 0 0; padding: 0; list-style: none; }
.expert-booking-card__details li { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: var(--ui-text-toned); font-size: 12px; }
.expert-booking-card__details li::before { width: 5px; height: 5px; margin-right: 1px; border-radius: 999px; background: var(--ui-text-highlighted); content: ''; }
.expert-booking-card__details li small { flex: 0 0 auto; margin-left: auto; color: var(--ui-text-muted); font-size: 10px; }

.expert-booking-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 15px 20px;
  border-top: 1px solid var(--ui-border);
  background: var(--ui-bg-muted);
}

.expert-booking-card__footer p { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--ui-text-muted); font-size: 10px; }
.expert-booking-card__footer p svg { flex: 0 0 auto; width: 14px; height: 14px; color: var(--ui-success); }
.expert-booking-card__footer a { flex: 0 0 auto; }
.subsection-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.subsection-heading h3 { margin: 0; font-size: 14px; font-weight: 650; }

.profile-access-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid var(--ui-border);
  border-radius: 13px;
}

.profile-access-row__mark {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 10px;
  background: var(--ui-bg-elevated);
}

.profile-access-row__mark svg { width: 17px; height: 17px; }
.profile-access-row strong { color: var(--ui-text-highlighted); font-size: 13px; }
.profile-access-row p { margin: 2px 0 0; color: var(--ui-text-muted); font-size: 11px; text-transform: capitalize; }

.login-methods { display: grid; gap: 10px; }

.login-method {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 14px;
  min-height: 92px;
  padding: 15px;
  border: 1px solid var(--ui-border);
  border-radius: 15px;
}

.login-method__icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 12px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-highlighted);
}

.login-method__icon svg { width: 19px; height: 19px; }
.login-method__icon img { width: 19px; height: 19px; }
.login-method__icon--social { background: #fff; border: 1px solid var(--ui-border); }
.login-method__copy { min-width: 0; }
.login-method__copy > div { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.login-method__copy h3 { margin: 0; font-size: 15px; font-weight: 650; }
.login-method__copy p { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 12px; line-height: 1.5; }
.login-method__fixed { display: inline-flex; align-items: center; gap: 5px; color: var(--ui-text-muted); font-size: 11px; font-weight: 600; }
.login-method__fixed svg { width: 14px; height: 14px; color: var(--ui-success); }

.section-footnote {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 16px 2px 0;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.section-footnote svg { flex: 0 0 auto; width: 14px; height: 14px; margin-top: 1px; }

.consent-list { display: grid; gap: 14px; }

.consent-card {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  background: var(--ui-bg);
}

.consent-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 18px 0;
}

.consent-card__title { display: flex; align-items: flex-start; gap: 11px; min-width: 0; }
.consent-card__title > span { display: grid; flex: 0 0 auto; width: 35px; height: 35px; place-items: center; border-radius: 10px; background: var(--ui-bg-muted); }
.consent-card__title svg { width: 17px; height: 17px; }
.consent-card__title h3 { margin: 0; font-size: 16px; font-weight: 650; }
.consent-card__title p { margin: 3px 0 0; color: var(--ui-text-muted); font-size: 11px; }
.consent-card__content { margin: 14px 18px 0 64px; color: var(--ui-text-toned); font-size: 12px; line-height: 1.65; }

.consent-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 18px;
  margin: 16px 18px 0 64px;
  padding: 12px;
  border-radius: 11px;
  background: var(--ui-bg-muted);
}

.consent-meta > div { min-width: 0; }
.consent-meta dt { color: var(--ui-text-muted); font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.consent-meta dd { overflow: hidden; margin: 2px 0 0; color: var(--ui-text); font-size: 11px; text-overflow: ellipsis; }

.consent-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 18px 17px 64px;
}

.consent-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--ui-text-muted); font-size: 10px; }

.consent-history { border-top: 1px solid var(--ui-border); background: var(--ui-bg-muted); }
.consent-history summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 18px; color: var(--ui-text-toned); cursor: pointer; font-size: 11px; font-weight: 650; list-style: none; }
.consent-history summary::-webkit-details-marker { display: none; }
.consent-history summary > span { display: flex; align-items: center; gap: 7px; }
.consent-history summary svg { width: 14px; height: 14px; }
.consent-history__chevron { transition: transform var(--oe-motion-fast); }
.consent-history[open] .consent-history__chevron { transform: rotate(180deg); }
.consent-history ol { display: grid; gap: 0; margin: 0; padding: 0 18px 14px; list-style: none; }
.consent-history li { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-top: 1px solid var(--ui-border); }
.consent-history li > span { display: grid; width: 24px; height: 24px; place-items: center; border-radius: 999px; background: var(--ui-bg); color: var(--ui-text-muted); }
.consent-history li > span.is-granted { color: var(--ui-success); }
.consent-history li > span.is-withdrawn { color: var(--ui-error); }
.consent-history li svg { width: 13px; height: 13px; }
.consent-history li strong { color: var(--ui-text-highlighted); font-size: 11px; }
.consent-history li p { margin: 1px 0 0; color: var(--ui-text-muted); font-size: 10px; }

.empty-consents { display: grid; justify-items: center; padding: 42px 18px; border: 1px dashed var(--ui-border-accented); border-radius: 16px; text-align: center; }
.empty-consents > span { display: grid; width: 48px; height: 48px; place-items: center; border-radius: 999px; background: var(--ui-bg-muted); }
.empty-consents svg { width: 21px; height: 21px; }
.empty-consents h3 { margin: 14px 0 3px; font-size: 16px; font-weight: 650; }
.empty-consents p { max-width: 420px; margin: 0; color: var(--ui-text-muted); font-size: 12px; }

.settings-section--danger { border-color: rgb(220 38 38 / 20%); }
.archive-explanation { display: flex; align-items: flex-end; justify-content: space-between; gap: 30px; padding: 20px; border: 1px solid rgb(220 38 38 / 18%); border-radius: 15px; background: rgb(254 242 242 / 65%); }
.archive-explanation h3 { margin: 0; font-size: 16px; font-weight: 650; }
.archive-explanation p { max-width: 620px; margin: 7px 0 0; color: var(--ui-text-toned); font-size: 12px; line-height: 1.6; }
.archive-explanation ul { display: grid; gap: 6px; margin: 15px 0 0; padding: 0; color: var(--ui-text-toned); font-size: 11px; list-style: none; }
.archive-explanation li { display: flex; align-items: flex-start; gap: 7px; }
.archive-explanation li svg { flex: 0 0 auto; width: 14px; height: 14px; margin-top: 1px; color: var(--ui-error); }
.archive-explanation > button { flex: 0 0 auto; }

.modal-form { display: grid; gap: 17px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 9px; padding-top: 3px; }

@media (max-width: 900px) {
  .account-shell { width: min(820px, calc(100% - 36px)); padding-top: 42px; }
  .account-layout { grid-template-columns: 1fr; gap: 20px; }
  .account-nav { position: static; }
  .account-nav nav { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .account-nav nav a { justify-content: center; }
  .account-nav__hint { display: none; }
}

@media (max-width: 640px) {
  .account-shell { width: calc(100% - 24px); padding: 30px 0 var(--portal-mobile-nav-clearance); }
  .account-intro { gap: 20px; margin-bottom: 28px; }
  .account-intro h1 { font-size: 36px; }
  .account-intro > div > p:last-child { font-size: 14px; }
  .account-nav { overflow-x: auto; margin: 0 -12px; padding: 0 12px 2px; scrollbar-width: none; }
  .account-nav::-webkit-scrollbar { display: none; }
  .account-nav nav { display: flex; width: max-content; padding: 6px; }
  .account-nav nav a { padding: 9px 10px; }
  .settings-section { padding: 20px 16px; border-radius: 18px; }
  .settings-section__header { align-items: start; gap: 11px; margin-bottom: 22px; }
  .settings-section__header h2 { font-size: 21px; }
  .settings-section__header > div > span { font-size: 11px; }
  .settings-section__icon { width: 40px; height: 40px; border-radius: 12px; }
  .identity-fields { grid-template-columns: 1fr; }
  .expert-booking-card__identity { align-items: flex-start; padding: 17px; }
  .expert-booking-card__details { grid-template-columns: 1fr; padding: 16px 17px; }
  .expert-booking-card__details > div { padding: 0; }
  .expert-booking-card__details > div + div { margin-top: 17px; padding: 17px 0 0; border-top: 1px solid var(--ui-border); border-left: 0; }
  .expert-booking-card__footer { align-items: stretch; flex-direction: column; padding: 15px 17px 17px; }
  .expert-booking-card__footer a { width: 100%; justify-content: center; }
  .profile-access-row { grid-template-columns: auto 1fr; }
  .profile-access-row > :last-child { grid-column: 2; justify-self: start; }
  .login-method { grid-template-columns: auto 1fr; align-items: start; }
  .login-method > button,
  .login-method__fixed { grid-column: 2; justify-self: start; }
  .consent-card__top { display: grid; }
  .consent-card__top > :last-child { justify-self: start; margin-left: 46px; }
  .consent-card__content,
  .consent-meta { margin-left: 18px; }
  .consent-meta { grid-template-columns: 1fr; }
  .consent-card__footer { align-items: flex-start; flex-direction: column; padding-left: 18px; }
  .archive-explanation { align-items: stretch; flex-direction: column; }
  .archive-explanation > button { width: 100%; justify-content: center; }
  .modal-actions { display: grid; grid-template-columns: 1fr; }
  .modal-actions > button { width: 100%; justify-content: center; }
  .modal-actions > button:first-child { order: 2; }
}
</style>
