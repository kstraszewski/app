import { getQuery, setHeader } from 'h3'
import type { NotificationFeedResponse } from '~~/shared/types/notifications'
import { requireCrmSession } from '~~/server/utils/crm'
import { notificationRealtime } from '~~/server/utils/notification-realtime'
import {
  loadNotificationFeed,
  parseNotificationFeedQuery,
} from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = parseNotificationFeedQuery(getQuery(event))
  const feed = await loadNotificationFeed(session, query)
  return {
    ...feed,
    realtime: notificationRealtime(event, session.organizationId, session.userId),
  } satisfies NotificationFeedResponse
})
