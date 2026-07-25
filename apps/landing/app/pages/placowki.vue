<script setup lang="ts">
import type { DirectoryPayload } from '#shared/types/directory'
import { directoryBookingUrl, normalizeDirectoryQuery } from '~/utils/directory'

const { canonicalUrl, siteOrigin } = useLandingSeo({
  title: 'Placówki — umów konsultację | OpenExpert',
  description: 'Znajdź placówkę OpenExpert, sprawdź dostępne konsultacje i ekspertów, a następnie zarezerwuj dogodny termin.',
  path: '/placowki',
  socialImagePath: '/placowki-og.png',
  socialImageAlt: 'Katalog placówek OpenExpert — wybierz miejsce i umów konsultację',
})

const runtimeConfig = useRuntimeConfig()
const crmBaseUrl = String(
  runtimeConfig.public.openexpert.crmBaseUrl || 'http://127.0.0.1:3004',
)
const search = ref('')

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
      ...facility.services.map(service => service.name),
      ...facility.experts.map(expert => expert.name),
    ].join(' '))
    return searchText.includes(normalizedSearch.value)
  })
})
const resultText = computed(() => {
  if (status.value === 'pending' || status.value === 'idle') return 'Pobieramy aktualny katalog placówek.'
  if (error.value) return 'Katalog placówek jest chwilowo niedostępny.'
  if (search.value.trim()) return `Wyniki: ${visibleFacilities.value.length} z ${facilities.value.length}.`
  return `Dostępnych placówek: ${facilities.value.length}.`
})
const hasError = computed(() => status.value === 'error' || Boolean(error.value))

function bookingHref(widgetKey: string) {
  return directoryBookingUrl(crmBaseUrl, widgetKey)
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
              name: 'Placówki — umów konsultację',
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
              itemListElement: facilities.value.map((facility, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                item: {
                  '@type': 'Organization',
                  '@id': `${canonicalUrl}#placowka-${facility.facilityId}`,
                  name: facility.name,
                  address: facility.address ?? undefined,
                  employee: facility.experts.map(expert => ({
                    '@type': 'Person',
                    name: expert.name,
                  })),
                },
              })),
            },
          ],
        }),
      }]
    : [],
}))
</script>

<template>
  <DirectoryCatalogFrame
    v-model="search"
    active="facilities"
    eyebrow="Placówki OpenExpert"
    title="Znajdź placówkę"
    emphasis="i umów konsultację."
    description="Sprawdź dostępne konsultacje i ekspertów w placówkach OpenExpert. Wybierz dogodny termin i zarezerwuj spotkanie online."
    search-id="facility-search"
    search-label="Szukaj placówki"
    search-placeholder="Nazwa, adres, miasto, usługa lub ekspert"
    :result-text="resultText"
    :status="status"
    :has-error="hasError"
    :total-count="facilities.length"
    :visible-count="visibleFacilities.length"
    empty-title="Katalog placówek jest jeszcze pusty"
    empty-description="Placówki pojawią się tutaj, gdy udostępnią aktywny kalendarz konsultacji."
    no-results-title="Nie znaleźliśmy takiej placówki"
    no-results-description="Spróbuj wpisać inne miasto, nazwę usługi, eksperta albo krótszy fragment adresu."
    @retry="refresh()"
  >
    <DirectoryFacilityCard
      v-for="facility in visibleFacilities"
      :key="`${facility.name}-${facility.address ?? ''}-${facility.widgetKey}`"
      :facility="facility"
      :booking-href="bookingHref(facility.widgetKey)"
    />
  </DirectoryCatalogFrame>
</template>
