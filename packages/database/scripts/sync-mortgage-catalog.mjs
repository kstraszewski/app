import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAuthenticatedDataApiClient,
  createDataApiTokenSigner,
} from '@openexpert/data-api'
import {
  createStorageClient,
  createStorageBucketAdapter,
  createVercelBlobStorageProvider,
} from '@openexpert/storage'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDirectory, '../../..')
const manifestPath = resolve(repoRoot, 'packages/database/data/mortgages/pl-2026-07-12.json')
const archiveRoot = resolve(repoRoot, '.data/mortgage-sources')
const bucket = 'mortgage-source-documents'

function detail(error) {
  return error instanceof Error ? error.message : String(error)
}

function assertResult(error, operation) {
  if (error) throw new Error(`${operation}: ${error.message ?? detail(error)}`)
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {}
  const values = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice(7) : line
    const separator = normalized.indexOf('=')
    if (separator < 1) continue

    const key = normalized.slice(0, separator).trim()
    let value = normalized.slice(separator + 1).trim()
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\'')))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function requireConfiguration(values, key) {
  const value = String(values[key] ?? '').trim()
  if (!value) throw new Error(`Missing required local configuration: ${key}`)
  return value
}

function optionalConfiguration(values, key) {
  const value = String(values[key] ?? '').trim()
  return value || undefined
}

function assertLocalUrl(value, label) {
  const url = new URL(value)
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`${label} must be local (received host: ${url.hostname})`)
  }
  return url.toString().replace(/\/+$/u, '')
}

function dataApiPrivateKey(value) {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    throw new Error(
      'NUXT_DATA_API_JWT_PRIVATE_KEY is missing. Run pnpm db:local:setup first.',
    )
  }
  if (normalized.includes('-----BEGIN')) return normalized.replace(/\\n/gu, '\n')

  const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim()
  if (!decoded.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error(
      'NUXT_DATA_API_JWT_PRIVATE_KEY must be PKCS8 PEM or base64-encoded PKCS8 PEM.',
    )
  }
  return decoded
}

export function createLocalMortgageCatalogClient(configuration = {}) {
  const values = {
    ...parseEnvFile(resolve(repoRoot, '.env')),
    ...parseEnvFile(resolve(repoRoot, '.env.blob.local')),
    ...parseEnvFile(resolve(repoRoot, '.env.local-stack')),
    ...parseEnvFile(resolve(repoRoot, 'apps/crm/.env')),
    ...process.env,
    ...configuration,
  }
  const dataApiUrl = values.NUXT_PUBLIC_DATA_API_URL || values.NUXT_DATA_API_URL
  if (!dataApiUrl) {
    throw new Error(
      'Local Data API URL is missing. Run pnpm db:local:setup or set '
      + 'NUXT_PUBLIC_DATA_API_URL.',
    )
  }
  const signer = createDataApiTokenSigner({
    audience: requireConfiguration(values, 'NUXT_DATA_API_JWT_AUDIENCE'),
    issuer: requireConfiguration(values, 'NUXT_DATA_API_JWT_ISSUER'),
    keyId: requireConfiguration(values, 'NUXT_DATA_API_JWT_KEY_ID'),
    privateKey: dataApiPrivateKey(values.NUXT_DATA_API_JWT_PRIVATE_KEY),
    ttlSeconds: 60,
  })
  const storage = createStorageBucketAdapter(
    createStorageClient(createVercelBlobStorageProvider({
      stores: {
        public: {
          token: optionalConfiguration(values, 'NUXT_VERCEL_BLOB_PUBLIC_TOKEN'),
          storeId: optionalConfiguration(values, 'NUXT_VERCEL_BLOB_PUBLIC_STORE_ID'),
          oidcToken: optionalConfiguration(values, 'VERCEL_OIDC_TOKEN'),
          publicBaseUrl: optionalConfiguration(
            values,
            'NUXT_VERCEL_BLOB_PUBLIC_BASE_URL',
          ),
        },
        private: {
          token: optionalConfiguration(values, 'NUXT_VERCEL_BLOB_PRIVATE_TOKEN'),
          storeId: optionalConfiguration(values, 'NUXT_VERCEL_BLOB_PRIVATE_STORE_ID'),
          oidcToken: optionalConfiguration(values, 'VERCEL_OIDC_TOKEN'),
        },
      },
      bypassPrivateDownloadCache: true,
    })),
  )
  const client = createAuthenticatedDataApiClient(
    assertLocalUrl(dataApiUrl, 'Mortgage Data API'),
    () => signer.signBackend({ source: 'mortgage-catalog-sync' }),
    {
      headers: {
        'X-Client-Info': 'openexpert-mortgage-catalog-sync/2.0',
      },
      retry: false,
    },
  )
  return Object.assign(client, { storage })
}

