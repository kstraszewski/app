import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Client } from 'pg'

const MAXIMUM_BYTES = 50 * 1024 * 1024
const EMBEDDING_MODEL = 'gemini-embedding-2'
const GATEWAY_EMBEDDING_MODEL = `google/${EMBEDDING_MODEL}`
const EMBEDDING_DIMENSIONS = 768
const EMBEDDING_RECIPE = 'search-result-v1'
const CONFIRMATION = 'IMPORT_OFFICIAL_BANK_FILES_TO_PRODUCTION'
const SEED_LOCK = 'openexpert.seed.official-bank-files.v1'
const VERCEL_PROJECT = 'openexpert-crm'
const BLOB_STORAGE_NAMESPACE = 'mortgage-bank-files'
const SUPPORTED_FILE_TYPES = new Map([
  ['application/pdf', { extension: '.pdf', mimeGroup: 'pdf' }],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    { extension: '.xlsx', mimeGroup: 'spreadsheet' },
  ],
])

function requiresTextExtraction(entry) {
  return entry.mimeType === 'application/pdf' && entry.textExtraction !== 'unsupported'
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../../..')
const mortgageDataDirectory = join(
  repositoryRoot,
  'packages/database/data/mortgages',
)
const manifestPath = join(mortgageDataDirectory, 'official-bank-files.json')
const bankCatalogPath = join(mortgageDataDirectory, 'official-bank-file-banks.json')
const assetDirectory = join(mortgageDataDirectory, 'official-bank-file-assets')

const crmRequire = createRequire(join(repositoryRoot, 'apps/crm/package.json'))
const storageRequire = createRequire(join(repositoryRoot, 'packages/storage/package.json'))

const officialBankDomains = new Map([
  ['alior', ['aliorbank.pl']],
  ['bank-bps', ['bankbps.pl']],
  ['bnp-paribas', ['bnpparibas.pl']],
  ['bos', ['bosbank.pl']],
  ['credit-agricole', ['credit-agricole.pl']],
  ['erste', ['erste.pl']],
  ['ing', ['ing.pl']],
  ['mbank', ['mbank.pl']],
  ['millennium', ['bankmillennium.pl']],
  ['pekao', ['pekao.com.pl']],
  ['pko-bp', ['pkobp.pl', 'pkobh.pl']],
  ['velobank', ['velobank.pl']],
])

const managedCategoryDefinitions = new Map([
  ['application', {
    label: 'Wnioski bankowe',
    icon: 'i-lucide-file-pen-line',
    sortOrder: 10,
  }],
  ['application_attachment', {
    label: 'Załączniki do wniosku',
    icon: 'i-lucide-files',
    sortOrder: 15,
  }],
  ['application_supplement', {
    label: 'Uzupełnienia wniosku',
    icon: 'i-lucide-file-plus-2',
    sortOrder: 18,
  }],
  ['income_form', {
    label: 'Formularze dochodowe',
    icon: 'i-lucide-badge-dollar-sign',
    sortOrder: 20,
  }],
  ['valuation_form', {
    label: 'Formularze wyceny',
    icon: 'i-lucide-house-search',
    sortOrder: 25,
  }],
  ['valuation_guidelines', {
    label: 'Wytyczne do wyceny',
    icon: 'i-lucide-ruler',
    sortOrder: 28,
  }],
  ['risk_information', {
    label: 'Informacje o ryzyku',
    icon: 'i-lucide-shield-alert',
    sortOrder: 30,
  }],
  ['general_information', {
    label: 'Informacje ogólne',
    icon: 'i-lucide-info',
    sortOrder: 35,
  }],
  ['insurance_security', {
    label: 'Ubezpieczenia i zabezpieczenia',
    icon: 'i-lucide-shield-check',
    sortOrder: 40,
  }],
  ['product_rules', {
    label: 'Regulaminy produktów',
    icon: 'i-lucide-book-open-check',
    sortOrder: 45,
  }],
  ['promotion_rules', {
    label: 'Warunki promocji',
    icon: 'i-lucide-badge-percent',
    sortOrder: 48,
  }],
  ['disbursement_form', {
    label: 'Uruchomienie i transze',
    icon: 'i-lucide-landmark',
    sortOrder: 50,
  }],
  ['pricing', {
    label: 'Oprocentowanie i ceny',
    icon: 'i-lucide-calculator',
    sortOrder: 55,
  }],
  ['other', {
    label: 'Pozostałe',
    icon: 'i-lucide-folder',
    sortOrder: 90,
  }],
])

const requiredRelations = [
  'public.mortgage_banks',
  'public.mortgage_products',
  'public.mortgage_bank_file_categories',
  'public.mortgage_bank_files',
  'public.mortgage_bank_file_versions',
  'public.mortgage_bank_file_chunks',
  'public.mortgage_bank_file_embeddings',
  'public.mortgage_bank_file_processing_jobs',
  'public.mortgage_bank_file_products',
  'public.mortgage_bank_file_events',
]

function usage() {
  return `Usage:
  node packages/database/scripts/seed-official-bank-files.mjs
  node packages/database/scripts/seed-official-bank-files.mjs --apply --confirm ${CONFIRMATION}

Without --apply the command only validates and summarizes the static manifest.
Persistent writes are accepted only inside a Vercel production build and require:
  VERCEL=1
  VERCEL_ENV=production
  DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL
  NUXT_VERCEL_BLOB_PRIVATE_STORE_ID
  VERCEL_OIDC_TOKEN

The apply mode reads only bundled official PDF/XLSX snapshots whose SHA-256 checksums
are pinned in the manifest. It preserves their official HTTPS source URLs as
provenance, extracts searchable PDFs, generates 768-dimensional Gemini embeddings,
uploads binaries to the private Vercel Blob store, and commits all database records
in one transaction. It never creates users or changes roles.`
}

function parseArguments(argv) {
  const parsed = { apply: false, confirm: null, help: false }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--apply') {
      parsed.apply = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      parsed.help = true
      continue
    }
    if (argument === '--confirm') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error('--confirm requires a value')
      }
      parsed.confirm = value
      index += 1
      continue
    }
    if (argument.startsWith('--confirm=')) {
      parsed.confirm = argument.slice('--confirm='.length)
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (!parsed.apply && parsed.confirm !== null) {
    throw new Error('--confirm is only valid together with --apply')
  }
  if (parsed.apply && parsed.confirm !== CONFIRMATION) {
    throw new Error(`Applying requires --confirm ${CONFIRMATION}`)
  }
  return parsed
}

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function decodeJwtPayload(value) {
  const parts = value.split('.')
  if (parts.length !== 3) throw new Error('VERCEL_OIDC_TOKEN is not a JWT')
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw new Error('VERCEL_OIDC_TOKEN has an invalid JWT payload')
  }
}

