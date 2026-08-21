import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../postgres/migrations/0087_bank_mail_agent_pdf_attachments.sql',
  import.meta.url,
)
const smokeUrl = new URL(
  '../postgres/smoke/0087_bank_mail_agent_pdf_attachments.sql',
  import.meta.url,
)

test('PDF import is an exact mock-only durable lifecycle without stored applicant secret', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /CREATE TABLE private\.mail_bank_agent_pdf_attachment_jobs/u)
  assert.match(sql, /auto_attach_pdf_enabled/u)
  assert.match(sql, /bank\.slug = 'openexpert-bank'/u)
  assert.match(sql, /bank\.is_mock/u)
  assert.match(sql, /identity\.sender_domain = 'openexpert\.app'/u)
  assert.match(sql, /NOT identity\.allow_subdomains/u)
  assert.match(sql, /identity\.authentication_policy = 'openexpert_mock_dkim_aligned'/u)
  assert.match(sql, /inspection_policy = 'openexpert_sent_artifact_sha256_v1'/u)
  assert.match(sql, /inspection_method = 'exact_dispatch_sha256_and_bounded_pdf_v1'/u)
  assert.doesNotMatch(
    sql.slice(sql.indexOf('CREATE TABLE private.mail_bank_agent_pdf_attachment_jobs')),
    /credential_context_hash|pesel_sha256|\bpesel\s+text/u,
  )
})

