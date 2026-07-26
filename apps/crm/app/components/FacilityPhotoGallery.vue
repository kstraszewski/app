<script setup lang="ts">
import type { FacilityImage, FacilityImagesPayload } from '~/types/scheduling'
import { apiErrorMessage } from '~/utils/api-error'

const props = defineProps<{
  endpoint: string
  facilityName: string
  canManage: boolean
}>()

const toast = useToast()
const pendingFiles = ref<File[]>([])
const uploading = ref(false)
const deleting = ref(false)
const selectingCoverId = ref('')
const imageToDelete = ref<FacilityImage | null>(null)

const { data: payload, status, error, refresh } = await useFetch<FacilityImagesPayload>(
  () => props.endpoint,
  {
    default: (): FacilityImagesPayload => ({ data: [], limit: 12 }),
    watch: [() => props.endpoint],
  },
)

const images = computed(() => payload.value.data)
const remainingSlots = computed(() => Math.max(0, payload.value.limit - images.value.length))
const deleteImageDescription = computed(() => {
  const isCover = imageToDelete.value?.id === images.value[0]?.id
  if (!isCover) return 'Zdjęcie zostanie trwale usunięte z galerii placówki.'
  if (images.value.length === 1) {
    return 'Zdjęcie zostanie trwale usunięte, a placówka pozostanie bez miniatury.'
  }
  return 'Zdjęcie zostanie trwale usunięte. Kolejne zdjęcie w galerii stanie się główne.'
})

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function uploadImages() {
  if (
    !props.canManage
    || uploading.value
    || deleting.value
    || selectingCoverId.value
    || !pendingFiles.value.length
  ) return
  const accepted = pendingFiles.value.slice(0, remainingSlots.value)
  if (pendingFiles.value.length > remainingSlots.value) {
    toast.add({
      title: 'Część zdjęć nie zostanie dodana',
      description: `Placówka może mieć maksymalnie ${payload.value.limit} zdjęć.`,
      color: 'warning',
      icon: 'i-lucide-images',
    })
  }

  uploading.value = true
  let uploadedCount = 0
  const failures: string[] = []
  try {
    for (const file of accepted) {
      if (file.size > 8 * 1024 * 1024) {
        failures.push(`${file.name}: plik przekracza 8 MB`)
        continue
      }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        failures.push(`${file.name}: nieobsługiwany format`)
        continue
      }

      const formData = new FormData()
      formData.append('image', file)
      try {
        await $fetch(props.endpoint, {
          method: 'POST',
          body: formData,
        })
        uploadedCount += 1
      } catch (uploadError: unknown) {
        failures.push(`${file.name}: ${apiErrorMessage(uploadError)}`)
      }
    }

    pendingFiles.value = []
    await refresh()
    if (uploadedCount) {
      toast.add({
        title: uploadedCount === 1 ? 'Zdjęcie zostało dodane' : `Dodano ${uploadedCount} zdjęcia`,
        description: 'Pliki zostały zoptymalizowane i zapisane w galerii placówki.',
        color: 'success',
        icon: 'i-lucide-image-plus',
      })
    }
    if (failures.length) {
      toast.add({
        title: 'Nie wszystkie zdjęcia udało się dodać',
        description: failures.slice(0, 3).join(' · '),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
    }
  } finally {
    uploading.value = false
  }
}

async function deleteImage() {
  if (
    !props.canManage
    || !imageToDelete.value
    || deleting.value
    || uploading.value
    || selectingCoverId.value
  ) return
  deleting.value = true
  try {
    await $fetch(`${props.endpoint}/${encodeURIComponent(imageToDelete.value.id)}`, {
      method: 'DELETE',
    })
    imageToDelete.value = null
    await refresh()
    toast.add({
      title: 'Zdjęcie zostało usunięte',
      color: 'success',
      icon: 'i-lucide-trash-2',
    })
  } catch (deleteError: unknown) {
    toast.add({
      title: 'Nie udało się usunąć zdjęcia',
      description: apiErrorMessage(deleteError),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    deleting.value = false
  }
}

async function setCoverImage(image: FacilityImage) {
  if (
    !props.canManage
    || selectingCoverId.value
    || deleting.value
    || uploading.value
    || images.value[0]?.id === image.id
  ) return

  selectingCoverId.value = image.id
  try {
    await $fetch(`${props.endpoint}/${encodeURIComponent(image.id)}`, {
      method: 'PATCH',
      body: { isCover: true },
    })
    await refresh()
    toast.add({
      title: 'Ustawiono zdjęcie główne',
      description: 'To zdjęcie będzie używane jako miniatura placówki na listach.',
      color: 'success',
      icon: 'i-lucide-star',
    })
  } catch (coverError: unknown) {
    toast.add({
      title: 'Nie udało się ustawić zdjęcia głównego',
      description: apiErrorMessage(coverError),
      color: 'error',
      icon: 'i-lucide-circle-alert',
    })
  } finally {
    selectingCoverId.value = ''
  }
}
</script>

<template>
  <section class="facility-photos" aria-labelledby="facility-photos-title">
    <div class="facility-photos__heading">
      <div>
        <h4 id="facility-photos-title">Zdjęcia placówki</h4>
        <p>
          Wybierz zdjęcie główne — będzie miniaturą placówki na listach. Pozostałe zdjęcia tworzą galerię.
        </p>
      </div>
      <UBadge color="neutral" variant="subtle" icon="i-lucide-images">
        {{ images.length }} / {{ payload.limit }}
      </UBadge>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Nie udało się pobrać zdjęć"
      :description="apiErrorMessage(error)"
      :actions="[{ label: 'Ponów', onClick: () => refresh() }]"
    />

    <div v-else-if="status === 'pending'" class="facility-photos__grid">
      <USkeleton v-for="index in 3" :key="index" class="facility-photos__skeleton" />
    </div>

    <div v-else-if="images.length" class="facility-photos__grid">
      <article
        v-for="(image, index) in images"
        :key="image.id"
        class="facility-photo"
      >
        <UBadge
          v-if="index === 0"
          class="facility-photo__cover-badge"
          color="primary"
          variant="solid"
          icon="i-lucide-star"
        >
          Zdjęcie główne
        </UBadge>
        <a
          v-if="image.url"
          :href="image.url"
          target="_blank"
          rel="noopener noreferrer"
          class="facility-photo__preview"
          :aria-label="`Otwórz zdjęcie: ${image.original_filename}`"
        >
          <img
            :src="image.url"
            :alt="image.alt_text || `${facilityName} — zdjęcie placówki`"
            loading="lazy"
          >
        </a>
        <div v-else class="facility-photo__preview facility-photo__preview--missing">
          <UIcon name="i-lucide-image-off" />
        </div>
        <div class="facility-photo__meta">
          <div class="facility-photo__copy">
            <strong>{{ image.original_filename }}</strong>
            <small>{{ image.width_px }} × {{ image.height_px }} · {{ formatFileSize(image.size_bytes) }}</small>
          </div>
          <div v-if="canManage" class="facility-photo__actions">
            <UButton
              v-if="index !== 0"
              color="neutral"
              variant="soft"
              size="xs"
              icon="i-lucide-star"
              :loading="selectingCoverId === image.id"
              :disabled="uploading || deleting || Boolean(selectingCoverId)"
              :aria-label="`Ustaw zdjęcie ${image.original_filename} jako główne`"
              @click="setCoverImage(image)"
            >
              Ustaw jako główne
            </UButton>
            <UButton
              color="error"
              variant="ghost"
              icon="i-lucide-trash-2"
              square
              :disabled="uploading || deleting || Boolean(selectingCoverId)"
              :aria-label="`Usuń zdjęcie ${image.original_filename}`"
              @click="imageToDelete = image"
            />
          </div>
        </div>
      </article>
    </div>

    <div v-else class="facility-photos__empty">
      <span><UIcon name="i-lucide-images" /></span>
      <div>
        <strong>Placówka nie ma jeszcze zdjęć</strong>
        <p>Dodaj zdjęcia wejścia, recepcji lub przestrzeni spotkań.</p>
      </div>
    </div>

    <div v-if="canManage && remainingSlots" class="facility-photos__upload">
      <UFileUpload
        v-model="pendingFiles"
        multiple
        reset
        accept="image/jpeg,image/png,image/webp"
        icon="i-lucide-image-plus"
        label="Wybierz lub przeciągnij zdjęcia"
        description="JPEG, PNG lub WebP · maks. 8 MB na plik"
        layout="list"
        position="outside"
        :disabled="uploading || deleting || Boolean(selectingCoverId)"
        :ui="{ base: 'min-h-32', files: 'mt-3' }"
      />
      <div v-if="pendingFiles.length" class="facility-photos__upload-actions">
        <span>{{ pendingFiles.length }} {{ pendingFiles.length === 1 ? 'plik gotowy' : 'pliki gotowe' }}</span>
        <UButton
          icon="i-lucide-upload"
          :loading="uploading"
          :disabled="deleting || Boolean(selectingCoverId)"
          @click="uploadImages"
        >
          Dodaj do galerii
        </UButton>
      </div>
    </div>

    <UAlert
      v-else-if="canManage"
      color="neutral"
      variant="subtle"
      icon="i-lucide-image-check"
      title="Galeria jest pełna"
      :description="`Placówka może mieć maksymalnie ${payload.limit} zdjęć.`"
    />

    <UModal
      :open="Boolean(imageToDelete)"
      title="Usunąć zdjęcie?"
      :description="deleteImageDescription"
      :dismissible="!deleting"
      :close="{ disabled: deleting }"
      :ui="{ footer: 'justify-end' }"
      @update:open="(open) => { if (!open && !deleting) imageToDelete = null }"
    >
      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="deleting"
          @click="imageToDelete = null"
        >
          Anuluj
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          :loading="deleting"
          @click="deleteImage"
        >
          Usuń zdjęcie
        </UButton>
      </template>
    </UModal>
  </section>
</template>

<style scoped>
.facility-photos {
  display: grid;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg-muted);
}

.facility-photos__heading,
.facility-photo__meta,
.facility-photos__upload-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.facility-photos__heading {
  align-items: flex-start;
}

.facility-photos__heading h4,
.facility-photos__heading p,
.facility-photos__empty strong,
.facility-photos__empty p,
.facility-photo__meta strong,
.facility-photo__meta small {
  margin: 0;
}

.facility-photos__heading h4,
.facility-photos__empty strong,
.facility-photo__meta strong {
  color: var(--ui-text-highlighted);
}

.facility-photos__heading h4 {
  font-size: 16px;
}

.facility-photos__heading p,
.facility-photos__empty p,
.facility-photo__meta small,
.facility-photos__upload-actions {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.facility-photos__heading p,
.facility-photos__empty p {
  margin-top: 4px;
}

.facility-photos__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.facility-photos__skeleton,
.facility-photo__preview {
  aspect-ratio: 4 / 3;
}

.facility-photo {
  position: relative;
  overflow: hidden;
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-bg);
}

.facility-photo__cover-badge {
  position: absolute;
  z-index: 1;
  top: 10px;
  left: 10px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 24%);
}

.facility-photo__preview {
  display: grid;
  overflow: hidden;
  place-items: center;
  background: var(--ui-bg-elevated);
}

.facility-photo__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--oe-motion-medium);
}

