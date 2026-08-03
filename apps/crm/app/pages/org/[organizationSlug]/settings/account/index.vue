<script setup lang="ts">
import {
  createEmptyExpertBrandProfile,
  normalizeExpertBrandProfile,
  type ExpertBrandProfile,
} from '#shared/brand'
import type {
  AccountBrandResponse,
  AccountPublicVisibilityResponse,
} from '~/types/account-settings'
import { apiErrorMessage } from '~/utils/api-error'

const { orgApiPath, orgPath } = useOrganizationContext()
const toast = useToast()
const saving = ref(false)
const uploadingPortrait = ref(false)
const deletingPortrait = ref(false)
const portraitInput = ref<HTMLInputElement | null>(null)

const [brandFetch, visibilityFetch] = await Promise.all([
  useFetch<AccountBrandResponse>(() => orgApiPath('/brand')),
  useFetch<AccountPublicVisibilityResponse>(() => orgApiPath('/account/public-visibility')),
])
const {
  data: brandResponse,
  error: profileError,
  status: profileStatus,
} = brandFetch
const {
  data: visibilityResponse,
  error: visibilityError,
  refresh: refreshVisibility,
} = visibilityFetch

const draft = reactive<ExpertBrandProfile>(createEmptyExpertBrandProfile())
const saved = ref<ExpertBrandProfile>(createEmptyExpertBrandProfile())

watch(() => brandResponse.value?.data.profile, (value) => {
  if (!value) return
  const normalized = normalizeExpertBrandProfile(value)
  Object.assign(draft, normalized)
  saved.value = normalized
}, { immediate: true })

const canEdit = computed(() => brandResponse.value?.permissions.canEditProfile === true)
const isDirty = computed(() => (
  JSON.stringify(normalizeExpertBrandProfile(draft)) !== JSON.stringify(saved.value)
))
const portalCard = computed(() => ({
  name: draft.expertName || visibilityResponse.value?.portal.card.name || 'Twój ekspert',
  professionalTitle: draft.professionalTitle
    || visibilityResponse.value?.portal.card.professionalTitle
    || 'Ekspert prowadzący Twoją sprawę',
  avatarUrl: draft.portraitUrl || visibilityResponse.value?.portal.card.avatarUrl || null,
}))
const portalInitials = computed(() => portalCard.value.name
  .split(/\s+/u)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part.charAt(0))
  .join('')
  .toLocaleUpperCase('pl-PL'))
const directoryCard = computed(() => visibilityResponse.value?.directory.card ?? null)
const directoryInitials = computed(() => (directoryCard.value?.name ?? '')
  .split(/\s+/u)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part.charAt(0))
  .join('')
  .toLocaleUpperCase('pl-PL'))
const directoryStatus = computed(() => visibilityResponse.value?.directory.status ?? 'hidden')
const directoryStatusMeta = computed(() => {
  if (directoryStatus.value === 'listed') {
    return { label: 'Publicznie w katalogu', color: 'success' as const, icon: 'i-lucide-globe' }
  }
  if (directoryStatus.value === 'facility_only') {
    return { label: 'Widoczny przy placówce', color: 'info' as const, icon: 'i-lucide-building-2' }
  }
  if (directoryStatus.value === 'partial') {
    return { label: 'Niepełna weryfikacja', color: 'warning' as const, icon: 'i-lucide-triangle-alert' }
  }
  return { label: 'Poza katalogiem', color: 'neutral' as const, icon: 'i-lucide-eye-off' }
})

function replaceSavedProfile(value: ExpertBrandProfile) {
  const normalized = normalizeExpertBrandProfile(value)
  Object.assign(draft, normalized)
  saved.value = normalized
}

function choosePortrait() {
  if (canEdit.value) portraitInput.value?.click()
}

function discardChanges() {
  Object.assign(draft, normalizeExpertBrandProfile(saved.value))
}

