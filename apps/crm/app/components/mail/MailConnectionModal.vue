<script setup lang="ts">
import type {
  FormError,
  FormErrorEvent,
  FormSubmitEvent,
} from '@nuxt/ui'
import type {
  ImapSmtpConnectionInput,
  MailConnectionInfo,
  MailProviderId,
  MailProviderOption,
  MailTransportSecurity,
} from '#shared/types/mail'
import { apiErrorMessage } from '~/utils/api-error'

type PresetId = 'icloud' | 'yahoo' | 'fastmail' | 'zoho' | 'ovh' | 'home' | 'onet' | 'wp' | 'custom'

interface MailPreset {
  value: PresetId
  label: string
  description: string
  imapHost: string
  imapPort: 993 | 143
  imapSecurity: MailTransportSecurity
  smtpHost: string
  smtpPort: 465 | 587
  smtpSecurity: MailTransportSecurity
}

interface ImapConnectionForm extends ImapSmtpConnectionInput {
  preset: PresetId
}

const props = withDefaults(defineProps<{
  open: boolean
  providers: MailProviderOption[]
  connectionsPath: string
  initialProvider?: MailProviderId | null
  reconnectConnection?: MailConnectionInfo | null
}>(), {
  initialProvider: null,
  reconnectConnection: null,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  connected: [connection: MailConnectionInfo]
}>()

const toast = useToast()
const selectedProviderId = ref<MailProviderId | null>(null)
const sameSmtpCredentials = ref(true)
const submitMode = ref<'test' | 'save'>('test')
const testing = ref(false)
const saving = ref(false)
const requestError = ref('')
const testFingerprint = ref('')
const testSucceeded = ref(false)

const presets: MailPreset[] = [
  {
    value: 'icloud',
    label: 'iCloud Mail',
    description: 'Wymaga hasła aplikacji Apple.',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
  },
  {
    value: 'yahoo',
    label: 'Yahoo Mail',
    description: 'Użyj hasła aplikacji wygenerowanego w Yahoo.',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecurity: 'tls',
  },
  {
    value: 'fastmail',
    label: 'Fastmail',
    description: 'Użyj osobnego hasła aplikacji Fastmail.',
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.fastmail.com',
    smtpPort: 465,
    smtpSecurity: 'tls',
  },
  {
    value: 'zoho',
    label: 'Zoho Mail (EU)',
    description: 'Europejskie serwery Zoho Mail.',
    imapHost: 'imap.zoho.eu',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.zoho.eu',
    smtpPort: 465,
    smtpSecurity: 'tls',
  },
  {
    value: 'ovh',
    label: 'OVHcloud',
    description: 'Standardowa konfiguracja skrzynek OVHcloud.',
    imapHost: 'ssl0.ovh.net',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'ssl0.ovh.net',
    smtpPort: 465,
    smtpSecurity: 'tls',
  },
  {
    value: 'home',
    label: 'home.pl',
    description: 'Wpisz dokładną nazwę serwera poczty widoczną w panelu home.pl.',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: '',
    smtpPort: 465,
    smtpSecurity: 'tls',
  },
  {
    value: 'onet',
    label: 'Poczta Onet',
    description: 'Szyfrowane IMAP i SMTP Poczty Onet.',
    imapHost: 'imap.poczta.onet.pl',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.poczta.onet.pl',
    smtpPort: 465,
    smtpSecurity: 'tls',
  },
  {
    value: 'wp',
    label: 'Poczta WP',
    description: 'Szyfrowane IMAP i SMTP Poczty WP.',
    imapHost: 'imap.wp.pl',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.wp.pl',
    smtpPort: 465,
    smtpSecurity: 'tls',
  },
  {
    value: 'custom',
    label: 'Własna konfiguracja',
    description: 'Domena firmowa lub inny dostawca poczty.',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: '',
    smtpPort: 465,
    smtpSecurity: 'tls',
  },
]

const presetItems = presets.map(preset => ({
  label: preset.label,
  description: preset.description,
  value: preset.value,
}))
const imapPortItems = [
  { label: '993 — TLS', value: 993 },
  { label: '143 — STARTTLS', value: 143 },
]
const smtpPortItems = [
  { label: '465 — TLS', value: 465 },
  { label: '587 — STARTTLS', value: 587 },
]
const securityItems = [
  { label: 'TLS', value: 'tls' },
  { label: 'STARTTLS', value: 'starttls' },
]

const form = reactive<ImapConnectionForm>(emptyImapForm())

const openModel = computed({
  get: () => props.open,
  set: (value) => {
    if ((testing.value || saving.value) && !value) return
    emit('update:open', value)
  },
})
const selectedProvider = computed(() => (
  props.providers.find(provider => provider.id === selectedProviderId.value) ?? null
))
const reconnecting = computed(() => Boolean(props.reconnectConnection))
const busy = computed(() => testing.value || saving.value)
const imapConfigured = computed(() => (
  props.providers.find(provider => provider.id === 'imap')?.configured ?? false
))

watch(() => props.open, (open) => {
  if (open) resetModal()
})

watch(() => form.preset, (presetId) => {
  applyPreset(presetId)
})

watch(() => form.imapPort, (port) => {
  form.imapSecurity = port === 143 ? 'starttls' : 'tls'
})

watch(() => form.smtpPort, (port) => {
  form.smtpSecurity = port === 587 ? 'starttls' : 'tls'
})

watch(() => form.accountEmail, (email, previousEmail) => {
  const normalized = email.trim().toLowerCase()
  if (!form.imapUsername || form.imapUsername === previousEmail) {
    form.imapUsername = normalized
  }
  if (!form.smtpUsername || form.smtpUsername === previousEmail) {
    form.smtpUsername = normalized
  }
})

watch([
  () => ({ ...form }),
  sameSmtpCredentials,
], () => {
  testSucceeded.value = false
  testFingerprint.value = ''
  requestError.value = ''
}, { deep: true })

function emptyImapForm(): ImapConnectionForm {
  return {
    preset: 'custom',
    displayName: '',
    accountEmail: '',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'tls',
    imapUsername: '',
    imapPassword: '',
    smtpHost: '',
    smtpPort: 465,
    smtpSecurity: 'tls',
    smtpUsername: '',
    smtpPassword: '',
  }
}

function resetModal(): void {
  selectedProviderId.value = props.reconnectConnection?.provider
    ?? props.initialProvider
    ?? null
  Object.assign(form, emptyImapForm())
  if (props.reconnectConnection?.provider === 'imap') {
    form.displayName = props.reconnectConnection.displayName === props.reconnectConnection.accountEmail
      ? ''
      : props.reconnectConnection.displayName
    form.accountEmail = props.reconnectConnection.accountEmail
    form.imapUsername = props.reconnectConnection.accountEmail
    form.smtpUsername = props.reconnectConnection.accountEmail
  }
  sameSmtpCredentials.value = true
  submitMode.value = 'test'
  testing.value = false
  saving.value = false
  requestError.value = ''
  testFingerprint.value = ''
  testSucceeded.value = false
}

function selectProvider(provider: MailProviderOption): void {
  if (busy.value) return
  selectedProviderId.value = provider.id
  requestError.value = ''
}

function backToProviders(): void {
  if (busy.value) return
  selectedProviderId.value = null
  requestError.value = ''
}

function closeModal(): void {
  if (!busy.value) emit('update:open', false)
}

function applyPreset(presetId: PresetId): void {
  const preset = presets.find(item => item.value === presetId)
  if (!preset) return
  form.imapHost = preset.imapHost
  form.imapPort = preset.imapPort
  form.imapSecurity = preset.imapSecurity
  form.smtpHost = preset.smtpHost
  form.smtpPort = preset.smtpPort
  form.smtpSecurity = preset.smtpSecurity
  const email = form.accountEmail.trim().toLowerCase()
  if (email) {
    form.imapUsername = email
    form.smtpUsername = email
  }
}

function providerConnectPath(provider: MailProviderOption): string | null {
  if (!provider.connectPath || !import.meta.client) return provider.connectPath
  try {
    const url = new URL(provider.connectPath, window.location.origin)
    if (url.origin !== window.location.origin) return null
    if (
      props.reconnectConnection
      && props.reconnectConnection.provider === provider.id
    ) {
      url.searchParams.set('connectionId', props.reconnectConnection.id)
    }
    return `${url.pathname}${url.search}`
  }
  catch {
    return null
  }
}

function startOAuth(provider: MailProviderOption): void {
  const path = providerConnectPath(provider)
  if (!path || !import.meta.client) return
  window.location.assign(path)
}

function validateImapConnection(state: Partial<ImapConnectionForm>): FormError[] {
  const errors: FormError[] = []
  const email = state.accountEmail?.trim().toLowerCase() || ''
  if (!email || email.length > 254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(email)) {
    errors.push({ name: 'accountEmail', message: 'Podaj prawidłowy adres skrzynki.' })
  }
  if ((state.displayName?.trim().length || 0) > 120) {
    errors.push({ name: 'displayName', message: 'Nazwa może mieć maksymalnie 120 znaków.' })
  }
  validateHost(errors, 'imapHost', state.imapHost || '', 'IMAP')
  validateTransport(errors, 'imapPort', state.imapPort, state.imapSecurity, 'IMAP')
  validateCredential(errors, 'imapUsername', state.imapUsername || '', 'Podaj login IMAP.')
  validateCredential(errors, 'imapPassword', state.imapPassword || '', 'Podaj hasło aplikacji do IMAP.', 1024)
  validateHost(errors, 'smtpHost', state.smtpHost || '', 'SMTP')
  validateTransport(errors, 'smtpPort', state.smtpPort, state.smtpSecurity, 'SMTP')
  if (!sameSmtpCredentials.value) {
    validateCredential(errors, 'smtpUsername', state.smtpUsername || '', 'Podaj login SMTP.')
    validateCredential(errors, 'smtpPassword', state.smtpPassword || '', 'Podaj hasło aplikacji do SMTP.', 1024)
  }

  const domain = email.split('@').at(-1) || ''
  if (['gmail.com', 'googlemail.com'].includes(domain)) {
    errors.push({ name: 'accountEmail', message: 'Dla Gmaila wybierz połączenie Google OAuth.' })
  }
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) {
    errors.push({ name: 'accountEmail', message: 'Dla Outlooka wybierz połączenie Microsoft OAuth.' })
  }
  return errors
}

