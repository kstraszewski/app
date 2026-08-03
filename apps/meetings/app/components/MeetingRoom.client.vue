<script setup lang="ts">
import {
  normalizeMeetingLayoutMode,
  type MeetingLayoutMode,
  type MeetingRole,
} from '#shared/utils/meeting'
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  Participant as LiveKitParticipant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client'

const props = defineProps<{
  serverUrl: string
  participantToken: string
  roomName: string
  role: MeetingRole
  initialAudio: boolean
  initialVideo: boolean
  preview?: boolean
}>()

class PreviewParticipant extends LiveKitParticipant {
  readonly previewIsLocal: boolean

  constructor(sid: string, identity: string, name: string, isLocal: boolean) {
    super(sid, identity, name)
    this.previewIsLocal = isLocal
  }

  override get isLocal(): boolean {
    return this.previewIsLocal
  }

  override get isMicrophoneEnabled(): boolean {
    return true
  }
}

const emit = defineEmits<{
  leave: []
  roleChange: [role: MeetingRole]
}>()

const toast = useToast()
const meetingRoot = ref<HTMLElement | null>(null)
const audioHost = ref<HTMLElement | null>(null)
const room = shallowRef<Room | null>(null)
const participants = shallowRef<LiveKitParticipant[]>([])
const participantVersion = ref(0)
const connectionState = ref<ConnectionState>(ConnectionState.Disconnected)
const isConnecting = ref(true)
const isLeaving = ref(false)
const fatalError = ref('')
const mediaWarning = ref('')
const canPlaybackAudio = ref(true)
const microphoneEnabled = ref(false)
const cameraEnabled = ref(false)
const screenShareEnabled = ref(false)
const mediaOperation = ref<'microphone' | 'camera' | 'screen' | null>(null)
const isFullscreen = ref(false)
const elapsedSeconds = ref(0)
const meetingLayoutMode = ref<MeetingLayoutMode>('split')
const remoteAudioElements = new Map<RemoteTrack, HTMLMediaElement>()
const EXPERT_LAYOUT_STORAGE_KEY = 'openexpert-meetings-expert-layout'
let elapsedTimer: ReturnType<typeof setInterval> | undefined
let disposed = false

function createPreviewParticipants(role: MeetingRole): LiveKitParticipant[] {
  if (role === 'expert') {
    return [
      new PreviewParticipant('preview-expert', 'preview-expert', 'Anna Nowak', true),
      new PreviewParticipant('preview-client', 'preview-client', 'Jan Kowalski', false),
    ]
  }

  return [
    new PreviewParticipant('preview-client', 'preview-client', 'Jan Kowalski', true),
    new PreviewParticipant('preview-expert', 'preview-expert', 'Anna Nowak', false),
  ]
}

function setupPreview(): void {
  participants.value = createPreviewParticipants(props.role)
  participantVersion.value += 1
  connectionState.value = ConnectionState.Connected
  microphoneEnabled.value = true
  cameraEnabled.value = false
  isConnecting.value = false
  elapsedSeconds.value = 754
}

const screenShareParticipant = computed(() => {
  void participantVersion.value
  return participants.value.find(participant => participant.isScreenShareEnabled)
})

const isExpert = computed(() => props.role === 'expert')

const remoteParticipants = computed(() => {
  void participantVersion.value
  return participants.value.filter(participant => !participant.isLocal)
})

const expertFocusedParticipant = computed(() => remoteParticipants.value[0])

const expertFocusFilmstripParticipants = computed(() => {
  if (!expertFocusedParticipant.value) return []
  return participants.value.filter(participant => participant.isLocal)
})

const clientFeaturedParticipant = computed(() => (
  remoteParticipants.value[0] || participants.value.find(participant => participant.isLocal)
))

const clientFilmstripParticipants = computed(() => {
  const featured = clientFeaturedParticipant.value
  return participants.value.filter(participant => participant !== featured)
})

const participantCountLabel = computed(() => {
  const count = participants.value.length
  if (count === 1) return '1 uczestnik'
  if (count > 1 && count < 5) return `${count} uczestników`
  return `${count} uczestników`
})

