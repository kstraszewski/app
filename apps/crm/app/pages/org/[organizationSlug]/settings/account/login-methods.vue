<script setup lang="ts">
import {
  maskOpenExpertPhone,
  normalizeOpenExpertPhone,
} from '@openexpert/auth'
import { passkeyDeviceName } from '~/utils/passkey-device-name'

type AuthProvider = 'google' | 'apple'

type AuthAccount = {
  id: string
  providerId: string
  accountId: string
  createdAt?: string | Date
}

type UserPasskey = {
  id: string
  name?: string
  createdAt: string | Date
  deviceType: string
  backedUp: boolean
  aaguid?: string
}

const authClient = useAuthClient()
const authUser = useAuthUser()
const runtimeConfig = useRuntimeConfig()
const route = useRoute()
const router = useRouter()
const toast = useToast()
const { errorMessage } = useAuthFlow()
const { orgPath } = useOrganizationContext()
const accounts = ref<AuthAccount[]>([])
const passkeys = ref<UserPasskey[]>([])
const loading = ref(true)
const loadError = ref('')
const passkeysLoading = ref(false)
const passkeyLoadError = ref('')
const linkingProvider = ref<AuthProvider | null>(null)
const unlinkingProvider = ref<AuthProvider | null>(null)
const pendingUnlinkProvider = ref<AuthProvider | null>(null)
const phoneModalOpen = ref(false)
const removePhoneModalOpen = ref(false)
const phoneStep = ref<'number' | 'code'>('number')
const phoneDraft = ref('')
const phoneTarget = ref('')
const phoneCode = ref<number[]>([])
const phoneAction = ref<'send' | 'verify' | 'remove' | null>(null)
const phoneError = ref('')
const demoCodeUsed = ref(false)
const passkeySupported = ref(false)
const addPasskeyModalOpen = ref(false)
const passkeyName = ref('')
const passkeyAction = ref<'add' | 'rename' | 'delete' | null>(null)
const pendingRenamePasskey = ref<UserPasskey | null>(null)
const pendingDeletePasskey = ref<UserPasskey | null>(null)
const renamePasskeyModalOpen = computed({
  get: () => pendingRenamePasskey.value !== null,
  set: (open: boolean) => {
    if (!open) pendingRenamePasskey.value = null
  },
})
const deletePasskeyModalOpen = computed({
  get: () => pendingDeletePasskey.value !== null,
  set: (open: boolean) => {
    if (!open) pendingDeletePasskey.value = null
  },
})
const unlinkModalOpen = computed({
  get: () => pendingUnlinkProvider.value !== null,
  set: (open: boolean) => {
    if (!open) pendingUnlinkProvider.value = null
  },
})
const social = computed(() => runtimeConfig.public.openexpert.social)
const hasPassword = computed(() => providerLinked('credential'))
const phoneEnabled = computed(() => runtimeConfig.public.openexpert.phone?.enabled === true)
const phoneLinked = computed(() => (
  authUser.value?.phoneNumberVerified === true
  && Boolean(authUser.value.phoneNumber)
))
const passkeyEnabled = computed(() => runtimeConfig.public.openexpert.passkey?.enabled === true)

useHead({ title: 'Metody logowania — Ustawienia konta — OpenExpert CRM' })

function providerLinked(provider: string): boolean {
  return accounts.value.some(account => account.providerId === provider)
}

function providerConfigured(provider: AuthProvider): boolean {
  return social.value?.[provider] === true
}

function providerLabel(provider: AuthProvider): string {
  return provider === 'google' ? 'Google' : 'Apple'
}

function providerStatus(provider: AuthProvider): { label: string, color: 'success' | 'warning' | 'neutral' } {
  if (providerLinked(provider)) return { label: 'Połączone', color: 'success' }
  if (providerConfigured(provider)) return { label: 'Dostępne', color: 'neutral' }
  return { label: 'Nieskonfigurowane', color: 'warning' }
}

