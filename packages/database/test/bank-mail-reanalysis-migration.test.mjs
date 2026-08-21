import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../postgres/migrations/0086_bank_mail_agent_reanalysis.sql',
  import.meta.url,
)
const smokeUrl = new URL(
  '../postgres/smoke/0086_bank_mail_agent_reanalysis.sql',
  import.meta.url,
)

test('reanalysis is a private advisory lifecycle and never mutates canonical/link ledgers', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /CREATE TABLE private\.mail_bank_agent_reanalysis_requests/u)
  assert.match(sql, /mail_bank_agent_reanalysis_one_active_idx[\s\S]*WHERE state IN \('queued', 'leased', 'session_bound'\)/u)
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock/u)
  assert.match(sql, /'bank-mail-agent-reanalysis:' \|\| intake_row\.id::text/u)
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM) public\.mail_bank_agent_intakes/iu)
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM) public\.mail_bank_agent_analysis_runs/iu)
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM) public\.mail_bank_agent_match_proposals/iu)
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM) public\.mail_context_thread_links/iu)
  assert.doesNotMatch(sql, /CREATE (?:CONSTRAINT )?TRIGGER[^;]+ ON public\.(?:mail_bank_agent|mail_context_thread_links)/iu)
})

test('request lifecycle has active, cooldown, quota and bounded orphan recovery', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /CREATE FUNCTION public\.request_my_bank_mail_agent_reanalysis\([\s\S]*p_provider_message_id_hash text,[\s\S]*p_source_sha256 text/u)
  assert.match(sql, /private\.is_organization_member\(p_organization_id\)/u)
  assert.match(sql, /connection\.owner_user_id = caller_user_id/u)
  assert.match(sql, /intake\.provider_message_id_sha256 = p_provider_message_id_hash/u)
  assert.match(sql, /intake\.source_sha256 = p_source_sha256/u)
  assert.match(sql, /interval '60 seconds'/u)
  assert.match(sql, /requests_24h >= 5/u)
  assert.match(sql, /interval '24 hours'/u)
  assert.match(sql, /active_request\.state = 'queued'[\s\S]*interval '15 minutes'/u)
  assert.match(sql, /active_request\.state = 'leased'[\s\S]*lease_expires_at <= request_now/u)
  assert.match(sql, /active_request\.state = 'session_bound'[\s\S]*interval '24 hours 5 minutes'/u)
  assert.match(sql, /'accepted', false[\s\S]*'shouldDispatch', should_dispatch/u)
  assert.match(sql, /'accepted', true[\s\S]*'shouldDispatch', true/u)
})

