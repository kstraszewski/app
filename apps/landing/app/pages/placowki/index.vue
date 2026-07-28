<script setup lang="ts">
import type { DirectoryFacility, DirectoryPayload } from '#shared/types/directory'
import { directoryBookingUrl, normalizeDirectoryQuery } from '~/utils/directory'

const { canonicalUrl, siteOrigin } = useLandingSeo({
  title: 'Placówki — znajdź najbliższą lokalizację | OpenExpert',
  description: 'Znajdź placówkę OpenExpert na mapie, poznaj jej zespół i dostępne konsultacje, a następnie zarezerwuj dogodny termin.',
  path: '/placowki',
  socialImagePath: '/placowki-og.png',
  socialImageAlt: 'Mapa i katalog placówek OpenExpert',
})

const runtimeConfig = useRuntimeConfig()
const crmBaseUrl = String(
  runtimeConfig.public.openexpert.crmBaseUrl || 'http://127.0.0.1:3004',
)
const search = ref('')
const selectedFacilityId = ref<string | null>(null)
const mobileView = ref<'list' | 'map'>('list')
const drawerOpen = ref(true)
const drawerCloseButton = useTemplateRef<HTMLButtonElement>('drawerCloseButton')
const showDrawerButton = useTemplateRef<HTMLButtonElement>('showDrawerButton')
const directoryMap = useTemplateRef<{ locateUser: () => void }>('directoryMap')

const { data, status, error, refresh } = await useFetch<DirectoryPayload>('/api/directory', {
  key: 'openexpert-directory-facilities',
  default: () => ({
    generatedAt: '',
    experts: [],
    facilities: [],
  }),
})

if (import.meta.server && error.value) {
  useResponseHeader('Retry-After').value = '300'
  throw createError({
    statusCode: 503,
    statusMessage: 'Katalog placówek jest chwilowo niedostępny.',
  })
}

const facilities = computed(() => data.value.facilities)
const normalizedSearch = computed(() => normalizeDirectoryQuery(search.value))
const visibleFacilities = computed(() => {
  if (!normalizedSearch.value) return facilities.value

  return facilities.value.filter((facility) => {
    const searchText = normalizeDirectoryQuery([
      facility.name,
      facility.address ?? '',
      facility.city ?? '',
      ...facility.services.map(service => service.name),
      ...facility.experts.map(expert => expert.name),
    ].join(' '))
    return searchText.includes(normalizedSearch.value)
  })
})
const selectedFacility = computed(() => (
  visibleFacilities.value.find(
    facility => facility.facilityId === selectedFacilityId.value,
  ) ?? null
))
const mapFacilities = computed(() => visibleFacilities.value.filter(
  (facility): facility is DirectoryFacility & {
    coordinates: { latitude: number, longitude: number }
  } => Boolean(facility.coordinates),
))
const mapMarkers = computed(() => mapFacilities.value.map(facility => ({
  facilityId: facility.facilityId,
  name: facility.name,
  address: facility.address,
  latitude: facility.coordinates.latitude,
  longitude: facility.coordinates.longitude,
  href: facilityHref(facility),
  bookingHref: bookingHref(facility.widgetKey),
})))
const numberedMapMarkers = computed(() => mapMarkers.value.map(marker => ({
  ...marker,
  label: String(facilityNumber(marker.facilityId)),
})))
const mapCameraPadding = computed(() => drawerOpen.value
  ? {
      top: 96,
      right: 72,
      bottom: 96,
      left: 624,
    }
  : {
      top: 96,
      right: 72,
      bottom: 96,
      left: 72,
    })
const resultText = computed(() => {
  if (status.value === 'pending' || status.value === 'idle') {
    return 'Pobieramy aktualny katalog placówek.'
  }
  if (error.value) return 'Katalog placówek jest chwilowo niedostępny.'
  if (search.value.trim()) {
    return `Wyniki: ${visibleFacilities.value.length} z ${facilities.value.length}.`
  }
  return `Dostępnych placówek: ${facilities.value.length}.`
})
const resultCountLabel = computed(() => formatFacilityCount(visibleFacilities.value.length))
const hasError = computed(() => status.value === 'error' || Boolean(error.value))

watch(
  visibleFacilities,
  (nextFacilities) => {
    if (
      !selectedFacilityId.value
      || !nextFacilities.some(facility => facility.facilityId === selectedFacilityId.value)
    ) {
      selectedFacilityId.value = nextFacilities[0]?.facilityId ?? null
    }
  },
  { immediate: true },
)

function bookingHref(widgetKey: string) {
  return directoryBookingUrl(crmBaseUrl, widgetKey)
}

function formatFacilityCount(count: number) {
  if (count === 1) return '1 placówka'

  const lastTwoDigits = count % 100
  const lastDigit = count % 10
  if (lastTwoDigits < 12 || lastTwoDigits > 14) {
    if (lastDigit >= 2 && lastDigit <= 4) return `${count} placówki`
  }

  return `${count} placówek`
}

function facilityNumber(facilityId: string) {
  return visibleFacilities.value.findIndex(
    facility => facility.facilityId === facilityId,
  ) + 1
}

function facilityHref(facility: Pick<DirectoryFacility, 'organizationSlug' | 'facilitySlug'>) {
  return `/placowki/${encodeURIComponent(facility.organizationSlug)}/${encodeURIComponent(facility.facilitySlug)}`
}

function selectFacility(facilityId: string) {
  selectedFacilityId.value = facilityId
}

function selectFacilityFromMap(facilityId: string) {
  selectedFacilityId.value = facilityId
}

async function closeDrawer() {
  drawerOpen.value = false
  await nextTick()
  showDrawerButton.value?.focus()
}

async function openDrawer() {
  drawerOpen.value = true
  mobileView.value = 'list'
  await nextTick()
  drawerCloseButton.value?.focus()
}

