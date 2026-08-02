import assert from 'node:assert/strict'
import test from 'node:test'
import {
  drainForumEmbeddingJobs,
  forumEmbeddingWorkerConfiguration,
  parseForumEmbeddingBatchResult,
} from '../src/forum-embedding-worker.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

test('normalizes configured worker credentials without exposing defaults', () => {
  assert.deepEqual(forumEmbeddingWorkerConfiguration({
    NUXT_MESSAGING_OUTBOX_SECRET: '  shared-secret  ',
    OPENEXPERT_FORUM_EMBEDDINGS_URL: ' https://crm.example.test/api/internal/forum/embeddings ',
  }), {
    secret: 'shared-secret',
    url: 'https://crm.example.test/api/internal/forum/embeddings',
  })
  assert.equal(forumEmbeddingWorkerConfiguration({}), null)
  assert.equal(forumEmbeddingWorkerConfiguration({
    OPENEXPERT_FORUM_EMBEDDINGS_URL: 'https://crm.example.test/api/internal/forum/embeddings',
  }), null)
  assert.throws(() => forumEmbeddingWorkerConfiguration({
    NUXT_MESSAGING_OUTBOX_SECRET: 'shared-secret',
    OPENEXPERT_FORUM_EMBEDDINGS_URL: 'http://crm.example.test/api/internal/forum/embeddings',
  }), /must use HTTPS outside localhost/u)
})

test('drains full batches until the worker reports a short batch', async () => {
  const requests: RequestInit[] = []
  const results = [
    { claimed: 40, completed: 39, failed: 1 },
    { claimed: 3, completed: 3, failed: 0 },
  ]
  const fetchImplementation: typeof globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {})
    return jsonResponse({ data: results.shift() })
  }

  const result = await drainForumEmbeddingJobs({
    fetch: fetchImplementation,
    maxBatches: 3,
    requestTimeoutMs: 1_000,
    secret: 'worker-secret',
    url: 'https://crm.example.test/api/internal/forum/embeddings',
  })

  assert.deepEqual(result, {
    batches: 2,
    claimed: 43,
    completed: 42,
    failed: 1,
    reachedBatchLimit: false,
  })
  assert.equal(requests.length, 2)
  assert.equal(new Headers(requests[0]!.headers).get('authorization'), 'Bearer worker-secret')
  assert.equal(requests[0]!.body, JSON.stringify({ limit: 40 }))
  assert.equal(requests[0]!.redirect, 'error')
})

test('bounds each scheduled drain even while the queue remains full', async () => {
  let requests = 0
  const result = await drainForumEmbeddingJobs({
    batchSize: 5,
    fetch: async () => {
      requests += 1
      return jsonResponse({ data: { claimed: 5, completed: 5, failed: 0 } })
    },
    maxBatches: 2,
    requestTimeoutMs: 1_000,
    secret: 'worker-secret',
    url: 'https://crm.example.test/api/internal/forum/embeddings',
  })

  assert.equal(requests, 2)
  assert.deepEqual(result, {
    batches: 2,
    claimed: 10,
    completed: 10,
    failed: 0,
    reachedBatchLimit: true,
  })
})

test('rejects malformed and inconsistent worker responses', () => {
  assert.throws(
    () => parseForumEmbeddingBatchResult({ data: { claimed: 2, completed: 1, failed: 0 } }, 40),
    /inconsistent batch counts/u,
  )
  assert.throws(
    () => parseForumEmbeddingBatchResult({ data: { claimed: -1, completed: 0, failed: 0 } }, 40),
    /invalid claimed count/u,
  )
})

test('surfaces HTTP failures so Trigger.dev can retry with backoff', async () => {
  await assert.rejects(
    drainForumEmbeddingJobs({
      fetch: async () => new Response('temporary gateway failure', { status: 503 }),
      maxBatches: 1,
      requestTimeoutMs: 1_000,
      secret: 'worker-secret',
      url: 'https://crm.example.test/api/internal/forum/embeddings',
    }),
    /Forum embedding drain failed \(503\): temporary gateway failure/u,
  )
})