function passkeyLabel(passkey: UserPasskey, index = 0): string {
  return passkey.name?.trim() || `Klucz dostępu ${index + 1}`
}

function passkeyDate(value: string | Date): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Data nieznana'
  return new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function openPhoneEditor() {
  if (!phoneEnabled.value) return
  phoneStep.value = 'number'
  phoneDraft.value = authUser.value?.phoneNumber || '+48 '
  phoneTarget.value = ''
  phoneCode.value = []
  phoneError.value = ''
  demoCodeUsed.value = false
  phoneModalOpen.value = true
}

function editPhoneNumber() {
  phoneStep.value = 'number'
  phoneCode.value = []
  phoneError.value = ''
  demoCodeUsed.value = false
}

async function requestPhoneVerification() {
  phoneError.value = ''
  if (!phoneEnabled.value || phoneAction.value) return
  const normalized = normalizeOpenExpertPhone(phoneDraft.value)
  if (!normalized) {
    phoneError.value = 'Podaj poprawny numer telefonu z kodem kraju.'
    return
  }

  phoneAction.value = 'send'
  try {
    const result = await $fetch<{ status: boolean, phoneNumber: string, devOtp?: string }>(
      '/api/me/phone/request',
      { method: 'POST', body: { phoneNumber: normalized } },
    )
    phoneDraft.value = normalized
    phoneTarget.value = result.phoneNumber
    phoneCode.value = result.devOtp ? [...result.devOtp].map(Number) : []
    demoCodeUsed.value = Boolean(result.devOtp)
    phoneStep.value = 'code'
  }
  catch (error) {
    phoneError.value = errorMessage(error as {
      message?: string
      code?: string
      status?: number
      statusCode?: number
      data?: { message?: string, code?: string }
    })
  }
  finally {
    phoneAction.value = null
  }
}

async function verifyPhone() {
  phoneError.value = ''
  if (phoneAction.value) return
  const wasLinked = phoneLinked.value
  const code = phoneCode.value.join('')
  if (!/^\d{6}$/.test(code)) {
    phoneError.value = 'Wpisz pełny sześciocyfrowy kod.'
    return
  }

  phoneAction.value = 'verify'
  try {
    await $fetch('/api/me/phone/verify', {
      method: 'POST',
      body: { phoneNumber: phoneTarget.value, code },
    })
    await refreshAuthUser()
    phoneModalOpen.value = false
    toast.add({
      title: wasLinked ? 'Numer telefonu zmieniony' : 'Numer telefonu dodany',
      description: `${maskOpenExpertPhone(phoneTarget.value)} może służyć do logowania i odzyskiwania hasła.`,
      color: 'success',
      icon: 'i-lucide-badge-check',
    })
  }
  catch (error) {
    phoneError.value = errorMessage(error as {
      message?: string
      code?: string
      status?: number
      statusCode?: number
      data?: { message?: string, code?: string }
    })
  }
  finally {
    phoneAction.value = null
  }
}

async function removePhone() {
  if (phoneAction.value) return
  phoneAction.value = 'remove'
  try {
    await $fetch('/api/me/phone', { method: 'DELETE' })
    await refreshAuthUser()
    removePhoneModalOpen.value = false
    toast.add({
      title: 'Numer telefonu usunięty',
      description: 'Logowanie i odzyskiwanie hasła przez SMS zostały wyłączone.',
      color: 'success',
      icon: 'i-lucide-smartphone-off',
    })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się usunąć numeru',
      description: errorMessage(error as {
        message?: string
        code?: string
        status?: number
        statusCode?: number
        data?: { message?: string, code?: string }
      }),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    phoneAction.value = null
  }
}

function openPasskeyRegistration() {
  if (!passkeyEnabled.value || !passkeySupported.value) return
  passkeyName.value = ''
  addPasskeyModalOpen.value = true
  void prefillPasskeyName()
}

