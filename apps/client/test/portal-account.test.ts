import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import { portalAuthErrorCode } from '../app/composables/usePortalAuth.ts'
import {
  buildPortalAccountConsents,
  comparePortalConsentEvents,
  hasArchivedPortalAccountLifecycle,
  isPortalAccountRowInScope,
  isValidPortalAccountArchiveConfirmation,
  loadAllPortalAccountConsentEventPages,
  PORTAL_ACCOUNT_ARCHIVE_CONFIRMATION,
  PortalAccountConsentHistoryLimitError,
  portalAccountScopeKey,
  type PortalAccountConsentDefinitionRow,
  type PortalAccountConsentEventRow,
  type PortalAccountConsentScope,
  type PortalAccountConsentVersionRow,
} from '../shared/utils/portal-account.ts'

const now = Date.parse('2026-08-12T12:00:00.000Z')
const accountEndpointUrl = new URL(
  '../server/api/client/account.get.ts',
  import.meta.url,
)
const archiveEndpointUrl = new URL(
  '../server/api/client/account/archive.post.ts',
  import.meta.url,
)

function scope(
  overrides: Partial<PortalAccountConsentScope> = {},
): PortalAccountConsentScope {
  return {
    organizationId: 'org-a',
    organizationName: 'Organizacja A',
    clientId: 'client-a',
    clientPersonId: 'person-a',
    personName: 'Anna Kowalska',
    ...overrides,
  }
}

function definition(
  overrides: Partial<PortalAccountConsentDefinitionRow> = {},
): PortalAccountConsentDefinitionRow {
  return {
    id: 'definition-marketing',
    organization_id: 'org-a',
    code: 'marketing_email',
    current_version_id: 'version-2',
    ...overrides,
  }
}

function version(
  overrides: Partial<PortalAccountConsentVersionRow> = {},
): PortalAccountConsentVersionRow {
  return {
    id: 'version-2',
    organization_id: 'org-a',
    definition_id: 'definition-marketing',
    version: 2,
    display_title: 'Kontakt marketingowy',
    content: 'Treść zgody',
    purpose: 'Przesyłanie ofert',
    channel: 'email',
    legal_basis: 'art. 6 ust. 1 lit. a RODO',
    status: 'published',
    sort_order: 10,
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    is_required: false,
    ...overrides,
  }
}

function consentEvent(
  overrides: Partial<PortalAccountConsentEventRow> = {},
): PortalAccountConsentEventRow {
  return {
    id: 'event-2',
    organization_id: 'org-a',
    client_id: 'client-a',
    subject_person_id: 'person-a',
    definition_id: 'definition-marketing',
    definition_version_id: 'version-2',
    decision: 'withdrawn',
    source: 'client_portal',
    occurred_at: '2026-08-11T10:00:00.000Z',
    ...overrides,
  }
}

describe('portal account exact CRM scope', () => {
  it('matches the full tenant, client and person tuple without coercion', () => {
    const grantedScope = scope()
    const row = consentEvent()

    assert.equal(isPortalAccountRowInScope(row, grantedScope), true)
    assert.equal(isPortalAccountRowInScope({
      ...row,
      organization_id: 'org-b',
    }, grantedScope), false)
    assert.equal(isPortalAccountRowInScope({
      ...row,
      client_id: 'client-b',
    }, grantedScope), false)
    assert.equal(isPortalAccountRowInScope({
      ...row,
      subject_person_id: 'person-b',
    }, grantedScope), false)
    assert.equal(isPortalAccountRowInScope({
      ...row,
      subject_person_id: { toString: () => 'person-a' },
    }, grantedScope), false)
    assert.notEqual(
      portalAccountScopeKey('org-a', 'client-a', 'person-a'),
      portalAccountScopeKey('org-a', 'client-a', 'person-b'),
    )
  })

  it('isolates histories across organizations, clients and people', () => {
    const consents = buildPortalAccountConsents({
      now,
      scopes: [
        scope(),
        scope({
          organizationId: 'org-b',
          organizationName: 'Organizacja B',
          clientId: 'client-b',
          clientPersonId: 'person-b',
          personName: 'Bartłomiej Nowak',
        }),
      ],
      definitions: [
        definition(),
        definition({ organization_id: 'org-b' }),
      ],
      versions: [
        version(),
        version({ organization_id: 'org-b' }),
      ],
      events: [
        consentEvent({ id: 'org-a-own', decision: 'granted' }),
        consentEvent({
          id: 'wrong-tenant',
          organization_id: 'org-b',
          client_id: 'client-a',
          subject_person_id: 'person-a',
          decision: 'withdrawn',
          occurred_at: '2026-08-12T10:00:00.000Z',
        }),
        consentEvent({
          id: 'wrong-client',
          client_id: 'client-b',
          decision: 'declined',
          occurred_at: '2026-08-12T10:00:00.000Z',
        }),
        consentEvent({
          id: 'wrong-person',
          subject_person_id: 'person-b',
          decision: 'withdrawn',
          occurred_at: '2026-08-12T10:00:00.000Z',
        }),
        consentEvent({
          id: 'org-b-own',
          organization_id: 'org-b',
          client_id: 'client-b',
          subject_person_id: 'person-b',
          decision: 'declined',
        }),
      ],
    })

    assert.equal(consents.length, 2)
    const organizationA = consents.find(item => item.organizationId === 'org-a')
    const organizationB = consents.find(item => item.organizationId === 'org-b')
    assert.equal(organizationA?.decision, 'granted')
    assert.deepEqual(organizationA?.history.map(item => item.id), ['org-a-own'])
    assert.equal(organizationB?.decision, 'declined')
    assert.deepEqual(organizationB?.history.map(item => item.id), ['org-b-own'])
  })
})