function validateHost(
  errors: FormError[],
  name: 'imapHost' | 'smtpHost',
  value: string,
  label: string,
): void {
  const host = value.trim().toLowerCase()
  if (
    !host
    || host.length > 253
    || !/^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(host)
  ) {
    errors.push({ name, message: `${label}: podaj publiczną nazwę serwera, np. mail.firma.pl.` })
  }
}

function validateTransport(
  errors: FormError[],
  name: 'imapPort' | 'smtpPort',
  port: number | undefined,
  security: MailTransportSecurity | undefined,
  protocol: 'IMAP' | 'SMTP',
): void {
  const valid = protocol === 'IMAP'
    ? (port === 993 && security === 'tls') || (port === 143 && security === 'starttls')
    : (port === 465 && security === 'tls') || (port === 587 && security === 'starttls')
  if (!valid) {
    errors.push({ name, message: `${protocol}: wybierz standardowy port z wymaganym szyfrowaniem.` })
  }
}

function validateCredential(
  errors: FormError[],
  name: 'imapUsername' | 'imapPassword' | 'smtpUsername' | 'smtpPassword',
  value: string,
  emptyMessage: string,
  maxLength = 320,
): void {
  if (!value.trim()) errors.push({ name, message: emptyMessage })
  else if (value.length > maxLength || /[\u0000-\u001F\u007F]/u.test(value)) {
    errors.push({ name, message: 'Wartość zawiera niedozwolone znaki lub jest zbyt długa.' })
  }
}

