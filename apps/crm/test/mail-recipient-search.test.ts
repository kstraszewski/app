import assert from 'node:assert/strict'
import test from 'node:test'
import type { MailThreadSummary } from '../shared/types/mail.ts'
import {
  crmMailRecipientSuggestions,
  providerMailRecipientSuggestions,
} from '../server/utils/mail-recipient-search.ts'
import {
  BoundedMailRecipientSearchCache,
  mailRecipientSearchCacheKey,
} from '../server/utils/mail-recipient-search-cache.ts'

test('recipient search exposes only the CRM identity fields needed by composer', () => {
  const suggestions = crmMailRecipientSuggestions([{
    id: 'client-1',
    display_name: 'Anna Kowalska',
    primary_email: 'anna@example.com',
    notes: 'private note',
    primary_phone: '+48 123 456 789',
    tags: ['private-tag'],
    primaryPerson: {
      id: 'person-1',
      display_name: 'Anna Kowalska',
      email: 'anna@example.com',
      phone: '+48 123 456 789',
      pesel_last4: '1234',
    },
  }], 'anna', 8)

  assert.deepEqual(suggestions, [{
    source: 'crm',
    email: 'anna@example.com',
    label: 'Anna Kowalska',
    clientId: 'client-1',
    clientLabel: 'Anna Kowalska',
    personId: 'person-1',
  }])
  assert.equal('notes' in suggestions[0]!, false)
  assert.equal('phone' in suggestions[0]!, false)
})

test('recipient search ignores CRM rows matched only by unrelated notes', () => {
  const suggestions = crmMailRecipientSuggestions([{
    id: 'client-1',
    display_name: 'Jan Kowalski',
    primary_email: 'jan@example.com',
    notes: 'Wspólna sprawa z Anną',
  }], 'anna', 8)

  assert.deepEqual(suggestions, [])
})

test('recipient search returns a matching secondary person before primary contact', () => {
  const suggestions = crmMailRecipientSuggestions([{
    id: 'client-1',
    display_name: 'Państwo Kowalscy',
    primary_email: 'jan@example.com',
    matchedPerson: {
      id: 'person-2',
      display_name: 'Anna Kowalska',
      email: 'anna@example.com',
    },
    primaryPerson: {
      id: 'person-1',
      display_name: 'Jan Kowalski',
      email: 'jan@example.com',
    },
  }], 'anna', 8)

  assert.deepEqual(suggestions.map(item => item.email), ['anna@example.com'])
})

test('provider recipient search filters and deduplicates mailbox participants', () => {
  const thread = (participants: MailThreadSummary['participants']): MailThreadSummary => ({
    id: Math.random().toString(),
    messageCount: 1,
    participants,
    participantsLabel: '',
    subject: '',
    snippet: '',
    latestAt: null,
    unread: false,
    starred: false,
    important: false,
    draft: false,
    hasAttachments: false,
  })
  const suggestions = providerMailRecipientSuggestions([
    thread([
      { name: 'Anna Nowak', email: 'Anna@bank.example', label: 'Anna Nowak' },
      { name: 'Ekspert', email: 'expert@example.com', label: 'Ekspert' },
      { name: 'Piotr', email: 'piotr@bank.example', label: 'Piotr' },
    ]),
    thread([
      { name: '', email: 'anna@bank.example', label: 'anna@bank.example' },
    ]),
  ], 'anna', 'connection-1', 8, 'expert@example.com')

  assert.deepEqual(suggestions, [{
    source: 'provider',
    email: 'Anna@bank.example',
    label: 'Anna Nowak',
    providerId: 'connection-1:anna@bank.example',
  }])
})

test('provider recipient search always excludes the connected account', () => {
  const suggestions = providerMailRecipientSuggestions([{
    id: 'thread-1',
    messageCount: 1,
    participants: [
      { name: 'Anna Ekspert', email: 'ANNA@openexpert.example', label: 'Anna Ekspert' },
    ],
    participantsLabel: '',
    subject: '',
    snippet: '',
    latestAt: null,
    unread: false,
    starred: false,
    important: false,
    draft: false,
    hasAttachments: false,
  }], 'anna', 'connection-1', 8, 'anna@openexpert.example')

  assert.deepEqual(suggestions, [])
})

test('recipient provider cache coalesces requests and expires entries', async () => {
  let now = 1_000
  let calls = 0
  const cache = new BoundedMailRecipientSearchCache<string>(100, 2, () => now)
  let resolveFirst!: (value: string) => void
  const firstLoader = () => {
    calls += 1
    return new Promise<string>((resolve) => { resolveFirst = resolve })
  }

  const first = cache.getOrLoad('anna', firstLoader)
  const coalesced = cache.getOrLoad('anna', firstLoader)
  assert.equal(calls, 1)
  resolveFirst('result')
  assert.equal(await first, 'result')
  assert.equal(await coalesced, 'result')
  assert.equal(await cache.getOrLoad('anna', async () => 'unused'), 'result')

  now += 101
  assert.equal(await cache.getOrLoad('anna', async () => {
    calls += 1
    return 'fresh'
  }), 'fresh')
  assert.equal(calls, 2)
})

test('recipient provider cache is bounded and tenant keys are isolated', async () => {
  const cache = new BoundedMailRecipientSearchCache<string>(1_000, 2)
  await cache.getOrLoad('first', async () => 'one')
  await cache.getOrLoad('second', async () => 'two')
  await cache.getOrLoad('third', async () => 'three')
  let firstReloads = 0
  assert.equal(await cache.getOrLoad('first', async () => {
    firstReloads += 1
    return 'one-again'
  }), 'one-again')
  assert.equal(firstReloads, 1)

  const base = {
    organizationId: 'organization-1',
    ownerUserId: 'owner-1',
    connectionId: 'connection-1',
    query: '  ANNA   Kowalska ',
    limit: 8,
  }
  assert.equal(
    mailRecipientSearchCacheKey(base),
    mailRecipientSearchCacheKey({ ...base, query: 'anna kowalska' }),
  )
  assert.notEqual(
    mailRecipientSearchCacheKey(base),
    mailRecipientSearchCacheKey({ ...base, ownerUserId: 'owner-2' }),
  )
})
