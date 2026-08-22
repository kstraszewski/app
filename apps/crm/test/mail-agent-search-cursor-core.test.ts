import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mailAgentSearchBinding,
  sealMailAgentSearchCursor,
  unsealMailAgentSearchCursor,
} from '../server/utils/mail-agent-search-cursor-core.ts'

const secret = 'test-agent-mail-search-cursor-secret-with-enough-entropy'
const now = Date.UTC(2026, 7, 22, 12)
const connectionId = '11111111-1111-4111-8111-111111111111'

test('search cursor is bound to criteria, secret, expiry and provider sources', () => {
  const binding = mailAgentSearchBinding({
    scope: { type: 'case', id: '22222222-2222-4222-8222-222222222222' },
    folder: 'all',
  })
  const state = {
    sources: [
      { connectionId, folder: 'INBOX' as const, pageToken: 'provider-page-2', pageSize: 3, processedMessageCount: 997 },
      { connectionId, folder: 'SENT' as const, pageToken: 'provider-sent-page-2', pageSize: 3, processedMessageCount: 21 },
    ],
    partialFailureCount: 1,
    omittedLinkedThreadCount: 2,
    omittedResultCount: 3,
    limitations: ['imap_search_window' as const, 'microsoft_search_result_limit' as const],
  }
  const cursor = sealMailAgentSearchCursor(binding, state, secret, now)
  assert.ok(cursor)
  assert.deepEqual(unsealMailAgentSearchCursor(cursor, binding, secret, now + 1), state)
  assert.throws(
    () => unsealMailAgentSearchCursor(
      cursor,
      mailAgentSearchBinding({ folder: 'inbox' }),
      secret,
      now + 1,
    ),
    /nieprawidłowa albo wygasła/u,
  )
  assert.throws(
    () => unsealMailAgentSearchCursor(cursor, binding, `${secret}-wrong`, now + 1),
    /nieprawidłowa albo wygasła/u,
  )
  assert.throws(
    () => unsealMailAgentSearchCursor(cursor, binding, secret, now + 60 * 60 * 1_000),
    /nieprawidłowa albo wygasła/u,
  )
})

test('search cursor rejects duplicate sources and omits an oversized continuation', () => {
  const binding = mailAgentSearchBinding({ query: 'test' })
  const emptyCarry = {
    partialFailureCount: 0,
    omittedLinkedThreadCount: 0,
    omittedResultCount: 0,
    limitations: [],
  }
  assert.throws(() => sealMailAgentSearchCursor(binding, {
    ...emptyCarry,
    sources: [
      { connectionId, folder: 'INBOX', pageToken: 'one', pageSize: 2, processedMessageCount: 2 },
      { connectionId, folder: 'INBOX', pageToken: 'two', pageSize: 2, processedMessageCount: 4 },
    ],
  }, secret, now), /nieprawidłowa albo wygasła/u)

  assert.throws(() => sealMailAgentSearchCursor(binding, {
    ...emptyCarry,
    sources: [{ connectionId, folder: 'INBOX', pageToken: 'one', pageSize: 21, processedMessageCount: 0 }],
  }, secret, now), /nieprawidłowa albo wygasła/u)

  assert.equal(sealMailAgentSearchCursor(binding, {
    ...emptyCarry,
    sources: Array.from({ length: 5 }, (_, index) => ({
      connectionId: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      folder: 'INBOX' as const,
      pageToken: 'x'.repeat(6_000),
      pageSize: 1,
      processedMessageCount: index,
    })),
  }, secret, now), null)
})
