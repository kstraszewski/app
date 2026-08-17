import { createError } from 'h3'
import type { MailComposerContextCasesPayload } from '~~/shared/types/mail'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  groupMailComposerContextCases,
  parseMailComposerContextClientIds,
} from '~~/server/utils/mail-composer-context'
import { readMailContextJsonObject } from '~~/server/utils/mail-context-http'
import {
  requireSameOriginMailRequest,
  setPrivateMailResponseHeaders,
} from '~~/server/utils/mail-http'

export default defineEventHandler(async (event): Promise<MailComposerContextCasesPayload> => {
  setPrivateMailResponseHeaders(event)
  requireSameOriginMailRequest(event)
  const session = await requireCrmSession(event)
  const body = await readMailContextJsonObject(event, ['clientIds'])
  const clientIds = parseMailComposerContextClientIds(body.clientIds)

  const [clientsResult, linksResult, fallbackCasesResult] = await Promise.all([
    session.dataApi
      .from('crm_clients')
      .select('id')
      .eq('organization_id', session.organizationId)
      .in('id', clientIds),
    session.dataApi
      .from('crm_case_clients')
      .select('client_id, case_id')
      .eq('organization_id', session.organizationId)
      .in('client_id', clientIds),
    session.dataApi
      .from('crm_cases')
      .select('id, title, closed_at, updated_at, client_id')
      .eq('organization_id', session.organizationId)
      .in('client_id', clientIds),
  ])
  throwDbError(clientsResult.error)
  throwDbError(linksResult.error)
  throwDbError(fallbackCasesResult.error)

  const foundClientIds = new Set(
    (clientsResult.data ?? []).map((row: { id?: unknown }) => String(row.id ?? '').toLowerCase()),
  )
  if (clientIds.some(clientId => !foundClientIds.has(clientId))) {
    throw createError({ statusCode: 404, statusMessage: 'Klient nie istnieje.' })
  }

  const linkedCaseIds = [...new Set(
    (linksResult.data ?? [])
      .map((row: { case_id?: unknown }) => String(row.case_id ?? '').trim().toLowerCase())
      .filter(Boolean),
  )]
  const linkedCasesResult = linkedCaseIds.length
    ? await session.dataApi
        .from('crm_cases')
        .select('id, title, closed_at, updated_at')
        .eq('organization_id', session.organizationId)
        .in('id', linkedCaseIds)
    : { data: [], error: null }
  throwDbError(linkedCasesResult.error)

  return {
    data: groupMailComposerContextCases(
      clientIds,
      fallbackCasesResult.data ?? [],
      linksResult.data ?? [],
      linkedCasesResult.data ?? [],
    ),
  }
})
