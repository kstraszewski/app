<script setup lang="ts">
import type { DirectoryExpert, DirectoryPayload } from '#shared/types/directory'
import {
  directoryExpertPath,
  directoryExpertRouteSlug,
} from '#shared/utils/directory-expert'
import { directoryBookingUrl, directoryHydrationData } from '~/utils/directory'

const route = useRoute()
const nuxtApp = useNuxtApp()
const runtimeConfig = useRuntimeConfig()

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function expertNotFound(): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Nie znaleziono eksperta.',
  })
}

const expertSlug = directoryExpertRouteSlug(routeParam(route.params.expertSlug))
if (!expertSlug) expertNotFound()

const payloadKey = `openexpert-directory-expert-${expertSlug}`
const {
  data,
  status,
  error,
  refresh,
} = await useFetch<DirectoryPayload>('/api/directory', {
  key: payloadKey,
  default: () => ({
    generatedAt: '',
    experts: [],
    facilities: [],
  }),
  getCachedData: key => directoryHydrationData<DirectoryPayload>(
    nuxtApp.isHydrating === true,
    nuxtApp.payload.data,
    key,
  ),
})

if (import.meta.server && error.value) {
  const statusCode = Number(error.value.statusCode || error.value.status || 503)
  throw createError({
    statusCode,
    statusMessage: 'Wizytówka eksperta jest chwilowo niedostępna.',
  })
}

const expert = computed<DirectoryExpert | null>(() => (
  data.value.experts.find(candidate => candidate.slug === expertSlug) ?? null
))

if (
  import.meta.server
  && !error.value
  && status.value !== 'pending'
  && status.value !== 'idle'
  && !expert.value
) expertNotFound()

const bookingBaseUrl = String(
  runtimeConfig.public.openexpert.clientPortalBaseUrl
  || runtimeConfig.public.openexpert.crmBaseUrl
  || 'http://127.0.0.1:3006',
)
const bookingHref = computed(() => (
  expert.value
    ? directoryBookingUrl(
        bookingBaseUrl,
        expert.value.widgetKey,
        expert.value.expertId,
        expert.value.availability?.dates[0]?.serviceId,
      )
    : '/eksperci'
))

const initials = computed(() => (expert.value?.name ?? '')
  .split(/\s+/u)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part.charAt(0))
  .join('')
  .toLocaleUpperCase('pl-PL'),
)
const availableDates = computed(() => (
  expert.value?.availability?.status === 'available'
    ? expert.value.availability.dates
    : []
))

const shortDateFormatter = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const fullDateFormatter = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function dateFromIso(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`)
}

function shortDate(value: string): string {
  return shortDateFormatter.format(dateFromIso(value)).replace(/\.$/u, '')
}

function fullDate(value: string): string {
  return fullDateFormatter.format(dateFromIso(value))
}

const seoTitle = expert.value
  ? `${expert.value.name} — ekspert OpenExpert`
  : 'Ekspert OpenExpert'
const seoDescription = expert.value
  ? `Sprawdź zakres konsultacji eksperta ${expert.value.name} i umów dogodny termin online.`
  : 'Sprawdź zakres konsultacji eksperta OpenExpert i umów termin online.'
const profilePath = directoryExpertPath(expertSlug)
const { canonicalUrl, siteOrigin } = useLandingSeo({
  title: seoTitle,
  description: seoDescription,
  path: profilePath,
  socialImagePath: '/eksperci-og.png',
  socialImageAlt: expert.value
    ? `${expert.value.name} — ekspert OpenExpert`
    : 'Ekspert OpenExpert',
})

useHead(() => {
  if (!expert.value) return {}
  const currentExpert = expert.value

  return {
    script: [{
      key: `structured-data:expert:${currentExpert.expertId}`,
      type: 'application/ld+json',
      innerHTML: serializeLandingStructuredData({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Person',
            '@id': `${canonicalUrl}#ekspert`,
            url: canonicalUrl,
            name: currentExpert.name,
            image: currentExpert.avatarUrl
              ? new URL(currentExpert.avatarUrl, `${siteOrigin}/`).toString()
              : undefined,
            knowsAbout: currentExpert.services.map(service => service.name),
            worksFor: currentExpert.facilities.map(facility => ({
              '@type': 'Organization',
              name: facility.name,
              address: facility.address ?? undefined,
            })),
            potentialAction: {
              '@type': 'ReserveAction',
              target: bookingHref.value,
            },
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
                name: 'Eksperci',
                item: `${siteOrigin}/eksperci`,
              },
              {
                '@type': 'ListItem',
                position: 3,
                name: currentExpert.name,
                item: canonicalUrl,
              },
            ],
          },
        ],
      }),
    }],
  }
})
</script>

