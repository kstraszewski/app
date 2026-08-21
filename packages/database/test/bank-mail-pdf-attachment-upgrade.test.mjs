import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import pg from 'pg'

const databaseUrl = process.env.OPENEXPERT_0087_UPGRADE_TEST_DATABASE_URL
const migrationUrl = new URL(
  '../postgres/migrations/0087_bank_mail_agent_pdf_attachments.sql',
  import.meta.url,
)

async function seedPre0087Events(client) {
  const ids = {
    organizationId: randomUUID(),
    ownerUserId: randomUUID(),
    clientId: randomUUID(),
    caseId: randomUUID(),
    caseItemId: randomUUID(),
    applicationId: randomUUID(),
    offerId: randomUUID(),
    userEventId: randomUUID(),
    systemEventId: randomUUID(),
  }
  const email = `0087-upgrade-${ids.ownerUserId.replaceAll('-', '')}@example.test`

  await client.query('BEGIN')
  try {
    const bank = await client.query(`
      SELECT id
      FROM public.mortgage_banks
      WHERE slug = 'openexpert-bank' AND is_mock
    `)
    assert.equal(bank.rowCount, 1)
    ids.bankId = bank.rows[0].id
    const product = await client.query(`
      SELECT id
      FROM public.crm_product_types
      WHERE code = 'credit_mortgage'
        AND organization_id IS NULL
        AND is_active
      ORDER BY id
      LIMIT 1
    `)
    assert.equal(product.rowCount, 1)
    ids.productTypeId = product.rows[0].id

    await client.query(`
      INSERT INTO identity.users (id, name, email, email_verified)
      VALUES ($1, '0087 Upgrade Owner', $2, true)
    `, [ids.ownerUserId, email])
    await client.query(`
      INSERT INTO public.organizations (
        id, name, slug, kind, billing_access_state
      ) VALUES ($1, '0087 upgrade', $2, 'intermediary', 'not_required')
    `, [ids.organizationId, `0087-upgrade-${ids.organizationId}`])
    await client.query(`
      INSERT INTO public.users (id, organization_id, email, role, full_name)
      VALUES ($1, $2, $3, 'admin', '0087 Upgrade Owner')
    `, [ids.ownerUserId, ids.organizationId, email])
    await client.query('ALTER TABLE public.organization_memberships DISABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role)
      VALUES ($1, $2, 'admin')
    `, [ids.organizationId, ids.ownerUserId])
    await client.query('ALTER TABLE public.organization_memberships ENABLE TRIGGER USER')

    await client.query('ALTER TABLE public.crm_clients DISABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_clients (
        id, organization_id, owner_user_id, display_name
      ) VALUES ($1, $2, $3, '0087 Upgrade Client')
    `, [ids.clientId, ids.organizationId, ids.ownerUserId])
    await client.query('ALTER TABLE public.crm_clients ENABLE TRIGGER USER')
    await client.query('ALTER TABLE public.crm_cases DISABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_cases (
        id, organization_id, client_id, owner_user_id, title
      ) VALUES ($1, $2, $3, $4, '0087 Upgrade Case')
    `, [ids.caseId, ids.organizationId, ids.clientId, ids.ownerUserId])
    await client.query('ALTER TABLE public.crm_cases ENABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_case_items (
        id, organization_id, case_id, product_type_id, owner_user_id,
        title, amount_value, currency
      ) VALUES ($1, $2, $3, $4, $5, '0087 Upgrade Mortgage', 500000, 'PLN')
    `, [
      ids.caseItemId, ids.organizationId, ids.caseId,
      ids.productTypeId, ids.ownerUserId,
    ])
    await client.query(`
      INSERT INTO public.crm_item_submissions (
        id, organization_id, case_item_id, external_reference
      ) VALUES ($1, $2, $3, $4)
    `, [
      ids.applicationId,
      ids.organizationId,
      ids.caseItemId,
      `OEB-20260821-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
    ])

    await client.query('ALTER TABLE public.crm_case_offer_snapshots DISABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_case_offer_snapshots (
        id, organization_id, case_id, bank_id, saved_by_user_id,
        bank_name, product_name, calculator_version, currency, loan_amount,
        first_installment, representative_apr_pct,
        scenario_snapshot, catalog_snapshot, calculation_snapshot
      ) VALUES (
        $1, $2, $3, $4, $5, 'OpenExpert Bank', '0087 Upgrade Product',
        '0087-upgrade', 'PLN', 500000, 2963.10, 6.9,
        jsonb_build_object('years', 30),
        jsonb_build_object('version', jsonb_build_object(
          'fixed_rate_pct', '5.89', 'representative_apr_pct', '6.9'
        )), jsonb_build_object('currency', 'PLN')
      )
    `, [
      ids.offerId, ids.organizationId, ids.caseId, ids.bankId, ids.ownerUserId,
    ])
    await client.query('ALTER TABLE public.crm_case_offer_snapshots ENABLE TRIGGER USER')
    await client.query('ALTER TABLE public.crm_case_bank_applications DISABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_case_bank_applications (
        submission_id, organization_id, case_id, case_item_id, offer_id,
        bank_id, slot, created_by_user_id, scenario_snapshot,
        calculation_snapshot, net_loan_amount, gross_loan_amount,
        first_installment
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 1, $7,
        jsonb_build_object('currency', 'PLN'),
        jsonb_build_object('currency', 'PLN'), 500000, 500000, 2963.10
      )
    `, [
      ids.applicationId, ids.organizationId, ids.caseId, ids.caseItemId,
      ids.offerId, ids.bankId, ids.ownerUserId,
    ])
    await client.query('ALTER TABLE public.crm_case_bank_applications ENABLE TRIGGER USER')

    await client.query(`
      INSERT INTO public.crm_mortgage_application_events (
        id, organization_id, case_id, application_id, aggregate_revision,
        command_id, event_type, actor_user_id, occurred_at, payload
      ) VALUES
        (
          $1, $3, $4, $5, 0, $6, 'process_initialized', $7,
          timestamptz '2026-08-21 09:00:00+00',
          jsonb_build_object('fixture', 'pre-0087-user')
        ),
        (
          $2, $3, $4, $5, 1, $8, 'legacy_status_synchronized', NULL,
          timestamptz '2026-08-21 09:01:00+00',
          jsonb_build_object('fixture', 'pre-0087-system')
        )
    `, [
      ids.userEventId, ids.systemEventId, ids.organizationId, ids.caseId,
      ids.applicationId, randomUUID(), ids.ownerUserId, randomUUID(),
    ])
    await client.query('COMMIT')
    return ids
  }
  catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function historicalEventDigest(client, applicationId, afterUpgrade) {
  const eventValue = afterUpgrade
    ? "to_jsonb(event) - 'actor_kind' - 'bank_mail_attachment_job_id'"
    : 'to_jsonb(event)'
  const result = await client.query(`
    SELECT count(*)::integer AS count,
           encode(extensions.digest(
             convert_to(jsonb_agg(${eventValue} ORDER BY event.id)::text, 'utf8'),
             'sha256'
           ), 'hex') AS digest
    FROM public.crm_mortgage_application_events AS event
    WHERE event.application_id = $1
  `, [applicationId])
  return result.rows[0]
}

async function appendOnlyTrigger(client) {
  const result = await client.query(`
    SELECT pg_trigger_row.tgenabled, pg_trigger_row.tgisinternal,
           pg_trigger_row.tgfoid =
             'private.guard_crm_mortgage_application_event_write()'::regprocedure
             AS function_matches
    FROM pg_catalog.pg_trigger AS pg_trigger_row
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'crm_mortgage_application_events'
      AND pg_trigger_row.tgname = 'crm_mortgage_application_events_guard_append_only'
  `)
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

async function ensureProductionLikeOwner(client) {
  const ownership = await client.query(`
    SELECT current_user AS connection_role,
           pg_get_userbyid(database.datdba) AS database_owner,
           pg_get_userbyid(relation.relowner) AS event_table_owner,
           pg_has_role(current_user, 'openexpert_owner', 'USAGE')
             AS can_assume_owner
    FROM pg_catalog.pg_database AS database
    JOIN pg_catalog.pg_class AS relation
      ON relation.relname = 'crm_mortgage_application_events'
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
     AND namespace.nspname = 'public'
    WHERE database.datname = current_database()
  `)
  assert.equal(ownership.rowCount, 1)
  const row = ownership.rows[0]
  assert.equal(row.can_assume_owner, true)
  assert.equal(
    row.event_table_owner,
    'openexpert_owner',
    'upgrade harness must create all application objects as openexpert_owner',
  )
}

test('0087 backfills pre-existing append-only user/system events without rewriting history', {
  skip: !databaseUrl,
  timeout: 60_000,
}, async () => {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const precondition = await client.query(`
      SELECT
        to_regclass('private.mail_bank_agent_pdf_attachment_jobs') IS NULL
          AS before_0087,
        NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'crm_mortgage_application_events'
            AND column_name = 'actor_kind'
        ) AS actor_kind_absent
    `)
    assert.equal(
      precondition.rows[0].before_0087 && precondition.rows[0].actor_kind_absent,
      true,
      '0087 upgrade test requires a fresh isolated database migrated through 0086 only',
    )

    await ensureProductionLikeOwner(client)
    const ids = await seedPre0087Events(client)
    const before = await historicalEventDigest(client, ids.applicationId, false)
    assert.equal(before.count, 2)

    // Trigger enablement is transactional. A failure after the narrow disable
    // must restore the append-only guard before the real migration is tried.
    await client.query('BEGIN')
    let forcedError
    try {
      await client.query('SET LOCAL ROLE openexpert_owner')
      const role = await client.query('SELECT current_user')
      assert.equal(role.rows[0].current_user, 'openexpert_owner')
      await client.query(`
        ALTER TABLE public.crm_mortgage_application_events
          DISABLE TRIGGER crm_mortgage_application_events_guard_append_only
      `)
      await client.query(`
        UPDATE public.crm_mortgage_application_events
        SET payload = payload || '{"forcedRollbackMutation":true}'::jsonb
        WHERE id = $1
      `, [ids.userEventId])
      await client.query('SELECT 1 / 0')
    }
    catch (error) {
      forcedError = error
      await client.query('ROLLBACK')
    }
    assert.equal(forcedError?.code, '22012')
    assert.deepEqual(await appendOnlyTrigger(client), {
      tgenabled: 'O',
      tgisinternal: false,
      function_matches: true,
    })
    assert.deepEqual(
      await historicalEventDigest(client, ids.applicationId, false),
      before,
      'forced rollback changed historical event fields/count',
    )

    const migration = await readFile(migrationUrl, 'utf8')
    await client.query('BEGIN')
    try {
      await client.query('SET LOCAL ROLE openexpert_owner')
      const role = await client.query('SELECT current_user')
      assert.equal(role.rows[0].current_user, 'openexpert_owner')
      await client.query(migration)
      await client.query('COMMIT')
    }
    catch (error) {
      await client.query('ROLLBACK')
      throw error
    }

    const after = await historicalEventDigest(client, ids.applicationId, true)
    assert.deepEqual(after, before, 'historical event fields/count changed during 0087')
    const actors = await client.query(`
      SELECT id, actor_kind, bank_mail_attachment_job_id
      FROM public.crm_mortgage_application_events
      WHERE application_id = $1
      ORDER BY aggregate_revision
    `, [ids.applicationId])
    assert.deepEqual(actors.rows, [
      {
        id: ids.userEventId,
        actor_kind: 'user',
        bank_mail_attachment_job_id: null,
      },
      {
        id: ids.systemEventId,
        actor_kind: 'system',
        bank_mail_attachment_job_id: null,
      },
    ])
    assert.deepEqual(await appendOnlyTrigger(client), {
      tgenabled: 'O',
      tgisinternal: false,
      function_matches: true,
    })
    for (const [statement, eventId] of [
      [`UPDATE public.crm_mortgage_application_events
        SET payload = payload WHERE id = $1`, ids.userEventId],
      ['DELETE FROM public.crm_mortgage_application_events WHERE id = $1', ids.systemEventId],
    ]) {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE openexpert_owner')
      await assert.rejects(
        client.query(statement, [eventId]),
        error => error.code === '42501'
          && error.message === 'mortgage_application_events_are_append_only',
      )
      await client.query('ROLLBACK')
    }
  }
  finally {
    await client.end()
  }
})
