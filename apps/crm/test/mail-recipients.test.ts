import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isValidMailRecipient,
  mailRecipientInitials,
  serializeMailRecipients,
  splitMailRecipients,
  uniqueMailRecipients,
} from '../app/utils/mail-recipients.ts'

test('splits pasted recipients by commas, semicolons and new lines', () => {
  assert.deepEqual(
    splitMailRecipients('anna@example.com; jan@example.com,\nola@example.com'),
    ['anna@example.com', 'jan@example.com', 'ola@example.com'],
  )
})

test('deduplicates recipients case-insensitively while preserving their first spelling', () => {
  assert.deepEqual(
    uniqueMailRecipients(['Anna@Example.com', 'anna@example.com', 'jan@example.com']),
    ['Anna@Example.com', 'jan@example.com'],
  )
  assert.equal(
    serializeMailRecipients(['Anna@Example.com', 'anna@example.com', 'jan@example.com']),
    'Anna@Example.com, jan@example.com',
  )
})

test('validates complete addresses but keeps partial values available to the form error', () => {
  assert.equal(isValidMailRecipient('michal@example.com'), true)
  assert.equal(isValidMailRecipient('michal@a'), false)
  assert.equal(isValidMailRecipient('Michał Nowak <michal@example.com>'), false)
})

test('builds avatar initials from a name and falls back to the email local part', () => {
  assert.equal(mailRecipientInitials('Anna Kowalska', 'anna@example.com'), 'AK')
  assert.equal(mailRecipientInitials(null, 'michal.nowak@example.com'), 'MN')
  assert.equal(mailRecipientInitials(null, 'biuro@example.com'), 'BI')
})
