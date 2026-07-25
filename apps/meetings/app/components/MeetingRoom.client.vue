<script setup lang="ts">
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client'

const props = defineProps<{
  serverUrl: string
  participantToken: string
  roomName: string
  initialAudio: boolean
  initialVideo: boolean
}>()

const emit = defineEmits<{
  leave: []
}>()

const toast = useToast()
const meetingRoot = ref<HTMLElement | null>(null)
const audioHost = ref<HTMLElement | null>(null)
const room = shallowRef<Room | null>(null)
const participants = shallowRef<Participant[]>([])
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
const remoteAudioElements = new Map<RemoteTrack, HTMLMediaElement>()
let elapsedTimer: ReturnType<typeof setInterval> | undefined
let disposed = false

const screenShareParticipant = computed(() => {
  void participantVersion.value
  return participants.value.find(participant => participant.isScreenShareEnabled)
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
    await navigator.clipboard.writeText(url.toString())
    toast.add({ title: 'Link skopiowany', icon: 'i-lucide-check', color: 'success' })
  } catch {
    toast.add({ title: 'Nie udało się skopiować linku', color: 'error' })
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

onMounted(() => {
  document.addEventListener('fullscreenchange', handleFullscreenChange)
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
  <section ref="meetingRoot" class="meeting-room">
    <header class="meeting-room__header">
      <div class="meeting-room__brand">
        <span class="brand-mark brand-mark--small">
          <UIcon name="i-lucide-sparkles" />
        </span>
        <div>
          <strong>OpenExpert Meet</strong>
          <span class="meeting-room__room-name">{{ roomName }}</span>
        </div>
      </div>

      <div class="meeting-room__status">
        <span
          class="meeting-room__live-dot"
          :class="`meeting-room__live-dot--${connectionTone}`"
        />
        <span>{{ elapsedLabel }}</span>
        <span class="meeting-room__status-separator" />
        <UIcon name="i-lucide-users" />
        <span>{{ participantCountLabel }}</span>
      </div>

      <div class="meeting-room__header-actions">
        <button
          type="button"
          class="meeting-icon-button"
          title="Skopiuj link"
          aria-label="Skopiuj link do spotkania"
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
        <UButton color="primary" icon="i-lucide-chevron-left" @click="leaveMeeting">
          Wróć do poczekalni
        </UButton>
      </div>

      <template v-else>
        <div v-if="screenShareParticipant" class="meeting-layout meeting-layout--screen">
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
          v-else
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
            <strong>Czekasz na pozostałych</strong>
            <p>Skopiuj link i otwórz go w drugiej przeglądarce lub oknie incognito.</p>
            <button type="button" @click="copyMeetingLink">
              <UIcon name="i-lucide-copy" />
              Kopiuj link
            </button>
          </div>
        </div>
      </template>
    </main>

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
          Połączenie szyfrowane
        </span>
      </div>
    </footer>

    <div ref="audioHost" class="meeting-room__audio-host" aria-hidden="true" />
  </section>
</template>
