import { getRequestURL, setHeader } from 'h3'
import { buildRobotsText, normalizePublicOrigin } from '../utils/seo'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const origin = normalizePublicOrigin(
    String(config.public.openexpert.siteUrl || ''),
    getRequestURL(event).origin,
  )

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')

  return buildRobotsText(origin)
})
