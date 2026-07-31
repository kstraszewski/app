import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAuthenticatedDataApiClient,
  createDataApiTokenSigner,
} from '@openexpert/data-api'
import {
  createMinioStorageProvider,
  createStorageClient,
  createStorageBucketAdapter,
  getStorageNamespaceDefinition,
} from '@openexpert/storage'

const BUCKET = 'mortgage-bank-files'
const MAXIMUM_BYTES = 50 * 1024 * 1024
const EMBEDDING_MODEL = 'gemini-embedding-2'
const EMBEDDING_DIMENSIONS = 768
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../../..')
const manifestPath = join(
  repositoryRoot,
  'packages/database/data/mortgages/official-bank-files.json',
)

const officialBankDomains = new Map([
  ['erste', ['erste.pl']],
  ['ing', ['ing.pl']],
  ['mbank', ['mbank.pl']],
  ['pekao', ['pekao.com.pl']],
  ['pko-bp', ['pkobp.pl']],
])

function parseEnvFile(content) {
  const values = {}

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line)
    if (!match) continue

    const [, key, rawValue] = match
    let value = rawValue.trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.replace(/\s+#.*$/u, '').trim()
    }
    values[key] = value
  }

  return values
}

async function readOptionalText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return ''
    throw error
  }
}

function requireConfiguration(values, key) {
  const value = String(values[key] ?? '').trim()
  if (!value) throw new Error(`Brak wymaganej konfiguracji ${key}.`)
  return value
}

function privateKey(value) {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    throw new Error(
      'Brak NUXT_DATA_API_JWT_PRIVATE_KEY. Uruchom najpierw pnpm db:local:setup.',
    )
  }
  if (normalized.includes('-----BEGIN')) return normalized.replace(/\\n/gu, '\n')

  const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim()
  if (!decoded.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error(
      'NUXT_DATA_API_JWT_PRIVATE_KEY musi być kluczem PKCS8 PEM '
      + 'albo jego reprezentacją base64.',
    )
  }
  return decoded
}

function assertLocalUrl(value, label) {
  const parsed = new URL(value)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error(
      `${label} działa wyłącznie lokalnie (otrzymano host: ${parsed.hostname}).`,
    )
  }
  return parsed.toString().replace(/\/+$/u, '')
}

async function loadLocalPlatformClient() {
  const rootValues = parseEnvFile(await readOptionalText(join(repositoryRoot, '.env')))
  const stackValues = parseEnvFile(
    await readOptionalText(join(repositoryRoot, '.env.local-stack')),
  )
  const crmValues = parseEnvFile(await readOptionalText(join(repositoryRoot, 'apps/crm/.env')))
  const values = { ...rootValues, ...stackValues, ...crmValues, ...process.env }
  const dataApiUrl = values.NUXT_PUBLIC_DATA_API_URL || values.NUXT_DATA_API_URL
  if (!dataApiUrl) {
    throw new Error(
      'Brak lokalnego Data API. Uruchom pnpm db:local:setup albo ustaw '
      + 'NUXT_PUBLIC_DATA_API_URL.',
    )
  }

  if ((values.NUXT_STORAGE_PROVIDER || 'minio') !== 'minio') {
    throw new Error(
      'Importer lokalny wymaga NUXT_STORAGE_PROVIDER=minio.',
    )
  }

  const signer = createDataApiTokenSigner({
    audience: requireConfiguration(values, 'NUXT_DATA_API_JWT_AUDIENCE'),
    issuer: requireConfiguration(values, 'NUXT_DATA_API_JWT_ISSUER'),
    keyId: requireConfiguration(values, 'NUXT_DATA_API_JWT_KEY_ID'),
    privateKey: privateKey(values.NUXT_DATA_API_JWT_PRIVATE_KEY),
    ttlSeconds: 60,
  })
  const minioEndpoint = assertLocalUrl(
    values.NUXT_MINIO_ENDPOINT || 'http://127.0.0.1:55326',
    'Importer plików bankowych',
  )
  const storage = createStorageBucketAdapter(
    createStorageClient(createMinioStorageProvider({
      endpoint: minioEndpoint,
      region: values.NUXT_MINIO_REGION || 'us-east-1',
      accessKeyId: requireConfiguration(values, 'NUXT_MINIO_ACCESS_KEY_ID'),
      secretAccessKey: requireConfiguration(values, 'NUXT_MINIO_SECRET_ACCESS_KEY'),
      publicBucket: values.NUXT_MINIO_PUBLIC_BUCKET || 'openexpert-public',
      privateBucket: values.NUXT_MINIO_PRIVATE_BUCKET || 'openexpert-private',
      publicBaseUrl: values.NUXT_MINIO_PUBLIC_BASE_URL || undefined,
    })),
  )
  const client = createAuthenticatedDataApiClient(
    assertLocalUrl(dataApiUrl, 'Importer plików bankowych'),
    () => signer.signBackend({ source: 'official-bank-file-importer' }),
    {
      headers: {
        'X-Client-Info': 'openexpert-official-bank-file-importer/2.0',
      },
      retry: false,
    },
  )
  return Object.assign(client, { storage })
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} nie jest obiektem.`)
  }
}

function assertOptionalDate(value, label) {
  if (value === null || value === undefined) return
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} musi mieć format YYYY-MM-DD albo null.`)
  }
}