useHead(() => ({
  script: facilities.value.length
    ? [{
        key: 'structured-data:facilities-directory',
        type: 'application/ld+json',
        innerHTML: serializeLandingStructuredData({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'CollectionPage',
              '@id': `${canonicalUrl}#webpage`,
              url: canonicalUrl,
              name: 'Placówki OpenExpert',
              description: 'Publiczny katalog placówek, ekspertów i konsultacji dostępnych w OpenExpert.',
              isPartOf: { '@id': `${siteOrigin}/#website` },
              breadcrumb: { '@id': `${canonicalUrl}#breadcrumb` },
              mainEntity: { '@id': `${canonicalUrl}#lista-placowek` },
              inLanguage: 'pl-PL',
            },
            {
              '@type': 'BreadcrumbList',
              '@id': `${canonicalUrl}#breadcrumb`,
              itemListElement: [
                {
                  '@type': 'ListItem',
                  position: 1,
                  name: 'OpenExpert',
                  item: `${siteOrigin}/`,
                },
                {
                  '@type': 'ListItem',
                  position: 2,
                  name: 'Placówki',
                  item: canonicalUrl,
                },
              ],
            },
            {
              '@type': 'ItemList',
              '@id': `${canonicalUrl}#lista-placowek`,
              name: 'Placówki OpenExpert',
              numberOfItems: facilities.value.length,
              itemListOrder: 'https://schema.org/ItemListOrderAscending',
              itemListElement: facilities.value.map((facility, index) => {
                const url = new URL(facilityHref(facility), `${siteOrigin}/`).toString()
                return {
                  '@type': 'ListItem',
                  position: index + 1,
                  url,
                  item: {
                    '@type': 'ProfessionalService',
                    '@id': `${url}#placowka`,
                    url,
                    name: facility.name,
                    address: facility.address ?? undefined,
                    geo: facility.coordinates
                      ? {
                          '@type': 'GeoCoordinates',
                          latitude: facility.coordinates.latitude,
                          longitude: facility.coordinates.longitude,
                        }
                      : undefined,
                    employee: facility.experts.map(expert => ({
                      '@type': 'Person',
                      name: expert.name,
                    })),
                  },
                }
              }),
            },
          ],
        }),
      }]
    : [],
}))
</script>