const elapsedLabel = computed(() => {
  const hours = Math.floor(elapsedSeconds.value / 3600)
  const minutes = Math.floor((elapsedSeconds.value % 3600) / 60)
  const seconds = elapsedSeconds.value % 60
  const parts = [minutes, seconds].map(value => String(value).padStart(2, '0'))
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${parts.join(':')}`
    : parts.join(':')
})

const isReconnecting = computed(() => connectionState.value === ConnectionState.Reconnecting)
const connectionTone = computed(() => {
  if (fatalError.value || connectionState.value === ConnectionState.Disconnected) return 'offline'
  if (
    isConnecting.value
    || connectionState.value === ConnectionState.Connecting
    || isReconnecting.value
  ) return 'connecting'
  return 'live'
})

function syncRoomState(): void {
  const activeRoom = room.value
  if (!activeRoom) return

  participants.value = [
    activeRoom.localParticipant,
    ...activeRoom.remoteParticipants.values(),
  ]
  participantVersion.value += 1
  connectionState.value = activeRoom.state
  canPlaybackAudio.value = activeRoom.canPlaybackAudio
  microphoneEnabled.value = activeRoom.localParticipant.isMicrophoneEnabled
  cameraEnabled.value = activeRoom.localParticipant.isCameraEnabled
  screenShareEnabled.value = activeRoom.localParticipant.isScreenShareEnabled
}

function attachRemoteAudio(track: RemoteTrack): void {
  if (track.kind !== Track.Kind.Audio || remoteAudioElements.has(track)) return

  const element = track.attach()
  element.autoplay = true
  element.className = 'meeting-audio-track'
  audioHost.value?.appendChild(element)
  remoteAudioElements.set(track, element)
}

function detachRemoteAudio(track: RemoteTrack): void {
  const element = remoteAudioElements.get(track)
  if (!element) return

  track.detach(element)
  element.remove()
  remoteAudioElements.delete(track)
}

function onTrackSubscribed(
  track: RemoteTrack,
  _publication: RemoteTrackPublication,
  _participant: RemoteParticipant,
): void {
  attachRemoteAudio(track)
  syncRoomState()
}

function onTrackUnsubscribed(
  track: RemoteTrack,
  _publication: RemoteTrackPublication,
  _participant: RemoteParticipant,
): void {
  detachRemoteAudio(track)
  syncRoomState()
}

function describeMediaError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Przeglądarka nie otrzymała dostępu do kamery lub mikrofonu. Możesz włączyć je później.'
  }
  return 'Nie udało się uruchomić wybranego urządzenia. Sprawdź jego dostępność i uprawnienia przeglądarki.'
}

async function enableInitialMedia(activeRoom: Room): Promise<void> {
  if (!props.initialAudio && !props.initialVideo) return

  try {
    if (props.initialAudio && props.initialVideo) {
      await activeRoom.localParticipant.enableCameraAndMicrophone()
    } else if (props.initialAudio) {
      await activeRoom.localParticipant.setMicrophoneEnabled(true)
    } else {
      await activeRoom.localParticipant.setCameraEnabled(true)
    }
  } catch (error) {
    mediaWarning.value = describeMediaError(error)
  } finally {
    syncRoomState()
  }
}

async function setupRoom(): Promise<void> {
  const activeRoom = new Room({
    adaptiveStream: true,
    dynacast: true,
    disconnectOnPageLeave: true,
    videoCaptureDefaults: {
      resolution: VideoPresets.h720.resolution,
    },
  })

  room.value = activeRoom
  activeRoom
    .on(RoomEvent.ParticipantConnected, syncRoomState)
    .on(RoomEvent.ParticipantDisconnected, syncRoomState)
    .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
    .on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
    .on(RoomEvent.TrackPublished, syncRoomState)
    .on(RoomEvent.TrackUnpublished, syncRoomState)
    .on(RoomEvent.TrackMuted, syncRoomState)
    .on(RoomEvent.TrackUnmuted, syncRoomState)
    .on(RoomEvent.LocalTrackPublished, syncRoomState)
    .on(RoomEvent.LocalTrackUnpublished, syncRoomState)
    .on(RoomEvent.ActiveSpeakersChanged, syncRoomState)
    .on(RoomEvent.ConnectionQualityChanged, syncRoomState)
    .on(RoomEvent.AudioPlaybackStatusChanged, syncRoomState)
    .on(RoomEvent.Reconnecting, syncRoomState)
    .on(RoomEvent.Reconnected, syncRoomState)
    .on(RoomEvent.Disconnected, () => {
      syncRoomState()
      if (!isLeaving.value) {
        fatalError.value = 'Połączenie ze spotkaniem zostało zakończone.'
      }
    })

  syncRoomState()

  try {
    await activeRoom.connect(props.serverUrl, props.participantToken)
    if (disposed) return
    syncRoomState()
    await enableInitialMedia(activeRoom)
    if (disposed) return
    elapsedTimer = setInterval(() => {
      elapsedSeconds.value += 1
    }, 1000)
  } catch {
    if (!disposed) {
      fatalError.value = 'Nie udało się połączyć ze spotkaniem. Sprawdź konfigurację LiveKit i spróbuj ponownie.'
    }
  } finally {
    if (!disposed) isConnecting.value = false
  }
}

async function toggleMicrophone(): Promise<void> {
  if (props.preview) {
    microphoneEnabled.value = !microphoneEnabled.value
    return
  }

  const activeRoom = room.value
  if (!activeRoom || mediaOperation.value) return

  mediaOperation.value = 'microphone'
  try {
    await activeRoom.localParticipant.setMicrophoneEnabled(!microphoneEnabled.value)
  } catch (error) {
    toast.add({ title: 'Mikrofon', description: describeMediaError(error), color: 'error' })
  } finally {
    mediaOperation.value = null
    syncRoomState()
  }
}

async function toggleCamera(): Promise<void> {
  if (props.preview) {
    cameraEnabled.value = !cameraEnabled.value
    return
  }

  const activeRoom = room.value
  if (!activeRoom || mediaOperation.value) return

  mediaOperation.value = 'camera'
  try {
    await activeRoom.localParticipant.setCameraEnabled(!cameraEnabled.value)
  } catch (error) {
    toast.add({ title: 'Kamera', description: describeMediaError(error), color: 'error' })
  } finally {
    mediaOperation.value = null
    syncRoomState()
  }
}

async function toggleScreenShare(): Promise<void> {
  if (props.preview) {
    screenShareEnabled.value = !screenShareEnabled.value
    toast.add({
      title: screenShareEnabled.value ? 'Podgląd udostępniania włączony' : 'Podgląd udostępniania wyłączony',
      description: 'W trybie demo nie jest przechwytywany prawdziwy ekran.',
      color: 'neutral',
    })
    return
  }

  const activeRoom = room.value
  if (!activeRoom || mediaOperation.value) return

  mediaOperation.value = 'screen'
  try {
    await activeRoom.localParticipant.setScreenShareEnabled(!screenShareEnabled.value)
  } catch {
    toast.add({
      title: 'Udostępnianie ekranu',
      description: 'Udostępnianie nie zostało uruchomione.',
      color: 'neutral',
    })
  } finally {
    mediaOperation.value = null
    syncRoomState()
  }
}

async function enableAudioPlayback(): Promise<void> {
  const activeRoom = room.value
  if (!activeRoom) return
  await activeRoom.startAudio()
  syncRoomState()
}

async function copyMeetingLink(): Promise<void> {
  try {
    const url = new URL(window.location.href)
    url.searchParams.delete('embed')
    url.searchParams.delete('preview')
    url.searchParams.delete('test')
    url.searchParams.set('role', 'client')
    await navigator.clipboard.writeText(url.toString())
    toast.add({ title: 'Link dla klienta skopiowany', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Nie udało się skopiować linku', color: 'error' })
  }
}

function setMeetingLayoutMode(mode: MeetingLayoutMode): void {
  meetingLayoutMode.value = mode
  try {
    window.localStorage.setItem(EXPERT_LAYOUT_STORAGE_KEY, mode)
  } catch {
    // The layout still changes even when browser storage is unavailable.
  }
}

function restoreMeetingLayoutMode(): void {
  try {
    meetingLayoutMode.value = normalizeMeetingLayoutMode(
      window.localStorage.getItem(EXPERT_LAYOUT_STORAGE_KEY),
    )
  } catch {
    meetingLayoutMode.value = 'split'
  }
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) {
      await meetingRoot.value?.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  } catch {
    toast.add({ title: 'Tryb pełnoekranowy jest niedostępny', color: 'neutral' })
  }
}

function handleFullscreenChange(): void {
  isFullscreen.value = Boolean(document.fullscreenElement)
}

async function leaveMeeting(): Promise<void> {
  if (isLeaving.value) return
  isLeaving.value = true
  if (elapsedTimer) clearInterval(elapsedTimer)
  try {
    await room.value?.disconnect()
  } finally {
    emit('leave')
  }
}

watch(
  () => props.role,
  (role) => {
    if (!props.preview) return
    participants.value = createPreviewParticipants(role)
    participantVersion.value += 1
  },
)

onMounted(() => {
  restoreMeetingLayoutMode()
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  if (props.preview) {
    setupPreview()
    return
  }
  void setupRoom()
})

onBeforeUnmount(() => {
  disposed = true
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  if (elapsedTimer) clearInterval(elapsedTimer)
  for (const track of remoteAudioElements.keys()) {
    detachRemoteAudio(track)
  }
  room.value?.removeAllListeners()
  void room.value?.disconnect().catch(() => {})
})
</script>

<template>
  <section
    ref="meetingRoot"
    class="meeting-room"
    :class="`meeting-room--${role}`"
  >
    <header class="meeting-room__header">
      <div class="meeting-room__brand">
        <span class="brand-mark brand-mark--small">
          <img src="/assets/logo-light.svg" alt="">
        </span>
        <div>
          <strong>
            {{ isExpert ? 'OpenExpert · panel eksperta' : 'Spotkanie z ekspertem' }}
          </strong>
          <span class="meeting-room__room-name">{{ roomName }}</span>
        </div>
      </div>

      <div class="meeting-room__status">
        <span
          class="meeting-room__live-dot"
          :class="`meeting-room__live-dot--${connectionTone}`"
        />
        <span>{{ preview ? 'Tryb demo' : elapsedLabel }}</span>
        <span class="meeting-room__status-separator" />
        <UIcon name="i-lucide-users" />
        <span>{{ participantCountLabel }}</span>
      </div>

      <div class="meeting-room__header-actions">
        <div v-if="preview" class="meeting-view-toggle" aria-label="Testowany widok">
          <button
            type="button"
            :class="{ 'is-active': isExpert }"
            :aria-pressed="isExpert"
            @click="emit('roleChange', 'expert')"
          >
            <UIcon name="i-lucide-briefcase-business" />
            <span>Ekspert</span>
          </button>
          <button
            type="button"
            :class="{ 'is-active': !isExpert }"
            :aria-pressed="!isExpert"
            @click="emit('roleChange', 'client')"
          >
            <UIcon name="i-lucide-user-round" />
            <span>Klient</span>
          </button>
        </div>
        <div v-if="isExpert" class="meeting-layout-toggle" role="group" aria-label="Układ uczestników">
          <button
            type="button"
            :class="{ 'is-active': meetingLayoutMode === 'split' }"
            :aria-pressed="meetingLayoutMode === 'split'"
            aria-label="Układ 50 na 50"
            title="Układ 50/50"
            @click="setMeetingLayoutMode('split')"
          >
            <UIcon name="i-lucide-columns-2" />
            <span>50/50</span>
          </button>
          <button
            type="button"
            :class="{ 'is-active': meetingLayoutMode === 'focus' }"
            :aria-pressed="meetingLayoutMode === 'focus'"
            :disabled="remoteParticipants.length === 0"
            aria-label="Rozmówca i mój mini podgląd"
            :title="remoteParticipants.length ? 'Rozmówca i mój mini podgląd' : 'Ta opcja będzie dostępna, gdy klient dołączy'"
            @click="setMeetingLayoutMode('focus')"
          >
            <UIcon name="i-lucide-picture-in-picture-2" />
            <span>Mini podgląd</span>
          </button>
        </div>
        <button
          v-if="isExpert"
          type="button"
          class="meeting-icon-button"
          title="Skopiuj link dla klienta"
          aria-label="Skopiuj link dla klienta"
          @click="copyMeetingLink"
        >
          <UIcon name="i-lucide-link" />
        </button>
        <button
          type="button"
          class="meeting-icon-button"
          :title="isFullscreen ? 'Wyłącz pełny ekran' : 'Pełny ekran'"
          :aria-label="isFullscreen ? 'Wyłącz pełny ekran' : 'Włącz pełny ekran'"
          @click="toggleFullscreen"
        >
          <UIcon :name="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'" />
        </button>
      </div>
    </header>

    <div class="meeting-room__notices" aria-live="polite">
      <div v-if="isReconnecting" class="meeting-room__notice">
        <UIcon name="i-lucide-wifi" />
        Przywracamy połączenie…
      </div>

      <div v-if="mediaWarning" class="meeting-room__notice meeting-room__notice--warning">
        <UIcon name="i-lucide-circle-alert" />
        <span>{{ mediaWarning }}</span>
        <button type="button" aria-label="Zamknij komunikat" @click="mediaWarning = ''">×</button>
      </div>

      <div v-if="!canPlaybackAudio" class="meeting-room__notice meeting-room__notice--action">
        <UIcon name="i-lucide-volume-2" />
        <span>Przeglądarka wstrzymała dźwięk spotkania.</span>
        <button type="button" @click="enableAudioPlayback">Włącz dźwięk</button>
      </div>
    </div>

    <div class="meeting-room__workspace">
      <main class="meeting-room__stage">
        <div v-if="isConnecting" class="meeting-room__loading">
          <span class="meeting-room__loader" />
          <strong>Łączymy ze spotkaniem</strong>
          <p>To powinno potrwać tylko chwilę.</p>
        </div>

        <div v-else-if="fatalError" class="meeting-room__fatal">
          <span class="meeting-room__fatal-icon">
            <UIcon name="i-lucide-circle-alert" />
          </span>
          <h2>Nie udało się utrzymać połączenia</h2>
          <p>{{ fatalError }}</p>
          <UButton color="primary" variant="solid" icon="i-lucide-chevron-left" @click="leaveMeeting">
            Wróć do poczekalni
          </UButton>
        </div>

        <Transition v-else name="meeting-layout-swap">
          <div
            v-if="screenShareParticipant"
            key="screen-share"
            class="meeting-layout meeting-layout--screen"
          >
            <ParticipantTile
              :participant="screenShareParticipant"
              :version="participantVersion"
              :source="Track.Source.ScreenShare"
            />
            <aside class="meeting-layout__filmstrip">
              <ParticipantTile
                v-for="participant in participants"
                :key="participant.sid"
                :participant="participant"
                :version="participantVersion"
                compact
              />
            </aside>
          </div>

          <div
            v-else-if="isExpert && meetingLayoutMode === 'focus' && expertFocusedParticipant"
            key="expert-focus"
            class="meeting-layout meeting-layout--focus"
          >
            <ParticipantTile
              :participant="expertFocusedParticipant"
              :version="participantVersion"
            />

            <aside
              v-if="expertFocusFilmstripParticipants.length"
              class="meeting-layout__focus-filmstrip"
              aria-label="Mój mini podgląd"
            >
              <ParticipantTile
                v-for="participant in expertFocusFilmstripParticipants"
                :key="participant.sid"
                :participant="participant"
                :version="participantVersion"
                compact
              />
            </aside>
          </div>

          <div
            v-else-if="!isExpert"
            key="client"
            class="meeting-layout meeting-layout--client"
            :class="{ 'meeting-layout--client-waiting': remoteParticipants.length === 0 }"
          >
            <ParticipantTile
              v-if="clientFeaturedParticipant"
              :participant="clientFeaturedParticipant"
              :version="participantVersion"
            />

            <aside
              v-if="clientFilmstripParticipants.length"
              class="meeting-layout__client-filmstrip"
              aria-label="Pozostali uczestnicy"
            >
              <ParticipantTile
                v-for="participant in clientFilmstripParticipants"
                :key="participant.sid"
                :participant="participant"
                :version="participantVersion"
                compact
              />
            </aside>

            <div v-if="remoteParticipants.length === 0" class="meeting-room__client-waiting">
              <span><UIcon name="i-lucide-hourglass" /></span>
              <div>
                <strong>Ekspert zaraz dołączy</strong>
                <p>Możesz już sprawdzić mikrofon i kamerę. Spotkanie rozpocznie się automatycznie.</p>
              </div>
            </div>
          </div>

          <div
            v-else
            key="expert-split"
            class="meeting-layout meeting-layout--grid"
            :class="`meeting-layout--count-${Math.min(participants.length, 6)}`"
          >
            <ParticipantTile
              v-for="participant in participants"
              :key="participant.sid"
              :participant="participant"
              :version="participantVersion"
            />

            <div v-if="participants.length === 1" class="meeting-room__empty-seat">
              <span>
                <UIcon name="i-lucide-users" />
              </span>
              <strong>Czekasz na klienta</strong>
              <p>Wyślij klientowi bezpieczny link do tego spotkania.</p>
              <button type="button" @click="copyMeetingLink">
                <UIcon name="i-lucide-copy" />
                Kopiuj link dla klienta
              </button>
            </div>
          </div>
        </Transition>
      </main>

      <aside v-if="isExpert" class="expert-panel">
        <div class="expert-panel__header">
          <div>
            <span>Panel prowadzącego</span>
            <strong>Konsultacja online</strong>
          </div>
          <span class="expert-panel__live">Na żywo</span>
        </div>

        <section class="expert-panel__section">
          <div class="expert-panel__section-heading">
            <span>Uczestnicy</span>
            <small>{{ participants.length }}</small>
          </div>
          <div class="expert-panel__participants">
            <div
              v-for="participant in participants"
              :key="participant.sid"
              class="expert-participant"
            >
              <span>{{ (participant.name || participant.identity || '?').charAt(0).toUpperCase() }}</span>
              <div>
                <strong>{{ participant.name || participant.identity || 'Uczestnik' }}</strong>
                <small>{{ participant.isLocal ? 'Ty · ekspert' : 'Uczestnik spotkania' }}</small>
              </div>
              <UIcon
                :name="participant.isMicrophoneEnabled ? 'i-lucide-mic' : 'i-lucide-mic-off'"
                :class="{ 'is-muted': !participant.isMicrophoneEnabled }"
              />
            </div>
          </div>
        </section>

        <section class="expert-panel__invite">
          <span><UIcon name="i-lucide-user-round-plus" /></span>
          <div>
            <strong>Zaproś klienta</strong>
            <p>Link zawsze otwiera uproszczony widok klienta.</p>
          </div>
          <button type="button" @click="copyMeetingLink">
            <UIcon name="i-lucide-copy" />
            Kopiuj link
          </button>
        </section>

        <section class="expert-panel__details">
          <div>
            <span>Czas spotkania</span>
            <strong>{{ elapsedLabel }}</strong>
          </div>
          <div>
            <span>Pokój</span>
            <strong>{{ roomName }}</strong>
          </div>
        </section>

        <p v-if="preview" class="expert-panel__notice">
          <UIcon name="i-lucide-info" />
          Przełącznik roli służy do testów interfejsu i nie nadaje uprawnień administracyjnych.
        </p>
      </aside>
    </div>

    <footer class="meeting-room__toolbar">
      <div class="meeting-room__toolbar-spacer" />
      <div class="meeting-room__controls">
        <button
          type="button"
          class="meeting-control"
          :class="{ 'meeting-control--off': !microphoneEnabled }"
          :aria-pressed="microphoneEnabled"
          :disabled="Boolean(mediaOperation)"
          @click="toggleMicrophone"
        >
          <span><UIcon :name="microphoneEnabled ? 'i-lucide-mic' : 'i-lucide-mic-off'" /></span>
          <small>{{ microphoneEnabled ? 'Mikrofon' : 'Wyciszony' }}</small>
        </button>

        <button
          type="button"
          class="meeting-control"
          :class="{ 'meeting-control--off': !cameraEnabled }"
          :aria-pressed="cameraEnabled"
          :disabled="Boolean(mediaOperation)"
          @click="toggleCamera"
        >
          <span><UIcon :name="cameraEnabled ? 'i-lucide-video' : 'i-lucide-video-off'" /></span>
          <small>{{ cameraEnabled ? 'Kamera' : 'Wyłączona' }}</small>
        </button>

        <button
          v-if="isExpert"
          type="button"
          class="meeting-control"
          :class="{ 'meeting-control--active': screenShareEnabled }"
          :aria-pressed="screenShareEnabled"
          :disabled="Boolean(mediaOperation)"
          @click="toggleScreenShare"
        >
          <span><UIcon name="i-lucide-monitor-up" /></span>
          <small>{{ screenShareEnabled ? 'Udostępniasz' : 'Udostępnij' }}</small>
        </button>

        <button
          type="button"
          class="meeting-control meeting-control--leave"
          :disabled="isLeaving"
          @click="leaveMeeting"
        >
          <span><UIcon name="i-lucide-phone-off" /></span>
          <small>Zakończ</small>
        </button>
      </div>
      <div class="meeting-room__toolbar-spacer meeting-room__toolbar-spacer--right">
        <span class="meeting-room__secure">
          <UIcon name="i-lucide-shield-check" />
          {{ isExpert ? 'Tryb prowadzącego' : 'Bezpieczna konsultacja' }}
        </span>
      </div>
    </footer>

    <div ref="audioHost" class="meeting-room__audio-host" aria-hidden="true" />
  </section>
</template>
