import { getRequestURL, setHeader } from 'h3'
import { buildSitemapXml, normalizePublicOrigin } from '../utils/seo'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const origin = normalizePublicOrigin(
    String(config.public.openexpert.siteUrl || ''),
    getRequestURL(event).origin,
  )

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return buildSitemapXml(origin)
})