<template>
  <div class="facility-directory">
    <DirectorySiteHeader active="facilities" />

    <main id="directory-content" tabindex="-1">
      <section class="facility-directory__intro" aria-labelledby="facility-directory-title">
        <div class="facility-directory__intro-inner">
          <div class="facility-directory__heading">
            <p>Placówki</p>
            <h1 id="facility-directory-title">Znajdź najbliższą placówkę</h1>
          </div>
          <p class="facility-directory__lede">
            Wybierz placówkę na mapie lub z listy, aby zobaczyć szczegóły
            i umówić konsultację.
          </p>
        </div>
      </section>

      <section
        id="katalog-placowek"
        class="facility-browser"
        aria-labelledby="facility-browser-title"
      >
        <h2 id="facility-browser-title" class="visually-hidden">Katalog i mapa placówek</h2>

        <div
          v-if="status === 'pending' || status === 'idle'"
          class="facility-state"
          role="status"
          aria-live="polite"
        >
          <span class="facility-state__loader" aria-hidden="true" />
          <div>
            <strong>Ładujemy placówki</strong>
            <p>Pobieramy aktualne lokalizacje i dostępne konsultacje.</p>
          </div>
        </div>

        <div v-else-if="hasError" class="facility-state facility-state--error" role="alert">
          <Icon name="lucide:triangle-alert" aria-hidden="true" />
          <div>
            <strong>Nie udało się pobrać katalogu</strong>
            <p>Spróbuj ponownie. Jeśli problem nie zniknie, wróć za kilka minut.</p>
          </div>
          <button type="button" @click="refresh()">
            <Icon name="lucide:rotate-ccw" aria-hidden="true" />
            Spróbuj ponownie
          </button>
        </div>

        <div
          v-else
          class="facility-explorer"
          :class="{ 'facility-explorer--drawer-closed': !drawerOpen }"
        >
          <div class="facility-explorer__mobile-tabs" aria-label="Sposób przeglądania placówek">
            <button
              type="button"
              :aria-pressed="mobileView === 'list'"
              @click="mobileView = 'list'; drawerOpen = true"
            >
              <Icon name="lucide:building-2" aria-hidden="true" />
              Lista
            </button>
            <button
              type="button"
              :aria-pressed="mobileView === 'map'"
              @click="mobileView = 'map'"
            >
              <Icon name="lucide:map-pin" aria-hidden="true" />
              Mapa
            </button>
          </div>

          <div
            class="facility-explorer__map"
            :class="{ 'facility-explorer__map--mobile-hidden': mobileView !== 'map' }"
          >
            <DirectoryMap
              ref="directoryMap"
              :markers="numberedMapMarkers"
              :selected-facility-id="selectedFacilityId"
              :open-popup-on-selection="false"
              :camera-padding="mapCameraPadding"
              presentation="compact"
              height="100%"
              aria-label="Mapa placówek OpenExpert"
              @select="selectFacilityFromMap"
              @update:selected-facility-id="selectFacilityFromMap"
            />
            <button
              type="button"
              class="facility-explorer__locate"
              aria-label="Pokaż moją lokalizację"
              @click="directoryMap?.locateUser()"
            >
              <Icon name="lucide:navigation" aria-hidden="true" />
            </button>
          </div>

          <div class="facility-explorer__search">
            <label class="visually-hidden" for="facility-search">Szukaj placówki</label>
            <div class="facility-explorer__search-control">
              <Icon name="lucide:search" aria-hidden="true" />
              <input
                id="facility-search"
                v-model="search"
                type="search"
                autocomplete="off"
                placeholder="Nazwa, miasto, adres lub usługa"
                aria-describedby="facility-search-results"
              >
              <button
                v-if="search"
                class="facility-explorer__clear"
                type="button"
                aria-label="Wyczyść wyszukiwanie"
                @click="search = ''"
              >
                <Icon name="lucide:x" aria-hidden="true" />
              </button>
              <span class="facility-explorer__search-count" aria-hidden="true">
                {{ resultCountLabel }}
              </span>
              <span id="facility-search-results" class="visually-hidden" aria-live="polite">
                {{ resultText }}
              </span>
            </div>
          </div>

          <aside
            class="facility-explorer__drawer"
            :class="{
              'facility-explorer__drawer--closed': !drawerOpen,
              'facility-explorer__drawer--mobile-hidden': mobileView !== 'list',
            }"
            aria-label="Lista placówek"
            :aria-hidden="!drawerOpen ? 'true' : undefined"
            :inert="!drawerOpen ? true : undefined"
          >
            <header class="facility-explorer__drawer-header">
              <span>{{ resultCountLabel }}</span>
              <button
                ref="drawerCloseButton"
                type="button"
                aria-label="Ukryj listę placówek"
                @click="closeDrawer"
              >
                <Icon name="lucide:x" aria-hidden="true" />
              </button>
            </header>

            <div class="facility-explorer__drawer-body">
              <div v-if="facilities.length === 0" class="facility-explorer__empty">
                <Icon name="lucide:landmark" aria-hidden="true" />
                <div>
                  <strong>Katalog placówek jest jeszcze pusty</strong>
                  <p>Placówki pojawią się tutaj po opublikowaniu kalendarza konsultacji.</p>
                </div>
              </div>

              <div v-else-if="visibleFacilities.length === 0" class="facility-explorer__empty">
                <Icon name="lucide:search" aria-hidden="true" />
                <div>
                  <strong>Nie znaleźliśmy takiej placówki</strong>
                  <p>Spróbuj wpisać inne miasto, usługę lub krótszy fragment adresu.</p>
                </div>
                <button type="button" @click="search = ''">Wyczyść wyszukiwanie</button>
              </div>

              <ol v-else class="facility-results">
                <li
                  v-for="(facility, index) in visibleFacilities"
                  :key="facility.facilityId"
                  :class="{ 'facility-results__item--selected': selectedFacilityId === facility.facilityId }"
                  @mouseenter="selectFacility(facility.facilityId)"
                  @focusin="selectFacility(facility.facilityId)"
                >
                  <button
                    type="button"
                    class="facility-results__summary"
                    :aria-pressed="selectedFacilityId === facility.facilityId"
                    @click="selectFacility(facility.facilityId)"
                  >
                    <span class="facility-results__number" aria-hidden="true">{{ index + 1 }}</span>
                    <span class="facility-results__copy">
                      <strong>{{ facility.name }}</strong>
                      <span v-if="facility.address">
                        <Icon name="lucide:map-pin" aria-hidden="true" />
                        {{ facility.address }}
                      </span>
                      <span>
                        <Icon name="lucide:users-round" aria-hidden="true" />
                        {{ facility.experts.length }}
                        {{ facility.experts.length === 1 ? 'ekspert' : 'ekspertów' }}
                      </span>
                    </span>
                  </button>

                  <img
                    v-if="facility.coverImage"
                    class="facility-results__image"
                    :src="facility.coverImage.thumbnailUrl"
                    :alt="facility.coverImage.alt"
                    width="640"
                    height="400"
                    :loading="index === 0 ? 'eager' : 'lazy'"
                    decoding="async"
                  >
                  <span v-else class="facility-results__image-empty" aria-hidden="true">
                    <Icon name="lucide:landmark" />
                  </span>

                  <div class="facility-results__actions">
                    <NuxtLink :to="facilityHref(facility)">
                      <Icon name="lucide:external-link" aria-hidden="true" />
                      Zobacz placówkę
                      <Icon name="lucide:arrow-right" aria-hidden="true" />
                    </NuxtLink>
                    <a :href="bookingHref(facility.widgetKey)">
                      <Icon name="lucide:calendar-days" aria-hidden="true" />
                      Zobacz terminy
                      <Icon name="lucide:arrow-right" aria-hidden="true" />
                    </a>
                  </div>
                </li>
              </ol>
            </div>
          </aside>

          <button
            v-if="!drawerOpen"
            ref="showDrawerButton"
            type="button"
            class="facility-explorer__show-drawer"
            aria-label="Pokaż listę placówek"
            @click="openDrawer"
          >
            <Icon name="lucide:list-filter" aria-hidden="true" />
            Pokaż listę
          </button>

          <Transition name="facility-dock" mode="out-in">
            <NuxtLink
              v-if="selectedFacility"
              :key="selectedFacility.facilityId"
              :to="facilityHref(selectedFacility)"
              class="facility-explorer__dock"
              :class="{ 'facility-explorer__dock--mobile-visible': mobileView === 'map' }"
            >
              <img
                v-if="selectedFacility.coverImage"
                :src="selectedFacility.coverImage.thumbnailUrl"
                :alt="selectedFacility.coverImage.alt"
                width="88"
                height="64"
              >
              <span v-else class="facility-explorer__dock-image-empty" aria-hidden="true">
                <Icon name="lucide:landmark" />
              </span>
              <span class="facility-explorer__dock-number" aria-hidden="true">
                {{ facilityNumber(selectedFacility.facilityId) }}
              </span>
              <span class="facility-explorer__dock-copy">
                <strong>{{ selectedFacility.name }}</strong>
                <span v-if="selectedFacility.address">{{ selectedFacility.address }}</span>
              </span>
              <Icon name="lucide:external-link" aria-hidden="true" />
            </NuxtLink>
          </Transition>
        </div>
      </section>

      <section class="facility-directory__guide" aria-labelledby="facility-guide-title">
        <div>
          <p>Jak wybrać placówkę</p>
          <h2 id="facility-guide-title">Sprawdź miejsce, zespół i zakres konsultacji.</h2>
        </div>
        <ol>
          <li>
            <span>01</span>
            <strong>Porównaj lokalizacje</strong>
            <p>Mapa pokazuje placówki, które opublikowały aktywny kalendarz OpenExpert.</p>
          </li>
          <li>
            <span>02</span>
            <strong>Poznaj szczegóły</strong>
            <p>Na stronie placówki znajdziesz dostępne konsultacje, ekspertów i dane kontaktowe.</p>
          </li>
          <li>
            <span>03</span>
            <strong>Wybierz termin</strong>
            <p>Przejdź do kalendarza i zarezerwuj konsultację bez czekania na telefon zwrotny.</p>
          </li>
        </ol>
      </section>
    </main>

    <DirectorySiteFooter />
  </div>