<template>
  <div class="expert-profile-page">
    <DirectorySiteHeader
      active="experts"
      :cta-href="bookingHref"
      cta-label="Umów konsultację"
    />

    <main id="directory-content" tabindex="-1">
      <section
        v-if="status === 'pending' || status === 'idle'"
        class="expert-profile-state"
        role="status"
        aria-live="polite"
      >
        <span class="expert-profile-state__loader" aria-hidden="true" />
        <p>Ładujemy wizytówkę eksperta…</p>
      </section>

      <section
        v-else-if="error || !expert"
        class="expert-profile-state expert-profile-state--error"
        role="alert"
      >
        <Icon name="lucide:triangle-alert" aria-hidden="true" />
        <h1>Nie udało się otworzyć wizytówki</h1>
        <p>Odśwież widok albo wróć do katalogu i wybierz eksperta ponownie.</p>
        <div>
          <button type="button" @click="refresh()">
            <Icon name="lucide:rotate-ccw" aria-hidden="true" />
            Spróbuj ponownie
          </button>
          <NuxtLink to="/eksperci">Wróć do ekspertów</NuxtLink>
        </div>
      </section>

      <template v-else>
        <div class="expert-profile-shell">
          <nav class="expert-profile-breadcrumb" aria-label="Okruszki">
            <NuxtLink to="/">OpenExpert</NuxtLink>
            <span aria-hidden="true">/</span>
            <NuxtLink to="/eksperci">Eksperci</NuxtLink>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{{ expert.name }}</span>
          </nav>

          <section class="expert-profile-hero" aria-labelledby="expert-profile-title">
            <div class="expert-profile-identity">
              <span class="expert-profile-avatar" aria-hidden="true">
                <img
                  v-if="expert.avatarUrl"
                  :src="expert.avatarUrl"
                  alt=""
                  width="184"
                  height="184"
                >
                <template v-else>{{ initials || 'OE' }}</template>
              </span>

              <div class="expert-profile-heading">
                <p>Ekspert OpenExpert</p>
                <h1 id="expert-profile-title">{{ expert.name }}</h1>
                <span class="expert-profile-verified">
                  <Icon name="lucide:badge-check" aria-hidden="true" />
                  Publiczna wizytówka
                </span>
                <p class="expert-profile-lead">
                  Sprawdź zakres konsultacji i zarezerwuj termin bezpośrednio w aktualnym kalendarzu eksperta.
                </p>
              </div>
            </div>

            <aside class="expert-profile-booking" aria-labelledby="expert-booking-title">
              <p>Dostępność</p>
              <h2 id="expert-booking-title">Umów konsultację z {{ expert.name }}</h2>

              <div v-if="availableDates.length" class="expert-profile-dates">
                <span>Najbliższe wolne dni</span>
                <ul>
                  <li v-for="date in availableDates" :key="date.localDate">
                    <time
                      :datetime="date.localDate"
                      :aria-label="fullDate(date.localDate)"
                      :title="fullDate(date.localDate)"
                    >{{ shortDate(date.localDate) }}</time>
                  </li>
                </ul>
              </div>
              <div v-else class="expert-profile-dates expert-profile-dates--fallback">
                <Icon name="lucide:calendar-days" aria-hidden="true" />
                <span>Aktualne terminy zobaczysz w kalendarzu rezerwacji.</span>
              </div>

              <a :href="bookingHref">
                Wybierz termin
                <Icon name="lucide:arrow-right" aria-hidden="true" />
              </a>
              <small>W kalendarzu wybierzesz usługę i dokładną godzinę spotkania.</small>
            </aside>
          </section>

          <div class="expert-profile-content">
            <section class="expert-profile-section" aria-labelledby="expert-services-title">
              <header>
                <div>
                  <p>Zakres pomocy</p>
                  <h2 id="expert-services-title">Dostępne konsultacje</h2>
                </div>
                <span>{{ expert.services.length }}</span>
              </header>

              <div v-if="expert.services.length" class="expert-profile-services">
                <article
                  v-for="(service, index) in expert.services"
                  :key="`${service.name}-${service.durationMinutes}`"
                >
                  <span aria-hidden="true">0{{ index + 1 }}</span>
                  <div>
                    <h3>{{ service.name }}</h3>
                    <p v-if="service.durationMinutes">
                      Konsultacja · {{ service.durationMinutes }} min
                    </p>
                    <p v-else>Konsultacja dopasowana do Twojej sprawy</p>
                  </div>
                  <a :href="bookingHref" :aria-label="`Umów: ${service.name}`">
                    <Icon name="lucide:arrow-up-right" aria-hidden="true" />
                  </a>
                </article>
              </div>
              <p v-else class="expert-profile-empty">
                Aktualny zakres konsultacji zobaczysz podczas rezerwacji terminu.
              </p>
            </section>

            <aside class="expert-profile-locations" aria-labelledby="expert-locations-title">
              <p>Miejsce konsultacji</p>
              <h2 id="expert-locations-title">
                {{ expert.facilities.length === 1 ? 'Placówka' : 'Placówki' }}
              </h2>
              <ul v-if="expert.facilities.length">
                <li v-for="facility in expert.facilities" :key="`${facility.name}-${facility.address}`">
                  <Icon name="lucide:landmark" aria-hidden="true" />
                  <span>
                    <strong>{{ facility.name }}</strong>
                    <small v-if="facility.address">{{ facility.address }}</small>
                  </span>
                </li>
              </ul>
              <div v-else class="expert-profile-location-fallback">
                <Icon name="lucide:video" aria-hidden="true" />
                <span>Konsultacja online</span>
              </div>
              <p class="expert-profile-note">
                Forma spotkania i szczegóły lokalizacji są potwierdzane podczas rezerwacji.
              </p>
            </aside>
          </div>
        </div>

        <section class="expert-profile-cta" aria-labelledby="expert-profile-cta-title">
          <div>
            <p>Kolejny krok</p>
            <h2 id="expert-profile-cta-title">Wybierz konsultację i dogodny termin.</h2>
          </div>
          <a :href="bookingHref">
            Umów konsultację
            <Icon name="lucide:arrow-right" aria-hidden="true" />
          </a>
        </section>
      </template>
    </main>

    <DirectorySiteFooter />
  </div>
