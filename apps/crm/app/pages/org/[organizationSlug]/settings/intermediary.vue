<script setup lang="ts">
import {
  createEmptyIntermediarySettings,
  intermediarySettingsReadiness,
  normalizeIntermediarySettings,
  type IntermediarySettingsReadiness,
  type OrganizationIntermediarySettings,
} from '#shared/intermediary-settings'
import { apiErrorMessage } from '~/utils/api-error'

definePageMeta({ middleware: ['auth', 'organization'] })
useHead({ title: 'Dane pośrednika — Ustawienia — OpenExpert CRM' })

type IntermediaryPayload = {
  data: OrganizationIntermediarySettings
  lenders: Array<{ id: string, name: string }>
  readiness: IntermediarySettingsReadiness
  isConfigured: boolean
  revision: number
  updatedAt: string | null
  canEdit: boolean
}

type IntermediaryDocumentKind = 'ofi' | 'rodo'

function cloneSettings(value: unknown): OrganizationIntermediarySettings {
  return structuredClone(normalizeIntermediarySettings(value))
}

const { orgApiPath } = useOrganizationContext()
const organizationSettingsTabs = useOrganizationSettingsTabs()
const toast = useToast()
const saving = ref(false)
const formError = ref<string | null>(null)
const previewOpen = ref(false)
const previewKind = ref<IntermediaryDocumentKind>('ofi')
const dateFormatter = new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const pluralRules = new Intl.PluralRules('pl-PL')

const { data: payload, error, status } = await useFetch<IntermediaryPayload>(
  () => orgApiPath('/intermediary'),
  {
    key: computed(() => `organization-intermediary-${orgApiPath()}`),
    default: () => {
      const data = createEmptyIntermediarySettings()
      return {
        data,
        lenders: [],
        readiness: intermediarySettingsReadiness(data),
        isConfigured: false,
        revision: 0,
        updatedAt: null,
        canEdit: false,
      }
    },
  },
)

const form = reactive<OrganizationIntermediarySettings>(cloneSettings(payload.value.data))
const saved = ref<OrganizationIntermediarySettings>(cloneSettings(payload.value.data))

watch(() => payload.value.data, (value) => {
  const normalized = cloneSettings(value)
  Object.assign(form, normalized)
  saved.value = cloneSettings(normalized)
})

const providerRoleItems = [
  { label: 'Pośrednik kredytu hipotecznego', value: 'intermediary' },
  { label: 'Agent pośrednika kredytu hipotecznego', value: 'agent' },
]

const lenderItems = computed(() => payload.value.lenders.map(lender => ({
  label: lender.name,
  value: lender.id,
})))
const hasLegacyLenderNames = computed(() => (
  form.relationship.lenderNames.length > 0
  && form.relationship.lenderBankIds.length === 0
))
const hasLegacyCooperatingLenderNames = computed(() => (
  form.relationship.cooperatingLenderNames.length > 0
  && form.relationship.cooperatingLenderBankIds.length === 0
))

watch(() => [...form.relationship.lenderBankIds], (selectedIds, previousIds) => {
  // A legacy revision can contain a legal-name snapshot without bank ids.
  // Replacing `form.relationship` after a refetch must not erase that snapshot.
  if (!selectedIds.length && !previousIds.length && form.relationship.lenderNames.length) return
  const selected = new Set(selectedIds)
  form.relationship.lenderNames = payload.value.lenders
    .filter(lender => selected.has(lender.id))
    .map(lender => lender.name)
})

watch(() => [...form.relationship.cooperatingLenderBankIds], (selectedIds, previousIds) => {
  if (
    !selectedIds.length
    && !previousIds.length
    && form.relationship.cooperatingLenderNames.length
  ) return
  const selected = new Set(selectedIds)
  form.relationship.cooperatingLenderNames = payload.value.lenders
    .filter(lender => selected.has(lender.id))
    .map(lender => lender.name)
})

const currentReadiness = computed(() => intermediarySettingsReadiness(form))
const isDirty = computed(() => (
  JSON.stringify(normalizeIntermediarySettings(form)) !== JSON.stringify(saved.value)
))
const updatedLabel = computed(() => (
  payload.value.updatedAt
    ? dateFormatter.format(new Date(payload.value.updatedAt))
    : 'brak zapisanej konfiguracji'
))
const documentItems = computed(() => ([
  {
    kind: 'ofi' as const,
    shortTitle: 'OFI',
    title: 'Informacja o pośredniku',
    description: 'Informacje przekazywane klientowi przed rozpoczęciem świadczenia usług.',
    icon: 'i-lucide-landmark',
    readiness: payload.value.readiness.ofi,
  },
  {
    kind: 'rodo' as const,
    shortTitle: 'RODO',
    title: 'Klauzula informacyjna',
    description: 'Informacja administratora danych zgodna z art. 13 i 14 RODO.',
    icon: 'i-lucide-shield-check',
    readiness: payload.value.readiness.rodo,
  },
]))
const previewDocument = computed(() => (
  documentItems.value.find(item => item.kind === previewKind.value) ?? documentItems.value[0]!
))
const previewUrl = computed(() => documentUrl(previewKind.value))

function documentUrl(kind: IntermediaryDocumentKind, download = false): string {
  const query = new URLSearchParams({ revision: String(payload.value.revision) })
  if (download) query.set('download', '1')
  return `${orgApiPath(`/intermediary/documents/${kind}`)}?${query.toString()}`
}

