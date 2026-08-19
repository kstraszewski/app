import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { MailContextScope } from '../shared/types/mail.ts'
import {
  additionalMailRecipientClientScopes,
  mailSendRequestCrmContext,
  unambiguousMailRecipientClientScopes,
} from '../server/utils/mail-crm-activities.ts'

const clientA = '44444444-4444-4444-8444-444444444444'
const clientB = '55555555-5555-4555-8555-555555555555'
const clientC = '66666666-6666-4666-8666-666666666666'
const caseId = '77777777-7777-4777-8777-777777777777'

test('stores canonical CRM identifiers without recipient or message content', () => {
  const contexts: MailContextScope[] = [
    { type: 'client', id: clientB },
    { type: 'case', id: caseId },
    { type: 'client', id: clientA },
    { type: 'client', id: clientB },
  ]

  assert.deepEqual(mailSendRequestCrmContext(contexts), {
    crmClientIds: [clientA, clientB],
    crmCaseId: caseId,
  })
  assert.deepEqual(mailSendRequestCrmContext([]), {
    crmClientIds: [],
    crmCaseId: null,
  })
})

test('maps exact unique recipient addresses and ignores ambiguous matches', () => {
  const scopes = unambiguousMailRecipientClientScopes(
    [' UNIQUE@example.com ', 'shared@example.com', 'person@example.com'],
    [
      { id: clientA, primary_email_normalized: 'unique@example.com' },
      { id: clientA, primary_email_normalized: 'shared@example.com' },
      { id: clientB, primary_email_normalized: 'shared@example.com' },
    ],
    [
      { client_id: clientC, email_normalized: 'person@example.com' },
      { client_id: clientB, email_normalized: 'not-a-recipient@example.com' },
    ],
    new Set([clientA, clientB, clientC]),
  )

  assert.deepEqual(scopes, [
    { type: 'client', id: clientA },
    { type: 'client', id: clientC },
  ])
})

test('does not map clients excluded by the eligibility check', () => {
  assert.deepEqual(
    unambiguousMailRecipientClientScopes(
      ['archived@example.com'],
      [{ id: clientA, primary_email_normalized: 'archived@example.com' }],
      [],
      new Set(),
    ),
    [],
  )
})

test('automatic matching never rejects or partially audits a bulk send', () => {
  const matched = Array.from({ length: 11 }, (_, index) => ({
    type: 'client' as const,
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
  }))
  assert.deepEqual(additionalMailRecipientClientScopes([], matched), [])
  assert.deepEqual(
    additionalMailRecipientClientScopes(
      [{ type: 'client', id: clientA }],
      [{ type: 'client', id: clientA }, { type: 'client', id: clientB }],
    ),
    [{ type: 'client', id: clientB }],
  )
  assert.deepEqual(
    additionalMailRecipientClientScopes(
      [{ type: 'case', id: caseId }],
      [{ type: 'client', id: clientA }],
    ),
    [],
  )
})

test('resolves To, Cc and Bcc on the server before provider delivery', () => {
  const route = readFileSync(
    new URL('../server/api/org/[organizationSlug]/mail/messages.post.ts', import.meta.url),
    'utf8',
  )
  const resolver = route.indexOf(
    'resolveMailRecipientClientScopes(session, [...to, ...cc, ...bcc])',
  )
  const boundedInference = route.indexOf('additionalMailRecipientClientScopes(', resolver)
  const claim = route.indexOf('claimRateLimitedMailSendRequest(', boundedInference)
  const providerSend = route.indexOf('await sendProviderMessage(', claim)

  assert.ok(resolver >= 0)
  assert.ok(boundedInference > resolver)
  assert.ok(claim > boundedInference)
  assert.ok(providerSend > claim)
  assert.match(route, /\? \{ contexts: contextInput\.scopes \}/u)
  assert.match(route, /const durableMailContexts = mailSendRequestCrmScopes\(claim\.row\)/u)
  assert.doesNotMatch(route, /recordMailSentContextsBestEffort/u)
})

