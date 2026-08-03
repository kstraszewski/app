#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Client } from 'pg'

const targetOrganizationSlug = 'openexpert-local'
const embeddingModel = 'gemini-embedding-2'
const gatewayEmbeddingModel = `google/${embeddingModel}`
const embeddingDimensions = 768
const embeddingRecipe = 'forum-search-v1'
const batchSize = 25

function usage() {
  return `Usage:
  node packages/database/scripts/process-forum-embeddings.mjs --apply --organization openexpert-local --confirm openexpert-local

Required environment:
  VERCEL_ENV=production
  DATABASE_URL=<production Postgres connection string>
  VERCEL_OIDC_TOKEN=<Vercel OIDC token> (or AI_GATEWAY_API_KEY)

This one-shot worker is intentionally restricted to the openexpert-local demo
organization. It never exposes an HTTP endpoint and will not run without both
the explicit --apply and matching --confirm arguments.`
}

function parseArguments(argv) {
  const parsed = {
    apply: false,
    confirm: null,
    help: false,
    organization: null,
  }

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
    if (argument === '--organization' || argument === '--confirm') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`)
      }
      index += 1
      if (argument === '--organization') parsed.organization = value
      else parsed.confirm = value
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (parsed.help) return parsed
  if (!parsed.apply) throw new Error('--apply is required')
  if (parsed.organization !== targetOrganizationSlug) {
    throw new Error(`--organization must be exactly ${targetOrganizationSlug}`)
  }
  if (parsed.confirm !== targetOrganizationSlug) {
    throw new Error(`--confirm must be exactly ${targetOrganizationSlug}`)
  }
  return parsed
}

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function assertProductionEnvironment() {
  if (String(process.env.VERCEL_ENV ?? '').trim() !== 'production') {
    throw new Error('VERCEL_ENV must be exactly production')
  }

  const databaseUrl = requiredEnvironment('DATABASE_URL')
  let parsedDatabaseUrl
  try {
    parsedDatabaseUrl = new URL(databaseUrl)
  }
  catch {
    throw new Error('DATABASE_URL must be a valid Postgres connection string')
  }
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol')
  }
  if (['localhost', '127.0.0.1', '::1'].includes(parsedDatabaseUrl.hostname)) {
    throw new Error('DATABASE_URL must not point at a local database')
  }

  const hasGatewayCredential = Boolean(
    String(process.env.VERCEL_OIDC_TOKEN ?? '').trim()
    || String(process.env.AI_GATEWAY_API_KEY ?? '').trim(),
  )
  if (!hasGatewayCredential) {
    throw new Error('VERCEL_OIDC_TOKEN or AI_GATEWAY_API_KEY is required')
  }
  return databaseUrl
}

async function loadAiSdk() {
  // This database utility intentionally reuses the CRM runtime dependencies
  // without widening the database package's production dependency surface.
  const requireFromCrm = createRequire(
    new URL('../../../apps/crm/package.json', import.meta.url),
  )
  const gatewayEntry = requireFromCrm.resolve('@ai-sdk/gateway')
  const aiEntry = requireFromCrm.resolve('ai')
  const [{ gateway }, { embedMany }] = await Promise.all([
    import(pathToFileURL(gatewayEntry).href),
    import(pathToFileURL(aiEntry).href),
  ])
  return { embedMany, gateway }
}

async function assertRequiredSchema(database) {
  const result = await database.query(`
    select
      to_regclass('public.organizations') is not null as has_organizations,
      to_regclass('public.forum_embedding_jobs') is not null as has_jobs,
      to_regclass('public.forum_search_documents') is not null as has_documents,
      to_regprocedure(
        'public.complete_forum_embedding_job(uuid,text,extensions.vector)'
      ) is not null as has_complete,
      to_regprocedure(
        'public.retry_forum_embedding_job(uuid,text,text,interval)'
      ) is not null as has_retry
  `)
  const row = result.rows[0]
  if (!row || Object.values(row).some(value => value !== true)) {
    throw new Error('Production database is missing the required forum embedding schema')
  }
}

async function resolveTargetOrganization(database) {
  const result = await database.query(
    `select id
       from public.organizations
      where slug = $1
      limit 2`,
    [targetOrganizationSlug],
  )
  if (result.rowCount !== 1) {
    throw new Error(`Expected exactly one ${targetOrganizationSlug} organization`)
  }
  return String(result.rows[0].id)
}

async function jobCounts(database, organizationId) {
  const result = await database.query(
    `select status, count(*)::integer as count
       from public.forum_embedding_jobs
      where organization_id = $1::uuid
      group by status
      order by status`,
    [organizationId],
  )
  return Object.fromEntries(
    result.rows.map(row => [String(row.status), Number(row.count)]),
  )
}

async function claimJobs(database, organizationId, workerId) {
  await database.query('begin')
  try {
    await database.query(
      `update public.forum_embedding_jobs as job
          set status = 'failed',
              locked_at = null,
              locked_by = null,
              last_error = coalesce(
                job.last_error,
                'forum_embedding_lease_expired_after_max_attempts'
              )
        where job.organization_id = $1::uuid
          and job.status = 'processing'
          and job.locked_at < statement_timestamp() - interval '5 minutes'
          and job.attempts >= job.max_attempts`,
      [organizationId],
    )

    const result = await database.query(
      `with candidates as (
         select job.id
           from public.forum_embedding_jobs as job
           join public.forum_search_documents as document
             on document.organization_id = job.organization_id
            and document.id = job.document_id
          where job.organization_id = $1::uuid
            and (
              (
                job.status = any (array['pending'::text, 'failed'::text])
                and job.available_at <= statement_timestamp()
              )
              or (
                job.status = 'processing'
                and job.locked_at < statement_timestamp() - interval '5 minutes'
              )
            )
            and job.attempts < job.max_attempts
            and document.is_searchable
            and document.source_sha256 = job.source_sha256
            and document.revision = job.source_revision
          order by job.available_at, job.created_at, job.id
          for update of job skip locked
          limit $3::integer
       ),
       claimed as (
         update public.forum_embedding_jobs as job
            set status = 'processing',
                attempts = job.attempts + 1,
                locked_at = statement_timestamp(),
                locked_by = $2::text,
                last_error = null,
                processed_at = null
           from candidates
          where job.id = candidates.id
         returning job.*
       )
       select claimed.id,
              claimed.organization_id,
              claimed.document_id,
              claimed.source_sha256,
              claimed.source_revision,
              claimed.attempts,
              claimed.max_attempts,
              document.title,
              document.content,
              claimed.model,
              claimed.dimensions,
              claimed.recipe_version
         from claimed
         join public.forum_search_documents as document
           on document.organization_id = claimed.organization_id
          and document.id = claimed.document_id
        order by claimed.available_at, claimed.created_at, claimed.id`,
      [organizationId, workerId, batchSize],
    )
    await database.query('commit')
    return result.rows
  }
  catch (error) {
    await database.query('rollback').catch(() => {})
    throw error
  }
}

function embeddingInput(job) {
  return `title: ${String(job.title).trim() || 'none'} | text: ${String(job.content).trim()}`
}

function sourceSha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function retryDelaySeconds(attempts) {
  const exponent = Math.min(20, Math.max(0, Number(attempts) - 1))
  return Math.min(6 * 60 * 60, 30 * 2 ** exponent)
}

function errorMessage(error) {
  return (error instanceof Error ? error.message : 'Forum embedding failed')
    .trim()
    .slice(0, 4_000) || 'Forum embedding failed'
}

async function retryJob(database, organizationId, job, workerId, error) {
  const result = await database.query(
    `select public.retry_forum_embedding_job(
              job.id,
              $3::text,
              $4::text,
              ($5::integer * interval '1 second')
            ) as result
       from public.forum_embedding_jobs as job
      where job.id = $1::uuid
        and job.organization_id = $2::uuid`,
    [
      job.id,
      organizationId,
      workerId,
      errorMessage(error),
      retryDelaySeconds(job.attempts),
    ],
  )
  if (result.rowCount !== 1) {
    throw new Error('Refused to retry a forum embedding job outside the target organization')
  }
}

function vectorLiteral(embedding) {
  if (!Array.isArray(embedding) || embedding.length !== embeddingDimensions) {
    throw new Error(`Embedding must contain exactly ${embeddingDimensions} dimensions`)
  }
  const values = embedding.map((value) => {
    const number = Number(value)
    if (!Number.isFinite(number)) throw new Error('Embedding contains a non-finite value')
    return String(number)
  })
  return `[${values.join(',')}]`
}

async function completeJob(database, organizationId, job, workerId, embedding) {
  const result = await database.query(
    `select public.complete_forum_embedding_job(
              job.id,
              $3::text,
              $4::extensions.vector
            ) as result
       from public.forum_embedding_jobs as job
      where job.id = $1::uuid
        and job.organization_id = $2::uuid`,
    [job.id, organizationId, workerId, vectorLiteral(embedding)],
  )
  if (result.rowCount !== 1) {
    throw new Error('Refused to complete a forum embedding job outside the target organization')
  }
  return result.rows[0].result
}

function validateJob(job) {
  if (
    job.model !== embeddingModel
    || Number(job.dimensions) !== embeddingDimensions
    || job.recipe_version !== embeddingRecipe
  ) {
    throw new Error('Forum embedding job uses an unsupported model contract')
  }
  const value = embeddingInput(job)
  if (sourceSha256(value) !== job.source_sha256) {
    throw new Error('Forum embedding source checksum does not match the claimed document')
  }
  return value
}

async function processClaimedBatch(input) {
  const {
    database,
    embedMany,
    jobs,
    model,
    organizationId,
    workerId,
  } = input
  const valid = []
  let failed = 0

  for (const job of jobs) {
    try {
      valid.push({ job, value: validateJob(job) })
    }
    catch (error) {
      await retryJob(database, organizationId, job, workerId, error)
      failed += 1
    }
  }

  if (!valid.length) return { cancelled: 0, completed: 0, failed }

  let embeddings
  try {
    const response = await embedMany({
      model,
      values: valid.map(item => item.value),
      abortSignal: AbortSignal.timeout(120_000),
      providerOptions: {
        google: {
          outputDimensionality: embeddingDimensions,
        },
      },
    })
    embeddings = response.embeddings
    if (embeddings.length !== valid.length) {
      throw new Error('AI Gateway returned an unexpected number of forum embeddings')
    }
    embeddings.forEach(vectorLiteral)
  }
  catch (error) {
    for (const { job } of valid) {
      await retryJob(database, organizationId, job, workerId, error)
      failed += 1
    }
    return { cancelled: 0, completed: 0, failed }
  }

  let cancelled = 0
  let completed = 0
  for (let index = 0; index < valid.length; index += 1) {
    const { job } = valid[index]
    try {
      const result = await completeJob(
        database,
        organizationId,
        job,
        workerId,
        embeddings[index],
      )
      if (result?.status === 'completed') completed += 1
      else if (result?.status === 'cancelled') cancelled += 1
      else throw new Error('Unexpected forum embedding completion status')
    }
    catch (error) {
      await retryJob(database, organizationId, job, workerId, error)
      failed += 1
    }
  }
  return { cancelled, completed, failed }
}

async function main() {
  const args = parseArguments(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const databaseUrl = assertProductionEnvironment()
  const { embedMany, gateway } = await loadAiSdk()
  const model = gateway.embedding(gatewayEmbeddingModel)
  const workerId = `forum-production-cli:${randomUUID()}`
  const database = new Client({
    application_name: 'openexpert-forum-embedding-worker',
    connectionString: databaseUrl,
  })
  const summary = {
    batches: 0,
    cancelled: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
  }

  try {
    await database.connect()
    await assertRequiredSchema(database)
    const organizationId = await resolveTargetOrganization(database)
    const before = await jobCounts(database, organizationId)
    console.log(JSON.stringify({ organization: targetOrganizationSlug, before }))

    while (true) {
      const jobs = await claimJobs(database, organizationId, workerId)
      if (!jobs.length) break
      summary.batches += 1
      summary.claimed += jobs.length
      const outcome = await processClaimedBatch({
        database,
        embedMany,
        jobs,
        model,
        organizationId,
        workerId,
      })
      summary.cancelled += outcome.cancelled
      summary.completed += outcome.completed
      summary.failed += outcome.failed
    }

    const after = await jobCounts(database, organizationId)
    console.log(JSON.stringify({ organization: targetOrganizationSlug, summary, after }))
    if (summary.failed > 0) {
      throw new Error(`${summary.failed} forum embedding job(s) were scheduled for retry`)
    }
  }
  finally {
    await database.end().catch(() => {})
  }
}

main().catch((error) => {
  console.error(`[process-forum-embeddings] ${errorMessage(error)}`)
  process.exitCode = 1
})
