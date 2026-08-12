import type {
  PortalAccountConsent,
  PortalAccountConsentDecision,
  PortalAccountConsentHistoryItem,
} from '../types/portal-account.ts'

export const PORTAL_ACCOUNT_ARCHIVE_CONFIRMATION = 'USUŃ KONTO' as const

export interface PortalAccountConsentScope {
  organizationId: string
  organizationName: string
  clientId: string
  clientPersonId: string
  personName: string
}

export interface PortalAccountConsentDefinitionRow {
  id: unknown
  organization_id: unknown
  code: unknown
  current_version_id: unknown
}

export interface PortalAccountConsentVersionRow {
  id: unknown
  organization_id: unknown
  definition_id: unknown
  version: unknown
  display_title: unknown
  content: unknown
  purpose: unknown
  channel: unknown
  legal_basis: unknown
  status: unknown
  sort_order: unknown
  effective_from: unknown
  effective_to: unknown
  is_required: unknown
}

export interface PortalAccountConsentEventRow {
  id: unknown
  organization_id: unknown
  client_id: unknown
  subject_person_id: unknown
  definition_id: unknown
  definition_version_id: unknown
  decision: unknown
  source: unknown
  occurred_at: unknown
}

export interface BuildPortalAccountConsentsInput {
  scopes: readonly PortalAccountConsentScope[]
  definitions: readonly PortalAccountConsentDefinitionRow[]
  versions: readonly PortalAccountConsentVersionRow[]
  events: readonly PortalAccountConsentEventRow[]
  now?: number
}

export interface PortalAccountLifecycleStatusRow {
  auth_user_id: unknown
  status: unknown
}

export interface PortalAccountConsentPageScope {
  organizationId: string
  clientId: string
  clientPersonId: string
}

export class PortalAccountConsentHistoryLimitError extends Error {
  constructor() {
    super('Portal account consent history exceeds the safe response limit')
    this.name = 'PortalAccountConsentHistoryLimitError'
  }
}

type RecordedConsentDecision = Exclude<PortalAccountConsentDecision, 'missing'>

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function timestamp(value: unknown): string | null {
  const result = nonEmptyString(value)
  if (!result) return null
  return Number.isFinite(Date.parse(result)) ? result : null
}

function recordedConsentDecision(value: unknown): RecordedConsentDecision | null {
  return value === 'granted' || value === 'declined' || value === 'withdrawn'
    ? value
    : null
}

function definitionKey(organizationId: string, definitionId: string): string {
  return JSON.stringify([organizationId, definitionId])
}

function consentKey(
  organizationId: string,
  clientId: string,
  clientPersonId: string,
  definitionId: string,
): string {
  return JSON.stringify([
    organizationId,
    clientId,
    clientPersonId,
    definitionId,
  ])
}

function versionKey(
  organizationId: string,
  definitionId: string,
  versionId: string,
): string {
  return JSON.stringify([organizationId, definitionId, versionId])
}

function descendingText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? 1 : -1
}

function isPublishedAt(
  version: PortalAccountConsentVersionRow,
  now: number,
): boolean {
  if (version.status !== 'published') return false
  const effectiveFrom = Date.parse(String(version.effective_from ?? ''))
  const effectiveTo = version.effective_to
    ? Date.parse(String(version.effective_to))
    : Number.POSITIVE_INFINITY
  return Number.isFinite(effectiveFrom)
    && effectiveFrom <= now
    && effectiveTo > now
}

function historyVersion(value: unknown): number | null {
  const version = Number(value)
  return Number.isFinite(version) ? version : null
}

/**
 * Builds a collision-safe key for the complete CRM person scope. Partial
 * tenant, client or person identifiers must never be used for authorization.
 */
export function portalAccountScopeKey(
  organizationId: string,
  clientId: string,
  clientPersonId: string,
): string {
  return JSON.stringify([organizationId, clientId, clientPersonId])
}

/**
 * Loads every page for each exact CRM person scope. The extra row requested at
 * the safety boundary makes an oversized history fail closed instead of
 * silently returning an older, incomplete consent state.
 */