</template>

<style scoped>
.expert-profile-page {
  min-width: 0;
  background: #f5f4f1;
  color: #111;
  font-family: var(--font-sans);
}

#directory-content:focus {
  outline: none;
}

.expert-profile-shell {
  width: min(1240px, calc(100% - 80px));
  margin: 0 auto;
  padding: 34px 0 72px;
}

.expert-profile-breadcrumb {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 14px;
  margin-bottom: 30px;
  color: #777;
  font-size: 12px;
}

.expert-profile-breadcrumb a {
  color: #555;
  text-decoration: none;
}

.expert-profile-breadcrumb a:hover {
  color: #111;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.expert-profile-breadcrumb span[aria-current='page'] {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expert-profile-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 0.52fr);
  border: 1px solid #cccbc6;
  border-radius: 8px;
  background: #fff;
}

.expert-profile-identity {
  display: grid;
  min-height: 430px;
  grid-template-columns: 184px minmax(0, 1fr);
  align-items: center;
  gap: clamp(34px, 4vw, 64px);
  padding: clamp(42px, 6vw, 78px);
}

.expert-profile-avatar {
  display: grid;
  width: 184px;
  height: 184px;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: #111;
  color: #fff;
  font-size: 44px;
  font-weight: 500;
  letter-spacing: -0.03em;
}

