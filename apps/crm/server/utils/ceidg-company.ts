import { createError } from 'h3'

const nipWeights = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const

export interface CeidgCompanyLookupOptions {
  apiBaseUrl: string
  fetcher?: typeof fetch
  nip: string
  signal?: AbortSignal
  token: string
}

export class CeidgApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'CeidgApiError'
    this.status = status
  }
}

function queryText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

export function normalizeNip(value: unknown): string {
  const raw = queryText(value)
  if (!raw || !/^[\d\s-]+$/u.test(raw)) {
    throw createError({ statusCode: 400, statusMessage: 'nip must contain 10 digits' })
  }

  const nip = raw.replaceAll(/[\s-]/gu, '')
  if (!/^\d{10}$/u.test(nip)) {
    throw createError({ statusCode: 400, statusMessage: 'nip must contain 10 digits' })
  }

  const checksum = nipWeights.reduce(
    (sum, weight, index) => sum + (Number(nip[index]) * weight),
    0,
  ) % 11
  if (checksum === 10 || checksum !== Number(nip[9])) {
    throw createError({ statusCode: 400, statusMessage: 'nip checksum is invalid' })
  }

  return nip
}

export function parsePublicCompanyQuery(query: Record<string, unknown>): string {
  const keys = Object.keys(query)
  if (keys.length !== 1 || keys[0] !== 'nip') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Exactly one query parameter is allowed: nip',
    })
  }
  if (Array.isArray(query.nip)) {
    throw createError({ statusCode: 400, statusMessage: 'nip must be provided once' })
  }
  return normalizeNip(query.nip)
}

function ceidgCompanyUrl(apiBaseUrl: string, nip: string): URL {
  const baseUrl = new URL(apiBaseUrl)
  const url = new URL('/api/ceidg/v3/firma', baseUrl)
  url.searchParams.set('nip', nip)
  return url
}

export async function fetchCeidgCompany(
  options: CeidgCompanyLookupOptions,
): Promise<Record<string, unknown> | null> {
  const token = options.token.trim()
  if (!token) throw new CeidgApiError('CEIDG API token is not configured', 503)

  let response: Response
  try {
    response = await (options.fetcher ?? fetch)(
      ceidgCompanyUrl(options.apiBaseUrl, options.nip),
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: options.signal ?? AbortSignal.timeout(12_000),
      },
    )
  } catch {
    throw new CeidgApiError('CEIDG API is unavailable', 502)
  }

  if (response.status === 204) return null
  if (response.status === 401 || response.status === 403) {
    throw new CeidgApiError('CEIDG API credentials were rejected', 503)
  }
  if (response.status === 429) {
    throw new CeidgApiError('CEIDG API rate limit was exceeded', 429)
  }
  if (!response.ok) {
    throw new CeidgApiError('CEIDG API request failed', 502)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new CeidgApiError('CEIDG API returned invalid JSON', 502)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new CeidgApiError('CEIDG API returned an invalid response', 502)
  }

  const record = payload as Record<string, unknown>
  if (Array.isArray(record.firma) && record.firma.length === 0) return null
  return record
}
