import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import pg from 'pg'

const databaseUrl = process.env.OPENEXPERT_TEST_DATABASE_URL

function sha256(value = randomUUID()) {
  return createHash('sha256').update(value).digest('hex')
}

async function begin(client, isolation = 'READ COMMITTED') {
  await client.query(`BEGIN ISOLATION LEVEL ${isolation}`)
  await client.query("SET LOCAL statement_timeout = '5s'")
  await client.query("SET LOCAL lock_timeout = '5s'")
}

async function fixture(client) {
  const ids = {
    organizationId: randomUUID(),
    ownerUserId: randomUUID(),
    connectionId: randomUUID(),
    clientId: randomUUID(),
    caseId: randomUUID(),
    otherCaseId: randomUUID(),
    caseItemId: randomUUID(),
    submissionId: randomUUID(),
    offerId: randomUUID(),
  }

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
    `)
    assert.equal(bank.rowCount, 1)
    ids.bankId = bank.rows[0].id

    const productType = await client.query(`
      SELECT id
      FROM public.crm_product_types
      WHERE code = 'credit_mortgage'
        AND is_active
        AND organization_id IS NULL
      ORDER BY id
      LIMIT 1
    `)
    assert.equal(productType.rowCount, 1)
    ids.productTypeId = productType.rows[0].id

    const email = `0085-concurrency-${ids.ownerUserId.replaceAll('-', '')}@example.test`
    await client.query(`
      INSERT INTO identity.users (id, name, email, email_verified)
      VALUES ($1, '0085 Concurrency Owner', $2, true)
    `, [ids.ownerUserId, email])
    await client.query(`
      INSERT INTO public.organizations (
        id, name, slug, kind, billing_access_state
      ) VALUES ($1, '0085 concurrency', $2, 'intermediary', 'not_required')
    `, [ids.organizationId, `bank-mail-concurrency-${ids.organizationId}`])
    await client.query(`
      INSERT INTO public.users (id, organization_id, email, role, full_name)
      VALUES ($1, $2, $3, 'admin', '0085 Concurrency Owner')
    `, [ids.ownerUserId, ids.organizationId, email])

    await client.query(
      'ALTER TABLE public.organization_memberships DISABLE TRIGGER USER',
    )
    await client.query(`
      INSERT INTO public.organization_memberships (organization_id, user_id, role)
      VALUES ($1, $2, 'admin')
    `, [ids.organizationId, ids.ownerUserId])
    await client.query(
      'ALTER TABLE public.organization_memberships ENABLE TRIGGER USER',
    )

    await client.query(`
      INSERT INTO public.mail_connections (
        id, organization_id, owner_user_id, provider, account_id,
        account_email, status
      ) VALUES ($1, $2, $3, 'google', $4, $5, 'active')
    `, [
      ids.connectionId,
      ids.organizationId,
      ids.ownerUserId,
      `0085-concurrency-${ids.connectionId}`,
      email,
    ])

    await client.query('ALTER TABLE public.crm_clients DISABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_clients (
        id, organization_id, owner_user_id, display_name
      ) VALUES ($1, $2, $3, '0085 Concurrency Client')
    `, [ids.clientId, ids.organizationId, ids.ownerUserId])
    await client.query('ALTER TABLE public.crm_clients ENABLE TRIGGER USER')

    await client.query('ALTER TABLE public.crm_cases DISABLE TRIGGER USER')
    await client.query(`
      INSERT INTO public.crm_cases (
        id, organization_id, client_id, owner_user_id, title
      ) VALUES
        ($1, $3, $4, $5, '0085 Auto Case'),
        ($2, $3, $4, $5, '0085 Other Case')
    `, [
      ids.caseId,
      ids.otherCaseId,
      ids.organizationId,
      ids.clientId,
      ids.ownerUserId,
    ])
    await client.query('ALTER TABLE public.crm_cases ENABLE TRIGGER USER')

    await client.query(`
      INSERT INTO public.crm_case_items (
        id, organization_id, case_id, product_type_id, owner_user_id, title
      ) VALUES ($1, $2, $3, $4, $5, '0085 Mortgage')
    `, [
      ids.caseItemId,
      ids.organizationId,
      ids.caseId,
      ids.productTypeId,
      ids.ownerUserId,
    ])
    await client.query(`
      INSERT INTO public.crm_item_submissions (id, organization_id, case_item_id)
      VALUES ($1, $2, $3)
    `, [ids.submissionId, ids.organizationId, ids.caseItemId])

    await client.query(
      'ALTER TABLE public.crm_case_offer_snapshots DISABLE TRIGGER USER',
    )
    await client.query(`
      INSERT INTO public.crm_case_offer_snapshots (
        id, organization_id, case_id, bank_id, saved_by_user_id,
        bank_name, product_name, calculator_version, scenario_snapshot,
        catalog_snapshot, calculation_snapshot
      ) VALUES (
        $1, $2, $3, $4, $5, 'OpenExpert Bank', '0085 Product',
        '0085-concurrency', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
      )
    `, [
      ids.offerId,
      ids.organizationId,
      ids.caseId,
      ids.bankId,
      ids.ownerUserId,
    ])
    await client.query(
      'ALTER TABLE public.crm_case_offer_snapshots ENABLE TRIGGER USER',
    )

    await client.query(
      'ALTER TABLE public.crm_case_bank_applications DISABLE TRIGGER USER',
    )
    await client.query(`
      INSERT INTO public.crm_case_bank_applications (
        submission_id, organization_id, case_id, case_item_id, offer_id,
        bank_id, slot, created_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7)
    `, [
      ids.submissionId,
      ids.organizationId,
      ids.caseId,
      ids.caseItemId,
      ids.offerId,
      ids.bankId,
      ids.ownerUserId,
    ])
    await client.query(
      'ALTER TABLE public.crm_case_bank_applications ENABLE TRIGGER USER',
    )

    await client.query('COMMIT')
    return ids
  }
  catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function prepareRun(client, ids, label) {
  const threadKeyHash = sha256(`thread:${label}:${randomUUID()}`)
  const threadReference = `thread_${label}_${randomUUID()}`
  await begin(client)
  try {
    const claims = {
      role: 'openexpert_service',
      source: 'crm-bank-mail-ingress-v1',
      serviceId: 'openexpert-crm-bank-mail-ingestion',
      preset: 'bank-mail-intake',
      organizationId: ids.organizationId,
      connectionId: ids.connectionId,
      mailboxOwnerUserId: ids.ownerUserId,
      provider: 'google',
      threadKeySha256: threadKeyHash,
      threadReference,
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
      sha256(`message:${label}:${randomUUID()}`),
      sha256(`source:${label}:${randomUUID()}`),
      ids.bankId,
    ])
    const intakeId = claimed.rows[0].result.intakeId
    const run = await client.query(`
      SELECT public.claim_bank_mail_agent_run(
        $1, 'deepseek/deepseek-v4-flash-0731'
      ) AS result
    `, [intakeId])
    const runResult = run.rows[0].result
    await client.query(
      "SELECT set_config('request.jwt.claims', '{\"role\":\"openexpert_service\"}', true)",
    )
    await client.query(`
      SELECT public.bind_bank_mail_agent_run_session($1, $2, $3)
    `, [runResult.runId, runResult.leaseToken, `eve_${label}_${randomUUID()}`])
    await client.query('COMMIT')
    return { intakeId, runId: runResult.runId, threadKeyHash, threadReference }
  }
  catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function propose(client, ids, run) {
  await client.query(`
    SELECT public.propose_bank_mail_case_match(
      $1, $2, $3, $4, 'strong_candidate',
      ARRAY['bank_application_reference']::text[], ARRAY[]::text[]
    )
  `, [run.intakeId, run.runId, ids.caseId, ids.submissionId])
}

