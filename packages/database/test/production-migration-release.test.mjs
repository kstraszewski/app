import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const migrationScriptUrl = new URL(
  '../scripts/migrate-production-knowledge-release.mjs',
  import.meta.url,
)
const migrationScriptPath = fileURLToPath(migrationScriptUrl)

const releaseTail = [
  '0047_organization_intermediary_settings.sql',
  '0048_client_legal_document_deliveries.sql',
  '0049_mortgage_application_process.sql',
  '0050_document_storage_cleanup_outbox.sql',
  '0051_mortgage_application_strict_lifecycle.sql',
  '0052_multi_provider_mail_connections.sql',
  '0053_mail_context_thread_links.sql',
  '0056_ceidg_snapshot_write_guard.sql',
]

test('production migration dry-run includes the ordered release tail', () => {
  const result = spawnSync(process.execPath, [migrationScriptPath], {
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^Production knowledge release migrations:/u)

  let previousIndex = -1
  for (const migration of releaseTail) {
    const marker = `- ${migration} `
    const index = result.stdout.indexOf(marker)
    assert.equal(result.stdout.split(marker).length - 1, 1, `${migration} must appear once`)
    assert.ok(index > previousIndex, `${migration} must appear once and in order`)
    previousIndex = index
  }
})

test('production migration assumes the application owner before locks and checksum access', async () => {
  const source = await readFile(migrationScriptUrl, 'utf8')
  const beginIndex = source.indexOf("await client.query('BEGIN')")
  const capabilityCheckIndex = source.indexOf(
    "SELECT pg_has_role(current_user, 'openexpert_owner', 'USAGE') AS can_set_owner_role",
  )
  const setRoleIndex = source.indexOf("await client.query('SET LOCAL ROLE openexpert_owner')")
  const activeRoleCheckIndex = source.indexOf("SELECT current_user AS migration_role")
  // The bootstrap transaction also takes the same lock before the dedicated
  // role necessarily exists. Assert against the migration-loop lock that
  // follows the verified SET LOCAL ROLE, not that earlier bootstrap lock.
  const advisoryLockIndex = source.indexOf(
    'SELECT pg_advisory_xact_lock',
    activeRoleCheckIndex,
  )
  const checksumLookupIndex = source.indexOf(
    'SELECT checksum FROM app_migrations.schema_migrations WHERE name = $1',
  )

  assert.ok(beginIndex >= 0)
  assert.ok(capabilityCheckIndex > beginIndex)
  assert.ok(setRoleIndex > capabilityCheckIndex)
  assert.ok(activeRoleCheckIndex > setRoleIndex)
  assert.ok(advisoryLockIndex > activeRoleCheckIndex)
  assert.ok(checksumLookupIndex > advisoryLockIndex)
  assert.match(
    source,
    /if \(ownerRole\.rows\[0\]\?\.can_set_owner_role !== true\) \{[\s\S]+?throw new Error\('Production migration connection cannot assume openexpert_owner'\)/u,
  )
  assert.match(
    source,
    /if \(activeRole\.rows\[0\]\?\.migration_role !== 'openexpert_owner'\) \{[\s\S]+?throw new Error\('Production migration did not assume openexpert_owner'\)/u,
  )
})
