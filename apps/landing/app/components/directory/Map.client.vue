<script lang="ts">
export interface DirectoryMapFacilityMarker {
  facilityId: string
  name: string
  address: string | null
  latitude: number
  longitude: number
  href?: string
  bookingHref?: string
}

export type DirectoryMapPresentation = 'compact' | 'detail'
</script>

<script setup lang="ts">
import type {
  Map as MapboxMap,
  Marker as MapboxMarker,
  NavigationControl as MapboxNavigationControl,
  Popup as MapboxPopup,
} from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const props = withDefaults(defineProps<{
  markers: readonly DirectoryMapFacilityMarker[]
  selectedFacilityId?: string | null
  presentation?: DirectoryMapPresentation
  height?: string
  ariaLabel?: string
}>(), {
  presentation: 'compact',
  ariaLabel: 'Mapa placówek OpenExpert',
})

const emit = defineEmits<{
  select: [facilityId: string]
  'update:selectedFacilityId': [facilityId: string]
  ready: []
  error: [message: string]
}>()

type MapStatus = 'idle' | 'loading' | 'ready' | 'error' | 'missing-token'

interface MarkerRecord {
  facility: DirectoryMapFacilityMarker
  marker: MapboxMarker
  popup: MapboxPopup
  element: HTMLElement
  handleClick: (event: MouseEvent) => void
  handleKeydown: (event: KeyboardEvent) => void
}

const runtimeConfig = useRuntimeConfig()
const openexpertConfig = runtimeConfig.public.openexpert as {
  mapboxAccessToken?: string
}
const accessToken = String(openexpertConfig.mapboxAccessToken ?? '').trim()

const mapContainer = useTemplateRef<HTMLElement>('mapContainer')
const instructionsId = useId()
const mapStatus = ref<MapStatus>(accessToken ? 'idle' : 'missing-token')
const hasMap = ref(false)
const errorMessage = ref('')
const liveMessage = ref('')
const internalSelectedFacilityId = ref<string | null>(
  props.selectedFacilityId ?? null,
)

let mapboxModule: typeof import('mapbox-gl').default | null = null
let map: MapboxMap | null = null
let navigationControl: MapboxNavigationControl | null = null
let markerRecords: MarkerRecord[] = []
let resizeObserver: ResizeObserver | null = null
let loadTimeout: ReturnType<typeof setTimeout> | null = null
let resizeFrame: number | null = null
let initializationId = 0
let isDisposed = false
let lastEmittedError = ''

const effectiveSelectedFacilityId = computed(() => (
  props.selectedFacilityId === undefined
    ? internalSelectedFacilityId.value
    : props.selectedFacilityId
))

const validMarkers = computed(() => {
  const facilityIds = new Set<string>()

  return props.markers.filter((facility) => {
    if (
      !facility.facilityId
      || facilityIds.has(facility.facilityId)
      || !Number.isFinite(facility.latitude)
      || !Number.isFinite(facility.longitude)
      || facility.latitude < -90
      || facility.latitude > 90
      || facility.longitude < -180
      || facility.longitude > 180
    ) {
      return false
    }

    facilityIds.add(facility.facilityId)
    return true
  })
})

const fallbackMarkers = computed(() => validMarkers.value.slice(0, 4))
const mapStyle = computed(() => (
  props.height ? { '--directory-map-height': props.height } : undefined
))
const fallbackVisible = computed(() => (
  mapStatus.value === 'missing-token'
  || (mapStatus.value === 'error' && !hasMap.value)
))

const statusTitle = computed(() => {
  if (mapStatus.value === 'missing-token') return 'Mapa nie jest jeszcze skonfigurowana'
  return 'Nie udało się wyświetlić mapy'
})

const statusDescription = computed(() => {
  if (mapStatus.value === 'missing-token') {
    return 'Adresy placówek pozostają dostępne poniżej.'
  }

  return errorMessage.value
    || 'Sprawdź połączenie i spróbuj ponownie.'
})

function markerAriaLabel(facility: DirectoryMapFacilityMarker) {
  return facility.address
    ? `Pokaż placówkę ${facility.name} na mapie. ${facility.address}`
    : `Pokaż placówkę ${facility.name} na mapie`
}

function clearLoadTimeout() {
  if (loadTimeout === null) return
  clearTimeout(loadTimeout)
  loadTimeout = null
}