.facility-photo__preview:hover img {
  transform: scale(1.025);
}

.facility-photo__preview--missing {
  color: var(--ui-text-muted);
}

.facility-photo__meta {
  padding: 10px 12px;
}

.facility-photo__copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.facility-photo__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.facility-photo__meta strong,
.facility-photo__meta small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.facility-photo__meta strong {
  font-size: 12px;
}

.facility-photos__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 92px;
  padding: 16px;
  border: 1px dashed var(--ui-border-accented);
  border-radius: var(--ui-radius);
}

.facility-photos__empty > span {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  flex: none;
  border: 1px solid var(--ui-border);
  border-radius: 11px;
  background: var(--ui-bg);
  color: var(--ui-text-muted);
}

.facility-photos__upload {
  padding-top: 4px;
}

.facility-photos__upload-actions {
  padding-top: 12px;
}

@media (max-width: 900px) {
  .facility-photos__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .facility-photos {
    padding: 16px;
  }

  .facility-photos__grid {
    grid-template-columns: 1fr;
  }

  .facility-photos__heading,
  .facility-photos__upload-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .facility-photo__meta {
    align-items: flex-start;
  }

  .facility-photo__actions {
    align-items: flex-end;
    flex-direction: column;
  }

  .facility-photo__actions :deep(button) {
    min-width: 44px;
    min-height: 44px;
  }
}
</style>
