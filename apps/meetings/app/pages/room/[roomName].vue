<script setup lang="ts">
import type { MeetingRole } from '#shared/utils/meeting'

interface TokenResponse {
  server_url: string
  participant_token: string
}

const route = useRoute()
const rawRoomName = computed(() => {
  const value = route.params.roomName
  return Array.isArray(value) ? String(value[0] || '') : String(value || '')
})
const roomName = computed(() => normalizeRoomName(rawRoomName.value))
const participantName = ref('')
const accessCode = ref('')
const startWithAudio = ref(true)
const startWithVideo = ref(true)
const isJoining = ref(false)
const joinError = ref('')
const credentials = shallowRef<TokenResponse | null>(null)
const isEmbedded = computed(() => route.query.embed === '1')
const meetingRole = computed<MeetingRole>(() => normalizeMeetingRole(route.query.role))
const isUiPreview = computed(() => route.query.preview === '1')
const isRoleTesting = computed(() => route.query.test === '1')
const toast = useToast()

useHead(() => ({
  title: roomName.value
    ? `${roomName.value} — OpenExpert Meet`
    : 'Nieprawidłowy pokój — OpenExpert Meet',
}))

onMounted(() => {
  participantName.value = sessionStorage.getItem(participantStorageKey(meetingRole.value))
    || sessionStorage.getItem('openexpert-meetings-name')
    || ''
  accessCode.value = sessionStorage.getItem('openexpert-meetings-access-code') || ''
})

function participantStorageKey(role: MeetingRole): string {
  return `openexpert-meetings-name-${role}`
}

async function setMeetingRole(role: MeetingRole): Promise<void> {
  const normalizedName = normalizeParticipantName(participantName.value)
  if (normalizedName) {
    sessionStorage.setItem(participantStorageKey(meetingRole.value), normalizedName)
  }

  await navigateTo({
    path: route.path,
    query: { ...route.query, role },
  }, { replace: true })

  if (!credentials.value) {
    participantName.value = sessionStorage.getItem(participantStorageKey(role)) || ''
  }
}

function tokenErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'Nie udało się uzyskać dostępu do spotkania.'
  }

  const responseError = error as {
    statusCode?: number
    status?: number
    data?: { statusMessage?: string, message?: string }
  }
  const status = responseError.statusCode || responseError.status

  if (status === 401) return 'Kod dostępu jest nieprawidłowy.'
  if (status === 400 || status === 403) return 'Ten pokój nie jest dostępny w konfiguracji serwera.'
  if (status === 503) return 'LiveKit nie został jeszcze skonfigurowany na serwerze.'
  return responseError.data?.statusMessage
    || responseError.data?.message
    || 'Nie udało się uzyskać dostępu do spotkania.'
}

async function joinMeeting(): Promise<void> {
  joinError.value = ''
  const normalizedName = normalizeParticipantName(participantName.value)

  if (!roomName.value) {
    joinError.value = 'Link do pokoju jest nieprawidłowy.'
    return
  }
  if (!normalizedName) {
    joinError.value = 'Podaj imię lub nazwę widoczną dla uczestników.'
    return
  }

  isJoining.value = true
  sessionStorage.setItem('openexpert-meetings-name', normalizedName)
  sessionStorage.setItem(participantStorageKey(meetingRole.value), normalizedName)
  sessionStorage.setItem('openexpert-meetings-access-code', accessCode.value)

  try {
    const response = await $fetch<TokenResponse>('/api/livekit/token', {
      method: 'POST',
      headers: {
        'X-Meetings-Access-Code': accessCode.value,
      },
      body: {
        room_name: roomName.value,
        participant_name: normalizedName,
      },
    })
    credentials.value = response
    accessCode.value = ''
    sessionStorage.removeItem('openexpert-meetings-access-code')
  } catch (error) {
    joinError.value = tokenErrorMessage(error)
  } finally {
    isJoining.value = false
  }
}

