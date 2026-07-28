<script setup lang="ts">
import type {
  DirectoryFacilityDetail,
  DirectoryFacilityDetailExpert,
  DirectoryFacilityOpeningHour,
} from '#shared/types/directory'
import { directoryBookingUrl } from '~/utils/directory'

const route = useRoute()
const runtimeConfig = useRuntimeConfig()

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

const organizationSlug = computed(() => routeParam(route.params.organizationSlug))
const facilitySlug = computed(() => routeParam(route.params.facilitySlug))
const detailEndpoint = computed(() => (
  `/api/directory/facilities/${encodeURIComponent(organizationSlug.value)}/${encodeURIComponent(facilitySlug.value)}`
))

const {
  data: facility,
  status,
  error,
  refresh,
} = await useFetch<DirectoryFacilityDetail>(detailEndpoint, {
  key: `openexpert-facility-${organizationSlug.value}-${facilitySlug.value}`,
})

if (import.meta.server && error.value) {
  const statusCode = Number(error.value.statusCode || error.value.status || 503)
  throw createError({
    statusCode,
    statusMessage: statusCode === 404
      ? 'Nie znaleziono placówki.'
      : 'Szczegóły placówki są chwilowo niedostępne.',
  })
}

const crmBaseUrl = String(
  runtimeConfig.public.openexpert.crmBaseUrl || 'http://127.0.0.1:3004',
)

const bookingHref = computed(() => (
  facility.value
    ? directoryBookingUrl(crmBaseUrl, facility.value.widgetKey)
    : '/placowki'
))

const addressLines = computed(() => {
  if (!facility.value) return []

  const firstLine = [
    facility.value.addressLine1,
    facility.value.addressLine2,
  ].filter(Boolean).join(', ')
  const secondLine = [
    facility.value.postalCode,
    facility.value.city,
  ].filter(Boolean).join(' ')

  const lines = [firstLine, secondLine].filter(Boolean)
  return lines.length ? lines : [facility.value.address].filter(Boolean) as string[]
})

const phoneHref = computed(() => (
  facility.value?.contact.phone
    ? `tel:${facility.value.contact.phone.replace(/[^\d+]/g, '')}`
    : null
))
const emailHref = computed(() => (
  facility.value?.contact.email
    ? `mailto:${facility.value.contact.email}`
    : null
))

const directionsHref = computed(() => {
  if (!facility.value) return '#'

  const destination = facility.value.coordinates
    ? `${facility.value.coordinates.latitude},${facility.value.coordinates.longitude}`
    : (facility.value.address || addressLines.value.join(', '))

  const url = new URL('https://www.google.com/maps/dir/')
  url.searchParams.set('api', '1')
  url.searchParams.set('destination', destination)
  return url.toString()
})

const mapMarkers = computed(() => {
  if (!facility.value?.coordinates) return []

  return [{
    facilityId: facility.value.facilityId,
    name: facility.value.name,
    address: facility.value.address,
    latitude: facility.value.coordinates.latitude,
    longitude: facility.value.coordinates.longitude,
    bookingHref: bookingHref.value,
  }]
})

const mapError = ref<string | null>(null)
const shareStatus = ref('')
let shareStatusTimer: ReturnType<typeof setTimeout> | undefined

async function shareFacility() {
  if (!facility.value || !import.meta.client) return

  const shareData = {
    title: facility.value.name,
    text: `Sprawdź placówkę ${facility.value.name} w OpenExpert.`,
    url: window.location.href,
  }

  try {
    if (navigator.share) {
      await navigator.share(shareData)
      shareStatus.value = 'Udostępniono'
    } else {
      await navigator.clipboard.writeText(shareData.url)
      shareStatus.value = 'Link skopiowany'
    }
  } catch (shareError) {
    if (shareError instanceof DOMException && shareError.name === 'AbortError') return
    shareStatus.value = 'Nie udało się skopiować linku'
  }

  clearTimeout(shareStatusTimer)
  shareStatusTimer = setTimeout(() => {
    shareStatus.value = ''
  }, 2800)
}

function bookingHrefForExpert(expert: DirectoryFacilityDetailExpert): string {
  if (!facility.value) return bookingHref.value
  return directoryBookingUrl(crmBaseUrl, facility.value.widgetKey, expert.expertId)
}

