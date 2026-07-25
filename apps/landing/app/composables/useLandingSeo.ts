type StructuredData = Record<string, unknown> | Array<Record<string, unknown>>

interface LandingSeoOptions {
  title: string
  description: string
  path: string
  robots?: string
  socialImageAlt?: string
  socialImagePath?: string
  structuredData?: StructuredData | (() => StructuredData)
}

function normalizedOrigin(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin
  } catch {
    // Fall through to the production canonical origin.
  }

  return 'https://www.openexpert.app'
}

export function serializeLandingStructuredData(value: StructuredData) {
  return JSON.stringify(value).replaceAll('<', '\\u003C')
}

export function useLandingSeo(options: LandingSeoOptions) {
  const config = useRuntimeConfig()
  const requestUrl = useRequestURL()
  const configuredSiteUrl = String(config.public.openexpert.siteUrl || '')
  const siteOrigin = normalizedOrigin(configuredSiteUrl || requestUrl.origin)
  const canonicalUrl = new URL(options.path, `${siteOrigin}/`).toString()
  const socialImageUrl = new URL(
    options.socialImagePath || '/openexpert-og.png',
    `${siteOrigin}/`,
  ).toString()
  const socialImageAlt = options.socialImageAlt
    || 'OpenExpert — system pracy, katalog ekspertów i konsultacje online'

  useSeoMeta({
    title: options.title,
    description: options.description,
    robots: options.robots ?? 'index, follow, max-image-preview:large',
    ogTitle: options.title,
    ogDescription: options.description,
    ogType: 'website',
    ogUrl: canonicalUrl,
    ogSiteName: 'OpenExpert',
    ogLocale: 'pl_PL',
    ogImage: socialImageUrl,
    ogImageAlt: socialImageAlt,
    ogImageWidth: 1200,
    ogImageHeight: 630,
    ogImageType: 'image/png',
    twitterCard: 'summary_large_image',
    twitterTitle: options.title,
    twitterDescription: options.description,
    twitterImage: socialImageUrl,
    twitterImageAlt: socialImageAlt,
  })

  useHead(() => {
    const structuredData = typeof options.structuredData === 'function'
      ? options.structuredData()
      : options.structuredData

    return {
      link: [{ rel: 'canonical', href: canonicalUrl }],
      script: structuredData
        ? [{
            key: `structured-data:${options.path}`,
            type: 'application/ld+json',
            innerHTML: serializeLandingStructuredData(structuredData),
          }]
        : [],
    }
  })

  return {
    canonicalUrl,
    siteOrigin,
  }
}