async function saveProfile() {
  if (!canEdit.value || !isDirty.value || saving.value) return
  saving.value = true
  try {
    const result = await $fetch<{ data: ExpertBrandProfile }>(orgApiPath('/brand'), {
      method: 'PATCH',
      body: normalizeExpertBrandProfile(draft),
    })
    replaceSavedProfile(result.data)
    await refreshVisibility()
    toast.add({
      title: 'Wizytówka zapisana',
      description: 'Klienci zobaczą aktualne dane przy Twoich sprawach.',
      color: 'success',
      icon: 'i-lucide-check',
    })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się zapisać wizytówki',
      description: apiErrorMessage(error),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    saving.value = false
  }
}

async function uploadPortrait(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !canEdit.value || uploadingPortrait.value) return
  uploadingPortrait.value = true
  try {
    const body = new FormData()
    body.append('image', file)
    const result = await $fetch<{ data: ExpertBrandProfile }>(
      orgApiPath('/brand/assets/portrait'),
      { method: 'POST', body },
    )
    draft.portraitUrl = result.data.portraitUrl
    saved.value = normalizeExpertBrandProfile({
      ...saved.value,
      portraitUrl: result.data.portraitUrl,
    })
    await refreshVisibility()
    toast.add({
      title: 'Zdjęcie zaktualizowane',
      description: 'Nowy portret jest już używany w portalu klienta.',
      color: 'success',
      icon: 'i-lucide-image-up',
    })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się przesłać zdjęcia',
      description: apiErrorMessage(error),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    uploadingPortrait.value = false
    input.value = ''
  }
}

