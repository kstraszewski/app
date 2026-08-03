import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Client } from 'pg'

const MAXIMUM_BYTES = 50 * 1024 * 1024
const EMBEDDING_MODEL = 'gemini-embedding-2'
const GATEWAY_EMBEDDING_MODEL = `google/${EMBEDDING_MODEL}`
const EMBEDDING_DIMENSIONS = 768
const EMBEDDING_RECIPE = 'search-result-v1'
const CONFIRMATION = 'IMPORT_15_OFFICIAL_BANK_FILES_TO_PRODUCTION'
const SEED_LOCK = 'openexpert.seed.official-bank-files.v1'
const VERCEL_PROJECT = 'openexpert-crm'
const USER_AGENT = 'OpenExpertOfficialBankFileSeeder/1.0 (+https://openexpert.pl)'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../../..')
const manifestPath = join(
  repositoryRoot,
  'packages/database/data/mortgages/official-bank-files.json',
)

const crmRequire = createRequire(join(repositoryRoot, 'apps/crm/package.json'))
const storageRequire = createRequire(join(repositoryRoot, 'packages/storage/package.json'))

const officialBankDomains = new Map([
  ['erste', ['erste.pl']],
  ['ing', ['ing.pl']],
  ['mbank', ['mbank.pl']],
  ['pekao', ['pekao.com.pl']],
  ['pko-bp', ['pkobp.pl']],
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

The apply mode downloads only HTTPS resources hosted on the official bank domains,
extracts the PDFs, generates 768-dimensional Gemini embeddings through Vercel AI
Gateway, uploads binaries to the private Vercel Blob store, and commits all database
records in one transaction. It never creates users or changes roles.`
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

function productionConfiguration(manifestLength) {
  if (process.env.VERCEL !== '1') {
    throw new Error('Apply mode is restricted to a Vercel build (VERCEL=1)')
  }
  if (process.env.VERCEL_ENV !== 'production') {
    throw new Error('Apply mode requires VERCEL_ENV=production')
  }
  if (manifestLength !== 15 || CONFIRMATION !== `IMPORT_${manifestLength}_OFFICIAL_BANK_FILES_TO_PRODUCTION`) {
    throw new Error(
      `The manifest contains ${manifestLength} entries; update and review the explicit confirmation first`,
    )
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

function validateManifest(value) {
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
    if (!officialBankDomains.has(entry.bankSlug)) {
      throw new Error(`${label}.bankSlug is unsupported: ${entry.bankSlug}`)
    }
    if (entry.mimeType !== 'application/pdf' || !entry.fileName.endsWith('.pdf')) {
      throw new Error(`${label} must describe a PDF file`)
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
    if (!Number.isInteger(entry.pageCount) || entry.pageCount < 1) {
      throw new Error(`${label}.pageCount must be a positive integer`)
    }
    if (entry.notes !== undefined && typeof entry.notes !== 'string') {
      throw new Error(`${label}.notes must be a string when present`)
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

async function readResponseBytes(response, entry) {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BYTES) {
    throw new Error(`${entry.title}: Content-Length exceeds 50 MiB`)
  }
  if (!response.body) throw new Error(`${entry.title}: response body is empty`)

  const parts = []
  let total = 0
  for await (const part of response.body) {
    const bytes = Buffer.from(part)
    total += bytes.byteLength
    if (total > MAXIMUM_BYTES) {
      await response.body.cancel().catch(() => {})
      throw new Error(`${entry.title}: downloaded file exceeds 50 MiB`)
    }
    parts.push(bytes)
  }
  const bytes = Buffer.concat(parts, total)
  if (bytes.byteLength < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error(`${entry.title}: downloaded content is not a PDF`)
  }
  return bytes
}

async function downloadPdf(entry) {
  let currentUrl = new URL(entry.downloadUrl)
  const visited = new Set()

  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    assertOfficialUrl(entry.bankSlug, currentUrl.toString(), `${entry.title} download URL`)
    if (visited.has(currentUrl.toString())) {
      throw new Error(`${entry.title}: redirect loop detected`)
    }
    visited.add(currentUrl.toString())

    const response = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
      headers: {
        accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1',
        'user-agent': USER_AGENT,
      },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === 5) throw new Error(`${entry.title}: too many redirects`)
      const location = response.headers.get('location')
      if (!location) throw new Error(`${entry.title}: redirect has no Location header`)
      const redirected = new URL(location, currentUrl)
      assertOfficialUrl(entry.bankSlug, redirected.toString(), `${entry.title} redirect`)
      currentUrl = redirected
      continue
    }
    if (!response.ok) {
      throw new Error(`${entry.title}: download failed with HTTP ${response.status}`)
    }

    const bytes = await readResponseBytes(response, entry)
    return {
      bytes,
      checksum: sha256(bytes),
      resolvedUrl: currentUrl.toString(),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      responseContentType: response.headers.get('content-type'),
    }
  }
  throw new Error(`${entry.title}: redirect limit exceeded`)
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

async function loadCatalog(database, manifest) {
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
  for (const slug of bankSlugs) {
    const bank = banksBySlug.get(slug)
    if (!bank) throw new Error(`Mortgage bank ${slug} is missing`)
    if (!productByBankId.has(bank.id)) {
      throw new Error(`Mortgage bank ${slug} has no active product to link`)
    }
  }
  for (const key of categoryKeys) {
    if (!categoriesByKey.has(key)) throw new Error(`Active bank-file category ${key} is missing`)
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

function isCompleteVersion(version) {
  return Boolean(
    version
    && ['current', 'archived'].includes(version.status)
    && version.extraction_status === 'completed'
    && version.embedding_status === 'completed'
    && version.chunk_count > 0
    && version.chunk_count === version.embedding_count,
  )
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
      ? (isCompleteVersion(exactVersion) ? 'unchanged' : 'repair')
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
      productId: catalog.productByBankId.get(bank.id),
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

async function assertBlobForExistingVersion(blob, configuration, plan) {
  const metadata = await blob.head(plan.storagePath, {
    storeId: configuration.privateStoreId,
    oidcToken: configuration.oidcToken,
    abortSignal: AbortSignal.timeout(30_000),
  })
  if (metadata.pathname !== plan.storagePath) {
    throw new Error(`Blob pathname mismatch for “${plan.document.entry.title}”`)
  }
  if (metadata.size !== plan.document.download.bytes.byteLength) {
    throw new Error(`Blob size mismatch for “${plan.document.entry.title}”`)
  }
}

async function uploadNewBlobs(blob, configuration, plans) {
  const uploaded = []
  try {
    for (const plan of plans.filter(item => item.mode === 'insert')) {
      const result = await blob.put(
        plan.storagePath,
        plan.document.download.bytes,
        {
          access: 'private',
          storeId: configuration.privateStoreId,
          oidcToken: configuration.oidcToken,
          addRandomSuffix: false,
          allowOverwrite: false,
          contentType: 'application/pdf',
          cacheControlMaxAge: 3_600,
          maximumSizeInBytes: MAXIMUM_BYTES,
          multipart: plan.document.download.bytes.byteLength > 5 * 1024 * 1024,
          abortSignal: AbortSignal.timeout(180_000),
        },
      )
      if (result.pathname !== plan.storagePath) {
        throw new Error(`Uploaded Blob pathname mismatch for “${plan.document.entry.title}”`)
      }
      uploaded.push(plan.storagePath)
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

async function upsertProcessingJobs(database, plan, now) {
  const common = [plan.versionId, now]
  await database.query(
    `insert into public.mortgage_bank_file_processing_jobs (
       version_id, job_type, status, attempts, started_at, finished_at, last_error, metadata
     ) values
       ($1::uuid, 'extract', 'completed', 1, $2::timestamptz, $2::timestamptz, null, $3::jsonb),
       ($1::uuid, 'embed', 'completed', 1, $2::timestamptz, $2::timestamptz, null, $4::jsonb),
       ($1::uuid, 'refresh_source', 'completed', 1, $2::timestamptz, $2::timestamptz, null, $5::jsonb)
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
      JSON.stringify({
        extractor: 'pdfjs-dist',
        chunkCount: plan.document.extracted.chunks.length,
        importer: 'seed-official-bank-files.mjs',
      }),
      JSON.stringify({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
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
    extraction: 'pdfjs-dist',
    chunkCount: plan.document.extracted.chunks.length,
    manifestPageCount: entry.pageCount,
    pageCountMatchesManifest: entry.pageCount === plan.document.extracted.pageCount,
    responseContentType: plan.document.download.responseContentType,
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
         'application/pdf', 'pdf', $7, $8, $9,
         $10, $11, $12, $13::date,
         $14::date, null, 'current', 'completed', 'completed',
         $15, $16, $17::jsonb, $18, $19, null
       )`,
      [
        plan.versionId,
        plan.fileId,
        plan.versionNumber,
        `${plan.versionNumber}.0`,
        plan.storagePath,
        safeFileName(entry.fileName),
        plan.document.download.bytes.byteLength,
        plan.document.download.checksum,
        entry.downloadUrl,
        plan.document.download.resolvedUrl,
        plan.document.download.etag,
        plan.document.download.lastModified,
        entry.effectiveFrom ?? null,
        entry.effectiveTo ?? null,
        plan.document.extracted.pageCount,
        plan.document.extracted.text,
        JSON.stringify(extractionMetadata),
        EMBEDDING_MODEL,
        EMBEDDING_DIMENSIONS,
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
              extraction_status = 'completed',
              embedding_status = 'completed',
              page_count = $2,
              extracted_text = $3,
              extraction_metadata = $4::jsonb,
              embedding_model = $5,
              embedding_dimensions = $6,
              source_download_url = $7,
              resolved_download_url = $8,
              source_etag = $9,
              source_last_modified = $10,
              effective_from = $11::date,
              effective_to = $12::date,
              updated_at = now()
        where id = $1::uuid`,
      [
        plan.versionId,
        plan.document.extracted.pageCount,
        plan.document.extracted.text,
        JSON.stringify(extractionMetadata),
        EMBEDDING_MODEL,
        EMBEDDING_DIMENSIONS,
        entry.downloadUrl,
        plan.document.download.resolvedUrl,
        plan.document.download.etag,
        plan.document.download.lastModified,
        entry.effectiveFrom ?? null,
        entry.effectiveTo ?? null,
      ],
    )
  }

  await insertChunksAndEmbeddings(database, plan)
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
  await database.query(
    `insert into public.mortgage_bank_file_products (file_id, product_id, created_by_user_id)
     values ($1::uuid, $2::uuid, null)
     on conflict (file_id, product_id) do nothing`,
    [plan.fileId, plan.productId],
  )
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
  await database.query(
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
  await database.query(
    `insert into public.mortgage_bank_file_products (file_id, product_id, created_by_user_id)
     values ($1::uuid, $2::uuid, null)
     on conflict (file_id, product_id) do nothing`,
    [plan.fileId, plan.productId],
  )
}

async function verifyPersistedPlan(database, plan) {
  const result = await database.query(
    `select file.id::text,
            version.id::text as version_id,
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
  if (
    row.extraction_status !== 'completed'
    || row.embedding_status !== 'completed'
    || row.chunk_count < 1
    || row.chunk_count !== row.embedding_count
    || !row.has_product
  ) {
    throw new Error(`Persisted data is incomplete for “${plan.document.entry.title}”`)
  }
}

async function commitPlans(database, plans) {
  await database.query('begin isolation level serializable')
  try {
    await database.query(`set local lock_timeout = '15s'`)
    await database.query(`set local statement_timeout = '180s'`)
    for (const plan of plans) await assertPlanState(database, plan)

    const now = new Date().toISOString()
    for (const plan of plans) {
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

  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  if (!arguments_.apply) {
    const banks = new Map()
    for (const entry of manifest) banks.set(entry.bankSlug, (banks.get(entry.bankSlug) ?? 0) + 1)
    process.stdout.write(
      `DRY RUN: validated ${manifest.length} official PDF entries across ${banks.size} banks.\n`,
    )
    for (const [bank, count] of banks) process.stdout.write(`  ${bank}: ${count}\n`)
    process.stdout.write(
      `No network, Blob, AI Gateway, or database operation was performed.\n\n${usage()}\n`,
    )
    return
  }

  const configuration = productionConfiguration(manifest.length)
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
    const catalog = await loadCatalog(database, manifest)

    const documents = []
    for (const [index, entry] of manifest.entries()) {
      process.stdout.write(`[${index + 1}/${manifest.length}] Downloading ${entry.bankSlug}: ${entry.title}\n`)
      const download = await downloadPdf(entry)
      documents.push({ entry, download, extracted: null })
    }

    const plans = await createPlans(database, catalog, documents)
    for (const plan of plans.filter(item => item.mode !== 'insert')) {
      await assertBlobForExistingVersion(runtime.blob, configuration, plan)
    }
    const requiringProcessing = plans.filter(item => item.mode !== 'unchanged')
    for (const [index, plan] of requiringProcessing.entries()) {
      process.stdout.write(
        `[${index + 1}/${requiringProcessing.length}] Extracting ${plan.document.entry.title}\n`,
      )
      plan.document.extracted = await extractPdf(
        runtime.pdfjs,
        plan.document.download.bytes,
        plan.document.entry,
      )
    }
    if (requiringProcessing.length > 0) {
      process.stdout.write(
        `Generating embeddings for ${requiringProcessing.length} document(s) through Vercel AI Gateway\n`,
      )
      await generateEmbeddings(runtime.embedMany, runtime.gateway, requiringProcessing.map(
        plan => plan.document,
      ))
    }

    uploadedPaths = await uploadNewBlobs(runtime.blob, configuration, plans)
    await commitPlans(database, plans)
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