</template>

<style scoped>
.facility-directory {
  min-width: 0;
  background: #f7f7f5;
  color: #111;
  font-family: var(--font-sans);
}

#directory-content:focus {
  outline: none;
}

.facility-directory__intro {
  border-bottom: 1px solid #d6d6d1;
  background: #fafaf8;
}

.facility-directory__intro-inner {
  width: min(1440px, calc(100% - 80px));
  margin: 0 auto;
  padding: 34px 0 20px;
}

.facility-directory__intro-inner > p,
.facility-list__eyebrow,
.facility-directory__guide > div > p {
  color: #696965;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.facility-directory__intro h1 {
  margin-top: 14px;
  font-size: clamp(38px, 4vw, 58px);
  font-variation-settings: 'opsz' 58, 'wght' 350;
  font-weight: 350;
  letter-spacing: -0.045em;
  line-height: 1;
}

.facility-search {
  width: min(430px, 100%);
  margin-top: 24px;
}

.facility-search > label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.facility-search__control {
  display: flex;
  min-height: 50px;
  align-items: center;
  gap: 10px;
  border: 1px solid #c9c9c4;
  border-radius: 5px;
  padding: 0 12px 0 15px;
  background: #fff;
  transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
}

.facility-search__control:focus-within {
  border-color: #111;
  box-shadow: 0 0 0 1px #111;
}

.facility-search__control > :deep(svg) {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
  color: #777;
}

.facility-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  padding: 13px 0;
  background: transparent;
  color: #111;
  font: inherit;
  font-size: 14px;
}

.facility-search input::placeholder {
  color: #767672;
}

.facility-search input::-webkit-search-cancel-button {
  appearance: none;
}

.facility-search button,
.facility-browser__empty button {
  border: 0;
  padding: 7px 9px;
  background: #efefec;
  color: #444;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 600;
}

.facility-browser {
  scroll-margin-top: 20px;
  background: #f5f5f2;
}

.facility-browser__shell {
  display: grid;
  min-height: min(760px, calc(100vh - 260px));
  grid-template-columns: minmax(350px, 32.5vw) minmax(0, 1fr);
}

.facility-browser__list {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 620px;
  flex-direction: column;
  border-right: 1px solid #d5d5d0;
  background: #fafaf8;
}

.facility-browser__count {
  min-height: 72px;
  border-bottom: 1px solid #d8d8d3;
  padding: 28px 34px 22px;
  color: #62625e;
  font-size: 12px;
}

.facility-list {
  list-style: none;
}

.facility-list > li {
  position: relative;
  border-bottom: 1px solid #d8d8d3;
  background: #fafaf8;
  transition: background-color 150ms ease-out;
}

.facility-list > li:hover,
.facility-list > .facility-list__item--selected {
  background: #fff;
}

.facility-list__link {
  position: relative;
  display: grid;
  min-height: 194px;
  grid-template-columns: 128px minmax(0, 1fr);
  align-items: center;
  gap: 24px;
  padding: 26px 34px;
  color: #111;
  text-decoration: none;
}

.facility-list__link > img,
.facility-list__image-empty {
  display: block;
  width: 128px;
  height: 128px;
  border: 1px solid #ddd;
  border-radius: 4px;
  object-fit: cover;
}

.facility-list__image-empty {
  display: grid;
  place-items: center;
  background: #ecece8;
  color: #666;
}

.facility-list__content {
  display: grid;
  min-width: 0;
  gap: 8px;
  padding-right: 20px;
}

.facility-list__content > strong {
  max-width: 280px;
  font-size: 20px;
  font-weight: 500;
  letter-spacing: -0.025em;
  line-height: 1.1;
}

.facility-list__meta {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: #555;
  font-size: 13px;
  line-height: 1.45;
}

.facility-list__meta :deep(svg) {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  margin-top: 2px;
}

.facility-list__number {
  position: absolute;
  top: 25px;
  right: 28px;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 50%;
  background: #111;
  color: #fff;
  font-size: 11px;
}

.facility-list__arrow {
  position: absolute;
  right: 28px;
  bottom: 28px;
  width: 17px;
  height: 17px;
}

.facility-browser__show-map {
  display: none;
}

.facility-browser__map {
  position: relative;
  min-width: 0;
  min-height: 620px;
  background: #e9e9e5;
}

.facility-browser__map :deep(.directory-map) {
  position: absolute;
  inset: 0;
  height: 100%;
  min-height: 100%;
  border: 0;
  border-radius: 0;
}

.facility-browser__mobile-tabs {
  display: none;
}

.facility-browser__empty,
.facility-state {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 16px;
  margin: 32px;
  border: 1px solid #d5d5d0;
  padding: 24px;
  background: #fff;
}

.facility-browser__empty > :deep(svg),
.facility-state > :deep(svg) {
  width: 20px;
  height: 20px;
}

.facility-browser__empty strong,
.facility-state strong {
  display: block;
  margin-bottom: 6px;
  font-size: 16px;
}

.facility-browser__empty p,
.facility-state p {
  color: #666;
  font-size: 13px;
  line-height: 1.55;
}

.facility-browser__empty button {
  grid-column: 2;
  justify-self: start;
  margin-top: 8px;
}

.facility-state {
  width: min(720px, calc(100% - 80px));
  min-height: 160px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  margin: 0 auto;
  transform: translateY(48px);
}

