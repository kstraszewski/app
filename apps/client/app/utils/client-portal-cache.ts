function cacheScope(value: string | null | undefined, fallback: string) {
  const normalized = String(value || '').trim()
  return normalized || fallback
}

interface ClientNuxtDataCache {
  payload: { data: Record<string, unknown> }
  static: { data: Record<string, unknown> }
}

export function getClientSessionCachedData<T>(
  key: string,
  nuxtApp: ClientNuxtDataCache,
): T | undefined {
  return (nuxtApp.payload.data[key] ?? nuxtApp.static.data[key]) as T | undefined
}

export function clientPortalDataKey(userId: string | null | undefined) {
  return `client-portal:${cacheScope(userId, 'session')}`
}

export function clientCaseDataKey(
  userId: string | null | undefined,
  caseId: string | null | undefined,
) {
  return `client-case:${cacheScope(userId, 'session')}:${cacheScope(caseId, 'unknown')}`
}

export function clientMultiformDataKey(
  userId: string | null | undefined,
  caseId: string | null | undefined,
) {
  return `client-multiform:${cacheScope(userId, 'session')}:${cacheScope(caseId, 'unknown')}`
}
