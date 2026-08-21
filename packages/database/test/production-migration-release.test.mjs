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
  '0054_anonymized_client_terminal_guard.sql',
  '0055_ceidg_registry_name_search.sql',
  '0056_ceidg_snapshot_write_guard.sql',
  '0057_email_sent_crm_activities.sql',
  '0058_openexpert_mock_bank.sql',
  '0059_openexpert_mock_bank_logo_url.sql',
  '0060_bank_mail_agent_intake.sql',
  '0061_organization_onboarding_billing.sql',
  '0062_organization_billing_entitlement_gate.sql',
  '0063_mail_bank_agent_processing_status.sql',
  '0064_organization_seat_billing.sql',
  '0065_organization_seat_billing_resubscribe_rebind.sql',
  '0066_organization_billing_subscription_generation.sql',
  '0067_organization_seat_subscription_generation.sql',
  '0068_organization_billing_invoice_anomalies.sql',
  '0069_organization_billing_access_summary.sql',
  '0070_organization_billing_snapshot_effective_state.sql',
  '0071_organization_invoice_anomaly_preserve_blocked.sql',
  '0072_organization_invoice_state_monotonic_access_fence.sql',
  '0073_organization_seat_change_stripe_mutation_fence.sql',
  '0074_organization_billing_and_seat_snapshot.sql',
  '0075_organization_seat_change_single_stripe_mutation.sql',
  '0076_organization_seat_invoice_correlation.sql',
  '0077_organization_invitation_discounts.sql',
  '0078_organization_initial_seat_capacity.sql',
  '0079_organization_member_invitations.sql',
  '0080_organization_creation_grant_gate.sql',
  '0081_application_billing_plans.sql',
  '0082_openexpert_bank_mail_ingestion.sql',
  '0083_bank_mail_ingestion_rpc.sql',
  '0084_bank_mail_intake_strong_proposal.sql',
  '0085_bank_mail_thread_link_jobs.sql',
  '0086_bank_mail_agent_reanalysis.sql',
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

test('production migration transfers the legacy bank-mail getter before assuming the app owner', async () => {
  const source = await readFile(migrationScriptUrl, 'utf8')
  const capabilityCheckIndex = source.indexOf(
    "SELECT pg_has_role(current_user, 'openexpert_owner', 'USAGE') AS can_set_owner_role",
  )
  const legacyFunctionIndex = source.indexOf(
    'public.get_strong_bank_mail_agent_proposal_case(uuid)',
  )
  const transferIndex = source.indexOf(
    "ALTER FUNCTION %s OWNER TO openexpert_owner",
  )
  const setRoleIndex = source.indexOf("await client.query('SET LOCAL ROLE openexpert_owner')")

  assert.ok(capabilityCheckIndex >= 0)
  assert.ok(legacyFunctionIndex > capabilityCheckIndex)
  assert.ok(transferIndex > legacyFunctionIndex)
  assert.ok(setRoleIndex > transferIndex)
  assert.match(
    source,
    /if \(strongProposalOwner\.rows\[0\]\?\.owner !== role\.connection_role\) \{[\s\S]+?Only the current function owner may transfer the legacy bank-mail RPC/u,
  )
})
