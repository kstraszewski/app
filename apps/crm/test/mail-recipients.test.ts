import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isValidMailRecipient,
  isValidMailRecipientList,
  mailRecipientKey,
  mailRecipientInitials,
  mailRecipientMatchesSearch,
  mailRecipientSelectionKey,
  orderMailRecipientSuggestions,
  resolveMailRecipientSelections,
  resolveUnambiguousMailRecipientSelection,
  serializeMailRecipients,
  splitMailRecipients,
  uniqueMailRecipientSelections,
  uniqueMailRecipientSuggestions,
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

test('normalizes recipient keys for case-insensitive identity matching', () => {
  assert.equal(mailRecipientKey('  Anna@Example.com '), 'anna@example.com')
})

test('matches mailbox suggestions by name, client label and email', () => {
  const recipient = {
    email: 'anna.kowalska@example.com',
    label: 'Anna Kowalska',
    clientLabel: 'Państwo Kowalscy',
  }

  assert.equal(mailRecipientMatchesSearch(recipient, 'anna'), true)
  assert.equal(mailRecipientMatchesSearch(recipient, 'PANSTWO'), true)
  assert.equal(mailRecipientMatchesSearch(recipient, '@example.com'), true)
  assert.equal(mailRecipientMatchesSearch(recipient, 'nowak'), false)
})

test('prefers CRM identities over provider contacts and manual addresses', () => {
  assert.deepEqual(
    uniqueMailRecipientSelections([
      { email: 'Anna@Example.com', label: 'Anna@Example.com', source: 'manual' },
      { email: 'anna@example.com', label: 'Anna z Google', source: 'provider' },
      {
        email: 'ANNA@example.com',
        label: 'Anna Kowalska',
        source: 'crm',
        clientId: 'client-1',
        personId: 'person-1',
      },
    ]),
    [{
      email: 'ANNA@example.com',
      label: 'Anna Kowalska',
      source: 'crm',
      clientId: 'client-1',
      personId: 'person-1',
    }],
  )
})

test('keeps CRM suggestions with a shared address as separate selectable identities', () => {
  const firstClient = {
    email: 'wspolny@example.com',
    label: 'Anna Kowalska',
    source: 'crm' as const,
    clientId: 'client-1',
  }
  const secondClient = {
    email: 'WSPOLNY@example.com',
    label: 'Jan Kowalski',
    source: 'crm' as const,
    clientId: 'client-2',
  }

  assert.notEqual(
    mailRecipientSelectionKey(firstClient),
    mailRecipientSelectionKey(secondClient),
  )
  assert.deepEqual(
    uniqueMailRecipientSuggestions([firstClient, secondClient, firstClient]),
    [firstClient, secondClient],
  )
})

test('orders CRM suggestions before provider contacts without merging their shared address', () => {
  const provider = {
    email: 'anna@example.com',
    label: 'Anna z Google',
    source: 'provider' as const,
    providerId: 'people/123',
  }
  const crm = {
    email: 'anna@example.com',
    label: 'Anna Kowalska',
    source: 'crm' as const,
    clientId: 'client-1',
  }

  assert.deepEqual(orderMailRecipientSuggestions([provider, crm]), [crm, provider])
})

test('does not silently resolve two CRM clients sharing the same email', () => {
  const candidates = [
    {
      email: 'wspolny@example.com',
      label: 'Anna Kowalska',
      source: 'crm' as const,
      clientId: 'client-1',
    },
    {
      email: 'wspolny@example.com',
      label: 'Jan Kowalski',
      source: 'crm' as const,
      clientId: 'client-2',
    },
  ]

  assert.equal(
    resolveUnambiguousMailRecipientSelection('wspolny@example.com', candidates),
    undefined,
  )
  assert.deepEqual(
    resolveMailRecipientSelections('wspolny@example.com', candidates),
    [{
      email: 'wspolny@example.com',
      label: 'wspolny@example.com',
      source: 'manual',
    }],
  )
  assert.deepEqual(
    resolveMailRecipientSelections('wspolny@example.com', [candidates[1]!]),
    [candidates[1]],
  )
})

test('resolves the string recipient model into structured selections', () => {
  assert.deepEqual(
    resolveMailRecipientSelections(
      ['anna@example.com', 'biuro@example.com'],
      [{
        email: 'Anna@Example.com',
        label: 'Anna Kowalska',
        source: 'crm',
        clientId: 'client-1',
        clientLabel: 'Kowalscy',
      }],
    ),
    [
      {
        email: 'Anna@Example.com',
        label: 'Anna Kowalska',
        source: 'crm',
        clientId: 'client-1',
        clientLabel: 'Kowalscy',
      },
      {
        email: 'biuro@example.com',
        label: 'biuro@example.com',
        source: 'manual',
      },
    ],
  )
})

test('validates complete addresses but keeps partial values available to the form error', () => {
  assert.equal(isValidMailRecipient('michal@example.com'), true)
  assert.equal(isValidMailRecipient('michal@a'), false)
  assert.equal(isValidMailRecipient('Michał Nowak <michal@example.com>'), false)
})

test('offers manual creation only for complete recipient lists', () => {
  assert.equal(isValidMailRecipientList('anna'), false)
  assert.equal(isValidMailRecipientList('anna@example.com'), true)
  assert.equal(isValidMailRecipientList('anna@example.com; jan@example.com'), true)
  assert.equal(isValidMailRecipientList('anna@example.com; jan'), false)
})

test('builds avatar initials from a name and falls back to the email local part', () => {
  assert.equal(mailRecipientInitials('Anna Kowalska', 'anna@example.com'), 'AK')
  assert.equal(mailRecipientInitials(null, 'michal.nowak@example.com'), 'MN')
  assert.equal(mailRecipientInitials(null, 'biuro@example.com'), 'BI')
})
