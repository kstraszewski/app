import { useRuntimeConfig } from '#imports'
import { readBody } from 'h3'
import {
  parseExperimentKnowledgeWriteInput,
  requireExperimentKnowledgeAccess,
  writeExperimentKnowledgeDocument,
} from '~~/server/utils/experiment-knowledge'

export default defineEventHandler(async (event) => {
  const context = await requireExperimentKnowledgeAccess(event)
  const input = parseExperimentKnowledgeWriteInput(await readBody(event))
  const runtimeConfig = useRuntimeConfig(event)
  const document = await writeExperimentKnowledgeDocument(context, input, {
    googleApiKey: String(runtimeConfig.googleGenerativeAiApiKey || '').trim(),
    gatewayApiKey: String(runtimeConfig.aiGatewayApiKey || '').trim(),
  })
  setResponseStatus(event, 201)
  return { data: document }
})