function connectionInput(data: ImapConnectionForm): ImapSmtpConnectionInput {
  return {
    displayName: data.displayName.trim(),
    accountEmail: data.accountEmail.trim().toLowerCase(),
    imapHost: data.imapHost.trim().toLowerCase(),
    imapPort: Number(data.imapPort),
    imapSecurity: data.imapSecurity,
    imapUsername: data.imapUsername.trim(),
    imapPassword: data.imapPassword,
    smtpHost: data.smtpHost.trim().toLowerCase(),
    smtpPort: Number(data.smtpPort),
    smtpSecurity: data.smtpSecurity,
    smtpUsername: sameSmtpCredentials.value
      ? data.imapUsername.trim()
      : data.smtpUsername.trim(),
    smtpPassword: sameSmtpCredentials.value
      ? data.imapPassword
      : data.smtpPassword,
  }
}

async function submitImap(event: FormSubmitEvent<ImapConnectionForm>): Promise<void> {
  if (submitMode.value === 'save') await saveImapConnection(event.data)
  else await testImapConnection(event.data)
}

async function testImapConnection(data: ImapConnectionForm): Promise<void> {
  if (busy.value) return
  testing.value = true
  requestError.value = ''
  testSucceeded.value = false
  testFingerprint.value = ''
  try {
    const input = connectionInput(data)
    await $fetch(`${props.connectionsPath}/imap/test`, {
      method: 'POST',
      body: input,
    })
    testFingerprint.value = await inputFingerprint(input)
    testSucceeded.value = true
    toast.add({
      title: 'Połączenie działa',
      description: 'Logowanie do IMAP i SMTP zakończyło się powodzeniem.',
      color: 'success',
      icon: 'i-lucide-shield-check',
    })
  }
  catch (error) {
    requestError.value = apiErrorMessage(error)
  }
  finally {
    testing.value = false
  }
}

