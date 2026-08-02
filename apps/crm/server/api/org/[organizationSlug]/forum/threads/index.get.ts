import { useRuntimeConfig } from '#imports'
import { getQuery, setHeader } from 'h3'
import {
  listOrganizationForumThreads,
  organizationForumHttpError,
  organizationForumQueryEmbedding,
  parseOrganizationForumListInput,
} from '~~/server/utils/organization-forum'
import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'no-store')

  try {
    const input = parseOrganizationForumListInput(getQuery(event))
    let queryEmbedding: number[] | null = null
    if (input.query) {
      const config = useRuntimeConfig(event)
      try {
        queryEmbedding = await organizationForumQueryEmbedding(
          String(config.googleGenerativeAiApiKey || ''),
          input.query,
          AbortSignal.timeout(1_500),
        )
      } catch {
        queryEmbedding = null
      }
    }

    return await listOrganizationForumThreads(
      session.dataApi,
      session.organizationId,
      input,
      queryEmbedding,
    )
  } catch (error) {
    throw organizationForumHttpError(error)
  }
})