function openDocumentPreview(kind: IntermediaryDocumentKind) {
  previewKind.value = kind
  previewOpen.value = true
}

function missingDataLabel(count: number): string {
  const form = pluralRules.select(count)
  const noun = form === 'one' ? 'brak' : form === 'few' ? 'braki' : 'braków'
  return `${count} ${noun}`
}

function discardChanges() {
  Object.assign(form, cloneSettings(saved.value))
  formError.value = null
}

function providerAddress(): string {
  if (form.providerRole === 'agent') {
    return [
      form.agent.addressLine,
      [form.agent.postalCode, form.agent.city].filter(Boolean).join(' '),
      form.agent.country,
    ].filter(Boolean).join(', ')
  }
  return [
    form.intermediary.addressLine,
    [form.intermediary.postalCode, form.intermediary.city].filter(Boolean).join(' '),
    form.intermediary.country,
  ].filter(Boolean).join(', ')
}

function copyProviderToPrivacyController() {
  form.privacy.controllerName = form.providerRole === 'agent'
    ? form.agent.legalName
    : form.intermediary.legalName
  form.privacy.controllerAddress = providerAddress()
  form.privacy.controllerEmail = form.providerRole === 'agent'
    ? form.agent.email
    : form.intermediary.email
  form.privacy.controllerPhone = form.providerRole === 'agent'
    ? form.agent.phone
    : form.intermediary.phone
}

