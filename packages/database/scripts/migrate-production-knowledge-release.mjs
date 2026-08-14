#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const CONFIRMATION = 'MIGRATE_OPENEXPERT_PRODUCTION_KNOWLEDGE_RELEASE'
const VERCEL_PROJECT = 'openexpert-crm'
const MIGRATION_LOCK = 'openexpert.migrate.production-knowledge-release.v1'
const migrationNames = [
  '0034_experiments_access.sql',
  '0035_case_group_messaging.sql',
  '0036_case_message_notification_receipts.sql',
  '0037_experiment_knowledge.sql',
  '0038_experiment_knowledge_institutions.sql',
  '0039_mortgage_bank_brand_colors.sql',
  '0040_allow_bank_application_status_without_property.sql',
  '0041_seed_mortgage_bank_file_product_rules_category.sql',
  '0042_link_mortgage_templates_to_bank_files.sql',
  '0043_require_database_pinned_multiform_templates.sql',
  '0044_allow_xlsx_mortgage_document_templates.sql',
  '0045_client_portal_account_management.sql',
  '0046_verified_portal_booking.sql',
  '0047_organization_intermediary_settings.sql',
  '0048_client_legal_document_deliveries.sql',
  '0049_mortgage_application_process.sql',
  '0050_document_storage_cleanup_outbox.sql',
  '0051_mortgage_application_strict_lifecycle.sql',
  '0052_multi_provider_mail_connections.sql',
  '0053_mail_context_thread_links.sql',
]
const migrationsDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../postgres/migrations',
)

function parseArguments(argv) {
  const result = { apply: false, confirm: '', help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--apply') result.apply = true
    else if (argument === '--help' || argument === '-h') result.help = true
    else if (argument === '--confirm') result.confirm = argv[++index] ?? ''
    else if (argument.startsWith('--confirm=')) result.confirm = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!result.apply && result.confirm) throw new Error('--confirm requires --apply')
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
  }
  catch {
    throw new Error('VERCEL_OIDC_TOKEN has an invalid JWT payload')
  }
}

function productionConfiguration() {
  if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
    throw new Error('Apply mode requires a Vercel production build')
  }
  const databaseUrl = String(process.env.DATABASE_URL_UNPOOLED ?? '').trim()
    || requiredEnvironment('DATABASE_URL')
  const host = new URL(databaseUrl).hostname.toLowerCase()
  if (['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('Apply mode refuses a local DATABASE_URL')
  }

  const oidc = decodeJwtPayload(requiredEnvironment('VERCEL_OIDC_TOKEN'))
  const nowSeconds = Math.floor(Date.now() / 1_000)
  if (oidc.environment !== 'production' || oidc.project !== VERCEL_PROJECT) {
    throw new Error(`VERCEL_OIDC_TOKEN must target ${VERCEL_PROJECT} production`)
  }
  if (typeof oidc.sub !== 'string' || !oidc.sub.endsWith(':environment:production')) {
    throw new Error('VERCEL_OIDC_TOKEN subject is not production-scoped')
  }
  if (typeof oidc.iss !== 'string' || !oidc.iss.startsWith('https://oidc.vercel.com')) {
    throw new Error('VERCEL_OIDC_TOKEN has an unexpected issuer')
  }
  if (typeof oidc.exp !== 'number' || oidc.exp <= nowSeconds + 300) {
    throw new Error('VERCEL_OIDC_TOKEN expires too soon')
  }
  return { databaseUrl }
}

async function migrationFiles() {
  return Promise.all(migrationNames.map(async (name) => {
    const sql = await readFile(resolve(migrationsDirectory, name), 'utf8')
    return {
      name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    }
  }))
}