async function prefillPasskeyName() {
  const suggestedName = await passkeyDeviceName(navigator)
  if (addPasskeyModalOpen.value && !passkeyName.value.trim()) {
    passkeyName.value = suggestedName
  }
}

function askToRenamePasskey(passkey: UserPasskey, index: number) {
  passkeyName.value = passkeyLabel(passkey, index)
  pendingRenamePasskey.value = passkey
}

function askToDeletePasskey(passkey: UserPasskey) {
  pendingDeletePasskey.value = passkey
}

async function refreshPasskeys() {
  const result = await authClient.passkey.listUserPasskeys()
  if (result.error) throw result.error
  passkeys.value = (result.data ?? []) as UserPasskey[]
}

async function loadPasskeys() {
  if (!passkeyEnabled.value) {
    passkeys.value = []
    passkeyLoadError.value = ''
    return
  }
  passkeysLoading.value = true
  passkeyLoadError.value = ''
  try {
    await refreshPasskeys()
  }
  catch (error) {
    passkeyLoadError.value = errorMessage(error as { message?: string, code?: string })
  }
  finally {
    passkeysLoading.value = false
  }
}

async function addPasskey() {
  if (passkeyAction.value || !passkeySupported.value) return
  const name = passkeyName.value.trim()
  if (name.length > 80) {
    toast.add({ title: 'Nazwa może mieć maksymalnie 80 znaków.', color: 'error' })
    return
  }

  passkeyAction.value = 'add'
  try {
    const result = await authClient.passkey.addPasskey({
      ...(name ? { name } : {}),
    })
    if (result.error) throw result.error
    await refreshPasskeys()
    addPasskeyModalOpen.value = false
    toast.add({
      title: 'Klucz dostępu dodany',
      description: 'Od teraz możesz logować się biometrią, PIN-em urządzenia lub kluczem sprzętowym.',
      color: 'success',
      icon: 'i-lucide-fingerprint',
    })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się dodać klucza dostępu',
      description: errorMessage(error as { message?: string, code?: string }),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    passkeyAction.value = null
  }
}

async function renamePasskey() {
  const passkey = pendingRenamePasskey.value
  const name = passkeyName.value.trim()
  if (!passkey || passkeyAction.value) return
  if (!name || name.length > 80) {
    toast.add({ title: 'Podaj nazwę od 1 do 80 znaków.', color: 'error' })
    return
  }

  passkeyAction.value = 'rename'
  try {
    const result = await authClient.passkey.updatePasskey({ id: passkey.id, name })
    if (result.error) throw result.error
    await refreshPasskeys()
    pendingRenamePasskey.value = null
    toast.add({ title: 'Nazwa klucza została zmieniona', color: 'success' })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się zmienić nazwy',
      description: errorMessage(error as { message?: string, code?: string }),
      color: 'error',
    })
  }
  finally {
    passkeyAction.value = null
  }
}

async function deletePasskey() {
  const passkey = pendingDeletePasskey.value
  if (!passkey || passkeyAction.value) return
  passkeyAction.value = 'delete'
  try {
    const result = await authClient.passkey.deletePasskey({ id: passkey.id })
    if (result.error) throw result.error
    passkeys.value = passkeys.value.filter(item => item.id !== passkey.id)
    pendingDeletePasskey.value = null
    toast.add({
      title: 'Klucz dostępu usunięty',
      description: 'Ten klucz nie może już służyć do logowania.',
      color: 'success',
      icon: 'i-lucide-key-round',
    })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się usunąć klucza',
      description: errorMessage(error as { message?: string, code?: string }),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    passkeyAction.value = null
  }
}