async function saveSettings() {
  if (!payload.value.canEdit || saving.value) return
  saving.value = true
  formError.value = null
  try {
    const result = await $fetch<IntermediaryPayload>(orgApiPath('/intermediary'), {
      method: 'PATCH',
      body: {
        settings: normalizeIntermediarySettings(form),
        expectedRevision: payload.value.revision,
      },
    })
    payload.value = result
    const normalized = cloneSettings(result.data)
    Object.assign(form, normalized)
    saved.value = cloneSettings(normalized)
    toast.add({
      title: 'Dane pośrednika zapisane',
      description: result.readiness.ofi.ready && result.readiness.rodo.ready
        ? `Rewizja ${result.revision} jest kompletna dla OFI i danych administratora RODO.`
        : `Zapisano rewizję ${result.revision}. Uzupełnij wskazane braki przed generowaniem dokumentów.`,
      color: result.readiness.ofi.ready && result.readiness.rodo.ready ? 'success' : 'warning',
      icon: result.readiness.ofi.ready && result.readiness.rodo.ready
        ? 'i-lucide-circle-check'
        : 'i-lucide-triangle-alert',
    })
  } catch (caught) {
    formError.value = apiErrorMessage(caught)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <CrmShell
    title="Dane pośrednika"
    eyebrow="Ustawienia organizacji"
    description="Jedno źródło danych do OFI, informacji RODO i dokumentów kredytowych organizacji."
    :tabs="organizationSettingsTabs"
  >
    <UAlert
      v-if="error"
      color="error"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać danych pośrednika"
      description="Sprawdź połączenie z bazą i zastosowanie migracji."
    />

    <UAlert
      v-else-if="status === 'success' && !payload.canEdit"
      color="warning"
      icon="i-lucide-lock-keyhole"
      title="Dostęp tylko dla administratora organizacji"
      description="Członkowie mogą korzystać z opublikowanych danych, ale nie mogą ich zmieniać."
    />

    <template v-else-if="status === 'success'">
      <section class="settings-summary">
        <div class="summary-copy">
          <div class="summary-badges">
            <UBadge :color="payload.isConfigured ? 'info' : 'neutral'" variant="subtle">
              {{ payload.isConfigured ? `Rewizja ${payload.revision}` : 'Konfiguracja robocza' }}
            </UBadge>
            <span>Ostatnia zmiana: {{ updatedLabel }}</span>
          </div>
          <h2>Gotowość danych prawnych</h2>
          <p>
            OFI jest informacją przekazywaną klientowi, a klauzula RODO realizuje obowiązek
            informacyjny. Żaden z tych dokumentów nie jest zgodą klienta.
          </p>
        </div>
        <div class="summary-actions">
          <UButton
            color="neutral"
            variant="outline"
            :disabled="!isDirty || saving"
            @click="discardChanges"
          >
            Odrzuć zmiany
          </UButton>
          <UButton
            icon="i-lucide-save"
            :loading="saving"
            :disabled="!isDirty"
            @click="saveSettings"
          >
            Zapisz dane
          </UButton>
        </div>
      </section>

      <div class="readiness-grid">
        <article class="readiness-card">
          <div>
            <span class="readiness-label">OFI · art. 17</span>
            <UBadge :color="currentReadiness.ofi.ready ? 'success' : 'warning'" variant="subtle">
              {{ currentReadiness.ofi.ready ? 'Kompletne' : `${currentReadiness.ofi.missing.length} braków` }}
            </UBadge>
          </div>
          <p v-if="currentReadiness.ofi.ready">Dane wystarczają do zbudowania informacji o pośredniku.</p>
          <ul v-else>
            <li v-for="item in currentReadiness.ofi.missing" :key="item">{{ item }}</li>
          </ul>
        </article>
        <article class="readiness-card">
          <div>
            <span class="readiness-label">RODO · administrator</span>
            <UBadge :color="currentReadiness.rodo.ready ? 'success' : 'warning'" variant="subtle">
              {{ currentReadiness.rodo.ready ? 'Kompletne' : `${currentReadiness.rodo.missing.length} braków` }}
            </UBadge>
          </div>
          <p v-if="currentReadiness.rodo.ready">Skonfigurowano informacje wymagane do klauzuli z art. 13 i 14 RODO.</p>
          <ul v-else>
            <li v-for="item in currentReadiness.rodo.missing" :key="item">{{ item }}</li>
          </ul>
        </article>
      </div>

      <UAlert
        v-if="currentReadiness.recommendations.length"
        color="info"
        variant="subtle"
        icon="i-lucide-lightbulb"
        title="Dodatkowe elementy procesu"
        :description="currentReadiness.recommendations.join(' ')"
      />

      <section class="documents-section" aria-labelledby="legal-documents-heading">
        <header class="documents-header">
          <div>
            <span class="documents-kicker">Dokumenty dla klienta</span>
            <h2 id="legal-documents-heading">Podgląd OFI i RODO</h2>
            <p v-if="payload.isConfigured">
              Podgląd i pobieranie korzystają z ostatniej zapisanej rewizji {{ payload.revision }}.
            </p>
            <p v-else>
              Podgląd pokazuje dokument roboczy do czasu zapisania pierwszej konfiguracji.
            </p>
          </div>
          <UBadge :color="payload.isConfigured ? 'neutral' : 'warning'" variant="subtle">
            {{ payload.isConfigured ? `Zapisana rewizja ${payload.revision}` : 'Brak zapisanej konfiguracji' }}
          </UBadge>
        </header>

        <UAlert
          v-if="isDirty"
          class="documents-unsaved-alert"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Podgląd nie obejmuje niezapisanych zmian"
          description="Zapisz formularz, aby odświeżyć treść plików OFI i RODO. Do tego czasu podgląd pokazuje ostatnią zapisaną rewizję."
        />

        <div class="documents-grid">
          <article
            v-for="document in documentItems"
            :key="document.kind"
            class="document-card"
            :aria-labelledby="`document-${document.kind}-title`"
          >
            <div class="document-card__top">
              <span class="document-card__icon" aria-hidden="true">
                <UIcon :name="document.icon" />
              </span>
              <UBadge :color="document.readiness.ready ? 'success' : 'warning'" variant="subtle">
                {{ document.readiness.ready ? 'Gotowy' : 'Roboczy' }}
              </UBadge>
            </div>
            <div class="document-card__copy">
              <span>{{ document.shortTitle }}</span>
              <h3 :id="`document-${document.kind}-title`">{{ document.title }}</h3>
              <p>{{ document.description }}</p>
              <small v-if="!document.readiness.ready">
                Dokument ma {{ missingDataLabel(document.readiness.missing.length) }} i zostanie oznaczony jako roboczy.
              </small>
              <small v-else>Dokument zawiera komplet wymaganych danych organizacji.</small>
            </div>
            <div class="document-card__actions">
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-eye"
                :aria-label="`Podejrzyj dokument ${document.shortTitle}`"
                @click="openDocumentPreview(document.kind)"
              >
                Podgląd
              </UButton>
              <UButton
                :to="documentUrl(document.kind, true)"
                target="_blank"
                color="neutral"
                variant="ghost"
                icon="i-lucide-download"
                :aria-label="`Pobierz dokument ${document.shortTitle} jako PDF`"
              >
                Pobierz PDF
              </UButton>
            </div>
          </article>
        </div>
      </section>

      <UAlert
        v-if="formError"
        color="error"
        icon="i-lucide-circle-alert"
        title="Nie udało się zapisać danych"
        :description="formError"
      />

      <form class="settings-form" @submit.prevent="saveSettings">
        <section class="settings-section">
          <header>
            <span>01</span>
            <div>
              <h2>Model działania</h2>
              <p>Określa, kto obsługuje klienta i jaki status należy ujawnić w OFI.</p>
            </div>
          </header>
          <div class="model-settings">
            <div class="model-role-row">
              <div class="model-role-row__copy">
                <span>Rola organizacji</span>
                <p>Wybierz, czy klienta obsługuje bezpośrednio pośrednik, czy jego agent.</p>
              </div>
              <UFormField name="providerRole" class="model-role-row__control">
                <USelect
                  v-model="form.providerRole"
                  :items="providerRoleItems"
                  value-key="value"
                  aria-label="Rola organizacji"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="model-toggle-grid">
              <div class="model-toggle-card">
                <div class="model-toggle-card__copy">
                  <span>Powiązany pośrednik hipoteczny</span>
                  <p>Wymaga wskazania kredytodawców, w imieniu i na rzecz których działa pośrednik.</p>
                </div>
                <div class="model-toggle-card__control">
                  <span>{{ form.relationship.isTiedMortgageIntermediary ? 'Tak' : 'Nie' }}</span>
                  <USwitch
                    v-model="form.relationship.isTiedMortgageIntermediary"
                    aria-label="Powiązany pośrednik hipoteczny"
                  />
                </div>
              </div>

              <div class="model-toggle-card">
                <div class="model-toggle-card__copy">
                  <span>Ustawowe usługi doradcze</span>
                  <p>Usługa doradcza jest odrębna od samego pośrednictwa kredytu hipotecznego.</p>
                </div>
                <div class="model-toggle-card__control">
                  <span>{{ form.relationship.offersAdvisoryServices ? 'Tak' : 'Nie' }}</span>
                  <USwitch
                    v-model="form.relationship.offersAdvisoryServices"
                    aria-label="Oferuje ustawowe usługi doradcze"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <header>
            <span>02</span>
            <div>
              <h2>Pośrednik kredytu hipotecznego</h2>
              <p>Firma, siedziba, adres i wpis RPH są obowiązkowymi elementami OFI.</p>
            </div>
          </header>
          <div class="settings-grid">
            <UFormField name="legalName" label="Pełna firma pośrednika" required>
              <UInput v-model="form.intermediary.legalName" class="w-full" />
            </UFormField>
            <UFormField name="registeredOffice" label="Siedziba / miejsce zamieszkania" required>
              <UInput v-model="form.intermediary.registeredOffice" class="w-full" />
            </UFormField>
            <UFormField name="addressLine" label="Ulica i numer" required>
              <UInput v-model="form.intermediary.addressLine" class="w-full" />
            </UFormField>
            <UFormField name="postalCode" label="Kod pocztowy" required>
              <UInput v-model="form.intermediary.postalCode" class="w-full" />
            </UFormField>
            <UFormField name="city" label="Miejscowość" required>
              <UInput v-model="form.intermediary.city" class="w-full" />
            </UFormField>
            <UFormField name="country" label="Kraj">
              <UInput v-model="form.intermediary.country" class="w-full" />
            </UFormField>
            <UFormField name="mortgageRegisterNumber" label="Numer wpisu RPH" required>
              <UInput v-model="form.intermediary.mortgageRegisterNumber" placeholder="RPH000000" class="w-full" />
            </UFormField>
            <UFormField name="mortgageRegisterUrl" label="Adres rejestru KNF" required>
              <UInput v-model="form.intermediary.mortgageRegisterUrl" type="url" class="w-full" />
            </UFormField>
            <UFormField name="email" label="E-mail pośrednika">
              <UInput v-model="form.intermediary.email" type="email" class="w-full" />
            </UFormField>
            <UFormField name="phone" label="Telefon pośrednika">
              <UInput v-model="form.intermediary.phone" type="tel" class="w-full" />
            </UFormField>
            <UFormField name="website" label="Strona internetowa">
              <UInput v-model="form.intermediary.website" type="url" class="w-full" />
            </UFormField>
            <UFormField name="generalMortgageInformationUrl" label="Informacje ogólne z art. 10">
              <UInput v-model="form.relationship.generalMortgageInformationUrl" type="url" class="w-full" />
            </UFormField>
            <UAlert
              class="field-wide"
              color="info"
              variant="subtle"
              icon="i-lucide-landmark"
              title="Współpraca z bankiem a reprezentowanie banku"
              description="Lista aktywnych partnerów opisuje wszystkie umowy współpracy organizacji. Nie oznacza automatycznie działania w imieniu i na rzecz banku. Takie umocowanie wykazuje osobna lista z art. 17 ust. 1 pkt 3, widoczna dla pośrednika powiązanego."
            />
            <UFormField
              class="field-wide"
              name="cooperatingLenderBankIds"
              label="Banki i kredytodawcy z aktywną umową współpracy"
              description="Wybierz wszystkich aktualnych partnerów organizacji. Lista ma charakter operacyjny i nie decyduje sama o statusie pośrednika powiązanego."
            >
              <USelectMenu
                v-model="form.relationship.cooperatingLenderBankIds"
                :items="lenderItems"
                value-key="value"
                label-key="label"
                multiple
                clear
                class="w-full"
                placeholder="Wybierz aktywnych partnerów z katalogu"
                aria-label="Banki i kredytodawcy z aktywną umową współpracy"
              />
              <UAlert
                v-if="hasLegacyCooperatingLenderNames"
                class="legacy-lenders-alert"
                color="warning"
                variant="subtle"
                icon="i-lucide-history"
                title="Lista współpracy zapisana bez identyfikatorów banków"
                :description="`Obecna rewizja zawiera: ${form.relationship.cooperatingLenderNames.join(', ')}. Wybierz odpowiednich partnerów z katalogu, aby zapisać ich aktualne nazwy prawne.`"
              />
              <UAlert
                v-else-if="!lenderItems.length"
                class="legacy-lenders-alert"
                color="warning"
                variant="subtle"
                icon="i-lucide-database"
                title="Katalog banków jest pusty"
                description="Najpierw uzupełnij globalny katalog instytucji finansowych."
              />
            </UFormField>
            <UFormField
              v-if="form.relationship.isTiedMortgageIntermediary"
              class="field-wide"
              name="lenderBankIds"
              label="Kredytodawcy reprezentowani przez pośrednika powiązanego · art. 17 ust. 1 pkt 3"
              description="Wybierz wyłącznie kredytodawców, w imieniu i na rzecz których organizacja ma formalne umocowanie. To ustawowa lista ujawniana w OFI, odrębna od listy partnerów."
              required
            >
              <USelectMenu
                v-model="form.relationship.lenderBankIds"
                :items="lenderItems"
                value-key="value"
                label-key="label"
                multiple
                clear
                class="w-full"
                placeholder="Wybierz banki z katalogu"
                aria-label="Banki, w imieniu i na rzecz których działa pośrednik"
              />
              <UAlert
                v-if="hasLegacyLenderNames"
                class="legacy-lenders-alert"
                color="warning"
                variant="subtle"
                icon="i-lucide-history"
                title="Lista zapisana w starszej wersji ustawień"
                :description="`Obecna rewizja zawiera: ${form.relationship.lenderNames.join(', ')}. Wybierz odpowiednie banki z katalogu, aby kolejne rewizje korzystały z aktualnych nazw prawnych.`"
              />
              <UAlert
                v-else-if="!lenderItems.length"
                class="legacy-lenders-alert"
                color="warning"
                variant="subtle"
                icon="i-lucide-database"
                title="Katalog banków jest pusty"
                description="Najpierw uzupełnij globalny katalog instytucji finansowych."
              />
            </UFormField>
            <UFormField
              class="field-wide"
              name="authorizationScope"
              label="Zakres umocowania"
              description="Czynności faktyczne i prawne wykonywane w procesie kredytowym."
            >
              <UTextarea v-model="form.relationship.authorizationScope" :rows="4" autoresize class="w-full" />
            </UFormField>
          </div>
        </section>

        <section v-if="form.providerRole === 'agent'" class="settings-section">
          <header>
            <span>03</span>
            <div>
              <h2>Agent reprezentujący pośrednika</h2>
              <p>Agent musi przed rozpoczęciem usługi wskazać swoją funkcję i reprezentowanego pośrednika.</p>
            </div>
          </header>
          <div class="settings-grid">
            <UFormField name="agentLegalName" label="Firma / nazwa agenta" required>
              <UInput v-model="form.agent.legalName" class="w-full" />
            </UFormField>
            <UFormField
              name="agentRegisterNumber"
              label="Numer wpisu RHA"
              description="Dane ewidencyjne agenta w rejestrze KNF."
            >
              <UInput v-model="form.agent.registerNumber" placeholder="RHA0000000" class="w-full" />
            </UFormField>
            <UFormField class="field-wide" name="agentRoleDescription" label="Opis funkcji agenta" required>
              <UInput v-model="form.agent.roleDescription" class="w-full" />
            </UFormField>
            <UFormField name="agentAddress" label="Ulica i numer">
              <UInput v-model="form.agent.addressLine" class="w-full" />
            </UFormField>
            <UFormField name="agentPostalCode" label="Kod pocztowy">
              <UInput v-model="form.agent.postalCode" class="w-full" />
            </UFormField>
            <UFormField name="agentCity" label="Miejscowość">
              <UInput v-model="form.agent.city" class="w-full" />
            </UFormField>
            <UFormField name="agentCountry" label="Kraj">
              <UInput v-model="form.agent.country" class="w-full" />
            </UFormField>
            <UFormField name="agentEmail" label="E-mail agenta">
              <UInput v-model="form.agent.email" type="email" class="w-full" />
            </UFormField>
            <UFormField name="agentPhone" label="Telefon agenta">
              <UInput v-model="form.agent.phone" type="tel" class="w-full" />
            </UFormField>
          </div>
        </section>

        <section class="settings-section">
          <header>
            <span>{{ form.providerRole === 'agent' ? '04' : '03' }}</span>
            <div>
              <h2>Reklamacje i pozasądowe odwołania</h2>
              <p>OFI powinno wyjaśniać procedurę wewnętrzną oraz sposób skorzystania z ADR.</p>
            </div>
          </header>
          <div class="settings-grid">
            <UFormField name="complaintsEmail" label="E-mail do reklamacji">
              <UInput v-model="form.complaints.email" type="email" class="w-full" />
            </UFormField>
            <UFormField name="complaintsPhone" label="Telefon do reklamacji">
              <UInput v-model="form.complaints.phone" type="tel" class="w-full" />
            </UFormField>
            <UFormField class="field-wide" name="complaintsPostalAddress" label="Adres korespondencyjny">
              <UInput v-model="form.complaints.postalAddress" class="w-full" />
            </UFormField>
            <UFormField class="field-wide" name="internalProcedure" label="Wewnętrzna procedura" required>
              <UTextarea v-model="form.complaints.internalProcedure" :rows="5" autoresize class="w-full" />
            </UFormField>
            <UFormField class="field-wide" name="externalProcedure" label="Pozasądowe skargi i odwołania" required>
              <UTextarea v-model="form.complaints.externalProcedure" :rows="5" autoresize class="w-full" />
            </UFormField>
            <UFormField class="field-wide" name="externalProcedureUrl" label="Link do procedury ADR">
              <UInput v-model="form.complaints.externalProcedureUrl" type="url" class="w-full" />
            </UFormField>
          </div>
        </section>

        <section class="settings-section">
          <header>
            <span>{{ form.providerRole === 'agent' ? '05' : '04' }}</span>
            <div>
              <h2>Wynagrodzenie i opłaty klienta</h2>
              <p>Informacja obejmuje korzyści od kredytodawców oraz koszty ponoszone bezpośrednio przez klienta.</p>
            </div>
          </header>
          <div class="settings-grid">
            <UFormField
              name="receivesFromLenders"
              label="Otrzymuje wynagrodzenie od kredytodawców lub innych podmiotów"
            >
              <USwitch v-model="form.remuneration.receivesFromLenders" />
            </UFormField>
            <UFormField name="lenderRemunerationAmountKnown" label="Wysokość wynagrodzenia jest znana">
              <USwitch
                v-model="form.remuneration.lenderRemunerationAmountKnown"
                :disabled="!form.remuneration.receivesFromLenders"
              />
            </UFormField>
            <UFormField
              v-if="form.remuneration.receivesFromLenders"
              class="field-wide"
              name="lenderRemunerationDescription"
              label="Opis wynagrodzenia lub korzyści"
              required
            >
              <UTextarea v-model="form.remuneration.lenderRemunerationDescription" :rows="4" autoresize class="w-full" />
            </UFormField>
            <UFormField
              v-if="form.remuneration.receivesFromLenders && form.remuneration.lenderRemunerationAmountKnown"
              class="field-wide"
              name="lenderRemunerationAmountDescription"
              label="Wysokość wynagrodzenia"
              required
            >
              <UTextarea v-model="form.remuneration.lenderRemunerationAmountDescription" :rows="3" autoresize class="w-full" />
            </UFormField>
            <UFormField
              v-else-if="form.remuneration.receivesFromLenders"
              class="field-wide"
              name="unknownRemunerationNotice"
              label="Informacja dla klienta"
            >
              <UAlert
                color="neutral"
                variant="subtle"
                description="Dokładna kwota powinna zostać podana później w formularzu informacyjnym kredytu z art. 11."
              />
            </UFormField>
            <UFormField name="chargesClientFees" label="Klient płaci pośrednikowi lub agentowi">
              <USwitch v-model="form.remuneration.chargesClientFees" />
            </UFormField>
            <UFormField
              v-if="form.remuneration.chargesClientFees"
              class="field-wide"
              name="clientFeeDescription"
              label="Wysokość lub sposób obliczania opłaty"
              required
            >
              <UTextarea v-model="form.remuneration.clientFeeDescription" :rows="3" autoresize class="w-full" />
            </UFormField>
          </div>
        </section>

        <section class="settings-section">
          <header>
            <span>{{ form.providerRole === 'agent' ? '06' : '05' }}</span>
            <div>
              <h2>Administrator danych osobowych</h2>
              <p>Tożsamość administratora wynika z faktycznej roli w przetwarzaniu, nie z samej nazwy handlowej.</p>
            </div>
            <UButton type="button" color="neutral" variant="outline" size="xs" @click="copyProviderToPrivacyController">
              Uzupełnij danymi usługodawcy
            </UButton>
          </header>
          <div class="settings-grid">
            <UFormField name="controllerName" label="Nazwa administratora" required>
              <UInput v-model="form.privacy.controllerName" class="w-full" />
            </UFormField>
            <UFormField name="controllerEmail" label="E-mail administratora" required>
              <UInput v-model="form.privacy.controllerEmail" type="email" class="w-full" />
            </UFormField>
            <UFormField class="field-wide" name="controllerAddress" label="Adres administratora" required>
              <UInput v-model="form.privacy.controllerAddress" class="w-full" />
            </UFormField>
            <UFormField name="controllerPhone" label="Telefon administratora">
              <UInput v-model="form.privacy.controllerPhone" type="tel" class="w-full" />
            </UFormField>
            <UFormField name="privacyNoticeUrl" label="Opublikowana klauzula RODO">
              <UInput v-model="form.privacy.privacyNoticeUrl" type="url" class="w-full" />
            </UFormField>
            <UFormField name="dpoAppointed" label="Wyznaczono inspektora ochrony danych">
              <USwitch v-model="form.privacy.dpoAppointed" />
            </UFormField>
            <template v-if="form.privacy.dpoAppointed">
              <UFormField name="dpoName" label="Imię, nazwisko lub funkcja IOD">
                <UInput v-model="form.privacy.dpoName" class="w-full" />
              </UFormField>
              <UFormField name="dpoEmail" label="E-mail IOD">
                <UInput v-model="form.privacy.dpoEmail" type="email" class="w-full" />
              </UFormField>
              <UFormField name="dpoPhone" label="Telefon IOD">
                <UInput v-model="form.privacy.dpoPhone" type="tel" class="w-full" />
              </UFormField>
            </template>
          </div>
        </section>

        <section class="settings-section">
          <header>
            <span>{{ form.providerRole === 'agent' ? '07' : '06' }}</span>
            <div>
              <h2>Zakres klauzuli informacyjnej RODO</h2>
              <p>
                Parametry wspólne organizacji dla obowiązku informacyjnego z art. 13 oraz — gdy dane
                pochodzą z innych źródeł — art. 14 RODO.
              </p>
            </div>
          </header>
          <div class="settings-grid">
            <UFormField
              class="field-wide"
              name="purposesAndLegalBases"
              label="Cele i podstawy prawne przetwarzania"
              description="Opisz każdy cel wraz z właściwą podstawą z art. 6, a w razie potrzeby także art. 9 RODO."
              required
            >
              <UTextarea v-model="form.privacy.purposesAndLegalBases" :rows="6" autoresize class="w-full" />
            </UFormField>
            <UFormField
              name="usesLegitimateInterests"
              label="Stosuje prawnie uzasadniony interes"
              description="Dotyczy przetwarzania na podstawie art. 6 ust. 1 lit. f RODO."
            >
              <USwitch v-model="form.privacy.usesLegitimateInterests" />
            </UFormField>
            <UFormField
              v-if="form.privacy.usesLegitimateInterests"
              class="field-wide"
              name="legitimateInterestsDescription"
              label="Prawnie uzasadnione interesy"
              required
            >
              <UTextarea v-model="form.privacy.legitimateInterestsDescription" :rows="4" autoresize class="w-full" />
            </UFormField>
            <UFormField
              class="field-wide"
              name="recipientCategories"
              label="Odbiorcy lub kategorie odbiorców"
              description="Np. kredytodawcy, dostawcy IT, operatorzy korespondencji, doradcy i organy publiczne."
              required
            >
              <UTextarea v-model="form.privacy.recipientCategories" :rows="4" autoresize class="w-full" />
            </UFormField>
            <UFormField
              name="transfersOutsideEea"
              label="Transferuje dane poza EOG"
              description="Włącz także dla dostępu do danych przez odbiorcę w państwie trzecim."
            >
              <USwitch v-model="form.privacy.transfersOutsideEea" />
            </UFormField>
            <UFormField
              v-if="form.privacy.transfersOutsideEea"
              class="field-wide"
              name="transferSafeguardsDescription"
              label="Państwa trzecie i zabezpieczenia transferu"
              description="Podaj podstawę transferu, zastosowane zabezpieczenia oraz sposób uzyskania ich kopii."
              required
            >
              <UTextarea v-model="form.privacy.transferSafeguardsDescription" :rows="4" autoresize class="w-full" />
            </UFormField>
            <UFormField
              class="field-wide"
              name="retentionPolicy"
              label="Okres przechowywania lub kryteria jego ustalania"
              required
            >
              <UTextarea v-model="form.privacy.retentionPolicy" :rows="4" autoresize class="w-full" />
            </UFormField>
            <UFormField
              class="field-wide"
              name="dataSubjectRights"
              label="Prawa osoby, której dane dotyczą"
              description="Uwzględnij prawa właściwe dla stosowanych podstaw oraz cofnięcie zgody, gdy ma zastosowanie."
              required
            >
              <UTextarea v-model="form.privacy.dataSubjectRights" :rows="5" autoresize class="w-full" />
            </UFormField>
            <UFormField name="complaintAuthority" label="Organ nadzorczy do wniesienia skargi" required>
              <UInput v-model="form.privacy.complaintAuthority" class="w-full" />
            </UFormField>
            <UFormField
              class="field-wide"
              name="dataProvisionRequirements"
              label="Obowiązek podania danych i skutki ich niepodania"
              description="Wskaż, czy podanie danych jest wymogiem ustawowym, umownym albo warunkiem zawarcia umowy."
              required
            >
              <UTextarea v-model="form.privacy.dataProvisionRequirements" :rows="4" autoresize class="w-full" />
            </UFormField>
            <UFormField
              name="usesAutomatedDecisionMaking"
              label="Podejmuje decyzje automatycznie lub profiluje"
              description="Włącz, jeżeli występuje proces z art. 22 RODO."
            >
              <USwitch v-model="form.privacy.usesAutomatedDecisionMaking" />
            </UFormField>
            <UFormField
              v-if="form.privacy.usesAutomatedDecisionMaking"
              class="field-wide"
              name="automatedDecisionMakingDescription"
              label="Zasady, znaczenie i przewidywane konsekwencje automatycznej decyzji"
              required
            >
              <UTextarea v-model="form.privacy.automatedDecisionMakingDescription" :rows="4" autoresize class="w-full" />
            </UFormField>
            <UFormField
              name="obtainsDataIndirectly"
              label="Pozyskuje dane także z innych źródeł"
              description="Włącza dodatkowe informacje wymagane przez art. 14 RODO."
            >
              <USwitch v-model="form.privacy.obtainsDataIndirectly" />
            </UFormField>
            <template v-if="form.privacy.obtainsDataIndirectly">
              <UFormField class="field-wide" name="indirectDataCategories" label="Kategorie danych pozyskiwanych pośrednio" required>
                <UTextarea v-model="form.privacy.indirectDataCategories" :rows="4" autoresize class="w-full" />
              </UFormField>
              <UFormField class="field-wide" name="indirectDataSources" label="Źródła danych pozyskiwanych pośrednio" required>
                <UTextarea v-model="form.privacy.indirectDataSources" :rows="4" autoresize class="w-full" />
              </UFormField>
            </template>
          </div>
        </section>

        <footer class="form-footer">
          <span>Zmiana utworzy nową, audytowalną rewizję ustawień organizacji.</span>
          <UButton type="submit" icon="i-lucide-save" :loading="saving" :disabled="!isDirty">
            Zapisz dane
          </UButton>
        </footer>
      </form>

      <UModal
        v-model:open="previewOpen"
        :title="`Podgląd ${previewDocument.shortTitle} — ${previewDocument.title}`"
        :description="payload.isConfigured
          ? `Dokument z zapisanej rewizji ${payload.revision} ustawień organizacji.`
          : 'Dokument roboczy przed zapisaniem pierwszej konfiguracji organizacji.'"
        :ui="{
          content: 'sm:max-w-[96vw] w-[96vw]',
          body: 'p-0 overflow-hidden',
          footer: 'justify-between',
        }"
      >
        <template #body>
          <div class="document-preview">
            <UAlert
              v-if="isDirty"
              class="document-preview__alert"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="Wyświetlana jest zapisana wersja"
              description="Niezapisane zmiany z formularza nie są uwzględnione w tym pliku."
            />
            <iframe
              :key="previewUrl"
              class="document-preview__frame"
              :src="previewUrl"
              :title="`Podgląd dokumentu ${previewDocument.shortTitle} w formacie PDF`"
              loading="lazy"
            />
          </div>
        </template>
        <template #footer="{ close }">
          <span class="document-preview__revision">
            {{ payload.isConfigured ? `Rewizja ${payload.revision}` : 'Konfiguracja robocza' }}
          </span>
          <div class="document-preview__actions">
            <UButton color="neutral" variant="ghost" @click="close">
              Zamknij
            </UButton>
            <UButton
              :to="documentUrl(previewKind, true)"
              target="_blank"
              icon="i-lucide-download"
              :aria-label="`Pobierz dokument ${previewDocument.shortTitle} jako PDF`"
            >
              Pobierz PDF
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </CrmShell>
</template>

<style scoped>
.settings-summary,
.settings-section,
.readiness-card,
.documents-section,
.document-card {
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
}

.settings-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 22px;
}

