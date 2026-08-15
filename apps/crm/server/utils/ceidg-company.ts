import { createError } from 'h3'
import type {
  CeidgCompanyData,
  CeidgPkdEntry,
} from '../../shared/types/ceidg-company.ts'

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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function textValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function formatCeidgAddress(value: unknown): string {
  const address = recordValue(value)
  if (!address) return ''

  const recipient = textValue(address.adresat)
  const street = textValue(address.ulica)
  const building = textValue(address.budynek, address.nrDomu)
  const unit = textValue(address.lokal, address.nrLokalu)
  const streetLine = [
    street,
    building ? `${building}${unit ? `/${unit}` : ''}` : unit,
  ].filter(Boolean).join(' ')
  const postalLine = [
    textValue(address.kod, address.kodPocztowy),
    textValue(address.miasto, address.miejscowosc, address.poczta),
  ].filter(Boolean).join(' ')
  const country = textValue(address.kraj)
  const parts = [recipient, streetLine, postalLine, country]
    .filter(Boolean)

  return [...new Set(parts)].join(', ')
}

function mapPkd(value: unknown): CeidgPkdEntry | null {
  const item = recordValue(value)
  if (!item) return null
  const code = textValue(item.kod, item.code)
  const name = textValue(item.nazwa, item.name)
  return code || name ? { code, name } : null
}

function mapPkdList(value: unknown, mainPkd: CeidgPkdEntry | null): CeidgPkdEntry[] {
  const entries = Array.isArray(value)
    ? value.map(mapPkd).filter((item): item is CeidgPkdEntry => Boolean(item))
    : []
  if (mainPkd && !entries.some(item => item.code === mainPkd.code)) {
    entries.unshift(mainPkd)
  }
  return entries.filter((item, index) => (
    entries.findIndex(candidate => candidate.code === item.code && candidate.name === item.name) === index
  ))
}

export function mapCeidgCompany(
  payload: Record<string, unknown>,
  requestedNip: string,
): CeidgCompanyData | null {
  const company = Array.isArray(payload.firma)
    ? recordValue(payload.firma[0])
    : recordValue(payload.firma)
  if (!company) return null

  const owner = recordValue(company.wlasciciel)
  const mainPkd = mapPkd(company.pkdGlowny)

  return {
    ceidgId: textValue(company.id),
    name: textValue(company.nazwa),
    nip: textValue(owner?.nip, company.nip, requestedNip),
    regon: textValue(owner?.regon, company.regon),
    legalForm: 'Jednoosobowa działalność gospodarcza',
    status: textValue(company.status),
    businessAddress: formatCeidgAddress(company.adresDzialalnosci),
    correspondenceAddress: formatCeidgAddress(company.adresKorespondencyjny),
    startDate: textValue(company.dataRozpoczecia),
    suspensionDate: textValue(company.dataZawieszenia),
    resumeDate: textValue(company.dataWznowienia),
    terminationDate: textValue(company.dataZaprzestania, company.dataZakonczenia),
    removalDate: textValue(company.dataWykreslenia),
    mainPkd,
    pkd: mapPkdList(company.pkd, mainPkd),
    email: textValue(company.email),
    phone: textValue(company.telefon),
    website: textValue(company.www, company.stronaInternetowa),
  }
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

export function parseCompanyLookupQuery(query: Record<string, unknown>): string {
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

export async function lookupCeidgCompany(
  options: CeidgCompanyLookupOptions,
): Promise<CeidgCompanyData> {
  let payload: Record<string, unknown> | null
  try {
    payload = await fetchCeidgCompany(options)
  }
  catch (error) {
    if (error instanceof CeidgApiError) {
      throw createError({ statusCode: error.status, statusMessage: error.message })
    }
    throw error
  }

  if (!payload) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono firmy w CEIDG.' })
  }
  const upstreamCompany = Array.isArray(payload.firma)
    ? recordValue(payload.firma[0])
    : recordValue(payload.firma)
  const upstreamOwner = recordValue(upstreamCompany?.wlasciciel)
  const upstreamNip = textValue(upstreamOwner?.nip, upstreamCompany?.nip).replaceAll(/\D/gu, '')
  const company = mapCeidgCompany(payload, options.nip)
  if (
    !company
    || !company.ceidgId
    || !company.name
    || upstreamNip !== options.nip
  ) {
    throw createError({
      statusCode: 502,
      statusMessage: 'CEIDG API returned an invalid company record',
    })
  }
  return { ...company, nip: options.nip }
}
