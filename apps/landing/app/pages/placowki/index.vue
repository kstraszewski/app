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

function facilityHref(facility: Pick<DirectoryFacility, 'organizationSlug' | 'facilitySlug'>) {
  return `/placowki/${encodeURIComponent(facility.organizationSlug)}/${encodeURIComponent(facility.facilitySlug)}`
}

function selectFacility(facilityId: string) {
  selectedFacilityId.value = facilityId
}

function selectFacilityFromMap(facilityId: string) {
  selectedFacilityId.value = facilityId
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
          <p>Placówki</p>
          <h1 id="facility-directory-title">Wybierz placówkę</h1>

          <div class="facility-search">
            <label for="facility-search">Szukaj placówki</label>
            <div class="facility-search__control">
              <Icon name="lucide:search" aria-hidden="true" />
              <input
                id="facility-search"
                v-model="search"
                type="search"
                autocomplete="off"
                placeholder="Nazwa, miasto, adres lub usługa"
                :aria-describedby="'facility-search-results'"
              >
              <button v-if="search" type="button" @click="search = ''">Wyczyść</button>
            </div>
            <span id="facility-search-results" class="visually-hidden" aria-live="polite">
              {{ resultText }}
            </span>
          </div>
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

        <div v-else class="facility-browser__shell">
          <div class="facility-browser__mobile-tabs" aria-label="Sposób przeglądania placówek">
            <button
              type="button"
              :aria-pressed="mobileView === 'list'"
              @click="mobileView = 'list'"
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
            class="facility-browser__list"
            :class="{ 'facility-browser__list--mobile-hidden': mobileView !== 'list' }"
          >
            <p class="facility-browser__count">{{ resultText }}</p>

            <div v-if="facilities.length === 0" class="facility-browser__empty">
              <Icon name="lucide:landmark" aria-hidden="true" />
              <div>
                <strong>Katalog placówek jest jeszcze pusty</strong>
                <p>Placówki pojawią się tutaj, gdy udostępnią aktywny kalendarz konsultacji.</p>
              </div>
            </div>

            <div v-else-if="visibleFacilities.length === 0" class="facility-browser__empty">
              <Icon name="lucide:search" aria-hidden="true" />
              <div>
                <strong>Nie znaleźliśmy takiej placówki</strong>
                <p>Spróbuj wpisać inne miasto, usługę lub krótszy fragment adresu.</p>
              </div>
              <button type="button" @click="search = ''">Wyczyść wyszukiwanie</button>
            </div>

            <ol v-else class="facility-list">
              <li
                v-for="(facility, index) in visibleFacilities"
                :key="facility.facilityId"
                :class="{ 'facility-list__item--selected': selectedFacilityId === facility.facilityId }"
                @mouseenter="selectFacility(facility.facilityId)"
                @focusin="selectFacility(facility.facilityId)"
              >
                <NuxtLink
                  :to="facilityHref(facility)"
                  class="facility-list__link"
                  :aria-label="`Zobacz placówkę ${facility.name}`"
                >
                  <img
                    v-if="facility.coverImage"
                    :src="facility.coverImage.thumbnailUrl"
                    :alt="facility.coverImage.alt"
                    width="148"
                    height="148"
                    loading="lazy"
                    decoding="async"
                  >
                  <span v-else class="facility-list__image-empty" aria-hidden="true">
                    <Icon name="lucide:landmark" />
                  </span>

                  <span class="facility-list__content">
                    <span class="facility-list__eyebrow">Placówka OpenExpert</span>
                    <strong>{{ facility.name }}</strong>
                    <span v-if="facility.address" class="facility-list__meta">
                      <Icon name="lucide:map-pin" aria-hidden="true" />
                      {{ facility.address }}
                    </span>
                    <span class="facility-list__meta">
                      <Icon name="lucide:users-round" aria-hidden="true" />
                      {{ facility.experts.length }}
                      {{ facility.experts.length === 1 ? 'ekspert' : 'ekspertów' }}
                    </span>
                  </span>

                  <span class="facility-list__number" aria-hidden="true">{{ index + 1 }}</span>
                  <Icon class="facility-list__arrow" name="lucide:arrow-right" aria-hidden="true" />
                </NuxtLink>
              </li>
            </ol>

            <button
              v-if="visibleFacilities.length"
              type="button"
              class="facility-browser__show-map"
              @click="mobileView = 'map'"
            >
              <Icon name="lucide:map-pin" aria-hidden="true" />
              Pokaż mapę
            </button>
          </div>

          <div
            class="facility-browser__map"
            :class="{ 'facility-browser__map--mobile-hidden': mobileView !== 'map' }"
          >
            <DirectoryMap
              :markers="mapMarkers"
              :selected-facility-id="selectedFacilityId"
              presentation="compact"
              height="100%"
              aria-label="Mapa placówek OpenExpert"
              @select="selectFacilityFromMap"
              @update:selected-facility-id="selectFacilityFromMap"
            />
          </div>
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
