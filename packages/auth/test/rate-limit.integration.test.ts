import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { Pool } from 'pg'

import {
  consumeOpenExpertAuthRateLimit,
  createOpenExpertBetterAuthRateLimitStorage,
} from '../src/rate-limit.ts'

const databaseURL = process.env.OPENEXPERT_AUTH_TEST_DATABASE_URL

test('PostgreSQL rate limiting is atomic under concurrent requests', {
  skip: databaseURL ? false : 'OPENEXPERT_AUTH_TEST_DATABASE_URL is not configured',
}, async () => {
  const pool = new Pool({ connectionString: databaseURL, max: 12 })
  const scope = `test:${randomUUID().replaceAll('-', '')}`
  const betterAuthKey = `test-${randomUUID()}|/sign-in/email`

  try {
    const decisions = await Promise.all(Array.from({ length: 40 }, (_, index) => (
      consumeOpenExpertAuthRateLimit({
        pool,
        databaseSchema: 'identity',
        keySecret: 'integration-rate-limit-secret-with-at-least-32-bytes',
        scope,
        ipAddress: '203.0.113.77',
        identifier: `rotating-${index}@example.com`,
        ipMax: 10,
        identifierMax: 100,
        pairMax: 100,
      })
    )))
    assert.equal(decisions.filter(decision => decision.allowed).length, 10)

    const storage = createOpenExpertBetterAuthRateLimitStorage({
      pool,
      databaseSchema: 'identity',
    })
    const betterAuthDecisions = await Promise.all(Array.from(
      { length: 20 },
      () => storage.consume!(betterAuthKey, { window: 60, max: 3 }),
    ))
    assert.equal(
      betterAuthDecisions.filter(decision => decision.allowed).length,
      3,
    )
  }
  finally {
    await pool.query(
      `delete from identity.rate_limits
        where key like $1 escape '\\'
           or key = $2`,
      [`openexpert:${scope}:%`, betterAuthKey],
    )
    await pool.end()
  }
})