export async function loadAllPortalAccountConsentEventPages<T>(
  scopes: readonly PortalAccountConsentPageScope[],
  fetchPage: (
    scope: PortalAccountConsentPageScope,
    from: number,
    to: number,
  ) => Promise<readonly T[]>,
  options: { pageSize?: number, maxRows?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 500
  const maxRows = options.maxRows ?? 10_000
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new TypeError('pageSize must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) {
    throw new TypeError('maxRows must be a positive safe integer')
  }

  const exactScopes = new Map<string, PortalAccountConsentPageScope>()
  for (const scope of scopes) {
    if (!scope.organizationId || !scope.clientId || !scope.clientPersonId) continue
    const key = portalAccountScopeKey(
      scope.organizationId,
      scope.clientId,
      scope.clientPersonId,
    )
    if (!exactScopes.has(key)) exactScopes.set(key, scope)
  }

  const rows: T[] = []
  for (const scope of exactScopes.values()) {
    for (let offset = 0; ;) {
      const remaining = maxRows - rows.length
      const requestedRows = Math.min(pageSize, remaining + 1)
      const page = [...await fetchPage(
        scope,
        offset,
        offset + requestedRows - 1,
      )]
      if (page.length > requestedRows || rows.length + page.length > maxRows) {
        throw new PortalAccountConsentHistoryLimitError()
      }
      rows.push(...page)
      if (page.length < requestedRows) break
      offset += page.length
    }
  }
  return rows
}

/** Checks the complete organization/client/person tuple without coercion. */
export function isPortalAccountRowInScope(
  row: Pick<PortalAccountConsentEventRow,
    'organization_id' | 'client_id' | 'subject_person_id'>,
  scope: Pick<PortalAccountConsentScope,
    'organizationId' | 'clientId' | 'clientPersonId'>,
): boolean {
  return row.organization_id === scope.organizationId
    && row.client_id === scope.clientId
    && row.subject_person_id === scope.clientPersonId
}

/** Sorts consent events newest-first, resolving equal timestamps by ID. */
export function comparePortalConsentEvents(
  left: Pick<PortalAccountConsentEventRow, 'id' | 'occurred_at'>,
  right: Pick<PortalAccountConsentEventRow, 'id' | 'occurred_at'>,
): number {
  const leftTime = Date.parse(String(left.occurred_at ?? ''))
  const rightTime = Date.parse(String(right.occurred_at ?? ''))
  const normalizedLeftTime = Number.isFinite(leftTime)
    ? leftTime
    : Number.NEGATIVE_INFINITY
  const normalizedRightTime = Number.isFinite(rightTime)
    ? rightTime
    : Number.NEGATIVE_INFINITY
  if (normalizedLeftTime !== normalizedRightTime) {
    return normalizedRightTime - normalizedLeftTime
  }
  return descendingText(String(left.id ?? ''), String(right.id ?? ''))
}

/**
 * Derives portal-safe current consent states and histories from immutable CRM
 * consent rows. Contact data, evidence and event metadata are deliberately not
 * accepted by this contract and cannot leak into the returned payload.
 */
export function buildPortalAccountConsents(
  input: BuildPortalAccountConsentsInput,
): PortalAccountConsent[] {
  const now = Number.isFinite(input.now) ? input.now as number : Date.now()
  const scopesByKey = new Map<string, PortalAccountConsentScope>()
  for (const scope of input.scopes) {
    if (
      !scope.organizationId
      || !scope.clientId
      || !scope.clientPersonId
    ) continue
    const key = portalAccountScopeKey(
      scope.organizationId,
      scope.clientId,
      scope.clientPersonId,
    )
    if (!scopesByKey.has(key)) scopesByKey.set(key, scope)
  }
  const scopes = [...scopesByKey.values()]

  const definitions = input.definitions.flatMap((definition) => {
    const organizationId = nonEmptyString(definition.organization_id)
    const definitionId = nonEmptyString(definition.id)
    if (!organizationId || !definitionId) return []
    return [{ definition, organizationId, definitionId }]
  })
  const definitionKeys = new Set(definitions.map(definition => (
    definitionKey(definition.organizationId, definition.definitionId)
  )))

  const versionByScope = new Map<string, PortalAccountConsentVersionRow>()
  for (const version of input.versions) {
    const organizationId = nonEmptyString(version.organization_id)
    const definitionId = nonEmptyString(version.definition_id)
    const versionId = nonEmptyString(version.id)
    if (!organizationId || !definitionId || !versionId) continue
    if (!definitionKeys.has(definitionKey(organizationId, definitionId))) continue
    versionByScope.set(
      versionKey(organizationId, definitionId, versionId),
      version,
    )
  }

  const eventsByConsent = new Map<string, PortalAccountConsentEventRow[]>()
  for (const event of input.events) {
    const scope = scopesByKey.get(portalAccountScopeKey(
      typeof event.organization_id === 'string' ? event.organization_id : '',
      typeof event.client_id === 'string' ? event.client_id : '',
      typeof event.subject_person_id === 'string' ? event.subject_person_id : '',
    ))
    if (!scope || !isPortalAccountRowInScope(event, scope)) continue

    const definitionId = nonEmptyString(event.definition_id)
    if (
      !definitionId
      || !definitionKeys.has(definitionKey(scope.organizationId, definitionId))
      || !recordedConsentDecision(event.decision)
      || !timestamp(event.occurred_at)
      || !nonEmptyString(event.id)
    ) continue

    const key = consentKey(
      scope.organizationId,
      scope.clientId,
      scope.clientPersonId,
      definitionId,
    )
    const history = eventsByConsent.get(key) ?? []
    history.push(event)
    eventsByConsent.set(key, history)
  }
  for (const history of eventsByConsent.values()) {
    history.sort(comparePortalConsentEvents)
  }

  const consents: PortalAccountConsent[] = []
  for (const scope of scopes) {
    for (const { definition, organizationId, definitionId } of definitions) {
      if (organizationId !== scope.organizationId) continue

      const historyRows = eventsByConsent.get(consentKey(
        scope.organizationId,
        scope.clientId,
        scope.clientPersonId,
        definitionId,
      )) ?? []
      const latest = historyRows[0]
      const currentVersionId = nonEmptyString(definition.current_version_id)
      const currentVersion = currentVersionId
        ? versionByScope.get(versionKey(
            organizationId,
            definitionId,
            currentVersionId,
          ))
        : undefined
      const decidedVersionId = latest
        ? nonEmptyString(latest.definition_version_id)
        : null
      const decidedVersion = decidedVersionId
        ? versionByScope.get(versionKey(
            organizationId,
            definitionId,
            decidedVersionId,
          ))
        : undefined
      const presentedVersion = decidedVersion ?? currentVersion
      if (!presentedVersion) continue
      if (!latest && !isPublishedAt(presentedVersion, now)) continue

      const history: PortalAccountConsentHistoryItem[] = historyRows.map((row) => {
        const versionId = nonEmptyString(row.definition_version_id)
        const version = versionId
          ? versionByScope.get(versionKey(
              organizationId,
              definitionId,
              versionId,
            ))
          : undefined
        return {
          id: row.id as string,
          decision: row.decision as RecordedConsentDecision,
          occurredAt: row.occurred_at as string,
          source: typeof row.source === 'string' ? row.source : '',
          version: historyVersion(version?.version),
        }
      })
      const decision = latest
        ? latest.decision as RecordedConsentDecision
        : 'missing'
      consents.push({
        organizationId: scope.organizationId,
        organizationName: scope.organizationName,
        clientId: scope.clientId,
        clientPersonId: scope.clientPersonId,
        personName: scope.personName,
        definitionId,
        code: typeof definition.code === 'string' ? definition.code : '',
        title: typeof presentedVersion.display_title === 'string'
          ? presentedVersion.display_title
          : 'Zgoda',
        content: typeof presentedVersion.content === 'string'
          ? presentedVersion.content
          : '',
        purpose: typeof presentedVersion.purpose === 'string'
          ? presentedVersion.purpose
          : '',
        channel: typeof presentedVersion.channel === 'string'
          ? presentedVersion.channel
          : 'other',
        legalBasis: typeof presentedVersion.legal_basis === 'string'
          ? presentedVersion.legal_basis
          : '',
        isRequired: presentedVersion.is_required === true,
        decision,
        decidedAt: latest ? latest.occurred_at as string : null,
        source: latest && typeof latest.source === 'string' && latest.source
          ? latest.source
          : null,
        canWithdraw: decision === 'granted',
        history,
      })
    }
  }

  return consents.sort((left, right) => (
    left.organizationName.localeCompare(right.organizationName, 'pl')
    || left.personName.localeCompare(right.personName, 'pl')
    || left.title.localeCompare(right.title, 'pl')
    || left.definitionId.localeCompare(right.definitionId)
    || left.clientPersonId.localeCompare(right.clientPersonId)
  ))
}

/** The confirmation is intentionally exact: no trimming or case folding. */
export function isValidPortalAccountArchiveConfirmation(
  value: unknown,
): value is typeof PORTAL_ACCOUNT_ARCHIVE_CONFIRMATION {
  return value === PORTAL_ACCOUNT_ARCHIVE_CONFIRMATION
}

/**
 * Account closure is global to the client-portal identity. An archived row for
 * another identity must never block an unactivated user.
 */
export function hasArchivedPortalAccountLifecycle(
  rows: readonly PortalAccountLifecycleStatusRow[],
  authUserId: string,
): boolean {
  if (!authUserId) return false
  return rows.some(row => (
    row.auth_user_id === authUserId
    && row.status === 'archived'
  ))
}
