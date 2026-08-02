import { setHeader } from 'h3'
import {
  getOrganizationForumModerationContext,
} from '~~/server/utils/organization-forum-moderation'
import { organizationForumHttpError } from '~~/server/utils/organization-forum'
import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    return await getOrganizationForumModerationContext(
      session.dataApi,
      session.organizationId,
    )
  } catch (error) {
    throw organizationForumHttpError(error)
  }
})