describe('portal account current consent state', () => {
  it('derives a later withdrawal from an unordered granted-to-withdrawn history', () => {
    const result = buildPortalAccountConsents({
      now,
      scopes: [scope()],
      definitions: [definition()],
      versions: [
        version({
          id: 'version-1',
          version: 1,
          display_title: 'Kontakt marketingowy v1',
        }),
        version(),
      ],
      events: [
        consentEvent({
          id: 'event-withdrawn',
          decision: 'withdrawn',
          occurred_at: '2026-08-11T10:00:00.000Z',
        }),
        consentEvent({
          id: 'event-granted',
          definition_version_id: 'version-1',
          decision: 'granted',
          source: 'booking_widget',
          occurred_at: '2026-07-01T09:00:00.000Z',
        }),
      ].reverse(),
    })

    assert.equal(result.length, 1)
    assert.equal(result[0]?.decision, 'withdrawn')
    assert.equal(result[0]?.decidedAt, '2026-08-11T10:00:00.000Z')
    assert.equal(result[0]?.canWithdraw, false)
    assert.equal(result[0]?.title, 'Kontakt marketingowy')
    assert.deepEqual(result[0]?.history, [
      {
        id: 'event-withdrawn',
        decision: 'withdrawn',
        occurredAt: '2026-08-11T10:00:00.000Z',
        source: 'client_portal',
        version: 2,
      },
      {
        id: 'event-granted',
        decision: 'granted',
        occurredAt: '2026-07-01T09:00:00.000Z',
        source: 'booking_widget',
        version: 1,
      },
    ])
    assert.deepEqual(Object.keys(result[0]?.history[0] ?? {}).sort(), [
      'decision',
      'id',
      'occurredAt',
      'source',
      'version',
    ])
  })

  it('uses the lexicographically greatest ID for equal occurred_at values', () => {
    const sameTime = '2026-08-11T10:00:00.000Z'
    const olderById = consentEvent({
      id: 'event-a',
      decision: 'granted',
      occurred_at: sameTime,
    })
    const latestById = consentEvent({
      id: 'event-z',
      decision: 'withdrawn',
      occurred_at: sameTime,
    })
    assert.ok(comparePortalConsentEvents(latestById, olderById) < 0)

    const [consent] = buildPortalAccountConsents({
      now,
      scopes: [scope()],
      definitions: [definition()],
      versions: [version()],
      events: [olderById, latestById],
    })
    assert.equal(consent?.decision, 'withdrawn')
    assert.deepEqual(consent?.history.map(item => item.id), ['event-z', 'event-a'])
  })

  it('returns missing only for a currently published definition', () => {
    const result = buildPortalAccountConsents({
      now,
      scopes: [scope()],
      definitions: [
        definition(),
        definition({
          id: 'definition-draft',
          code: 'draft',
          current_version_id: 'draft-version',
        }),
      ],
      versions: [
        version(),
        version({
          id: 'draft-version',
          definition_id: 'definition-draft',
          status: 'draft',
          display_title: 'Nieopublikowana zgoda',
        }),
      ],
      events: [],
    })

    assert.equal(result.length, 1)
    assert.equal(result[0]?.definitionId, 'definition-marketing')
    assert.equal(result[0]?.decision, 'missing')
    assert.equal(result[0]?.decidedAt, null)
    assert.equal(result[0]?.source, null)
    assert.deepEqual(result[0]?.history, [])
  })
})

