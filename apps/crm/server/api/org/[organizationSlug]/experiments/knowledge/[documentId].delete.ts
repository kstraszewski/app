import { getRouterParam, readBody } from 'h3'
import {
  experimentKnowledgeUuid,
  requireExperimentKnowledgeAccess,
} from '~~/server/utils/experiment-knowledge'

export default defineEventHandler(async (event) => {
  const context = await requireExperimentKnowledgeAccess(event)
  const documentId = experimentKnowledgeUuid(getRouterParam(event, 'documentId') ?? '')
  const body: Record<string, unknown> = await readBody<Record<string, unknown>>(event).catch(() => ({}))
  const expectedRevisionValue = body.expectedRevision
  const expectedRevision = typeof expectedRevisionValue === 'number'
    && Number.isInteger(expectedRevisionValue)
    && expectedRevisionValue >= 1
    ? expectedRevisionValue
    : null
  if (!expectedRevision) {
    throw createError({ statusCode: 400, statusMessage: 'Brakuje wersji usuwanego dokumentu.' })
  }

  const result = await context.backendData
    .from('experiment_knowledge_documents')
    .update({ archived_at: new Date().toISOString() })
    .eq('organization_id', context.session.organizationId)
    .eq('id', documentId)
    .eq('revision', expectedRevision)
    .is('archived_at', null)
    .select('id')
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Dokument nie istnieje albo został równocześnie zmieniony.',
    })
  }

  return { data: { id: documentId, archived: true } }
})