test('manifest v2 generation context is recomputed and atomically pinned with payload digests', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  for (const value of [
    'generation_context_sha256',
    'generation_applicant_context_sha256',
    'generation_bank_context_sha256',
    'generation_expectation_sha256',
    'generation_valid_until',
    'generation_context_pinned_at',
  ]) assert.ok(sql.includes(value), `missing dispatch pin ${value}`)

  assert.match(sql, /CREATE FUNCTION private\.crm_mock_bank_generation_context\(\s*p_dispatch_id uuid,\s*p_payload_id uuid,\s*p_generation integer,\s*p_generation_started_at timestamptz/u)
  assert.match(sql, /openexpert-mock-bank-generation-context-v1/u)
  for (const key of [
    'identity.dispatchId',
    'identity.payloadId',
    'identity.applicationId',
    'identity.applicationNumber',
    'identity.generationStartedAt',
    'document.applicantNames.',
    'document.financialTerms.loanAmount',
    'document.financialTerms.annualInterestRate',
    'document.financialTerms.aprc',
    'document.financialTerms.monthlyInstallment',
    'document.financialTerms.termMonths',
  ]) assert.ok(sql.includes(key), `missing generation preimage field ${key}`)
  assert.match(sql, /OLD\.payload_ready_at IS NULL[\s\S]*NEW\.payload_ready_at IS NOT NULL/u)
  assert.match(sql, /openexpert-mock-bank-generation-context-v1[\s\S]*mock-bank-payload-commit/u)
  assert.match(sql, /jwt_claims ->> 'generationContextSha256'[\s\S]*generation_context ->> 'generationContextSha256'/u)
  assert.match(sql, /jwt_claims ->> 'manifestSha256'[\s\S]*NEW\.manifest_sha256/u)
  assert.match(sql, /jwt_claims ->> 'payloadSha256'[\s\S]*NEW\.payload_sha256/u)
  assert.match(sql, /crm_mock_bank_generation_context\(\s*NEW\.id,\s*NEW\.payload_id,\s*NEW\.generation,\s*NEW\.generation_started_at/u)
  assert.match(sql, /crm_mock_bank_generation_context_changed'[\s\S]*errcode = '40001'/u)
  assert.match(sql, /rotate_crm_mock_bank_generation_context_retry/u)
  assert.match(sql, /OLD\.error_code IN \([\s\S]*'generation_context_changed',[\s\S]*'uncommitted_payload_invalid'/u)
  assert.match(sql, /OLD\.payload_ready_at IS NULL/u)
  assert.match(sql, /Migration-first\/rollback bridge:[\s\S]*NULL-pinned generation/u)
})

test('manifest retention, cleanup and replay are race-safe', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /CREATE OR REPLACE FUNCTION private\.enqueue_crm_mock_bank_payload_cleanup/u)
  assert.match(sql, /OLD\.generation_context_sha256[\s\S]*interval '7 days'/u)
  assert.match(sql, /'archive',[\s\S]*cleanup_now/u)
  assert.match(sql, /release_bank_mail_agent_manifest_retention/u)
  assert.match(sql, /NEW\.state IN \('attached', 'review_required'\)/u)
  assert.doesNotMatch(
    sql.slice(
      sql.indexOf('CREATE FUNCTION private.release_bank_mail_agent_manifest_retention'),
      sql.indexOf('CREATE FUNCTION private.protect_bank_mail_agent_pdf_provenance'),
    ),
    /'failed'|'conflict'/u,
  )
  assert.match(sql, /IF was_importing THEN[\s\S]*FOR UPDATE;[\s\S]*cleanup_row\.status <> 'reserved'[\s\S]*cleanup_row\.locked_at IS NOT NULL/u)
  assert.match(sql, /SET available_at = import_now \+ interval '45 minutes'/u)
})

test('multiple intake candidates survive force resend while formal provenance stays single-writer', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const jobs = sql.slice(
    sql.indexOf('CREATE TABLE private.mail_bank_agent_pdf_attachment_jobs'),
    sql.indexOf('CREATE INDEX mail_bank_agent_pdf_attachment_jobs_claim_idx'),
  )

  assert.doesNotMatch(jobs, /UNIQUE \(\s*dispatch_id, dispatch_generation/u)
  assert.match(jobs, /FOREIGN KEY \(dispatch_id\)[\s\S]*REFERENCES public\.crm_mock_bank_dispatches \(id\)/u)
  assert.doesNotMatch(jobs, /FOREIGN KEY \(dispatch_id, dispatch_generation, dispatch_payload_id\)/u)
  assert.match(sql, /mail_bank_agent_pdf_provenance_dispatch_key UNIQUE \(\s*dispatch_id, dispatch_generation/u)
  assert.match(sql, /dispatch\.generation = job\.dispatch_generation/u)
  assert.match(sql, /resolution_code = 'dispatch_generation_changed'/u)
})

test('sent/link races are reconciled off the canonical write paths by a bounded exact service claim', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.doesNotMatch(sql, /CREATE TRIGGER mail_bank_agent_thread_link_jobs_enqueue_pdf/u)
  assert.doesNotMatch(sql, /CREATE TRIGGER crm_mock_bank_dispatches_z_enqueue_pdf_jobs/u)
  assert.match(sql, /neither may block or roll back because PDF import is unavailable/u)
  assert.match(sql, /JOIN public\.crm_mock_bank_payload_cleanup_jobs AS manifest_cleanup/u)
  assert.match(sql, /dispatch\.generation_context_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/u)
  assert.match(sql, /FOR UPDATE OF link_job SKIP LOCKED[\s\S]*LIMIT 20/u)
  assert.match(sql, /Durable bounded backstop for the two-transaction link\/sent race/u)
})

test('worker scopes bind exact manifest, full payload and Gmail archive before PESEL proof', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  for (const field of [
    'dispatchId',
    'dispatchGeneration',
    'dispatchPayloadId',
    'dispatchGenerationStartedAt',
    'generationContextSha256',
    'manifestStorageBucket',
    'manifestStoragePath',
    'manifestSha256',
    'manifestSizeBytes',
    'payloadSha256',
    'providerMessageIdSha256',
  ]) assert.ok(sql.includes(`'${field}'`), `missing claim field ${field}`)
  assert.match(sql, /crm-bank-mail-pdf-proof-v1/u)
  assert.match(sql, /jwt_claims ->> 'generationContextSha256'[\s\S]*job_row\.generation_context_sha256/u)
  assert.match(sql, /jwt_claims ->> 'manifestSha256'[\s\S]*job_row\.manifest_sha256/u)
  assert.match(sql, /jwt_claims ->> 'payloadSha256'[\s\S]*job_row\.dispatch_payload_sha256/u)
  assert.match(sql, /credential_kind_used = 'primary_pesel'/u)
})

