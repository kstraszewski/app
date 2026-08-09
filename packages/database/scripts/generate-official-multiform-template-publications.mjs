import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getTemplate,
  validateTemplateJson,
} from '../../multiform/src/index.ts'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '../../..')
const mortgageDataDirectory = resolve(repositoryRoot, 'packages/database/data/mortgages')
const officialBankFilesPath = resolve(mortgageDataDirectory, 'official-bank-files.json')
const productCatalogPath = resolve(mortgageDataDirectory, 'pl-2026-07-12.json')
const publicationManifestPath = resolve(
  mortgageDataDirectory,
  'official-multiform-template-publications.json',
)
const assetDirectory = resolve(mortgageDataDirectory, 'official-bank-file-assets')

export const PUBLICATION_MANIFEST_SCHEMA =
  'openexpert.mortgage-template-publications/2.0'

function releaseIdentity(release) {
  return `${release.bankSlug}:${release.productSlug}`
}

function templateIdentity(bankSlug, templateId) {
  return `${bankSlug}:${templateId}`
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item) ?? 'null').join(',')}]`
  }
  return `{${Object.keys(value)
    .filter(key => value[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`
}

export function contentSha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function assertPublicationEntry(entry, index) {
  const label = `entries[${index}]`
  assertObject(entry, label)
  if (!entry.templateId || !entry.bankSlug) {
    throw new Error(`${label} must identify a bank and template`)
  }
  if (!Number.isInteger(entry.registryVersion) || entry.registryVersion < 1) {
    throw new Error(`${label}.registryVersion must be a positive integer`)
  }
  const bankFile = assertObject(entry.bankFile, `${label}.bankFile`)
  if (!bankFile.fileName || !/^[0-9a-f]{64}$/u.test(bankFile.sha256 ?? '')) {
    throw new Error(`${label}.bankFile must pin fileName and sha256`)
  }
  const template = assertObject(entry.templateJson, `${label}.templateJson`)
  if (
    template.id !== entry.templateId
    || template.bank !== entry.bankSlug
    || template.version !== entry.registryVersion
    || template.source?.fileName !== bankFile.fileName
    || template.source?.sha256 !== bankFile.sha256
    || (
      template.source?.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ? !(template.source?.pageCount === 0 && bankFile.pageCount === null)
        : template.source?.pageCount !== bankFile.pageCount
    )
  ) {
    throw new Error(`${label} does not match its exact bank-file source`)
  }
  if (contentSha256(template) !== entry.templateContentSha256) {
    throw new Error(`${label}.templateContentSha256 is stale`)
  }
  const validation = validateTemplateJson(template)
  if (!validation.valid || !validation.summary.activationReady) {
    throw new Error(`${label} is not activation-ready`)
  }
  if (canonicalJson(validation) !== canonicalJson(entry.validationReport)) {
    throw new Error(`${label}.validationReport is stale`)
  }
}

export function validatePublicationManifest(value) {
  const manifest = assertObject(value, 'publication manifest')
  if (manifest.schemaVersion !== PUBLICATION_MANIFEST_SCHEMA) {
    throw new Error('Unsupported publication manifest schemaVersion')
  }
  if (manifest.asOf !== '2026-08-09') {
    throw new Error('Publication manifest provenance is invalid')
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error('Publication manifest must contain reviewed templates')
  }
  manifest.entries.forEach(assertPublicationEntry)
  const entryKeys = manifest.entries.map(entry => (
    templateIdentity(entry.bankSlug, entry.templateId)
  ))
  if (new Set(entryKeys).size !== entryKeys.length) {
    throw new Error('Publication manifest contains duplicate bank/template entries')
  }
  if (!Array.isArray(manifest.productReleases) || manifest.productReleases.length === 0) {
    throw new Error('Publication manifest must contain DB-pinned product releases')
  }
  const releaseKeys = manifest.productReleases.map(releaseIdentity)
  if (new Set(releaseKeys).size !== releaseKeys.length) {
    throw new Error('Publication manifest contains duplicate product releases')
  }
  const referencedEntries = new Set()
  for (const [index, releaseValue] of manifest.productReleases.entries()) {
    const release = assertObject(releaseValue, `productReleases[${index}]`)
    if (
      !release.bankSlug
      || !release.productSlug
      || release.calculatorSchemaVersion < 2
      || !Array.isArray(release.templateIds)
      || release.templateIds.length === 0
      || new Set(release.templateIds).size !== release.templateIds.length
      || !Array.isArray(release.documentRequirements)
    ) {
      throw new Error(`productReleases[${index}] is not a DB-pinned release`)
    }
    const requirementTemplateIds = release.documentRequirements.flatMap(requirement => (
      requirement?.templateId ? [requirement.templateId] : []
    ))
    if (
      new Set(requirementTemplateIds).size !== requirementTemplateIds.length
      || canonicalJson([...requirementTemplateIds].sort())
        !== canonicalJson([...release.templateIds].sort())
    ) {
      throw new Error(
        `${releaseIdentity(release)} requirements do not exactly pin its reviewed templates`,
      )
    }
    for (const templateId of release.templateIds) {
      const key = templateIdentity(release.bankSlug, templateId)
      if (!entryKeys.includes(key)) {
        throw new Error(`${releaseIdentity(release)} references unpublished ${templateId}`)
      }
      referencedEntries.add(key)
    }
    const { releaseContentSha256, ...releasePayload } = release
    if (contentSha256(releasePayload) !== releaseContentSha256) {
      throw new Error(`${releaseIdentity(release)} releaseContentSha256 is stale`)
    }
  }
  if (referencedEntries.size !== entryKeys.length) {
    throw new Error('Publication manifest contains templates unused by a product release')
  }
  return manifest
}

export async function buildPublicationManifest() {
  const [officialBankFiles, productCatalog] = await Promise.all([
    readFile(officialBankFilesPath, 'utf8').then(JSON.parse),
    readFile(productCatalogPath, 'utf8').then(JSON.parse),
  ])
  const reviewedProducts = productCatalog.products.filter(item => (
    Number(item.version?.calculatorSchemaVersion ?? 1) >= 2
  ))
  if (reviewedProducts.length === 0) {
    throw new Error('No DB-pinned mortgage products are configured')
  }
  const officialByIdentity = new Map(officialBankFiles.map(entry => [
    `${entry.bankSlug}:${entry.fileName}:${entry.sha256}`,
    entry,
  ]))
  const reviewedTemplateKeys = []
  for (const item of reviewedProducts) {
    for (const templateId of item.version.multiformTemplateIds ?? []) {
      const key = templateIdentity(item.bank.slug, templateId)
      if (!reviewedTemplateKeys.includes(key)) reviewedTemplateKeys.push(key)
    }
  }

  const entries = []
  for (const key of reviewedTemplateKeys) {
    const separator = key.indexOf(':')
    const bankSlug = key.slice(0, separator)
    const templateId = key.slice(separator + 1)
    const template = getTemplate(templateId)
    if (!template || template.bank !== bankSlug) {
      throw new Error(`${templateId}: reviewed registry template is missing`)
    }
    const validation = validateTemplateJson(template)
    if (!validation.valid || !validation.summary.activationReady) {
      throw new Error(`${templateId}: reviewed registry template is not activation-ready`)
    }
    const official = officialByIdentity.get(
      `${bankSlug}:${template.source.fileName}:${template.source.sha256}`,
    )
    if (!official) {
      throw new Error(`${templateId}: exact source is missing from official-bank-files.json`)
    }
    const pageCountMatches = template.source.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ? template.source.pageCount === 0 && official.pageCount === null
      : official.pageCount === template.source.pageCount
    if (!pageCountMatches) {
      throw new Error(`${templateId}: source pageCount differs from the official bank-file entry`)
    }
    const sourceBytes = await readFile(resolve(assetDirectory, official.fileName))
    const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex')
    if (sourceSha256 !== official.sha256) {
      throw new Error(`${templateId}: bundled official document checksum mismatch`)
    }

    entries.push({
      templateId,
      bankSlug,
      registryVersion: template.version,
      bankFile: {
        fileName: official.fileName,
        sha256: official.sha256,
        pageCount: official.pageCount,
        effectiveFrom: official.effectiveFrom,
        effectiveTo: official.effectiveTo,
      },
      templateContentSha256: contentSha256(template),
      templateJson: template,
      validationReport: validation,
    })
  }

  const productReleases = reviewedProducts.map((item) => {
    const payload = {
      bankSlug: item.bank.slug,
      productSlug: item.product.slug,
      sourceVersionKey: item.version.versionKey,
      calculatorSchemaVersion: item.version.calculatorSchemaVersion,
      templateIds: item.version.multiformTemplateIds,
      documentRequirements: item.version.documentRequirements,
    }
    return {
      ...payload,
      releaseContentSha256: contentSha256(payload),
    }
  })

  return validatePublicationManifest({
    schemaVersion: PUBLICATION_MANIFEST_SCHEMA,
    asOf: '2026-08-09',
    entries,
    productReleases,
  })
}

export async function readPublicationManifest() {
  return validatePublicationManifest(
    JSON.parse(await readFile(publicationManifestPath, 'utf8')),
  )
}

async function main() {
  const write = process.argv.includes('--write')
  const unknown = process.argv.slice(2).filter(argument => argument !== '--write')
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`)

  const generated = await buildPublicationManifest()
  const serialized = `${JSON.stringify(generated, null, 2)}\n`
  if (write) {
    await writeFile(publicationManifestPath, serialized)
    process.stdout.write(
      `Wrote ${generated.entries.length} official template publications for ${generated.productReleases.length} DB-pinned products.\n`,
    )
    return
  }

  const existing = await readFile(publicationManifestPath, 'utf8').catch(() => '')
  if (existing !== serialized) {
    throw new Error(
      'Official template publication manifest is stale. Run with --write and review the diff.',
    )
  }
  process.stdout.write(
    `DRY RUN: validated ${generated.entries.length} activation-ready official templates for ${generated.productReleases.length} DB-pinned product releases. No database or network operation was performed.\n`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
