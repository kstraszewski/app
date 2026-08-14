import assert from 'node:assert/strict'
import test from 'node:test'
import {
  coordinatedMailOAuthAccessToken,
  type MailOAuthRefreshedTokenSet,
  type MailOAuthRefreshState,
} from '../server/utils/mail-oauth-refresh-cas.ts'

const NOW = Date.parse('2026-08-14T12:00:00.000Z')
const EXPIRED = new Date(NOW - 60_000).toISOString()
const FRESH = new Date(NOW + 60 * 60_000).toISOString()

interface Version {
  value: number
}

interface StoredTokenState {
  version: number
  accessToken: string | null
  refreshToken: string | null
  expiresAt: string | null
  status: 'active' | 'error' | 'revoked'
  lastError: string | null
}

test('concurrent rotating refreshes preserve the first CAS winner', async () => {
  const store = expiredStore()
  const allRefreshing = deferred<void>()
  const releaseRefreshes = deferred<void>()
  let refreshCalls = 0
  let commits = 0

  const coordinator = fakeCoordinator(store, {
    refresh: async () => {
      const call = ++refreshCalls
      if (refreshCalls === 2) allRefreshing.resolve()
      await releaseRefreshes.promise
      return tokenSet(`access-${call}`, `refresh-${call}`)
    },
    onCommit: () => { commits += 1 },
  })
  const initial = snapshot(store)
  const first = coordinatedMailOAuthAccessToken(initial, coordinator)
  const second = coordinatedMailOAuthAccessToken(initial, coordinator)

  await allRefreshing.promise
  releaseRefreshes.resolve()

  assert.deepEqual(await Promise.all([first, second]), ['access-1', 'access-1'])
  assert.equal(refreshCalls, 2)
  assert.equal(commits, 1)
  assert.equal(store.accessToken, 'access-1')
  assert.equal(store.refreshToken, 'refresh-1')
  assert.equal(store.status, 'active')
})

test('stale invalid_grant reloads a concurrent winner instead of revoking it', async () => {
  const store = expiredStore()
  const bothRefreshing = deferred<void>()
  const releaseSuccess = deferred<void>()
  const releaseFailure = deferred<void>()
  const successCommitted = deferred<void>()
  let refreshCalls = 0
  let failureWrites = 0

  const coordinator = fakeCoordinator(store, {
    refresh: async () => {
      const call = ++refreshCalls
      if (refreshCalls === 2) bothRefreshing.resolve()
      if (call === 1) {
        await releaseSuccess.promise
        return tokenSet('access-current', 'refresh-current')
      }
      await releaseFailure.promise
      throw refreshError(409, 'invalid_grant from the stale refresh token')
    },
    onCommit: () => successCommitted.resolve(),
    onFailureWrite: () => { failureWrites += 1 },
  })
  const initial = snapshot(store)
  const success = coordinatedMailOAuthAccessToken(initial, coordinator)
  const staleFailure = coordinatedMailOAuthAccessToken(initial, coordinator)

  await bothRefreshing.promise
  releaseSuccess.resolve()
  await successCommitted.promise
  releaseFailure.resolve()

  assert.equal(await success, 'access-current')
  assert.equal(await staleFailure, 'access-current')
  assert.equal(store.refreshToken, 'refresh-current')
  assert.equal(store.status, 'active')
  assert.equal(store.lastError, null)
  assert.equal(failureWrites, 0)
})

test('invalid_grant marks only an unchanged OAuth generation as revoked', async () => {
  const store = expiredStore()
  const expected = refreshError(409, 'authorization was revoked')
  let failureWrites = 0
  const coordinator = fakeCoordinator(store, {
    refresh: async () => { throw expected },
    onFailureWrite: () => { failureWrites += 1 },
  })

  await assert.rejects(
    coordinatedMailOAuthAccessToken(snapshot(store), coordinator),
    error => error === expected,
  )
  assert.equal(store.status, 'revoked')
  assert.equal(store.lastError, expected.message)
  assert.equal(failureWrites, 1)
})

test('a successful refresh retries CAS after a status-only concurrent write', async () => {
  const store = expiredStore()
  let firstCommit = true
  let refreshCalls = 0
  const coordinator = fakeCoordinator(store, {
    refresh: async () => {
      refreshCalls += 1
      return tokenSet('access-rotated', 'refresh-rotated')
    },
    beforeCommit: () => {
      if (!firstCommit) return
      firstCommit = false
      store.version += 1
      store.status = 'error'
      store.lastError = 'parallel transient failure'
    },
  })

  assert.equal(
    await coordinatedMailOAuthAccessToken(snapshot(store), coordinator),
    'access-rotated',
  )
  assert.equal(refreshCalls, 1)
  assert.equal(store.refreshToken, 'refresh-rotated')
  assert.equal(store.status, 'active')
  assert.equal(store.lastError, null)
})