function assertOfficialUrl(bankSlug, value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} jest wymagany.`)
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:') throw new Error(`${label} musi używać HTTPS.`)

  const allowedDomains = officialBankDomains.get(bankSlug) ?? []
  const isOfficial = allowedDomains.some(
    domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
  )
  if (!isOfficial) {
    throw new Error(`${label} nie wskazuje oficjalnej domeny banku ${bankSlug}.`)
  }
}

function validateManifest(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Manifest dokumentów jest pusty albo ma nieprawidłowy format.')
  }

  const identities = new Set()
  for (const [index, entry] of value.entries()) {
    const label = `manifest[${index}]`
    assertPlainObject(entry, label)

    for (const field of ['bankSlug', 'title', 'category', 'fileName', 'mimeType']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`${label}.${field} jest wymagany.`)
      }
    }
    if (!officialBankDomains.has(entry.bankSlug)) {
      throw new Error(`${label}.bankSlug nie jest obsługiwany: ${entry.bankSlug}.`)
    }
    if (entry.mimeType !== 'application/pdf') {
      throw new Error(`${label}.mimeType musi mieć wartość application/pdf.`)
    }
    assertOfficialUrl(entry.bankSlug, entry.downloadUrl, `${label}.downloadUrl`)
    assertOfficialUrl(entry.bankSlug, entry.sourcePageUrl, `${label}.sourcePageUrl`)
    assertOptionalDate(entry.effectiveFrom, `${label}.effectiveFrom`)
    assertOptionalDate(entry.effectiveTo, `${label}.effectiveTo`)

    if (
      entry.pageCount !== undefined
      && (!Number.isInteger(entry.pageCount) || entry.pageCount < 1)
    ) {
      throw new Error(`${label}.pageCount musi być dodatnią liczbą całkowitą.`)
    }

    const identity = `${entry.bankSlug}\u0000${entry.title.trim().toLocaleLowerCase('pl-PL')}`
    if (identities.has(identity)) throw new Error(`${label} duplikuje bank i tytuł dokumentu.`)
    identities.add(identity)
  }

  return value
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.once('error', rejectPromise)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr })
        return
      }
      const cause = signal ? `sygnał ${signal}` : `kod ${code}`
      rejectPromise(new Error(`${command} zakończył się błędem (${cause}): ${stderr.trim()}`))
    })
  })
}

function parseFinalResponseHeaders(rawHeaders) {
  const blocks = rawHeaders
    .replace(/\r\n/gu, '\n')
    .split(/\n\n+/u)
    .map(block => block.trim())
    .filter(block => /^HTTP\/\S+\s+\d+/iu.test(block))
  const lastBlock = blocks.at(-1)
  const headers = new Map()

  if (!lastBlock) return headers
  for (const line of lastBlock.split('\n').slice(1)) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
  }
  return headers
}

async function downloadPdf(entry, temporaryDirectory) {
  const binaryPath = join(temporaryDirectory, `${randomUUID()}.pdf`)
  const headersPath = `${binaryPath}.headers`
  const result = await run('curl', [
    '-4',
    '--http1.1',
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    '--retry',
    '2',
    '--retry-all-errors',
    '--connect-timeout',
    '15',
    '--max-time',
    '120',
    '--proto',
    '=https',
    '--proto-redir',
    '=https',
    '--user-agent',
    'Mozilla/5.0 (compatible; OpenExpertBankFileImporter/1.0)',
    '--dump-header',
    headersPath,
    '--output',
    binaryPath,
    '--write-out',
    '%{url_effective}',
    entry.downloadUrl,
  ])

  const fileStats = await stat(binaryPath)
  if (fileStats.size < 5 || fileStats.size > MAXIMUM_BYTES) {
    throw new Error(
      `${entry.title}: rozmiar ${fileStats.size} B jest poza dozwolonym zakresem.`,
    )
  }

  const bytes = await readFile(binaryPath)
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error(`${entry.title}: pobrany plik nie rozpoczyna się od sygnatury %PDF-.`)
  }

  const responseHeaders = parseFinalResponseHeaders(await readFile(headersPath, 'utf8'))
  return {
    bytes,
    resolvedUrl: result.stdout.trim() || entry.downloadUrl,
    etag: responseHeaders.get('etag') ?? null,
    lastModified: responseHeaders.get('last-modified') ?? null,
    responseContentType: responseHeaders.get('content-type') ?? null,
  }
}

function ensurePdfJsGlobals() {
  globalThis.DOMMatrix ||= class DOMMatrix {
    constructor(..._args) {}
  }
  globalThis.Path2D ||= class Path2D {
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
        chunk_index: chunkIndex,
        page_start: pageNumber,
        page_end: pageNumber,
        locator: `s. ${pageNumber}`,
        content,
        token_count: Math.max(1, Math.ceil(content.length / 4)),
      })
      chunkIndex += 1
    }
    offset = Math.max(end, offset + 1)
  }

  return chunks
}

async function extractPdf(bytes) {
  ensurePdfJsGlobals()
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
  })

  try {
    const document = await loadingTask.promise
    const chunks = []
    const pages = []

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

    return {
      pageCount: document.numPages,
      text: pages.filter(Boolean).join('\n\n').slice(0, 250_000),
      chunks,
    }
  } finally {
    await loadingTask.destroy()
  }
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function resultData(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`)
  }
  return result.data
}

