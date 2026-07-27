<script setup lang="ts">
import type { DirectoryFacilityGalleryImage } from '#shared/types/directory'

const props = defineProps<{
  facilityName: string
  images: DirectoryFacilityGalleryImage[]
}>()

const activeIndex = ref(0)
const lightbox = useTemplateRef<HTMLDialogElement>('lightbox')

const activeImage = computed(() => props.images[activeIndex.value] ?? null)
const visibleThumbnails = computed(() => props.images.slice(0, 4))

watch(
  () => props.images,
  () => {
    activeIndex.value = 0
  },
)

function selectImage(index: number) {
  activeIndex.value = Math.max(0, Math.min(index, props.images.length - 1))
}

function openLightbox() {
  if (!activeImage.value || !lightbox.value) return
  lightbox.value.showModal()
}

function closeLightbox() {
  lightbox.value?.close()
}

function showPrevious() {
  if (props.images.length < 2) return
  activeIndex.value = (activeIndex.value - 1 + props.images.length) % props.images.length
}

function showNext() {
  if (props.images.length < 2) return
  activeIndex.value = (activeIndex.value + 1) % props.images.length
}
</script>

<template>
  <section class="facility-gallery" :aria-label="`Galeria placówki ${facilityName}`">
    <button
      v-if="activeImage"
      type="button"
      class="facility-gallery__main"
      :aria-label="`Powiększ zdjęcie: ${activeImage.alt}`"
      @click="openLightbox"
    >
      <img
        :src="activeImage.fallbackUrl"
        :alt="activeImage.alt"
        width="1448"
        height="1086"
        fetchpriority="high"
        decoding="async"
      >
      <span>Powiększ zdjęcie</span>
    </button>

    <div v-else class="facility-gallery__empty" role="img" :aria-label="`Brak zdjęć placówki ${facilityName}`">
      <Icon name="lucide:landmark" aria-hidden="true" />
      <span>Zdjęcia placówki pojawią się wkrótce</span>
    </div>

    <div v-if="visibleThumbnails.length > 1" class="facility-gallery__thumbnails" aria-label="Wybierz zdjęcie">
      <button
        v-for="(image, index) in visibleThumbnails"
        :key="`${image.fallbackUrl}-${index}`"
        type="button"
        :aria-label="`Pokaż zdjęcie ${index + 1}: ${image.alt}`"
        :aria-pressed="index === activeIndex"
        @click="selectImage(index)"
      >
        <img
          :src="image.thumbnailUrl"
          :alt="image.alt"
          width="320"
          height="220"
          loading="lazy"
          decoding="async"
        >
      </button>
    </div>

    <dialog
      ref="lightbox"
      class="facility-gallery__lightbox"
      :aria-label="`Powiększona galeria placówki ${facilityName}`"
      @click.self="closeLightbox"
      @keydown.left.prevent="showPrevious"
      @keydown.right.prevent="showNext"
    >
      <div v-if="activeImage" class="facility-gallery__lightbox-inner">
        <button
          type="button"
          class="facility-gallery__lightbox-close"
          aria-label="Zamknij galerię"
          @click="closeLightbox"
        >
          <Icon name="lucide:x" aria-hidden="true" />
        </button>

        <button
          v-if="images.length > 1"
          type="button"
          class="facility-gallery__lightbox-control facility-gallery__lightbox-control--previous"
          aria-label="Poprzednie zdjęcie"
          @click="showPrevious"
        >
          <Icon name="lucide:arrow-left" aria-hidden="true" />
        </button>

        <img
          :src="activeImage.fallbackUrl"
          :alt="activeImage.alt"
          width="1448"
          height="1086"
        >

        <button
          v-if="images.length > 1"
          type="button"
          class="facility-gallery__lightbox-control facility-gallery__lightbox-control--next"
          aria-label="Następne zdjęcie"
          @click="showNext"
        >
          <Icon name="lucide:arrow-right" aria-hidden="true" />
        </button>

        <p aria-live="polite">
          {{ activeIndex + 1 }} / {{ images.length }} · {{ activeImage.alt }}
        </p>
      </div>
    </dialog>
  </section>