function closePopups(exceptFacilityId?: string) {
  markerRecords.forEach((record) => {
    if (record.facility.facilityId !== exceptFacilityId) {
      record.popup.remove()
    }
  })
}

function localizePopupCloseButton(popup: MapboxPopup) {
  popup.getElement()
    ?.querySelector<HTMLButtonElement>('.mapboxgl-popup-close-button')
    ?.setAttribute('aria-label', 'Zamknij')
}

function updateMarkerSelection() {
  const selectedId = effectiveSelectedFacilityId.value

  markerRecords.forEach((record) => {
    const selected = record.facility.facilityId === selectedId
    record.element.classList.toggle('directory-map__marker--selected', selected)
    record.element.setAttribute('aria-pressed', String(selected))
    record.element.style.zIndex = selected ? '2' : '1'
  })
}

function revealSelectedMarker(moveCamera: boolean) {
  if (!map) return

  const selectedId = effectiveSelectedFacilityId.value
  updateMarkerSelection()

  if (!selectedId) {
    closePopups()
    return
  }

  const record = markerRecords.find(
    item => item.facility.facilityId === selectedId,
  )
  if (!record) return

  closePopups(selectedId)
  if (!record.popup.isOpen()) {
    record.popup
      .setLngLat([record.facility.longitude, record.facility.latitude])
      .addTo(map)
    localizePopupCloseButton(record.popup)
  }

  if (moveCamera) {
    map.easeTo({
      center: [record.facility.longitude, record.facility.latitude],
      zoom: Math.max(map.getZoom(), props.presentation === 'detail' ? 14 : 13),
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : 550,
      essential: false,
    })
  }
}

function selectMarker(record: MarkerRecord) {
  internalSelectedFacilityId.value = record.facility.facilityId
  closePopups(record.facility.facilityId)
  if (map && !record.popup.isOpen()) {
    record.popup
      .setLngLat([record.facility.longitude, record.facility.latitude])
      .addTo(map)
    localizePopupCloseButton(record.popup)
  }

  updateMarkerSelection()
  liveMessage.value = `Wybrano placówkę ${record.facility.name}.`
  emit('update:selectedFacilityId', record.facility.facilityId)
  emit('select', record.facility.facilityId)
}

function createPopupContent(facility: DirectoryMapFacilityMarker) {
  const content = document.createElement('div')
  content.className = [
    'directory-map-popup',
    `directory-map-popup--${props.presentation}`,
  ].join(' ')

  const eyebrow = document.createElement('span')
  eyebrow.className = 'directory-map-popup__eyebrow'
  eyebrow.textContent = 'Placówka OpenExpert'

  const name = document.createElement('strong')
  name.className = 'directory-map-popup__name'
  name.textContent = facility.name

  content.append(eyebrow, name)

  if (facility.address) {
    const address = document.createElement('span')
    address.className = 'directory-map-popup__address'
    address.textContent = facility.address
    content.append(address)
  }

  if (facility.href || facility.bookingHref) {
    const actions = document.createElement('div')
    actions.className = 'directory-map-popup__actions'

    if (facility.href) {
      const detailsLink = document.createElement('a')
      detailsLink.className = 'directory-map-popup__link'
      detailsLink.href = facility.href
      detailsLink.textContent = 'Zobacz placówkę'
      detailsLink.setAttribute(
        'aria-label',
        `Zobacz placówkę ${facility.name}`,
      )
      actions.append(detailsLink)
    }

    if (facility.bookingHref) {
      const bookingLink = document.createElement('a')
      bookingLink.className = 'directory-map-popup__link directory-map-popup__link--primary'
      bookingLink.href = facility.bookingHref
      bookingLink.textContent = 'Zobacz terminy'
      bookingLink.setAttribute(
        'aria-label',
        `Zobacz terminy w placówce ${facility.name}`,
      )
      actions.append(bookingLink)
    }

    content.append(actions)
  }

  return content
}

function destroyMarkers() {
  markerRecords.forEach((record) => {
    record.element.removeEventListener('click', record.handleClick)
    record.element.removeEventListener('keydown', record.handleKeydown)
    record.popup.remove()
    record.marker.remove()
  })
  markerRecords = []
}

