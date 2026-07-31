import { requireCrmSession, throwDbError } from '~~/server/utils/crm'

type DashboardCaseRow = {
  status_code: string | null
}

type DashboardSettlementRow = {
  due_amount: number | null
  paid_amount: number | null
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const now = new Date()
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)

  const [
    casesResult,
    tasksResult,
    settlementsResult,
  ] = await Promise.all([
    session.dataApi.from('crm_cases').select('status_code').eq('organization_id', session.organizationId),
    session.dataApi.from('crm_tasks').select('id').eq('organization_id', session.organizationId).neq('status_code', 'done').lte('due_at', endOfToday.toISOString()),
    session.dataApi.from('crm_case_item_settlements').select('status_code, expected_amount, due_amount, paid_amount, currency').eq('organization_id', session.organizationId),
  ])

  throwDbError(casesResult.error)
  throwDbError(tasksResult.error)
  throwDbError(settlementsResult.error)

  const activeCases = ((casesResult.data ?? []) as DashboardCaseRow[])
    .filter(item => !['zakonczona', 'utracona', 'archiwum'].includes(String(item.status_code)))
  const dueToday = tasksResult.data ?? []
  const settlements = (settlementsResult.data ?? []) as DashboardSettlementRow[]
  const dueRevenue = settlements.reduce((sum, settlement) => sum + Number(settlement.due_amount ?? 0), 0)
  const paidRevenue = settlements.reduce((sum, settlement) => sum + Number(settlement.paid_amount ?? 0), 0)

  return {
    currentUserId: session.userId,
    metrics: [
      { label: 'Aktywne sprawy', value: activeCases.length, icon: 'i-lucide-briefcase-business' },
      { label: 'Follow-up dziś', value: dueToday.length, icon: 'i-lucide-calendar-check' },
      { label: 'Prowizje należne', value: dueRevenue, currency: 'PLN', icon: 'i-lucide-wallet-cards' },
      { label: 'Prowizje zapłacone', value: paidRevenue, currency: 'PLN', icon: 'i-lucide-badge-check' },
    ],
  }
})