.summary-copy {
  max-width: 760px;
}

.summary-copy h2,
.settings-section h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 17px;
  font-weight: 650;
}

.summary-copy p,
.settings-section header p,
.readiness-card p,
.form-footer span {
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.summary-badges,
.summary-actions,
.readiness-card > div {
  display: flex;
  align-items: center;
  gap: 10px;
}

.summary-badges span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.summary-actions {
  flex: 0 0 auto;
}

.readiness-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 14px;
}

.readiness-card {
  padding: 18px;
}

.readiness-card > div {
  justify-content: space-between;
}

.readiness-label {
  color: var(--ui-text-highlighted);
  font-size: 13px;
  font-weight: 650;
}

.readiness-card ul {
  display: grid;
  gap: 4px;
  margin: 12px 0 0;
  padding-left: 18px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.documents-section {
  margin-top: 18px;
  padding: 22px;
}

.documents-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.documents-header h2 {
  margin: 3px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 17px;
  font-weight: 650;
}

.documents-header p {
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.documents-kicker,
.document-card__copy > span {
  color: var(--ui-primary);
  font-size: 10px;
  font-weight: 750;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.documents-unsaved-alert {
  margin-top: 16px;
}

.documents-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 18px;
}

.document-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 18px;
}

.document-card__top,
.document-card__actions,
.document-preview__actions {
  display: flex;
  align-items: center;
}

.document-card__top {
  justify-content: space-between;
  gap: 12px;
}

.document-card__icon {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 10px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-toned);
  font-size: 18px;
}

