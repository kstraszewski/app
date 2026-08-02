import { readBody, setHeader } from 'h3'
import {
  parseOrganizationForumCategoryUpdateInput,
  parseOrganizationForumModerationId,
  updateOrganizationForumCategory,
} from '~~/server/utils/organization-forum-moderation'
import { organizationForumHttpError } from '~~/server/utils/organization-forum'
import { getRequiredParam, requireCrmSession } from '~~/server/utils/crm'
import { publishOrganizationForumChange } from '~~/server/utils/organization-forum-realtime'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    const categoryId = parseOrganizationForumModerationId(
      getRequiredParam(event, 'categoryId'),
      'categoryId',
    )
    const input = parseOrganizationForumCategoryUpdateInput(await readBody(event))
    const payload = await updateOrganizationForumCategory(
      session.dataApi,
      session.organizationId,
      categoryId,
      input,
    )
    await publishOrganizationForumChange(event, session.dataApi, session.organizationId)
    return payload
  } catch (error) {
    throw organizationForumHttpError(error)
  }
})