const serviceNamesById = computed(() => new Map(
  (facility.value?.services ?? []).map(service => [service.serviceId, service.name]),
))

function expertServices(expert: DirectoryFacilityDetailExpert): string {
  const names = expert.serviceIds
    .map(serviceId => serviceNamesById.value.get(serviceId))
    .filter((name): name is string => Boolean(name))

  return names.length
    ? names.slice(0, 2).join(' · ')
    : 'Konsultacje dostępne w placówce'
}

const expertCountLabel = computed(() => {
  const count = facility.value?.experts.length ?? 0
  if (count === 1) return '1 ekspert'
  const lastTwo = count % 100
  const last = count % 10
  if ((lastTwo < 12 || lastTwo > 14) && last >= 2 && last <= 4) {
    return `${count} ekspertów`
  }
  return `${count} ekspertów`
})

const weekdayNames = [
  'Poniedziałek',
  'Wtorek',
  'Środa',
  'Czwartek',
  'Piątek',
  'Sobota',
  'Niedziela',
]
const schemaWeekdays = [
  'https://schema.org/Monday',
  'https://schema.org/Tuesday',
  'https://schema.org/Wednesday',
  'https://schema.org/Thursday',
  'https://schema.org/Friday',
  'https://schema.org/Saturday',
  'https://schema.org/Sunday',
]

interface OpeningHoursRow {
  weekday: number
  label: string
  hours: string
}

function formatOpeningTime(value: string): string {
  return value.slice(0, 5)
}

const openingHoursRows = computed<OpeningHoursRow[]>(() => {
  const rangesByDay = new Map<number, DirectoryFacilityOpeningHour[]>()
  for (const range of facility.value?.openingHours ?? []) {
    const current = rangesByDay.get(range.weekday) ?? []
    current.push(range)
    rangesByDay.set(range.weekday, current)
  }

  return [...rangesByDay.entries()]
    .sort(([left], [right]) => left - right)
    .map(([weekday, ranges]) => ({
      weekday,
      label: weekdayNames[weekday] ?? `Dzień ${weekday + 1}`,
      hours: ranges
        .map(range => `${formatOpeningTime(range.opensAt)}–${formatOpeningTime(range.closesAt)}`)
        .join(', '),
    }))
})

const seoTitle = facility.value
  ? `${facility.value.name} — konsultacje | OpenExpert`
  : 'Placówka OpenExpert — konsultacje'
const seoDescription = facility.value?.description
  || 'Sprawdź lokalizację, dostępne konsultacje i ekspertów placówki OpenExpert.'
const { canonicalUrl, siteOrigin } = useLandingSeo({
  title: seoTitle,
  description: seoDescription,
  path: route.path,
  socialImagePath: '/placowki-og.png',
  socialImageAlt: facility.value
    ? `${facility.value.name} — placówka OpenExpert`
    : 'Placówka OpenExpert',
})

useHead(() => {
  if (!facility.value) return {}

  const currentFacility = facility.value
  const structuredAddress = {
    '@type': 'PostalAddress',
    streetAddress: [currentFacility.addressLine1, currentFacility.addressLine2]
      .filter(Boolean)
      .join(', ') || undefined,
    postalCode: currentFacility.postalCode || undefined,
    addressLocality: currentFacility.city || undefined,
    addressCountry: currentFacility.countryCode || undefined,
  }

  return {
    script: [{
      key: `structured-data:facility:${currentFacility.facilityId}`,
      type: 'application/ld+json',
      innerHTML: serializeLandingStructuredData({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'LocalBusiness',
            '@id': `${canonicalUrl}#placowka`,
            url: canonicalUrl,
            name: currentFacility.name,
            description: currentFacility.description || undefined,
            image: currentFacility.gallery.map(image => image.fallbackUrl),
            address: structuredAddress,
            telephone: currentFacility.contact.phone || undefined,
            email: currentFacility.contact.email || undefined,
            geo: currentFacility.coordinates
              ? {
                  '@type': 'GeoCoordinates',
                  latitude: currentFacility.coordinates.latitude,
                  longitude: currentFacility.coordinates.longitude,
                }
              : undefined,
            openingHoursSpecification: currentFacility.openingHours.map(range => ({
              '@type': 'OpeningHoursSpecification',
              dayOfWeek: schemaWeekdays[range.weekday],
              opens: range.opensAt,
              closes: range.closesAt,
            })),
            employee: currentFacility.experts.map(expert => ({
              '@type': 'Person',
              name: expert.name,
              image: expert.avatarUrl
                ? new URL(expert.avatarUrl, `${siteOrigin}/`).toString()
                : undefined,
            })),
            makesOffer: currentFacility.services.map(service => ({
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: service.name,
                description: service.description || undefined,
              },
            })),
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
                item: `${siteOrigin}/placowki`,
              },
              {
                '@type': 'ListItem',
                position: 3,
                name: currentFacility.name,
                item: canonicalUrl,
              },
            ],
          },
        ],
      }),
    }],
  }
})

