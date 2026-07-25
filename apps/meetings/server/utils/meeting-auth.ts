import { createHash, timingSafeEqual } from 'node:crypto'
import { normalizeRoomName } from '../../shared/utils/meeting.ts'

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export function isSecureAccessCode(value: string): boolean {
  return value.length >= 20
    && value.length <= 256
    && !/[\p{Cc}\p{Cf}]/u.test(value)
}

export function isAllowedLiveKitUrl(value: string, allowLocalDevelopment = false): boolean {
  if (value.startsWith('wss://')) return true
  if (!allowLocalDevelopment) return false

  try {
    const url = new URL(value)
    return url.protocol === 'ws:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

export function accessCodeMatches(provided: string, expected: string): boolean {
  if (!provided || !expected) return false
  return timingSafeEqual(digest(provided), digest(expected))
}

export function resolveAllowedRoom(
  requestedRoom: unknown,
  configuredRoom: string,
): string | null {
  const requested = normalizeRoomName(requestedRoom)
  const allowed = normalizeRoomName(configuredRoom)

  return requested && allowed && requested === allowed ? requested : null
}