function productionConfiguration() {
  if (process.env.VERCEL !== '1') {
    throw new Error('Apply mode is restricted to a Vercel build (VERCEL=1)')
  }
  if (process.env.VERCEL_ENV !== 'production') {
    throw new Error('Apply mode requires VERCEL_ENV=production')
  }
  const databaseUrl = String(process.env.DATABASE_URL_UNPOOLED ?? '').trim()
    || requiredEnvironment('DATABASE_URL')
  const privateStoreId = requiredEnvironment('NUXT_VERCEL_BLOB_PRIVATE_STORE_ID')
  const oidcToken = requiredEnvironment('VERCEL_OIDC_TOKEN')
  const databaseHost = new URL(databaseUrl).hostname.toLowerCase()
  if (['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
    throw new Error('Apply mode refuses a local DATABASE_URL')
  }

  const oidcClaims = decodeJwtPayload(oidcToken)
  const nowSeconds = Math.floor(Date.now() / 1_000)
  if (oidcClaims.environment !== 'production') {
    throw new Error('VERCEL_OIDC_TOKEN is not scoped to the production environment')
  }
  if (
    typeof oidcClaims.sub !== 'string'
    || !oidcClaims.sub.endsWith(':environment:production')
  ) {
    throw new Error('VERCEL_OIDC_TOKEN subject is not scoped to production')
  }
  if (oidcClaims.project !== VERCEL_PROJECT) {
    throw new Error(`VERCEL_OIDC_TOKEN is not scoped to the ${VERCEL_PROJECT} project`)
  }
  if (typeof oidcClaims.exp !== 'number' || oidcClaims.exp <= nowSeconds + 300) {
    throw new Error('VERCEL_OIDC_TOKEN expires too soon to run the import safely')
  }
  if (
    typeof oidcClaims.iss !== 'string'
    || !oidcClaims.iss.startsWith('https://oidc.vercel.com')
  ) {
    throw new Error('VERCEL_OIDC_TOKEN has an unexpected issuer')
  }

  return { databaseUrl, privateStoreId, oidcToken }
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function normalizedTitle(value) {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pl-PL')
}

function assertOptionalDate(value, label) {
  if (value === null || value === undefined) return
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD or null`)
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`)
  }
}

function isOfficialHostname(bankSlug, hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '')
  return (officialBankDomains.get(bankSlug) ?? []).some(
    domain => normalized === domain || normalized.endsWith(`.${domain}`),
  )
}