onBeforeUnmount(() => {
  clearTimeout(shareStatusTimer)
})
</script>

<template>
  <div class="facility-detail-page">
    <DirectorySiteHeader
      active="facilities"
      :cta-href="bookingHref"
      cta-label="Zobacz terminy"
    />

    <main id="directory-content" tabindex="-1">
      <section
        v-if="status === 'pending' || status === 'idle'"
        class="facility-detail-state"
        role="status"
        aria-live="polite"
      >
        <Icon name="lucide:building-2" aria-hidden="true" />
        <p>Ładujemy szczegóły placówki…</p>
      </section>

      <section
        v-else-if="error || !facility"
        class="facility-detail-state"
        role="alert"
      >
        <Icon name="lucide:triangle-alert" aria-hidden="true" />
        <h1>Nie udało się otworzyć placówki</h1>
        <p>Odśwież widok albo wróć do katalogu i wybierz placówkę ponownie.</p>
        <div>
          <button type="button" @click="refresh()">
            <Icon name="lucide:rotate-ccw" aria-hidden="true" />
            Spróbuj ponownie
          </button>
          <NuxtLink to="/placowki">Wróć do placówek</NuxtLink>
        </div>
      </section>

      <template v-else>
        <div class="facility-detail-layout">
          <div class="facility-detail-main">
            <nav class="facility-detail-breadcrumb" aria-label="Okruszki">
              <NuxtLink to="/">OpenExpert</NuxtLink>
              <span aria-hidden="true">/</span>
              <NuxtLink to="/placowki">Placówki</NuxtLink>
              <span aria-hidden="true">/</span>
              <span aria-current="page">{{ facility.name }}</span>
            </nav>

            <section class="facility-detail-overview" aria-labelledby="facility-title">
              <DirectoryFacilityGallery
                :facility-name="facility.name"
                :images="facility.gallery"
              />

              <div class="facility-detail-summary">
                <div class="facility-detail-summary__eyebrow">
                  <p>Placówka OpenExpert</p>
                  <button
                    type="button"
                    :aria-label="`Udostępnij placówkę ${facility.name}`"
                    @click="shareFacility"
                  >
                    <Icon name="lucide:share-2" aria-hidden="true" />
                    Udostępnij
                  </button>
                </div>

                <h1 id="facility-title">{{ facility.name }}</h1>

                <address class="facility-detail-contact">
                  <p v-if="facility.address">
                    <Icon name="lucide:map-pin" aria-hidden="true" />
                    <span>{{ facility.address }}</span>
                  </p>
                  <a v-if="facility.contact.phone && phoneHref" :href="phoneHref">
                    <Icon name="lucide:phone" aria-hidden="true" />
                    {{ facility.contact.phone }}
                  </a>
                  <a v-if="facility.contact.email && emailHref" :href="emailHref">
                    <Icon name="lucide:mail" aria-hidden="true" />
                    {{ facility.contact.email }}
                  </a>
                </address>

                <p class="facility-detail-share-status" aria-live="polite">
                  {{ shareStatus }}
                </p>

                <div class="facility-detail-about">
                  <h2>O placówce</h2>
                  <p>
                    {{ facility.description || 'W tej placówce porównasz dostępne opcje i omówisz swoją sprawę z wybranym ekspertem. Wybierz konsultację i zarezerwuj dogodny termin online.' }}
                  </p>
                </div>
              </div>
            </section>

            <section
              id="konsultacje"
              class="facility-detail-section"
              aria-labelledby="facility-services-title"
            >
              <div class="facility-detail-section__heading">
                <div>
                  <p>Dostępna oferta</p>
                  <h2 id="facility-services-title">Dostępne konsultacje</h2>
                </div>
                <span>{{ facility.services.length }}</span>
              </div>

              <div v-if="facility.services.length" class="facility-detail-services">
                <article
                  v-for="(service, index) in facility.services"
                  :key="service.serviceId"
                >
                  <span class="facility-detail-service__icon" aria-hidden="true">
                    <Icon :name="index % 2 ? 'lucide:file-text' : 'lucide:calendar-days'" />
                  </span>
                  <div>
                    <h3>
                      {{ service.name }}
                      <span v-if="service.durationMinutes">· {{ service.durationMinutes }} min</span>
                    </h3>
                    <p>
                      {{ service.description || 'Porozmawiaj z ekspertem, uporządkuj dostępne rozwiązania i zaplanuj kolejne kroki.' }}
                    </p>
                  </div>
                  <a :href="bookingHref">
                    Zobacz terminy
                    <Icon name="lucide:arrow-right" aria-hidden="true" />
                  </a>
                </article>
              </div>
              <p v-else class="facility-detail-empty-copy">
                Zakres konsultacji zobaczysz w aktualnym kalendarzu rezerwacji.
              </p>
            </section>

            <section
              class="facility-detail-section"
              aria-labelledby="facility-experts-title"
            >
              <div class="facility-detail-section__heading">
                <div>
                  <p>Zespół placówki</p>
                  <h2 id="facility-experts-title">Eksperci</h2>
                </div>
                <span>{{ expertCountLabel }}</span>
              </div>

              <div v-if="facility.experts.length" class="facility-detail-experts">
                <article
                  v-for="expert in facility.experts"
                  :key="expert.expertId"
                >
                  <span class="facility-detail-expert__avatar" aria-hidden="true">
                    <img
                      v-if="expert.avatarUrl"
                      :src="expert.avatarUrl"
                      alt=""
                      width="96"
                      height="96"
                    >
                    <Icon v-else name="lucide:user-round" />
                  </span>
                  <div>
                    <h3>{{ expert.name }}</h3>
                    <p>{{ expertServices(expert) }}</p>
                  </div>
                  <a :href="bookingHrefForExpert(expert)">
                    Zobacz terminy
                    <Icon name="lucide:arrow-right" aria-hidden="true" />
                  </a>
                </article>
              </div>
              <p v-else class="facility-detail-empty-copy">
                Najbliższy dostępny ekspert zostanie pokazany podczas rezerwacji.
              </p>
            </section>
          </div>

          <aside class="facility-detail-rail" aria-label="Lokalizacja i rezerwacja">
            <div class="facility-detail-rail__sticky">
              <div class="facility-detail-map">
                <ClientOnly>
                  <DirectoryMap
                    v-if="mapMarkers.length"
                    :markers="mapMarkers"
                    :selected-facility-id="facility.facilityId"
                    presentation="detail"
                    height="clamp(330px, 35vw, 446px)"
                    :aria-label="`Mapa z lokalizacją placówki ${facility.name}`"
                    @ready="mapError = null"
                    @error="mapError = $event"
                  />
                  <div
                    v-else
                    class="facility-detail-map__fallback"
                    role="img"
                    :aria-label="`Lokalizacja placówki ${facility.name}`"
                  >
                    <Icon name="lucide:map-pin" aria-hidden="true" />
                    <span>{{ facility.city || 'Lokalizacja placówki' }}</span>
                  </div>
                  <template #fallback>
                    <div class="facility-detail-map__fallback" role="status">
                      <Icon name="lucide:map-pin" aria-hidden="true" />
                      <span>Ładujemy mapę…</span>
                    </div>
                  </template>
                </ClientOnly>
              </div>

              <div class="facility-detail-rail__content">
                <div class="facility-detail-rail__address">
                  <Icon name="lucide:map-pin" aria-hidden="true" />
                  <address>
                    <span v-for="line in addressLines" :key="line">{{ line }}</span>
                    <span v-if="!addressLines.length">Adres dostępny po rezerwacji</span>
                  </address>
                </div>

                <a
                  class="facility-detail-directions"
                  :href="directionsHref"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="lucide:navigation" aria-hidden="true" />
                  Jak dojechać
                </a>

                <p v-if="mapError" class="facility-detail-map__notice" role="status">
                  Mapa jest chwilowo niedostępna. Adres i przycisk dojazdu nadal działają.
                </p>

                <div class="facility-detail-booking">
                  <a :href="bookingHref">
                    Zobacz terminy
                    <Icon name="lucide:arrow-right" aria-hidden="true" />
                  </a>
                  <p>Wybierz konsultację, eksperta i sprawdź dostępne terminy.</p>
                </div>

                <div v-if="openingHoursRows.length" class="facility-detail-hours">
                  <h2>
                    <Icon name="lucide:clock-3" aria-hidden="true" />
                    Godziny otwarcia
                  </h2>
                  <dl>
                    <div v-for="row in openingHoursRows" :key="row.weekday">
                      <dt>{{ row.label }}</dt>
                      <dd>{{ row.hours }}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </aside>
        </div>

        <div class="facility-detail-mobile-booking">
          <a :href="bookingHref">
            Zobacz terminy
            <Icon name="lucide:arrow-right" aria-hidden="true" />
          </a>
        </div>
      </template>
    </main>

    <DirectorySiteFooter />
  </div>