.document-card__copy {
  flex: 1;
  padding: 16px 0 18px;
}

.document-card__copy h3 {
  margin: 4px 0 0;
  color: var(--ui-text-highlighted);
  font-size: 15px;
  font-weight: 650;
}

.document-card__copy p,
.document-card__copy small {
  display: block;
  margin: 6px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.document-card__actions {
  flex-wrap: wrap;
  gap: 8px;
}

.document-preview {
  display: grid;
  gap: 12px;
  padding: 12px;
  background: var(--ui-bg-muted);
}

.document-preview__frame {
  width: 100%;
  height: min(72dvh, 860px);
  min-height: 520px;
  border: 0;
  border-radius: calc(var(--ui-radius) - 2px);
  background: white;
}

.document-preview__revision {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.document-preview__actions {
  gap: 8px;
}

.settings-form {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.settings-section {
  padding: 22px;
}

.settings-section header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 14px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--ui-border-muted);
}

.settings-section header > span {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-toned);
  font-size: 11px;
  font-weight: 700;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 20px;
  padding-top: 20px;
}

.model-settings {
  display: grid;
  gap: 14px;
  padding-top: 20px;
}

.model-role-row,
.model-toggle-card {
  border: 1px solid var(--ui-border-muted);
  border-radius: calc(var(--ui-radius) - 2px);
  background: var(--ui-bg-muted);
}