async function loadCatalog(client) {
  const [banksResult, categoriesResult, productsResult] = await Promise.all([
    client.from('mortgage_banks').select('id, slug, name'),
    client
      .from('mortgage_bank_file_categories')
      .select('id, category_key')
      .eq('is_archived', false),
    client
      .from('mortgage_products')
      .select('id, bank_id, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
  ])

  const banks = resultData(banksResult, 'Nie udało się pobrać banków')
  const categories = resultData(categoriesResult, 'Nie udało się pobrać kategorii plików')
  const products = resultData(productsResult, 'Nie udało się pobrać produktów hipotecznych')
  if (getStorageNamespaceDefinition(BUCKET).access !== 'private') {
    throw new Error(`Przestrzeń plików ${BUCKET} musi być prywatna.`)
  }

  const banksBySlug = new Map(banks.map(bank => [bank.slug, bank]))
  const categoriesByKey = new Map(
    categories.map(category => [category.category_key, category.id]),
  )
  const firstProductByBank = new Map()
  for (const product of products) {
    if (!firstProductByBank.has(product.bank_id)) {
      firstProductByBank.set(product.bank_id, product.id)
    }
  }

  return { banksBySlug, categoriesByKey, firstProductByBank }
}

async function findLogicalFile(client, bankId, title) {
  const result = await client
    .from('mortgage_bank_files')
    .select('id, title, current_version_id')
    .eq('bank_id', bankId)
    .is('archived_at', null)
    .limit(500)
  const rows = resultData(result, 'Nie udało się odczytać logicznych plików banku')
  const normalizedTitle = title.trim().toLocaleLowerCase('pl-PL')
  return rows.find(
    row => row.title.trim().toLocaleLowerCase('pl-PL') === normalizedTitle,
  ) ?? null
}

async function ensureProductLink(client, fileId, productId) {
  if (!productId) return
  const result = await client
    .from('mortgage_bank_file_products')
    .upsert(
      {
        file_id: fileId,
        product_id: productId,
        created_by_user_id: null,
      },
      { onConflict: 'file_id,product_id', ignoreDuplicates: true },
    )
  resultData(result, 'Nie udało się powiązać pliku z produktem')
}

async function rollbackImportedVersion(
  client,
  { fileId, versionId, storagePath, previousVersionId, createdLogicalFile },
) {
  if (createdLogicalFile) {
    await client.from('mortgage_bank_files').delete().eq('id', fileId)
  } else {
    await client
      .from('mortgage_bank_files')
      .update({ current_version_id: previousVersionId })
      .eq('id', fileId)
    if (previousVersionId) {
      await client
        .from('mortgage_bank_file_versions')
        .update({ status: 'current' })
        .eq('id', previousVersionId)
    }
    await client.from('mortgage_bank_file_versions').delete().eq('id', versionId)
  }
  if (storagePath) await client.storage.from(BUCKET).remove([storagePath])
}

async function importDocument(client, catalog, entry, downloaded) {
  const bank = catalog.banksBySlug.get(entry.bankSlug)
  if (!bank) throw new Error(`Brak banku o slug ${entry.bankSlug} w lokalnej bazie.`)

  const categoryId = catalog.categoriesByKey.get(entry.category)
  if (!categoryId) throw new Error(`Brak kategorii ${entry.category} w lokalnej bazie.`)

  const productId = catalog.firstProductByBank.get(bank.id) ?? null
  const checksum = sha256(downloaded.bytes)
  const title = entry.title.trim()
  let logicalFile = await findLogicalFile(client, bank.id, title)
  let createdLogicalFile = false

  if (!logicalFile) {
    const createResult = await client
      .from('mortgage_bank_files')
      .insert({
        bank_id: bank.id,
        category_id: categoryId,
        title,
        description: entry.notes ?? null,
        source_page_url: entry.sourcePageUrl,
        created_by_user_id: null,
        updated_by_user_id: null,
      })
      .select('id, title, current_version_id')
      .single()
    logicalFile = resultData(createResult, `Nie udało się utworzyć pliku „${title}”`)
    createdLogicalFile = true
  }

  const fileId = logicalFile.id
  const duplicateResult = await client
    .from('mortgage_bank_file_versions')
    .select('id, version_number, status')
    .eq('file_id', fileId)
    .eq('checksum_sha256', checksum)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const duplicate = resultData(duplicateResult, `Nie udało się sprawdzić wersji „${title}”`)

  if (duplicate && !['processing', 'failed'].includes(duplicate.status)) {
    const update = {
      category_id: categoryId,
      source_page_url: entry.sourcePageUrl,
      updated_by_user_id: null,
    }
    if (entry.notes) update.description = entry.notes
    resultData(
      await client.from('mortgage_bank_files').update(update).eq('id', fileId),
      `Nie udało się odświeżyć metadanych „${title}”`,
    )
    await ensureProductLink(client, fileId, productId)
    return { status: 'unchanged', versionNumber: duplicate.version_number, pageCount: null }
  }

  if (duplicate) {
    const incompleteVersionResult = await client
      .from('mortgage_bank_file_versions')
      .select('storage_path')
      .eq('id', duplicate.id)
      .single()
    const incompleteVersion = resultData(
      incompleteVersionResult,
      `Nie udało się odczytać niedokończonej wersji „${title}”`,
    )
    resultData(
      await client.storage.from(BUCKET).remove([incompleteVersion.storage_path]),
      `Nie udało się usunąć niedokończonego obiektu „${title}”`,
    )
    resultData(
      await client.from('mortgage_bank_file_versions').delete().eq('id', duplicate.id),
      `Nie udało się usunąć niedokończonej wersji „${title}”`,
    )
  }

  const latestResult = await client
    .from('mortgage_bank_file_versions')
    .select('version_number')
    .eq('file_id', fileId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const latest = resultData(latestResult, `Nie udało się ustalić numeru wersji „${title}”`)
  const versionNumber = Number(latest?.version_number ?? 0) + 1
  const versionId = randomUUID()
  const storagePath = `${bank.id}/${fileId}/${versionId}/${safeFileName(entry.fileName)}`
  const previousVersionId = logicalFile.current_version_id ?? null
  let uploaded = false

  try {
    const uploadResult = await client.storage
      .from(BUCKET)
      .upload(storagePath, downloaded.bytes, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
      })
    resultData(uploadResult, `Nie udało się zapisać PDF „${title}” w Storage`)
    uploaded = true

    const createVersionResult = await client
      .from('mortgage_bank_file_versions')
      .insert({
        id: versionId,
        file_id: fileId,
        version_number: versionNumber,
        version_label: `${versionNumber}.0`,
        storage_path: storagePath,
        original_file_name: safeFileName(entry.fileName),
        mime_type: 'application/pdf',
        mime_group: 'pdf',
        size_bytes: downloaded.bytes.byteLength,
        checksum_sha256: checksum,
        source_download_url: entry.downloadUrl,
        resolved_download_url: downloaded.resolvedUrl,
        source_etag: downloaded.etag,
        source_last_modified: downloaded.lastModified,
        effective_from: entry.effectiveFrom ?? null,
        effective_to: entry.effectiveTo ?? null,
        published_at: null,
        status: 'processing',
        extraction_status: 'processing',
        embedding_status: 'pending',
        created_by_user_id: null,
      })
    resultData(createVersionResult, `Nie udało się utworzyć wersji „${title}”`)

    const extracted = await extractPdf(downloaded.bytes)
    if (extracted.chunks.length) {
      const chunksResult = await client
        .from('mortgage_bank_file_chunks')
        .insert(
          extracted.chunks.map(chunk => ({
            version_id: versionId,
            ...chunk,
          })),
        )
      resultData(chunksResult, `Nie udało się zapisać fragmentów „${title}”`)
    }

    const finishedAt = new Date().toISOString()
    const jobsResult = await client
      .from('mortgage_bank_file_processing_jobs')
      .insert([
        {
          version_id: versionId,
          job_type: 'extract',
          status: 'completed',
          attempts: 1,
          started_at: finishedAt,
          finished_at: finishedAt,
          metadata: { extractor: 'pdfjs-dist', chunkCount: extracted.chunks.length },
        },
        {
          version_id: versionId,
          job_type: 'describe',
          status: 'pending',
          attempts: 0,
          metadata: { reason: 'awaiting_llm_processing' },
        },
        {
          version_id: versionId,
          job_type: 'embed',
          status: extracted.chunks.length ? 'pending' : 'cancelled',
          attempts: 0,
          metadata: {
            model: EMBEDDING_MODEL,
            dimensions: EMBEDDING_DIMENSIONS,
            reason: extracted.chunks.length ? 'awaiting_embedding_worker' : 'no_text_chunks',
          },
        },
        {
          version_id: versionId,
          job_type: 'refresh_source',
          status: 'completed',
          attempts: 1,
          started_at: finishedAt,
          finished_at: finishedAt,
          metadata: {
            source: 'official_manifest',
            resolvedUrl: downloaded.resolvedUrl,
          },
        },
      ])
    resultData(jobsResult, `Nie udało się zapisać zadań przetwarzania „${title}”`)

    const finalizeVersionResult = await client
      .from('mortgage_bank_file_versions')
      .update({
        status: 'current',
        extraction_status: 'completed',
        embedding_status: extracted.chunks.length ? 'pending' : 'disabled',
        page_count: extracted.pageCount,
        extracted_text: extracted.text,
        extraction_metadata: {
          extraction: 'pdfjs-dist',
          chunkCount: extracted.chunks.length,
          manifestPageCount: entry.pageCount ?? null,
          pageCountMatchesManifest: entry.pageCount
            ? entry.pageCount === extracted.pageCount
            : null,
          responseContentType: downloaded.responseContentType,
          importedBy: 'import-official-bank-files.mjs',
        },
        embedding_model: extracted.chunks.length ? EMBEDDING_MODEL : null,
        embedding_dimensions: extracted.chunks.length ? EMBEDDING_DIMENSIONS : null,
      })
      .eq('id', versionId)
    resultData(finalizeVersionResult, `Nie udało się sfinalizować wersji „${title}”`)

    const fileUpdate = {
      current_version_id: versionId,
      category_id: categoryId,
      source_page_url: entry.sourcePageUrl,
      updated_by_user_id: null,
    }
    if (entry.notes) fileUpdate.description = entry.notes
    resultData(
      await client.from('mortgage_bank_files').update(fileUpdate).eq('id', fileId),
      `Nie udało się ustawić bieżącej wersji „${title}”`,
    )

    if (previousVersionId) {
      resultData(
        await client
          .from('mortgage_bank_file_versions')
          .update({ status: 'archived' })
          .eq('id', previousVersionId),
        `Nie udało się zarchiwizować poprzedniej wersji „${title}”`,
      )
    }

    await ensureProductLink(client, fileId, productId)
    resultData(
      await client.from('mortgage_bank_file_events').insert({
        file_id: fileId,
        version_id: versionId,
        actor_user_id: null,
        action: versionNumber === 1 ? 'file.created' : 'version.created',
        metadata: {
          importer: 'official_manifest',
          bankSlug: entry.bankSlug,
          versionNumber,
          checksumSha256: checksum,
          sizeBytes: downloaded.bytes.byteLength,
          sourceDownloadUrl: entry.downloadUrl,
          resolvedDownloadUrl: downloaded.resolvedUrl,
          sourceEtag: downloaded.etag,
          sourceLastModified: downloaded.lastModified,
        },
      }),
      `Nie udało się zapisać zdarzenia audytowego „${title}”`,
    )

    return {
      status: 'imported',
      versionNumber,
      pageCount: extracted.pageCount,
    }
  } catch (error) {
    await rollbackImportedVersion(client, {
      fileId,
      versionId,
      storagePath: uploaded ? storagePath : null,
      previousVersionId,
      createdLogicalFile,
    })
    throw error
  }
}

async function main() {
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')))
  const client = await loadLocalPlatformClient()
  const catalog = await loadCatalog(client)
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'openexpert-bank-files-'))
  const summary = { imported: 0, unchanged: 0, failed: 0 }

  try {
    for (const entry of manifest) {
      try {
        process.stdout.write(`Pobieranie: ${entry.bankSlug} — ${entry.title}\n`)
        const downloaded = await downloadPdf(entry, temporaryDirectory)
        const result = await importDocument(client, catalog, entry, downloaded)
        summary[result.status] += 1
        const details = result.status === 'imported'
          ? `v${result.versionNumber}, ${result.pageCount} str.`
          : `bez zmian, v${result.versionNumber}`
        process.stdout.write(`  OK: ${details}\n`)
      } catch (error) {
        summary.failed += 1
        const message = error instanceof Error ? error.message : String(error)
        process.stderr.write(`  BŁĄD: ${message}\n`)
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }

  process.stdout.write(
    `Import zakończony: ${summary.imported} nowych wersji, `
    + `${summary.unchanged} bez zmian, ${summary.failed} błędów.\n`,
  )
  if (summary.failed > 0) process.exitCode = 1
}

await main()
