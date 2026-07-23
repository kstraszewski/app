import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'

const HTML_BYTE_LIMIT = 2 * 1024 * 1024
export const PROPERTY_IMAGE_BYTE_LIMIT = 8 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 12_000
const MAX_REDIRECTS = 3

const blockedAddresses = new BlockList()

for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv4')
}

for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3ffe::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv6')
}

export class PublicWebContentError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 422) {
    super(message)
    this.name = 'PublicWebContentError'
    this.statusCode = statusCode
  }
}

interface ResolvedTarget {
  url: URL
  address: string
  family: 4 | 6
}

interface RequestResult {
  url: URL
  statusCode: number
  headers: IncomingHttpHeaders
  body: Buffer
}

export interface PropertyPageEvidence {
  sourceUrl: string
  finalUrl: string
  canonicalUrl: string | null
  title: string | null
  description: string | null
  jsonLd: unknown[]
  text: string
  imageCandidates: PropertyImageCandidate[]
}

export interface PropertyImageCandidate {
  url: string
  alt: string | null
  source: string
}

interface PropertyImageCandidateWithHints extends PropertyImageCandidate {
  width?: number | null
  height?: number | null
  context?: string
  ariaHidden?: boolean
}

export interface DownloadedPropertyImage {
  sourceUrl: string
  finalUrl: string
  data: Buffer
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  extension: 'jpg' | 'png' | 'webp'
}

