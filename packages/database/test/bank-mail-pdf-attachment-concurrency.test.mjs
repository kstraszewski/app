import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'

const databaseUrl = process.env.OPENEXPERT_TEST_DATABASE_URL

function sha256(value = randomUUID()) {
  return createHash('sha256').update(value).digest('hex')
}

async function begin(client) {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
  await client.query("SET LOCAL statement_timeout = '10s'")
  await client.query("SET LOCAL lock_timeout = '5s'")
}

async function prepareIntake(client, ids, label, proposeNow) {
  const claims = {
    role: 'openexpert_service',
    source: 'crm-bank-mail-ingress-v1',
    serviceId: 'openexpert-crm-bank-mail-ingestion',
    preset: 'bank-mail-intake',
    organizationId: ids.organizationId,
    connectionId: ids.connectionId,
    mailboxOwnerUserId: ids.ownerUserId,
    provider: 'google',
    threadKeySha256: sha256(`0087-thread:${label}`),
    threadReference: `0087_${label}_${randomUUID()}`,
    dkimAligned: true,
  }
  await client.query(
    "SELECT set_config('request.jwt.claims', $1, true)",
    [JSON.stringify(claims)],
  )
  const claimed = await client.query(`
    SELECT public.claim_bank_mail_agent_intake(
      $1, $2, $3, 'google', $4, $5, 'openexpert.app',
      'failed', false, false, $6
    ) AS result
  `, [
    ids.organizationId,
    ids.connectionId,
    ids.ownerUserId,
    sha256(`0087-message:${label}:${randomUUID()}`),
    sha256(`0087-source:${label}:${randomUUID()}`),
    ids.bankId,
  ])
  const intakeId = claimed.rows[0].result.intakeId
  const run = await client.query(`
    SELECT public.claim_bank_mail_agent_run(
      $1, 'deepseek/deepseek-v4-flash-0731'
    ) AS result
  `, [intakeId])
  const runId = run.rows[0].result.runId
  await client.query(
    "SELECT set_config('request.jwt.claims', '{\"role\":\"openexpert_service\"}', true)",
  )
  await client.query(
    'SELECT public.bind_bank_mail_agent_run_session($1, $2, $3)',
    [runId, run.rows[0].result.leaseToken, `eve_0087_${label}_${randomUUID()}`],
  )
  if (proposeNow) {
    await client.query(`
      SELECT public.propose_bank_mail_case_match(
        $1, $2, $3, $4, 'strong_candidate',
        ARRAY['bank_application_reference']::text[], ARRAY[]::text[]
      )
    `, [intakeId, runId, ids.caseId, ids.applicationId])
  }
  return { intakeId, runId }
}

