import { normalizeParticipantName } from '#shared/utils/meeting'
import { isAllowedLiveKitUrl } from '../../utils/meeting-auth'

interface TokenRequestBody {
  room_name?: unknown
  participant_name?: unknown
}

export default defineEventHandler(async (event) => {
  const requestOrigin = getHeader(event, 'origin')
  if (requestOrigin && requestOrigin !== getRequestURL(event).origin) {
    throw createError({ statusCode: 403, message: 'Żądanie zostało odrzucone.' })
  }

  const contentType = getHeader(event, 'content-type') || ''
  const contentLength = Number(getHeader(event, 'content-length') || 0)
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw createError({ statusCode: 415, message: 'Oczekiwano danych JSON.' })
  }
  if (Number.isFinite(contentLength) && contentLength > 2048) {
    throw createError({ statusCode: 413, message: 'Żądanie jest zbyt duże.' })
  }

  const config = useRuntimeConfig(event)
  const serverUrl = String(config.public.livekitUrl || '').trim()
  const apiKey = String(config.livekitApiKey || '').trim()
  const apiSecret = String(config.livekitApiSecret || '').trim()
  const expectedAccessCode = String(config.meetingsAccessCode || '')
  const configuredRoom = String(config.meetingsRoomName || '')

  if (
    !isAllowedLiveKitUrl(serverUrl, import.meta.dev)
    || !apiKey
    || !apiSecret
    || !isSecureAccessCode(expectedAccessCode)
    || !configuredRoom
  ) {
    throw createError({
      statusCode: 503,
      message: 'Spotkanie nie zostało jeszcze skonfigurowane.',
    })
  }

  const body = await readBody<TokenRequestBody>(event)
  const roomName = resolveAllowedRoom(body?.room_name, configuredRoom)
  const participantName = normalizeParticipantName(body?.participant_name)

  if (!roomName || !participantName) {
    throw createError({ statusCode: 400, message: 'Nieprawidłowe dane spotkania.' })
  }

  const providedAccessCode = getHeader(event, 'x-meetings-access-code') || ''

  if (!accessCodeMatches(providedAccessCode, expectedAccessCode)) {
    throw createError({ statusCode: 401, message: 'Nieprawidłowy kod dostępu.' })
  }

  setResponseStatus(event, 201)
  setHeader(event, 'Cache-Control', 'no-store, private')

  return {
    server_url: serverUrl,
    participant_token: await createMeetingParticipantToken({
      apiKey,
      apiSecret,
      roomName,
      participantName,
    }),
  }
})
