import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import {
  buildPublicationManifest,
  canonicalJson,
  contentSha256,
  readPublicationManifest,
} from './generate-official-multiform-template-publications.mjs'

const CONFIRMATION = 'PUBLISH_OFFICIAL_MULTIFORM_TEMPLATES_TO_PRODUCTION'
const SEED_LOCK = 'openexpert.seed.official-multiform-templates.v1'
const VERCEL_PROJECT = 'openexpert-crm'
const scriptDirectory = dirname(fileURLToPath(import.meta.url))

function usage() {
  return `Usage:
  node --experimental-strip-types packages/database/scripts/seed-official-multiform-templates.mjs
  node --experimental-strip-types packages/database/scripts/seed-official-multiform-templates.mjs --apply --confirm ${CONFIRMATION}

Without --apply the command validates the curated publication artifact against the
reviewed registry templates and official bundled bank-file versions. Apply mode is
restricted to a Vercel production build. It requires the official bank-file seed to
have completed first and publishes only immutable, bank-file-backed revisions.
Existing exact publications are left unchanged; source or payload drift fails.`
}

function parseArguments(argv) {
  const result = { apply: false, confirm: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--apply') result.apply = true
    else if (argument === '--help' || argument === '-h') result.help = true
    else if (argument === '--confirm') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--confirm requires a value')
      result.confirm = value
      index += 1
    }
    else if (argument.startsWith('--confirm=')) {
      result.confirm = argument.slice('--confirm='.length)
    }
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!result.apply && result.confirm !== null) {
    throw new Error('--confirm is only valid together with --apply')
  }
  if (result.apply && result.confirm !== CONFIRMATION) {
    throw new Error(`Applying requires --confirm ${CONFIRMATION}`)
  }
  return result
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

function productionDatabaseUrl() {
  if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
    throw new Error('Apply mode is restricted to a Vercel production build')
  }
  const oidcClaims = decodeJwtPayload(requiredEnvironment('VERCEL_OIDC_TOKEN'))
  if (
    oidcClaims.environment !== 'production'
    || oidcClaims.project !== VERCEL_PROJECT
    || typeof oidcClaims.sub !== 'string'
    || !oidcClaims.sub.endsWith(':environment:production')
  ) {
    throw new Error('VERCEL_OIDC_TOKEN is not scoped to openexpert-crm production')
  }
  const databaseUrl = String(process.env.DATABASE_URL_UNPOOLED ?? '').trim()
    || requiredEnvironment('DATABASE_URL')
  const host = new URL(databaseUrl).hostname.toLowerCase()
  if (['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('Apply mode refuses a local DATABASE_URL')
  }
  return databaseUrl
}

