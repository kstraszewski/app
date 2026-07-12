import { requireCrmSession, throwDbError } from '~~/server/utils/crm'

type Row = Record<string, any>

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const now = new Date()
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)

  const [
    clientsResult,
    casesResult,
    itemsResult,
    tasksResult,
    settlementsResult,
    submissionsResult,
  ] = await Promise.all([
    session.supabase.from('crm_clients').select('id, display_name, status_code, updated_at').eq('organization_id', session.organizationId).order('updated_at', { ascending: false }).limit(8),
    session.supabase.from('crm_cases').select('id, client_id, title, status_code, priority, updated_at').eq('organization_id', session.organizationId).order('updated_at', { ascending: false }).limit(20),
    session.supabase.from('crm_case_items').select('id, case_id, title, status_code, amount_value, currency, updated_at').eq('organization_id', session.organizationId).order('updated_at', { ascending: false }).limit(20),
    session.supabase.from('crm_tasks').select('*').eq('organization_id', session.organizationId).neq('status_code', 'done').lte('due_at', endOfToday.toISOString()).order('due_at', { ascending: true }).limit(12),
    session.supabase.from('crm_case_item_settlements').select('status_code, expected_amount, due_amount, paid_amount, currency').eq('organization_id', session.organizationId),
    session.supabase.from('crm_item_submissions').select('status_code').eq('organization_id', session.organizationId).limit(500),
  ])

  throwDbError(clientsResult.error)
  throwDbError(casesResult.error)
  throwDbError(itemsResult.error)
  throwDbError(tasksResult.error)
  throwDbError(settlementsResult.error)
  throwDbError(submissionsResult.error)

  const clientsById = new Map(((clientsResult.data ?? []) as Row[]).map((client: Row) => [String(client.id), client]))
  const activeCases = ((casesResult.data ?? []) as Row[]).filter((item: Row) => !['zakonczona', 'utracona', 'archiwum'].includes(String(item.status_code)))
  const dueToday = tasksResult.data ?? []
  const settlements = (settlementsResult.data ?? []) as Row[]
  const dueRevenue = settlements.reduce((sum: number, settlement: Row) => sum + Number(settlement.due_amount ?? 0), 0)
  const paidRevenue = settlements.reduce((sum: number, settlement: Row) => sum + Number(settlement.paid_amount ?? 0), 0)
  const acceptedSubmissions = ((submissionsResult.data ?? []) as Row[]).filter((item: Row) => item.status_code === 'zaakceptowane').length

  return {
    metrics: [
      { label: 'Aktywne sprawy', value: activeCases.length, icon: 'i-lucide-briefcase-business' },
      { label: 'Follow-up dziś', value: dueToday.length, icon: 'i-lucide-calendar-check' },
      { label: 'Prowizje należne', value: dueRevenue, currency: 'PLN', icon: 'i-lucide-wallet-cards' },
      { label: 'Prowizje zapłacone', value: paidRevenue, currency: 'PLN', icon: 'i-lucide-badge-check' },
    ],
    cases: activeCases.slice(0, 8).map((caseRow: Row) => ({
      ...caseRow,
      client: clientsById.get(String(caseRow.client_id)) ?? null,
    })),
    items: itemsResult.data ?? [],
    tasks: dueToday,
    clients: clientsResult.data ?? [],
    submissions: {
      accepted: acceptedSubmissions,
      total: submissionsResult.data?.length ?? 0,
    },
  }
})