async function loadAccounts() {
  loading.value = true
  loadError.value = ''
  const passkeysRequest = loadPasskeys()
  try {
    const accountResult = await authClient.listAccounts()
    if (accountResult.error) throw accountResult.error
    accounts.value = (accountResult.data ?? []) as AuthAccount[]

    const linked = String(route.query.linked || '')
    if ((linked === 'google' || linked === 'apple') && providerLinked(linked)) {
      toast.add({
        title: `Konto ${providerLabel(linked)} połączone`,
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
    }
  }
  catch (error) {
    loadError.value = errorMessage(error as { message?: string, code?: string })
  }
  finally {
    await passkeysRequest
    loading.value = false
  }
}

async function linkProvider(provider: AuthProvider) {
  if (!providerConfigured(provider) || providerLinked(provider) || linkingProvider.value) return
  linkingProvider.value = provider
  try {
    const callbackUrl = new URL(route.path, window.location.origin)
    callbackUrl.searchParams.set('linked', provider)
    const errorCallbackUrl = new URL(route.path, window.location.origin)
    errorCallbackUrl.searchParams.set('linkError', `Połączenie z ${providerLabel(provider)} zostało anulowane.`)
    const result = await authClient.linkSocial({
      provider,
      callbackURL: callbackUrl.toString(),
      errorCallbackURL: errorCallbackUrl.toString(),
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
  if (!providerLinked(provider)) return
  pendingUnlinkProvider.value = provider
}

async function unlinkProvider() {
  const provider = pendingUnlinkProvider.value
  if (!provider || unlinkingProvider.value) return
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
      description: accounts.value.length <= 1
        ? 'Najpierw dodaj inną metodę logowania, aby nie utracić dostępu.'
        : errorMessage(error as { message?: string, code?: string }),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    unlinkingProvider.value = null
  }
}

onMounted(() => {
  passkeySupported.value = window.isSecureContext && 'PublicKeyCredential' in window
  void loadAccounts()
})
</script>

<template>
  <div class="login-methods-page">
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      icon="i-lucide-key-round"
      title="Nie udało się pobrać metod logowania"
      :description="loadError"
    >
      <template #actions>
        <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="loadAccounts">
          Ponów
        </UButton>
      </template>
    </UAlert>

    <section class="identity-summary">
      <span><UIcon name="i-lucide-shield-check" /></span>
      <div>
        <p>Tożsamość OpenExpert</p>
        <h2>{{ authUser?.email }}</h2>
        <small>Połączone metody prowadzą do tego samego konta i tych samych organizacji.</small>
      </div>
      <UBadge
        :color="authUser?.emailVerified ? 'success' : 'warning'"
        variant="solid"
        size="lg"
        :icon="authUser?.emailVerified ? 'i-lucide-badge-check' : 'i-lucide-circle-alert'"
        class="identity-summary__status"
      >
        {{ authUser?.emailVerified ? 'E-mail potwierdzony' : 'E-mail niepotwierdzony' }}
      </UBadge>
    </section>

    <div class="login-method-grid">
      <article class="login-method-card">
        <span class="login-method-card__icon"><UIcon name="i-lucide-mail" /></span>
        <div class="login-method-card__copy">
          <div>
            <h2>E-mail i link jednorazowy</h2>
            <UBadge color="success" variant="subtle">Aktywne</UBadge>
          </div>
          <p>Otrzymujesz bezpieczny link logowania na {{ authUser?.email }}. Nie wymaga hasła.</p>
        </div>
        <span class="login-method-card__fixed"><UIcon name="i-lucide-check" />Zawsze dostępne</span>
      </article>

      <article class="login-method-card">
        <span class="login-method-card__icon"><UIcon name="i-lucide-lock-keyhole" /></span>
        <div class="login-method-card__copy">
          <div>
            <h2>Hasło</h2>
            <UBadge :color="hasPassword ? 'success' : 'neutral'" variant="subtle">
              {{ hasPassword ? 'Aktywne' : 'Nieustawione' }}
            </UBadge>
          </div>
          <p>{{ hasPassword ? 'Możesz logować się adresem e-mail i hasłem.' : 'Ustaw hasło, jeśli chcesz korzystać z klasycznego logowania.' }}</p>
        </div>
        <UButton
          :to="orgPath('/settings/account/security')"
          color="neutral"
          variant="outline"
          :icon="hasPassword ? 'i-lucide-settings-2' : 'i-lucide-plus'"
        >
          {{ hasPassword ? 'Zarządzaj' : 'Ustaw hasło' }}
        </UButton>
      </article>

      <article v-for="provider in (['google', 'apple'] as const)" :key="provider" class="login-method-card">
        <span class="login-method-card__icon">
          <UIcon :name="provider === 'google' ? 'i-lucide-circle-user-round' : 'i-lucide-scan-face'" />
        </span>
        <div class="login-method-card__copy">
          <div>
            <h2>{{ providerLabel(provider) }}</h2>
            <UBadge :color="providerStatus(provider).color" variant="subtle">
              {{ providerStatus(provider).label }}
            </UBadge>
          </div>
          <p v-if="providerLinked(provider)">Możesz używać konta {{ providerLabel(provider) }} do logowania w OpenExpert.</p>
          <p v-else-if="providerConfigured(provider)">Połącz konto z tym samym adresem e-mail, aby dodać szybsze logowanie.</p>
          <p v-else>Provider nie został jeszcze skonfigurowany w tym środowisku.</p>
        </div>
        <UButton
          v-if="providerLinked(provider)"
          color="error"
          variant="ghost"
          icon="i-lucide-unlink"
          :disabled="accounts.length <= 1"
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

      <article class="login-method-card">
        <span class="login-method-card__icon"><UIcon name="i-lucide-smartphone" /></span>
        <div class="login-method-card__copy">
          <div>
            <h2>Numer telefonu</h2>
            <UBadge :color="phoneLinked ? 'success' : (phoneEnabled ? 'neutral' : 'warning')" variant="subtle">
              {{ phoneLinked ? 'Zweryfikowany' : (phoneEnabled ? 'Dostępne' : 'Nieskonfigurowane') }}
            </UBadge>
          </div>
          <p v-if="phoneLinked">
            {{ maskOpenExpertPhone(authUser?.phoneNumber || '') }} służy do logowania kodem SMS i odzyskiwania hasła.
          </p>
          <p v-else-if="phoneEnabled">Dodaj numer i potwierdź go kodem SMS, aby zyskać dodatkową metodę logowania.</p>
          <p v-else>Provider SMS nie został jeszcze skonfigurowany w tym środowisku.</p>
        </div>
        <div v-if="phoneLinked" class="login-method-card__actions">
          <UButton color="neutral" variant="outline" icon="i-lucide-pencil" @click="openPhoneEditor">
            Zmień
          </UButton>
          <UButton color="error" variant="ghost" icon="i-lucide-trash-2" @click="removePhoneModalOpen = true">
            Usuń
          </UButton>
        </div>
        <UButton
          v-else
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          :disabled="!phoneEnabled"
          @click="openPhoneEditor"
        >
          Dodaj numer
        </UButton>
      </article>

      <article class="login-method-card login-method-card--passkeys">
        <span class="login-method-card__icon"><UIcon name="i-lucide-fingerprint" /></span>
        <div class="login-method-card__copy">
          <div>
            <h2>Klucze dostępu (passkeys)</h2>
            <UBadge :color="passkeyLoadError ? 'error' : (passkeys.length ? 'success' : (passkeyEnabled ? 'neutral' : 'warning'))" variant="subtle">
              {{ passkeyLoadError ? 'Błąd' : (passkeys.length ? `${passkeys.length} ${passkeys.length === 1 ? 'klucz' : 'klucze'}` : (passkeyEnabled ? 'Dostępne' : 'Nieskonfigurowane')) }}
            </UBadge>
          </div>
          <p v-if="passkeyLoadError">Nie udało się pobrać kluczy dostępu. Pozostałe metody logowania działają normalnie.</p>
          <p v-else-if="passkeySupported">Loguj się odciskiem palca, Face ID, PIN-em urządzenia albo fizycznym kluczem bezpieczeństwa.</p>
          <p v-else-if="passkeyEnabled">Bieżąca przeglądarka lub połączenie nie obsługuje WebAuthn. Zarządzać istniejącymi kluczami nadal możesz poniżej.</p>
          <p v-else>Klucze dostępu nie są włączone w tym środowisku.</p>
        </div>
        <UButton
          v-if="passkeyLoadError"
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="passkeysLoading"
          @click="loadPasskeys"
        >
          Ponów
        </UButton>
        <UButton
          v-else
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          :loading="passkeysLoading"
          :disabled="!passkeyEnabled || !passkeySupported"
          @click="openPasskeyRegistration"
        >
          Dodaj klucz
        </UButton>

        <div v-if="passkeys.length" class="passkey-list">
          <div v-for="(passkey, index) in passkeys" :key="passkey.id" class="passkey-row">
            <span class="passkey-row__icon"><UIcon name="i-lucide-key-round" /></span>
            <div class="passkey-row__copy">
              <strong>{{ passkeyLabel(passkey, index) }}</strong>
              <small>
                Dodano {{ passkeyDate(passkey.createdAt) }} ·
                {{ passkey.backedUp ? 'synchronizowany' : (passkey.deviceType === 'singleDevice' ? 'tylko to urządzenie' : 'wiele urządzeń') }}
              </small>
            </div>
            <div class="passkey-row__actions">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-pencil"
                aria-label="Zmień nazwę klucza"
                @click="askToRenamePasskey(passkey, index)"
              />
              <UButton
                color="error"
                variant="ghost"
                size="xs"
                icon="i-lucide-trash-2"
                aria-label="Usuń klucz dostępu"
                @click="askToDeletePasskey(passkey)"
              />
            </div>
          </div>
        </div>
      </article>
    </div>

    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-info"
      title="Łączenie kont jest celowo restrykcyjne"
      description="Google i Apple muszą należeć do właściciela konta, numer telefonu trzeba potwierdzić kodem, a nowy passkey wymaga świeżej sesji i zgody urządzenia."
    />

    <UModal
      v-model:open="addPasskeyModalOpen"
      title="Dodaj klucz dostępu"
      description="Przeglądarka poprosi o biometrię, PIN urządzenia albo użycie klucza bezpieczeństwa."
      :dismissible="passkeyAction !== 'add'"
    >
      <template #body>
        <form class="phone-method-form" @submit.prevent="addPasskey">
          <UFormField label="Nazwa klucza" description="Opcjonalna nazwa pomoże rozpoznać urządzenie później.">
            <UInput
              v-model="passkeyName"
              maxlength="80"
              autocomplete="off"
              placeholder="Np. MacBook służbowy"
              icon="i-lucide-tag"
              size="lg"
              class="w-full"
              autofocus
            />
          </UFormField>
          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-shield-check"
            title="Klucz prywatny zostaje na urządzeniu"
            description="OpenExpert zapisze wyłącznie klucz publiczny potrzebny do weryfikacji logowania."
          />
          <UButton type="submit" block size="lg" icon="i-lucide-fingerprint" :loading="passkeyAction === 'add'">
            Uruchom konfigurację klucza
          </UButton>
        </form>
      </template>
    </UModal>

    <UModal
      v-model:open="renamePasskeyModalOpen"
      title="Zmień nazwę klucza"
      description="Nazwa jest widoczna tylko w ustawieniach Twojego konta."
      :dismissible="passkeyAction !== 'rename'"
    >
      <template #body>
        <form class="phone-method-form" @submit.prevent="renamePasskey">
          <UFormField label="Nazwa" required>
            <UInput v-model="passkeyName" maxlength="80" required icon="i-lucide-tag" size="lg" class="w-full" autofocus />
          </UFormField>
          <UButton type="submit" block size="lg" icon="i-lucide-save" :loading="passkeyAction === 'rename'">
            Zapisz nazwę
          </UButton>
        </form>
      </template>
    </UModal>

    <UModal
      v-model:open="deletePasskeyModalOpen"
      title="Usunąć klucz dostępu?"
      :description="pendingDeletePasskey ? `${pendingDeletePasskey.name || 'Ten klucz'} przestanie działać przy logowaniu.` : 'Ten klucz przestanie działać przy logowaniu.'"
      :dismissible="passkeyAction !== 'delete'"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Tej operacji nie można cofnąć"
          description="W razie potrzeby możesz później zarejestrować nowe urządzenie jako kolejny klucz."
        />
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="passkeyAction === 'delete'" @click="close">
          Anuluj
        </UButton>
        <UButton color="error" icon="i-lucide-trash-2" :loading="passkeyAction === 'delete'" @click="deletePasskey">
          Usuń klucz
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="phoneModalOpen"
      :title="phoneLinked ? 'Zmień numer telefonu' : 'Dodaj numer telefonu'"
      description="Numer będzie prywatną metodą logowania. Nie zastąpi telefonu widocznego na publicznej wizytówce."
      :dismissible="!phoneAction"
    >
      <template #body>
        <form v-if="phoneStep === 'number'" class="phone-method-form" @submit.prevent="requestPhoneVerification">
          <UFormField label="Numer telefonu" description="Podaj numer z kodem kraju, np. +48." required>
            <UInput
              v-model="phoneDraft"
              type="tel"
              inputmode="tel"
              autocomplete="tel"
              required
              placeholder="+48 501 234 567"
              icon="i-lucide-smartphone"
              size="lg"
              class="w-full"
              autofocus
            />
          </UFormField>

          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-shield-check"
            description="Na ten numer wyślemy sześciocyfrowy kod. Kod jest ważny przez kilka minut i ma ograniczoną liczbę prób."
          />

          <UAlert
            v-if="phoneError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :description="phoneError"
          />

          <UButton type="submit" block size="lg" icon="i-lucide-message-square-text" :loading="phoneAction === 'send'">
            Wyślij kod SMS
          </UButton>
        </form>

        <form v-else class="phone-method-form" @submit.prevent="verifyPhone">
          <div class="phone-method-intro">
            <span><UIcon name="i-lucide-message-square-check" /></span>
            <div>
              <strong>Potwierdź numer</strong>
              <small>Wpisz kod wysłany na {{ maskOpenExpertPhone(phoneTarget) }}.</small>
            </div>
          </div>

          <UFormField label="Kod jednorazowy" required>
            <UPinInput
              v-model="phoneCode"
              type="number"
              otp
              :length="6"
              :separator="3"
              size="xl"
              class="justify-center"
            />
          </UFormField>

          <UAlert
            v-if="demoCodeUsed"
            color="warning"
            variant="subtle"
            icon="i-lucide-flask-conical"
            title="Tryb lokalny"
            description="SMS nie został wysłany; kod testowy uzupełniliśmy automatycznie."
          />

          <UAlert
            v-if="phoneError"
            role="alert"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :description="phoneError"
          />

          <UButton type="submit" block size="lg" icon="i-lucide-badge-check" :loading="phoneAction === 'verify'">
            Potwierdź numer
          </UButton>

          <div class="phone-method-actions">
            <UButton type="button" color="neutral" variant="ghost" @click="editPhoneNumber">
              Zmień numer
            </UButton>
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              :loading="phoneAction === 'send'"
              @click="requestPhoneVerification"
            >
              Wyślij ponownie
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      v-model:open="removePhoneModalOpen"
      title="Usunąć numer telefonu?"
      description="Nie będzie już można logować się ani odzyskać hasła za pomocą SMS-a."
      :dismissible="phoneAction !== 'remove'"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Pozostaw inną metodę logowania"
          description="Po usunięciu nadal możesz użyć hasła, linku wysłanego e-mailem albo połączonego konta społecznościowego."
        />
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="phoneAction === 'remove'" @click="close">
          Anuluj
        </UButton>
        <UButton color="error" icon="i-lucide-trash-2" :loading="phoneAction === 'remove'" @click="removePhone">
          Usuń numer
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="unlinkModalOpen"
      :title="pendingUnlinkProvider ? `Odłączyć konto ${providerLabel(pendingUnlinkProvider)}?` : 'Odłączyć konto?'"
      description="Nie usunie to danych OpenExpert ani konta u providera. Zniknie tylko ta metoda logowania."
      :dismissible="!unlinkingProvider"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Sprawdź pozostałe metody"
          description="Przed odłączeniem upewnij się, że pamiętasz hasło albo masz dostęp do e-maila z linkiem jednorazowym."
        />
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" :disabled="Boolean(unlinkingProvider)" @click="close">
          Anuluj
        </UButton>
        <UButton color="error" icon="i-lucide-unlink" :loading="Boolean(unlinkingProvider)" @click="unlinkProvider">
          Odłącz metodę
        </UButton>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.login-methods-page {
  display: grid;
  gap: 18px;
}

.identity-summary,
.login-method-card {
  border: 1px solid var(--ui-border);
  border-radius: calc(var(--ui-radius) * 1.25);
  background: var(--ui-bg);
}

.identity-summary {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 18px 20px;
}

.identity-summary > span,
.login-method-card__icon {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: var(--ui-radius);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-toned);
}

.identity-summary p {
  margin: 0 0 2px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.identity-summary h2 {
  overflow: hidden;
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 650;
  text-overflow: ellipsis;
}

.identity-summary small {
  display: block;
  margin-top: 4px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.identity-summary__status {
  justify-self: end;
  white-space: nowrap;
}

.login-method-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.login-method-card {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  min-width: 0;
  padding: 18px;
}

.login-method-card__copy {
  min-width: 0;
}

.login-method-card__copy > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.login-method-card h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.login-method-card p {
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.55;
}

.login-method-card__fixed {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-muted);
  font-size: 10px;
  white-space: nowrap;
}

.login-method-card__actions,
.phone-method-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.login-method-card--passkeys {
  align-items: start;
}

.passkey-list {
  display: grid;
  grid-column: 2 / -1;
  gap: 8px;
  min-width: 0;
}

.passkey-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.passkey-row__icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 50%;
  background: var(--ui-bg);
  color: var(--ui-text-toned);
}

.passkey-row__copy {
  min-width: 0;
}

.passkey-row__copy strong,
.passkey-row__copy small {
  display: block;
}

.passkey-row__copy strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.passkey-row__copy small {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 10px;
}

.passkey-row__actions {
  display: flex;
  gap: 2px;
}

.phone-method-form {
  display: grid;
  gap: 16px;
}

.phone-method-intro {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.phone-method-intro > span {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: var(--ui-bg);
  color: var(--ui-text-toned);
}

.phone-method-intro strong,
.phone-method-intro small {
  display: block;
}

.phone-method-intro strong {
  color: var(--ui-text-highlighted);
  font-size: 13px;
}

.phone-method-intro small {
  margin-top: 3px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

@media (max-width: 1000px) {
  .login-method-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .identity-summary,
  .login-method-card {
    grid-template-columns: 42px minmax(0, 1fr);
  }

  .identity-summary > :last-child,
  .login-method-card > :last-child {
    grid-column: 2;
    justify-self: start;
  }

  .login-method-card__actions {
    justify-content: flex-start;
  }

  .login-method-card--passkeys > :nth-child(3),
  .passkey-list {
    grid-column: 2;
    width: 100%;
  }

  .passkey-row {
    grid-template-columns: 30px minmax(0, 1fr) auto;
    padding: 9px;
  }
}
</style>