.expert-profile-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.expert-profile-heading > p:first-child,
.expert-profile-booking > p,
.expert-profile-section header p,
.expert-profile-locations > p,
.expert-profile-cta p {
  color: #666;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.expert-profile-heading h1 {
  max-width: 570px;
  margin-top: 10px;
  font-size: clamp(38px, 5vw, 66px);
  font-variation-settings: 'opsz' 66, 'wght' 450;
  font-weight: 450;
  letter-spacing: -0.055em;
  line-height: 0.98;
}

.expert-profile-verified {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 18px;
  color: #4d4d49;
  font-size: 12px;
  font-weight: 600;
}

.expert-profile-verified :deep(svg) {
  width: 16px;
  height: 16px;
}

.expert-profile-lead {
  max-width: 560px;
  margin-top: 25px;
  color: #555;
  font-size: 15px;
  line-height: 1.65;
}

.expert-profile-booking {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  border-left: 1px solid #d8d7d2;
  padding: clamp(34px, 4vw, 52px);
  background: #111;
  color: #fff;
}

.expert-profile-booking > p {
  color: #aaa;
}

.expert-profile-booking h2 {
  margin-top: 11px;
  font-size: clamp(23px, 2.5vw, 31px);
  font-weight: 500;
  letter-spacing: -0.035em;
  line-height: 1.12;
}

.expert-profile-dates {
  margin-top: 28px;
  border-top: 1px solid #363636;
  border-bottom: 1px solid #363636;
  padding: 19px 0;
}

.expert-profile-dates > span {
  color: #aaa;
  font-size: 11px;
}

.expert-profile-dates ul {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 11px;
  list-style: none;
}

.expert-profile-dates li {
  border: 1px solid #494949;
  border-radius: 999px;
  padding: 7px 10px;
  background: #1d1d1d;
  color: #eee;
  font-size: 11px;
  font-weight: 600;
}

.expert-profile-dates--fallback {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #bbb;
  font-size: 12px;
  line-height: 1.5;
}

.expert-profile-dates--fallback :deep(svg) {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}

.expert-profile-booking > a,
.expert-profile-cta > a {
  display: inline-flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-top: 24px;
  border-radius: 4px;
  padding: 12px 16px;
  background: #fff;
  color: #111;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  transition: background-color var(--transition-fast);
}

.expert-profile-booking > a:hover {
  background: #dededb;
}

.expert-profile-booking > a :deep(svg),
.expert-profile-cta > a :deep(svg) {
  width: 17px;
  height: 17px;
}

.expert-profile-booking > small {
  margin-top: 13px;
  color: #888;
  font-size: 10px;
  line-height: 1.5;
}

.expert-profile-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(310px, 0.45fr);
  gap: 24px;
  margin-top: 24px;
}

.expert-profile-section,
.expert-profile-locations {
  border: 1px solid #d1d0cb;
  border-radius: 8px;
  padding: clamp(28px, 4vw, 46px);
  background: #fff;
}

.expert-profile-section header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid #d9d8d4;
  padding-bottom: 24px;
}

.expert-profile-section h2,
.expert-profile-locations h2 {
  margin-top: 7px;
  font-size: clamp(25px, 3vw, 34px);
  font-weight: 500;
  letter-spacing: -0.04em;
}

.expert-profile-section header > span {
  color: #777;
  font-size: 12px;
}

.expert-profile-services article {
  display: grid;
  min-height: 90px;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  border-bottom: 1px solid #dddcd8;
}

.expert-profile-services article > span {
  color: #999;
  font-family: var(--font-mono);
  font-size: 9px;
}

.expert-profile-services h3 {
  font-size: 15px;
  font-weight: 600;
}

.expert-profile-services p {
  margin-top: 5px;
  color: #777;
  font-size: 11px;
}

