import type { CrmSession } from '~~/server/utils/crm'
import { throwDbError } from '~~/server/utils/crm'

type Row = Record<string, any>
export type SalesRangeKey = '30d' | '90d' | '12m'

export interface SalesScope {
  type: 'user' | 'team'
  id: string
  label: string
  memberCount: number
}

export interface BuildSalesPayloadOptions {
  range?: unknown
  currency?: unknown
  scope?: SalesScope
}

export interface TeamEdge {
  parent_team_id: string
  child_team_id: string
}

interface TeamMembership {
  team_id: string
  user_id: string
}

const PAGE_SIZE = 500
const ID_BATCH_SIZE = 100
const WON_STATUSES = new Set(['uruchomiony', 'aktywna', 'zamknieta'])
const LOST_STATUSES = new Set(['utracony', 'utracona'])
const RANGE_CONFIG: Record<SalesRangeKey, { days: number; label: string; bucketDays: number }> = {
  '30d': { days: 30, label: 'Ostatnie 30 dni', bucketDays: 1 },
  '90d': { days: 90, label: 'Ostatnie 90 dni', bucketDays: 7 },
  '12m': { days: 365, label: 'Ostatnie 12 miesięcy', bucketDays: 30 },
}
const DOMAIN_LABELS: Record<string, string> = {
  credit: 'Kredyty',
  insurance: 'Ubezpieczenia',
  real_estate: 'Nieruchomości',
  other: 'Pozostałe',
}

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function parseRange(value: unknown): SalesRangeKey {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate === '30d' || candidate === '12m' ? candidate : '90d'
}

function numberValue(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function statusCode(row: Row): string {
  return String(row.status_code ?? '')
}

function isWon(row: Row): boolean {
  return WON_STATUSES.has(statusCode(row)) && Boolean(row.won_at)
}

function isLost(row: Row): boolean {
  return LOST_STATUSES.has(statusCode(row)) && Boolean(row.lost_at)
}

function isPipeline(row: Row): boolean {
  return !WON_STATUSES.has(statusCode(row)) && !LOST_STATUSES.has(statusCode(row))
}

function isWithin(value: unknown, from: Date, to: Date): boolean {
  if (typeof value !== 'string' || !value) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && time >= from.getTime() && time < to.getTime()
}

function percentChange(current: number, previous: number): number | null {
  if (!previous) return null
  return Math.round(((current - previous) / previous) * 1_000) / 10
}

function percent(value: number, total: number): number {
  if (!total) return 0
  return Math.round((value / total) * 1_000) / 10
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1_000)
}

function dateAtNextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  ))
}

function chunks<T>(values: T[], size = ID_BATCH_SIZE): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

export function collectTeamScopeIds(teamId: string, edges: TeamEdge[]): string[] {
  const descendantsByParent = new Map<string, string[]>()
  for (const edge of edges) {
    const parentId = String(edge.parent_team_id)
    const childId = String(edge.child_team_id)
    const descendants = descendantsByParent.get(parentId) ?? []
    descendants.push(childId)
    descendantsByParent.set(parentId, descendants)
  }

  const scopeIds = new Set([teamId])
  const pending = [teamId]
  while (pending.length) {
    const parentId = pending.shift()
    if (!parentId) continue
    for (const childId of descendantsByParent.get(parentId) ?? []) {
      if (scopeIds.has(childId)) continue
      scopeIds.add(childId)
      pending.push(childId)
    }
  }

  return [...scopeIds]
}

