<script setup lang="ts">
import {
  Track,
  type LocalVideoTrack,
  type Participant,
  type RemoteVideoTrack,
} from 'livekit-client'

const props = withDefaults(defineProps<{
  participant: Participant
  version: number
  source?: Track.Source
  compact?: boolean
}>(), {
  source: Track.Source.Camera,
  compact: false,
})

const videoElement = ref<HTMLVideoElement | null>(null)
let attachedTrack: LocalVideoTrack | RemoteVideoTrack | undefined

const publication = computed(() => {
  void props.version
  return props.participant.getTrackPublication(props.source)
})

const displayName = computed(() => {
  void props.version
  return props.participant.name || props.participant.identity || 'Uczestnik'
})

const initials = computed(() => displayName.value
  .split(/\s+/u)
  .slice(0, 2)
  .map(part => [...part][0] || '')
  .join('')
  .toUpperCase())

const isVideoVisible = computed(() => Boolean(
  publication.value?.videoTrack && !publication.value.isMuted,
))

const isMicrophoneEnabled = computed(() => {
  void props.version
  return props.participant.isMicrophoneEnabled
})

const isSpeaking = computed(() => {
  void props.version
  return props.participant.isSpeaking
})

const avatarStyle = computed(() => {
  let hash = 0
  for (const character of displayName.value) {
    hash = ((hash << 5) - hash + character.codePointAt(0)!) | 0
  }

  return { '--participant-hue': String(Math.abs(hash) % 360) }
})

function detachVideo(): void {
  if (attachedTrack && videoElement.value) {
    attachedTrack.detach(videoElement.value)
  }
  attachedTrack = undefined
}

async function attachVideo(): Promise<void> {
  await nextTick()
  const nextTrack = publication.value?.videoTrack

  if (nextTrack === attachedTrack) return
  detachVideo()

  if (nextTrack && videoElement.value) {
    nextTrack.attach(videoElement.value)
    attachedTrack = nextTrack
  }
}

watch(
  () => [props.participant, props.source, props.version] as const,
  () => {
    void attachVideo()
  },
  { immediate: true, flush: 'post' },
)

onMounted(() => {
  void attachVideo()
})

onBeforeUnmount(detachVideo)
</script>

<template>
  <article
    class="participant-tile"
    :class="{
      'participant-tile--compact': compact,
      'participant-tile--speaking': isSpeaking,
      'participant-tile--screen': source === Track.Source.ScreenShare,
    }"
  >
    <video
      ref="videoElement"
      class="participant-tile__video"
      :class="{
        'participant-tile__video--inactive': !isVideoVisible,
        'participant-tile__video--local': participant.isLocal,
      }"
      autoplay
      playsinline
      :muted="participant.isLocal"
    />

    <Transition name="participant-fallback">
      <div
        v-if="!isVideoVisible"
        class="participant-tile__fallback"
        :style="avatarStyle"
      >
        <span class="participant-tile__avatar">{{ initials }}</span>
      </div>
    </Transition>

    <div class="participant-tile__scrim" />

    <div class="participant-tile__meta">
      <span class="participant-tile__name">
        {{ displayName }}
        <span v-if="participant.isLocal" class="participant-tile__you">(Ty)</span>
      </span>
      <span
        class="participant-tile__audio"
        :class="{ 'participant-tile__audio--muted': !isMicrophoneEnabled }"
        :title="isMicrophoneEnabled ? 'Mikrofon włączony' : 'Mikrofon wyłączony'"
      >
        <UIcon :name="isMicrophoneEnabled ? 'i-lucide-mic' : 'i-lucide-mic-off'" />
      </span>
    </div>

    <span v-if="isSpeaking" class="participant-tile__speaking">
      Mówi
    </span>
  </article>
</template>

<style scoped>
.participant-tile__video {
  opacity: 1;
  transition: opacity 160ms var(--ease-oe, cubic-bezier(0.2, 0, 0, 1));
}

.participant-tile__video--inactive {
  opacity: 0;
  transition: opacity 100ms var(--ease-oe-exit, cubic-bezier(0.4, 0, 1, 1));
}

.participant-fallback-enter-active {
  transition: opacity 160ms var(--ease-oe, cubic-bezier(0.2, 0, 0, 1));
}

.participant-fallback-leave-active {
  transition: opacity 100ms var(--ease-oe-exit, cubic-bezier(0.4, 0, 1, 1));
}

.participant-fallback-enter-from,
.participant-fallback-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .participant-tile__video,
  .participant-tile__video--inactive,
  .participant-fallback-enter-active,
  .participant-fallback-leave-active {
    transition: opacity 120ms var(--ease-oe, cubic-bezier(0.2, 0, 0, 1));
  }
}
</style>
