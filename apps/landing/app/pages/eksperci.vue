<script setup lang="ts">
import type { DirectoryPayload } from '#shared/types/directory'
import { directoryBookingUrl, normalizeDirectoryQuery } from '~/utils/directory'

const { canonicalUrl, siteOrigin } = useLandingSeo({
  title: 'Eksperci — umów konsultację online | OpenExpert',
  description: 'Znajdź eksperta OpenExpert, porównaj zakres konsultacji i zarezerwuj dogodny termin spotkania online lub w placówce.',
  path: '/eksperci',
  socialImagePath: '/eksperci-og.png',
  socialImageAlt: 'Katalog ekspertów OpenExpert — wyszukaj specjalistę i umów konsultację',
})

const runtimeConfig = useRuntimeConfig()
const crmBaseUrl = String(
  runtimeConfig.public.openexpert.crmBaseUrl || 'http://127.0.0.1:3004',
)
const search = ref('')

const { data, status, error, refresh } = await useFetch<DirectoryPayload>('/api/directory', {
  key: 'openexpert-directory-experts',
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
    statusMessage: 'Katalog ekspertów jest chwilowo niedostępny.',
  })
}

const experts = computed(() => data.value.experts)
const normalizedSearch = computed(() => normalizeDirectoryQuery(search.value))
const visibleExperts = computed(() => {
  if (!normalizedSearch.value) return experts.value

  return experts.value.filter((expert) => {
    const searchText = normalizeDirectoryQuery([
      expert.name,
      ...expert.services.map(service => service.name),
      ...expert.facilities.flatMap(facility => [facility.name, facility.address ?? '']),
    ].join(' '))
    return searchText.includes(normalizedSearch.value)
  })
})
const resultText = computed(() => {
  if (status.value === 'pending' || status.value === 'idle') return 'Pobieramy aktualny katalog ekspertów.'
  if (error.value) return 'Katalog ekspertów jest chwilowo niedostępny.'
  if (search.value.trim()) return `Wyniki: ${visibleExperts.value.length} z ${experts.value.length}.`
  return `Dostępnych ekspertów: ${experts.value.length}.`
})
const hasError = computed(() => status.value === 'error' || Boolean(error.value))

function bookingHref(widgetKey: string, expertId: string) {
  return directoryBookingUrl(crmBaseUrl, widgetKey, expertId)
}

useHead(() => ({
  script: experts.value.length
    ? [{
        key: 'structured-data:experts-directory',
        type: 'application/ld+json',
        innerHTML: serializeLandingStructuredData({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'CollectionPage',
              '@id': `${canonicalUrl}#webpage`,
              url: canonicalUrl,
              name: 'Eksperci — umów konsultację online',
              description: 'Publiczny katalog ekspertów, zakresów konsultacji i placówek dostępnych w OpenExpert.',
              isPartOf: { '@id': `${siteOrigin}/#website` },
              breadcrumb: { '@id': `${canonicalUrl}#breadcrumb` },
              mainEntity: { '@id': `${canonicalUrl}#lista-ekspertow` },
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
                  name: 'Eksperci',
                  item: canonicalUrl,
                },
              ],
            },
            {
              '@type': 'ItemList',
              '@id': `${canonicalUrl}#lista-ekspertow`,
              name: 'Eksperci OpenExpert',
              numberOfItems: experts.value.length,
              itemListOrder: 'https://schema.org/ItemListOrderAscending',
              itemListElement: experts.value.map((expert, index) => ({
                '@type': 'ListItem',
                position: index + 1,
                item: {
                  '@type': 'Person',
                  '@id': `${canonicalUrl}#ekspert-${expert.expertId}`,
                  name: expert.name,
                  image: expert.avatarUrl
                    ? new URL(expert.avatarUrl, `${siteOrigin}/`).toString()
                    : undefined,
                  knowsAbout: expert.services.map(service => service.name),
                  worksFor: expert.facilities.map(facility => ({
                    '@type': 'Organization',
                    name: facility.name,
                    address: facility.address ?? undefined,
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
    active="experts"
    eyebrow="Konsultacje OpenExpert"
    title="Znajdź eksperta"
    emphasis="i umów konsultację online."
    description="Wybierz eksperta na podstawie dostępnych konsultacji i placówki. Termin zarezerwujesz online — bez oczekiwania na kontakt zwrotny."
    search-id="expert-search"
    search-label="Szukaj eksperta"
    search-placeholder="Imię, usługa, placówka lub miasto"
    :result-text="resultText"
    :status="status"
    :has-error="hasError"
    :total-count="experts.length"
    :visible-count="visibleExperts.length"
    empty-title="Katalog ekspertów jest jeszcze pusty"
    empty-description="Eksperci pojawią się tutaj, gdy udostępnią aktywny kalendarz konsultacji."
    no-results-title="Nie znaleźliśmy takiego eksperta"
    no-results-description="Spróbuj wpisać nazwę usługi, placówki, miasta albo krótszą część imienia."
    @retry="refresh()"
  >
    <DirectoryExpertCard
      v-for="expert in visibleExperts"
      :key="expert.expertId"
      :expert="expert"
      :booking-href="bookingHref(expert.widgetKey, expert.expertId)"
    />
  </DirectoryCatalogFrame>
</template>
