import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../postgres/migrations/0088_bank_mail_pdf_scope_memory.sql',
  import.meta.url,
)

test('PDF scope validation keeps the exact policy while bounding planner memory', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /CREATE OR REPLACE FUNCTION private\.bank_mail_agent_pdf_job_scope_is_valid/u)
  assert.match(sql, /LANGUAGE plpgsql/u)
  assert.doesNotMatch(sql, /LANGUAGE sql/u)
  for (const invariant of [
    "identity_verdict = 'trusted_bank'",
    "authentication_policy_applied = 'openexpert_mock_dkim_aligned'",
    "identity.auto_attach_pdf_enabled",
    "bank.slug = 'openexpert-bank'",
    "link_job.state = 'linked'",
    "proposal.classification = 'strong_candidate'",
    "dispatch.status = 'sent'",
    "person.pesel ~ '^[0-9]{11}$'",
    "private.crm_mock_bank_generation_context(job_row.dispatch_id)",
    "private.crm_mortgage_document_validation_context(",
  ]) assert.ok(sql.includes(invariant), `missing scope invariant: ${invariant}`)
  assert.match(sql, /IF NOT EXISTS \([\s\S]*RETURN false/u)
  assert.match(sql, /RETURN true;/u)
})
