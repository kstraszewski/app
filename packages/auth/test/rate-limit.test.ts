import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pool } from 'pg'

import {
  consumeOpenExpertAuthRateLimit,
  createOpenExpertBetterAuthRateLimitStorage,
  createOpenExpertAuthRateLimitBuckets,
} from '../src/rate-limit.ts'

const KEY_SECRET = 'rate-limit-test-secret-with-at-least-32-bytes'

class FakeRateLimitPool {
  readonly counters = new Map<string, { count: number, lastRequest: number }>()

  async query(_query: string, values: unknown[] = []) {
    if (values.length === 2) return { rows: [], rowCount: 0 }

    const key = String(values[1])
    const now = Number(values[2])
    const windowMs = Number(values[3])
    const maximum = Number(values[4])
    const current = this.counters.get(key)
    const next = !current || now - current.lastRequest >= windowMs
      ? { count: 1, lastRequest: now }
      : {
          count: Math.min(current.count + 1, maximum + 1),
          lastRequest: current.lastRequest,
        }
    this.counters.set(key, next)
    return {
      rows: [{ count: next.count, last_request: String(next.lastRequest) }],
      rowCount: 1,
    }
  }
}

test('auth rate-limit keys cover IP, identifier, and their pair without plaintext PII', () => {
  const buckets = createOpenExpertAuthRateLimitBuckets({
    keySecret: KEY_SECRET,
    scope: 'crm:magic-link',
    ipAddress: '203.0.113.10',
    identifier: 'person@example.com',
  })

  assert.equal(buckets.length, 3)
  assert.deepEqual(buckets.map(bucket => bucket.max), [20, 5, 5])
  assert.ok(buckets.every(bucket => bucket.windowMs === 60_000))
  assert.ok(buckets.every(bucket => !bucket.key.includes('203.0.113.10')))
  assert.ok(buckets.every(bucket => !bucket.key.includes('person@example.com')))
  assert.equal(new Set(buckets.map(bucket => bucket.key)).size, 3)
})

test('auth rate-limit keys are normalized, deterministic, and scope separated', () => {
  const input = {
    keySecret: KEY_SECRET,
    scope: 'crm:phone-otp',
    ipAddress: ' 203.0.113.10 ',
    identifier: ' +48123456789 ',
  }
  const first = createOpenExpertAuthRateLimitBuckets(input)
  const normalized = createOpenExpertAuthRateLimitBuckets({
    ...input,
    ipAddress: '203.0.113.10',
    identifier: '+48123456789',
  })
  const otherScope = createOpenExpertAuthRateLimitBuckets({
    ...input,
    scope: 'crm:magic-link',
  })

  assert.deepEqual(first, normalized)
  assert.notDeepEqual(
    first.map(bucket => bucket.key),
    otherScope.map(bucket => bucket.key),
  )
  const otherSecret = createOpenExpertAuthRateLimitBuckets({
    ...input,
    keySecret: 'another-rate-limit-secret-with-32-plus-bytes',
  })
  assert.notDeepEqual(
    first.map(bucket => bucket.key),
    otherSecret.map(bucket => bucket.key),
  )
})

test('auth rate-limit bucket configuration rejects unsafe or unbounded values', () => {
  assert.throws(() => createOpenExpertAuthRateLimitBuckets({
    keySecret: 'too-short',
    scope: 'crm:magic-link',
    ipAddress: '127.0.0.1',
    identifier: 'person@example.com',
  }), /secret/u)

  assert.throws(() => createOpenExpertAuthRateLimitBuckets({
    keySecret: KEY_SECRET,
    scope: 'crm magic link',
    ipAddress: '127.0.0.1',
    identifier: 'person@example.com',
  }), /scope/u)

  assert.throws(() => createOpenExpertAuthRateLimitBuckets({
    keySecret: KEY_SECRET,
    scope: 'crm:magic-link',
    ipAddress: '127.0.0.1',
    identifier: 'person@example.com',
    windowMs: 0,
  }), /window/u)
})

test('database limiter blocks identifier flooding across different IP addresses', async () => {
  const database = new FakeRateLimitPool()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const decision = await consumeOpenExpertAuthRateLimit({
      pool: database as unknown as Pool,
      databaseSchema: 'identity',
      keySecret: KEY_SECRET,
      scope: 'crm:magic-link',
      ipAddress: `203.0.113.${attempt + 1}`,
      identifier: 'target@example.com',
    })
    assert.equal(decision.allowed, true)
  }

  const denied = await consumeOpenExpertAuthRateLimit({
    pool: database as unknown as Pool,
    databaseSchema: 'identity',
    keySecret: KEY_SECRET,
    scope: 'crm:magic-link',
    ipAddress: '198.51.100.200',
    identifier: 'target@example.com',
  })
  assert.equal(denied.allowed, false)
  assert.ok(denied.retryAfterSeconds >= 1 && denied.retryAfterSeconds <= 60)
})

test('database limiter blocks one IP rotating through identifiers', async () => {
  const database = new FakeRateLimitPool()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const decision = await consumeOpenExpertAuthRateLimit({
      pool: database as unknown as Pool,
      databaseSchema: 'identity',
      keySecret: KEY_SECRET,
      scope: 'client:magic-link',
      ipAddress: '203.0.113.50',
      identifier: `person-${attempt}@example.com`,
    })
    assert.equal(decision.allowed, true)
  }

  const recordsBeforeDeniedRequest = database.counters.size
  const denied = await consumeOpenExpertAuthRateLimit({
    pool: database as unknown as Pool,
    databaseSchema: 'identity',
    keySecret: KEY_SECRET,
    scope: 'client:magic-link',
    ipAddress: '203.0.113.50',
    identifier: 'another-person@example.com',
  })
  assert.equal(denied.allowed, false)
  assert.equal(database.counters.size, recordsBeforeDeniedRequest)
})

test('Better Auth storage normalizes bigint strings for bounded retry-after values', async () => {
  const database = new FakeRateLimitPool()
  const storage = createOpenExpertBetterAuthRateLimitStorage({
    pool: database as unknown as Pool,
    databaseSchema: 'identity',
  })

  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.deepEqual(await storage.consume!('203.0.113.10|/sign-in/email', {
      window: 10,
      max: 3,
    }), { allowed: true, retryAfter: null })
  }
  const denied = await storage.consume!('203.0.113.10|/sign-in/email', {
    window: 10,
    max: 3,
  })
  assert.equal(denied.allowed, false)
  assert.ok((denied.retryAfter ?? 0) >= 1 && (denied.retryAfter ?? 0) <= 10)
})

test('Better Auth storage degrades safely while the rate-limit migration is pending', async () => {
  const missingTablePool = {
    async query() {
      throw Object.assign(new Error('relation does not exist'), { code: '42P01' })
    },
  } as unknown as Pool
  const storage = createOpenExpertBetterAuthRateLimitStorage({
    pool: missingTablePool,
    databaseSchema: 'identity',
  })
  const key = `migration-fallback-${Date.now()}`

  assert.deepEqual(await storage.consume!(key, { window: 60, max: 1 }), {
    allowed: true,
    retryAfter: null,
  })
  const denied = await storage.consume!(key, { window: 60, max: 1 })
  assert.equal(denied.allowed, false)
  assert.ok((denied.retryAfter ?? 0) >= 1)
})
