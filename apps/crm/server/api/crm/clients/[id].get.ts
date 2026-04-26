import { createError } from 'h3'
import { getRequiredParam, requireCrmSession, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const id = getRequiredParam(event, 'id')

  const { data: client, error } = await session.supabase
    .from('crm_clients')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !client) {
    throw createError({ statusCode: 404, statusMessage: 'Client not found' })
  }

  const [peopleResult, casesResult, activitiesResult] = await Promise.all([
    session.supabase.from('crm_client_people').select('*').eq('client_id', id).order('created_at'),
    session.supabase.from('crm_cases').select('*').eq('client_id', id).order('updated_at', { ascending: false }),
    session.supabase.from('crm_activities').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(30),
  ])

  throwDbError(peopleResult.error)
  throwDbError(casesResult.error)
  throwDbError(activitiesResult.error)

  return {
    data: client,
    people: peopleResult.data ?? [],
    cases: casesResult.data ?? [],
    activities: activitiesResult.data ?? [],
  }
})

