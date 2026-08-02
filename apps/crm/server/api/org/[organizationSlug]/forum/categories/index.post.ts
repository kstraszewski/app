import { readBody, setHeader, setResponseStatus } from 'h3'
import {
  createOrganizationForumCategory,
  parseOrganizationForumCategoryCreateInput,
} from '~~/server/utils/organization-forum-moderation'
import { organizationForumHttpError } from '~~/server/utils/organization-forum'
import { requireCrmSession } from '~~/server/utils/crm'
import { publishOrganizationForumChange } from '~~/server/utils/organization-forum-realtime'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    const input = parseOrganizationForumCategoryCreateInput(await readBody(event))
    const payload = await createOrganizationForumCategory(
      session.dataApi,
      session.organizationId,
      input,
    )
    await publishOrganizationForumChange(event, session.dataApi, session.organizationId)
    setResponseStatus(event, 201)
    return payload
  } catch (error) {
    throw organizationForumHttpError(error)
  }
})