.facility-state__loader {
  width: 34px;
  height: 34px;
  border: 2px solid #ccc;
  border-top-color: #111;
  border-radius: 50%;
  animation: facility-spin 800ms linear infinite;
}

.facility-state > button {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  border: 1px solid #111;
  padding: 9px 13px;
  background: #111;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.facility-directory__guide {
  display: grid;
  width: min(1340px, calc(100% - 96px));
  grid-template-columns: minmax(260px, 0.75fr) minmax(0, 1.25fr);
  gap: 64px;
  margin: 0 auto;
  padding: 84px 0 96px;
}

.facility-directory__guide h2 {
  max-width: 520px;
  margin-top: 14px;
  font-size: clamp(34px, 3.7vw, 54px);
  font-variation-settings: 'opsz' 54, 'wght' 350;
  font-weight: 350;
  letter-spacing: -0.045em;
  line-height: 1;
}

.facility-directory__guide ol {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid #aaa;
  list-style: none;
}

.facility-directory__guide li {
  padding: 22px 22px 0 0;
}

.facility-directory__guide li + li {
  border-left: 1px solid #d2d2ce;
  padding-left: 22px;
}

.facility-directory__guide li > span {
  color: #777;
  font-family: var(--font-mono);
  font-size: 10px;
}

.facility-directory__guide strong {
  display: block;
  margin-top: 24px;
  font-size: 16px;
}

.facility-directory__guide li p {
  margin-top: 8px;
  color: #60605c;
  font-size: 13px;
  line-height: 1.6;
}

.facility-directory :is(a, button, input):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

@keyframes facility-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1050px) {
  .facility-browser__shell {
    grid-template-columns: minmax(330px, 42vw) minmax(0, 1fr);
  }

  .facility-list__link {
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 18px;
    padding: 24px;
  }

  .facility-list__link > img,
  .facility-list__image-empty {
    width: 96px;
    height: 112px;
  }

  .facility-list__number {
    right: 22px;
  }

  .facility-list__arrow {
    right: 22px;
  }

  .facility-directory__guide {
    grid-template-columns: 1fr;
    gap: 36px;
  }
}

@media (max-width: 760px) {
  .facility-directory__intro-inner {
    width: min(100% - 40px, 620px);
    padding: 30px 0 22px;
  }

  .facility-directory__intro h1 {
    font-size: clamp(38px, 12vw, 52px);
  }

  .facility-browser__shell {
    display: block;
    min-height: 620px;
  }

  .facility-browser__mobile-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-bottom: 1px solid #d5d5d0;
    background: #fafaf8;
    padding: 10px 20px;
  }

  .facility-browser__mobile-tabs button {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid #c9c9c4;
    background: #fff;
    color: #555;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }

  .facility-browser__mobile-tabs button + button {
    border-left: 0;
  }

  .facility-browser__mobile-tabs button[aria-pressed='true'] {
    border-color: #111;
    background: #111;
    color: #fff;
  }

  .facility-browser__list,
  .facility-browser__map {
    min-height: 560px;
    border-right: 0;
  }

  .facility-browser__list--mobile-hidden,
  .facility-browser__map--mobile-hidden {
    display: none;
  }

  .facility-browser__count {
    min-height: 62px;
    padding: 23px 20px 18px;
  }

  .facility-list__link {
    min-height: 164px;
    grid-template-columns: 104px minmax(0, 1fr);
    padding: 20px;
  }

  .facility-list__link > img,
  .facility-list__image-empty {
    width: 104px;
    height: 120px;
  }

  .facility-list__content {
    padding-right: 14px;
  }

  .facility-list__content > strong {
    font-size: 18px;
  }

  .facility-list__number {
    top: 18px;
    right: 18px;
  }

  .facility-list__arrow {
    right: 18px;
    bottom: 20px;
  }

  .facility-browser__show-map {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: auto 20px 22px;
    border: 1px solid #aaa;
    padding: 10px 16px;
    background: #fff;
    color: #111;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
  }

  .facility-directory__guide {
    width: min(100% - 40px, 620px);
    padding: 64px 0 72px;
  }

  .facility-directory__guide ol {
    grid-template-columns: 1fr;
  }

  .facility-directory__guide li {
    padding: 20px 0;
  }

  .facility-directory__guide li + li {
    border-top: 1px solid #d2d2ce;
    border-left: 0;
    padding-left: 0;
  }

  .facility-directory__guide strong {
    margin-top: 10px;
  }
}

