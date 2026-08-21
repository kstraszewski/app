import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../postgres/migrations/0085_bank_mail_thread_link_jobs.sql',
  import.meta.url,
)
const finalizerSmokeUrl = new URL(
  '../postgres/smoke/0085_bank_mail_thread_link_finalizer.sql',
  import.meta.url,
)

test('bank-mail thread intent stays on cached RPC signatures', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.claim_bank_mail_agent_intake\(/u)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.get_bank_mail_agent_intake\(p_intake_id uuid\)/u)
  assert.doesNotMatch(sql, /CREATE (?:OR REPLACE )?FUNCTION public\.register_bank_mail/u)
  assert.match(sql, /private\.require_bank_mail_agent_ingress_claims/u)
  assert.match(sql, /current_setting\('request\.jwt\.claims', true\)/u)
  for (const claim of [
    'crm-bank-mail-ingress-v1',
    'openexpert-crm-bank-mail-ingestion',
    'bank-mail-intake',
    'threadKeySha256',
    'threadReference',
    'dkimAligned',
  ]) assert.ok(sql.includes(claim), `missing bounded claim ${claim}`)
  assert.match(sql, /IF NOT has_custom_ingress_claim THEN[\s\S]*'legacy', true/u)
  assert.match(sql, /WHEN legacy_ingress THEN 'dmarc_aligned'/u)
  assert.match(sql, /IF NOT legacy_ingress THEN[\s\S]*register_bank_mail_agent_thread_link_job/u)
})

test('OpenExpert DKIM exception is exact, pinned, and DMARC remains the default', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /authentication_policy IN \([\s\S]*'dmarc_aligned',[\s\S]*'openexpert_mock_dkim_aligned'/u)
  assert.match(sql, /identity\.sender_domain = 'openexpert\.app'/u)
  assert.match(sql, /NOT identity\.allow_subdomains/u)
  assert.match(sql, /bank\.slug = 'openexpert-bank'/u)
  assert.match(sql, /bank\.is_mock/u)
  assert.match(sql, /ADD COLUMN dkim_aligned boolean DEFAULT false NOT NULL/u)
  assert.match(sql, /ADD COLUMN authentication_policy_applied text DEFAULT 'dmarc_aligned'/u)
  assert.match(sql, /intake_row\.authentication_policy_applied = 'openexpert_mock_dkim_aligned'[\s\S]*intake_row\.dkim_aligned/u)
  assert.match(sql, /identity_row\.authentication_policy = 'openexpert_mock_dkim_aligned'/u)
  assert.match(sql, /WHERE identity\.id = intake_row\.bank_email_identity_id[\s\S]*FOR SHARE/u)
  assert.match(sql, /intake_row\.authentication_policy_applied = 'dmarc_aligned'[\s\S]*intake_row\.authentication_status = 'passed'[\s\S]*intake_row\.dmarc_aligned/u)
  assert.match(sql, /'authenticationPolicy', intake_row\.authentication_policy_applied/u)
  assert.match(sql, /'dkimAligned', intake_row\.dkim_aligned/u)
})

