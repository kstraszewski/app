import { readBody, setHeader } from 'h3'
import {
  moderateOrganizationForumThread,
  parseOrganizationForumModerationId,
  parseOrganizationForumThreadModerationInput,
} from '~~/server/utils/organization-forum-moderation'
import { organizationForumHttpError } from '~~/server/utils/organization-forum'
import { getRequiredParam, requireCrmSession } from '~~/server/utils/crm'
import { publishOrganizationForumChange } from '~~/server/utils/organization-forum-realtime'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    const threadId = parseOrganizationForumModerationId(
      getRequiredParam(event, 'threadId'),
      'threadId',
    )
    const input = parseOrganizationForumThreadModerationInput(await readBody(event))
    const payload = await moderateOrganizationForumThread(
      session.dataApi,
      session.organizationId,
      threadId,
      input,
    )
    await publishOrganizationForumChange(event, session.dataApi, session.organizationId)
    return payload
  } catch (error) {
    throw organizationForumHttpError(error)
  }
})
