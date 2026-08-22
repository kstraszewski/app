import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenExpertAuthRateLimitBuckets } from '@openexpert/auth/server'
import {
  crmAgentMailRateLimitPolicy,
  type CrmAgentMailRateLimitOperation,
} from '../server/utils/mail-agent-rate-limit-core.ts'

test('mail-agent rate policies stay within the shared atomic limiter bounds', () => {
  for (const operation of ['search', 'thread', 'attachment'] as CrmAgentMailRateLimitOperation[]) {
    const policy = crmAgentMailRateLimitPolicy(operation)
    for (const [window, limits] of Object.entries(policy)) {
      const buckets = createOpenExpertAuthRateLimitBuckets({
        keySecret: 'test-rate-limit-secret-with-enough-entropy',
        scope: `crm:agent-mail-${operation}-${window}`,
        ipAddress: '203.0.113.10',
        identifier: '11111111-1111-4111-8111-111111111111',
        ...limits,
      })
      assert.equal(buckets.length, 3)
      assert.ok(buckets.every(bucket => bucket.max > 0 && bucket.max <= 10_000))
    }
  }
})