async function removePortrait() {
  if (!canEdit.value || deletingPortrait.value) return
  deletingPortrait.value = true
  try {
    const result = await $fetch<{ data: ExpertBrandProfile }>(
      orgApiPath('/brand/assets/portrait'),
      { method: 'DELETE' },
    )
    draft.portraitUrl = result.data.portraitUrl
    saved.value = normalizeExpertBrandProfile({
      ...saved.value,
      portraitUrl: result.data.portraitUrl,
    })
    await refreshVisibility()
    toast.add({ title: 'Zdjęcie usunięte', color: 'success' })
  }
  catch (error) {
    toast.add({
      title: 'Nie udało się usunąć zdjęcia',
      description: apiErrorMessage(error),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  }
  finally {
    deletingPortrait.value = false
  }
}
</script>

<template>
  <div class="account-card-page">
    <UAlert
      v-if="profileError"
      color="error"
      variant="subtle"
      icon="i-lucide-user-round-x"
      title="Nie udało się pobrać wizytówki"
      description="Odśwież stronę i spróbuj ponownie. Edycja pozostaje chwilowo niedostępna."
    />
    <UAlert
      v-if="visibilityError"
      color="warning"
      variant="subtle"
      icon="i-lucide-eye-off"
      title="Nie udało się potwierdzić widoczności"
      description="Dane profilu możesz nadal edytować, ale podgląd katalogu jest chwilowo niedostępny."
    />
    <UAlert
      v-else-if="directoryStatus === 'partial'"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Katalog odpowiedział tylko częściowo"
      description="Nie wszystkie publiczne widgety dało się sprawdzić. Podgląd może być niepełny."
    />

    <div v-if="profileStatus === 'pending' && !brandResponse" class="account-card-skeleton">
      <USkeleton class="h-96 w-full" />
      <USkeleton class="h-96 w-full" />
    </div>

    <template v-else>
      <section class="visibility-summary" aria-label="Podsumowanie widoczności wizytówki">
        <div>
          <span class="visibility-summary__icon"><UIcon name="i-lucide-eye" /></span>
          <div>
            <p>Widoczność danych</p>
            <h2>Wiesz dokładnie, co trafia do klienta</h2>
          </div>
        </div>
        <div class="visibility-summary__badges">
          <UBadge color="primary" variant="subtle" icon="i-lucide-lock-keyhole">
            Portal przypisanych klientów
          </UBadge>
          <UBadge
            :color="directoryStatusMeta.color"
            variant="subtle"
            :icon="directoryStatusMeta.icon"
          >
            {{ directoryStatusMeta.label }}
          </UBadge>
        </div>
      </section>

      <div class="account-card-layout">
        <section class="account-settings-panel">
          <header class="account-panel-header">
            <div>
              <p>Profil w tej organizacji</p>
              <h2>Dane widoczne dla klienta</h2>
              <span>Nazwa, tytuł i zdjęcie tworzą kartę w portalu. E-mail i telefon są udostępniane przypisanym klientom.</span>
            </div>
            <UBadge v-if="isDirty" color="warning" variant="subtle">Niezapisane</UBadge>
          </header>

          <form class="account-profile-form" @submit.prevent="saveProfile">
            <fieldset :disabled="!canEdit || saving">
              <div class="account-profile-form__grid">
                <UFormField label="Imię i nazwisko" name="expertName" required>
                  <UInput
                    v-model="draft.expertName"
                    class="w-full"
                    maxlength="100"
                    autocomplete="name"
                  />
                </UFormField>
                <UFormField label="Tytuł zawodowy" name="professionalTitle">
                  <UInput
                    v-model="draft.professionalTitle"
                    class="w-full"
                    maxlength="100"
                    placeholder="Ekspert kredytowy"
                  />
                </UFormField>
                <UFormField
                  label="E-mail kontaktowy"
                  name="email"
                  description="Nie zmienia adresu używanego do logowania."
                >
                  <UInput
                    v-model="draft.email"
                    class="w-full"
                    type="email"
                    maxlength="160"
                    autocomplete="email"
                    icon="i-lucide-mail"
                  />
                </UFormField>
                <UFormField label="Telefon kontaktowy" name="phone">
                  <UInput
                    v-model="draft.phone"
                    class="w-full"
                    type="tel"
                    maxlength="40"
                    autocomplete="tel"
                    icon="i-lucide-phone"
                    placeholder="+48 500 000 000"
                  />
                </UFormField>
              </div>

              <div class="portrait-editor">
                <div class="portrait-editor__copy">
                  <h3>Zdjęcie w portalu klienta</h3>
                  <p>Dodaj pionowy portret JPG, PNG lub WebP do 5 MB. Zdjęcie dotyczy tej organizacji.</p>
                </div>
                <div class="portrait-editor__control">
                  <UAvatar
                    :src="draft.portraitUrl || undefined"
                    :alt="draft.expertName"
                    :text="portalInitials || 'OE'"
                    size="3xl"
                  />
                  <input
                    ref="portraitInput"
                    class="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    aria-label="Wybierz zdjęcie eksperta"
                    @change="uploadPortrait"
                  >
                  <div>
                    <UButton
                      type="button"
                      color="neutral"
                      variant="outline"
                      icon="i-lucide-upload"
                      :loading="uploadingPortrait"
                      @click="choosePortrait"
                    >
                      {{ draft.portraitUrl ? 'Zmień zdjęcie' : 'Dodaj zdjęcie' }}
                    </UButton>
                    <UButton
                      v-if="draft.portraitUrl"
                      type="button"
                      color="error"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      :loading="deletingPortrait"
                      @click="removePortrait"
                    >
                      Usuń
                    </UButton>
                  </div>
                </div>
              </div>
            </fieldset>

            <div class="account-profile-form__footer">
              <p>
                Bio, specjalizacje, lokalizacja i hasło komunikacyjne pozostają danymi materiałów — nie są dziś publikowane klientom.
              </p>
              <div>
                <UButton
                  v-if="isDirty"
                  type="button"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-undo-2"
                  @click="discardChanges"
                >
                  Odrzuć
                </UButton>
                <UButton
                  type="submit"
                  color="neutral"
                  variant="solid"
                  icon="i-lucide-save"
                  :loading="saving"
                  :disabled="!canEdit || !isDirty"
                >
                  Zapisz wizytówkę
                </UButton>
              </div>
            </div>
          </form>
        </section>

        <aside class="account-preview-stack" aria-label="Podglądy wizytówki">
          <section class="preview-panel">
            <header class="preview-panel__header">
              <div>
                <p>Portal klienta</p>
                <h2>Tak widzi Cię przypisany klient</h2>
              </div>
              <UBadge color="primary" variant="subtle" icon="i-lucide-lock-keyhole">Po zalogowaniu</UBadge>
            </header>

            <article class="portal-card-preview">
              <div class="portal-card-preview__label">
                <span>TWÓJ EKSPERT</span>
                <UIcon name="i-lucide-badge-check" />
              </div>
              <div class="portal-card-preview__identity">
                <span class="portal-card-preview__avatar">
                  <img v-if="portalCard.avatarUrl" :src="portalCard.avatarUrl" alt="">
                  <template v-else>{{ portalInitials || 'OE' }}</template>
                </span>
                <div>
                  <h3>{{ portalCard.name }}</h3>
                  <p>{{ portalCard.professionalTitle }}</p>
                </div>
              </div>
              <span class="portal-card-preview__button">
                <UIcon name="i-lucide-message-circle" />
                Przejdź do wiadomości
              </span>
            </article>

            <div class="shared-fields">
              <p>Udostępniane portalowi</p>
              <ul>
                <li><UIcon name="i-lucide-user-round" /><span>Imię i nazwisko</span><strong>{{ portalCard.name }}</strong></li>
                <li><UIcon name="i-lucide-briefcase-business" /><span>Tytuł</span><strong>{{ draft.professionalTitle || '—' }}</strong></li>
                <li><UIcon name="i-lucide-mail" /><span>E-mail</span><strong>{{ draft.email || 'Nie podano' }}</strong></li>
                <li><UIcon name="i-lucide-phone" /><span>Telefon</span><strong>{{ draft.phone || 'Nie podano' }}</strong></li>
              </ul>
            </div>
          </section>

          <section class="preview-panel">
            <header class="preview-panel__header">
              <div>
                <p>Otwarty katalog</p>
                <h2>Widoczność bez logowania</h2>
              </div>
              <UBadge
                :color="directoryStatusMeta.color"
                variant="subtle"
                :icon="directoryStatusMeta.icon"
              >
                {{ directoryStatusMeta.label }}
              </UBadge>
            </header>

            <article v-if="directoryCard" class="directory-card-preview">
              <header>
                <span class="directory-card-preview__avatar">
                  <img v-if="directoryCard.avatarUrl" :src="directoryCard.avatarUrl" alt="">
                  <template v-else>{{ directoryInitials || 'OE' }}</template>
                </span>
                <div>
                  <p>Ekspert OpenExpert</p>
                  <h3>{{ directoryCard.name }}</h3>
                </div>
              </header>
              <div class="directory-card-preview__body">
                <div class="directory-card-preview__location">
                  <UIcon name="i-lucide-landmark" />
                  <span>
                    <strong>{{ directoryCard.facility.name }}</strong>
                    <small v-if="directoryCard.facility.address">{{ directoryCard.facility.address }}</small>
                  </span>
                </div>
                <div>
                  <p class="directory-card-preview__caption">Zakres konsultacji</p>
                  <ul>
                    <li
                      v-for="service in directoryCard.services.slice(0, 4)"
                      :key="`${service.name}-${service.durationMinutes}`"
                    >
                      {{ service.name }}<span v-if="service.durationMinutes"> · {{ service.durationMinutes }} min</span>
                    </li>
                    <li v-if="directoryCard.services.length > 4">+{{ directoryCard.services.length - 4 }} więcej</li>
                  </ul>
                </div>
              </div>
              <footer>
                <span><UIcon name="i-lucide-calendar-days" />Wybierz dogodny termin</span>
                <span>Umów konsultację <UIcon name="i-lucide-arrow-right" /></span>
              </footer>
            </article>

            <div v-else-if="directoryStatus === 'facility_only'" class="directory-facility-only">
              <span><UIcon name="i-lucide-building-2" /></span>
              <div>
                <h3>Jesteś widoczny przy publicznej placówce</h3>
                <p>Nie masz osobnej karty na liście ekspertów, ale Twoje imię może pojawić się w zespole placówki.</p>
                <ul>
                  <li
                    v-for="facility in visibilityResponse?.directory.facilityAppearances"
                    :key="facility.id"
                  >
                    {{ facility.name }}
                  </li>
                </ul>
              </div>
            </div>

            <div v-else class="directory-empty-state">
              <span><UIcon name="i-lucide-eye-off" /></span>
              <div>
                <h3>Nie masz publicznej karty eksperta</h3>
                <p>Wpis pojawi się po udostępnieniu aktywnego widgetu kalendarza w katalogu OpenExpert.</p>
              </div>
            </div>

            <div class="preview-panel__actions">
              <UButton
                v-if="visibilityResponse?.directory.listed"
                :to="visibilityResponse.directory.directoryUrl"
                target="_blank"
                color="neutral"
                variant="outline"
                icon="i-lucide-external-link"
              >
                Otwórz katalog
              </UButton>
              <UButton
                :to="orgPath('/widgets')"
                color="neutral"
                variant="ghost"
                icon="i-lucide-settings-2"
              >
                Zarządzaj publikacją
              </UButton>
            </div>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.account-card-page {
  display: grid;
  gap: 18px;
}

.account-card-skeleton,
.account-card-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(360px, 0.92fr);
  gap: 20px;
  align-items: start;
}

.visibility-summary,
.account-settings-panel,
.preview-panel {
  border: 1px solid var(--ui-border);
  border-radius: calc(var(--ui-radius) * 1.25);
  background: var(--ui-bg);
}

.visibility-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;
}

