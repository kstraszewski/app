import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  openExpertMockBankProductionFixture,
  openExpertMockBankProductionFixtureIds,
  stableOpenExpertMockBankFixtureUuid,
  validateOpenExpertMockBankProductionFixture,
} from '../scripts/seed-production-openexpert-mock-bank.mjs'

test('production fixture keeps the requested clients and a stable case id', () => {
  const summary = validateOpenExpertMockBankProductionFixture()
  assert.deepEqual(summary.clientEmails, [
    'koonradstraszewski@gmail.com',
    'michal@drozdzynski.pkl',
  ])
  assert.equal(summary.caseId, '7a2b2709-e2a2-5290-88e3-384ab19e2419')
  assert.equal(openExpertMockBankProductionFixture.clients.filter(client => client.isPrimary).length, 1)
  assert.equal(
    stableOpenExpertMockBankFixtureUuid('case'),
    openExpertMockBankProductionFixtureIds.caseId,
  )
})

test('production seed uses the canonical application snapshot function', async () => {
  const source = await readFile(
    new URL('../scripts/seed-production-openexpert-mock-bank.mjs', import.meta.url),
    'utf8',
  )
  assert.match(source, /FROM public\.create_crm_case_bank_application_snapshot\(/u)
  assert.doesNotMatch(source, /INSERT INTO public\.crm_item_submissions/u)
  assert.doesNotMatch(source, /INSERT INTO public\.crm_case_bank_applications/u)
  assert.doesNotMatch(source, /INSERT INTO public\.crm_mortgage_application_processes/u)
  assert.match(source, /snapshot_status = 'complete'/u)
  assert.match(source, /blocked_missing_email/u)
})

test('production runner orders the mock migrations before the guarded seed', async () => {
  const [migrator, runner] = await Promise.all([
    readFile(new URL('../scripts/migrate-production-knowledge-release.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/run-production-seeds.mjs', import.meta.url), 'utf8'),
  ])
  assert.ok(migrator.indexOf("'0057_email_sent_crm_activities.sql'")
    < migrator.indexOf("'0058_openexpert_mock_bank.sql'"))
  assert.match(migrator, /GRANT openexpert_service TO openexpert_owner/u)
  assert.match(runner, /'mock-bank-and-bank-files'/u)
  assert.match(runner, /SEED_OPENEXPERT_PRODUCTION_MOCK_BANK/u)
})
