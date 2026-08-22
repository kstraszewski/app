import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mailContextMatchedEmails,
  mailContextSearchPlan,
  mailContextSearchQuery,
  mailContextThreadKeyHash,
  normalizeMailContextEmails,
  parseMailContextScopes,
  unrelatedMailContextClientIds,
} from '../server/utils/mail-context-core.ts'
import {
  groupMailComposerContextCases,
  parseMailComposerContextClientIds,
} from '../server/utils/mail-composer-context.ts'
import type { MailThreadSummary } from '../shared/types/mail.ts'
import { withMailThreadBlindParticipants } from '../server/utils/mail-message-blind-recipients.ts'

const CASE_ID = '11111111-1111-4111-8111-111111111111'
const CLIENT_A_ID = '22222222-2222-4222-8222-222222222222'
const CLIENT_B_ID = '33333333-3333-4333-8333-333333333333'

test('composer context client IDs are normalized, deduplicated and bounded', () => {
  assert.deepEqual(
    parseMailComposerContextClientIds([CLIENT_A_ID.toUpperCase(), CLIENT_A_ID, CLIENT_B_ID]),
    [CLIENT_A_ID, CLIENT_B_ID],
  )
  assert.throws(() => parseMailComposerContextClientIds([]), /Nieprawidłowi klienci/u)
  assert.throws(() => parseMailComposerContextClientIds([CLIENT_A_ID, 'invalid']), /Nieprawidłowi klienci/u)
  assert.throws(() => parseMailComposerContextClientIds(Array.from(
    { length: 11 },
    (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  )), /Nieprawidłowi klienci/u)
})

test('composer context returns only minimal, deduplicated cases per client', () => {
  const olderCaseId = '44444444-4444-4444-8444-444444444444'
  const closedCaseId = '55555555-5555-4555-8555-555555555555'
  const newestCaseId = '66666666-6666-4666-8666-666666666666'
  assert.deepEqual(groupMailComposerContextCases(
    [CLIENT_A_ID, CLIENT_B_ID],
    [
      {
        id: olderCaseId,
        client_id: CLIENT_A_ID,
        title: 'Starsza sprawa',
        closed_at: null,
        updated_at: '2026-01-01T00:00:00.000Z',
        ignored_private_field: 'must not leak',
      },
    ],
    [
      { client_id: CLIENT_A_ID, case_id: newestCaseId },
      { client_id: CLIENT_A_ID, case_id: newestCaseId },
      { client_id: CLIENT_B_ID, case_id: closedCaseId },
    ],
    [
      {
        id: newestCaseId,
        title: 'Najnowsza sprawa',
        closed_at: null,
        updated_at: '2026-02-01T00:00:00.000Z',
      },
      {
        id: closedCaseId,
        title: 'Zamknięta sprawa',
        closed_at: '2026-02-02T00:00:00.000Z',
        updated_at: '2026-02-02T00:00:00.000Z',
      },
    ],
  ), [
    {
      clientId: CLIENT_A_ID,
      cases: [
        { id: newestCaseId, label: 'Najnowsza sprawa', closedAt: null },
        { id: olderCaseId, label: 'Starsza sprawa', closedAt: null },
      ],
    },
    {
      clientId: CLIENT_B_ID,
      cases: [{
        id: closedCaseId,
        label: 'Zamknięta sprawa',
        closedAt: '2026-02-02T00:00:00.000Z',
      }],
    },
  ])
})

test('send contexts are deduplicated, normalized and canonically ordered', () => {
  assert.deepEqual(parseMailContextScopes([
    { type: 'client', id: CLIENT_B_ID.toUpperCase() },
    { type: 'case', id: CASE_ID },
    { type: 'client', id: CLIENT_A_ID },
    { type: 'client', id: CLIENT_B_ID },
  ]), [
    { type: 'case', id: CASE_ID },
    { type: 'client', id: CLIENT_A_ID },
    { type: 'client', id: CLIENT_B_ID },
  ])
})

test('send contexts allow at most one case and ten unique clients', () => {
  assert.throws(() => parseMailContextScopes([
    { type: 'case', id: CASE_ID },
    { type: 'case', id: '44444444-4444-4444-8444-444444444444' },
  ]), /Nieprawidłowy kontekst poczty/u)

  assert.throws(() => parseMailContextScopes(Array.from({ length: 11 }, (_, index) => ({
    type: 'client',
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  }))), /Nieprawidłowy kontekst poczty/u)
})

test('case/client relationship accepts join-table links and the legacy primary fallback', () => {
  const scopes = parseMailContextScopes([
    { type: 'case', id: CASE_ID },
    { type: 'client', id: CLIENT_A_ID },
    { type: 'client', id: CLIENT_B_ID },
  ])
  assert.deepEqual(unrelatedMailContextClientIds(scopes, {
    linkedClientIds: [CLIENT_A_ID],
    fallbackClientId: CLIENT_B_ID,
  }), [])
  assert.deepEqual(unrelatedMailContextClientIds(scopes, {
    linkedClientIds: [CLIENT_A_ID],
  }), [CLIENT_B_ID])
  assert.deepEqual(unrelatedMailContextClientIds(
    scopes.filter(scope => scope.type === 'client'),
    { linkedClientIds: [] },
  ), [])
})

test('context emails preserve primary-first order, deduplicate and bound output', () => {
  const result = normalizeMailContextEmails([
    ' PRIMARY@Example.com ',
    'person@example.com',
    'primary@example.com',
    null,
    'invalid',
  ], 2)
  assert.deepEqual(result, {
    emails: ['primary@example.com', 'person@example.com'],
    emailCount: 2,
    truncated: false,
  })
})

test('provider search plans stay within the 500 character constraint', () => {
  const emails = Array.from({ length: 6 }, (_, index) => (
    `${String(index).repeat(64)}@${'d'.repeat(180)}.pl`
  ))
  const microsoft = mailContextSearchPlan('microsoft', emails)
  const google = mailContextSearchPlan('google', emails)

  assert.ok(microsoft.query.length <= 500)
  assert.ok(google.query.length <= 500)
  assert.ok(microsoft.emails.length >= 1)
  assert.ok(google.emails.length >= 1)
  assert.equal(microsoft.truncated, true)
  assert.equal(google.truncated, true)
  assert.match(microsoft.query, /^participants:/u)
  assert.equal(mailContextSearchQuery('microsoft', microsoft.emails), microsoft.query)
})

test('contextual search combines the customer and typed search filters', () => {
  assert.equal(
    mailContextSearchQuery('google', ['client@example.com'], 'umowa kredytowa'),
    '{client@example.com} umowa kredytowa',
  )
  assert.equal(
    mailContextSearchQuery('microsoft', ['client@example.com'], 'umowa kredytowa'),
    '(participants:client@example.com) AND (umowa kredytowa)',
  )
})

test('participant matching is normalized and exact', () => {
  const thread: MailThreadSummary = {
    id: 'thread_1',
    messageCount: 1,
    participants: [
      { name: 'A', email: 'Person@Example.com', label: 'A' },
      { name: 'B', email: 'unrelated@example.com', label: 'B' },
    ],
    participantsLabel: 'A, B',
    subject: 'Test',
    snippet: '',
    latestAt: null,
    unread: false,
    starred: false,
    important: false,
    draft: false,
    hasAttachments: false,
  }
  assert.deepEqual(
    mailContextMatchedEmails(thread, ['person@example.com', 'other@example.com']),
    ['person@example.com'],
  )
  const blindThread = withMailThreadBlindParticipants({ ...thread }, [{
    name: 'Ukryty klient',
    email: 'secret@example.com',
    label: 'Ukryty klient',
  }])
  assert.deepEqual(mailContextMatchedEmails(blindThread, ['secret@example.com']), [
    'secret@example.com',
  ])
  assert.doesNotMatch(JSON.stringify(blindThread), /secret@example\.com/u)
})

test('provider-neutral Gmail key is stable and connection-secret independent', () => {
  const first = mailContextThreadKeyHash('google', 'thread_123', 'secret-a')
  const second = mailContextThreadKeyHash('google', 'thread_123', 'secret-b')
  assert.equal(first, second)
  assert.match(first, /^[0-9a-f]{64}$/u)
  assert.notEqual(first, mailContextThreadKeyHash('google', 'thread_456', 'secret-a'))
})
