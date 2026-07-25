import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

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

function runSupabaseStatus() {
  const result = spawnSync('supabase', ['status', '-o', 'json', '--workdir', repoRoot], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || 'Supabase status failed')
  return JSON.parse(result.stdout)
}

function statusValue(status, keys) {
  for (const key of keys) {
    if (typeof status[key] === 'string' && status[key]) return status[key]
  }
  return null
}

function localCredentials() {
  const status = runSupabaseStatus()
  const url = statusValue(status, ['API_URL', 'api_url'])
  const serviceRoleKey = statusValue(status, [
    'SERVICE_ROLE_KEY', 'service_role_key', 'SECRET_KEY', 'secret_key',
  ])
  if (!url || !serviceRoleKey) throw new Error('Local Supabase URL or service role key is missing.')
  return { url, serviceRoleKey }
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
  credentials = localCredentials(),
  { offline = false } = {},
) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const client = createClient(credentials.url, credentials.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
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
      }, { onConflict: 'slug' })
      .select('id')
      .single()
    assertResult(bankError, `Upserting bank ${item.bank.slug}`)
    banks.set(item.bank.slug, bank.id)

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
    const sourceSnapshot = sourceSnapshots.get(item.sourceKey)
    if (!sourceSnapshot) {
      throw new Error(`Source snapshot is missing for ${item.sourceKey}`)
    }
    const semanticVersionKey =
      `${version.versionKey}-${semanticVersionDigest(version).slice(0, 16)}`
    const { data: existingVersion, error: existingVersionError } = await client
      .from('mortgage_product_versions')
      .select('id, version_key, product_id')
      .eq('version_key', semanticVersionKey)
      .maybeSingle()
    assertResult(existingVersionError, `Reading version snapshot ${semanticVersionKey}`)
    const productId = products.get(version.versionKey)
    if (existingVersion && existingVersion.product_id !== productId) {
      throw new Error(`Product version snapshot key collision for ${semanticVersionKey}`)
    }

    if (existingVersion) continue

    const { error } = await client.from('mortgage_product_versions').insert({
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
      representative_example: version.representativeExample,
      assumptions: version.assumptions,
      unknown_fields: version.unknownFields,
    })
    assertResult(error, `Inserting version snapshot ${semanticVersionKey}`)
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