async function fixture(client) {
  const ids = {
    organizationId: randomUUID(),
    ownerUserId: randomUUID(),
    connectionId: randomUUID(),
    clientId: randomUUID(),
    personId: randomUUID(),
    caseId: randomUUID(),
    caseItemId: randomUUID(),
    applicationId: randomUUID(),
    offerId: randomUUID(),
    dispatchId: randomUUID(),
    payloadId: randomUUID(),
    dispatchRequestId: randomUUID(),
  }
  const generationStartedAt = new Date(Date.now() - 60_000)

  await client.query('BEGIN')
  try {
    const bank = await client.query(`
      SELECT bank.id
      FROM public.mortgage_banks AS bank
      JOIN public.mortgage_bank_email_identities AS identity
        ON identity.bank_id = bank.id
      WHERE bank.slug = 'openexpert-bank'
        AND bank.is_mock
        AND identity.sender_domain = 'openexpert.app'
        AND NOT identity.allow_subdomains
        AND identity.authentication_policy = 'openexpert_mock_dkim_aligned'
        AND identity.is_active
        AND identity.auto_attach_pdf_enabled
    `)
    assert.equal(bank.rowCount, 1)
    ids.bankId = bank.rows[0].id
    const product = await client.query(`
      SELECT id FROM public.crm_product_types
      WHERE code = 'credit_mortgage'
        AND organization_id IS NULL
        AND is_active
      ORDER BY id LIMIT 1
    `)
    assert.equal(product.rowCount, 1)
    ids.productTypeId = product.rows[0].id

    const email = `0087-concurrency-${ids.ownerUserId.replaceAll('-', '')}@example.test`
    await client.query(`
      INSERT INTO identity.users (id, name, email, email_verified)
      VALUES ($1, '0087 Concurrency Owner', $2, true)
    `, [ids.ownerUserId, email])
    await client.query(`
      INSERT INTO public.organizations (
        id, name, slug, kind, billing_access_state
      ) VALUES ($1, '0087 concurrency', $2, 'intermediary', 'not_required')
    `, [ids.organizationId, `0087-pdf-concurrency-${ids.organizationId}`])
    await client.query(`
      INSERT INTO public.users (id, organization_id, email, role, full_name)
      VALUES ($1, $2, $3, 'admin', '0087 Concurrency Owner')
    `, [ids.ownerUserId, ids.organizationId, email])
    await client.query('ALTER TABLE public.organization_memberships DISABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role)
      VALUES ($1, $2, 'admin')
    `, [ids.organizationId, ids.ownerUserId])
    await client.query('ALTER TABLE public.organization_memberships ENABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.mail_connections (
        id, organization_id, owner_user_id, provider, account_id,
        account_email, status
      ) VALUES ($1, $2, $3, 'google', $4, $5, 'active')
    `, [ids.connectionId, ids.organizationId, ids.ownerUserId, `0087-${ids.connectionId}`, email])

    await client.query('ALTER TABLE public.crm_clients DISABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_clients (
        id, organization_id, owner_user_id, display_name
      ) VALUES ($1, $2, $3, '0087 Concurrency Client')
    `, [ids.clientId, ids.organizationId, ids.ownerUserId])
    await client.query('ALTER TABLE public.crm_clients ENABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_client_people (
        id, organization_id, client_id, role, first_name, last_name,
        display_name, pesel
      ) VALUES ($1, $2, $3, 'primary', 'Konrad', 'Straszewski',
        'Konrad Straszewski', '85010112345')
    `, [ids.personId, ids.organizationId, ids.clientId])
    await client.query('ALTER TABLE public.crm_cases DISABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_cases (
        id, organization_id, client_id, owner_user_id, title
      ) VALUES ($1, $2, $3, $4, '0087 Concurrency Case')
    `, [ids.caseId, ids.organizationId, ids.clientId, ids.ownerUserId])
    await client.query('ALTER TABLE public.crm_cases ENABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_case_clients (
        organization_id, case_id, client_id, is_primary
      ) VALUES ($1, $2, $3, true)
    `, [ids.organizationId, ids.caseId, ids.clientId])
    await client.query(`
      INSERT INTO public.crm_case_items (
        id, organization_id, case_id, product_type_id, owner_user_id,
        title, amount_value, currency
      ) VALUES ($1, $2, $3, $4, $5, '0087 Mortgage', 500000, 'PLN')
    `, [ids.caseItemId, ids.organizationId, ids.caseId, ids.productTypeId, ids.ownerUserId])
    const applicationNumber = `OEB-20260821-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`
    await client.query(`
      INSERT INTO public.crm_item_submissions (
        id, organization_id, case_item_id, external_reference
      ) VALUES ($1, $2, $3, $4)
    `, [ids.applicationId, ids.organizationId, ids.caseItemId, applicationNumber])

    await client.query('ALTER TABLE public.crm_case_offer_snapshots DISABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_case_offer_snapshots (
        id, organization_id, case_id, bank_id, saved_by_user_id,
        bank_name, product_name, calculator_version, currency, loan_amount,
        first_installment, representative_apr_pct,
        scenario_snapshot, catalog_snapshot, calculation_snapshot
      ) VALUES (
        $1, $2, $3, $4, $5, 'OpenExpert Bank', '0087 Product',
        '0087-concurrency', 'PLN', 500000, 2963.10, 6.9,
        jsonb_build_object('years', 30),
        jsonb_build_object('version', jsonb_build_object(
          'fixed_rate_pct', '5.89', 'representative_apr_pct', '6.9'
        )), jsonb_build_object('currency', 'PLN')
      )
    `, [ids.offerId, ids.organizationId, ids.caseId, ids.bankId, ids.ownerUserId])
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
      INSERT INTO public.crm_mortgage_application_processes (
        application_id, organization_id, case_id, stage, created_by_user_id
      ) VALUES ($1, $2, $3, 'pre_application', $4)
    `, [ids.applicationId, ids.organizationId, ids.caseId, ids.ownerUserId])

    const manifestPath = `${ids.organizationId}/${ids.applicationId}/${ids.dispatchId}/esis/generation-1-${ids.payloadId}.json`
    const archivePath = `${ids.organizationId}/${ids.applicationId}/${ids.dispatchId}/esis/generation-1-${ids.payloadId}.zip`
    await client.query(`
      INSERT INTO public.crm_mock_bank_dispatches (
        id, organization_id, case_id, application_id, kind, status,
        generation, generation_started_at, attempts, request_id,
        requested_by_user_id, recipient_connection_id, payload_id,
        manifest_storage_path, archive_storage_path, last_attempt_at,
        lease_expires_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, 'esis', 'pending', 1, $5, 1, $6, $7, $8, $9,
        $10, $11, $5, clock_timestamp() + interval '5 minutes', $5, $5
      )
    `, [
      ids.dispatchId, ids.organizationId, ids.caseId, ids.applicationId,
      generationStartedAt, ids.dispatchRequestId, ids.ownerUserId,
      ids.connectionId, ids.payloadId, manifestPath, archivePath,
    ])
    const context = await client.query(`
      SELECT private.crm_mock_bank_generation_context($1, $2, 1, $3) AS value
    `, [ids.dispatchId, ids.payloadId, generationStartedAt])
    assert.ok(context.rows[0].value)
    await client.query(`
      ALTER TABLE public.crm_mock_bank_dispatches
        DISABLE TRIGGER crm_mock_bank_dispatches_pin_generation_context
    `)
    await client.query(`
      UPDATE public.crm_mock_bank_dispatches
      SET manifest_sha256 = repeat('a', 64), manifest_size_bytes = 1000,
          archive_sha256 = repeat('b', 64), archive_size_bytes = 2000,
          payload_sha256 = repeat('c', 64), payload_ready_at = clock_timestamp(),
          generation_context_sha256 = $2,
          generation_applicant_context_sha256 = $3,
          generation_bank_context_sha256 = $4,
          generation_expectation_sha256 = $5,
          generation_valid_until = $6::timestamptz,
          generation_context_pinned_at = clock_timestamp()
      WHERE id = $1
    `, [
      ids.dispatchId,
      context.rows[0].value.generationContextSha256,
      context.rows[0].value.applicantContextSha256,
      context.rows[0].value.bankContextSha256,
      context.rows[0].value.expectationSha256,
      context.rows[0].value.validUntil,
    ])
    await client.query(`
      ALTER TABLE public.crm_mock_bank_dispatches
        ENABLE TRIGGER crm_mock_bank_dispatches_pin_generation_context
    `)

    ids.staleIntakeIds = []
    for (let index = 0; index < 21; index += 1) {
      const stale = await prepareIntake(client, ids, `stale_${index}`, true)
      ids.staleIntakeIds.push(stale.intakeId)
    }
    ids.main = await prepareIntake(client, ids, 'eligible', false)
    await client.query('SET CONSTRAINTS ALL IMMEDIATE')
    await client.query(`
      UPDATE public.mail_bank_agent_intakes
      SET claimed_at = $2::timestamptz - interval '1 day'
      WHERE id = ANY($1::uuid[])
    `, [ids.staleIntakeIds, generationStartedAt])
    await client.query('COMMIT')
    return ids
  }
  catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