function sameJson(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

/** Pure publication planner used by the dry-run tests. */
export function planTemplatePublication(existing, entry) {
  if (!existing) return { action: 'create-and-publish' }
  const expectedSource = entry.bankFile
  if (
    existing.bank_slug !== entry.bankSlug
    || existing.template_key !== entry.templateId
    || existing.source_file_name !== expectedSource.fileName
    || existing.source_sha256 !== expectedSource.sha256
    || existing.source_file_id !== existing.expected_file_id
    || existing.source_file_version_id !== existing.expected_version_id
  ) {
    throw new Error(`${entry.templateId}: existing definition is linked to another bank-file version`)
  }

  const hasActive = Number(existing.active_revision) > 0 || existing.active_json !== null
  if (hasActive) {
    if (
      Number(existing.active_revision) < 1
      || !existing.current_published_revision_id
      || existing.current_revision_action !== 'published'
      || Number(existing.current_revision_number) !== Number(existing.active_revision)
      || !sameJson(existing.active_json, existing.current_revision_json)
      || !sameJson(existing.active_validation_report, existing.current_revision_validation)
    ) {
      throw new Error(`${entry.templateId}: published revision state is inconsistent`)
    }
    if (existing.draft_json !== null || Number(existing.draft_revision) !== 0) {
      throw new Error(`${entry.templateId}: an unpublished draft already exists`)
    }
    const payloadMatches = (
      sameJson(existing.active_json, entry.templateJson)
      && sameJson(existing.active_validation_report, entry.validationReport)
    )
    if (payloadMatches) {
      if (Number(existing.registry_version) !== Number(entry.registryVersion)) {
        throw new Error(`${entry.templateId}: registry version differs without payload drift`)
      }
      return { action: 'unchanged', revision: Number(existing.active_revision) }
    }
    if (Number(entry.registryVersion) !== Number(existing.registry_version) + 1) {
      throw new Error(
        `${entry.templateId}: published revision drift requires an exact registry version increment`,
      )
    }
    return {
      action: 'publish-reviewed-revision',
      revision: Number(existing.active_revision) + 1,
    }
  }

  if (
    Number(existing.active_revision) !== 0
    || existing.current_published_revision_id !== null
    || Number(existing.draft_revision) < 1
    || !sameJson(existing.draft_json, entry.templateJson)
    || !sameJson(existing.draft_validation_report, entry.validationReport)
  ) {
    throw new Error(`${entry.templateId}: existing unpublished definition differs from curated payload`)
  }
  return { action: 'publish-existing-draft', revision: 1 }
}

export function releasedProductVersionContentSha256(baseContentSha256, productRelease) {
  if (!/^[0-9a-f]{64}$/u.test(baseContentSha256 ?? '')) {
    throw new Error('Base product version content SHA-256 is invalid')
  }
  return createHash('sha256').update(canonicalJson({
    baseContentSha256,
    releaseContentSha256: productRelease.releaseContentSha256,
  })).digest('hex')
}

async function assertRequiredSchema(database) {
  const result = await database.query(
    `select
       to_regclass('public.mortgage_bank_files') is not null as bank_files,
       to_regclass('public.mortgage_bank_file_versions') is not null as bank_file_versions,
       to_regclass('public.mortgage_document_templates') is not null as templates,
       to_regclass('public.mortgage_document_template_revisions') is not null as revisions,
       to_regclass('public.mortgage_product_versions') is not null as product_versions,
       to_regclass('public.mortgage_product_version_document_templates') is not null as product_pins,
       exists(
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'mortgage_document_templates'
           and column_name = 'source_file_version_id'
       ) as source_link`,
  )
  const state = result.rows[0]
  if (!state || Object.values(state).some(value => value !== true)) {
    throw new Error('Required bank-file/template migrations are missing')
  }
}

async function loadExactBankFile(database, entry) {
  const result = await database.query(
    `select bank.id::text as bank_id,
            bank.slug as bank_slug,
            file.id::text as file_id,
            version.id::text as version_id
       from public.mortgage_banks bank
       join public.mortgage_bank_files file
         on file.bank_id = bank.id
        and file.archived_at is null
       join public.mortgage_bank_file_versions version
         on version.id = file.current_version_id
        and version.file_id = file.id
        and version.status = 'current'
      where bank.slug = $1
        and version.original_file_name = $2
        and version.checksum_sha256 = $3`,
    [entry.bankSlug, entry.bankFile.fileName, entry.bankFile.sha256],
  )
  if (result.rowCount !== 1) {
    throw new Error(
      `${entry.templateId}: exact current bank-file version is missing or ambiguous; run the official bank-file seed first`,
    )
  }
  return result.rows[0]
}

async function loadExistingDefinition(database, entry, source) {
  const result = await database.query(
    `select template.*,
            bank.slug as bank_slug,
            revision.action as current_revision_action,
            revision.revision as current_revision_number,
            revision.template_json as current_revision_json,
            revision.validation_report as current_revision_validation
       from public.mortgage_document_templates template
       join public.mortgage_banks bank on bank.id = template.bank_id
       left join public.mortgage_document_template_revisions revision
         on revision.id = template.current_published_revision_id
      where template.template_key = $1
      for update of template`,
    [entry.templateId],
  )
  if (result.rowCount > 1) throw new Error(`${entry.templateId}: duplicate template definition`)
  if (!result.rows[0]) {
    const owner = await database.query(
      `select template_key
         from public.mortgage_document_templates
        where source_file_version_id = $1::uuid`,
      [source.version_id],
    )
    if (owner.rowCount) {
      throw new Error(
        `${entry.templateId}: bank-file version is already owned by ${owner.rows[0].template_key}`,
      )
    }
    return null
  }
  return {
    ...result.rows[0],
    expected_file_id: source.file_id,
    expected_version_id: source.version_id,
  }
}

async function createAndPublish(database, entry, source) {
  const created = await database.query(
    `insert into public.mortgage_document_templates (
       bank_id, template_key, label, source_file_name, source_sha256,
       source_file_id, source_file_version_id, registry_version,
       draft_json, draft_validation_report, draft_revision, draft_updated_at
     ) values (
       $1::uuid, $2, $3, $4, $5, $6::uuid, $7::uuid, $8,
       $9::jsonb, $10::jsonb, 1, now()
     ) returning id::text`,
    [
      source.bank_id,
      entry.templateId,
      entry.templateJson.label,
      entry.bankFile.fileName,
      entry.bankFile.sha256,
      source.file_id,
      source.version_id,
      entry.registryVersion,
      JSON.stringify(entry.templateJson),
      JSON.stringify(entry.validationReport),
    ],
  )
  const templateId = created.rows[0].id
  await database.query(
    `insert into public.mortgage_document_template_revisions (
       template_id, action, revision, template_json, validation_report, actor_user_id
     ) values ($1::uuid, 'draft_saved', 1, $2::jsonb, $3::jsonb, null)`,
    [templateId, JSON.stringify(entry.templateJson), JSON.stringify(entry.validationReport)],
  )
  await publishDraft(database, templateId, entry, 1)
  return 1
}

async function publishDraft(database, templateId, entry, revision) {
  const published = await database.query(
    `insert into public.mortgage_document_template_revisions (
       template_id, action, revision, template_json, validation_report, actor_user_id
     ) values ($1::uuid, 'published', $2, $3::jsonb, $4::jsonb, null)
     returning id::text`,
    [
      templateId,
      revision,
      JSON.stringify(entry.templateJson),
      JSON.stringify(entry.validationReport),
    ],
  )
  await database.query(
    `update public.mortgage_document_templates
        set label = $2,
            registry_version = $3,
            active_json = $4::jsonb,
            active_validation_report = $5::jsonb,
            active_revision = $6,
            active_published_at = now(),
            active_published_by_user_id = null,
            current_published_revision_id = $7::uuid,
            draft_json = null,
            draft_validation_report = null,
            draft_revision = 0,
            draft_updated_at = null,
            draft_updated_by_user_id = null
      where id = $1::uuid`,
    [
      templateId,
      entry.templateJson.label,
      entry.registryVersion,
      JSON.stringify(entry.templateJson),
      JSON.stringify(entry.validationReport),
      revision,
      published.rows[0].id,
    ],
  )
}

async function publishReviewedRevision(database, existing, entry, revision) {
  await database.query(
    `insert into public.mortgage_document_template_revisions (
       template_id, action, revision, template_json, validation_report, actor_user_id
     ) values ($1::uuid, 'draft_saved', $2, $3::jsonb, $4::jsonb, null)`,
    [
      existing.id,
      revision,
      JSON.stringify(entry.templateJson),
      JSON.stringify(entry.validationReport),
    ],
  )
  await publishDraft(database, existing.id, entry, revision)
}

async function recordPublicationEvent(database, entry, source, revision) {
  const metadata = {
    importer: 'seed-official-multiform-templates.mjs',
    seedIdentity: `${entry.bankSlug}:${entry.templateId}:${entry.templateContentSha256}`,
    templateId: entry.templateId,
    templateContentSha256: entry.templateContentSha256,
    publishedRevision: revision,
  }
  await database.query(
    `insert into public.mortgage_bank_file_events (
       file_id, version_id, actor_user_id, action, metadata
     ) select $1::uuid, $2::uuid, null, 'template.seed_published', $3::jsonb
       where not exists (
         select 1 from public.mortgage_bank_file_events
          where file_id = $1::uuid
            and version_id = $2::uuid
            and action = 'template.seed_published'
            and metadata @> $4::jsonb
       )`,
    [
      source.file_id,
      source.version_id,
      JSON.stringify(metadata),
      JSON.stringify({ seedIdentity: metadata.seedIdentity }),
    ],
  )
}

export function productVersionPinsMatch(rows, productRelease) {
  const expectedById = new Map(productRelease.templatePublications.map(publication => [
    publication.templateId,
    publication,
  ]))
  const actualIds = rows.map(row => row.template_key)
  return (
    actualIds.length === productRelease.templateIds.length
    && productRelease.templateIds.every(templateId => actualIds.includes(templateId))
    && rows.every((row) => {
      const expected = expectedById.get(row.template_key)
      return (
        expected
        && row.action === 'published'
        && row.has_source_file
        && row.has_source_version
        && Number(row.template_json?.version) === Number(expected.registryVersion)
        && contentSha256(row.template_json) === expected.templateContentSha256
      )
    })
  )
}

async function productVersionPinsMatchDatabase(database, productVersionId, productRelease) {
  const result = await database.query(
    `select template.template_key,
            revision.action,
            revision.template_json,
            template.source_file_id is not null as has_source_file,
            template.source_file_version_id is not null as has_source_version
       from public.mortgage_product_version_document_templates pin
       join public.mortgage_document_template_revisions revision
         on revision.id = pin.template_revision_id
       join public.mortgage_document_templates template
         on template.id = revision.template_id
      where pin.product_version_id = $1::uuid
      order by pin.sort_order, template.template_key`,
    [productVersionId],
  )
  return productVersionPinsMatch(result.rows, productRelease)
}

async function verifyProductVersionPins(database, productVersionId, productRelease) {
  if (!await productVersionPinsMatchDatabase(database, productVersionId, productRelease)) {
    throw new Error(
      `${productRelease.bankSlug}:${productRelease.productSlug} does not have all exact immutable bank-file template revision pins`,
    )
  }
}

async function publishProductRelease(database, release, manifest) {
  const releaseVersionKey = (
    `${release.bankSlug}-${release.productSlug}-documents-`
    + release.releaseContentSha256.slice(0, 16)
  )
  const productResult = await database.query(
    `select product.id::text as target_product_id,
            product.bank_id::text as target_bank_id,
            product.revision as product_revision,
            product.current_published_version_id::text,
            current_version.id::text as base_version_id,
            current_version.*
       from public.mortgage_products product
       join public.mortgage_banks bank on bank.id = product.bank_id
       left join public.mortgage_product_versions current_version
         on current_version.id = product.current_published_version_id
      where bank.slug = $1
        and product.slug = $2
        and product.archived_at is null
      for update of product`,
    [release.bankSlug, release.productSlug],
  )
  if (productResult.rowCount !== 1) {
    throw new Error(`${release.bankSlug}:${release.productSlug} is missing or ambiguous`)
  }
  const current = productResult.rows[0]
  if (!current.current_published_version_id || !current.content_sha256) {
    throw new Error(`${release.bankSlug}:${release.productSlug} has no published base version`)
  }

  const existingResult = await database.query(
    `select version.*,
            product.current_published_version_id::text as current_version_id
       from public.mortgage_product_versions version
       join public.mortgage_products product on product.id = version.product_id
      where version.version_key = $1`,
    [releaseVersionKey],
  )
  if (existingResult.rowCount > 1) {
    throw new Error(`${release.bankSlug}:${release.productSlug} release version key collision`)
  }
  if (existingResult.rows[0]) {
    const existing = existingResult.rows[0]
    if (
      String(existing.product_id) !== String(current.target_product_id)
      || String(existing.id) !== String(existing.current_version_id)
      || existing.lifecycle_status !== 'published'
      || Number(existing.calculator_schema_version) < 2
      || existing.multiform_template_policy !== 'database_pinned'
      || !sameJson(existing.document_requirements, release.documentRequirements)
      || !sameJson(existing.multiform_template_ids, release.templateIds)
    ) {
      throw new Error(
        `${release.bankSlug}:${release.productSlug} existing release differs from curated policy`,
      )
    }
    await verifyProductVersionPins(database, existing.id, release)
    return { action: 'unchanged', id: String(existing.id) }
  }

  if (
    Number(current.calculator_schema_version) >= 2
    && current.multiform_template_policy === 'database_pinned'
    && sameJson(current.document_requirements, release.documentRequirements)
    && sameJson(current.multiform_template_ids, release.templateIds)
    && await productVersionPinsMatchDatabase(database, current.base_version_id, release)
  ) {
    return { action: 'existing-current-compliant', id: String(current.base_version_id) }
  }

  const nextVersionResult = await database.query(
    `select coalesce(max(version_number), 0)::integer + 1 as next_version_number
       from public.mortgage_product_versions
      where product_id = $1::uuid`,
    [current.target_product_id],
  )
  const contentSha256 = releasedProductVersionContentSha256(
    current.content_sha256,
    release,
  )
  const inserted = await database.query(
    `insert into public.mortgage_product_versions (
       version_key, product_id, source_document_id,
       effective_from, effective_to, retrieved_at, calculation_date,
       data_status, completeness_score, interest_type, fixed_rate_pct,
       fixed_period_months, margin_pct, reference_rate_code,
       reference_rate_pct, reference_rate_as_of, representative_apr_pct,
       min_amount, max_amount, min_term_months, max_term_months,
       max_ltv_pct, is_eco, cost_rules, requirements,
       document_requirements, multiform_template_ids,
       representative_example, assumptions, unknown_fields,
       version_number, lifecycle_status, calculator_schema_version,
       calculator_engine_version, content_sha256, validation_report,
       multiform_template_policy, published_at, published_by_user_id
     ) select
       $2, base.product_id, base.source_document_id,
       $3::date, base.effective_to, now(), base.calculation_date,
       base.data_status, base.completeness_score, base.interest_type,
       base.fixed_rate_pct, base.fixed_period_months, base.margin_pct,
       base.reference_rate_code, base.reference_rate_pct,
       base.reference_rate_as_of, base.representative_apr_pct,
       base.min_amount, base.max_amount, base.min_term_months,
       base.max_term_months, base.max_ltv_pct, base.is_eco,
       base.cost_rules, base.requirements, $4::jsonb, $5::text[],
       base.representative_example, base.assumptions, base.unknown_fields,
       $6, 'published', 2, base.calculator_engine_version,
       $7, $8::jsonb, 'database_pinned', now(), null
       from public.mortgage_product_versions base
      where base.id = $1::uuid
      returning id::text`,
    [
      current.current_published_version_id,
      releaseVersionKey,
      manifest.asOf,
      JSON.stringify(release.documentRequirements),
      release.templateIds,
      nextVersionResult.rows[0].next_version_number,
      contentSha256,
      JSON.stringify({
        valid: true,
        issues: [],
        publicationManifest: manifest.schemaVersion,
        releaseContentSha256: release.releaseContentSha256,
        baseProductVersionId: current.current_published_version_id,
      }),
    ],
  )
  if (inserted.rowCount !== 1) {
    throw new Error(`Failed to create ${release.bankSlug}:${release.productSlug} release`)
  }
  const insertedVersionId = inserted.rows[0].id
  await verifyProductVersionPins(database, insertedVersionId, release)
  await database.query(
    `insert into public.mortgage_product_version_variants (
       product_version_id, code, name, sort_order, is_default,
       min_amount, max_amount, min_term_months, max_term_months,
       max_ltv_pct, interest_type, fixed_rate_pct, fixed_period_months,
       margin_pct, reference_rate_code, reference_rate_pct,
       reference_rate_as_of, representative_apr_pct, calculation_readiness,
       pricing_config, eligibility_config
     ) select
       version.id, 'standard', 'Wariant standardowy', 0, true,
       version.min_amount, version.max_amount, version.min_term_months,
       version.max_term_months, version.max_ltv_pct, version.interest_type,
       version.fixed_rate_pct, version.fixed_period_months, version.margin_pct,
       version.reference_rate_code, version.reference_rate_pct,
       version.reference_rate_as_of, version.representative_apr_pct,
       case when cardinality(version.unknown_fields) > 0 then 'partial' else 'complete' end,
       jsonb_build_object(
         'schemaVersion', 'openexpert.mortgage-offer/legacy',
         'legacyVersionId', version.id,
         'costRules', version.cost_rules,
         'assumptions', version.assumptions,
         'unknownFields', to_jsonb(version.unknown_fields)
       ),
       jsonb_strip_nulls(jsonb_build_object(
         'minAmount', version.min_amount,
         'maxAmount', version.max_amount,
         'minTermMonths', version.min_term_months,
         'maxTermMonths', version.max_term_months,
         'maxLtvPct', version.max_ltv_pct
       ))
       from public.mortgage_product_versions version
      where version.id = $1::uuid`,
    [insertedVersionId],
  )
  await database.query(
    `insert into public.mortgage_product_version_sources (
       product_version_id, source_document_id, source_role
     ) select $1::uuid, version.source_document_id, 'primary'
       from public.mortgage_product_versions version
      where version.id = $1::uuid
        and version.source_document_id is not null
     on conflict do nothing`,
    [insertedVersionId],
  )
  await database.query(
    `update public.mortgage_product_versions
        set lifecycle_status = 'retired',
            retired_at = now(),
            retired_by_user_id = null
      where id = $1::uuid
        and lifecycle_status = 'published'`,
    [current.current_published_version_id],
  )
  await database.query(
    `update public.mortgage_products
        set current_published_version_id = $2::uuid,
            revision = revision + 1
      where id = $1::uuid
        and current_published_version_id = $3::uuid`,
    [
      current.target_product_id,
      insertedVersionId,
      current.current_published_version_id,
    ],
  )
  await database.query(
    `insert into public.mortgage_catalog_events (
       bank_id, product_id, product_version_id, event_type,
       revision_before, revision_after, content_sha256_before,
       content_sha256_after, metadata
     ) values (
       $1::uuid, $2::uuid, $3::uuid, 'product.template_release_published',
       $4, $5, $6, $7, $8::jsonb
     )`,
    [
      current.target_bank_id,
      current.target_product_id,
      insertedVersionId,
      current.product_revision,
      Number(current.product_revision) + 1,
      current.content_sha256,
      contentSha256,
      JSON.stringify({
        versionKey: releaseVersionKey,
        versionNumber: nextVersionResult.rows[0].next_version_number,
        templateIds: release.templateIds,
        releaseContentSha256: release.releaseContentSha256,
      }),
    ],
  )
  const pointerResult = await database.query(
    `select current_published_version_id::text
       from public.mortgage_products
      where id = $1::uuid`,
    [current.target_product_id],
  )
  if (pointerResult.rows[0]?.current_published_version_id !== insertedVersionId) {
    throw new Error(
      `New ${release.bankSlug}:${release.productSlug} release did not become current`,
    )
  }
  return { action: 'created', id: insertedVersionId }
}

async function applyManifest(database, manifest) {
  await database.query('begin isolation level serializable')
  try {
    await database.query(`set local lock_timeout = '15s'`)
    await database.query(`set local statement_timeout = '120s'`)
    const summary = { created: 0, publishedDraft: 0, reviewedRevision: 0, unchanged: 0 }
    for (const entry of manifest.entries) {
      const source = await loadExactBankFile(database, entry)
      const existing = await loadExistingDefinition(database, entry, source)
      const plan = planTemplatePublication(existing, entry)
      let revision
      if (plan.action === 'create-and-publish') {
        revision = await createAndPublish(database, entry, source)
        summary.created += 1
      }
      else if (plan.action === 'publish-existing-draft') {
        revision = Number(existing.active_revision) + 1
        await publishDraft(database, existing.id, entry, revision)
        summary.publishedDraft += 1
      }
      else if (plan.action === 'publish-reviewed-revision') {
        revision = plan.revision
        await publishReviewedRevision(database, existing, entry, revision)
        summary.reviewedRevision += 1
      }
      else {
        revision = plan.revision
        summary.unchanged += 1
      }
      await recordPublicationEvent(database, entry, source, revision)
    }
    const productReleases = []
    for (const release of manifest.productReleases) {
      productReleases.push({
        bankSlug: release.bankSlug,
        productSlug: release.productSlug,
        ...(await publishProductRelease(database, release, manifest)),
      })
    }
    await database.query('commit')
    summary.productReleases = productReleases
    return summary
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
  const [generated, curated] = await Promise.all([
    buildPublicationManifest(),
    readPublicationManifest(),
  ])
  if (!sameJson(generated, curated)) {
    throw new Error('Curated publication manifest is stale; regenerate and review it first')
  }
  if (!arguments_.apply) {
    process.stdout.write(
      `DRY RUN: ${curated.entries.length} exact template publications and ${curated.productReleases.length} DB-pinned product releases are activation-ready and bank-file-backed. No database or network operation was performed.\n\n${usage()}\n`,
    )
    return
  }

  const database = new Client({
    connectionString: productionDatabaseUrl(),
    application_name: 'openexpert-official-multiform-template-seeder',
    connectionTimeoutMillis: 20_000,
    keepAlive: true,
  })
  let lockHeld = false
  try {
    await database.connect()
    await database.query('select pg_advisory_lock(hashtext($1))', [SEED_LOCK])
    lockHeld = true
    await assertRequiredSchema(database)
    const summary = await applyManifest(database, curated)
    process.stdout.write(
      `Published official templates: ${summary.created} created, ${summary.publishedDraft} existing drafts published, ${summary.reviewedRevision} reviewed revisions published, ${summary.unchanged} unchanged. Product releases: ${summary.productReleases.map(release => `${release.bankSlug}/${release.productSlug}:${release.action}`).join(', ')}.\n`,
    )
  } finally {
    if (lockHeld) {
      await database.query('select pg_advisory_unlock(hashtext($1))', [SEED_LOCK])
        .catch(() => {})
    }
    await database.end().catch(() => {})
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
