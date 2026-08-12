import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  buildPublicationManifest,
  canonicalJson,
  PUBLICATION_MANIFEST_SCHEMA,
  readPublicationManifest,
} from '../scripts/generate-official-multiform-template-publications.mjs'
import {
  planTemplatePublication,
  releasedProductVersionContentSha256,
} from '../scripts/seed-official-multiform-templates.mjs'
import {
  catalogCalculatorSchemaVersion,
  templatePinRequirements,
} from '../scripts/sync-mortgage-catalog.mjs'

const catalogUrl = new URL('../data/mortgages/pl-2026-07-12.json', import.meta.url)

test('curated publication artifact exactly matches every reviewed DB-pinned template', async () => {
  const [curated, generated] = await Promise.all([
    readPublicationManifest(),
    buildPublicationManifest(),
  ])
  assert.equal(canonicalJson(curated), canonicalJson(generated))
  assert.equal(curated.schemaVersion, PUBLICATION_MANIFEST_SCHEMA)
  assert.ok(curated.entries.length >= 9)
  assert.ok(curated.productReleases.length >= 2)
  for (const entry of curated.entries) {
    assert.equal(entry.templateJson.source.fileName, entry.bankFile.fileName)
    assert.equal(entry.templateJson.source.sha256, entry.bankFile.sha256)
    assert.equal(entry.validationReport.summary.activationReady, true)
  }
  for (const release of curated.productReleases) {
    assert.ok(release.calculatorSchemaVersion >= 2)
    assert.ok(release.templateIds.length > 0)
    for (const templateId of release.templateIds) {
      const entry = curated.entries.find(entry => (
        entry.bankSlug === release.bankSlug && entry.templateId === templateId
      ))
      assert.ok(entry)
      assert.ok(release.templatePublications.some(publication => (
        publication.templateId === templateId
        && publication.registryVersion === entry.registryVersion
        && publication.templateContentSha256 === entry.templateContentSha256
      )))
    }
  }
})

test('product release identity is content-addressed from immutable base and reviewed policy', async () => {
  const release = (await readPublicationManifest()).productReleases[0]
  const base = 'a'.repeat(64)
  const first = releasedProductVersionContentSha256(base, release)
  assert.match(first, /^[0-9a-f]{64}$/u)
  assert.equal(releasedProductVersionContentSha256(base, release), first)
  assert.notEqual(
    releasedProductVersionContentSha256('b'.repeat(64), release),
    first,
  )
})

test('publication planner is idempotent and refuses reviewed source or payload drift', async () => {
  const entry = (await readPublicationManifest()).entries[0]
  const source = {
    bank_slug: entry.bankSlug,
    template_key: entry.templateId,
    source_file_name: entry.bankFile.fileName,
    source_sha256: entry.bankFile.sha256,
    source_file_id: 'file-1',
    source_file_version_id: 'version-1',
    expected_file_id: 'file-1',
    expected_version_id: 'version-1',
    registry_version: entry.registryVersion,
  }
  assert.deepEqual(planTemplatePublication(null, entry), {
    action: 'create-and-publish',
  })
  assert.deepEqual(planTemplatePublication({
    ...source,
    active_revision: 0,
    active_json: null,
    active_validation_report: null,
    current_published_revision_id: null,
    current_revision_action: null,
    current_revision_number: null,
    current_revision_json: null,
    current_revision_validation: null,
    draft_revision: 1,
    draft_json: entry.templateJson,
    draft_validation_report: entry.validationReport,
  }, entry), { action: 'publish-existing-draft', revision: 1 })
  const published = {
    ...source,
    active_revision: 1,
    active_json: entry.templateJson,
    active_validation_report: entry.validationReport,
    current_published_revision_id: 'revision-1',
    current_revision_action: 'published',
    current_revision_number: 1,
    current_revision_json: entry.templateJson,
    current_revision_validation: entry.validationReport,
    draft_revision: 0,
    draft_json: null,
    draft_validation_report: null,
  }
  assert.deepEqual(planTemplatePublication(published, entry), {
    action: 'unchanged',
    revision: 1,
  })
  assert.throws(
    () => planTemplatePublication({
      ...published,
      active_json: { ...entry.templateJson, label: 'unreviewed drift' },
    }, entry),
    /published revision state is inconsistent/u,
  )
  const nextEntry = {
    ...entry,
    registryVersion: entry.registryVersion + 1,
    templateJson: {
      ...entry.templateJson,
      version: entry.registryVersion + 1,
      label: 'Reviewed label update',
    },
  }
  assert.deepEqual(
    planTemplatePublication(published, nextEntry),
    { action: 'publish-reviewed-revision', revision: 2 },
  )
  assert.throws(
    () => planTemplatePublication(published, {
      ...nextEntry,
      registryVersion: entry.registryVersion + 2,
      templateJson: {
        ...nextEntry.templateJson,
        version: entry.registryVersion + 2,
      },
    }),
    /exact registry version increment/u,
  )
  assert.throws(
    () => planTemplatePublication({
      ...published,
      source_file_version_id: 'another-version',
    }, entry),
    /another bank-file version/u,
  )
})

test('reviewed catalog versions explicitly require database pins while offline fixtures stay legacy', async () => {
  const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'))
  const curated = await readPublicationManifest()
  for (const release of curated.productReleases) {
    const product = catalog.products.find(item => (
      item.bank.slug === release.bankSlug && item.product.slug === release.productSlug
    ))
    assert.ok(product)
    const { version } = product
    assert.ok(version.calculatorSchemaVersion >= 2)
    assert.deepEqual(version.multiformTemplateIds, release.templateIds)
    assert.ok(catalogCalculatorSchemaVersion(version) >= 2)
    assert.equal(catalogCalculatorSchemaVersion(version, { offline: true }), 1)
    assert.deepEqual(
      templatePinRequirements(version).map(requirement => requirement.templateId).sort(),
      [...release.templateIds].sort(),
    )
  }
})

test('production seed order is bank files, immutable template publications, then showcase', async () => {
  const source = await readFile(
    new URL('../scripts/run-production-seeds.mjs', import.meta.url),
    'utf8',
  )
  const combined = source.match(
    /'showcase-and-bank-files': \[([^\]]+)\]/u,
  )?.[1] ?? ''
  assert.ok(combined.indexOf('BANK_FILES_COMMAND') >= 0)
  assert.ok(combined.indexOf('MULTIFORM_TEMPLATES_COMMAND') > combined.indexOf('BANK_FILES_COMMAND'))
  assert.ok(combined.indexOf('SHOWCASE_COMMAND') > combined.indexOf('MULTIFORM_TEMPLATES_COMMAND'))
})