test('persists CRM context in the durable idempotency row', () => {
  const source = readFileSync(
    new URL('../server/utils/mail-send-requests.ts', import.meta.url),
    'utf8',
  )

  assert.match(source, /crm_client_ids: crmContext\.crmClientIds/u)
  assert.match(source, /crm_case_id: crmContext\.crmCaseId/u)
  assert.match(source, /crm_context_resolved: true/u)
  assert.match(source, /if \(row\.crm_context_resolved === true\) return row/u)
  assert.match(source, /ensureMailSendRequestCrmContext/u)
  assert.match(source, /Backfilling it exactly once also repairs a missing activity/u)
})

test('creates email_sent atomically with the durable sent transition', () => {
  const migration = readFileSync(
    new URL('../../../packages/database/postgres/migrations/0057_email_sent_crm_activities.sql', import.meta.url),
    'utf8',
  )

  assert.match(migration, /ADD COLUMN crm_client_ids uuid\[\]/u)
  assert.match(migration, /ADD COLUMN crm_context_resolved boolean DEFAULT false NOT NULL/u)
  assert.match(migration, /ADD COLUMN mail_send_request_id uuid/u)
  assert.match(migration, /AFTER UPDATE OF status, crm_client_ids, crm_case_id/u)
  assert.match(migration, /WHEN \(NEW\.status = 'sent'::text\)/u)
  assert.match(migration, /'email_sent'::text/u)
  assert.match(migration, /ON CONFLICT DO NOTHING/u)
  assert.match(migration, /NULLS NOT DISTINCT/u)
  assert.match(migration, /mail_send_request_crm_context_immutable/u)
  assert.match(migration, /AND activity_type <> 'email_sent'::text/u)
  assert.doesNotMatch(migration, /ON DELETE SET NULL/u)
})

test('database activity contains only a generic privacy-minimal description', () => {
  const migration = readFileSync(
    new URL('../../../packages/database/postgres/migrations/0057_email_sent_crm_activities.sql', import.meta.url),
    'utf8',
  )
  const triggerBody = migration.slice(
    migration.indexOf('CREATE FUNCTION private.record_mail_sent_crm_activities()'),
  )

  assert.match(triggerBody, /'Wysłano wiadomość e-mail'::text/u)
  assert.match(triggerBody, /'Wiadomość została wysłana z klienta pocztowego\.'::text/u)
  assert.doesNotMatch(triggerBody, /NEW\.(subject|body|recipients|attachments)/u)
})

test('keeps the first attempt context frozen during ambiguous retries', () => {
  const composer = readFileSync(
    new URL('../app/components/mail/MailComposerSlideover.vue', import.meta.url),
    'utf8',
  )
  const unchanged = composer.indexOf(
    'fingerprints.content === lastAttemptContentFingerprint.value',
  )
  const frozen = composer.indexOf('recoveringUnchangedSend && lastAttemptContexts.value')

  assert.ok(unchanged >= 0)
  assert.ok(frozen > unchanged)
  assert.match(composer, /body\.append\('contexts', JSON\.stringify\(sendContexts\)\)/u)
})

test('refreshes open client and case histories after contextual sends', () => {
  const contextualButton = readFileSync(
    new URL('../app/components/mail/MailContextualComposeButton.vue', import.meta.url),
    'utf8',
  )
  const workspace = readFileSync(
    new URL('../app/components/mail/MailWorkspace.vue', import.meta.url),
    'utf8',
  )
  const clientPage = readFileSync(
    new URL('../app/pages/org/[organizationSlug]/clients/[id].vue', import.meta.url),
    'utf8',
  )
  const casePage = readFileSync(
    new URL('../app/pages/org/[organizationSlug]/cases/[id].vue', import.meta.url),
    'utf8',
  )

  assert.match(contextualButton, /emit\('sent', result\)/u)
  assert.match(workspace, /emit\('sent', result\)/u)
  assert.equal(clientPage.match(/@sent="refresh\(\)"/gu)?.length, 2)
  assert.equal(casePage.match(/@sent="refresh\(\)"/gu)?.length, 1)
  assert.match(clientPage, /email_sent: 'Wysłanie wiadomości e-mail'/u)
})