.visibility-summary > div,
.visibility-summary__badges {
  display: flex;
  align-items: center;
  gap: 10px;
}

.visibility-summary__icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: var(--ui-radius);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
}

.visibility-summary p,
.account-panel-header p,
.preview-panel__header p,
.shared-fields > p {
  margin: 0 0 3px;
  color: var(--ui-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  line-height: 1.4;
  text-transform: uppercase;
}

.visibility-summary h2,
.account-panel-header h2,
.preview-panel__header h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.015em;
}

.account-preview-stack {
  display: grid;
  gap: 20px;
  min-width: 0;
}

.account-panel-header,
.preview-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 20px;
  border-bottom: 1px solid var(--ui-border-muted);
}

.account-panel-header span {
  display: block;
  max-width: 620px;
  margin-top: 7px;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.55;
}

.account-profile-form fieldset {
  min-width: 0;
  margin: 0;
  padding: 20px;
  border: 0;
}

.account-profile-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.portrait-editor {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: center;
  margin-top: 22px;
  padding-top: 20px;
  border-top: 1px solid var(--ui-border-muted);
}

.portrait-editor h3,
.directory-facility-only h3,
.directory-empty-state h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  font-weight: 650;
}

.portrait-editor p,
.directory-facility-only p,
.directory-empty-state p {
  margin: 5px 0 0;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.55;
}