</template>

<style scoped>
.facility-detail-page {
  min-width: 0;
  background: #fbfaf8;
  color: #111;
  font-family: var(--font-sans);
}

#directory-content:focus {
  outline: none;
}

.facility-detail-layout {
  display: grid;
  max-width: 1536px;
  grid-template-columns: minmax(0, 2.16fr) minmax(365px, 0.94fr);
  margin: 0 auto;
}

.facility-detail-main {
  min-width: 0;
  padding: 34px clamp(32px, 3vw, 46px) 68px;
}

.facility-detail-breadcrumb {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 16px;
  margin-bottom: 32px;
  color: #777;
  font-size: 13px;
}

.facility-detail-breadcrumb a {
  color: #555;
  text-decoration: none;
}

.facility-detail-breadcrumb a:hover {
  color: #111;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.facility-detail-breadcrumb span[aria-current='page'] {
  overflow: hidden;
  color: #444;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.facility-detail-overview {
  display: grid;
  grid-template-columns: minmax(0, 1.52fr) minmax(290px, 0.9fr);
  align-items: start;
  gap: clamp(34px, 4vw, 56px);
}

.facility-detail-summary {
  min-width: 0;
  padding-top: 8px;
}

.facility-detail-summary__eyebrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.facility-detail-summary__eyebrow p,
.facility-detail-section__heading > div > p {
  color: #626260;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.facility-detail-summary__eyebrow button {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  gap: 7px;
  border: 0;
  padding: 7px 0;
  background: transparent;
  color: #555;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
}

