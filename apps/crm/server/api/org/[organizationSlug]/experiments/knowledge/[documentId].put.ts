import { useRuntimeConfig } from '#imports'
import { getRouterParam, readBody } from 'h3'
import {
  parseExperimentKnowledgeWriteInput,
  requireExperimentKnowledgeAccess,
  writeExperimentKnowledgeDocument,
} from '~~/server/utils/experiment-knowledge'

export default defineEventHandler(async (event) => {
  const context = await requireExperimentKnowledgeAccess(event)
  const input = parseExperimentKnowledgeWriteInput(await readBody(event))
  const documentId = getRouterParam(event, 'documentId') ?? ''
  const runtimeConfig = useRuntimeConfig(event)
  const document = await writeExperimentKnowledgeDocument(context, input, {
    documentId,
    googleApiKey: String(runtimeConfig.googleGenerativeAiApiKey || '').trim(),
    gatewayApiKey: String(runtimeConfig.aiGatewayApiKey || '').trim(),
  })
  return { data: document }
})