async function saveImapConnection(data: ImapConnectionForm): Promise<void> {
  if (busy.value || !testSucceeded.value) return
  const input = connectionInput(data)
  if (await inputFingerprint(input) !== testFingerprint.value) {
    testSucceeded.value = false
    requestError.value = 'Konfiguracja zmieniła się od ostatniego testu. Sprawdź połączenie ponownie.'
    return
  }
  saving.value = true
  requestError.value = ''
  try {
    const response = await $fetch<{ data: MailConnectionInfo }>(
      `${props.connectionsPath}/imap`,
      {
        method: 'POST',
        body: {
          ...input,
          ...(props.reconnectConnection?.provider === 'imap'
            ? { replacementConnectionId: props.reconnectConnection.id }
            : {}),
        },
      },
    )
    emit('connected', response.data)
    emit('update:open', false)
    toast.add({
      title: 'Skrzynka została połączona',
      description: `${response.data.accountEmail} jest gotowa do użycia.`,
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  }
  catch (error) {
    requestError.value = apiErrorMessage(error)
  }
  finally {
    saving.value = false
  }
}

async function inputFingerprint(input: ImapSmtpConnectionInput): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(input))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function focusFirstError(event: FormErrorEvent): Promise<void> {
  await nextTick()
  const errorId = event.errors.find(error => error.id)?.id
  const input = errorId
    ? document.getElementById(errorId)
    : document.querySelector<HTMLElement>('#mail-connection-form [aria-invalid="true"]')
  input?.focus()
}
</script>

<template>
  <UModal
    v-model:open="openModel"
    :title="reconnecting ? 'Połącz skrzynkę ponownie' : 'Dodaj konto pocztowe'"
    description="Wybierz dostawcę. Każda skrzynka pozostaje prywatna dla jej właściciela."
    :dismissible="!busy"
    :close="!busy"
    :ui="{ content: 'max-w-full sm:max-w-3xl', footer: 'justify-between' }"
  >
    <template #body>
      <div v-if="!selectedProvider" class="mail-connection-provider-list">
        <button
          v-for="provider in providers"
          :key="provider.id"
          type="button"
          class="mail-connection-provider"
          :class="{ 'mail-connection-provider--unavailable': !provider.configured }"
          @click="selectProvider(provider)"
        >
          <span class="mail-connection-provider__icon" aria-hidden="true">
            <img v-if="provider.icon.startsWith('/')" :src="provider.icon" alt="">
            <UIcon v-else :name="provider.icon" />
          </span>
          <span class="mail-connection-provider__copy">
            <strong>{{ provider.label }}</strong>
            <small>{{ provider.description }}</small>
          </span>
          <UBadge
            :color="provider.configured ? 'success' : 'warning'"
            variant="subtle"
            size="sm"
          >
            {{ provider.configured ? 'Gotowe' : 'Wymaga konfiguracji' }}
          </UBadge>
          <UIcon name="i-lucide-chevron-right" class="mail-connection-provider__chevron" />
        </button>

        <div v-if="!providers.length" class="mail-connection-provider-list__empty">
          <USkeleton class="h-24 w-full" />
          <USkeleton class="h-24 w-full" />
          <USkeleton class="h-24 w-full" />
        </div>

        <div class="mail-connection-privacy">
          <UIcon name="i-lucide-lock-keyhole" />
          <p>
            Tokeny i hasła aplikacji są szyfrowane po stronie serwera. OpenExpert nie
            zwraca ich do przeglądarki ani nie zapisuje treści skrzynki w CRM.
          </p>
        </div>
      </div>

      <div v-else-if="selectedProvider.connectionKind === 'oauth'" class="mail-oauth-connection">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          :disabled="busy"
          @click="backToProviders"
        >
          Inny dostawca
        </UButton>

        <div class="mail-oauth-connection__hero">
          <span class="mail-connection-provider__icon mail-connection-provider__icon--large" aria-hidden="true">
            <img v-if="selectedProvider.icon.startsWith('/')" :src="selectedProvider.icon" alt="">
            <UIcon v-else :name="selectedProvider.icon" />
          </span>
          <div>
            <p>{{ reconnecting ? 'Ponowne połączenie' : 'Bezpieczne logowanie OAuth' }}</p>
            <h3>{{ selectedProvider.label }}</h3>
            <span>{{ selectedProvider.description }}</span>
          </div>
        </div>

        <UAlert
          v-if="!selectedProvider.configured || !providerConnectPath(selectedProvider)"
          color="warning"
          variant="subtle"
          icon="i-lucide-settings-2"
          title="Integracja nie jest jeszcze dostępna"
          description="Administrator musi skonfigurować aplikację OAuth tego dostawcy po stronie serwera."
        />
        <UAlert
          v-else
          color="info"
          variant="subtle"
          icon="i-lucide-shield-check"
          title="Hasło pozostaje u dostawcy"
          description="Zostaniesz przekierowany na bezpieczną stronę dostawcy. OpenExpert otrzyma tylko udzielone uprawnienia do odczytu i wysyłania poczty."
        />
      </div>

      <div v-else class="mail-imap-connection">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          :disabled="busy"
          @click="backToProviders"
        >
          Inny dostawca
        </UButton>

        <UAlert
          v-if="!imapConfigured"
          color="warning"
          variant="subtle"
          icon="i-lucide-settings-2"
          title="Połączenia IMAP nie są jeszcze skonfigurowane"
          description="Administrator musi skonfigurować klucz szyfrowania po stronie serwera."
        />

        <UAlert
          v-if="reconnecting"
          color="info"
          variant="subtle"
          icon="i-lucide-rotate-ccw-key"
          title="Wprowadź aktualne dane ponownie"
          description="Ze względów bezpieczeństwa zapisanych haseł i adresów serwerów nie pokazujemy w formularzu."
        />

        <UForm
          id="mail-connection-form"
          :state="form"
          :validate="validateImapConnection"
          :validate-on="['blur', 'change']"
          class="mail-imap-form"
          @submit="submitImap"
          @error="focusFirstError"
        >
          <section class="mail-imap-form__section">
            <div class="mail-imap-form__heading">
              <span>1</span>
              <div>
                <h3>Skrzynka i dostawca</h3>
                <p>Preset uzupełni standardowe, szyfrowane adresy serwerów.</p>
              </div>
            </div>

            <div class="mail-imap-form__grid">
              <UFormField name="preset" label="Dostawca" required>
                <USelect
                  v-model="form.preset"
                  :items="presetItems"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                  :disabled="busy"
                />
              </UFormField>
              <UFormField name="displayName" label="Nazwa konta" hint="Opcjonalnie">
                <UInput
                  v-model="form.displayName"
                  class="w-full"
                  placeholder="Np. Biuro kredytowe"
                  :maxlength="120"
                  :disabled="busy"
                />
              </UFormField>
              <UFormField name="accountEmail" label="Adres e-mail" required class="mail-imap-form__wide">
                <UInput
                  v-model="form.accountEmail"
                  class="w-full"
                  type="email"
                  inputmode="email"
                  autocomplete="email"
                  placeholder="ekspert@firma.pl"
                  :disabled="busy"
                />
              </UFormField>
            </div>
            <UAlert
              v-if="form.preset === 'home'"
              color="info"
              variant="subtle"
              icon="i-lucide-info"
              title="Użyj serwera przypisanego do swojej skrzynki"
              description="W panelu home.pl skopiuj dokładną nazwę serwera poczty i wpisz ją niżej osobno dla IMAP oraz SMTP. Nie używamy jednej domyślnej nazwy dla wszystkich kont."
            />
          </section>

          <section class="mail-imap-form__section">
            <div class="mail-imap-form__heading">
              <span>2</span>
              <div>
                <h3>Poczta przychodząca — IMAP</h3>
                <p>POP3 nie jest obsługiwany, ponieważ nie synchronizuje poprawnie folderów.</p>
              </div>
            </div>

            <div class="mail-imap-form__server-grid">
              <UFormField name="imapHost" label="Serwer IMAP" required class="mail-imap-form__host">
                <UInput
                  v-model="form.imapHost"
                  class="w-full"
                  autocomplete="off"
                  placeholder="imap.firma.pl"
                  :disabled="busy"
                />
              </UFormField>
              <UFormField name="imapPort" label="Port" required>
                <USelect
                  v-model="form.imapPort"
                  :items="imapPortItems"
                  value-key="value"
                  class="w-full"
                  :disabled="busy"
                />
              </UFormField>
              <UFormField name="imapSecurity" label="Szyfrowanie" required>
                <USelect
                  v-model="form.imapSecurity"
                  :items="securityItems"
                  value-key="value"
                  class="w-full"
                  disabled
                />
              </UFormField>
              <UFormField name="imapUsername" label="Login IMAP" required class="mail-imap-form__host">
                <UInput
                  v-model="form.imapUsername"
                  class="w-full"
                  autocomplete="username"
                  placeholder="Zwykle pełny adres e-mail"
                  :disabled="busy"
                />
              </UFormField>
              <UFormField name="imapPassword" label="Hasło aplikacji IMAP" required class="mail-imap-form__credentials">
                <UInput
                  v-model="form.imapPassword"
                  class="w-full"
                  type="password"
                  autocomplete="new-password"
                  placeholder="Wklej hasło aplikacji"
                  :disabled="busy"
                />
              </UFormField>
            </div>
          </section>

          <section class="mail-imap-form__section">
            <div class="mail-imap-form__heading">
              <span>3</span>
              <div>
                <h3>Poczta wychodząca — SMTP</h3>
                <p>Wiadomości będą wysyłane przez serwer Twojego dostawcy.</p>
              </div>
            </div>

            <div class="mail-imap-form__server-grid">
              <UFormField name="smtpHost" label="Serwer SMTP" required class="mail-imap-form__host">
                <UInput
                  v-model="form.smtpHost"
                  class="w-full"
                  autocomplete="off"
                  placeholder="smtp.firma.pl"
                  :disabled="busy"
                />
              </UFormField>
              <UFormField name="smtpPort" label="Port" required>
                <USelect
                  v-model="form.smtpPort"
                  :items="smtpPortItems"
                  value-key="value"
                  class="w-full"
                  :disabled="busy"
                />
              </UFormField>
              <UFormField name="smtpSecurity" label="Szyfrowanie" required>
                <USelect
                  v-model="form.smtpSecurity"
                  :items="securityItems"
                  value-key="value"
                  class="w-full"
                  disabled
                />
              </UFormField>
            </div>

            <UCheckbox
              v-model="sameSmtpCredentials"
              label="Użyj tego samego loginu i hasła do SMTP"
              description="Najczęstsza konfiguracja u dostawców poczty."
              :disabled="busy"
            />

            <div v-if="!sameSmtpCredentials" class="mail-imap-form__grid">
              <UFormField name="smtpUsername" label="Login SMTP" required>
                <UInput
                  v-model="form.smtpUsername"
                  class="w-full"
                  autocomplete="username"
                  placeholder="Zwykle pełny adres e-mail"
                  :disabled="busy"
                />
              </UFormField>
              <UFormField name="smtpPassword" label="Hasło aplikacji SMTP" required>
                <UInput
                  v-model="form.smtpPassword"
                  class="w-full"
                  type="password"
                  autocomplete="new-password"
                  placeholder="Wklej hasło aplikacji"
                  :disabled="busy"
                />
              </UFormField>
            </div>
          </section>

          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-key-round"
            title="Użyj hasła aplikacji"
            description="Jeżeli dostawca oferuje hasła aplikacji lub uwierzytelnianie dwuetapowe, wygeneruj osobne hasło dla OpenExpert. Połączenia nieszyfrowane są odrzucane."
          />

          <UAlert
            v-if="requestError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Nie udało się połączyć skrzynki"
            :description="requestError"
          />
          <UAlert
            v-else-if="testSucceeded"
            color="success"
            variant="subtle"
            icon="i-lucide-shield-check"
            title="IMAP i SMTP działają prawidłowo"
            description="Możesz bezpiecznie zapisać tę konfigurację."
          />
        </UForm>
      </div>
    </template>

    <template #footer>
      <UButton color="neutral" variant="outline" :disabled="busy" @click="closeModal">
        Anuluj
      </UButton>

      <div v-if="selectedProvider?.connectionKind === 'oauth'" class="mail-connection-modal__actions">
        <UButton
          icon="i-lucide-log-in"
          :disabled="!selectedProvider.configured || !providerConnectPath(selectedProvider)"
          @click="startOAuth(selectedProvider)"
        >
          {{ reconnecting ? 'Połącz ponownie' : `Połącz z ${selectedProvider.label}` }}
        </UButton>
      </div>
      <div v-else-if="selectedProvider?.id === 'imap'" class="mail-connection-modal__actions">
        <UButton
          type="submit"
          form="mail-connection-form"
          color="neutral"
          variant="outline"
          icon="i-lucide-plug-zap"
          :loading="testing"
          :disabled="saving || !imapConfigured"
          @click="submitMode = 'test'"
        >
          Sprawdź połączenie
        </UButton>
        <UButton
          type="submit"
          form="mail-connection-form"
          icon="i-lucide-check"
          :loading="saving"
          :disabled="testing || !testSucceeded || !imapConfigured"
          @click="submitMode = 'save'"
        >
          Zapisz skrzynkę
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.mail-connection-provider-list,
.mail-oauth-connection,
.mail-imap-connection,
.mail-imap-form {
  display: grid;
  gap: 16px;
}

.mail-connection-provider-list {
  padding-block: 2px;
}

.mail-connection-provider {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-control);
  color: var(--ui-text);
  background: var(--ui-bg);
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--oe-motion-fast),
    background-color var(--oe-motion-fast),
    transform var(--oe-motion-fast);
}

