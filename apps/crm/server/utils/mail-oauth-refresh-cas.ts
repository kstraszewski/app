export const MAIL_OAUTH_ACCESS_TOKEN_SAFETY_WINDOW_MS = 2 * 60 * 1000

const MAX_PROVIDER_REFRESH_ATTEMPTS = 3
const MAX_COMPARE_AND_SWAP_ATTEMPTS = 6

export interface MailOAuthRefreshState<Source> {
  source: Source
  accessToken: string | null
  refreshToken: string | null
  expiresAt: string | null
}

export interface MailOAuthRefreshedTokenSet {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  scopes: string[]
}

export interface MailOAuthRefreshFailure {
  status: 'error' | 'revoked'
  message: string
}

export interface MailOAuthRefreshCoordinator<Source> {
  loadCurrent: () => Promise<MailOAuthRefreshState<Source> | null>
  refresh: (refreshToken: string) => Promise<MailOAuthRefreshedTokenSet>
  compareAndSwap: (
    expected: MailOAuthRefreshState<Source>,
    refreshed: MailOAuthRefreshedTokenSet,
  ) => Promise<boolean>
  compareAndSetFailure: (
    expected: MailOAuthRefreshState<Source>,
    failure: MailOAuthRefreshFailure,
  ) => Promise<boolean>
  describeFailure: (error: unknown) => MailOAuthRefreshFailure
  missingRefreshTokenFailure: MailOAuthRefreshFailure
  missingRefreshTokenError: () => unknown
  missingConnectionError: () => unknown
  contentionError: () => unknown
  now?: () => number
}

/**
 * Refresh an OAuth token with optimistic concurrency control.
 *
 * The backing store must compare-and-swap on a non-secret row version (the
 * mail connection's `updated_at`). A failed CAS always reloads the owner/org/
 * connection-scoped row. This prevents a response based on an old rotating
 * refresh token from replacing a newer token, and prevents a stale
 * `invalid_grant` from revoking a concurrently refreshed connection.
 */
export async function coordinatedMailOAuthAccessToken<Source>(
  initial: MailOAuthRefreshState<Source>,
  coordinator: MailOAuthRefreshCoordinator<Source>,
): Promise<string> {
  const now = coordinator.now ?? Date.now
  if (freshAccessToken(initial, now())) return initial.accessToken!

  let current = await requireCurrent(coordinator)

  refreshLoop:
  for (
    let refreshAttempt = 0;
    refreshAttempt < MAX_PROVIDER_REFRESH_ATTEMPTS;
    refreshAttempt += 1
  ) {
    if (freshAccessToken(current, now())) return current.accessToken!

    const refreshToken = current.refreshToken
    if (!refreshToken) {
      for (
        let casAttempt = 0;
        casAttempt < MAX_COMPARE_AND_SWAP_ATTEMPTS;
        casAttempt += 1
      ) {
        const marked = await coordinator.compareAndSetFailure(
          current,
          coordinator.missingRefreshTokenFailure,
        )
        if (marked) throw coordinator.missingRefreshTokenError()

        current = await requireCurrent(coordinator)
        if (freshAccessToken(current, now())) return current.accessToken!
        if (current.refreshToken) continue refreshLoop
      }
      throw coordinator.contentionError()
    }

    let refreshed: MailOAuthRefreshedTokenSet
    try {
      const providerResult = await coordinator.refresh(refreshToken)
      refreshed = {
        ...providerResult,
        // Google normally keeps the previous refresh token while Microsoft
        // may rotate it. Persist exactly the provider's replacement when one
        // exists, otherwise keep the generation used for this request.
        refreshToken: providerResult.refreshToken || refreshToken,
      }
    }
    catch (error) {
      const failure = coordinator.describeFailure(error)
      for (
        let casAttempt = 0;
        casAttempt < MAX_COMPARE_AND_SWAP_ATTEMPTS;
        casAttempt += 1
      ) {
        current = await requireCurrent(coordinator)
        if (freshAccessToken(current, now())) return current.accessToken!

        // A different refresh token is a newer OAuth generation (rotation or
        // reconnect). Never apply the old request's failure to that row.
        if (current.refreshToken !== refreshToken) continue refreshLoop

        const marked = await coordinator.compareAndSetFailure(current, failure)
        if (marked) throw error
      }
      throw coordinator.contentionError()
    }

    for (
      let casAttempt = 0;
      casAttempt < MAX_COMPARE_AND_SWAP_ATTEMPTS;
      casAttempt += 1
    ) {
      const committed = await coordinator.compareAndSwap(current, refreshed)
      if (committed) return refreshed.accessToken

      current = await requireCurrent(coordinator)
      if (freshAccessToken(current, now())) return current.accessToken!

      // A metadata/status-only write may advance updated_at while retaining
      // the same OAuth generation. In that case the successful provider
      // response is still safe to commit against the reloaded row. A changed
      // refresh token must instead be refreshed from its new generation.
      if (current.refreshToken !== refreshToken) continue refreshLoop
    }

    throw coordinator.contentionError()
  }

  throw coordinator.contentionError()
}

export function freshMailOAuthAccessToken(
  state: Pick<MailOAuthRefreshState<unknown>, 'accessToken' | 'expiresAt'>,
  now = Date.now(),
): string | null {
  return freshAccessToken(state, now) ? state.accessToken : null
}

function freshAccessToken(
  state: Pick<MailOAuthRefreshState<unknown>, 'accessToken' | 'expiresAt'>,
  now: number,
): boolean {
  if (!state.accessToken || !state.expiresAt) return false
  const expiresAt = new Date(state.expiresAt).getTime()
  return Number.isFinite(expiresAt)
    && expiresAt > now + MAIL_OAUTH_ACCESS_TOKEN_SAFETY_WINDOW_MS
}

async function requireCurrent<Source>(
  coordinator: MailOAuthRefreshCoordinator<Source>,
): Promise<MailOAuthRefreshState<Source>> {
  const current = await coordinator.loadCurrent()
  if (!current) throw coordinator.missingConnectionError()
  return current
}
