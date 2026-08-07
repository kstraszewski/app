import { getRouterParam } from 'h3'
import {
  getExperimentKnowledgeDocument,
  requireExperimentKnowledgeAccess,
} from '~~/server/utils/experiment-knowledge'

export default defineEventHandler(async (event) => {
  const context = await requireExperimentKnowledgeAccess(event)
  const documentId = getRouterParam(event, 'documentId') ?? ''
  return { data: await getExperimentKnowledgeDocument(context, documentId) }
})