.facility-detail-summary__eyebrow button:hover {
  color: #111;
}

.facility-detail-summary__eyebrow button :deep(svg) {
  width: 14px;
  height: 14px;
}

.facility-detail-summary h1 {
  max-width: 410px;
  margin-top: 11px;
  font-size: clamp(31px, 3vw, 43px);
  font-variation-settings: 'opsz' 43, 'wght' 450;
  font-weight: 450;
  letter-spacing: -0.045em;
  line-height: 1.06;
}

.facility-detail-contact {
  display: grid;
  gap: 13px;
  margin-top: 27px;
  color: #555;
  font-size: 14px;
  font-style: normal;
}

.facility-detail-contact :is(p, a) {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 11px;
  color: inherit;
  line-height: 1.45;
  text-decoration: none;
}

.facility-detail-contact a:hover {
  color: #111;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.facility-detail-contact :deep(svg) {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  margin-top: 2px;
  stroke-width: 1.65;
}

.facility-detail-share-status {
  min-height: 17px;
  margin-top: 8px;
  color: #555;
  font-size: 11px;
}

.facility-detail-about {
  margin-top: 18px;
  border-top: 1px solid #d5d4d0;
  padding-top: 24px;
}

.facility-detail-about h2 {
  font-size: 15px;
  font-weight: 600;
}

.facility-detail-about p {
  margin-top: 10px;
  color: #555;
  font-size: 13px;
  line-height: 1.62;
}

.facility-detail-section {
  margin-top: 34px;
  border-top: 1px solid #cfcfca;
  padding-top: 28px;
}

.facility-detail-section__heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 6px;
}

.facility-detail-section__heading > div > p {
  margin-bottom: 7px;
}

.facility-detail-section__heading h2 {
  font-size: clamp(23px, 2.3vw, 29px);
  font-variation-settings: 'opsz' 29, 'wght' 500;
  font-weight: 500;
  letter-spacing: -0.035em;
}