function hostnameWithoutBrackets(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

export function isPublicAddress(address: string, family = isIP(address)): boolean {
  if (family === 4) return !blockedAddresses.check(address, 'ipv4')
  if (family === 6) {
    const dottedMapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu)
    if (dottedMapped?.[1]) return isPublicAddress(dottedMapped[1], 4)
    const hexadecimalMapped = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu)
    if (hexadecimalMapped?.[1] && hexadecimalMapped[2]) {
      const high = Number.parseInt(hexadecimalMapped[1], 16)
      const low = Number.parseInt(hexadecimalMapped[2], 16)
      const ipv4 = `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
      return isPublicAddress(ipv4, 4)
    }
    return !blockedAddresses.check(address, 'ipv6')
  }
  return false
}

export function parsePublicHttpUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input.trim())
  }
  catch {
    throw new PublicWebContentError('Podaj pełny i poprawny adres URL ogłoszenia.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PublicWebContentError('Link musi używać protokołu HTTP lub HTTPS.')
  }
  if (url.username || url.password) {
    throw new PublicWebContentError('Link nie może zawierać danych logowania.')
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new PublicWebContentError('Link musi używać standardowego portu 80 lub 443.')
  }
  if (url.href.length > 4096) {
    throw new PublicWebContentError('Link jest zbyt długi.')
  }

  const hostname = hostnameWithoutBrackets(url.hostname).toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new PublicWebContentError('Link musi prowadzić do publicznie dostępnej strony.')
  }
  return url
}

async function resolvePublicTarget(url: URL): Promise<ResolvedTarget> {
  const hostname = hostnameWithoutBrackets(url.hostname)
  let addresses: Array<{ address: string, family: 4 | 6 }>
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true }) as Array<{ address: string, family: 4 | 6 }>
  }
  catch {
    throw new PublicWebContentError('Nie udało się odnaleźć serwera wskazanego przez link.')
  }

  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address, item.family))) {
    throw new PublicWebContentError('Link musi prowadzić do publicznie dostępnej strony.')
  }

  const selected = addresses[0]
  if (!selected || (selected.family !== 4 && selected.family !== 6)) {
    throw new PublicWebContentError('Nie udało się bezpiecznie połączyć ze stroną.')
  }
  return { url, address: selected.address, family: selected.family }
}

export async function assertPublicWebUrl(input: string): Promise<URL> {
  const url = parsePublicHttpUrl(input)
  await resolvePublicTarget(url)
  return url
}

function readResponseBody(
  response: import('node:http').IncomingMessage,
  limit: number,
): Promise<Buffer> {
  const contentLength = Number(response.headers['content-length'] ?? 0)
  if (Number.isFinite(contentLength) && contentLength > limit) {
    response.destroy()
    throw new PublicWebContentError('Pobrany plik przekracza dozwolony rozmiar.', 413)
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    response.on('data', (chunk: Buffer | Uint8Array) => {
      const buffer = Buffer.from(chunk)
      size += buffer.length
      if (size > limit) {
        response.destroy(new PublicWebContentError('Pobrany plik przekracza dozwolony rozmiar.', 413))
        return
      }
      chunks.push(buffer)
    })
    response.on('end', () => resolve(Buffer.concat(chunks, size)))
    response.on('error', reject)
  })
}

async function requestPublicBytes(
  initialUrl: URL,
  options: { accept: string, maxBytes: number },
): Promise<RequestResult> {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS
  let currentUrl = initialUrl

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const target = await resolvePublicTarget(currentUrl)
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      throw new PublicWebContentError('Przekroczono czas pobierania strony.', 504)
    }

    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const request = (target.url.protocol === 'https:' ? httpsRequest : httpRequest)({
        protocol: target.url.protocol,
        hostname: hostnameWithoutBrackets(target.url.hostname),
        port: target.url.port || undefined,
        path: `${target.url.pathname}${target.url.search}`,
        method: 'GET',
        family: target.family,
        lookup: ((_hostname: string, _options: unknown, callback: (
          error: NodeJS.ErrnoException | null,
          address: string,
          family: 4 | 6,
        ) => void) => callback(null, target.address, target.family)) as never,
        headers: {
          Accept: options.accept,
          'Accept-Encoding': 'identity',
          'User-Agent': 'OpenExpertPropertyImporter/1.0 (+https://openexpert.app)',
        },
      }, resolve)
      request.setTimeout(remainingMs, () => {
        request.destroy(new PublicWebContentError('Przekroczono czas pobierania strony.', 504))
      })
      request.once('error', reject)
      request.end()
    })

    const statusCode = response.statusCode ?? 0
    if ([301, 302, 303, 307, 308].includes(statusCode)) {
      const location = response.headers.location
      response.resume()
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new PublicWebContentError('Strona przekierowuje zbyt wiele razy.')
      }
      currentUrl = parsePublicHttpUrl(new URL(location, currentUrl).href)
      continue
    }

    if (statusCode < 200 || statusCode >= 300) {
      response.resume()
      throw new PublicWebContentError(`Strona zwróciła błąd HTTP ${statusCode}.`)
    }
    const encoding = String(response.headers['content-encoding'] ?? 'identity').toLowerCase()
    if (encoding && encoding !== 'identity') {
      response.resume()
      throw new PublicWebContentError('Strona używa nieobsługiwanej kompresji odpowiedzi.')
    }

    const body = await readResponseBody(response, options.maxBytes)
    return { url: currentUrl, statusCode, headers: response.headers, body }
  }

  throw new PublicWebContentError('Nie udało się pobrać strony.')
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', hellip: '…', laquo: '«', lt: '<', nbsp: ' ',
    ndash: '–', quot: '"', raquo: '»', rsquo: '’', shy: '',
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity: string) => {
    if (entity.startsWith('#x')) {
      const codePoint = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return named[entity.toLowerCase()] ?? match
  })
}

function normalizeText(value: string, limit = 50_000) {
  return decodeHtml(value).replace(/\s+/gu, ' ').trim().slice(0, limit)
}

function tagAttributes(tag: string) {
  const attributes = new Map<string, string>()
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu
  for (const match of tag.matchAll(pattern)) {
    attributes.set(String(match[1]).toLowerCase(), decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''))
  }
  return attributes
}

function absoluteHttpUrl(value: unknown, baseUrl: URL): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim(), baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password || url.href.length > 4096) return null
    return url.href
  }
  catch {
    return null
  }
}

function collectJsonImageUrls(value: unknown, output: PropertyImageCandidateWithHints[], baseUrl: URL) {
  if (output.length >= 30 || value == null) return
  if (typeof value === 'string') {
    const url = absoluteHttpUrl(value, baseUrl)
    if (url) output.push({ url, alt: null, source: 'json-ld' })
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonImageUrls(item, output, baseUrl)
    return
  }
  if (typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if ('url' in record) collectJsonImageUrls(record.url, output, baseUrl)
  if ('contentUrl' in record) collectJsonImageUrls(record.contentUrl, output, baseUrl)
}

function collectJsonLdImages(value: unknown, output: PropertyImageCandidateWithHints[], baseUrl: URL) {
  if (value == null || output.length >= 30) return
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdImages(item, output, baseUrl)
    return
  }
  if (typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if ('image' in record) collectJsonImageUrls(record.image, output, baseUrl)
  for (const [key, child] of Object.entries(record)) {
    // Images nested below these entities describe the portal or the seller,
    // not the property advertised on the page.
    if (/^(?:author|brand|broker|logo|provider|publisher|seller)$/iu.test(key)) continue
    if (typeof child === 'object') collectJsonLdImages(child, output, baseUrl)
  }
}

function numericImageDimension(value: string | undefined): number | null {
  if (!value || !/^\d{1,5}$/u.test(value.trim())) return null
  const parsed = Number.parseInt(value, 10)
  return parsed > 0 ? parsed : null
}

function largestSrcsetUrl(value: string | undefined, baseUrl: URL): string | null {
  if (!value) return null
  const candidates = value.split(',').flatMap((part, index) => {
    const match = part.trim().match(/^(\S+)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/u)
    if (!match?.[1]) return []
    const url = absoluteHttpUrl(match[1], baseUrl)
    if (!url) return []
    const descriptor = Number.parseFloat(match[2] ?? '0')
    const unit = match[3] ?? ''
    // Width descriptors are directly comparable. Density descriptors get a
    // smaller multiplier but still prefer 2x over the placeholder 1x image.
    const quality = unit === 'w' ? descriptor : unit === 'x' ? descriptor * 1_000 : 0
    return [{ url, quality, index }]
  })
  candidates.sort((a, b) => b.quality - a.quality || a.index - b.index)
  return candidates[0]?.url ?? null
}

function collectEmbeddedListingImages(
  html: string,
  baseUrl: URL,
  title: string | null,
  output: PropertyImageCandidateWithHints[],
) {
  const listingIdentifiers = [...new Set(
    `${baseUrl.pathname}${baseUrl.search}`.match(/\d{5,}/gu) ?? [],
  )]
  if (!listingIdentifiers.length) return

  // Some SSR portals keep the complete gallery in their hydration payload as
  // base64/base64url-encoded source URLs while rendering only 1-2 <img> tags.
  // Requiring the current listing identifier prevents photos from related
  // offers in the same payload from leaking into this gallery.
  for (const match of html.matchAll(/[A-Za-z0-9+/_-]{48,4096}={0,2}/gu)) {
    if (output.length >= 100) break
    const token = match[0]
    if (!token) continue
    let decoded: string
    try {
      decoded = Buffer.from(token.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8')
    }
    catch {
      continue
    }
    if (decoded.includes('\uFFFD') || !listingIdentifiers.some(identifier => decoded.includes(identifier))) continue
    const url = absoluteHttpUrl(decoded, baseUrl)
    if (!url || !/\.(?:jpe?g|png|webp)(?:[?#].*)?$/iu.test(url)) continue
    output.push({
      url,
      alt: title,
      source: 'embedded-data',
      context: 'listing gallery hydration photo',
    })
  }
}

const BLOCKED_IMAGE_EXTENSION = /\.(?:avif|bmp|gif|ico|svgz?|tiff?)$/iu
const UI_URL_TOKEN = /(?:^|[\/_.?&=:%-])(?:ad(?:s|vert(?:isement)?)?|app[-_]?store|arrow|avatar|badge|banner|brand|calendar|camera|chevron|close|email|facebook|favicon|favorite|favourite|heart|ico|icon|info|instagram|linkedin|logo|logotype|map[-_]?pin|marker|menu|minus|no[-_]?image|phone|pixel|placeholder|plus|profile|qr|search|social|spacer|sprite|tooltip|tracker|tracking|user|whatsapp|youtube)(?:[\/_.?&=:%-]|$)/iu
const UI_TEXT_TOKEN = /\b(?:advert|avatar|badge|banner|close|facebook|favicon|favorite|favourite|ikona|instagram|logo|menu|następn|next|placeholder|poprzedn|previous|profil|reklam|share|social|udostępn|ulubion|youtube)\b/iu
const PROPERTY_TEXT_TOKEN = /\b(?:apartment|bathroom|bedroom|building|dom|działk|elewac|estate|flat|gallery|house|kuchni|listing|living|mieszkan|nieruchomo|ogr[oó]d|offer|photo|picture|pok[oó]j|property|salon|sypialni|taras|thumbnail|wnętrz|widok|zdjęci)\b/iu
const PROPERTY_URL_TOKEN = /(?:^|[\/_.?&=:%-])(?:detail|estate|full|gallery|image|img|large|listing|media|offer|original|photo|picture|property|upload|xlarge|zdjec)(?:[\/_.?&=:%-]|$)/iu
const URL_RESOLUTION = /(?:^|[^\d])(\d{3,5})[xX](\d{3,5})(?:[^\d]|$)/u

function decodedUrlForClassification(url: URL) {
  try {
    return decodeURIComponent(`${url.hostname}${url.pathname}${url.search}`).toLowerCase()
  }
  catch {
    return `${url.hostname}${url.pathname}${url.search}`.toLowerCase()
  }
}

function rankPropertyImageCandidate(
  candidate: PropertyImageCandidateWithHints,
  baseUrl: URL,
  index: number,
) {
  let url: URL
  try {
    url = new URL(candidate.url, baseUrl)
  }
  catch {
    return null
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
  url.hash = ''

  const path = url.pathname.toLowerCase()
  const classifiedUrl = decodedUrlForClassification(url)
  const context = normalizeText(`${candidate.alt ?? ''} ${candidate.context ?? ''}`, 1_000)
  const width = candidate.width ?? null
  const height = candidate.height ?? null
  const hasDimensions = width != null && height != null
  const ratio = hasDimensions ? width / height : null

  if (candidate.ariaHidden) return null
  if (BLOCKED_IMAGE_EXTENSION.test(path)) return null
  if (UI_URL_TOKEN.test(classifiedUrl) || UI_TEXT_TOKEN.test(context)) return null
  if (hasDimensions && (Math.max(width, height) <= 180 || width * height <= 24_000)) return null
  if (ratio != null && (ratio > 5 || ratio < 0.2)) return null

  const sourceScore = candidate.source.startsWith('og:image')
    ? 110
    : candidate.source.startsWith('twitter:image')
      ? 100
      : candidate.source === 'json-ld'
        ? 90
        : candidate.source === 'gemini'
          ? 80
          : 25
  const hasPropertyContext = PROPERTY_TEXT_TOKEN.test(context)
  const hasPropertyUrl = PROPERTY_URL_TOKEN.test(classifiedUrl)
  const resolutionMatch = classifiedUrl.match(URL_RESOLUTION)
  const inferredWidth = Number.parseInt(resolutionMatch?.[1] ?? '0', 10)
  const inferredHeight = Number.parseInt(resolutionMatch?.[2] ?? '0', 10)
  const hasLargeInferredResolution = inferredWidth >= 600 && inferredHeight >= 400
  const jpegOrWebp = /\.(?:jpe?g|webp)$/iu.test(path)
  const png = /\.png$/iu.test(path)

  // An ordinary <img> is not evidence that an asset is a listing photo. It
  // needs a photographic format or a gallery/size signal. Trusted metadata
  // and Gemini candidates still go through all hard UI filters above.
  if (candidate.source === 'img'
    && !jpegOrWebp
    && !hasPropertyContext
    && !hasPropertyUrl
    && !hasLargeInferredResolution
    && !(hasDimensions && width >= 300 && height >= 200)) {
    return null
  }

  let score = sourceScore
  if (hasPropertyContext) score += 35
  if (hasPropertyUrl) score += 25
  if (jpegOrWebp) score += 12
  if (png) score += 2
  if (hasLargeInferredResolution) score += 24
  if (hasDimensions && width >= 600 && height >= 400) score += 30
  else if (hasDimensions && width >= 300 && height >= 200) score += 15
  if (url.origin === baseUrl.origin) score += 2

  return {
    candidate: { url: url.href, alt: candidate.alt, source: candidate.source },
    score,
    index,
  }
}

/**
 * Removes non-photo assets and returns stable, best-first property images.
 * This is deliberately deterministic: AI may propose URLs, but it never gets
 * to bypass the same URL/format/UI checks as page-derived candidates.
 */
export function rankPropertyImageCandidates(
  candidates: PropertyImageCandidateWithHints[],
  baseUrl: string,
  limit = 30,
): PropertyImageCandidate[] {
  const parsedBaseUrl = new URL(baseUrl)
  const ranked = candidates.flatMap((candidate, index) => {
    const result = rankPropertyImageCandidate(candidate, parsedBaseUrl, index)
    return result ? [result] : []
  })

  const unique = new Map<string, (typeof ranked)[number]>()
  for (const item of ranked) {
    const existing = unique.get(item.candidate.url)
    if (!existing) {
      unique.set(item.candidate.url, item)
      continue
    }
    const preferred = item.score > existing.score ? item : existing
    unique.set(item.candidate.url, {
      ...preferred,
      candidate: {
        ...preferred.candidate,
        alt: preferred.candidate.alt ?? existing.candidate.alt ?? item.candidate.alt,
      },
      index: Math.min(existing.index, item.index),
    })
  }

  return [...unique.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map(item => item.candidate)
}

export function parsePropertyPage(sourceUrl: string, finalUrl: string, html: string): PropertyPageEvidence {
  const baseUrl = new URL(finalUrl)
  const meta = new Map<string, string>()
  for (const match of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attributes = tagAttributes(match[0])
    const key = (attributes.get('property') || attributes.get('name') || '').toLowerCase()
    const content = attributes.get('content')
    if (key && content && !meta.has(key)) meta.set(key, normalizeText(content, 50_000))
  }

  let canonicalUrl: string | null = null
  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const attributes = tagAttributes(match[0])
    if ((attributes.get('rel') || '').toLowerCase().split(/\s+/u).includes('canonical')) {
      canonicalUrl = absoluteHttpUrl(attributes.get('href'), baseUrl)
      if (canonicalUrl) break
    }
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)
  const title = meta.get('og:title') || meta.get('twitter:title') || normalizeText(titleMatch?.[1] ?? '', 500) || null
  const description = meta.get('og:description') || meta.get('description') || meta.get('twitter:description') || null

  const jsonLd: unknown[] = []
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)) {
    if (jsonLd.length >= 20) break
    try {
      const parsed = JSON.parse(decodeHtml(match[1] ?? '').trim())
      jsonLd.push(parsed)
    }
    catch {
      // Malformed analytics/JSON-LD blocks are common and can be ignored.
    }
  }

  const imageCandidates: PropertyImageCandidateWithHints[] = []
  for (const key of ['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']) {
    const url = absoluteHttpUrl(meta.get(key), baseUrl)
    if (url) imageCandidates.push({
      url,
      alt: meta.get(`${key}:alt`) ?? null,
      source: key,
      width: numericImageDimension(meta.get(`${key}:width`)),
      height: numericImageDimension(meta.get(`${key}:height`)),
    })
  }
  for (const block of jsonLd) collectJsonLdImages(block, imageCandidates, baseUrl)
  collectEmbeddedListingImages(html, baseUrl, title, imageCandidates)
  for (const match of html.matchAll(/<img\b[^>]*>/giu)) {
    const attributes = tagAttributes(match[0])
    const alt = normalizeText(attributes.get('alt') ?? '', 500) || null
    const hints = {
      alt,
      source: 'img',
      width: numericImageDimension(attributes.get('width')),
      height: numericImageDimension(attributes.get('height')),
      ariaHidden: attributes.get('aria-hidden')?.toLowerCase() === 'true',
      context: [
        attributes.get('class'),
        attributes.get('id'),
        attributes.get('data-cy'),
        attributes.get('aria-label'),
        attributes.get('itemprop'),
      ].filter(Boolean).join(' '),
    }
    // One <img> represents one gallery item. Prefer its largest srcset member,
    // then the real lazy-load source, and use src only as a final fallback.
    // Keeping every variant would show the same room several times.
    const url = largestSrcsetUrl(attributes.get('data-srcset') || attributes.get('srcset'), baseUrl)
      || absoluteHttpUrl(attributes.get('data-src'), baseUrl)
      || absoluteHttpUrl(attributes.get('data-lazy-src'), baseUrl)
      || absoluteHttpUrl(attributes.get('data-original'), baseUrl)
      || absoluteHttpUrl(attributes.get('src'), baseUrl)
    if (url) imageCandidates.push({ url, ...hints })
  }

  const uniqueImages = rankPropertyImageCandidates(imageCandidates, baseUrl.href, 30)
  const text = normalizeText(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/giu, ' ')
    .replace(/<!--([\s\S]*?)-->/gu, ' ')
    .replace(/<[^>]+>/gu, ' '), 50_000)

  return {
    sourceUrl,
    finalUrl,
    canonicalUrl,
    title,
    description,
    jsonLd: jsonLd.slice(0, 20),
    text,
    imageCandidates: uniqueImages,
  }
}

export async function fetchPropertyPage(sourceUrl: string): Promise<PropertyPageEvidence> {
  const url = await assertPublicWebUrl(sourceUrl)
  const response = await requestPublicBytes(url, {
    accept: 'text/html,application/xhtml+xml,application/ld+json;q=0.8,text/plain;q=0.5',
    maxBytes: HTML_BYTE_LIMIT,
  })
  const contentType = String(response.headers['content-type'] ?? '').toLowerCase()
  if (!contentType.includes('text/html')
    && !contentType.includes('application/xhtml+xml')
    && !contentType.includes('application/ld+json')
    && !contentType.includes('text/plain')) {
    throw new PublicWebContentError('Link nie prowadzi do obsługiwanej strony internetowej.')
  }
  return parsePropertyPage(sourceUrl, response.url.href, response.body.toString('utf8'))
}

function imageFormat(data: Buffer) {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mimeType: 'image/jpeg' as const, extension: 'jpg' as const }
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png' as const, extension: 'png' as const }
  }
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp' as const, extension: 'webp' as const }
  }
  return null
}

export async function downloadPropertyImage(sourceUrl: string): Promise<DownloadedPropertyImage> {
  const url = await assertPublicWebUrl(sourceUrl)
  const response = await requestPublicBytes(url, {
    accept: 'image/jpeg,image/png,image/webp',
    maxBytes: PROPERTY_IMAGE_BYTE_LIMIT,
  })
  const format = imageFormat(response.body)
  if (!format) {
    throw new PublicWebContentError('Plik nie jest poprawnym obrazem JPEG, PNG ani WebP.', 415)
  }
  const headerType = String(response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
  if (headerType && !['application/octet-stream', format.mimeType].includes(headerType)) {
    throw new PublicWebContentError('Typ obrazu nie zgadza się z jego zawartością.', 415)
  }
  return {
    sourceUrl,
    finalUrl: response.url.href,
    data: response.body,
    ...format,
  }
}