function rebuildMarkers() {
  if (!map || !mapboxModule) return

  destroyMarkers()

  markerRecords = validMarkers.value.map((facility) => {
    const popup = new mapboxModule!.Popup({
      className: 'directory-map__popup',
      closeButton: true,
      closeOnClick: false,
      closeOnMove: false,
      focusAfterOpen: false,
      maxWidth: props.presentation === 'detail' ? '340px' : '290px',
      offset: props.presentation === 'detail' ? 31 : 27,
    }).setDOMContent(createPopupContent(facility))

    const marker = new mapboxModule!.Marker({
      className: 'directory-map__marker',
      color: '#111111',
      scale: props.presentation === 'detail' ? 0.92 : 0.82,
    })
      .setLngLat([facility.longitude, facility.latitude])
      .addTo(map!)

    const element = marker.getElement()
    element.setAttribute('role', 'button')
    element.setAttribute('tabindex', '0')
    element.setAttribute('aria-label', markerAriaLabel(facility))
    element.setAttribute('aria-pressed', 'false')

    const record = {
      facility,
      marker,
      popup,
      element,
      handleClick: (event: MouseEvent) => {
        event.stopPropagation()
        selectMarker(record)
      },
      handleKeydown: (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        selectMarker(record)
      },
    } satisfies MarkerRecord

    element.addEventListener('click', record.handleClick)
    element.addEventListener('keydown', record.handleKeydown)
    return record
  })

  updateMarkerSelection()
}

function fitBounds() {
  if (!map || !mapboxModule || validMarkers.value.length === 0) return

  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches
  const duration = prefersReducedMotion ? 0 : 650

  if (validMarkers.value.length === 1) {
    const facility = validMarkers.value[0]!
    map.easeTo({
      center: [facility.longitude, facility.latitude],
      zoom: props.presentation === 'detail' ? 14 : 13,
      duration,
      essential: false,
    })
    return
  }

  const bounds = new mapboxModule.LngLatBounds()
  validMarkers.value.forEach((facility) => {
    bounds.extend([facility.longitude, facility.latitude])
  })

  const containerWidth = mapContainer.value?.clientWidth ?? 0
  map.fitBounds(bounds, {
    padding: containerWidth < 640
      ? 42
      : props.presentation === 'detail' ? 72 : 56,
    maxZoom: 13,
    duration,
    essential: false,
  })
}

function scheduleFitBounds() {
  if (!map || mapStatus.value !== 'ready') return
  if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)

  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null
    map?.resize()
    fitBounds()
  })
}

function replaceNavigationControl() {
  if (!map || !mapboxModule) return

  if (navigationControl) {
    map.removeControl(navigationControl)
  }

  navigationControl = new mapboxModule.NavigationControl({
    showCompass: props.presentation === 'detail',
    showZoom: true,
    visualizePitch: false,
  })
  map.addControl(navigationControl, 'top-right')
}

function reportError(message: string, fatal: boolean) {
  errorMessage.value = message
  if (fatal) mapStatus.value = 'error'
  if (lastEmittedError === message) return

  lastEmittedError = message
  emit('error', message)
}

function cleanupMap() {
  clearLoadTimeout()

  if (resizeFrame !== null) {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = null
  }

  resizeObserver?.disconnect()
  resizeObserver = null
  destroyMarkers()
  navigationControl = null

  if (map) {
    map.remove()
    map = null
  }

  hasMap.value = false
}