async function copyRoomLink(): Promise<void> {
  try {
    const url = new URL(route.path, window.location.origin)
    url.searchParams.set('role', 'client')
    await navigator.clipboard.writeText(url.toString())
    toast.add({ title: 'Link skopiowany', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Nie udało się skopiować linku', color: 'error' })
  }
}

async function returnToLobby(): Promise<void> {
  credentials.value = null
  if (isUiPreview.value) {
    const query = { ...route.query }
    delete query.preview
    await navigateTo({ path: route.path, query }, { replace: true })
  }
}
</script>

<template>
  <MeetingRoom
    v-if="(credentials || isUiPreview) && roomName"
    :server-url="credentials?.server_url || ''"
    :participant-token="credentials?.participant_token || ''"
    :room-name="roomName"
    :role="meetingRole"
    :initial-audio="startWithAudio"
    :initial-video="startWithVideo"
    :preview="isUiPreview"
    @role-change="setMeetingRole"
    @leave="returnToLobby"
  />

  <main v-else class="prejoin-shell" :class="{ 'prejoin-shell--embedded': isEmbedded }">
    <nav v-if="!isEmbedded" class="prejoin-nav">
      <NuxtLink to="/" class="landing-brand">
        <span class="brand-mark">
          <img src="/assets/logo-light.svg" alt="">
        </span>
        <span>
          <strong>OpenExpert</strong>
          <small>Meet</small>
        </span>
      </NuxtLink>

      <div class="prejoin-nav__actions">
        <div v-if="isRoleTesting" class="view-switch" aria-label="Testowany widok">
          <span>Podgląd</span>
          <button
            type="button"
            :class="{ 'is-active': meetingRole === 'expert' }"
            @click="setMeetingRole('expert')"
          >
            Ekspert
          </button>
          <button
            type="button"
            :class="{ 'is-active': meetingRole === 'client' }"
            @click="setMeetingRole('client')"
          >
            Klient
          </button>
        </div>

        <NuxtLink to="/" class="prejoin-nav__back">
          <UIcon name="i-lucide-chevron-left" />
          Zmień pokój
        </NuxtLink>
      </div>
    </nav>

    <section v-if="roomName" class="prejoin-content">
      <div class="prejoin-preview">
        <div class="prejoin-preview__camera">
          <span class="prejoin-preview__glow" />
          <div class="prejoin-preview__avatar">
            {{ participantName.trim().charAt(0).toUpperCase() || '?' }}
          </div>
          <div class="prejoin-preview__label">
            <span>{{ participantName || 'Twój podgląd' }}</span>
            <UIcon :name="startWithAudio ? 'i-lucide-mic' : 'i-lucide-mic-off'" />
          </div>
        </div>

        <div class="prejoin-preview__toggles">
          <button
            type="button"
            :class="{ 'is-off': !startWithAudio }"
            :aria-pressed="startWithAudio"
            @click="startWithAudio = !startWithAudio"
          >
            <UIcon :name="startWithAudio ? 'i-lucide-mic' : 'i-lucide-mic-off'" />
            {{ startWithAudio ? 'Mikrofon włączony' : 'Mikrofon wyłączony' }}
          </button>
          <button
            type="button"
            :class="{ 'is-off': !startWithVideo }"
            :aria-pressed="startWithVideo"
            @click="startWithVideo = !startWithVideo"
          >
            <UIcon :name="startWithVideo ? 'i-lucide-video' : 'i-lucide-video-off'" />
            {{ startWithVideo ? 'Kamera włączona' : 'Kamera wyłączona' }}
          </button>
        </div>
      </div>

      <form class="prejoin-panel" @submit.prevent="joinMeeting">
        <span class="role-eyebrow" :class="`role-eyebrow--${meetingRole}`">
          <UIcon :name="meetingRole === 'expert' ? 'i-lucide-briefcase-business' : 'i-lucide-user-round'" />
          {{ meetingRole === 'expert' ? 'Widok eksperta' : 'Widok klienta' }}
        </span>
        <h1>
          {{ meetingRole === 'expert' ? 'Rozpocznij konsultację' : 'Dołącz do konsultacji' }}
        </h1>
        <p class="prejoin-panel__intro">
          {{ meetingRole === 'expert'
            ? 'Po wejściu otrzymasz panel prowadzącego, listę uczestników i szybkie zaproszenie klienta.'
            : 'Po wejściu zobaczysz prosty widok rozmowy, bez narzędzi przeznaczonych dla prowadzącego.' }}
        </p>
        <p class="prejoin-panel__room">
          Pokój <strong>{{ roomName }}</strong>
          <button type="button" title="Kopiuj link" @click="copyRoomLink">
            <UIcon name="i-lucide-copy" />
          </button>
        </p>

        <div class="prejoin-panel__fields">
          <UFormField label="Nazwa uczestnika">
            <UInput
              v-model="participantName"
              class="w-full"
              autocomplete="name"
              icon="i-lucide-users"
              :placeholder="meetingRole === 'expert' ? 'np. Anna — ekspert' : 'np. Konrad'"
              required
            />
          </UFormField>

          <UFormField label="Kod dostępu">
            <UInput
              v-model="accessCode"
              class="w-full"
              type="password"
              autocomplete="off"
              icon="i-lucide-lock-keyhole"
              placeholder="Kod spotkania"
            />
          </UFormField>
        </div>

        <UAlert
          v-if="joinError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :description="joinError"
        />

        <UButton
          type="submit"
          color="primary"
          variant="solid"
          size="lg"
          block
          icon="i-lucide-video"
          :loading="isJoining"
        >
          {{ meetingRole === 'expert' ? 'Rozpocznij spotkanie' : 'Dołącz do spotkania' }}
        </UButton>

        <p class="prejoin-panel__note">
          Przeglądarka poprosi o dostęp do wybranych urządzeń dopiero po dołączeniu.
        </p>
      </form>
    </section>

    <section v-else class="invalid-room">
      <span><UIcon name="i-lucide-circle-alert" /></span>
      <h1>Ten link jest nieprawidłowy</h1>
      <p>Nazwa pokoju może zawierać małe litery, cyfry i myślniki.</p>
      <UButton to="/" color="primary" variant="solid" icon="i-lucide-chevron-left">
        Wróć na stronę główną
      </UButton>
    </section>
  </main>
</template>
