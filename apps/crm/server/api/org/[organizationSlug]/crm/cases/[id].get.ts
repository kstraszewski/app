import { createError } from 'h3'
import { getRequiredParam, requireCrmSession, throwDbError } from '~~/server/utils/crm'

type Row = Record<string, any>

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')

  const { data: caseRow, error } = await session.supabase
    .from('crm_cases')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('id', id)
    .single()

  if (error || !caseRow) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const [
    clientResult,
    peopleResult,
    participantsResult,
    itemsResult,
    submissionsResult,
    settlementsResult,
    tasksResult,
    documentsResult,
    propertiesResult,
    activitiesResult,
  ] = await Promise.all([
    session.supabase.from('crm_clients').select('*').eq('organization_id', session.organizationId).eq('id', caseRow.client_id).single(),
    session.supabase.from('crm_client_people').select('*').eq('organization_id', session.organizationId).eq('client_id', caseRow.client_id).order('created_at'),
    session.supabase.from('crm_case_participants').select('*').eq('organization_id', session.organizationId).eq('case_id', id),
    session.supabase.from('crm_case_items').select('*').eq('organization_id', session.organizationId).eq('case_id', id).order('updated_at', { ascending: false }),
    session.supabase.from('crm_item_submissions').select('*').eq('organization_id', session.organizationId).order('updated_at', { ascending: false }),
    session.supabase.from('crm_case_item_settlements').select('*').eq('organization_id', session.organizationId),
    session.supabase.from('crm_tasks').select('*').eq('organization_id', session.organizationId).eq('case_id', id).order('due_at', { ascending: true }),
    session.supabase.from('crm_documents').select('*').eq('organization_id', session.organizationId).eq('case_id', id).order('created_at', { ascending: false }),
    session.supabase.from('crm_properties').select('*').eq('organization_id', session.organizationId).eq('case_id', id).order('created_at', { ascending: false }),
    session.supabase.from('crm_activities').select('*').eq('organization_id', session.organizationId).eq('case_id', id).order('created_at', { ascending: false }).limit(80),
  ])

  throwDbError(clientResult.error)
  throwDbError(peopleResult.error)
  throwDbError(participantsResult.error)
  throwDbError(itemsResult.error)
  throwDbError(submissionsResult.error)
  throwDbError(settlementsResult.error)
  throwDbError(tasksResult.error)
  throwDbError(documentsResult.error)
  throwDbError(propertiesResult.error)
  throwDbError(activitiesResult.error)

  const itemIds = new Set(((itemsResult.data ?? []) as Row[]).map((item: Row) => String(item.id)))
  const submissionsByItem = new Map<string, unknown[]>()
  for (const submission of (submissionsResult.data ?? []) as Row[]) {
    if (!itemIds.has(String(submission.case_item_id))) continue
    const itemKey = String(submission.case_item_id)
    submissionsByItem.set(itemKey, [...(submissionsByItem.get(itemKey) ?? []), submission])
  }

  const settlementsByItem = new Map(((settlementsResult.data ?? []) as Row[])
    .filter((settlement: Row) => itemIds.has(String(settlement.case_item_id)))
    .map((settlement: Row) => [String(settlement.case_item_id), settlement]))

  return {
    data: {
      ...caseRow,
      client: clientResult.data,
      people: peopleResult.data ?? [],
      participants: participantsResult.data ?? [],
      items: ((itemsResult.data ?? []) as Row[]).map((item: Row) => ({
        ...item,
        submissions: submissionsByItem.get(String(item.id)) ?? [],
        settlement: settlementsByItem.get(String(item.id)) ?? null,
      })),
      tasks: tasksResult.data ?? [],
      documents: documentsResult.data ?? [],
      properties: propertiesResult.data ?? [],
      activities: activitiesResult.data ?? [],
    },
  }
})
