import { setHeader } from 'h3'
import type { NotificationRealtimeSnapshotResponse } from '~~/shared/types/notifications'
import { requireCrmSession } from '~~/server/utils/crm'
import { notificationRealtime } from '~~/server/utils/notification-realtime'
import { loadNotificationRealtimeSnapshot } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  const snapshot = await loadNotificationRealtimeSnapshot(session)
  return {
    data: {
      ...snapshot,
      realtime: notificationRealtime(
        event,
        session.organizationId,
        session.userId,
      ),
    },
  } satisfies NotificationRealtimeSnapshotResponse
})