function assertOfficialUrl(bankSlug, value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`)
  }
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:') throw new Error(`${label} must use HTTPS`)
  if (parsed.username || parsed.password) {
    throw new Error(`${label} cannot contain URL credentials`)
  }
  if (!isOfficialHostname(bankSlug, parsed.hostname)) {
    throw new Error(`${label} is not hosted on the official ${bankSlug} domain`)
  }
  return parsed
}

function validateBankCatalog(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('The official mortgage bank catalog is empty or invalid')
  }

  const slugs = new Set()
  for (const [index, bank] of value.entries()) {
    const label = `bankCatalog[${index}]`
    assertPlainObject(bank, label)
    for (const field of ['slug', 'name', 'websiteUrl', 'brandColor', 'brandForegroundColor']) {
      if (typeof bank[field] !== 'string' || !bank[field].trim()) {
        throw new Error(`${label}.${field} is required`)
      }
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(bank.slug)) {
      throw new Error(`${label}.slug has an invalid format`)
    }
    if (!officialBankDomains.has(bank.slug)) {
      throw new Error(`${label}.slug is unsupported: ${bank.slug}`)
    }
    if (slugs.has(bank.slug)) throw new Error(`${label}.slug is duplicated`)
    assertOfficialUrl(bank.slug, bank.websiteUrl, `${label}.websiteUrl`)
    for (const field of ['logoUrl', 'logoBackgroundColor']) {
      if (bank[field] !== null && bank[field] !== undefined && typeof bank[field] !== 'string') {
        throw new Error(`${label}.${field} must be a string or null`)
      }
    }
    if (bank.logoUrl) {
      const logoUrl = new URL(bank.logoUrl)
      if (logoUrl.protocol !== 'https:' || logoUrl.username || logoUrl.password) {
        throw new Error(`${label}.logoUrl must be a credential-free HTTPS URL`)
      }
    }
    for (const field of ['logoBackgroundColor', 'brandColor', 'brandForegroundColor']) {
      if (bank[field] && !/^#[0-9A-Fa-f]{6}$/u.test(bank[field])) {
        throw new Error(`${label}.${field} must be a six-digit hex color or null`)
      }
    }
    slugs.add(bank.slug)
  }
  return value
}

function validateManifest(value, bankCatalog) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('The official bank file manifest is empty or invalid')
  }

  const identities = new Set()
  const fileNames = new Set()
  for (const [index, entry] of value.entries()) {
    const label = `manifest[${index}]`
    assertPlainObject(entry, label)
    for (const field of ['bankSlug', 'title', 'category', 'fileName', 'mimeType']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`${label}.${field} is required`)
      }
    }
    if (!bankCatalog.some(bank => bank.slug === entry.bankSlug)) {
      throw new Error(`${label}.bankSlug is missing from the mortgage bank catalog`)
    }
    if (!officialBankDomains.has(entry.bankSlug)) {
      throw new Error(`${label}.bankSlug is unsupported: ${entry.bankSlug}`)
    }
    const fileType = SUPPORTED_FILE_TYPES.get(entry.mimeType)
    if (!fileType || !entry.fileName.endsWith(fileType.extension)) {
      throw new Error(`${label} must describe a supported PDF or XLSX file`)
    }
    if (basename(entry.fileName) !== entry.fileName) {
      throw new Error(`${label}.fileName must not contain a directory path`)
    }
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      throw new Error(`${label}.sha256 must be a lowercase SHA-256 checksum`)
    }
    if (entry.originalSourceSha256 !== undefined) {
      if (!/^[a-f0-9]{64}$/u.test(entry.originalSourceSha256)) {
        throw new Error(`${label}.originalSourceSha256 must be a lowercase SHA-256 checksum`)
      }
      if (entry.originalSourceSha256 === entry.sha256) {
        throw new Error(`${label}.originalSourceSha256 must differ from the derived file checksum`)
      }
    }
    if (
      entry.derivation !== undefined
      && (
        !['sanitized_static', 'sanitized_interactive'].includes(entry.derivation)
        || !entry.originalSourceSha256
        || entry.mimeType !== 'application/pdf'
      )
    ) {
      throw new Error(`${label}.derivation requires a supported sanitized PDF and originalSourceSha256`)
    }
    assertOfficialUrl(entry.bankSlug, entry.downloadUrl, `${label}.downloadUrl`)
    assertOfficialUrl(entry.bankSlug, entry.sourcePageUrl, `${label}.sourcePageUrl`)
    assertOptionalDate(entry.effectiveFrom, `${label}.effectiveFrom`)
    assertOptionalDate(entry.effectiveTo, `${label}.effectiveTo`)
    if (
      entry.effectiveFrom
      && entry.effectiveTo
      && entry.effectiveTo < entry.effectiveFrom
    ) {
      throw new Error(`${label}.effectiveTo cannot precede effectiveFrom`)
    }
    if (entry.mimeType === 'application/pdf') {
      if (!Number.isInteger(entry.pageCount) || entry.pageCount < 1) {
        throw new Error(`${label}.pageCount must be a positive integer for PDF files`)
      }
    } else if (entry.pageCount !== null) {
      throw new Error(`${label}.pageCount must be null for spreadsheet files`)
    }
    if (entry.notes !== undefined && typeof entry.notes !== 'string') {
      throw new Error(`${label}.notes must be a string when present`)
    }
    if (
      entry.textExtraction !== undefined
      && (entry.mimeType !== 'application/pdf' || entry.textExtraction !== 'unsupported')
    ) {
      throw new Error(`${label}.textExtraction supports only PDF value “unsupported”`)
    }

    const identity = `${entry.bankSlug}\u0000${normalizedTitle(entry.title)}`
    if (identities.has(identity)) throw new Error(`${label} duplicates a bank and title`)
    if (fileNames.has(entry.fileName)) throw new Error(`${label}.fileName is duplicated`)
    identities.add(identity)
    fileNames.add(entry.fileName)
  }
  return value
}

function safeFileName(value) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 180)
  return normalized || 'document.pdf'
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function stableUuid(seed) {
  const bytes = Buffer.from(sha256(`openexpert:official-bank-files:v1:${seed}`).slice(0, 32), 'hex')
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

async function importFrom(requireFrom, specifier) {
  let resolved
  try {
    resolved = requireFrom.resolve(specifier)
  } catch (error) {
    throw new Error(
      `Cannot resolve ${specifier}; run pnpm install from the workspace root`,
      { cause: error },
    )
  }
  return import(pathToFileURL(resolved).href)
}

async function loadRuntimeDependencies() {
  // pdfjs-dist reads these browser globals while its module is initialized.
  ensurePdfJsGlobals()
  const [blob, ai, gateway, pdfjs] = await Promise.all([
    importFrom(storageRequire, '@vercel/blob'),
    importFrom(crmRequire, 'ai'),
    importFrom(crmRequire, '@ai-sdk/gateway'),
    importFrom(crmRequire, 'pdfjs-dist/legacy/build/pdf.mjs'),
  ])
  return { blob, embedMany: ai.embedMany, gateway: gateway.gateway, pdfjs }
}

async function readBundledFile(entry) {
  const bytes = await readFile(join(assetDirectory, entry.fileName))
  if (bytes.byteLength > MAXIMUM_BYTES) {
    throw new Error(`${entry.title}: bundled file exceeds 50 MiB`)
  }
  const isPdf = entry.mimeType === 'application/pdf'
  const validSignature = isPdf
    ? bytes.byteLength >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    : bytes.byteLength >= 4
      && bytes[0] === 0x50
      && bytes[1] === 0x4b
      && bytes[2] === 0x03
      && bytes[3] === 0x04
  if (!validSignature) {
    throw new Error(`${entry.title}: bundled content signature does not match ${entry.mimeType}`)
  }
  const checksum = sha256(bytes)
  if (checksum !== entry.sha256) {
    throw new Error(`${entry.title}: bundled file checksum does not match the manifest`)
  }
  return {
    bytes,
    checksum,
    resolvedUrl: entry.downloadUrl,
    etag: null,
    lastModified: null,
    responseContentType: entry.mimeType,
  }
}

function unsupportedExtraction(entry) {
  return {
    pageCount: entry.mimeType === 'application/pdf' ? entry.pageCount : null,
    text: null,
    chunks: [],
    extractor: 'unsupported',
    reason: `${entry.mimeType} is preserved byte-for-byte without text extraction`,
  }
}

function ensurePdfJsGlobals() {
  globalThis.DOMMatrix ||= class DOMMatrix {
    constructor(..._args) {}
  }
  globalThis.Path2D ||= class Path2D {
    constructor(..._args) {}
  }
  globalThis.ImageData ||= class ImageData {
    constructor(..._args) {}
  }
}

function normalizeExtractedText(value) {
  return value
    .replace(/\u0000/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\s*\n\s*/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function splitPageText(text, pageNumber, firstChunkIndex) {
  const maximumCharacters = 5_500
  const minimumBreak = 2_600
  const chunks = []
  let offset = 0
  let chunkIndex = firstChunkIndex

  while (offset < text.length) {
    let end = Math.min(text.length, offset + maximumCharacters)
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end)
      const sentenceBreak = text.lastIndexOf('. ', end)
      const preferredBreak = Math.max(paragraphBreak, sentenceBreak)
      if (preferredBreak > offset + minimumBreak) end = preferredBreak + 1
    }
    const content = text.slice(offset, end).trim()
    if (content) {
      chunks.push({
        chunkIndex,
        pageStart: pageNumber,
        pageEnd: pageNumber,
        locator: `s. ${pageNumber}`,
        content,
        tokenCount: Math.max(1, Math.ceil(content.length / 4)),
      })
      chunkIndex += 1
    }
    offset = Math.max(end, offset + 1)
  }
  return chunks
}

async function extractPdf(pdfjs, bytes, entry) {
  ensurePdfJsGlobals()
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
  })

  try {
    const document = await loadingTask.promise
    if (document.numPages !== entry.pageCount) {
      throw new Error(
        `${entry.title}: bundled PDF has ${document.numPages} pages, expected ${entry.pageCount}`,
      )
    }
    const pages = []
    const chunks = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const lines = []
      let currentLine = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        const text = String(item.str ?? '').trim()
        if (text) currentLine = currentLine ? `${currentLine} ${text}` : text
        if ('hasEOL' in item && item.hasEOL && currentLine) {
          lines.push(currentLine)
          currentLine = ''
        }
      }
      if (currentLine) lines.push(currentLine)
      const pageText = normalizeExtractedText(lines.join('\n'))
      pages.push(pageText)
      chunks.push(...splitPageText(pageText, pageNumber, chunks.length))
      page.cleanup()
    }
    if (chunks.length === 0) {
      throw new Error(`${entry.title}: PDF contains no extractable text chunks`)
    }
    return {
      pageCount: document.numPages,
      text: pages.filter(Boolean).join('\n\n').slice(0, 250_000),
      chunks,
    }
  } finally {
    await loadingTask.destroy()
  }
}

function embeddingInput(title, content) {
  return `title: ${title.trim() || 'none'} | text: ${content}`
}

async function generateEmbeddings(embedMany, gateway, documents) {
  const pending = documents.flatMap(document => document.extracted.chunks.map(chunk => ({
    document,
    chunk,
    value: embeddingInput(document.entry.title, chunk.content),
  })))
  const model = gateway.embedding(GATEWAY_EMBEDDING_MODEL)

  for (let offset = 0; offset < pending.length; offset += 40) {
    const batch = pending.slice(offset, offset + 40)
    const response = await embedMany({
      model,
      values: batch.map(item => item.value),
      abortSignal: AbortSignal.timeout(120_000),
      providerOptions: {
        google: { outputDimensionality: EMBEDDING_DIMENSIONS },
      },
    })
    if (response.embeddings.length !== batch.length) {
      throw new Error('AI Gateway returned an unexpected number of embeddings')
    }
    for (const [index, item] of batch.entries()) {
      const embedding = response.embeddings[index]
      if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error('AI Gateway returned an unexpected embedding dimensionality')
      }
      if (embedding.some(value => !Number.isFinite(value))) {
        throw new Error('AI Gateway returned a non-finite embedding value')
      }
      item.chunk.embedding = embedding
      item.chunk.embeddingSourceSha256 = sha256(item.value)
    }
  }
}

async function assertRequiredSchema(database) {
  const result = await database.query(
    `select requested, to_regclass(requested)::text as relation
       from unnest($1::text[]) as requested`,
    [requiredRelations],
  )
  const missing = result.rows.filter(row => row.relation === null).map(row => row.requested)
  if (missing.length > 0) {
    throw new Error(`Required mortgage bank-file migrations are missing: ${missing.join(', ')}`)
  }
  const vectorType = await database.query(
    `select to_regtype('extensions.vector')::text as vector_type`,
  )
  if (vectorType.rows[0]?.vector_type !== 'extensions.vector') {
    throw new Error('The extensions.vector PostgreSQL type is missing')
  }
}

async function loadCatalog(database, manifest, bankCatalog) {
  const bankSlugs = [...new Set(manifest.map(entry => entry.bankSlug))]
  const categoryKeys = [...new Set(manifest.map(entry => entry.category))]
  const [banks, categories, products] = await Promise.all([
    database.query(
      `select id::text, slug, name
         from public.mortgage_banks
        where slug = any($1::text[])
        order by slug`,
      [bankSlugs],
    ),
    database.query(
      `select id::text, category_key
         from public.mortgage_bank_file_categories
        where category_key = any($1::text[])
          and is_archived = false
        order by category_key`,
      [categoryKeys],
    ),
    database.query(
      `select distinct on (bank_id) id::text, bank_id::text
         from public.mortgage_products
        where bank_id in (
          select id from public.mortgage_banks where slug = any($1::text[])
        )
          and is_active = true
          and archived_at is null
        order by bank_id, created_at, id`,
      [bankSlugs],
    ),
  ])

  const banksBySlug = new Map(banks.rows.map(row => [row.slug, row]))
  const categoriesByKey = new Map(categories.rows.map(row => [row.category_key, row.id]))
  const productByBankId = new Map(products.rows.map(row => [row.bank_id, row.id]))
  const bankSeedBySlug = new Map(bankCatalog.map(bank => [bank.slug, bank]))
  const missingBanks = []
  for (const slug of bankSlugs) {
    if (!banksBySlug.has(slug)) {
      const seed = bankSeedBySlug.get(slug)
      if (!seed) throw new Error(`Mortgage bank ${slug} is missing from the seed catalog`)
      const bank = {
        id: stableUuid(`bank:${slug}`),
        slug,
        name: seed.name,
      }
      banksBySlug.set(slug, bank)
      missingBanks.push(bank)
    }
  }
  if (missingBanks.length > 0) {
    const collisions = await database.query(
      `select id::text, slug
         from public.mortgage_banks
        where id = any($1::uuid[])`,
      [missingBanks.map(bank => bank.id)],
    )
    if (collisions.rowCount > 0) {
      throw new Error(
        `Deterministic mortgage bank identifier collision: ${collisions.rows.map(row => row.slug).join(', ')}`,
      )
    }
  }
  const missingCategories = []
  for (const key of categoryKeys) {
    if (!categoriesByKey.has(key)) {
      if (!managedCategoryDefinitions.has(key)) {
        throw new Error(`Active bank-file category ${key} is missing`)
      }
      const category = { id: stableUuid(`category:${key}`), key }
      categoriesByKey.set(key, category.id)
      missingCategories.push(category)
    }
  }
  if (missingCategories.length > 0) {
    const collisions = await database.query(
      `select id::text, category_key
         from public.mortgage_bank_file_categories
        where id = any($1::uuid[])`,
      [missingCategories.map(category => category.id)],
    )
    if (collisions.rowCount > 0) {
      throw new Error(
        `Deterministic bank-file category identifier collision: ${collisions.rows.map(row => row.category_key).join(', ')}`,
      )
    }
  }
  return { banksBySlug, categoriesByKey, productByBankId }
}

async function readLogicalFileState(database, bankId, title, checksum) {
  const logical = await database.query(
    `select id::text, current_version_id::text
       from public.mortgage_bank_files
      where bank_id = $1::uuid
        and archived_at is null
        and lower(btrim(title)) = lower(btrim($2))
      order by created_at, id`,
    [bankId, title],
  )
  if (logical.rowCount > 1) {
    throw new Error(`Multiple active logical files match “${title}”`)
  }
  const logicalFile = logical.rows[0] ?? null
  if (!logicalFile) {
    return {
      logicalFile: null,
      exactVersion: null,
      maximumVersionNumber: 0,
    }
  }

  const versions = await database.query(
    `select version.id::text,
            version.version_number,
            version.storage_path,
            version.size_bytes::bigint::text,
            version.status,
            version.extraction_status,
            version.embedding_status,
            (select count(*)::integer
               from public.mortgage_bank_file_chunks as chunk
              where chunk.version_id = version.id) as chunk_count,
            (select count(*)::integer
               from public.mortgage_bank_file_chunks as chunk
               join public.mortgage_bank_file_embeddings as embedding
                 on embedding.chunk_id = chunk.id
                and embedding.embedding_kind = 'content'
                and embedding.model = $3
                and embedding.recipe_version = $4
              where chunk.version_id = version.id) as embedding_count
       from public.mortgage_bank_file_versions as version
      where version.file_id = $1::uuid
        and version.checksum_sha256 = $2
      order by version.version_number desc`,
    [logicalFile.id, checksum, EMBEDDING_MODEL, EMBEDDING_RECIPE],
  )
  if (versions.rowCount > 1) {
    throw new Error(`Multiple versions of “${title}” have the same checksum`)
  }
  const maximum = await database.query(
    `select coalesce(max(version_number), 0)::integer as maximum
       from public.mortgage_bank_file_versions
      where file_id = $1::uuid`,
    [logicalFile.id],
  )
  return {
    logicalFile,
    exactVersion: versions.rows[0] ?? null,
    maximumVersionNumber: maximum.rows[0].maximum,
  }
}

function isCompleteVersion(version, entry) {
  if (!version || !['current', 'archived'].includes(version.status)) return false
  if (!requiresTextExtraction(entry)) {
    return version.extraction_status === 'unsupported'
      && version.embedding_status === 'disabled'
      && Number(version.chunk_count) === 0
      && Number(version.embedding_count) === 0
  }
  return version.extraction_status === 'completed'
    && version.embedding_status === 'completed'
    && version.chunk_count > 0
    && version.chunk_count === version.embedding_count
}

async function createPlans(database, catalog, documents) {
  const plans = []
  for (const document of documents) {
    const bank = catalog.banksBySlug.get(document.entry.bankSlug)
    const state = await readLogicalFileState(
      database,
      bank.id,
      document.entry.title,
      document.download.checksum,
    )
    const fileId = state.logicalFile?.id ?? stableUuid(
      `file:${document.entry.bankSlug}:${normalizedTitle(document.entry.title)}`,
    )
    const exactVersion = state.exactVersion
    const versionId = exactVersion?.id ?? stableUuid(
      `version:${fileId}:${document.download.checksum}`,
    )
    const versionNumber = exactVersion?.version_number ?? state.maximumVersionNumber + 1
    const storagePath = exactVersion?.storage_path
      ?? `${bank.id}/${fileId}/${versionId}/${safeFileName(document.entry.fileName)}`
    const mode = exactVersion
      ? (isCompleteVersion(exactVersion, document.entry) ? 'unchanged' : 'repair')
      : 'insert'

    if (mode === 'repair' && state.logicalFile.current_version_id !== exactVersion.id) {
      throw new Error(
        `Incomplete historical version of “${document.entry.title}” cannot be repaired safely`,
      )
    }
    if (mode === 'insert') {
      const collision = await database.query(
        `select
           exists(select 1 from public.mortgage_bank_files where id = $1::uuid) as file_id,
           exists(select 1 from public.mortgage_bank_file_versions where id = $2::uuid) as version_id,
           exists(select 1 from public.mortgage_bank_file_versions where storage_path = $3) as path`,
        [fileId, versionId, storagePath],
      )
      const row = collision.rows[0]
      if ((!state.logicalFile && row.file_id) || row.version_id || row.path) {
        throw new Error(`Deterministic identifier collision for “${document.entry.title}”`)
      }
    }
    plans.push({
      document,
      bank,
      categoryId: catalog.categoriesByKey.get(document.entry.category),
      productId: catalog.productByBankId.get(bank.id) ?? null,
      fileId,
      versionId,
      versionNumber,
      storagePath,
      mode,
      initialState: {
        logicalFileId: state.logicalFile?.id ?? null,
        currentVersionId: state.logicalFile?.current_version_id ?? null,
        exactVersionId: exactVersion?.id ?? null,
        maximumVersionNumber: state.maximumVersionNumber,
      },
    })
  }
  return plans
}

function blobStoragePath(storagePath) {
  return `${BLOB_STORAGE_NAMESPACE}/${storagePath}`
}

function assertBlobMetadata(metadata, plan, pathname) {
  if (metadata.pathname !== pathname) {
    throw new Error(`Blob pathname mismatch for “${plan.document.entry.title}”`)
  }
  if (metadata.size !== plan.document.download.bytes.byteLength) {
    throw new Error(`Blob size mismatch for “${plan.document.entry.title}”`)
  }
}

async function readBlobMetadata(blob, configuration, pathname) {
  return blob.head(pathname, {
    storeId: configuration.privateStoreId,
    oidcToken: configuration.oidcToken,
    abortSignal: AbortSignal.timeout(30_000),
  })
}

async function putPlanBlob(blob, configuration, plan, pathname) {
  const result = await blob.put(
    pathname,
    plan.document.download.bytes,
    {
      access: 'private',
      storeId: configuration.privateStoreId,
      oidcToken: configuration.oidcToken,
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: plan.document.entry.mimeType,
      cacheControlMaxAge: 3_600,
      maximumSizeInBytes: MAXIMUM_BYTES,
      multipart: plan.document.download.bytes.byteLength > 5 * 1024 * 1024,
      abortSignal: AbortSignal.timeout(180_000),
    },
  )
  if (result.pathname !== pathname) {
    throw new Error(`Uploaded Blob pathname mismatch for “${plan.document.entry.title}”`)
  }
}

async function ensureBlobs(blob, configuration, plans) {
  const uploaded = []
  try {
    for (const plan of plans) {
      const pathname = blobStoragePath(plan.storagePath)
      if (plan.mode !== 'insert') {
        try {
          const metadata = await readBlobMetadata(blob, configuration, pathname)
          assertBlobMetadata(metadata, plan, pathname)
          continue
        } catch (error) {
          if (!(error instanceof blob.BlobNotFoundError)) throw error
          process.stdout.write(
            `Restoring namespaced Blob object for “${plan.document.entry.title}”\n`,
          )
        }
      }

      await putPlanBlob(blob, configuration, plan, pathname)
      uploaded.push(pathname)
    }
    return uploaded
  } catch (error) {
    await deleteBlobsBestEffort(blob, configuration, uploaded)
    throw error
  }
}

async function deleteBlobsBestEffort(blob, configuration, paths) {
  if (paths.length === 0) return
  try {
    await blob.del(paths, {
      storeId: configuration.privateStoreId,
      oidcToken: configuration.oidcToken,
      abortSignal: AbortSignal.timeout(60_000),
    })
  } catch (cleanupError) {
    process.stderr.write(
      `WARNING: failed to remove ${paths.length} staged Blob object(s): ${cleanupError.message}\n`,
    )
  }
}

async function assertPlanState(database, plan) {
  const state = await readLogicalFileState(
    database,
    plan.bank.id,
    plan.document.entry.title,
    plan.document.download.checksum,
  )
  const current = {
    logicalFileId: state.logicalFile?.id ?? null,
    currentVersionId: state.logicalFile?.current_version_id ?? null,
    exactVersionId: state.exactVersion?.id ?? null,
    maximumVersionNumber: state.maximumVersionNumber,
  }
  if (JSON.stringify(current) !== JSON.stringify(plan.initialState)) {
    throw new Error(`Database state changed while preparing “${plan.document.entry.title}”`)
  }
}

async function upsertManagedCategories(database, plans) {
  const plannedCategoryByKey = new Map(
    plans.map(plan => [plan.document.entry.category, plan.categoryId]),
  )
  for (const [key, definition] of managedCategoryDefinitions) {
    const categoryId = plannedCategoryByKey.get(key)
    if (!categoryId) continue
    await database.query(
      `insert into public.mortgage_bank_file_categories (
         id, category_key, label, icon, sort_order, is_archived
       ) values ($1::uuid, $2, $3, $4, $5, false)
       on conflict (category_key) do update set
         label = excluded.label,
         icon = excluded.icon,
         sort_order = excluded.sort_order,
         is_archived = false,
         updated_at = now()`,
      [categoryId, key, definition.label, definition.icon, definition.sortOrder],
    )
  }
}

async function upsertBankCatalog(database, plans, bankCatalog) {
  const plannedBankBySlug = new Map(plans.map(plan => [plan.bank.slug, plan.bank]))
  for (const seed of bankCatalog) {
    const bank = plannedBankBySlug.get(seed.slug)
    if (!bank) continue
    await database.query(
      `insert into public.mortgage_banks (
         id, slug, name, website_url, logo_url, logo_background_color,
         brand_color, brand_foreground_color
       ) values ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
       on conflict (slug) do update set
         name = excluded.name,
         website_url = excluded.website_url,
         logo_url = coalesce(excluded.logo_url, mortgage_banks.logo_url),
         logo_background_color = coalesce(
           excluded.logo_background_color,
           mortgage_banks.logo_background_color
         ),
         brand_color = excluded.brand_color,
         brand_foreground_color = excluded.brand_foreground_color,
         updated_at = now()`,
      [
        bank.id,
        seed.slug,
        seed.name,
        seed.websiteUrl,
        seed.logoUrl ?? null,
        seed.logoBackgroundColor ?? null,
        seed.brandColor,
        seed.brandForegroundColor,
      ],
    )
  }
}

async function upsertProcessingJobs(database, plan, now) {
  const common = [plan.versionId, now]
  const searchablePdf = requiresTextExtraction(plan.document.entry)
  const extractionJobStatus = searchablePdf ? 'completed' : 'cancelled'
  const embeddingJobStatus = searchablePdf ? 'completed' : 'cancelled'
  await database.query(
    `insert into public.mortgage_bank_file_processing_jobs (
       version_id, job_type, status, attempts, started_at, finished_at, last_error, metadata
     ) values
       ($1::uuid, 'extract', $3, 1, $2::timestamptz, $2::timestamptz, null, $5::jsonb),
       ($1::uuid, 'embed', $4, 1, $2::timestamptz, $2::timestamptz, null, $6::jsonb),
       ($1::uuid, 'refresh_source', 'completed', 1, $2::timestamptz, $2::timestamptz, null, $7::jsonb)
     on conflict (version_id, job_type) do update set
       status = excluded.status,
       attempts = greatest(mortgage_bank_file_processing_jobs.attempts, excluded.attempts),
       started_at = coalesce(mortgage_bank_file_processing_jobs.started_at, excluded.started_at),
       finished_at = excluded.finished_at,
       last_error = null,
       metadata = excluded.metadata,
       updated_at = now()`,
    [
      ...common,
      extractionJobStatus,
      embeddingJobStatus,
      JSON.stringify({
        extractor: searchablePdf ? 'pdfjs-dist' : 'unsupported',
        chunkCount: plan.document.extracted.chunks.length,
        importer: 'seed-official-bank-files.mjs',
      }),
      JSON.stringify({
        model: searchablePdf ? EMBEDDING_MODEL : null,
        dimensions: searchablePdf ? EMBEDDING_DIMENSIONS : null,
        status: searchablePdf ? 'completed' : 'disabled',
        recipeVersion: EMBEDDING_RECIPE,
        chunkCount: plan.document.extracted.chunks.length,
        importer: 'seed-official-bank-files.mjs',
      }),
      JSON.stringify({
        source: 'official_manifest',
        resolvedUrl: plan.document.download.resolvedUrl,
        importer: 'seed-official-bank-files.mjs',
      }),
    ],
  )
  await database.query(
    `insert into public.mortgage_bank_file_processing_jobs (
       version_id, job_type, status, attempts, finished_at, last_error, metadata
     ) values ($1::uuid, 'describe', 'cancelled', 0, $2::timestamptz, null, $3::jsonb)
     on conflict (version_id, job_type) do nothing`,
    [
      plan.versionId,
      now,
      JSON.stringify({
        reason: 'description_not_required_by_official_seed',
        importer: 'seed-official-bank-files.mjs',
      }),
    ],
  )
}

async function insertChunksAndEmbeddings(database, plan) {
  const chunks = plan.document.extracted.chunks
  const inserted = await database.query(
    `insert into public.mortgage_bank_file_chunks (
       version_id, chunk_index, page_start, page_end, locator, content, token_count
     )
     select $1::uuid,
            item.chunk_index,
            item.page_start,
            item.page_end,
            item.locator,
            item.content,
            item.token_count
       from jsonb_to_recordset($2::jsonb) as item(
         chunk_index integer,
         page_start integer,
         page_end integer,
         locator text,
         content text,
         token_count integer
       )
      order by item.chunk_index
     returning id::text, chunk_index`,
    [
      plan.versionId,
      JSON.stringify(chunks.map(chunk => ({
        chunk_index: chunk.chunkIndex,
        page_start: chunk.pageStart,
        page_end: chunk.pageEnd,
        locator: chunk.locator,
        content: chunk.content,
        token_count: chunk.tokenCount,
      }))),
    ],
  )
  if (inserted.rowCount !== chunks.length) {
    throw new Error(`Failed to persist every chunk for “${plan.document.entry.title}”`)
  }
  const chunkIdByIndex = new Map(inserted.rows.map(row => [row.chunk_index, row.id]))
  const embeddingRows = chunks.map(chunk => ({
    chunk_id: chunkIdByIndex.get(chunk.chunkIndex),
    source_sha256: chunk.embeddingSourceSha256,
    embedding: `[${chunk.embedding.join(',')}]`,
  }))
  const embeddings = await database.query(
    `insert into public.mortgage_bank_file_embeddings (
       chunk_id, embedding_kind, model, dimensions, recipe_version, source_sha256, embedding
     )
     select item.chunk_id,
            'content',
            $2,
            $3,
            $4,
            item.source_sha256,
            item.embedding::extensions.vector
       from jsonb_to_recordset($1::jsonb) as item(
         chunk_id bigint,
         source_sha256 text,
         embedding text
       )`,
    [JSON.stringify(embeddingRows), EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_RECIPE],
  )
  if (embeddings.rowCount !== chunks.length) {
    throw new Error(`Failed to persist every embedding for “${plan.document.entry.title}”`)
  }
}

async function persistProcessedPlan(database, plan, now) {
  const entry = plan.document.entry
  const fileType = SUPPORTED_FILE_TYPES.get(entry.mimeType)
  const searchablePdf = requiresTextExtraction(entry)
  const extractionStatus = searchablePdf ? 'completed' : 'unsupported'
  const embeddingStatus = searchablePdf ? 'completed' : 'disabled'
  const embeddingModel = searchablePdf ? EMBEDDING_MODEL : null
  const embeddingDimensions = searchablePdf ? EMBEDDING_DIMENSIONS : null
  if (!plan.initialState.logicalFileId) {
    await database.query(
      `insert into public.mortgage_bank_files (
         id, bank_id, category_id, title, description, source_page_url,
         created_by_user_id, updated_by_user_id
       ) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, null, null)`,
      [
        plan.fileId,
        plan.bank.id,
        plan.categoryId,
        entry.title.trim(),
        entry.notes?.trim() || null,
        entry.sourcePageUrl,
      ],
    )
  } else {
    await database.query(
      `update public.mortgage_bank_files
          set category_id = $2::uuid,
              description = coalesce($3, description),
              source_page_url = $4,
              updated_by_user_id = null,
              updated_at = now()
        where id = $1::uuid`,
      [plan.fileId, plan.categoryId, entry.notes?.trim() || null, entry.sourcePageUrl],
    )
  }

  const extractionMetadata = {
    extraction: searchablePdf ? 'pdfjs-dist' : 'unsupported',
    ...(plan.document.extracted.reason
      ? { reason: plan.document.extracted.reason }
      : {}),
    chunkCount: plan.document.extracted.chunks.length,
    manifestPageCount: entry.pageCount,
    pageCountMatchesManifest: entry.pageCount === plan.document.extracted.pageCount,
    responseContentType: plan.document.download.responseContentType,
    originalSourceSha256: entry.originalSourceSha256 ?? null,
    derivation: entry.derivation ?? null,
    importer: 'seed-official-bank-files.mjs',
    seedIdentity: `${entry.bankSlug}:${entry.fileName}`,
  }
  if (plan.mode === 'insert') {
    await database.query(
      `insert into public.mortgage_bank_file_versions (
         id, file_id, version_number, version_label, storage_path, original_file_name,
         mime_type, mime_group, size_bytes, checksum_sha256, source_download_url,
         resolved_download_url, source_etag, source_last_modified, effective_from,
         effective_to, published_at, status, extraction_status, embedding_status,
         page_count, extracted_text, extraction_metadata, embedding_model,
         embedding_dimensions, created_by_user_id
       ) values (
         $1::uuid, $2::uuid, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, $13, $14, $15::date,
         $16::date, null, 'current', $17, $18,
         $19, $20, $21::jsonb, $22, $23, null
       )`,
      [
        plan.versionId,
        plan.fileId,
        plan.versionNumber,
        `${plan.versionNumber}.0`,
        plan.storagePath,
        safeFileName(entry.fileName),
        entry.mimeType,
        fileType.mimeGroup,
        plan.document.download.bytes.byteLength,
        plan.document.download.checksum,
        entry.downloadUrl,
        plan.document.download.resolvedUrl,
        plan.document.download.etag,
        plan.document.download.lastModified,
        entry.effectiveFrom ?? null,
        entry.effectiveTo ?? null,
        extractionStatus,
        embeddingStatus,
        plan.document.extracted.pageCount,
        plan.document.extracted.text,
        JSON.stringify(extractionMetadata),
        embeddingModel,
        embeddingDimensions,
      ],
    )
  } else {
    await database.query(
      `delete from public.mortgage_bank_file_chunks where version_id = $1::uuid`,
      [plan.versionId],
    )
    await database.query(
      `update public.mortgage_bank_file_versions
          set status = 'current',
              mime_type = $2,
              mime_group = $3,
              extraction_status = $4,
              embedding_status = $5,
              page_count = $6,
              extracted_text = $7,
              extraction_metadata = $8::jsonb,
              embedding_model = $9,
              embedding_dimensions = $10,
              source_download_url = $11,
              resolved_download_url = $12,
              source_etag = $13,
              source_last_modified = $14,
              effective_from = $15::date,
              effective_to = $16::date,
              updated_at = now()
        where id = $1::uuid`,
      [
        plan.versionId,
        entry.mimeType,
        fileType.mimeGroup,
        extractionStatus,
        embeddingStatus,
        plan.document.extracted.pageCount,
        plan.document.extracted.text,
        JSON.stringify(extractionMetadata),
        embeddingModel,
        embeddingDimensions,
        entry.downloadUrl,
        plan.document.download.resolvedUrl,
        plan.document.download.etag,
        plan.document.download.lastModified,
        entry.effectiveFrom ?? null,
        entry.effectiveTo ?? null,
      ],
    )
  }

  if (searchablePdf) await insertChunksAndEmbeddings(database, plan)
  if (
    plan.initialState.currentVersionId
    && plan.initialState.currentVersionId !== plan.versionId
  ) {
    await database.query(
      `update public.mortgage_bank_file_versions
          set status = 'archived', updated_at = now()
        where id = $1::uuid`,
      [plan.initialState.currentVersionId],
    )
  }
  await database.query(
    `update public.mortgage_bank_files
        set current_version_id = $2::uuid,
            category_id = $3::uuid,
            source_page_url = $4,
            updated_at = now()
      where id = $1::uuid`,
    [plan.fileId, plan.versionId, plan.categoryId, entry.sourcePageUrl],
  )
  if (plan.productId) {
    await database.query(
      `insert into public.mortgage_bank_file_products (file_id, product_id, created_by_user_id)
       values ($1::uuid, $2::uuid, null)
       on conflict (file_id, product_id) do nothing`,
      [plan.fileId, plan.productId],
    )
  }
  await upsertProcessingJobs(database, plan, now)

  const eventMetadata = {
    importer: 'seed-official-bank-files.mjs',
    seedIdentity: `${entry.bankSlug}:${entry.fileName}`,
    bankSlug: entry.bankSlug,
    versionNumber: plan.versionNumber,
    checksumSha256: plan.document.download.checksum,
    sizeBytes: plan.document.download.bytes.byteLength,
    sourceDownloadUrl: entry.downloadUrl,
    resolvedDownloadUrl: plan.document.download.resolvedUrl,
    originalSourceSha256: entry.originalSourceSha256 ?? null,
    derivation: entry.derivation ?? null,
  }
  await database.query(
    `insert into public.mortgage_bank_file_events (
       file_id, version_id, actor_user_id, action, metadata
     )
     select $1::uuid, $2::uuid, null, $3, $4::jsonb
      where not exists (
        select 1
          from public.mortgage_bank_file_events
         where file_id = $1::uuid
           and version_id = $2::uuid
           and action = $3
           and metadata @> $5::jsonb
      )`,
    [
      plan.fileId,
      plan.versionId,
      plan.versionNumber === 1 ? 'file.created' : 'version.created',
      JSON.stringify(eventMetadata),
      JSON.stringify({ seedIdentity: eventMetadata.seedIdentity }),
    ],
  )
  if (searchablePdf) await database.query(
    `insert into public.mortgage_bank_file_events (
       file_id, version_id, actor_user_id, action, metadata
     )
     select $1::uuid, $2::uuid, null, 'file.embeddings_generated', $3::jsonb
      where not exists (
        select 1
          from public.mortgage_bank_file_events
         where file_id = $1::uuid
           and version_id = $2::uuid
           and action = 'file.embeddings_generated'
           and metadata @> $4::jsonb
      )`,
    [
      plan.fileId,
      plan.versionId,
      JSON.stringify({
        importer: 'seed-official-bank-files.mjs',
        seedIdentity: eventMetadata.seedIdentity,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        chunkCount: plan.document.extracted.chunks.length,
      }),
      JSON.stringify({ seedIdentity: eventMetadata.seedIdentity }),
    ],
  )
}

async function persistUnchangedPlan(database, plan) {
  const entry = plan.document.entry
  await database.query(
    `update public.mortgage_bank_files
        set category_id = $2::uuid,
            description = coalesce($3, description),
            source_page_url = $4,
            updated_at = now()
      where id = $1::uuid
        and (
          category_id is distinct from $2::uuid
          or ($3::text is not null and description is distinct from $3::text)
          or source_page_url is distinct from $4::text
        )`,
    [plan.fileId, plan.categoryId, entry.notes?.trim() || null, entry.sourcePageUrl],
  )
  if (plan.productId) {
    await database.query(
      `insert into public.mortgage_bank_file_products (file_id, product_id, created_by_user_id)
       values ($1::uuid, $2::uuid, null)
       on conflict (file_id, product_id) do nothing`,
      [plan.fileId, plan.productId],
    )
  }
}

async function reconcileCanonicalVersionFileName(database, plan) {
  const expectedFileName = safeFileName(plan.document.entry.fileName)
  const version = await database.query(
    `select original_file_name
       from public.mortgage_bank_file_versions
      where id = $1::uuid
      for update`,
    [plan.versionId],
  )
  if (version.rowCount !== 1) {
    throw new Error(`Bank-file version disappeared for “${plan.document.entry.title}”`)
  }
  const currentFileName = version.rows[0].original_file_name
  if (currentFileName === expectedFileName) return

  const owners = await database.query(
    `select template_key
       from public.mortgage_document_templates
      where source_file_version_id = $1::uuid
      order by template_key`,
    [plan.versionId],
  )
  if (owners.rowCount > 0) {
    throw new Error(
      `Cannot rename the immutable bank-file version for “${plan.document.entry.title}” from `
      + `“${currentFileName}” to “${expectedFileName}” because it is pinned by `
      + owners.rows.map(row => row.template_key).join(', '),
    )
  }

  const updated = await database.query(
    `update public.mortgage_bank_file_versions
        set original_file_name = $2,
            updated_at = now()
      where id = $1::uuid
        and original_file_name = $3
      returning id`,
    [plan.versionId, expectedFileName, currentFileName],
  )
  if (updated.rowCount !== 1) {
    throw new Error(`Bank-file version changed while renaming “${plan.document.entry.title}”`)
  }
  process.stdout.write(
    `Canonicalized bank-file name for ${plan.document.entry.bankSlug}: `
    + `${currentFileName} -> ${expectedFileName}\n`,
  )
}

async function verifyPersistedPlan(database, plan) {
  const result = await database.query(
    `select file.id::text,
            file.current_version_id::text,
            version.id::text as version_id,
            version.original_file_name,
            version.status,
            version.extraction_status,
            version.embedding_status,
            (select count(*)::integer
               from public.mortgage_bank_file_chunks as chunk
              where chunk.version_id = version.id) as chunk_count,
            (select count(*)::integer
               from public.mortgage_bank_file_chunks as chunk
               join public.mortgage_bank_file_embeddings as embedding
                 on embedding.chunk_id = chunk.id
                and embedding.embedding_kind = 'content'
                and embedding.model = $4
                and embedding.recipe_version = $5
              where chunk.version_id = version.id) as embedding_count,
            exists(
              select 1 from public.mortgage_bank_file_products as link
               where link.file_id = file.id and link.product_id = $3::uuid
            ) as has_product
       from public.mortgage_bank_files as file
       join public.mortgage_bank_file_versions as version
         on version.file_id = file.id
        and version.checksum_sha256 = $2
      where file.id = $1::uuid`,
    [
      plan.fileId,
      plan.document.download.checksum,
      plan.productId,
      EMBEDDING_MODEL,
      EMBEDDING_RECIPE,
    ],
  )
  if (result.rowCount !== 1) {
    throw new Error(`Persisted version verification failed for “${plan.document.entry.title}”`)
  }
  const row = result.rows[0]
  const expectedFileName = safeFileName(plan.document.entry.fileName)
  const searchablePdf = requiresTextExtraction(plan.document.entry)
  const contentReady = searchablePdf
    ? row.extraction_status === 'completed'
      && row.embedding_status === 'completed'
      && row.chunk_count > 0
      && row.chunk_count === row.embedding_count
    : row.extraction_status === 'unsupported'
      && row.embedding_status === 'disabled'
      && Number(row.chunk_count) === 0
      && Number(row.embedding_count) === 0
  const sourceReady = row.current_version_id === row.version_id
    && row.status === 'current'
    && row.original_file_name === expectedFileName
  if (!sourceReady || !contentReady || (plan.productId && !row.has_product)) {
    throw new Error(`Persisted data is incomplete for “${plan.document.entry.title}”`)
  }
}

async function commitPlans(database, plans, bankCatalog) {
  await database.query('begin isolation level serializable')
  try {
    await database.query(`set local lock_timeout = '15s'`)
    await database.query(`set local statement_timeout = '180s'`)
    await upsertManagedCategories(database, plans)
    await upsertBankCatalog(database, plans, bankCatalog)
    for (const plan of plans) await assertPlanState(database, plan)

    const now = new Date().toISOString()
    for (const plan of plans) {
      if (plan.mode !== 'insert') await reconcileCanonicalVersionFileName(database, plan)
      if (plan.mode === 'unchanged') await persistUnchangedPlan(database, plan)
      else await persistProcessedPlan(database, plan, now)
    }
    for (const plan of plans) await verifyPersistedPlan(database, plan)
    await database.query('commit')
  } catch (error) {
    await database.query('rollback').catch(() => {})
    throw error
  }
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2))
  if (arguments_.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }

  const bankCatalog = validateBankCatalog(
    JSON.parse(await readFile(bankCatalogPath, 'utf8')),
  )
  const manifest = validateManifest(
    JSON.parse(await readFile(manifestPath, 'utf8')),
    bankCatalog,
  )
  if (!arguments_.apply) {
    ensurePdfJsGlobals()
    const pdfjs = await importFrom(crmRequire, 'pdfjs-dist/legacy/build/pdf.mjs')
    let chunkCount = 0
    let spreadsheetCount = 0
    let nonSearchablePdfCount = 0
    for (const entry of manifest) {
      const bundled = await readBundledFile(entry)
      if (requiresTextExtraction(entry)) {
        const extracted = await extractPdf(pdfjs, bundled.bytes, entry)
        chunkCount += extracted.chunks.length
      } else {
        if (entry.mimeType === 'application/pdf') nonSearchablePdfCount += 1
        else spreadsheetCount += 1
      }
    }
    const banks = new Map()
    for (const entry of manifest) banks.set(entry.bankSlug, (banks.get(entry.bankSlug) ?? 0) + 1)
    process.stdout.write(
      `DRY RUN: validated ${manifest.length} official files (${spreadsheetCount} XLSX, ${nonSearchablePdfCount} non-searchable PDF), bundled checksums, PDF page counts, and ${chunkCount} extractable chunks across ${banks.size} banks.\n`,
    )
    for (const [bank, count] of banks) process.stdout.write(`  ${bank}: ${count}\n`)
    process.stdout.write(
      `No network, Blob, AI Gateway, or database operation was performed.\n\n${usage()}\n`,
    )
    return
  }

  const configuration = productionConfiguration()
  const runtime = await loadRuntimeDependencies()
  const database = new Client({
    connectionString: configuration.databaseUrl,
    application_name: 'openexpert-official-bank-file-seeder',
    connectionTimeoutMillis: 20_000,
    keepAlive: true,
  })
  let lockHeld = false
  let uploadedPaths = []
  let committed = false

  try {
    await database.connect()
    await database.query('select pg_advisory_lock(hashtext($1))', [SEED_LOCK])
    lockHeld = true
    await assertRequiredSchema(database)
    const catalog = await loadCatalog(database, manifest, bankCatalog)

    const documents = []
    for (const [index, entry] of manifest.entries()) {
      process.stdout.write(`[${index + 1}/${manifest.length}] Verifying ${entry.bankSlug}: ${entry.title}\n`)
      const download = await readBundledFile(entry)
      documents.push({ entry, download, extracted: null })
    }

    const plans = await createPlans(database, catalog, documents)
    const requiringProcessing = plans.filter(item => item.mode !== 'unchanged')
    for (const [index, plan] of requiringProcessing.entries()) {
      process.stdout.write(
        `[${index + 1}/${requiringProcessing.length}] Extracting ${plan.document.entry.title}\n`,
      )
      plan.document.extracted = requiresTextExtraction(plan.document.entry)
        ? await extractPdf(
            runtime.pdfjs,
            plan.document.download.bytes,
            plan.document.entry,
          )
        : unsupportedExtraction(plan.document.entry)
    }
    if (requiringProcessing.length > 0) {
      process.stdout.write(
        `Generating embeddings for ${requiringProcessing.length} document(s) through Vercel AI Gateway\n`,
      )
      await generateEmbeddings(runtime.embedMany, runtime.gateway, requiringProcessing.map(
        plan => plan.document,
      ))
    }

    uploadedPaths = await ensureBlobs(runtime.blob, configuration, plans)
    await commitPlans(database, plans, bankCatalog)
    committed = true

    const counts = plans.reduce((result, plan) => {
      result[plan.mode] += 1
      return result
    }, { insert: 0, repair: 0, unchanged: 0 })
    process.stdout.write(
      `Official bank-file seed completed atomically: ${counts.insert} inserted, `
      + `${counts.repair} repaired, ${counts.unchanged} unchanged.\n`,
    )
  } finally {
    if (!committed && uploadedPaths.length > 0) {
      await deleteBlobsBestEffort(runtime.blob, configuration, uploadedPaths)
    }
    if (lockHeld) {
      await database.query('select pg_advisory_unlock(hashtext($1))', [SEED_LOCK]).catch(() => {})
    }
    await database.end().catch(() => {})
  }
}

await main()
