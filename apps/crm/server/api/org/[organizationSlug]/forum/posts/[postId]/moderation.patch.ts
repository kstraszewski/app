import { readBody, setHeader } from 'h3'
import {
  moderateOrganizationForumPost,
  parseOrganizationForumModerationId,
  parseOrganizationForumPostModerationInput,
} from '~~/server/utils/organization-forum-moderation'
import { organizationForumHttpError } from '~~/server/utils/organization-forum'
import { getRequiredParam, requireCrmSession } from '~~/server/utils/crm'
import { publishOrganizationForumChange } from '~~/server/utils/organization-forum-realtime'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    const postId = parseOrganizationForumModerationId(
      getRequiredParam(event, 'postId'),
      'postId',
    )
    const input = parseOrganizationForumPostModerationInput(await readBody(event))
    const payload = await moderateOrganizationForumPost(
      session.dataApi,
      session.organizationId,
      postId,
      input,
    )
    await publishOrganizationForumChange(event, session.dataApi, session.organizationId)
    return payload
  } catch (error) {
    throw organizationForumHttpError(error)
  }
})
