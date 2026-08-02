import { randomUUID } from 'node:crypto'
import { readBody, setResponseStatus } from 'h3'
import {
  createOrganizationForumThread,
  organizationForumHttpError,
  parseOrganizationForumCreateThreadInput,
} from '~~/server/utils/organization-forum'
import { requireCrmSession } from '~~/server/utils/crm'
import { publishOrganizationForumChange } from '~~/server/utils/organization-forum-realtime'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)

  try {
    const input = parseOrganizationForumCreateThreadInput(await readBody(event))
    const payload = await createOrganizationForumThread(
      session.dataApi,
      session.organizationId,
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