.portrait-editor__control,
.portrait-editor__control > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.account-profile-form__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 20px;
  border-top: 1px solid var(--ui-border-muted);
  background: var(--ui-bg-muted);
}

.account-profile-form__footer p {
  max-width: 520px;
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.account-profile-form__footer > div,
.preview-panel__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.preview-panel {
  min-width: 0;
  overflow: hidden;
}

.portal-card-preview {
  display: grid;
  gap: 22px;
  margin: 20px;
  padding: 22px;
  border: 1px solid #e6e6e3;
  border-radius: 14px;
  background: #fff;
  color: #111;
  box-shadow: 0 10px 30px rgb(17 17 17 / 5%);
}

.portal-card-preview__label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #757575;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.1em;
}

.portal-card-preview__identity {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  align-items: center;
  gap: 14px;
}

.portal-card-preview__avatar,
.directory-card-preview__avatar {
  display: grid;
  overflow: hidden;
  place-items: center;
  border-radius: 50%;
  background: #111;
  color: #fff;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: 0.05em;
}

.portal-card-preview__avatar {
  width: 58px;
  height: 58px;
}

.portal-card-preview__avatar img,
.directory-card-preview__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.portal-card-preview__identity h3,
.directory-card-preview h3 {
  margin: 0;
  color: #111;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.025em;
}

