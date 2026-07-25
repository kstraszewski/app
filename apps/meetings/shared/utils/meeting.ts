const ROOM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/u
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u

const POLISH_LETTERS: Record<string, string> = {
  ł: 'l',
  Ł: 'L',
}

export function normalizeRoomName(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  return ROOM_NAME_PATTERN.test(normalized) ? normalized : null
}

export function toRoomSlug(value: string): string | null {
  const normalized = [...value.trim()]
    .map(character => POLISH_LETTERS[character] ?? character)
    .join('')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)

  return normalizeRoomName(normalized)
}

export function normalizeParticipantName(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')

  if (
    normalized.length < 1
    || normalized.length > 60
    || CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null
  }

  return normalized
}