async function initializeMap() {
  cleanupMap()
  const currentInitializationId = ++initializationId

  if (!accessToken) {
    mapStatus.value = 'missing-token'
    reportError('Brakuje klucza dostępu do mapy.', false)
    return
  }

  if (!mapContainer.value) return

  mapStatus.value = 'loading'
  errorMessage.value = ''
  lastEmittedError = ''

  try {
    const importedMapbox = await import('mapbox-gl')
    if (isDisposed || currentInitializationId !== initializationId) return

    mapboxModule = importedMapbox.default
    if (!mapboxModule.supported()) {
      reportError(
        'Ta przeglądarka nie obsługuje interaktywnej mapy. Skorzystaj z listy placówek.',
        true,
      )
      return
    }

    map = new mapboxModule.Map({
      accessToken,
      container: mapContainer.value,
      style: 'mapbox://styles/mapbox/standard',
      config: {
        basemap: {
          theme: 'monochrome',
        },
      },
      center: [19.1451, 51.9194],
      zoom: 5.4,
      minZoom: 3,
      maxZoom: 18,
      maxPitch: 0,
      attributionControl: true,
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: false,
      locale: {
        'AttributionControl.ToggleAttribution': 'Pokaż informacje o mapie',
        'NavigationControl.ZoomIn': 'Przybliż',
        'NavigationControl.ZoomOut': 'Oddal',
        'NavigationControl.ResetBearing': 'Ustaw północ',
      },
    })
    hasMap.value = true

    map.on('click', () => closePopups())
    map.on('error', () => {
      reportError(
        'Nie udało się pobrać wszystkich danych mapy. Spróbuj ponownie.',
        mapStatus.value !== 'ready',
      )
    })
    map.once('load', () => {
      if (isDisposed || currentInitializationId !== initializationId) return

      clearLoadTimeout()
      mapStatus.value = 'ready'
      errorMessage.value = ''
      lastEmittedError = ''
      map?.resize()
      fitBounds()
      revealSelectedMarker(false)
      emit('ready')
    })

    replaceNavigationControl()
    rebuildMarkers()

    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => {
        map?.resize()
      })
      resizeObserver.observe(mapContainer.value)
    }

    loadTimeout = setTimeout(() => {
      if (mapStatus.value !== 'loading') return
      reportError(
        'Ładowanie mapy trwa zbyt długo. Sprawdź połączenie i spróbuj ponownie.',
        true,
      )
    }, 15_000)
  }
  catch {
    if (isDisposed || currentInitializationId !== initializationId) return
    reportError(
      'Nie udało się uruchomić mapy. Sprawdź połączenie i spróbuj ponownie.',
      true,
    )
  }
}

watch(
  () => props.selectedFacilityId,
  (facilityId) => {
    if (facilityId !== undefined) {
      internalSelectedFacilityId.value = facilityId
    }
  },
)

watch(effectiveSelectedFacilityId, () => {
  revealSelectedMarker(true)
})

watch(
  () => props.markers,
  () => {
    rebuildMarkers()
    scheduleFitBounds()
    revealSelectedMarker(false)
  },
  { deep: true },
)

watch(
  () => props.presentation,
  () => {
    replaceNavigationControl()
    rebuildMarkers()
    scheduleFitBounds()
    revealSelectedMarker(false)
  },
)

onMounted(async () => {
  await nextTick()
  void initializeMap()
})

onBeforeUnmount(() => {
  isDisposed = true
  initializationId += 1
  cleanupMap()
})

defineExpose({
  fitBounds,
  retry: initializeMap,
})
</script>

<template>
  <section
    class="directory-map"
    :class="`directory-map--${presentation}`"
    :style="mapStyle"
    role="region"
    :aria-label="ariaLabel"
    :aria-busy="mapStatus === 'loading'"
    :aria-describedby="instructionsId"
  >
    <div ref="mapContainer" class="directory-map__canvas" />

    <div
      v-if="mapStatus === 'loading'"
      class="directory-map__notice directory-map__notice--floating"
      role="status"
      aria-live="polite"
    >
      <strong>Ładujemy mapę</strong>
      <span>Za chwilę pokażemy placówki w Twojej okolicy.</span>
    </div>

    <div
      v-else-if="fallbackVisible"
      class="directory-map__fallback"
      role="alert"
    >
      <div class="directory-map__fallback-copy">
        <span>Mapa placówek</span>
        <strong>{{ statusTitle }}</strong>
        <p>{{ statusDescription }}</p>
        <button
          v-if="mapStatus === 'error' && accessToken"
          type="button"
          @click="initializeMap"
        >
          Spróbuj ponownie
        </button>
      </div>

      <ul v-if="fallbackMarkers.length" class="directory-map__fallback-list">
        <li v-for="facility in fallbackMarkers" :key="facility.facilityId">
          <a
            v-if="facility.href || facility.bookingHref"
            :href="facility.href || facility.bookingHref"
          >
            <strong>{{ facility.name }}</strong>
            <span v-if="facility.address">{{ facility.address }}</span>
          </a>
          <div v-else>
            <strong>{{ facility.name }}</strong>
            <span v-if="facility.address">{{ facility.address }}</span>
          </div>
        </li>
      </ul>
    </div>

    <div
      v-else-if="mapStatus === 'error'"
      class="directory-map__notice directory-map__notice--error"
      role="alert"
    >
      <strong>Mapa jest chwilowo niedostępna</strong>
      <span>{{ errorMessage }}</span>
      <button type="button" @click="initializeMap">Spróbuj ponownie</button>
    </div>

    <div
      v-else-if="mapStatus === 'ready' && validMarkers.length === 0"
      class="directory-map__notice directory-map__notice--floating"
      role="status"
    >
      <strong>Brak lokalizacji do pokazania</strong>
      <span>Placówki z adresem pojawią się tutaj automatycznie.</span>
    </div>

    <p :id="instructionsId" class="directory-map__visually-hidden">
      Użyj klawisza Tab, aby przejść między placówkami i przyciskami mapy.
      Naciśnij Enter lub spację, aby wybrać placówkę.
    </p>
    <p class="directory-map__visually-hidden" aria-live="polite">
      {{ liveMessage }}
    </p>
  </section>