test('trusted ESIS is typed, non-AI, immutable and remains current only for matching business context', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /CREATE TABLE public\.crm_mortgage_trusted_document_validations/u)
  assert.match(sql, /generation_context_sha256 text NOT NULL/u)
  assert.match(sql, /dispatch_payload_sha256 text NOT NULL/u)
  assert.match(sql, /actor_kind = 'bank_mail_agent'/u)
  assert.match(sql, /artifact_row\.actor_kind = 'bank_mail_agent'[\s\S]*artifact_row\.ai_validation_id IS NOT NULL/u)
  assert.match(sql, /current_generation_context ->> 'generationContextSha256'[\s\S]*trusted_row\.generation_context_sha256/u)
  assert.match(sql, /mortgage_esis_document_identity_is_immutable/u)
  assert.match(sql, /UPDATE OF[\s\S]*document_type,[\s\S]*name, storage_bucket, storage_path,[\s\S]*sha256/u)
  assert.match(sql, /NEW\.state IN \('attached', 'review_required'\)/u)
  assert.match(sql, /'state', 'conflict',[\s\S]*'attachment_scope_conflict'/u)
  assert.match(sql, /current_generation_context ->> 'applicantContextSha256'[\s\S]*job_row\.applicant_context_sha256/u)
  assert.match(sql, /current_generation_context ->> 'bankContextSha256'[\s\S]*job_row\.bank_context_sha256/u)
  assert.match(sql, /current_generation_context ->> 'expectationSha256'[\s\S]*job_row\.expectation_sha256/u)
  assert.match(sql, /job_row\.lease_expires_at <= fail_now/u)
  assert.match(sql, /UPDATE OF[\s\S]*bank_id,[\s\S]*sender_domain,[\s\S]*allow_subdomains,[\s\S]*authentication_policy/u)
})

test('public status is presentation-safe and rollout lists a schema-cache refresh', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const getter = sql.slice(sql.indexOf(
    'CREATE OR REPLACE FUNCTION public.get_my_mail_bank_agent_statuses(',
  ))

  assert.match(getter, /'attachment'/u)
  assert.match(getter, /private\.get_bank_mail_agent_pdf_attachment_status\(intake\.id\)/u)
  assert.doesNotMatch(getter, /'attachmentJobId'|'dispatchId'|'storagePath'|'intakeSourceSha256'|'credential'/u)
  assert.match(sql, /Data API\/PostgREST schema-cache refresh/u)
  assert.match(sql, /DB -> CRM writer -> cache refresh[\s\S]*Trigger drainer/u)
})

test('rollback smoke covers generation, cleanup, replay, force resend and manual conflict gates', async () => {
  const smoke = await readFile(smokeUrl, 'utf8')
  for (const marker of [
    'generation_context_cross_language_golden_mismatch',
    'legacy_payload_commit_unexpectedly_pinned',
    'partial_generation_claims_were_accepted',
    'context_mutation_between_build_and_commit_was_accepted',
    'uncommitted_invalid_retry_did_not_rotate_paths',
    'manifest_v2_cleanup_was_not_delayed',
    'completed_cleanup_replay_returned_upload_path',
    'cleanup_reservation_was_not_extended_before_replay',
    'late_generation_mail_blocked_fresh_generation',
    'mutable_dispatch_generation_fk_blocked_force_resend',
    'non_esis_to_esis_update_bypassed_active_job',
    'bank_agent_document_binary_identity_was_mutable',
    'attached_status_ignored_current_context_change',
  ]) assert.ok(smoke.includes(marker), `missing 0087 smoke marker ${marker}`)
})