test('a reconnect that advances the refresh generation is never overwritten', async () => {
  const store = expiredStore()
  let reconnectPending = true
  let committedStaleResponse = false
  const coordinator = fakeCoordinator(store, {
    refresh: async () => tokenSet('access-stale-response', 'refresh-stale-response'),
    beforeCommit: () => {
      if (!reconnectPending) return
      reconnectPending = false
      store.version += 1
      store.accessToken = 'access-from-reconnect'
      store.refreshToken = 'refresh-from-reconnect'
      store.expiresAt = FRESH
      store.status = 'active'
      store.lastError = null
    },
    onCommit: () => { committedStaleResponse = true },
  })

  assert.equal(
    await coordinatedMailOAuthAccessToken(snapshot(store), coordinator),
    'access-from-reconnect',
  )
  assert.equal(store.refreshToken, 'refresh-from-reconnect')
  assert.equal(committedStaleResponse, false)
})

test('a stale missing-refresh snapshot cannot revoke a concurrently reconnected row', async () => {
  const store = expiredStore()
  store.refreshToken = null
  let reconnectPending = true
  let failureWrites = 0
  const coordinator = fakeCoordinator(store, {
    refresh: async () => {
      throw new Error('the reconnected access token should be reused')
    },
    beforeFailureWrite: () => {
      if (!reconnectPending) return
      reconnectPending = false
      store.version += 1
      store.accessToken = 'access-from-concurrent-reconnect'
      store.refreshToken = 'refresh-from-concurrent-reconnect'
      store.expiresAt = FRESH
      store.status = 'active'
      store.lastError = null
    },
    onFailureWrite: () => { failureWrites += 1 },
  })

  assert.equal(
    await coordinatedMailOAuthAccessToken(snapshot(store), coordinator),
    'access-from-concurrent-reconnect',
  )
  assert.equal(store.refreshToken, 'refresh-from-concurrent-reconnect')
  assert.equal(store.status, 'active')
  assert.equal(failureWrites, 0)
})

function fakeCoordinator(
  store: StoredTokenState,
  options: {
    refresh: (refreshToken: string) => Promise<MailOAuthRefreshedTokenSet>
    beforeCommit?: () => void
    beforeFailureWrite?: () => void
    onCommit?: () => void
    onFailureWrite?: () => void
  },
) {
  return {
    now: () => NOW,
    loadCurrent: async () => snapshot(store),
    refresh: options.refresh,
    compareAndSwap: async (
      expected: MailOAuthRefreshState<Version>,
      refreshed: MailOAuthRefreshedTokenSet,
    ) => {
      options.beforeCommit?.()
      if (expected.source.value !== store.version) return false
      store.version += 1
      store.accessToken = refreshed.accessToken
      store.refreshToken = refreshed.refreshToken
      store.expiresAt = refreshed.expiresAt
      store.status = 'active'
      store.lastError = null
      options.onCommit?.()
      return true
    },
    compareAndSetFailure: async (
      expected: MailOAuthRefreshState<Version>,
      failure: { status: 'error' | 'revoked', message: string },
    ) => {
      options.beforeFailureWrite?.()
      if (expected.source.value !== store.version) return false
      store.version += 1
      store.status = failure.status
      store.lastError = failure.message
      options.onFailureWrite?.()
      return true
    },
    describeFailure: (error: unknown) => ({
      status: Number((error as { statusCode?: number })?.statusCode) === 409
        ? 'revoked' as const
        : 'error' as const,
      message: error instanceof Error ? error.message : 'refresh failed',
    }),
    missingRefreshTokenFailure: {
      status: 'revoked' as const,
      message: 'reconnect required',
    },
    missingRefreshTokenError: () => refreshError(409, 'reconnect required'),
    missingConnectionError: () => refreshError(404, 'connection missing'),
    contentionError: () => refreshError(503, 'refresh contention'),
  }
}

function snapshot(store: StoredTokenState): MailOAuthRefreshState<Version> {
  return {
    source: { value: store.version },
    accessToken: store.accessToken,
    refreshToken: store.refreshToken,
    expiresAt: store.expiresAt,
  }
}

function expiredStore(): StoredTokenState {
  return {
    version: 0,
    accessToken: 'access-expired',
    refreshToken: 'refresh-original',
    expiresAt: EXPIRED,
    status: 'active',
    lastError: null,
  }
}

function tokenSet(accessToken: string, refreshToken: string): MailOAuthRefreshedTokenSet {
  return {
    accessToken,
    refreshToken,
    expiresAt: FRESH,
    scopes: ['mail.read'],
  }
}

function refreshError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode })
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