.facility-detail-section__heading > span {
  color: #666;
  font-size: 11px;
}

.facility-detail-services article,
.facility-detail-experts article {
  display: grid;
  min-height: 72px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  border-bottom: 1px solid #d9d8d4;
  padding: 10px 8px 10px 0;
}

.facility-detail-service__icon,
.facility-detail-expert__avatar {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid #d1d0cc;
  border-radius: 50%;
  background: #fff;
  color: #222;
}

.facility-detail-expert__avatar img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.facility-detail-service__icon :deep(svg),
.facility-detail-expert__avatar :deep(svg) {
  width: 20px;
  height: 20px;
  stroke-width: 1.55;
}

.facility-detail-services h3,
.facility-detail-experts h3 {
  font-size: 14px;
  font-weight: 650;
  line-height: 1.3;
}

.facility-detail-services h3 span {
  font-weight: 400;
}

.facility-detail-services p,
.facility-detail-experts p {
  margin-top: 3px;
  color: #60605e;
  font-size: 11px;
  line-height: 1.45;
}

.facility-detail-services article > a,
.facility-detail-experts article > a {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  gap: 10px;
  color: #111;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
}

.facility-detail-services article > a:hover,
.facility-detail-experts article > a:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}

.facility-detail-services article > a :deep(svg),
.facility-detail-experts article > a :deep(svg) {
  width: 15px;
  height: 15px;
}

.facility-detail-empty-copy {
  margin-top: 16px;
  border: 1px solid #d4d3cf;
  border-radius: 4px;
  padding: 20px;
  color: #666;
  font-size: 13px;
}

.facility-detail-rail {
  min-width: 0;
  border-left: 1px solid #d8d8d4;
}

.facility-detail-rail__sticky {
  position: sticky;
  top: 0;
}

.facility-detail-map {
  min-height: 330px;
  border-bottom: 1px solid #d8d8d4;
  padding: 20px 16px 0;
}

.facility-detail-map__fallback {
  display: grid;
  min-height: clamp(330px, 35vw, 446px);
  place-items: center;
  align-content: center;
  gap: 12px;
  border-radius: 5px 5px 0 0;
  background: #e9e9e5;
  color: #646462;
  font-size: 13px;
}

.facility-detail-map__fallback :deep(svg) {
  width: 34px;
  height: 34px;
  stroke-width: 1.4;
}

.facility-detail-rail__content {
  padding: 30px clamp(30px, 3.2vw, 54px) 44px;
}

.facility-detail-rail__address {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 14px;
  color: #222;
}

.facility-detail-rail__address > :deep(svg) {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  stroke-width: 1.55;
}

.facility-detail-rail__address address {
  display: grid;
  gap: 3px;
  font-size: 15px;
  font-style: normal;
  line-height: 1.45;
}

.facility-detail-directions {
  display: inline-flex;
  min-width: 214px;
  min-height: 45px;
  align-items: center;
  justify-content: center;
  gap: 11px;
  margin-top: 21px;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 10px 18px;
  color: #111;
  font-size: 13px;
  text-decoration: none;
}

.facility-detail-directions:hover {
  background: #eeedea;
}

.facility-detail-directions :deep(svg) {
  width: 16px;
  height: 16px;
}

.facility-detail-map__notice {
  margin-top: 12px;
  color: #666;
  font-size: 11px;
  line-height: 1.45;
}

.facility-detail-booking {
  margin-top: 30px;
  border-top: 1px solid #d8d8d4;
  padding-top: 30px;
}

.facility-detail-booking > a,
.facility-detail-mobile-booking > a {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: center;
  gap: 20px;
  border-radius: 4px;
  background: #111;
  color: #fff;
  font-size: 15px;
  font-weight: 650;
  text-decoration: none;
}

.facility-detail-booking > a:hover,
.facility-detail-mobile-booking > a:hover {
  background: #333;
}

.facility-detail-booking > a :deep(svg),
.facility-detail-mobile-booking > a :deep(svg) {
  width: 18px;
  height: 18px;
}

.facility-detail-booking > p {
  margin-top: 14px;
  color: #666;
  font-size: 11px;
  line-height: 1.5;
}

.facility-detail-hours {
  margin-top: 28px;
  border-top: 1px solid #d8d8d4;
  padding-top: 24px;
}

