import { getRequestURL, setHeader } from 'h3'
import {
  buildSitemapXml,
  INDEXABLE_PUBLIC_PATHS,
  normalizePublicOrigin,
} from '../utils/seo'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const origin = normalizePublicOrigin(
    String(config.public.openexpert.siteUrl || ''),
    getRequestURL(event).origin,
  )
  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return buildSitemapXml(origin, INDEXABLE_PUBLIC_PATHS)
})
