import assert from 'node:assert/strict'
import test from 'node:test'
import { microsoftMailSearchResultLimitReached } from '../server/utils/mail-agent-search-coverage-core.ts'

test('reports the Microsoft Graph search boundary without false positives below it', () => {
  assert.equal(microsoftMailSearchResultLimitReached({
    usesMicrosoftSearch: true,
    processedMessageCount: 980,
    pageMessageCount: 19,
    hasNextPage: false,
  }), false)
  assert.equal(microsoftMailSearchResultLimitReached({
    usesMicrosoftSearch: true,
    processedMessageCount: 980,
    pageMessageCount: 20,
    hasNextPage: false,
  }), true)
  assert.equal(microsoftMailSearchResultLimitReached({
    usesMicrosoftSearch: true,
    processedMessageCount: 1_000,
    pageMessageCount: 0,
    hasNextPage: true,
  }), false)
  assert.equal(microsoftMailSearchResultLimitReached({
    usesMicrosoftSearch: false,
    processedMessageCount: 1_000,
    pageMessageCount: undefined,
    hasNextPage: false,
  }), false)
})

test('fails coverage closed when Microsoft page cardinality is unavailable', () => {
  assert.equal(microsoftMailSearchResultLimitReached({
    usesMicrosoftSearch: true,
    processedMessageCount: 0,
    pageMessageCount: undefined,
    hasNextPage: false,
  }), true)
})
