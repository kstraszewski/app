import { createHmac, randomUUID } from 'node:crypto'
import type { BetterAuthOptions } from 'better-auth'
import type { Pool } from 'pg'

const SCHEMA_PATTERN = /^[a-z_][a-z0-9_]*$/
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9:-]{0,63}$/
const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_PAIR_MAX = 5
const DEFAULT_IDENTIFIER_MAX = 5
const DEFAULT_IP_MAX = 20
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1_000
const PRUNE_BATCH_SIZE = 256
const PRUNE_INTERVAL_MS = 5 * 60 * 1_000
const FALLBACK_STORE_MAX_ENTRIES = 20_000

export interface OpenExpertAuthRateLimitBucket {
  key: string
  max: number
  windowMs: number
}

export interface OpenExpertAuthRateLimitDecision {
  allowed: boolean
  retryAfterSeconds: number
}

export interface OpenExpertAuthRateLimitInput {
  pool: Pool
  databaseSchema: string
  keySecret: string
  scope: string
  ipAddress: string
  identifier: string
  windowMs?: number
  pairMax?: number
  identifierMax?: number
  ipMax?: number
  retentionMs?: number
}

interface RateLimitRow {
  count: number | string
  last_request: number | string
}

type BetterAuthRateLimitStorage = NonNullable<
  NonNullable<BetterAuthOptions['rateLimit']>['customStorage']
>

interface MemoryRateLimitEntry {
  count: number
  lastRequest: number
  expiresAt: number
}

const memoryFallback = new Map<string, MemoryRateLimitEntry>()
const nextPruneAt = new Map<string, number>()
let missingTableWarningLogged = false

function isMissingRateLimitTable(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '42P01'
}

function warnAboutMissingRateLimitTable(): void {
  if (missingTableWarningLogged) return
  missingTableWarningLogged = true
  console.warn(
    'identity.rate_limits is not migrated yet; auth rate limiting is using a bounded per-process fallback',
  )
}

function pruneMemoryFallback(now: number): void {
  for (const [key, entry] of memoryFallback) {
    if (entry.expiresAt <= now) memoryFallback.delete(key)
  }
  while (memoryFallback.size >= FALLBACK_STORE_MAX_ENTRIES) {
    const oldestKey = memoryFallback.keys().next().value as string | undefined
    if (!oldestKey) break
    memoryFallback.delete(oldestKey)
  }
}

function consumeMemoryFallback(
  namespace: string,
  bucket: OpenExpertAuthRateLimitBucket,
  now: number,
): OpenExpertAuthRateLimitDecision {
  pruneMemoryFallback(now)
  const key = `${namespace}\0${bucket.key}`
  const existing = memoryFallback.get(key)
  if (!existing || now - existing.lastRequest >= bucket.windowMs) {
    memoryFallback.delete(key)
    memoryFallback.set(key, {
      count: 1,
      lastRequest: now,
      expiresAt: now + bucket.windowMs,
    })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  if (existing.count >= bucket.max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.lastRequest + bucket.windowMs - now) / 1_000),
      ),
    }
  }

  existing.count += 1
  return { allowed: true, retryAfterSeconds: 0 }
}

