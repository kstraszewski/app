import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mailContextMatchedEmails,
  mailContextSearchPlan,
  mailContextSearchQuery,
  mailContextThreadKeyHash,
  normalizeMailContextEmails,
} from '../server/utils/mail-context-core.ts'
import type { MailThreadSummary } from '../shared/types/mail.ts'

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
})

test('provider-neutral Gmail key is stable and connection-secret independent', () => {
  const first = mailContextThreadKeyHash('google', 'thread_123', 'secret-a')
  const second = mailContextThreadKeyHash('google', 'thread_123', 'secret-b')
  assert.equal(first, second)
  assert.match(first, /^[0-9a-f]{64}$/u)
  assert.notEqual(first, mailContextThreadKeyHash('google', 'thread_456', 'secret-a'))
})