.expert-profile-services a {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid #d1d1cc;
  border-radius: 50%;
  color: #111;
  text-decoration: none;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.expert-profile-services a:hover {
  background: #111;
  color: #fff;
}

.expert-profile-services a :deep(svg) {
  width: 16px;
  height: 16px;
}

.expert-profile-locations ul {
  margin-top: 26px;
  list-style: none;
}

.expert-profile-locations li,
.expert-profile-location-fallback {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: start;
  gap: 13px;
  border-top: 1px solid #dddcd8;
  padding: 18px 0;
}

.expert-profile-locations li :deep(svg),
.expert-profile-location-fallback :deep(svg) {
  width: 42px;
  height: 42px;
  border: 1px solid #d6d5d0;
  border-radius: 4px;
  padding: 11px;
}

.expert-profile-locations strong,
.expert-profile-locations small {
  display: block;
}

.expert-profile-locations strong {
  font-size: 14px;
}

.expert-profile-locations small {
  margin-top: 5px;
  color: #666;
  font-size: 11px;
  line-height: 1.45;
}

.expert-profile-location-fallback {
  margin-top: 26px;
  font-size: 13px;
}

.expert-profile-note,
.expert-profile-empty {
  margin-top: 20px;
  color: #777;
  font-size: 11px;
  line-height: 1.55;
}

.expert-profile-cta {
  display: grid;
  min-height: 220px;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 40px;
  padding: 50px max(40px, calc((100vw - 1240px) / 2));
  background: #111;
  color: #fff;
}

.expert-profile-cta p {
  color: #999;
}

.expert-profile-cta h2 {
  margin-top: 10px;
  font-size: clamp(28px, 4vw, 48px);
  font-weight: 450;
  letter-spacing: -0.045em;
}

.expert-profile-cta > a {
  min-width: 210px;
  margin: 0;
}

.expert-profile-cta > a:hover {
  background: #dededb;
}

.expert-profile-state {
  display: grid;
  min-height: 560px;
  place-items: center;
  align-content: center;
  gap: 16px;
  padding: 60px 24px;
  text-align: center;
}

.expert-profile-state__loader {
  width: 30px;
  height: 30px;
  border: 2px solid #ccc;
  border-top-color: #111;
  border-radius: 50%;
  animation: expert-profile-spin 700ms linear infinite;
}

.expert-profile-state--error :deep(svg) {
  width: 34px;
  height: 34px;
}

.expert-profile-state--error h1 {
  font-size: 28px;
}

.expert-profile-state--error p {
  max-width: 520px;
  color: #666;
  font-size: 13px;
  line-height: 1.55;
}

.expert-profile-state--error > div {
  display: flex;
  gap: 10px;
}

.expert-profile-state--error :is(button, a) {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  border: 1px solid #111;
  border-radius: 4px;
  padding: 9px 14px;
  background: #111;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  text-decoration: none;
}

.expert-profile-state--error a {
  background: transparent;
  color: #111;
}

@keyframes expert-profile-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 980px) {
  .expert-profile-hero,
  .expert-profile-content {
    grid-template-columns: 1fr;
  }

  .expert-profile-booking {
    border-top: 1px solid #333;
    border-left: 0;
  }

  .expert-profile-identity {
    min-height: 360px;
  }
}

@media (max-width: 720px) {
  .expert-profile-shell {
    width: min(100% - 40px, 620px);
    padding: 24px 0 48px;
  }

  .expert-profile-identity {
    grid-template-columns: 1fr;
    justify-items: start;
    gap: 28px;
    padding: 32px 24px;
  }

  .expert-profile-avatar {
    width: 118px;
    height: 118px;
    font-size: 30px;
  }

  .expert-profile-heading h1 {
    font-size: clamp(36px, 12vw, 52px);
  }

  .expert-profile-booking,
  .expert-profile-section,
  .expert-profile-locations {
    padding: 28px 24px;
  }

  .expert-profile-cta {
    grid-template-columns: 1fr;
    padding: 42px 20px;
  }

  .expert-profile-cta > a {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .expert-profile-state__loader {
    animation: none;
  }
}
</style>