async function insertCaseLink(client, ids, run, caseId = ids.otherCaseId) {
  return client.query(`
    INSERT INTO public.mail_context_thread_links (
      organization_id, owner_user_id, connection_id, thread_key_hash,
      thread_reference, case_id, link_source
    ) VALUES ($1, $2, $3, $4, $5, $6, 'manual')
    RETURNING id
  `, [
    ids.organizationId,
    ids.ownerUserId,
    ids.connectionId,
    run.threadKeyHash,
    run.threadReference,
    caseId,
  ])
}

async function insertClientLink(client, ids, run) {
  return client.query(`
    INSERT INTO public.mail_context_thread_links (
      organization_id, owner_user_id, connection_id, thread_key_hash,
      thread_reference, client_id, link_source
    ) VALUES ($1, $2, $3, $4, $5, $6, 'manual')
    RETURNING id
  `, [
    ids.organizationId,
    ids.ownerUserId,
    ids.connectionId,
    run.threadKeyHash,
    run.threadReference,
    ids.clientId,
  ])
}

async function job(client, intakeId) {
  const result = await client.query(`
    SELECT state, resolution_code, link_id
    FROM private.mail_bank_agent_thread_link_jobs
    WHERE intake_id = $1
  `, [intakeId])
  assert.equal(result.rowCount, 1)
  return result.rows[0]
}

