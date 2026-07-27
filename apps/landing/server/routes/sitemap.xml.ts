import { getRequestURL, setHeader } from 'h3'
import type { DirectoryPayload } from '../../shared/types/directory'
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
  const paths: string[] = [...INDEXABLE_PUBLIC_PATHS]

  try {
    const directory = await event.$fetch<DirectoryPayload>('/api/directory')
    paths.push(...directory.facilities.map(facility => (
      `/placowki/${encodeURIComponent(facility.organizationSlug)}/${encodeURIComponent(facility.facilitySlug)}`
    )))
  }
  catch (error) {
    console.warn('[sitemap] facility URLs unavailable; returning static sitemap', {
      message: error instanceof Error ? error.message : String(error),
    })
  }

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

  return buildSitemapXml(origin, [...new Set(paths)])
})