</template>

<style scoped>
.directory-map {
  --directory-map-height: clamp(320px, 42vw, 390px);

  position: relative;
  isolation: isolate;
  overflow: hidden;
  width: 100%;
  height: var(--directory-map-height);
  min-height: 280px;
  border: 1px solid #cfcfca;
  border-radius: 6px;
  background: #e9e9e5;
  color: #111;
}

.directory-map--detail {
  --directory-map-height: clamp(390px, 55vw, 520px);
}

.directory-map__canvas {
  width: 100%;
  height: 100%;
}

.directory-map__notice {
  position: absolute;
  z-index: 3;
  display: grid;
  max-width: min(340px, calc(100% - 32px));
  gap: 5px;
  border: 1px solid #cfcfca;
  border-radius: 5px;
  padding: 13px 15px;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 5px 18px rgb(0 0 0 / 10%);
}

.directory-map__notice--floating {
  top: 50%;
  left: 50%;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.directory-map__notice--error {
  top: 14px;
  left: 14px;
}

.directory-map__notice strong {
  font-size: 13px;
  font-weight: 650;
}

.directory-map__notice span {
  color: #5d5d59;
  font-size: 11px;
  line-height: 1.45;
}

.directory-map__notice button,
.directory-map__fallback button {
  width: fit-content;
  min-height: 36px;
  margin-top: 5px;
  border: 0;
  border-radius: 4px;
  padding: 8px 11px;
  background: #111;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 650;
}

.directory-map__notice button:hover,
.directory-map__fallback button:hover {
  background: #353535;
}

.directory-map__fallback {
  position: absolute;
  z-index: 4;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  align-items: stretch;
  background: #efefec;
}

.directory-map__fallback-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  border-right: 1px solid #d7d7d2;
  padding: clamp(24px, 5vw, 48px);
}

.directory-map__fallback-copy > span {
  margin-bottom: 9px;
  color: #666;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.directory-map__fallback-copy > strong {
  max-width: 360px;
  font-size: clamp(20px, 3vw, 27px);
  font-weight: 500;
  letter-spacing: -0.025em;
  line-height: 1.15;
}

.directory-map__fallback-copy p {
  max-width: 370px;
  margin-top: 9px;
  color: #5f5f5b;
  font-size: 12px;
  line-height: 1.55;
}

.directory-map__fallback-list {
  display: grid;
  overflow: auto;
  align-content: center;
  margin: 0;
  padding: clamp(18px, 4vw, 36px);
  list-style: none;
}

.directory-map__fallback-list li + li {
  border-top: 1px solid #d7d7d2;
}

.directory-map__fallback-list :is(a, div) {
  display: grid;
  gap: 3px;
  padding: 13px 2px;
  color: #111;
  text-decoration: none;
}

