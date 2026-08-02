import { getQuery, setHeader } from 'h3'
import {
  listOrganizationForumModerationItems,
  parseOrganizationForumModerationItemsInput,
} from '~~/server/utils/organization-forum-moderation'
import { organizationForumHttpError } from '~~/server/utils/organization-forum'
import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    const { limit } = parseOrganizationForumModerationItemsInput(getQuery(event))
    return await listOrganizationForumModerationItems(
      session.dataApi,
      session.organizationId,
      limit,
    )
  } catch (error) {
    throw organizationForumHttpError(error)
  }
})