</template>

<style scoped>
.facility-gallery {
  min-width: 0;
}

.facility-gallery__main {
  position: relative;
  display: block;
  overflow: hidden;
  width: 100%;
  aspect-ratio: 1.75 / 1;
  border: 0;
  border-radius: 5px;
  padding: 0;
  background: #e8e7e3;
  color: #fff;
  cursor: zoom-in;
}

.facility-gallery__main img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 300ms ease-out;
}

.facility-gallery__main:hover img {
  transform: scale(1.012);
}

.facility-gallery__main > span {
  position: absolute;
  right: 16px;
  bottom: 16px;
  border-radius: 3px;
  padding: 8px 11px;
  background: rgb(0 0 0 / 74%);
  font-size: 11px;
  font-weight: 600;
}

.facility-gallery__thumbnails {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
  margin-top: 5px;
}

.facility-gallery__thumbnails button {
  overflow: hidden;
  aspect-ratio: 1.55 / 1;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0;
  background: #e8e7e3;
  cursor: pointer;
  opacity: 0.72;
  transition:
    border-color var(--transition-fast),
    opacity var(--transition-fast);
}

.facility-gallery__thumbnails button:hover,
.facility-gallery__thumbnails button[aria-pressed='true'] {
  border-color: #111;
  opacity: 1;
}

.facility-gallery__thumbnails img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.facility-gallery__empty {
  display: grid;
  min-height: 330px;
  place-items: center;
  align-content: center;
  gap: 12px;
  border: 1px solid #d4d3cf;
  border-radius: 5px;
  background: #efeeea;
  color: #696967;
  font-size: 13px;
}

.facility-gallery__empty :deep(svg) {
  width: 32px;
  height: 32px;
  stroke-width: 1.35;
}

.facility-gallery__lightbox {
  width: min(1180px, calc(100vw - 48px));
  max-width: none;
  max-height: calc(100dvh - 48px);
  overflow: visible;
  border: 0;
  padding: 0;
  background: transparent;
  color: #fff;
}

.facility-gallery__lightbox::backdrop {
  background: rgb(0 0 0 / 90%);
  backdrop-filter: blur(5px);
}

.facility-gallery__lightbox-inner {
  position: relative;
  display: grid;
  place-items: center;
}

.facility-gallery__lightbox img {
  display: block;
  max-width: 100%;
  max-height: calc(100dvh - 110px);
  border-radius: 3px;
  object-fit: contain;
}

.facility-gallery__lightbox p {
  margin-top: 12px;
  color: #ddd;
  font-size: 12px;
  text-align: center;
}

.facility-gallery__lightbox-close,
.facility-gallery__lightbox-control {
  position: absolute;
  z-index: 2;
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 62%);
  border-radius: 50%;
  background: rgb(0 0 0 / 74%);
  color: #fff;
  cursor: pointer;
}

.facility-gallery__lightbox-close {
  top: 12px;
  right: 12px;
}

.facility-gallery__lightbox-control {
  top: 50%;
  transform: translateY(-50%);
}

.facility-gallery__lightbox-control--previous {
  left: 12px;
}

.facility-gallery__lightbox-control--next {
  right: 12px;
}

.facility-gallery__lightbox :deep(svg) {
  width: 19px;
  height: 19px;
}

.facility-gallery :is(button):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

@media (max-width: 620px) {
  .facility-gallery__main {
    aspect-ratio: 1.34 / 1;
  }

  .facility-gallery__thumbnails {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .facility-gallery__thumbnails button:nth-child(n + 4) {
    display: none;
  }

  .facility-gallery__main > span {
    right: 10px;
    bottom: 10px;
  }

  .facility-gallery__lightbox {
    width: calc(100vw - 24px);
  }

  .facility-gallery__lightbox-control {
    width: 40px;
    height: 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .facility-gallery__main img,
  .facility-gallery__thumbnails button {
    transition: none;
  }

  .facility-gallery__main:hover img {
    transform: none;
  }
}
</style>