.model-role-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 420px);
  align-items: center;
  gap: 28px;
  padding: 18px;
}

.model-role-row__copy > span,
.model-toggle-card__copy > span {
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.model-role-row__copy p,
.model-toggle-card__copy p {
  margin: 5px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.model-role-row__control {
  min-width: 0;
}

.model-toggle-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.model-toggle-card {
  display: flex;
  min-height: 112px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 18px;
}

.model-toggle-card__copy {
  max-width: 460px;
}

.model-toggle-card__control {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 9px;
  padding-top: 1px;
}

.model-toggle-card__control > span {
  min-width: 22px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 650;
  text-align: right;
  text-transform: uppercase;
}

.field-wide {
  grid-column: 1 / -1;
}

.legacy-lenders-alert {
  margin-top: 10px;
}

.form-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 4px 0 28px;
}

@media (max-width: 760px) {
  .settings-summary,
  .form-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .summary-actions > * {
    flex: 1;
  }

  .readiness-grid,
  .settings-grid,
  .model-toggle-grid,
  .documents-grid {
    grid-template-columns: 1fr;
  }

  .model-role-row {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .model-toggle-card {
    min-height: 0;
  }

  .documents-header {
    align-items: stretch;
    flex-direction: column;
  }

  .document-card__actions > * {
    flex: 1;
  }

  .document-preview__frame {
    height: 65dvh;
    min-height: 360px;
  }

  .document-preview__revision {
    display: none;
  }

  .document-preview__actions {
    width: 100%;
  }

  .document-preview__actions > * {
    flex: 1;
  }

  .field-wide {
    grid-column: auto;
  }

  .settings-section header {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .settings-section header > :last-child:not(div) {
    grid-column: 1 / -1;
  }
}
</style>
