interface CacheEntry<T> {
  value: T
  expiresAt: number
}

/**
 * Small process-local cache for recipient autocomplete. It stores only the
 * already-minimized suggestion DTOs and coalesces identical provider calls.
 * Serverless instances may discard it at any time; correctness never depends
 * on the cache being present.
 */
export class BoundedMailRecipientSearchCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly pending = new Map<string, Promise<T>>()
  private readonly ttlMilliseconds: number
  private readonly maximumEntries: number
  private readonly now: () => number

  constructor(
    ttlMilliseconds = 2 * 60_000,
    maximumEntries = 128,
    now: () => number = Date.now,
  ) {
    if (!Number.isFinite(ttlMilliseconds) || ttlMilliseconds <= 0) {
      throw new TypeError('cache TTL must be positive')
    }
    if (!Number.isInteger(maximumEntries) || maximumEntries <= 0) {
      throw new TypeError('cache entry limit must be positive')
    }
    this.ttlMilliseconds = ttlMilliseconds
    this.maximumEntries = maximumEntries
    this.now = now
  }

  async getOrLoad(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key)
    const currentTime = this.now()
    if (cached && cached.expiresAt > currentTime) {
      // Refresh insertion order so the bounded eviction policy behaves as LRU.
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached.value
    }
    if (cached) this.entries.delete(key)

    const active = this.pending.get(key)
    if (active) return active

    const request = loader()
      .then((value) => {
        this.pruneExpired()
        while (this.entries.size >= this.maximumEntries) {
          const oldestKey = this.entries.keys().next().value
          if (typeof oldestKey !== 'string') break
          this.entries.delete(oldestKey)
        }
        this.entries.set(key, {
          value,
          expiresAt: this.now() + this.ttlMilliseconds,
        })
        return value
      })
      .finally(() => {
        if (this.pending.get(key) === request) this.pending.delete(key)
      })
    this.pending.set(key, request)
    return request
  }

  private pruneExpired(): void {
    const currentTime = this.now()
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= currentTime) this.entries.delete(key)
    }
  }
}

export function mailRecipientSearchCacheKey(input: {
  organizationId: string
  ownerUserId: string
  connectionId: string
  query: string
  limit: number
}): string {
  return [
    input.organizationId,
    input.ownerUserId,
    input.connectionId,
    input.query.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pl-PL'),
    String(input.limit),
  ].join('\u0000')
}
