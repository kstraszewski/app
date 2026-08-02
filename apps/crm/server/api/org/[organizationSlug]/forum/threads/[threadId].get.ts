import { setHeader } from 'h3'
import {
  getOrganizationForumThread,
  organizationForumHttpError,
  parseOrganizationForumThreadId,
} from '~~/server/utils/organization-forum'
import { getRequiredParam, requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'no-store')

  try {
    const threadId = parseOrganizationForumThreadId(getRequiredParam(event, 'threadId'))
    return await getOrganizationForumThread(
      session.dataApi,
      session.organizationId,
      threadId,
    )
  } catch (error) {
    throw organizationForumHttpError(error)
  }
})
