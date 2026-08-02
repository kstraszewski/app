import { randomUUID } from 'node:crypto'
import { readBody, setResponseStatus } from 'h3'
import {
  createOrganizationForumReply,
  organizationForumHttpError,
  parseOrganizationForumCreateReplyInput,
  parseOrganizationForumThreadId,
} from '~~/server/utils/organization-forum'
import { getRequiredParam, requireCrmSession } from '~~/server/utils/crm'
import { publishOrganizationForumChange } from '~~/server/utils/organization-forum-realtime'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)

  try {
    const threadId = parseOrganizationForumThreadId(getRequiredParam(event, 'threadId'))
    const input = parseOrganizationForumCreateReplyInput(await readBody(event))
    const payload = await createOrganizationForumReply(
      session.dataApi,
      session.organizationId,
      threadId,
      {
        ...input,
        clientRequestId: input.clientRequestId ?? randomUUID(),
      },
    )
    await publishOrganizationForumChange(event, session.dataApi, session.organizationId)
    setResponseStatus(event, 201)
    return payload
  } catch (error) {
    throw organizationForumHttpError(error)
  }
})