test('durable finalizer is strong-only, conflict-safe, and deferred after proposal locks', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /CREATE TABLE private\.mail_bank_agent_thread_link_jobs/u)
  assert.match(sql, /mail_bank_agent_thread_link_jobs_linked_link_idx/u)
  assert.match(sql, /bank_mail_agent_thread_link_existing_context_conflict/u)
  assert.match(sql, /private\.finalize_bank_mail_agent_thread_link\(p_intake_id uuid\)/u)
  assert.match(sql, /proposal_row\.classification <> 'strong_candidate'/u)
  assert.match(sql, /intake_row\.status <> 'review_required'/u)
  assert.match(sql, /intake_row\.finalized_at IS NULL/u)
  assert.match(sql, /link\.client_id IS NOT NULL[\s\S]*link\.case_id IS NOT NULL AND link\.case_id <> proposal_row\.case_id/u)
  assert.match(sql, /resolution_code = 'thread_linked_to_other_context'/u)
  assert.match(sql, /pg_advisory_xact_lock/u)
  assert.match(sql, /current_setting\('transaction_isolation'\) <> 'read committed'/u)
  assert.match(sql, /CREATE TRIGGER mail_context_thread_links_lock_bank_agent_case[\s\S]*BEFORE INSERT ON/u)
  assert.match(sql, /CREATE TRIGGER mail_context_thread_links_keep_bank_agent_identity[\s\S]*BEFORE UPDATE ON/u)
  assert.match(sql, /NEW\.id IS DISTINCT FROM OLD\.id/u)
  assert.match(sql, /NEW\.link_source := OLD\.link_source/u)
  assert.match(sql, /FOR KEY SHARE;[\s\S]*pg_catalog\.pg_advisory_xact_lock/u)
  assert.match(sql, /CREATE CONSTRAINT TRIGGER mail_bank_agent_proposals_finalize_thread_link[\s\S]*DEFERRABLE INITIALLY DEFERRED/u)
  assert.match(sql, /CREATE CONSTRAINT TRIGGER mail_context_thread_links_guard_bank_agent_case[\s\S]*AFTER INSERT ON[\s\S]*DEFERRABLE INITIALLY DEFERRED/u)
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.propose_bank_mail_case_match/u)
  assert.doesNotMatch(
    sql,
    /FROM public\.mail_context_thread_links[\s\S]{0,700}FOR UPDATE/u,
    'link reads must not invert the advisory/tuple lock order',
  )
})

test('cached bind RPC supports only an exact signed EVE self-bind scope', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.bind_bank_mail_agent_run_session\(/u)
  assert.match(sql, /bank-mail-eve-session-bind-v1/u)
  assert.match(sql, /openexpert-bank-mail-eve-agent/u)
  assert.match(sql, /bank-mail-session-bind/u)
  assert.match(sql, /fe40bb62a8cd06ddce32f56c9e2434b44da8506f67b6eca5fc61ea205db0dc35/u)
  assert.match(sql, /coalesce\([\s\S]*jwt_claims ->> 'source'[\s\S]*false/u)
  assert.match(sql, /eve_self_bind IS TRUE/u)
  assert.match(sql, /eve_self_bind IS NOT TRUE[\s\S]*lease_row\.lease_token_sha256/u)
  assert.match(sql, /connection\.provider = intake_row\.provider/u)
  assert.match(sql, /connection\.status = 'active'/u)
})

test('getter keeps live-link integrity and a strict no-job rollout fallback', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /JOIN public\.mail_context_thread_links AS link[\s\S]*link\.id = job\.link_id/u)
  assert.match(sql, /NOT EXISTS \([\s\S]*private\.mail_bank_agent_thread_link_jobs/u)
  assert.match(sql, /intake\.authentication_policy_applied = 'dmarc_aligned'/u)
  assert.match(sql, /intake\.authentication_status = 'passed'/u)
  assert.match(sql, /count\(\*\)[\s\S]*mail_bank_agent_match_proposals/u)
  assert.match(sql, /count\(\*\)[\s\S]*mail_bank_agent_analysis_runs/u)
  assert.match(sql, /mail_bank_agent_run_sessions AS binding/u)
})

test('rollback-only finalizer smoke covers self-bind, legacy fallback, and conflicts', async () => {
  const sql = await readFile(finalizerSmokeUrl, 'utf8')

  for (const marker of [
    'eve_self_bind_did_not_finalize_signed_job',
    'crm_bind_replay_after_eve_hook_was_not_idempotent',
    'generic_jwt_wrong_lease_token_was_accepted',
    'empty_jwt_wrong_lease_token_was_accepted',
    'partial_eve_self_bind_claims_were_accepted',
    'legacy_strict_dmarc_getter_fallback_failed',
    'client_context_conflict_was_not_fail_closed',
  ]) assert.ok(sql.includes(marker), `missing finalizer smoke marker ${marker}`)
})