async function linkCount(client, ids, run) {
  const result = await client.query(`
    SELECT count(*)::integer AS count
    FROM public.mail_context_thread_links
    WHERE organization_id = $1
      AND owner_user_id = $2
      AND connection_id = $3
      AND thread_key_hash = $4
  `, [ids.organizationId, ids.ownerUserId, ids.connectionId, run.threadKeyHash])
  return result.rows[0].count
}

function expectCode(error, code) {
  assert.equal(error?.code, code, error?.message)
  return true
}

test('bank-mail auto-link serializes with manual/client writers without deadlock', {
  skip: !databaseUrl,
  timeout: 45_000,
}, async () => {
  const admin = new pg.Client({ connectionString: databaseUrl })
  const auto = new pg.Client({ connectionString: databaseUrl })
  const manual = new pg.Client({ connectionString: databaseUrl })
  await Promise.all([admin.connect(), auto.connect(), manual.connect()])
  let ids
  try {
    ids = await fixture(admin)

    // Manual same-case tuple is fully serialized before auto decides; the job
    // reuses it and neither transaction waits in a unique/advisory cycle.
    const manualSameFirst = await prepareRun(admin, ids, 'manual_same_first')
    await begin(manual)
    await insertCaseLink(manual, ids, manualSameFirst, ids.caseId)
    await begin(auto)
    const blockedProposal = propose(auto, ids, manualSameFirst)
    await new Promise(resolve => setTimeout(resolve, 50))
    await manual.query('COMMIT')
    await blockedProposal
    await auto.query('COMMIT')
    const reusedJob = await job(admin, manualSameFirst.intakeId)
    assert.equal(reusedJob.state, 'linked')
    assert.equal(reusedJob.resolution_code, 'existing_same_case_link')
    assert.equal(await linkCount(admin, ids, manualSameFirst), 1)

    // Auto owns the case first; a concurrently started same-case INSERT wakes
    // after auto COMMIT and resolves through ON CONFLICT without deadlock.
    const autoSameFirst = await prepareRun(admin, ids, 'auto_same_first')
    await begin(auto)
    await propose(auto, ids, autoSameFirst)
    await begin(manual)
    const waitingSameInsert = insertCaseLink(manual, ids, autoSameFirst, ids.caseId)
    await new Promise(resolve => setTimeout(resolve, 50))
    await auto.query('COMMIT')
    await assert.rejects(waitingSameInsert, error => expectCode(error, '23505'))
    await manual.query('ROLLBACK')
    const autoSameJob = await job(admin, autoSameFirst.intakeId)
    assert.equal(autoSameJob.state, 'linked')
    assert.equal(await linkCount(admin, ids, autoSameFirst), 1)

    // A ref-only UPDATE may already hold the tuple when a stale manual UPSERT
    // owns the advisory key and reaches the unique row. UPDATE never waits on
    // advisory, so it commits and the UPSERT preserves bank_agent provenance.
    await begin(manual)
    await manual.query(`
      UPDATE public.mail_context_thread_links
      SET thread_reference = 'thread_ref_update_holds_tuple'
      WHERE id = $1
    `, [autoSameJob.link_id])
    await begin(auto)
    const waitingUpsert = auto.query(`
      INSERT INTO public.mail_context_thread_links (
        organization_id, owner_user_id, connection_id, thread_key_hash,
        thread_reference, case_id, link_source
      ) VALUES ($1, $2, $3, $4, 'thread_refreshed', $5, 'manual')
      ON CONFLICT ON CONSTRAINT mail_context_thread_links_scope_unique
      DO UPDATE SET
        thread_reference = EXCLUDED.thread_reference,
        link_source = EXCLUDED.link_source
      RETURNING link_source, thread_reference
    `, [
      ids.organizationId,
      ids.ownerUserId,
      ids.connectionId,
      autoSameFirst.threadKeyHash,
      ids.caseId,
    ])
    await new Promise(resolve => setTimeout(resolve, 50))
    await manual.query('COMMIT')
    const upserted = await waitingUpsert
    await auto.query('COMMIT')
    assert.equal(upserted.rows[0].link_source, 'bank_mail_agent')
    assert.equal(upserted.rows[0].thread_reference, 'thread_refreshed')

    // Different case committed first => auto records conflict, no second link.
    const manualOtherFirst = await prepareRun(admin, ids, 'manual_other_first')
    await begin(manual)
    await insertCaseLink(manual, ids, manualOtherFirst)
    await begin(auto)
    await propose(auto, ids, manualOtherFirst)
    await manual.query('COMMIT')
    await auto.query('COMMIT')
    assert.equal((await job(admin, manualOtherFirst.intakeId)).state, 'conflict')
    assert.equal(await linkCount(admin, ids, manualOtherFirst), 1)

    // Auto committed first => a later different-case manual write fails closed.
    const autoOtherFirst = await prepareRun(admin, ids, 'auto_other_first')
    await begin(auto)
    await propose(auto, ids, autoOtherFirst)
    await auto.query('COMMIT')
    await begin(manual)
    await assert.rejects(
      insertCaseLink(manual, ids, autoOtherFirst),
      error => expectCode(error, '23505'),
    )
    await manual.query('ROLLBACK')
    assert.equal((await job(admin, autoOtherFirst.intakeId)).state, 'linked')
    assert.equal(await linkCount(admin, ids, autoOtherFirst), 1)

    // Client-only context follows the same two commit-order outcomes.
    const clientFirst = await prepareRun(admin, ids, 'client_first')
    await begin(manual)
    await insertClientLink(manual, ids, clientFirst)
    await begin(auto)
    await propose(auto, ids, clientFirst)
    await manual.query('COMMIT')
    await auto.query('COMMIT')
    assert.equal((await job(admin, clientFirst.intakeId)).state, 'conflict')
    assert.equal(await linkCount(admin, ids, clientFirst), 1)

    const autoBeforeClient = await prepareRun(admin, ids, 'auto_before_client')
    await begin(auto)
    await propose(auto, ids, autoBeforeClient)
    await auto.query('COMMIT')
    await begin(manual)
    await assert.rejects(
      insertClientLink(manual, ids, autoBeforeClient),
      error => expectCode(error, '23505'),
    )
    await manual.query('ROLLBACK')
    assert.equal((await job(admin, autoBeforeClient.intakeId)).state, 'linked')
    assert.equal(await linkCount(admin, ids, autoBeforeClient), 1)

    // Reference refresh is allowed; retargeting identity/context is not.
    const liveJob = await job(admin, autoBeforeClient.intakeId)
    await admin.query(`
      UPDATE public.mail_context_thread_links
      SET thread_reference = 'thread_reference_updated'
      WHERE id = $1
    `, [liveJob.link_id])
    await assert.rejects(
      admin.query(`
        UPDATE public.mail_context_thread_links
        SET thread_key_hash = $2
        WHERE id = $1
      `, [liveJob.link_id, sha256('retarget')]),
      error => expectCode(error, '23505'),
    )

    // RR cannot participate in the bilateral INSERT protocol.
    const repeatable = await prepareRun(admin, ids, 'repeatable_insert')
    await begin(manual, 'REPEATABLE READ')
    await assert.rejects(
      insertCaseLink(manual, ids, repeatable),
      error => expectCode(error, '25001'),
    )
    await manual.query('ROLLBACK')

    // Explicit DELETE is the supported unlink override; the getter verifies
    // the live tuple and must stop exposing the otherwise historical job.
    await admin.query('DELETE FROM public.mail_context_thread_links WHERE id = $1', [
      liveJob.link_id,
    ])
    const getter = await admin.query(
      'SELECT public.get_strong_bank_mail_agent_proposal_case($1) AS case_id',
      [autoBeforeClient.intakeId],
    )
    assert.equal(getter.rows[0].case_id, null)
  }
  finally {
    for (const client of [auto, manual]) {
      try { await client.query('ROLLBACK') }
      catch {}
    }
    if (ids) {
      try {
        await admin.query('DELETE FROM public.organizations WHERE id = $1', [
          ids.organizationId,
        ])
        await admin.query('DELETE FROM identity.users WHERE id = $1', [ids.ownerUserId])
      }
      catch {}
    }
    await Promise.all([admin.end(), auto.end(), manual.end()])
  }
})
