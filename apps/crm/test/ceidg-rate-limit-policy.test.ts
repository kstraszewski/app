import assert from 'node:assert/strict'
import test from 'node:test'

import { ceidgRateLimitBucketMaxima } from '../shared/utils/ceidg-rate-limit-policy.ts'

test('keeps the anonymous CEIDG limiter within the shared limiter contract', () => {
  assert.deepEqual(ceidgRateLimitBucketMaxima('anonymous', 100_000), {
    pairMax: 10_000,
    identifierMax: 10_000,
    ipMax: 10_000,
  })
  assert.deepEqual(ceidgRateLimitBucketMaxima('anonymous', 10), {
    pairMax: 10,
    identifierMax: 10_000,
    ipMax: 10,
  })
})

test('bounds authenticated and global CEIDG buckets', () => {
  assert.deepEqual(ceidgRateLimitBucketMaxima('user-id', 30), {
    pairMax: 30,
    identifierMax: 30,
    ipMax: 120,
  })
  assert.deepEqual(ceidgRateLimitBucketMaxima('shared-token', 20_000), {
    pairMax: 10_000,
    identifierMax: 10_000,
    ipMax: 10_000,
  })
})