function claimScope(workerId) {
  return JSON.stringify({
    role: 'openexpert_service',
    source: 'crm-bank-mail-pdf-claim-v1',
    serviceId: 'openexpert-crm-bank-mail-pdf-worker',
    preset: 'bank-mail-pdf-attachment',
    workerId,
  })
}

test('claim-time reconcile closes concurrent sent/link miss once without stale starvation', {
  skip: !databaseUrl,
  timeout: 60_000,
}, async () => {
  const admin = new pg.Client({ connectionString: databaseUrl })
  const linker = new pg.Client({ connectionString: databaseUrl })
  const sender = new pg.Client({ connectionString: databaseUrl })
  const first = new pg.Client({ connectionString: databaseUrl })
  const second = new pg.Client({ connectionString: databaseUrl })
  await Promise.all([admin.connect(), linker.connect(), sender.connect(), first.connect(), second.connect()])
  let ids
  try {
    const isolation = await admin.query(`
      SELECT count(*)::integer AS count
      FROM private.mail_bank_agent_pdf_attachment_jobs
    `)
    assert.equal(
      isolation.rows[0].count,
      0,
      '0087 concurrency test requires a fresh isolated database with no PDF attachment jobs',
    )
    ids = await fixture(admin)

    await begin(linker)
    await linker.query(`
      SELECT public.propose_bank_mail_case_match(
        $1, $2, $3, $4, 'strong_candidate',
        ARRAY['bank_application_reference']::text[], ARRAY[]::text[]
      )
    `, [ids.main.intakeId, ids.main.runId, ids.caseId, ids.applicationId])
    await begin(sender)
    // The production sent finalizer also writes an unrelated case activity.
    // That activity's FK lock conflicts with the proposal's deliberate case
    // lock before the PDF reconciliation code is reached.  Suppress user
    // triggers in this isolated sender transaction and materialize the exact
    // canonical sent + cleanup state ourselves, so both independent commits
    // can miss the (intentionally absent) synchronous PDF enqueue path.
    await sender.query("SET LOCAL session_replication_role = 'replica'")
    await sender.query(`
      UPDATE public.crm_mock_bank_dispatches AS dispatch
      SET status = 'sent',
          provider_message_id = '0087-concurrent-provider',
          lease_expires_at = NULL,
          sent_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE dispatch.id = $1
        AND dispatch.request_id = $2
        AND dispatch.status = 'pending'
        AND dispatch.payload_ready_at IS NOT NULL
    `, [ids.dispatchId, ids.dispatchRequestId])
    await sender.query(`
      INSERT INTO public.crm_mock_bank_payload_cleanup_jobs (
        organization_id, dispatch_id, payload_id, generation,
        storage_bucket, storage_path, object_kind, object_sha256, available_at
      )
      SELECT
        dispatch.organization_id, dispatch.id, dispatch.payload_id,
        dispatch.generation, dispatch.manifest_storage_bucket,
        dispatch.manifest_storage_path, 'manifest', dispatch.manifest_sha256,
        clock_timestamp() + interval '7 days'
      FROM public.crm_mock_bank_dispatches AS dispatch
      WHERE dispatch.id = $1
      UNION ALL
      SELECT
        dispatch.organization_id, dispatch.id, dispatch.payload_id,
        dispatch.generation, dispatch.archive_storage_bucket,
        dispatch.archive_storage_path, 'archive', dispatch.archive_sha256,
        clock_timestamp()
      FROM public.crm_mock_bank_dispatches AS dispatch
      WHERE dispatch.id = $1
      ON CONFLICT (storage_bucket, storage_path) DO NOTHING
    `, [ids.dispatchId])
    await Promise.all([linker.query('COMMIT'), sender.query('COMMIT')])

    const before = await admin.query(`
      SELECT count(*)::integer AS count
      FROM private.mail_bank_agent_pdf_attachment_jobs
      WHERE intake_id = $1
    `, [ids.main.intakeId])
    assert.equal(before.rows[0].count, 0, 'canonical writes must not synchronously enqueue')

    await Promise.all([begin(first), begin(second)])
    await Promise.all([
      first.query("SELECT set_config('request.jwt.claims', $1, true)", [claimScope('0087-worker-a')]),
      second.query("SELECT set_config('request.jwt.claims', $1, true)", [claimScope('0087-worker-b')]),
    ])
    const [firstClaim, secondClaim] = await Promise.all([
      first.query("SELECT public.claim_bank_mail_agent_pdf_attachment_jobs('0087-worker-a', 5, 1800) AS result"),
      second.query("SELECT public.claim_bank_mail_agent_pdf_attachment_jobs('0087-worker-b', 5, 1800) AS result"),
    ])
    await Promise.all([first.query('COMMIT'), second.query('COMMIT')])

    const claims = [
      ...firstClaim.rows[0].result,
      ...secondClaim.rows[0].result,
    ].filter(claim => claim.organizationId === ids.organizationId)
    assert.equal(claims.length, 1)
    assert.equal(claims[0].state, 'downloading')
    assert.equal(claims[0].attemptNo, 1)

    const final = await admin.query(`
      SELECT count(*)::integer AS count,
             min(state) AS state,
             min(attempt_count)::integer AS attempt_count,
             min(intake_id::text)::uuid AS intake_id
      FROM private.mail_bank_agent_pdf_attachment_jobs
      WHERE organization_id = $1
    `, [ids.organizationId])
    assert.equal(final.rows[0].count, 1)
    assert.equal(final.rows[0].state, 'downloading')
    assert.equal(final.rows[0].attempt_count, 1)
    assert.equal(final.rows[0].intake_id, ids.main.intakeId)
  }
  finally {
    for (const client of [linker, sender, first, second]) {
      try { await client.query('ROLLBACK') }
      catch {}
    }
    try {
      if (ids) {
        await admin.query('BEGIN')
        try {
          await admin.query(
            'DELETE FROM private.mail_bank_agent_pdf_attachment_jobs WHERE organization_id = $1',
            [ids.organizationId],
          )
          // The rest of the canonical fixture is intentionally retained in
          // this disposable database.  Removing the dispatch cleanup rows
          // makes it permanently ineligible for claim-time reconciliation,
          // so a second run cannot recreate the deleted target job.
          await admin.query(
            'DELETE FROM public.crm_mock_bank_payload_cleanup_jobs WHERE dispatch_id = $1',
            [ids.dispatchId],
          )
          const remaining = await admin.query(`
            SELECT count(*)::integer AS count
            FROM private.mail_bank_agent_pdf_attachment_jobs
            WHERE organization_id = $1
          `, [ids.organizationId])
          assert.equal(remaining.rows[0].count, 0, 'fixture PDF job cleanup must be complete')
          await admin.query('COMMIT')
        }
        catch (error) {
          await admin.query('ROLLBACK')
          throw error
        }
      }
    }
    finally {
      await Promise.allSettled([
        admin.end(), linker.end(), sender.end(), first.end(), second.end(),
      ])
    }
  }
})