@media (max-width: 480px) {
  .facility-list__link {
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 14px;
    padding: 17px;
  }

  .facility-list__link > img,
  .facility-list__image-empty {
    width: 88px;
    height: 108px;
  }

  .facility-list__eyebrow {
    font-size: 8px;
  }

  .facility-list__meta {
    font-size: 12px;
  }

  .facility-list__number,
  .facility-list__arrow {
    display: none;
  }

  .facility-state {
    width: calc(100% - 40px);
    grid-template-columns: auto 1fr;
  }

  .facility-state > button {
    grid-column: 1 / -1;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .facility-list > li,
  .facility-search__control {
    transition: none;
  }
}
</style>

<style scoped>
.visually-hidden {
  position: absolute;
  overflow: hidden;
  width: 1px;
  height: 1px;
  margin: -1px;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.facility-directory__intro {
  background: #fafaf8;
}

.facility-directory__intro-inner {
  display: grid;
  width: min(1440px, calc(100% - 80px));
  grid-template-columns: minmax(420px, 492px) minmax(0, 1fr);
  align-items: end;
  gap: 0;
  padding: 28px 0 30px;
}

.facility-directory__heading {
  animation: facility-heading-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.facility-directory__heading > p {
  color: #666661;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.facility-directory__intro h1 {
  max-width: 720px;
  margin-top: 12px;
  font-size: clamp(36px, 3.05vw, 44px);
  font-variation-settings: 'opsz' 52, 'wght' 420;
  font-weight: 420;
  letter-spacing: -0.045em;
  line-height: 1.02;
}

.facility-directory__intro-inner > .facility-directory__lede {
  max-width: 660px;
  border-left: 1px solid #d6d6d1;
  padding: 7px 0 7px 38px;
  color: #3f3f3b;
  font-family: var(--font-sans);
  font-size: clamp(14px, 1.3vw, 17px);
  letter-spacing: -0.01em;
  line-height: 1.55;
  text-transform: none;
  animation: facility-lede-in 520ms 80ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.facility-browser {
  position: relative;
  overflow: hidden;
  background: #e9e9e5;
}

.facility-explorer {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  min-height: clamp(700px, calc(100dvh - 216px), 870px);
  background: #e7e7e3;
}

.facility-explorer__map {
  position: absolute;
  z-index: 0;
  inset: 0;
  background: #e7e7e3;
  animation: facility-map-in 700ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.facility-explorer__map :deep(.directory-map) {
  position: absolute;
  inset: 0;
  height: 100%;
  min-height: 100%;
  border: 0;
  border-radius: 0;
}

.facility-explorer__map :deep(.mapboxgl-canvas) {
  filter: contrast(0.97);
}

.facility-explorer__map :deep(.mapboxgl-ctrl-top-right) {
  top: 274px;
  right: 14px;
}

.facility-explorer__locate {
  position: absolute;
  z-index: 5;
  top: 220px;
  right: 14px;
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border: 1px solid #d3d3ce;
  border-radius: 4px;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 3px 12px rgb(0 0 0 / 10%);
  color: #111;
  cursor: pointer;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.facility-explorer__locate:hover {
  border-color: #999994;
  box-shadow: 0 6px 18px rgb(0 0 0 / 14%);
  transform: translateY(-2px);
}

.facility-explorer__locate:focus-visible {
  outline: 2px solid #111;
  outline-offset: 3px;
}

.facility-explorer__locate :deep(svg) {
  width: 19px;
  height: 19px;
}

.facility-explorer__search {
  position: absolute;
  z-index: 4;
  top: 20px;
  left: calc(50% + 168px);
  width: min(760px, calc(100% - 520px));
  transform: translateX(-50%);
  transition:
    left 320ms cubic-bezier(0.22, 1, 0.36, 1),
    width 320ms cubic-bezier(0.22, 1, 0.36, 1);
  animation: facility-search-in 520ms 140ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.facility-explorer--drawer-closed .facility-explorer__search {
  left: 50%;
  width: min(820px, calc(100% - 180px));
}

.facility-explorer__search-control {
  display: flex;
  min-height: 64px;
  align-items: center;
  gap: 14px;
  border: 1px solid rgb(17 17 17 / 10%);
  border-radius: 8px;
  padding: 0 18px;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 8px 28px rgb(0 0 0 / 10%);
  backdrop-filter: blur(8px);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.facility-explorer__search-control:has(input:focus-visible) {
  border-color: #111;
  box-shadow:
    0 0 0 1px #111,
    0 10px 32px rgb(0 0 0 / 12%);
  transform: translateY(-1px);
}

.facility-explorer__search-control > :deep(svg) {
  width: 21px;
  height: 21px;
  flex: 0 0 auto;
  color: #111;
}

.facility-explorer__search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  padding: 19px 0;
  background: transparent;
  color: #111;
  font: inherit;
  font-size: 15px;
}

.facility-explorer__search input:focus-visible {
  outline: none;
}

.facility-explorer__search input::placeholder {
  color: #777772;
}

.facility-explorer__search input::-webkit-search-cancel-button {
  appearance: none;
}

.facility-explorer__clear {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #555;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.facility-explorer__clear:hover {
  background: #efefec;
  color: #111;
}

.facility-explorer__clear :deep(svg) {
  width: 17px;
  height: 17px;
}

.facility-explorer__search-count {
  min-width: 112px;
  border-left: 1px solid #d9d9d5;
  padding: 6px 0 6px 20px;
  color: #555550;
  font-size: 13px;
  white-space: nowrap;
}

.facility-explorer__drawer {
  position: absolute;
  z-index: 3;
  top: 18px;
  bottom: 18px;
  left: 18px;
  display: flex;
  overflow: hidden;
  width: min(370px, calc(100% - 36px));
  flex-direction: column;
  border: 1px solid rgb(17 17 17 / 12%);
  border-radius: 8px;
  background: rgb(255 255 255 / 97%);
  box-shadow: 0 10px 32px rgb(0 0 0 / 12%);
  opacity: 1;
  transform: translateX(0);
  transition:
    opacity 280ms ease,
    transform 380ms cubic-bezier(0.22, 1, 0.36, 1);
  animation: facility-drawer-in 540ms 90ms cubic-bezier(0.22, 1, 0.36, 1) both;
  backdrop-filter: blur(10px);
}

.facility-explorer__drawer--closed {
  pointer-events: none;
  opacity: 0;
  transform: translateX(calc(-100% - 36px));
}

.facility-explorer__drawer-header {
  display: flex;
  min-height: 58px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #deded9;
  padding: 0 20px;
  color: #484844;
  font-size: 13px;
}

.facility-explorer__drawer-header button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #333;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    transform var(--transition-fast);
}

.facility-explorer__drawer-header button:hover {
  background: #efefec;
  transform: rotate(3deg);
}

.facility-explorer__drawer-header button :deep(svg) {
  width: 19px;
  height: 19px;
}

.facility-explorer__drawer-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #bcbcb7 transparent;
}

.facility-results {
  list-style: none;
}

.facility-results > li {
  position: relative;
  border-bottom: 1px solid #deded9;
  padding: 0 32px 26px;
  background: #fff;
  transition:
    background-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.facility-results > li::before {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 3px;
  background: #111;
  content: '';
  opacity: 0;
  transform: scaleY(0.35);
  transition:
    opacity var(--transition-fast),
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.facility-results > li:hover,
.facility-results > .facility-results__item--selected {
  background: #fdfdfb;
}

.facility-results > .facility-results__item--selected::before {
  opacity: 1;
  transform: scaleY(1);
}

.facility-results__summary {
  display: grid;
  width: 100%;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: start;
  gap: 16px;
  border: 0;
  padding: 33px 0 41px;
  background: transparent;
  color: #111;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.facility-results__number,
.facility-explorer__dock-number {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 50%;
  background: #111;
  color: #fff;
  font-size: 12px;
  font-weight: 650;
  transition:
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow var(--transition-fast);
}

.facility-results__item--selected .facility-results__number {
  box-shadow: 0 4px 10px rgb(0 0 0 / 18%);
  transform: scale(1.08);
}

.facility-results__copy {
  display: grid;
  min-width: 0;
  gap: 15px;
}

.facility-results__copy > strong {
  max-width: 260px;
  font-size: 25px;
  font-weight: 500;
  letter-spacing: -0.035em;
  line-height: 1.06;
}

.facility-results__copy > span {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  color: #5b5b56;
  font-size: 13px;
  line-height: 1.5;
}

.facility-results__copy > span :deep(svg) {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  margin-top: 2px;
  color: #333;
}

.facility-results__image,
.facility-results__image-empty {
  display: block;
  width: 100%;
  height: clamp(220px, 23vw, 286px);
  border: 1px solid #deded9;
  border-radius: 5px;
  object-fit: cover;
  transition:
    filter 350ms ease,
    transform 500ms cubic-bezier(0.22, 1, 0.36, 1);
}

.facility-results > li:hover .facility-results__image {
  filter: contrast(1.02);
  transform: scale(1.008);
}

.facility-results__image-empty {
  display: grid;
  place-items: center;
  background: #ecece8;
  color: #686863;
}

.facility-results__image-empty :deep(svg) {
  width: 30px;
  height: 30px;
}

.facility-results__actions {
  display: grid;
  gap: 12px;
  margin-top: 32px;
}

.facility-results__actions a {
  display: grid;
  min-height: 60px;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 11px;
  border: 1px solid #cfcfca;
  border-radius: 5px;
  padding: 11px 14px;
  background: #fff;
  color: #111;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition:
    border-color var(--transition-fast),
    background-color var(--transition-fast),
    color var(--transition-fast),
    transform var(--transition-fast);
}

.facility-results__actions a:last-child {
  border-color: #111;
  background: #111;
  color: #fff;
}

.facility-results__actions a:hover {
  border-color: #111;
  background: #f5f5f2;
  transform: translateY(-2px);
}

.facility-results__actions a:last-child:hover {
  background: #333;
}

.facility-results__actions a :deep(svg) {
  width: 17px;
  height: 17px;
}

.facility-results__actions a :deep(svg:last-child) {
  transition: transform var(--transition-fast);
}

.facility-results__actions a:hover :deep(svg:last-child) {
  transform: translateX(3px);
}

.facility-explorer__empty {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 14px;
  padding: 28px 24px;
}

.facility-explorer__empty > :deep(svg) {
  width: 21px;
  height: 21px;
}

.facility-explorer__empty strong {
  font-size: 15px;
}

.facility-explorer__empty p {
  margin-top: 7px;
  color: #666661;
  font-size: 13px;
  line-height: 1.55;
}

.facility-explorer__empty button {
  grid-column: 2;
  width: fit-content;
  margin-top: 4px;
  border: 0;
  border-bottom: 1px solid currentColor;
  padding: 3px 0;
  background: transparent;
  color: #111;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}

.facility-explorer__show-drawer {
  position: absolute;
  z-index: 4;
  top: 20px;
  left: 20px;
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  gap: 9px;
  border: 1px solid rgb(17 17 17 / 14%);
  border-radius: 6px;
  padding: 10px 14px;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 7px 22px rgb(0 0 0 / 10%);
  color: #111;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  animation: facility-control-in 280ms ease both;
}

.facility-explorer__show-drawer :deep(svg) {
  width: 17px;
  height: 17px;
}

.facility-explorer__dock {
  position: absolute;
  z-index: 4;
  bottom: 20px;
  left: 420px;
  display: grid;
  overflow: hidden;
  width: min(520px, calc(100% - 460px));
  min-height: 84px;
  grid-template-columns: 96px 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  border: 1px solid rgb(17 17 17 / 14%);
  border-radius: 8px;
  padding: 10px 18px 10px 10px;
  background: rgb(255 255 255 / 97%);
  box-shadow: 0 10px 32px rgb(0 0 0 / 13%);
  color: #111;
  text-decoration: none;
  backdrop-filter: blur(10px);
  transition:
    left 320ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow var(--transition-fast),
    transform var(--transition-fast);
}

.facility-explorer--drawer-closed .facility-explorer__dock {
  left: 20px;
}

.facility-explorer__dock:hover {
  box-shadow: 0 14px 38px rgb(0 0 0 / 16%);
  transform: translateY(-3px);
}

.facility-explorer__dock > img,
.facility-explorer__dock-image-empty {
  display: block;
  width: 96px;
  height: 64px;
  border-radius: 4px;
  object-fit: cover;
}

.facility-explorer__dock-image-empty {
  display: grid;
  place-items: center;
  background: #ecece8;
}

.facility-explorer__dock-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.facility-explorer__dock-copy strong {
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.facility-explorer__dock-copy span {
  overflow: hidden;
  color: #666661;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.facility-explorer__dock > :deep(svg) {
  width: 18px;
  height: 18px;
}

.facility-explorer__mobile-tabs {
  display: none;
}

.facility-dock-enter-active,
.facility-dock-leave-active {
  transition:
    opacity 220ms ease,
    transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

.facility-dock-enter-from,
.facility-dock-leave-to {
  opacity: 0;
  transform: translateY(18px);
}

@keyframes facility-heading-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}

@keyframes facility-lede-in {
  from {
    opacity: 0;
    transform: translateX(14px);
  }
}

@keyframes facility-map-in {
  from {
    opacity: 0;
    filter: saturate(0);
  }
}

@keyframes facility-search-in {
  from {
    opacity: 0;
    transform: translate(-50%, -14px);
  }
}

@keyframes facility-drawer-in {
  from {
    opacity: 0;
    transform: translateX(-24px);
  }
}

@keyframes facility-control-in {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
}

@media (max-width: 1080px) {
  .facility-directory__intro-inner {
    grid-template-columns: minmax(360px, 1fr) minmax(300px, 0.8fr);
    gap: 40px;
  }

  .facility-explorer__drawer {
    width: 340px;
  }

  .facility-explorer__search {
    left: calc(50% + 145px);
    width: min(650px, calc(100% - 470px));
  }

  .facility-explorer__dock {
    left: 390px;
    width: min(480px, calc(100% - 430px));
  }
}

@media (max-width: 760px) {
  .facility-directory__intro-inner {
    display: grid;
    width: min(100% - 40px, 620px);
    grid-template-columns: 1fr;
    gap: 22px;
    padding: 28px 0 30px;
  }

  .facility-directory__intro h1 {
    font-size: clamp(36px, 10vw, 48px);
  }

  .facility-directory__lede {
    border-top: 1px solid #d6d6d1;
    border-left: 0;
    padding: 18px 0 0;
    font-size: 15px;
  }

  .facility-explorer {
    display: flex;
    min-height: 680px;
    flex-direction: column;
    overflow: hidden;
  }

  .facility-explorer__mobile-tabs {
    position: relative;
    z-index: 5;
    display: grid;
    order: 0;
    grid-template-columns: 1fr 1fr;
    border-bottom: 1px solid #d5d5d0;
    background: #fafaf8;
    padding: 10px 20px;
  }

  .facility-explorer__mobile-tabs button {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid #c9c9c4;
    background: #fff;
    color: #555;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }

  .facility-explorer__mobile-tabs button + button {
    border-left: 0;
  }

  .facility-explorer__mobile-tabs button[aria-pressed='true'] {
    border-color: #111;
    background: #111;
    color: #fff;
  }

  .facility-explorer__search,
  .facility-explorer--drawer-closed .facility-explorer__search {
    position: relative;
    top: auto;
    left: auto;
    order: 1;
    width: auto;
    margin: 14px 20px;
    transform: none;
    animation: none;
  }

  .facility-explorer__search-control {
    min-height: 54px;
    border-radius: 6px;
    padding: 0 14px;
    box-shadow: 0 5px 16px rgb(0 0 0 / 8%);
  }

  .facility-explorer__search input {
    padding: 15px 0;
    font-size: 14px;
  }

  .facility-explorer__search-count {
    display: none;
  }

  .facility-explorer__map {
    position: relative;
    z-index: 1;
    inset: auto;
    order: 3;
    min-height: 560px;
    flex: 1;
    animation: none;
  }

  .facility-explorer__map--mobile-hidden {
    display: none;
  }

  .facility-explorer__map :deep(.mapboxgl-ctrl-top-right) {
    top: 150px;
    right: 12px;
  }

  .facility-explorer__locate {
    top: 96px;
    right: 12px;
  }

  .facility-explorer__drawer,
  .facility-explorer__drawer--closed {
    position: relative;
    z-index: 2;
    inset: auto;
    display: flex;
    order: 2;
    width: 100%;
    min-height: 560px;
    flex: 1;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    opacity: 1;
    transform: none;
    animation: none;
    backdrop-filter: none;
  }

  .facility-explorer__drawer--mobile-hidden {
    display: none;
  }

  .facility-explorer__drawer-header {
    min-height: 50px;
  }

  .facility-explorer__drawer-header button {
    display: none;
  }

  .facility-explorer__drawer-body {
    overflow-y: visible;
  }

  .facility-results > li {
    padding: 0 20px 24px;
  }

  .facility-results__copy > strong {
    font-size: 22px;
  }

  .facility-results__image {
    height: min(72vw, 320px);
  }

  .facility-explorer__show-drawer,
  .facility-explorer__dock {
    display: none;
  }

  .facility-explorer__dock--mobile-visible {
    top: 164px;
    right: 16px;
    bottom: auto;
    left: 16px;
    display: grid;
    width: auto;
    grid-template-columns: 54px 30px minmax(0, 1fr) auto;
    gap: 10px;
    padding: 8px 12px 8px 8px;
  }

  .facility-explorer__dock--mobile-visible > img,
  .facility-explorer__dock--mobile-visible .facility-explorer__dock-image-empty {
    width: 54px;
    height: 48px;
  }

  .facility-explorer__map :deep(.directory-map) {
    position: absolute;
  }
}

@media (max-width: 430px) {
  .facility-directory__intro h1 {
    font-size: 36px;
  }

  .facility-results__summary {
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 13px;
  }

  .facility-results__number {
    width: 30px;
    height: 30px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .facility-directory__heading,
  .facility-directory__lede,
  .facility-explorer__map,
  .facility-explorer__search,
  .facility-explorer__drawer,
  .facility-explorer__show-drawer {
    animation: none;
  }

  .facility-explorer__search,
  .facility-explorer__search-control,
  .facility-explorer__drawer,
  .facility-explorer__drawer-header button,
  .facility-explorer__locate,
  .facility-results > li,
  .facility-results > li::before,
  .facility-results__number,
  .facility-results__image,
  .facility-results__actions a,
  .facility-results__actions a :deep(svg:last-child),
  .facility-explorer__dock,
  .facility-dock-enter-active,
  .facility-dock-leave-active {
    scroll-behavior: auto;
    transition: none;
  }

  .facility-explorer__drawer-header button:hover {
    transform: none;
  }

  .facility-explorer__locate:hover {
    transform: none;
  }

  .facility-state__loader {
    animation: none;
  }
}
</style>
