import { setHeader } from 'h3'
import {
  loadOrganizationForumRealtimeSnapshot,
  organizationForumHttpError,
} from '~~/server/utils/organization-forum'
import { organizationForumRealtime } from '~~/server/utils/organization-forum-realtime'
import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    const snapshot = await loadOrganizationForumRealtimeSnapshot(
      session.dataApi,
      session.organizationId,
    )

    return {
      ...snapshot,
      realtime: organizationForumRealtime(event, session.organizationId),
    }
  }
  catch (error) {
    throw organizationForumHttpError(error)
  }
})