test('claim, bind, result and failure RPCs require exact scoped service identities', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  for (const signature of [
    /claim_bank_mail_agent_reanalysis\(uuid, text, text, text, text, text\)/u,
    /bind_bank_mail_agent_reanalysis_session\(uuid, text, text\)/u,
    /record_bank_mail_agent_reanalysis_result\(\s*uuid, text, text, uuid, uuid, text\[\], text\[\], text\[\]/u,
    /fail_bank_mail_agent_reanalysis\(uuid, text\)/u,
  ]) assert.match(sql, signature)

  for (const claim of [
    'crm-bank-mail-reanalysis-claim-v1',
    'crm-bank-mail-reanalysis-failure-v1',
    'bank-mail-reanalysis-eve-session-bind-v1',
    'bank-mail-reanalysis-result-v1',
    'bank-mail-reanalysis-failure-v1',
    'openexpert-crm-bank-mail-reanalysis',
    'openexpert-bank-mail-reanalysis-eve-agent',
    'bank-mail-reanalysis',
    '2387d71e98cf6688b7096ce52b64112265beaa30626e69063a7e86c681ad6322',
  ]) assert.ok(sql.includes(claim), `missing exact reanalysis scope ${claim}`)

  for (const field of [
    'organizationId',
    'reanalysisRequestId',
    'intakeId',
    'connectionId',
    'mailboxOwnerUserId',
    'eveSessionId',
    'normalizedInputSha256',
  ]) assert.ok(sql.includes(`'${field}'`), `missing exact claim field ${field}`)

  assert.match(sql, /eve_self_bind IS TRUE AND \(/u)
  assert.match(sql, /eve_self_bind IS NOT TRUE[\s\S]*lease_token_sha256/u)
  assert.match(sql, /failure_source = 'crm-bank-mail-reanalysis-failure-v1'[\s\S]*request_row\.state = 'session_bound'/u)
})

test('advisory results are controlled, replay-safe and revalidate owner/bank/kill-switch scope', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /'review_required',[\s\S]*'security_rejected'/u)
  assert.match(sql, /p_result_code = 'security_rejected'[\s\S]*'authentication_failed'[\s\S]*'dkim_not_aligned'/u)
  assert.match(sql, /jwt_claims -> 'evidenceCodes' IS DISTINCT FROM to_jsonb\(evidence_codes_value\)/u)
  assert.match(sql, /bank_mail_agent_reanalysis_result_replay_conflict/u)
  assert.match(sql, /crm_case\.owner_user_id = request_row\.owner_user_id/u)
  assert.match(sql, /application_bank_id IS DISTINCT FROM identity_bank_id/u)
  assert.match(sql, /private\.bank_mail_agent_reanalysis_intake_is_eligible/u)
  assert.match(sql, /identity\.is_active/u)
  assert.match(sql, /identity\.authentication_policy = 'openexpert_mock_dkim_aligned'/u)
  assert.match(sql, /FOR SHARE OF identity, bank/u)
})

test('mailbox status keeps its cached signature and exposes only presentation-safe data', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const getter = sql.slice(sql.indexOf(
    'CREATE OR REPLACE FUNCTION public.get_my_mail_bank_agent_statuses(',
  ))

  assert.match(getter, /CREATE OR REPLACE FUNCTION public\.get_my_mail_bank_agent_statuses\(\s*p_organization_id uuid,\s*p_connection_id uuid,\s*p_provider_message_id_hashes text\[\]/u)
  assert.match(getter, /'providerMessageIdSha256'/u)
  assert.match(getter, /WHEN 'review_required' THEN 'proposal_created'/u)
  assert.match(getter, /'state',[\s\S]*'processing'[\s\S]*'completed'[\s\S]*'failed'/u)
  assert.match(getter, /'attemptNo', coalesce\(latest_request\.attempt_no, 0\)/u)
  assert.match(getter, /'canRerun'/u)
  assert.match(getter, /'retryAfterSeconds'/u)
  assert.doesNotMatch(getter, /'requestId'|'intakeId'|'runId'|'sessionId'|'normalizedInputSha256'/u)
  assert.match(getter, /TO authenticated, openexpert_owner/u)
  assert.match(sql, /New public RPC signatures require a PostgREST\/Data API schema-cache reload/u)
})

test('rollback smoke covers self-bind race, failures, stale recovery and presentation', async () => {
  const sql = await readFile(smokeUrl, 'utf8')

  for (const marker of [
    'queued_request_crash_recovery_invalid',
    'unscoped_reanalysis_claim_was_accepted',
    'partial_reanalysis_self_bind_was_accepted',
    'crm_failure_killed_eve_bound_reanalysis',
    'advisory_result_replay_not_idempotent',
    'stale_session_recovery_failed',
    'stale_queued_reanalysis_recovery_failed',
    'expired_lease_status_was_not_rerunnable',
    'expired_lease_reanalysis_recovery_failed',
    'dispatch_failure_replay_invalid',
    'security_rejected_advisory_not_recorded',
    'canonical_or_advisory_proposal_status_invalid',
    'mailbox_status_leaked_private_reanalysis_identity',
    'advisory_reanalysis_mutated_canonical_or_link_ledger',
    'reanalysis_identity_kill_switch_was_bypassed',
  ]) assert.ok(sql.includes(marker), `missing reanalysis smoke marker ${marker}`)
})