.mail-connection-provider:hover {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-muted);
  transform: translateY(-1px);
}

.mail-connection-provider:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}

.mail-connection-provider--unavailable {
  opacity: .72;
}

.mail-connection-provider__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--ui-border);
  border-radius: 13px;
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
}

.mail-connection-provider__icon img,
.mail-connection-provider__icon :deep(svg) {
  width: 23px;
  height: 23px;
}

.mail-connection-provider__icon--large {
  width: 64px;
  height: 64px;
  border-radius: 18px;
}

.mail-connection-provider__icon--large img,
.mail-connection-provider__icon--large :deep(svg) {
  width: 32px;
  height: 32px;
}

.mail-connection-provider__copy {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.mail-connection-provider__copy strong {
  color: var(--ui-text-highlighted);
  font-size: 14px;
}

.mail-connection-provider__copy small {
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.mail-connection-provider__chevron {
  color: var(--ui-text-dimmed);
}

.mail-connection-provider-list__empty {
  display: grid;
  gap: 12px;
}

.mail-connection-privacy {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 14px;
  border-radius: var(--oe-radius-control);
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
}

.mail-connection-privacy :deep(svg) {
  flex: 0 0 auto;
  margin-top: 2px;
}

.mail-connection-privacy p {
  margin: 0;
  font-size: 11px;
  line-height: 1.55;
}

.mail-oauth-connection__hero {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
  background: var(--ui-bg-muted);
}

.mail-oauth-connection__hero div {
  display: grid;
  gap: 4px;
}

.mail-oauth-connection__hero p,
.mail-oauth-connection__hero h3,
.mail-oauth-connection__hero span {
  margin: 0;
}

.mail-oauth-connection__hero p {
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.mail-oauth-connection__hero h3 {
  color: var(--ui-text-highlighted);
  font-size: 21px;
  font-weight: 560;
}

.mail-oauth-connection__hero span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.mail-imap-form__section {
  display: grid;
  gap: 15px;
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: var(--oe-radius-surface);
}

.mail-imap-form__heading {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}

.mail-imap-form__heading > span {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 25px;
  height: 25px;
  border-radius: 999px;
  color: var(--ui-text-inverted);
  background: var(--ui-bg-inverted);
  font-family: var(--font-mono);
  font-size: 10px;
}

.mail-imap-form__heading h3,
.mail-imap-form__heading p {
  margin: 0;
}

.mail-imap-form__heading h3 {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.mail-imap-form__heading p {
  margin-top: 2px;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.mail-imap-form__grid,
.mail-imap-form__server-grid {
  display: grid;
  gap: 13px;
}

.mail-imap-form__grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mail-imap-form__server-grid {
  grid-template-columns: minmax(0, 1fr) 150px 140px;
}

.mail-imap-form__wide,
.mail-imap-form__credentials {
  grid-column: 1 / -1;
}

.mail-imap-form__host {
  min-width: 0;
}

.mail-connection-modal__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 700px) {
  .mail-connection-provider {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .mail-connection-provider :deep(.badge) {
    display: none;
  }

  .mail-connection-provider > :nth-child(3) {
    display: none;
  }

  .mail-imap-form__grid,
  .mail-imap-form__server-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .mail-imap-form__wide,
  .mail-imap-form__credentials {
    grid-column: auto;
  }

  .mail-connection-modal__actions {
    width: 100%;
  }

  .mail-connection-modal__actions :deep(button) {
    flex: 1 1 auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mail-connection-provider {
    transition: none;
  }
}
</style>
