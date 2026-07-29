import { setHeader } from 'h3'
import {
  requireAdministrativePermission,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'

type AnonymizationRequestRow = {
  id: string
  client_id: string
  request_number: string
  status: string
  due_at: string
}

type ClientRow = {
  id: string
  display_name: string
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireAdministrativePermission(session, 'privacy.requests.read')
  setHeader(event, 'Cache-Control', 'no-store')

  const { data: requests, error: requestsError } = await session.supabase
    .from('crm_client_anonymization_requests')
    .select('id, client_id, request_number, status, due_at')
    .eq('organization_id', session.organizationId)
    .in('status', ['approved', 'in_progress'])
    .order('due_at', { ascending: true })
    .order('request_number', { ascending: true })
  throwDbError(requestsError)

  const requestRows = (requests ?? []) as AnonymizationRequestRow[]
  const clientIds = [...new Set(requestRows.map(request => String(request.client_id)))]
  const { data: clients, error: clientsError } = clientIds.length
    ? await session.supabase
        .from('crm_clients')
        .select('id, display_name')
        .eq('organization_id', session.organizationId)
        .in('id', clientIds)
    : { data: [], error: null }
  throwDbError(clientsError)

  const clientById = new Map<string, ClientRow>(
    ((clients ?? []) as ClientRow[]).map(client => [String(client.id), client]),
  )

  return {
    data: requestRows.flatMap((request) => {
      const client = clientById.get(String(request.client_id))
      if (!client) return []
      return [{
        id: String(request.id),
        requestNumber: String(request.request_number),
        status: String(request.status),
        dueAt: String(request.due_at),
        client: {
          id: String(client.id),
          displayName: String(client.display_name),
        },
      }]
    }),
  }
})