async function ensureProductionMigrationRole(client) {
  await client.query('BEGIN')
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [MIGRATION_LOCK])
    const roleConfiguration = await client.query(`
      SELECT
        current_user AS connection_role,
        connection_role.rolcreaterole,
        pg_get_userbyid(database.datdba) AS database_owner,
        EXISTS (
          SELECT 1 FROM pg_roles WHERE rolname = 'openexpert_owner'
        ) AS dedicated_owner_exists
      FROM pg_roles AS connection_role
      CROSS JOIN pg_database AS database
      WHERE connection_role.rolname = current_user
        AND database.datname = current_database()
    `)
    const role = roleConfiguration.rows[0]
    if (!role) throw new Error('Production migration connection role is unavailable')

    if (role.dedicated_owner_exists !== true) {
      if (role.connection_role !== role.database_owner || role.rolcreaterole !== true) {
        throw new Error(
          'Only the role-creating database owner may bootstrap openexpert_owner',
        )
      }
      await client.query(`
        CREATE ROLE openexpert_owner
        NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      `)
      const grantStatement = await client.query(
        "SELECT format('GRANT openexpert_owner TO %I', current_user) AS sql",
      )
      await client.query(grantStatement.rows[0].sql)
      console.log('+ role openexpert_owner')
    }

    const migrationTableOwner = await client.query(`
      SELECT pg_get_userbyid(relation.relowner) AS owner
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'app_migrations'
        AND relation.relname = 'schema_migrations'
    `)
    if (migrationTableOwner.rows[0]?.owner !== 'openexpert_owner') {
      if (role.connection_role !== role.database_owner) {
        throw new Error(
          'Only the database owner may transfer existing objects to openexpert_owner',
        )
      }
      const reassignStatement = await client.query(
        "SELECT format('REASSIGN OWNED BY %I TO openexpert_owner', current_user) AS sql",
      )
      await client.query(reassignStatement.rows[0].sql)
      console.log('~ ownership openexpert_owner')
    }

    const ownerRole = await client.query(
      "SELECT pg_has_role(current_user, 'openexpert_owner', 'USAGE') AS can_set_owner_role",
    )
    if (ownerRole.rows[0]?.can_set_owner_role !== true) {
      throw new Error('Production migration connection cannot assume openexpert_owner')
    }
    await client.query('COMMIT')
  }
  catch (caught) {
    await client.query('ROLLBACK')
    throw caught
  }
}

async function applyMigrations(databaseUrl, migrations) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await ensureProductionMigrationRole(client)
    const migrationTable = await client.query(
      "SELECT to_regclass('app_migrations.schema_migrations') AS relation",
    )
    if (!migrationTable.rows[0]?.relation) {
      throw new Error('app_migrations.schema_migrations does not exist')
    }

    for (const migration of migrations) {
      await client.query('BEGIN')
      try {
        await client.query('SET LOCAL ROLE openexpert_owner')
        const activeRole = await client.query('SELECT current_user AS migration_role')
        if (activeRole.rows[0]?.migration_role !== 'openexpert_owner') {
          throw new Error('Production migration did not assume openexpert_owner')
        }

        await client.query("SET LOCAL lock_timeout = '15s'")
        await client.query("SET LOCAL statement_timeout = '180s'")
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [MIGRATION_LOCK])

        const applied = await client.query(
          'SELECT checksum FROM app_migrations.schema_migrations WHERE name = $1',
          [migration.name],
        )
        if (applied.rowCount) {
          if (applied.rows[0].checksum !== migration.checksum) {
            throw new Error(`${migration.name} checksum differs from production`)
          }
          await client.query('COMMIT')
          console.log(`= ${migration.name}`)
          continue
        }

        await client.query(migration.sql)
        await client.query(
          'INSERT INTO app_migrations.schema_migrations (name, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum],
        )
        await client.query('COMMIT')
        console.log(`+ ${migration.name}`)
      }
      catch (caught) {
        await client.query('ROLLBACK')
        throw caught
      }
    }
  }
  finally {
    await client.end()
  }
}

const parsed = parseArguments(process.argv.slice(2))
if (parsed.help) {
  console.log(`Usage: node packages/database/scripts/migrate-production-knowledge-release.mjs [--apply --confirm ${CONFIRMATION}]`)
  process.exit(0)
}

const migrations = await migrationFiles()
if (!parsed.apply) {
  console.log('Production knowledge release migrations:')
  for (const migration of migrations) console.log(`- ${migration.name} ${migration.checksum}`)
  process.exit(0)
}

const { databaseUrl } = productionConfiguration()
await applyMigrations(databaseUrl, migrations)
console.log('Production knowledge release migrations completed.')