function positiveInteger(
  value: number,
  name: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} must be an integer between 1 and ${maximum}`)
  }
  return value
}

function digest(keySecret: string, parts: readonly string[]): string {
  if (Buffer.byteLength(keySecret, 'utf8') < 32) {
    throw new TypeError('Rate-limit key secret must contain at least 32 bytes')
  }
  const hash = createHmac('sha256', keySecret)
  hash.update('openexpert-auth-rate-limit-v1\0')
  for (const part of parts) {
    hash.update(String(Buffer.byteLength(part, 'utf8')))
    hash.update(':')
    hash.update(part)
    hash.update('\0')
  }
  return hash.digest('base64url')
}

/**
 * Builds non-reversible keys for all abuse dimensions. The identifier and IP
 * address never reach PostgreSQL in plaintext.
 */
export function createOpenExpertAuthRateLimitBuckets(input: {
  keySecret: string
  scope: string
  ipAddress: string
  identifier: string
  windowMs?: number
  pairMax?: number
  identifierMax?: number
  ipMax?: number
}): OpenExpertAuthRateLimitBucket[] {
  const scope = input.scope.trim().toLowerCase()
  if (!SCOPE_PATTERN.test(scope)) {
    throw new TypeError('Rate-limit scope must be a lowercase identifier')
  }

  const ipAddress = input.ipAddress.trim().toLowerCase() || 'unknown'
  const identifier = input.identifier.trim().toLowerCase() || 'invalid'
  const windowMs = positiveInteger(
    input.windowMs ?? DEFAULT_WINDOW_MS,
    'Rate-limit window',
    60 * 60 * 1_000,
  )
  const pairMax = positiveInteger(
    input.pairMax ?? DEFAULT_PAIR_MAX,
    'Pair rate limit',
    10_000,
  )
  const identifierMax = positiveInteger(
    input.identifierMax ?? DEFAULT_IDENTIFIER_MAX,
    'Identifier rate limit',
    10_000,
  )
  const ipMax = positiveInteger(
    input.ipMax ?? DEFAULT_IP_MAX,
    'IP rate limit',
    10_000,
  )

  return [
    {
      key: `openexpert:${scope}:ip:${digest(input.keySecret, [ipAddress])}`,
      max: ipMax,
      windowMs,
    },
    {
      key: `openexpert:${scope}:identifier:${digest(input.keySecret, [identifier])}`,
      max: identifierMax,
      windowMs,
    },
    {
      key: `openexpert:${scope}:pair:${digest(input.keySecret, [ipAddress, identifier])}`,
      max: pairMax,
      windowMs,
    },
  ]
}

function rateLimitTable(databaseSchema: string): string {
  if (!SCHEMA_PATTERN.test(databaseSchema)) {
    throw new TypeError('databaseSchema must be a lowercase PostgreSQL identifier')
  }
  return `${databaseSchema}.rate_limits`
}

async function pruneExpiredRateLimits(
  pool: Pool,
  table: string,
  cutoff: number,
): Promise<void> {
  await pool.query(
    `delete from ${table} as target
      using (
        select id
          from ${table}
         where last_request < $1
         order by last_request asc
         limit $2
         for update skip locked
      ) as expired
     where target.id = expired.id`,
    [cutoff, PRUNE_BATCH_SIZE],
  )
}

async function maybePruneExpiredRateLimits(
  pool: Pool,
  table: string,
  now: number,
  retentionMs: number,
): Promise<void> {
  if ((nextPruneAt.get(table) ?? 0) > now) return
  nextPruneAt.set(table, now + PRUNE_INTERVAL_MS)
  try {
    await pruneExpiredRateLimits(pool, table, now - retentionMs)
  }
  catch (error) {
    nextPruneAt.delete(table)
    throw error
  }
}

async function consumeBucket(
  pool: Pool,
  table: string,
  bucket: OpenExpertAuthRateLimitBucket,
  now: number,
): Promise<OpenExpertAuthRateLimitDecision> {
  const result = await pool.query<RateLimitRow>(
    `insert into ${table} as rate_limit (
       id,
       key,
       count,
       last_request
     ) values ($1::uuid, $2, 1, $3)
     on conflict (key) do update
       set count = case
             when excluded.last_request - rate_limit.last_request >= $4
               then 1
             else least(rate_limit.count + 1, $5 + 1)
           end,
           last_request = case
             when excluded.last_request - rate_limit.last_request >= $4
               then excluded.last_request
             else rate_limit.last_request
           end
     returning count, last_request`,
    [randomUUID(), bucket.key, now, bucket.windowMs, bucket.max],
  )
  const row = result.rows[0]
  if (!row) throw new Error('Rate-limit counter did not return a decision')

  const count = Number(row.count)
  const windowStartedAt = Number(row.last_request)
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(windowStartedAt)) {
    throw new Error('Rate-limit counter returned invalid data')
  }
  if (count <= bucket.max) return { allowed: true, retryAfterSeconds: 0 }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((windowStartedAt + bucket.windowMs - now) / 1_000),
    ),
  }
}

async function consumeBucketWithFallback(
  pool: Pool,
  table: string,
  bucket: OpenExpertAuthRateLimitBucket,
  now: number,
  fallbackNamespace = table,
): Promise<OpenExpertAuthRateLimitDecision> {
  try {
    return await consumeBucket(pool, table, bucket, now)
  }
  catch (error) {
    if (!isMissingRateLimitTable(error)) throw error
    warnAboutMissingRateLimitTable()
    return consumeMemoryFallback(fallbackNamespace, bucket, now)
  }
}

/**
 * Atomically consumes the IP, identifier, and IP+identifier buckets in
 * PostgreSQL. Broader buckets are checked first and stop the request before a
 * rotating identifier can create unbounded database state after the IP is
 * already blocked.
 */
export async function consumeOpenExpertAuthRateLimit(
  input: OpenExpertAuthRateLimitInput,
): Promise<OpenExpertAuthRateLimitDecision> {
  const table = rateLimitTable(input.databaseSchema)
  const buckets = createOpenExpertAuthRateLimitBuckets(input)
  const retentionMs = positiveInteger(
    input.retentionMs ?? DEFAULT_RETENTION_MS,
    'Rate-limit retention',
    30 * 24 * 60 * 60 * 1_000,
  )
  if (retentionMs < Math.max(...buckets.map(bucket => bucket.windowMs))) {
    throw new TypeError('Rate-limit retention cannot be shorter than its window')
  }

  const now = Date.now()
  try {
    await maybePruneExpiredRateLimits(input.pool, table, now, retentionMs)
  }
  catch (error) {
    if (!isMissingRateLimitTable(error)) throw error
    warnAboutMissingRateLimitTable()
  }

  for (const bucket of buckets) {
    const decision = await consumeBucketWithFallback(
      input.pool,
      table,
      bucket,
      now,
    )
    if (!decision.allowed) return decision
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

/**
 * Atomic Better Auth storage that normalizes PostgreSQL bigint values and
 * degrades to a bounded in-process limiter only while migration 0024 has not
 * reached an environment yet. Other database failures remain fail-closed.
 */
export function createOpenExpertBetterAuthRateLimitStorage(input: {
  pool: Pool
  databaseSchema: string
}): BetterAuthRateLimitStorage {
  const table = rateLimitTable(input.databaseSchema)
  const fallbackNamespace = `${table}:better-auth`

  return {
    async get(key) {
      try {
        const result = await input.pool.query<RateLimitRow>(
          `select count, last_request
             from ${table}
            where key = $1
            limit 1`,
          [key],
        )
        const row = result.rows[0]
        if (!row) return null
        return {
          key,
          count: Number(row.count),
          lastRequest: Number(row.last_request),
        }
      }
      catch (error) {
        if (!isMissingRateLimitTable(error)) throw error
        warnAboutMissingRateLimitTable()
        const entry = memoryFallback.get(`${fallbackNamespace}\0${key}`)
        if (!entry || entry.expiresAt <= Date.now()) return null
        return { key, count: entry.count, lastRequest: entry.lastRequest }
      }
    },

    async set(key, value) {
      try {
        await input.pool.query(
          `insert into ${table} (id, key, count, last_request)
           values ($1::uuid, $2, $3, $4)
           on conflict (key) do update
             set count = excluded.count,
                 last_request = excluded.last_request`,
          [randomUUID(), key, value.count, Number(value.lastRequest)],
        )
      }
      catch (error) {
        if (!isMissingRateLimitTable(error)) throw error
        warnAboutMissingRateLimitTable()
        const now = Date.now()
        pruneMemoryFallback(now)
        memoryFallback.set(`${fallbackNamespace}\0${key}`, {
          count: Number(value.count),
          lastRequest: Number(value.lastRequest),
          expiresAt: now + DEFAULT_RETENTION_MS,
        })
      }
    },

    async consume(key, rule) {
      const bucket: OpenExpertAuthRateLimitBucket = {
        key,
        max: positiveInteger(rule.max, 'Better Auth rate limit', 100_000),
        windowMs: positiveInteger(
          rule.window * 1_000,
          'Better Auth rate-limit window',
          24 * 60 * 60 * 1_000,
        ),
      }
      const now = Date.now()
      try {
        await maybePruneExpiredRateLimits(
          input.pool,
          table,
          now,
          DEFAULT_RETENTION_MS,
        )
      }
      catch (error) {
        if (!isMissingRateLimitTable(error)) throw error
        warnAboutMissingRateLimitTable()
      }
      const decision = await consumeBucketWithFallback(
        input.pool,
        table,
        bucket,
        now,
        fallbackNamespace,
      )
      return {
        allowed: decision.allowed,
        retryAfter: decision.allowed ? null : decision.retryAfterSeconds,
      }
    },
  }
}