.portal-card-preview__identity p {
  margin: 4px 0 0;
  color: #6f6f6f;
  font-size: 12px;
}

.portal-card-preview__button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  border: 1px solid #d7d7d3;
  border-radius: 8px;
  color: #222;
  font-size: 12px;
  font-weight: 600;
}

.shared-fields {
  padding: 0 20px 20px;
}

.shared-fields ul {
  display: grid;
  margin: 10px 0 0;
  padding: 0;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ui-radius);
  list-style: none;
}

.shared-fields li {
  display: grid;
  grid-template-columns: 18px 100px minmax(0, 1fr);
  gap: 9px;
  align-items: center;
  padding: 10px 12px;
  color: var(--ui-text-muted);
  font-size: 11px;
}

.shared-fields li + li {
  border-top: 1px solid var(--ui-border-muted);
}

.shared-fields li strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-weight: 550;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.directory-card-preview {
  display: grid;
  margin: 20px;
  border: 1px solid #cfcfca;
  border-radius: 6px;
  background: #fff;
  color: #111;
}

.directory-card-preview > header {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  padding: 20px;
  border-bottom: 1px solid #e2e2de;
}

.directory-card-preview__avatar {
  width: 54px;
  height: 54px;
}

.directory-card-preview > header p,
.directory-card-preview__caption {
  margin: 0 0 4px;
  color: #666;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.directory-card-preview__body {
  display: grid;
  gap: 18px;
  padding: 20px;
}

.directory-card-preview__location {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.directory-card-preview__location span {
  display: grid;
  gap: 3px;
}

.directory-card-preview__location strong {
  font-size: 12px;
  font-weight: 650;
}

.directory-card-preview__location small {
  color: #6d6d6d;
  font-size: 10px;
}

.directory-card-preview ul {
  display: grid;
  gap: 5px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.directory-card-preview li {
  color: #303030;
  font-size: 11px;
}

.directory-card-preview li span {
  color: #737373;
}

.directory-card-preview footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  border-top: 1px solid #e2e2de;
  background: #f7f7f4;
  font-size: 10px;
}

.directory-card-preview footer span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.directory-card-preview footer span:last-child {
  color: #111;
  font-weight: 650;
}

.directory-facility-only,
.directory-empty-state {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 14px;
  margin: 20px;
  padding: 18px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.directory-facility-only > span,
.directory-empty-state > span {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: var(--ui-radius);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-muted);
}

.directory-facility-only ul {
  margin: 8px 0 0;
  padding-left: 16px;
  color: var(--ui-text-toned);
  font-size: 11px;
}

.preview-panel__actions {
  justify-content: flex-end;
  padding: 0 20px 20px;
}

@media (max-width: 1180px) {
  .account-card-skeleton,
  .account-card-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .account-preview-stack {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .visibility-summary,
  .account-panel-header,
  .preview-panel__header,
  .account-profile-form__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .visibility-summary__badges,
  .account-profile-form__footer > div,
  .preview-panel__actions {
    flex-wrap: wrap;
  }

  .account-preview-stack,
  .account-profile-form__grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .portrait-editor {
    grid-template-columns: minmax(0, 1fr);
  }

  .portrait-editor__control {
    align-items: flex-start;
  }

  .portrait-editor__control > div {
    flex-wrap: wrap;
  }

  .account-profile-form__footer > div,
  .account-profile-form__footer :deep(button) {
    width: 100%;
  }

  .shared-fields li {
    grid-template-columns: 18px minmax(0, 1fr);
  }

  .shared-fields li strong {
    grid-column: 2;
    text-align: left;
  }

  .directory-card-preview footer {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
