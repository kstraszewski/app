export const forumEmbeddingBatchSize = 40
export const forumEmbeddingMaxBatchesPerRun = 3
export const forumEmbeddingRequestTimeoutMs = 35_000

export interface ForumEmbeddingWorkerEnvironment {
  NUXT_MESSAGING_OUTBOX_SECRET?: string
  OPENEXPERT_FORUM_EMBEDDINGS_URL?: string
}

export interface ForumEmbeddingWorkerConfiguration {
  secret: string
  url: string
}

export interface ForumEmbeddingBatchResult {
  claimed: number
  completed: number
  failed: number
}

export interface ForumEmbeddingDrainResult extends ForumEmbeddingBatchResult {
  batches: number
  reachedBatchLimit: boolean
}

interface ForumEmbeddingDrainOptions extends ForumEmbeddingWorkerConfiguration {
  batchSize?: number
  fetch?: typeof globalThis.fetch
  maxBatches?: number
  requestTimeoutMs?: number
}

function asRecord(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function safeCount(input: unknown, field: string): number {
  const value = asRecord(input)[field]
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Forum embedding worker returned an invalid ${field} count`)
  }
  return Number(value)
}

function normalizedWorkerUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('OPENEXPERT_FORUM_EMBEDDINGS_URL must be a valid URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('OPENEXPERT_FORUM_EMBEDDINGS_URL must use HTTP or HTTPS')
  }
  if (url.username || url.password) {
    throw new Error('OPENEXPERT_FORUM_EMBEDDINGS_URL must not contain credentials')
  }
  const isLocalHost = url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]'
  if (url.protocol === 'http:' && !isLocalHost) {
    throw new Error('OPENEXPERT_FORUM_EMBEDDINGS_URL must use HTTPS outside localhost')
  }
  return url.toString()
}

export function forumEmbeddingWorkerConfiguration(
  environment: ForumEmbeddingWorkerEnvironment,
): ForumEmbeddingWorkerConfiguration | null {
  const url = environment.OPENEXPERT_FORUM_EMBEDDINGS_URL?.trim()
  const secret = environment.NUXT_MESSAGING_OUTBOX_SECRET?.trim()
  if (!url || !secret) return null
  return {
    secret,
    url: normalizedWorkerUrl(url),
  }
}

export function parseForumEmbeddingBatchResult(
  input: unknown,
  batchSize: number,
): ForumEmbeddingBatchResult {
  const data = asRecord(asRecord(input).data)
  const result = {
    claimed: safeCount(data, 'claimed'),
    completed: safeCount(data, 'completed'),
    failed: safeCount(data, 'failed'),
  }
  if (result.claimed > batchSize || result.completed + result.failed !== result.claimed) {
    throw new Error('Forum embedding worker returned inconsistent batch counts')
  }
  return result
}

/**
 * Drains a bounded number of lease-backed database batches. A Trigger retry may
 * repeat this call after an ambiguous network failure; completed jobs cannot be
 * claimed again and failed jobs retain their database-managed retry delay.
 */
export async function drainForumEmbeddingJobs(
  options: ForumEmbeddingDrainOptions,
): Promise<ForumEmbeddingDrainResult> {
  const batchSize = Math.trunc(options.batchSize ?? forumEmbeddingBatchSize)
  const maxBatches = Math.trunc(options.maxBatches ?? forumEmbeddingMaxBatchesPerRun)
  const requestTimeoutMs = Math.trunc(
    options.requestTimeoutMs ?? forumEmbeddingRequestTimeoutMs,
  )
  if (batchSize < 1 || batchSize > forumEmbeddingBatchSize) {
    throw new Error(`Forum embedding batch size must be between 1 and ${forumEmbeddingBatchSize}`)
  }
  if (maxBatches < 1 || maxBatches > 10) {
    throw new Error('Forum embedding max batches must be between 1 and 10')
  }
  if (requestTimeoutMs < 1_000 || requestTimeoutMs > 60_000) {
    throw new Error('Forum embedding request timeout must be between 1s and 60s')
  }

  const fetchImplementation = options.fetch ?? globalThis.fetch
  const url = normalizedWorkerUrl(options.url.trim())
  const secret = options.secret.trim()
  if (!secret) throw new Error('Forum embedding worker secret is empty')

  const total: ForumEmbeddingDrainResult = {
    batches: 0,
    claimed: 0,
    completed: 0,
    failed: 0,
    reachedBatchLimit: false,
  }

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const response = await fetchImplementation(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: batchSize }),
      redirect: 'error',
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500)
      throw new Error(`Forum embedding drain failed (${response.status}): ${details}`)
    }

    const result = parseForumEmbeddingBatchResult(await response.json(), batchSize)
    total.batches += 1
    total.claimed += result.claimed
    total.completed += result.completed
    total.failed += result.failed

    if (result.claimed < batchSize) return total
  }

  total.reachedBatchLimit = true
  return total
}