describe('portal account consent history pagination', () => {
  it('loads every deterministic page beyond the old 2,000-row boundary', async () => {
    const source = Array.from({ length: 2_003 }, (_, index) => ({
      id: `event-${String(index).padStart(4, '0')}`,
    }))
    const calls: Array<[string, number, number]> = []
    const rows = await loadAllPortalAccountConsentEventPages(
      [scope(), scope()],
      async (exactScope, from, to) => {
        calls.push([portalAccountScopeKey(
          exactScope.organizationId,
          exactScope.clientId,
          exactScope.clientPersonId,
        ), from, to])
        return source.slice(from, to + 1)
      },
      { pageSize: 500, maxRows: 3_000 },
    )

    assert.equal(rows.length, 2_003)
    assert.equal(rows[0]?.id, 'event-0000')
    assert.equal(rows.at(-1)?.id, 'event-2002')
    assert.deepEqual(calls.map(([, from, to]) => [from, to]), [
      [0, 499],
      [500, 999],
      [1_000, 1_499],
      [1_500, 1_999],
      [2_000, 2_499],
    ])
    assert.equal(new Set(calls.map(([key]) => key)).size, 1)
  })

  it('fails closed instead of deriving a state from truncated history', async () => {
    const source = Array.from({ length: 6 }, (_, id) => ({ id }))
    await assert.rejects(
      loadAllPortalAccountConsentEventPages(
        [scope()],
        async (_exactScope, from, to) => source.slice(from, to + 1),
        { pageSize: 3, maxRows: 5 },
      ),
      PortalAccountConsentHistoryLimitError,
    )
  })

  it('wires pagination to exact tenant, client and person filters', async () => {
    const source = await readFile(accountEndpointUrl, 'utf8')
    assert.match(source, /\.eq\('organization_id', scope\.organizationId\)/u)
    assert.match(source, /\.eq\('client_id', scope\.clientId\)/u)
    assert.match(source, /\.eq\('subject_person_id', scope\.clientPersonId\)/u)
    assert.match(source, /\.order\('occurred_at', \{ ascending: true \}\)/u)
    assert.match(source, /\.order\('id', \{ ascending: true \}\)/u)
    assert.match(source, /\.range\(from, to\)/u)
    assert.doesNotMatch(source, /crm_client_consent_events[\s\S]{0,500}\.limit\(2_000\)/u)
  })
})

describe('portal account archive confirmation', () => {
  it('requires the exact destructive-action phrase', () => {
    assert.equal(PORTAL_ACCOUNT_ARCHIVE_CONFIRMATION, 'USUŃ KONTO')
    assert.equal(isValidPortalAccountArchiveConfirmation('USUŃ KONTO'), true)
    assert.equal(isValidPortalAccountArchiveConfirmation('USUN KONTO'), false)
    assert.equal(isValidPortalAccountArchiveConfirmation('usuń konto'), false)
    assert.equal(isValidPortalAccountArchiveConfirmation(' USUŃ KONTO '), false)
    assert.equal(isValidPortalAccountArchiveConfirmation(null), false)
  })

  it('blocks only an explicitly archived lifecycle for the current identity', () => {
    const rows = [
      { auth_user_id: 'user-active', status: 'active' },
      { auth_user_id: 'user-archived', status: 'archived' },
      { auth_user_id: 'other-user', status: 'archived' },
    ]

    assert.equal(
      hasArchivedPortalAccountLifecycle(rows, 'user-archived'),
      true,
    )
    assert.equal(
      hasArchivedPortalAccountLifecycle(rows, 'user-active'),
      false,
    )
    assert.equal(
      hasArchivedPortalAccountLifecycle(rows, 'unactivated-user'),
      false,
    )
    assert.equal(
      hasArchivedPortalAccountLifecycle([
        { auth_user_id: { toString: () => 'user-archived' }, status: 'archived' },
      ], 'user-archived'),
      false,
    )
  })

  it('rate-limits password verification by endpoint, identity and trusted IP', async () => {
    const source = await readFile(archiveEndpointUrl, 'utf8')
    const limiterCall = source.indexOf('consumeOpenExpertAuthRateLimit({')
    const passwordVerification = source.indexOf('runtime.auth.api.verifyPassword({')

    assert.ok(limiterCall >= 0)
    assert.ok(passwordVerification > limiterCall)
    assert.match(source, /scope: 'client:account-archive-password'/u)
    assert.match(source, /identifier: identity\.userId/u)
    assert.match(source, /getOpenExpertTrustedClientIp\(\{/u)
    assert.match(source, /statusCode: 429/u)
    assert.match(source, /setHeader\(event, 'Retry-After'/u)
  })
})

describe('portal account archived error contract', () => {
  it('recognizes the nested Nuxt API error code used by route middleware', () => {
    assert.equal(portalAuthErrorCode({
      data: {
        data: { code: 'PORTAL_ACCOUNT_ARCHIVED' },
      },
    }), 'PORTAL_ACCOUNT_ARCHIVED')
    assert.equal(portalAuthErrorCode({
      data: { code: 'portal_account_archived' },
    }), 'PORTAL_ACCOUNT_ARCHIVED')
    assert.equal(portalAuthErrorCode({ code: 'portal_account_archived' }), 'PORTAL_ACCOUNT_ARCHIVED')
    assert.equal(portalAuthErrorCode({ data: { data: {} } }), '')
  })
})