.facility-detail-hours h2 {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  font-weight: 650;
}

.facility-detail-hours h2 :deep(svg) {
  width: 16px;
  height: 16px;
}

.facility-detail-hours dl {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.facility-detail-hours dl > div {
  display: flex;
  justify-content: space-between;
  gap: 22px;
  color: #555;
  font-size: 11px;
}

.facility-detail-hours dd {
  color: #222;
  font-variant-numeric: tabular-nums;
}

.facility-detail-mobile-booking {
  display: none;
}

.facility-detail-state {
  display: grid;
  min-height: 70vh;
  place-items: center;
  align-content: center;
  gap: 15px;
  padding: 48px 20px;
  background: #f1f0ed;
  text-align: center;
}

.facility-detail-state > :deep(svg) {
  width: 34px;
  height: 34px;
  stroke-width: 1.45;
}

.facility-detail-state h1 {
  font-size: clamp(28px, 4vw, 42px);
  font-weight: 450;
  letter-spacing: -0.04em;
}

.facility-detail-state p {
  max-width: 520px;
  color: #666;
  font-size: 14px;
  line-height: 1.55;
}

.facility-detail-state > div {
  display: flex;
  align-items: center;
  gap: 12px;
}

.facility-detail-state :is(button, a) {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  border: 1px solid #111;
  border-radius: 4px;
  padding: 10px 15px;
  background: #111;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
}

.facility-detail-state a {
  background: transparent;
  color: #111;
}

.facility-detail-page :is(a, button):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}

@media (max-width: 1120px) {
  .facility-detail-layout {
    display: block;
  }

  .facility-detail-main {
    width: min(100% - 64px, 1020px);
    margin: 0 auto;
    padding-right: 0;
    padding-left: 0;
  }

  .facility-detail-rail {
    border-top: 1px solid #d8d8d4;
    border-left: 0;
    background: #f4f3f0;
  }

  .facility-detail-rail__sticky {
    position: static;
    display: grid;
    width: min(100% - 64px, 1020px);
    grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
    align-items: stretch;
    margin: 0 auto;
  }

  .facility-detail-map {
    border-right: 1px solid #d8d8d4;
    border-bottom: 0;
    padding: 28px 28px 28px 0;
  }

  .facility-detail-rail__content {
    padding: 42px 0 42px 42px;
  }
}

@media (max-width: 760px) {
  .facility-detail-page {
    padding-bottom: 74px;
  }

  .facility-detail-main {
    width: min(100% - 40px, 620px);
    padding-top: 24px;
    padding-bottom: 48px;
  }

  .facility-detail-breadcrumb {
    gap: 10px;
    margin-bottom: 24px;
    font-size: 11px;
  }

  .facility-detail-overview {
    grid-template-columns: 1fr;
    gap: 28px;
  }

  .facility-detail-summary {
    padding-top: 0;
  }

  .facility-detail-summary h1 {
    max-width: 560px;
    font-size: clamp(32px, 9.5vw, 44px);
  }

  .facility-detail-about {
    margin-top: 12px;
  }

  .facility-detail-section {
    margin-top: 38px;
  }

  .facility-detail-services article,
  .facility-detail-experts article {
    grid-template-columns: auto minmax(0, 1fr);
    gap: 14px;
    padding: 13px 0;
  }

  .facility-detail-services article > a,
  .facility-detail-experts article > a {
    grid-column: 2;
    width: fit-content;
    min-height: 32px;
  }

  .facility-detail-rail__sticky {
    display: block;
    width: min(100% - 40px, 620px);
  }

  .facility-detail-map {
    border-right: 0;
    border-bottom: 1px solid #d8d8d4;
    padding: 20px 0;
  }

  .facility-detail-rail__content {
    padding: 30px 0 42px;
  }

  .facility-detail-mobile-booking {
    position: fixed;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 24;
    display: block;
    border-top: 1px solid #ccc;
    padding: 9px 20px;
    background: rgb(251 250 248 / 96%);
  }

  .facility-detail-mobile-booking > a {
    min-height: 54px;
  }
}

@media (max-width: 430px) {
  .facility-detail-summary__eyebrow {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }

  .facility-detail-summary__eyebrow button {
    min-height: 32px;
  }

  .facility-detail-section__heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .facility-detail-state > div {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