.directory-map__fallback-list a:hover strong {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.directory-map__fallback-list strong {
  font-size: 13px;
  font-weight: 600;
}

.directory-map__fallback-list span {
  color: #666;
  font-size: 11px;
  line-height: 1.4;
}

.directory-map__visually-hidden {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  margin: -1px;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  clip-path: inset(50%);
}

.directory-map :deep(.directory-map__marker) {
  opacity: 0.68;
  cursor: pointer;
  transition:
    opacity var(--transition-fast),
    filter var(--transition-fast);
}

.directory-map :deep(.directory-map__marker:hover),
.directory-map :deep(.directory-map__marker:focus-visible),
.directory-map :deep(.directory-map__marker--selected) {
  opacity: 1;
  filter: drop-shadow(0 3px 4px rgb(0 0 0 / 22%));
}

.directory-map :deep(.directory-map__marker:focus-visible) {
  outline: 3px solid #fff;
  outline-offset: 3px;
  border-radius: 50%;
}

.directory-map :deep(.mapboxgl-popup-content) {
  border: 1px solid #d7d7d2;
  border-radius: 5px;
  padding: 0;
  box-shadow: 0 8px 24px rgb(0 0 0 / 15%);
}

.directory-map :deep(.mapboxgl-popup-close-button) {
  top: 7px;
  right: 7px;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 3px;
  color: #555;
  font-size: 21px;
}

.directory-map :deep(.mapboxgl-popup-close-button:hover) {
  background: #efefec;
  color: #111;
}

.directory-map :deep(.mapboxgl-popup-close-button:focus-visible) {
  outline: 2px solid #111;
  outline-offset: 1px;
}

.directory-map :deep(.directory-map-popup) {
  display: grid;
  gap: 5px;
  min-width: 220px;
  padding: 18px;
  padding-right: 42px;
  color: #111;
  font-family: var(--font-sans);
}

.directory-map :deep(.directory-map-popup--detail) {
  min-width: 260px;
  padding: 21px;
  padding-right: 44px;
}

.directory-map :deep(.directory-map-popup__eyebrow) {
  color: #666;
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.directory-map :deep(.directory-map-popup__name) {
  padding-right: 8px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.directory-map :deep(.directory-map-popup--detail .directory-map-popup__name) {
  font-size: 18px;
}

.directory-map :deep(.directory-map-popup__address) {
  color: #5f5f5b;
  font-size: 11px;
  line-height: 1.45;
}

.directory-map :deep(.directory-map-popup__actions) {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}

.directory-map :deep(.directory-map-popup__link) {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid #cfcfca;
  border-radius: 4px;
  padding: 8px 10px;
  background: #fff;
  color: #111;
  font-size: 10px;
  font-weight: 650;
  text-decoration: none;
}

.directory-map :deep(.directory-map-popup__link:hover) {
  border-color: #999;
  background: #f5f5f2;
}

.directory-map :deep(.directory-map-popup__link--primary) {
  border-color: #111;
  background: #111;
  color: #fff;
}

.directory-map :deep(.directory-map-popup__link--primary:hover) {
  border-color: #353535;
  background: #353535;
}

.directory-map :deep(.directory-map-popup__link:focus-visible) {
  outline: 2px solid #111;
  outline-offset: 2px;
}

.directory-map :deep(.mapboxgl-ctrl-group) {
  overflow: hidden;
  border: 1px solid #cfcfca;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 10%);
}

.directory-map :deep(.mapboxgl-ctrl-group button:focus-visible) {
  position: relative;
  z-index: 1;
  outline: 2px solid #111;
  outline-offset: -3px;
}

@media (max-width: 640px) {
  .directory-map {
    --directory-map-height: 320px;
  }

  .directory-map--detail {
    --directory-map-height: 410px;
  }

  .directory-map__fallback {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }

  .directory-map__fallback-copy {
    justify-content: flex-start;
    border-right: 0;
    border-bottom: 1px solid #d7d7d2;
    padding: 22px;
  }

  .directory-map__fallback-copy > strong {
    font-size: 20px;
  }

  .directory-map__fallback-list {
    align-content: start;
    padding: 8px 20px 18px;
  }

  .directory-map__fallback-list :is(a, div) {
    padding: 10px 2px;
  }
}

@media (max-width: 380px) {
  .directory-map :deep(.directory-map-popup) {
    min-width: min(210px, calc(100vw - 82px));
    padding: 16px;
    padding-right: 40px;
  }

  .directory-map :deep(.directory-map-popup__actions) {
    display: grid;
  }
}

@media (prefers-reduced-motion: reduce) {
  .directory-map :deep(.directory-map__marker) {
    transition: none;
  }
}
</style>