async function loadAllOrganizationRows(
  session: CrmSession,
  table: string,
  select: string,
  orderColumns: string[],
): Promise<Row[]> {
  const rows: Row[] = []
  let offset = 0

  while (true) {
    let query = session.supabase
      .from(table)
      .select(select)
      .eq('organization_id', session.organizationId)

    for (const column of orderColumns) {
      query = query.order(column, { ascending: true })
    }

    const result = await query.range(offset, offset + PAGE_SIZE - 1)
    throwDbError(result.error)
    const page = (result.data ?? []) as Row[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return rows
}

export async function resolveTeamSalesOwnerUserIds(
  session: CrmSession,
  teamId: string,
): Promise<string[]> {
  const [edges, memberships] = await Promise.all([
    loadAllOrganizationRows(
      session,
      'team_edges',
      'parent_team_id, child_team_id',
      ['parent_team_id', 'child_team_id'],
    ),
    loadAllOrganizationRows(
      session,
      'team_memberships',
      'team_id, user_id',
      ['team_id', 'user_id'],
    ),
  ])

  const teamScopeIds = new Set(collectTeamScopeIds(teamId, edges as TeamEdge[]))
  return [...new Set(
    (memberships as TeamMembership[])
      .filter(membership => teamScopeIds.has(String(membership.team_id)))
      .map(membership => String(membership.user_id))
      .filter(Boolean),
  )]
}

async function loadSalesItems(session: CrmSession, ownerUserIds: string[]): Promise<Row[]> {
  const rows: Row[] = []
  const uniqueOwnerUserIds = [...new Set(ownerUserIds.filter(Boolean))]
  if (!uniqueOwnerUserIds.length) return rows

  for (const ownerBatch of chunks(uniqueOwnerUserIds)) {
    let offset = 0

    while (true) {
      const result = await session.supabase
        .from('crm_case_items')
        .select(`
          id,
          case_id,
          product_type_id,
          owner_user_id,
          title,
          status_code,
          amount_value,
          currency,
          expected_close_date,
          won_at,
          lost_at,
          created_at,
          updated_at,
          product_type:crm_product_types!crm_case_items_product_type_id_fkey(
            id,
            domain,
            code,
            name
          )
        `)
        .eq('organization_id', session.organizationId)
        .in('owner_user_id', ownerBatch)
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)

      throwDbError(result.error)
      const page = (result.data ?? []) as Row[]
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }
  }

  return rows
}

async function loadRowsByIds(
  session: CrmSession,
  table: string,
  select: string,
  column: string,
  ids: string[],
): Promise<Row[]> {
  const rows: Row[] = []

  for (const batch of chunks([...new Set(ids)])) {
    const result = await session.supabase
      .from(table)
      .select(select)
      .eq('organization_id', session.organizationId)
      .in(column, batch)

    throwDbError(result.error)
    rows.push(...((result.data ?? []) as Row[]))
  }

  return rows
}

function buildTrend(
  wins: Row[],
  from: Date,
  to: Date,
  bucketDays: number,
) {
  const buckets: Array<{ date: string; periodEnd: string; wonCount: number }> = []

  for (let cursor = new Date(from); cursor < to; cursor = addDays(cursor, bucketDays)) {
    const periodEnd = new Date(Math.min(addDays(cursor, bucketDays).getTime(), to.getTime()))
    buckets.push({
      date: cursor.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      wonCount: wins.filter(item => isWithin(item.won_at, cursor, periodEnd)).length,
    })
  }

  return buckets
}

export async function buildSalesPayload(
  session: CrmSession,
  ownerUserIds: string[],
  options: BuildSalesPayloadOptions = {},
) {
  const rangeKey = parseRange(options.range)
  const rangeConfig = RANGE_CONFIG[rangeKey]
  const generatedAt = new Date()
  const to = dateAtNextUtcMidnight(generatedAt)
  const from = addDays(to, -rangeConfig.days)
  const previousTo = new Date(from)
  const previousFrom = addDays(previousTo, -rangeConfig.days)

  const uniqueOwnerUserIds = [...new Set(ownerUserIds.filter(Boolean))]
  const items = await loadSalesItems(session, uniqueOwnerUserIds)
  const itemIds = items.map(item => String(item.id))
  const caseIds = items.map(item => String(item.case_id))
  const [settlements, cases] = await Promise.all([
    itemIds.length
      ? loadRowsByIds(
          session,
          'crm_case_item_settlements',
          'id, case_item_id, status_code, expected_amount, due_amount, paid_amount, currency, due_date, paid_at, created_at, updated_at',
          'case_item_id',
          itemIds,
        )
      : Promise.resolve([]),
    caseIds.length
      ? loadRowsByIds(session, 'crm_cases', 'id, client_id, title', 'id', caseIds)
      : Promise.resolve([]),
  ])
  const clientIds = cases.flatMap(caseRow => caseRow.client_id ? [String(caseRow.client_id)] : [])
  const clients = clientIds.length
    ? await loadRowsByIds(session, 'crm_clients', 'id, display_name', 'id', clientIds)
    : []

  const availableCurrencies = [...new Set([
    ...items.map(item => String(item.currency ?? '').toUpperCase()),
    ...settlements.map(settlement => String(settlement.currency ?? '').toUpperCase()),
  ].filter(currency => /^[A-Z]{3}$/.test(currency)))].sort()
  const requestedCurrency = String(
    Array.isArray(options.currency) ? options.currency[0] : options.currency ?? '',
  ).toUpperCase()
  const currency = availableCurrencies.includes(requestedCurrency)
    ? requestedCurrency
    : availableCurrencies.includes('PLN')
      ? 'PLN'
      : availableCurrencies[0] ?? 'PLN'
  const returnedCurrencies = availableCurrencies.length ? availableCurrencies : [currency]
  const currencyItems = items.filter(item => String(item.currency ?? '').toUpperCase() === currency)
  const currencySettlements = settlements.filter(settlement => String(settlement.currency ?? '').toUpperCase() === currency)
  const caseById = new Map(cases.map(caseRow => [String(caseRow.id), caseRow]))
  const clientById = new Map(clients.map(client => [String(client.id), client]))
  const settlementsByItemId = new Map<string, Row>()
  for (const settlement of currencySettlements) {
    settlementsByItemId.set(String(settlement.case_item_id), settlement)
  }

  const allWins = currencyItems.filter(isWon)
  const allLosses = currencyItems.filter(isLost)
  const currentWins = allWins.filter(item => isWithin(item.won_at, from, to))
  const previousWins = allWins.filter(item => isWithin(item.won_at, previousFrom, previousTo))
  const currentLosses = allLosses.filter(item => isWithin(item.lost_at, from, to))
  const previousLosses = allLosses.filter(item => isWithin(item.lost_at, previousFrom, previousTo))
  const currentOutcomes = currentWins.length + currentLosses.length
  const previousOutcomes = previousWins.length + previousLosses.length
  const currentConversion = percent(currentWins.length, currentOutcomes)
  const previousConversion = percent(previousWins.length, previousOutcomes)
  const activeSettlements = currencySettlements.filter(settlement => statusCode(settlement) !== 'anulowane')
  const expectedCommission = activeSettlements.reduce(
    (sum, settlement) => sum + numberValue(settlement.expected_amount),
    0,
  )
  const dueCommission = activeSettlements.reduce(
    (sum, settlement) => sum + numberValue(settlement.due_amount),
    0,
  )
  const paidCommission = activeSettlements.reduce(
    (sum, settlement) => sum + numberValue(settlement.paid_amount),
    0,
  )
  const pipelineItems = currencyItems.filter(isPipeline)

  const categoryMap = new Map<string, {
    domain: string
    label: string
    wonCount: number
    wonVolume: number
    pipelineCount: number
    pipelineVolume: number
  }>()
  function categoryForItem(item: Row) {
    const productType = singleRelation<Row>(item.product_type)
    const domain = String(productType?.domain ?? 'other')
    const existing = categoryMap.get(domain)
    if (existing) return existing
    const category = {
      domain,
      label: DOMAIN_LABELS[domain] ?? productType?.name ?? 'Pozostałe',
      wonCount: 0,
      wonVolume: 0,
      pipelineCount: 0,
      pipelineVolume: 0,
    }
    categoryMap.set(domain, category)
    return category
  }
  for (const item of currencyItems) categoryForItem(item)
  for (const item of currentWins) {
    const category = categoryForItem(item)
    category.wonCount += 1
    category.wonVolume += numberValue(item.amount_value)
  }
  for (const item of pipelineItems) {
    const category = categoryForItem(item)
    category.pipelineCount += 1
    category.pipelineVolume += numberValue(item.amount_value)
  }
  const pipelineMap = new Map<string, number>()
  for (const item of pipelineItems) {
    pipelineMap.set(statusCode(item) || 'bez_statusu', (pipelineMap.get(statusCode(item) || 'bez_statusu') ?? 0) + 1)
  }

  const recentWins = [...allWins]
    .sort((left, right) => String(right.won_at).localeCompare(String(left.won_at)))
    .slice(0, 8)
    .map((item) => {
      const caseRow = caseById.get(String(item.case_id))
      const client = caseRow?.client_id ? clientById.get(String(caseRow.client_id)) : null
      const productType = singleRelation<Row>(item.product_type)
      const settlement = settlementsByItemId.get(String(item.id))

      return {
        id: String(item.id),
        caseId: String(item.case_id),
        caseTitle: String(caseRow?.title ?? 'Sprawa klienta'),
        clientName: String(client?.display_name ?? 'Klient bez nazwy'),
        productName: String(productType?.name ?? 'Produkt'),
        title: String(item.title ?? productType?.name ?? 'Produkt'),
        statusCode: statusCode(item),
        amountValue: numberValue(item.amount_value),
        currency: String(item.currency ?? currency),
        paidCommission: numberValue(settlement?.paid_amount),
        wonAt: String(item.won_at),
      }
    })

  return {
    data: {
      currentUserId: session.userId,
      scope: options.scope ?? {
        type: 'user',
        id: session.userId,
        label: session.fullName || session.email || 'Moja sprzedaż',
        memberCount: uniqueOwnerUserIds.length,
      },
      generatedAt: generatedAt.toISOString(),
      range: {
        key: rangeKey,
        label: rangeConfig.label,
        from: from.toISOString(),
        to: to.toISOString(),
        previousFrom: previousFrom.toISOString(),
        previousTo: previousTo.toISOString(),
      },
      currency,
      availableCurrencies: returnedCurrencies,
      summary: {
        wonCount: {
          current: currentWins.length,
          previous: previousWins.length,
          changeValue: percentChange(currentWins.length, previousWins.length),
          changeKind: 'percent',
        },
        lostCount: {
          current: currentLosses.length,
          previous: previousLosses.length,
          changeValue: percentChange(currentLosses.length, previousLosses.length),
          changeKind: 'percent',
        },
        conversionRate: {
          current: currentConversion,
          previous: previousConversion,
          changeValue: previousOutcomes
            ? Math.round((currentConversion - previousConversion) * 10) / 10
            : null,
          changeKind: 'points',
        },
        pipelineCount: pipelineItems.length,
      },
      commissions: {
        expected: expectedCommission,
        due: dueCommission,
        paid: paidCommission,
        outstanding: dueCommission,
      },
      trend: buildTrend(currentWins, from, to, rangeConfig.bucketDays),
      categories: [...categoryMap.values()].sort((left, right) => (
        right.wonCount - left.wonCount
        || right.pipelineCount - left.pipelineCount
        || left.label.localeCompare(right.label, 'pl')
      )),
      pipeline: [...pipelineMap.entries()]
        .map(([pipelineStatus, count]) => ({
          statusCode: pipelineStatus,
          count,
          share: percent(count, pipelineItems.length),
        }))
        .sort((left, right) => right.count - left.count),
      recentWins,
    },
  }
}
