import { useRuntimeConfig } from '#imports'
import {
  createError,
  getHeader,
  getQuery,
  getRequestURL,
  setHeader,
  type H3Event,
} from 'h3'
import { requireCrmSession, textValue } from '~~/server/utils/crm'
import { setPrivateMailResponseHeaders } from '~~/server/utils/mail-http'
import {
  downloadMailRemoteImage,
  PublicWebContentError,
} from '~~/server/utils/public-web-content'

function addHttpOrigin(origins: Set<string>, value: unknown): void {
  if (typeof value !== 'string' || !value.trim()) return
  try {
    const url = new URL(value.trim())
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      origins.add(url.origin)
    }
  }
  catch {
    // Invalid optional deployment metadata cannot widen the fetch policy.
  }
}

function applicationOrigins(event: H3Event): Set<string> {
  const origins = new Set<string>()
  addHttpOrigin(origins, getRequestURL(event).origin)

  const auth = (useRuntimeConfig(event).auth ?? {}) as {
    baseUrl?: unknown
    trustedOrigins?: unknown
  }
  addHttpOrigin(origins, auth.baseUrl)
  if (typeof auth.trustedOrigins === 'string') {
    for (const origin of auth.trustedOrigins.split(',')) addHttpOrigin(origins, origin)
  }

  const forwardedHost = getHeader(event, 'x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = getHeader(event, 'x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwardedHost && /^https?$/u.test(forwardedProto || '')) {
    addHttpOrigin(origins, `${forwardedProto}://${forwardedHost}`)
  }
  return origins
}

export default defineEventHandler(async (event) => {
  setPrivateMailResponseHeaders(event)
  setHeader(event, 'Cross-Origin-Resource-Policy', 'same-origin')
  await requireCrmSession(event)

  const sourceUrl = textValue(getQuery(event).url)
  if (!sourceUrl) {
    throw createError({ statusCode: 400, statusMessage: 'Adres obrazu jest wymagany.' })
  }

  try {
    const image = await downloadMailRemoteImage(sourceUrl, {
      forbiddenOrigins: applicationOrigins(event),
    })
    setHeader(event, 'Content-Type', image.mimeType)
    setHeader(event, 'Content-Length', image.data.byteLength)
    setHeader(event, 'Content-Disposition', 'inline')
    return image.data
  }
  catch (error) {
    if (error instanceof PublicWebContentError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: error.message,
      })
    }
    throw createError({
      statusCode: 502,
      statusMessage: 'Nie udało się bezpiecznie pobrać obrazu.',
    })
  }
})
