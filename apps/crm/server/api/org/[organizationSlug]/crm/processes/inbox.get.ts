import { requireCrmSession, throwDbError } from '~~/server/utils/crm'

type Row = Record<string, any>

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)

  const [pendingResult, ownedResult] = await Promise.all([
    session.dataApi
      .from('crm_case_item_handoffs')
      .select('id, case_id, case_item_id, previous_owner_user_id, proposed_owner_user_id, requested_by_user_id, status, request_note, requested_at')
      .eq('organization_id', session.organizationId)
      .eq('proposed_owner_user_id', session.userId)
      .eq('status', 'pending')
      .order('requested_at', { ascending: false })
      .limit(8),
    session.dataApi
      .from('crm_case_items')
      .select(`
        id,
        case_id,
        owner_user_id,
        title,
        status_code,
        expected_close_date,
        updated_at,
        product_type:crm_product_types!crm_case_items_product_type_id_fkey(
          id,
          domain,
          code,
          name
        )
      `)
      .eq('organization_id', session.organizationId)
      .eq('owner_user_id', session.userId)
      .is('won_at', null)
      .is('lost_at', null)
      .order('updated_at', { ascending: false })
      .limit(8),
  ])
  throwDbError(pendingResult.error)
  throwDbError(ownedResult.error)

  const pending = (pendingResult.data ?? []) as Row[]
  const owned = (ownedResult.data ?? []) as Row[]
  const pendingItemIds = pending.map(row => String(row.case_item_id))
  const pendingItemsResult = pendingItemIds.length
    ? await session.dataApi
        .from('crm_case_items')
        .select(`
          id,
          case_id,
          owner_user_id,
          title,
          status_code,
          expected_close_date,
          updated_at,
          product_type:crm_product_types!crm_case_items_product_type_id_fkey(
            id,
            domain,
            code,
            name
          )
        `)
        .eq('organization_id', session.organizationId)
        .in('id', pendingItemIds)
    : { data: [], error: null }
  throwDbError(pendingItemsResult.error)

  const pendingItems = (pendingItemsResult.data ?? []) as Row[]
  const allItems = [...pendingItems, ...owned]
  const caseIds = [...new Set(allItems.map(item => String(item.case_id)))]
  const profileIds = [...new Set(pending.flatMap(row => [
    row.requested_by_user_id ? String(row.requested_by_user_id) : null,
    row.previous_owner_user_id ? String(row.previous_owner_user_id) : null,
  ]).filter((id): id is string => Boolean(id)))]

  const [casesResult, profilesResult] = await Promise.all([
    caseIds.length
      ? session.dataApi
          .from('crm_cases')
          .select('id, title')
          .eq('organization_id', session.organizationId)
          .in('id', caseIds)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length
      ? session.dataApi
          .from('organization_memberships')
          .select('user_id, user:users!organization_memberships_user_id_fkey!inner(id, email, full_name)')
          .eq('organization_id', session.organizationId)
          .in('user_id', profileIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  throwDbError(casesResult.error)
  throwDbError(profilesResult.error)

  const itemById = new Map(pendingItems.map(item => [String(item.id), item]))
  const caseById = new Map(((casesResult.data ?? []) as Row[]).map(caseRow => [String(caseRow.id), caseRow]))
  const profileById = new Map(((profilesResult.data ?? []) as Row[]).flatMap((membership) => {
    const user = singleRelation<Row>(membership.user)
    return user ? [[String(membership.user_id), user] as const] : []
  }))

  function processSummary(item: Row) {
    return {
      ...item,
      product_type: singleRelation<Row>(item.product_type),
      case: caseById.get(String(item.case_id)) ?? null,
    }
  }

  return {
    data: {
      pending: pending.flatMap((handoff) => {
        const item = itemById.get(String(handoff.case_item_id))
        if (!item) return []
        return [{
          ...handoff,
          process: processSummary(item),
          requested_by: handoff.requested_by_user_id
            ? profileById.get(String(handoff.requested_by_user_id)) ?? null
            : null,
        }]
      }),
      owned: owned.map(processSummary),
    },
  }
})