function contentType(source, response) {
  const header = response.headers.get('content-type')?.split(';')[0]
  if (header) return header
  return extname(source.fileName) === '.pdf' ? 'application/pdf' : 'text/html'
}

async function downloadSource(source, asOf) {
  const localDirectory = resolve(archiveRoot, asOf)
  const localPath = resolve(localDirectory, source.fileName)
  mkdirSync(localDirectory, { recursive: true })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(source.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/pdf;q=0.9,*/*;q=0.8',
        'user-agent': 'OpenExpertMortgageMonitor/0.1 (+https://openexpert.pl; public-source archival)',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0) throw new Error('empty response')
    writeFileSync(localPath, buffer)
    return {
      buffer,
      localPath,
      mimeType: contentType(source, response),
      sha256: createHash('sha256').update(buffer).digest('hex'),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function sourceFacts(product) {
  return {
    versionKey: product.version.versionKey,
    interestType: product.version.interestType,
    fixedRatePct: product.version.fixedRatePct ?? null,
    fixedPeriodMonths: product.version.fixedPeriodMonths ?? null,
    marginPct: product.version.marginPct ?? null,
    referenceRateCode: product.version.referenceRateCode ?? null,
    referenceRatePct: product.version.referenceRatePct ?? null,
    representativeAprPct: product.version.representativeAprPct ?? null,
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item) ?? 'null').join(',')}]`
  }
  const entries = Object.keys(value)
    .filter(key => value[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
  return `{${entries.join(',')}}`
}

export function semanticVersionDigest(version) {
  const { versionKey: _versionKey, ...semanticVersion } = version
  return createHash('sha256')
    .update(canonicalJson(semanticVersion))
    .digest('hex')
}

export function catalogCalculatorSchemaVersion(version, { offline = false } = {}) {
  const configured = version.calculatorSchemaVersion ?? 1
  if (!Number.isInteger(configured) || configured < 1) {
    throw new Error(`${version.versionKey}: calculatorSchemaVersion must be a positive integer`)
  }
  // The local offline catalogue intentionally remains a legacy registry fixture.
  // Production/current-source synchronization must use the reviewed DB-pinned policy.
  return offline ? 1 : configured
}

export function templatePinRequirements(version) {
  const configuredIds = [...new Set(version.multiformTemplateIds ?? [])]
  const requirements = (version.documentRequirements ?? []).flatMap((requirement) => (
    requirement.templateId
      ? [{ code: requirement.code, templateId: requirement.templateId }]
      : []
  ))
  if (new Set(requirements.map(requirement => requirement.code)).size !== requirements.length) {
    throw new Error(`${version.versionKey}: template requirement codes must be unique`)
  }
  const requirementIds = [...new Set(requirements.map(requirement => requirement.templateId))]
  if (
    configuredIds.length !== requirementIds.length
    || configuredIds.some(templateId => !requirementIds.includes(templateId))
  ) {
    throw new Error(
      `${version.versionKey}: multiformTemplateIds must exactly match documentRequirements templateId values`,
    )
  }
  return requirements
}

async function assertPinnedProductVersion(client, productVersionId, version) {
  const expected = templatePinRequirements(version)
  if (!expected.length) return
  const { data, error } = await client
    .from('mortgage_product_version_document_templates')
    .select('requirement_code, template_revision_id')
    .eq('product_version_id', productVersionId)
  assertResult(error, `Reading template pins for ${version.versionKey}`)
  const actualCodes = new Set((data ?? []).map(pin => String(pin.requirement_code)))
  if (
    actualCodes.size !== expected.length
    || expected.some(requirement => !actualCodes.has(requirement.code))
  ) {
    throw new Error(
      `${version.versionKey}: immutable product version is missing published template pins`,
    )
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function localDeveloperSource(source, product, manifest) {
  const localDirectory = resolve(archiveRoot, manifest.asOf)
  const localPath = resolve(localDirectory, source.fileName)
  mkdirSync(localDirectory, { recursive: true })
  const fixture = {
    fixture: 'openexpert-local-mortgage-source-v1',
    asOf: manifest.asOf,
    title: source.title,
    sourceUrl: source.url,
    sourceKind: source.kind,
    bankSlug: source.bankSlug,
    facts: product ? sourceFacts(product) : {},
    note: 'Deterministyczny plik developerski. Uruchom pnpm mortgage:sync, aby pobrać bieżące źródło.',
  }
  const buffer = Buffer.from(
    `<!doctype html><html lang="pl"><meta charset="utf-8"><title>${escapeHtml(source.title)}</title>`
    + `<body><h1>${escapeHtml(source.title)}</h1><p>${escapeHtml(fixture.note)}</p>`
    + `<pre>${escapeHtml(JSON.stringify(fixture, null, 2))}</pre></body></html>`,
  )
  writeFileSync(localPath, buffer)
  return {
    buffer,
    localPath,
    mimeType: 'text/html',
    sha256: createHash('sha256').update(buffer).digest('hex'),
    isFixture: true,
  }
}

export async function syncMortgageCatalog(
  client = createLocalMortgageCatalogClient(),
  { offline = false } = {},
) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const banks = new Map()
  const products = new Map()

  for (const item of manifest.products) {
    const { data: bank, error: bankError } = await client
      .from('mortgage_banks')
      .upsert({
        slug: item.bank.slug,
        name: item.bank.name,
        website_url: item.bank.websiteUrl,
        logo_url: item.bank.logoUrl ?? null,
        logo_background_color: item.bank.logoBackgroundColor ?? null,
        brand_color: item.bank.brandColor ?? null,
        brand_foreground_color: item.bank.brandForegroundColor ?? null,
      }, { onConflict: 'slug' })
      .select('id')
      .single()
    assertResult(bankError, `Upserting bank ${item.bank.slug}`)
    banks.set(item.bank.slug, bank.id)

    if (item.bank.aliases?.length) {
      const { error: aliasesError } = await client
        .from('mortgage_bank_aliases')
        .upsert(
          item.bank.aliases.map((alias) => ({
            bank_id: bank.id,
            value: alias.value,
            alias_type: alias.type,
            valid_from: alias.validFrom ?? null,
            valid_to: alias.validTo ?? null,
          })),
          { onConflict: 'bank_id,alias_type,value' },
        )
      assertResult(aliasesError, `Upserting bank aliases ${item.bank.slug}`)
    }

    const { data: product, error: productError } = await client
      .from('mortgage_products')
      .upsert({
        bank_id: bank.id,
        slug: item.product.slug,
        name: item.product.name,
        category: item.product.category,
        is_active: true,
      }, { onConflict: 'bank_id,slug' })
      .select('id')
      .single()
    assertResult(productError, `Upserting product ${item.product.slug}`)
    products.set(item.version.versionKey, product.id)
  }

  const sourceSnapshots = new Map()
  const retrievalSummary = []
  for (const source of manifest.sources) {
    const product = manifest.products.find((item) => item.sourceKey === source.sourceKey)
    let downloaded
    if (offline) {
      downloaded = localDeveloperSource(source, product, manifest)
    } else {
      try {
        downloaded = await downloadSource(source, manifest.asOf)
      } catch (error) {
        throw new Error(
          `[mortgages] ${source.bankSlug}: live source download failed (${detail(error)}). `
          + 'Local fixtures require explicit offline mode.',
        )
      }
    }

    const contentAddressedSourceKey = `${source.sourceKey}-${downloaded.sha256.slice(0, 16)}`
    const { data: baseDocument, error: baseDocumentError } = await client
      .from('mortgage_source_documents')
      .select('id, source_key, sha256, storage_path')
      .eq('source_key', source.sourceKey)
      .maybeSingle()
    assertResult(baseDocumentError, `Reading source ${source.sourceKey}`)

    let document = baseDocument?.sha256 === downloaded.sha256 ? baseDocument : null
    if (!document && baseDocument) {
      const { data: snapshotDocument, error: snapshotDocumentError } = await client
        .from('mortgage_source_documents')
        .select('id, source_key, sha256, storage_path')
        .eq('source_key', contentAddressedSourceKey)
        .maybeSingle()
      assertResult(snapshotDocumentError, `Reading source snapshot ${contentAddressedSourceKey}`)
      if (snapshotDocument && snapshotDocument.sha256 !== downloaded.sha256) {
        throw new Error(`Source snapshot key collision for ${contentAddressedSourceKey}`)
      }
      document = snapshotDocument
    }
    const reusedDocument = Boolean(document)

    if (!document) {
      const sourceKey = baseDocument ? contentAddressedSourceKey : source.sourceKey
      const storagePath = `${manifest.asOf}/${downloaded.sha256}/${source.fileName}`
      const { error: uploadError } = await client.storage
        .from(bucket)
        .upload(storagePath, downloaded.buffer, {
          contentType: downloaded.mimeType,
          upsert: true,
        })
      assertResult(uploadError, `Uploading ${source.fileName}`)

      const { data: insertedDocument, error: documentError } = await client
        .from('mortgage_source_documents')
        .insert({
          source_key: sourceKey,
          bank_id: banks.get(source.bankSlug),
          product_id: product ? products.get(product.version.versionKey) : null,
          title: source.title,
          source_url: source.url,
          source_kind: source.kind,
          mime_type: downloaded?.mimeType ?? null,
          sha256: downloaded?.sha256 ?? null,
          storage_path: storagePath,
          retrieved_at: manifest.retrievedAt,
          published_at: source.publishedAt ?? null,
          retrieval_status: downloaded.isFixture ? 'pending' : 'downloaded',
          extraction_status: downloaded.isFixture ? 'quarantined' : 'reviewed',
          facts: product ? sourceFacts(product) : {},
          error_message: downloaded.isFixture
            ? 'Local deterministic developer fixture used in explicit offline mode.'
            : null,
        })
        .select('id, source_key, sha256, storage_path')
        .single()
      assertResult(documentError, `Inserting source snapshot ${sourceKey}`)
      document = insertedDocument
    }

    sourceSnapshots.set(source.sourceKey, {
      id: document.id,
      sha256: downloaded.sha256,
    })
    retrievalSummary.push({
      bank: source.bankSlug,
      status: downloaded.isFixture
        ? (reusedDocument ? 'fixture-reused' : 'fixture')
        : (reusedDocument ? 'downloaded-reused' : 'downloaded'),
    })
  }

  for (const item of manifest.products) {
    const version = item.version
    const calculatorSchemaVersion = catalogCalculatorSchemaVersion(version, { offline })
    const expectedTemplatePins = templatePinRequirements(version)
    if (calculatorSchemaVersion >= 2 && expectedTemplatePins.length === 0) {
      throw new Error(`${version.versionKey}: DB-pinned catalogue version has no templates`)
    }
    const sourceSnapshot = sourceSnapshots.get(item.sourceKey)
    if (!sourceSnapshot) {
      throw new Error(`Source snapshot is missing for ${item.sourceKey}`)
    }
    const semanticVersionKey =
      `${version.versionKey}-${semanticVersionDigest(version).slice(0, 16)}`
    const { data: existingVersion, error: existingVersionError } = await client
      .from('mortgage_product_versions')
      .select('id, version_key, product_id, calculator_schema_version')
      .eq('version_key', semanticVersionKey)
      .maybeSingle()
    assertResult(existingVersionError, `Reading version snapshot ${semanticVersionKey}`)
    const productId = products.get(version.versionKey)
    if (existingVersion && existingVersion.product_id !== productId) {
      throw new Error(`Product version snapshot key collision for ${semanticVersionKey}`)
    }

    if (existingVersion) {
      if (calculatorSchemaVersion >= 2) {
        if (Number(existingVersion.calculator_schema_version) < 2) {
          throw new Error(`${semanticVersionKey}: existing version does not enforce DB template pins`)
        }
        await assertPinnedProductVersion(client, existingVersion.id, version)
      }
      continue
    }

    const { data: insertedVersion, error } = await client.from('mortgage_product_versions').insert({
      version_key: semanticVersionKey,
      product_id: productId,
      source_document_id: sourceSnapshot.id,
      effective_from: version.effectiveFrom ?? null,
      effective_to: version.effectiveTo ?? null,
      retrieved_at: manifest.retrievedAt,
      calculation_date: version.calculationDate ?? null,
      data_status: version.dataStatus,
      completeness_score: version.completenessScore,
      interest_type: version.interestType,
      fixed_rate_pct: version.fixedRatePct ?? null,
      fixed_period_months: version.fixedPeriodMonths ?? null,
      margin_pct: version.marginPct ?? null,
      reference_rate_code: version.referenceRateCode ?? null,
      reference_rate_pct: version.referenceRatePct ?? null,
      reference_rate_as_of: version.referenceRateAsOf ?? null,
      representative_apr_pct: version.representativeAprPct ?? null,
      min_amount: version.minAmount ?? null,
      max_amount: version.maxAmount ?? null,
      min_term_months: version.minTermMonths ?? null,
      max_term_months: version.maxTermMonths ?? null,
      max_ltv_pct: version.maxLtvPct ?? null,
      is_eco: Boolean(version.isEco),
      cost_rules: version.costRules,
      requirements: version.requirements,
      document_requirements: version.documentRequirements ?? [],
      multiform_template_ids: version.multiformTemplateIds ?? [],
      calculator_schema_version: calculatorSchemaVersion,
      multiform_template_policy: calculatorSchemaVersion >= 2
        ? 'database_pinned'
        : 'registry_legacy',
      representative_example: version.representativeExample,
      assumptions: version.assumptions,
      unknown_fields: version.unknownFields,
    }).select('id').single()
    assertResult(error, `Inserting version snapshot ${semanticVersionKey}`)
    if (calculatorSchemaVersion >= 2) {
      if (expectedTemplatePins.length === 0) {
        throw new Error(`${semanticVersionKey}: DB-pinned version has no pin requirements`)
      }
      await assertPinnedProductVersion(client, insertedVersion.id, version)
    }
  }

  console.log(`[mortgages] synchronized ${manifest.products.length} products as of ${manifest.asOf}`)
  for (const item of retrievalSummary) console.log(`  ${item.bank}: ${item.status}`)
  return { products: manifest.products.length, sources: retrievalSummary }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncMortgageCatalog(undefined, {
    offline: process.argv.includes('--offline'),
  }).catch((error) => {
    console.error(detail(error))
    process.exitCode = 1
  })
}
