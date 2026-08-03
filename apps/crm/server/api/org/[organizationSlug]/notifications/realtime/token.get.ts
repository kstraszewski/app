import { createError, setHeader } from 'h3'
import type { NotificationRealtimeTokenResponse } from '~~/shared/types/notifications'
import { requireCrmSession } from '~~/server/utils/crm'
import { createNotificationTokenRequest } from '~~/server/utils/notification-realtime'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    const token = await createNotificationTokenRequest(
      event,
      session.organizationId,
      session.userId,
    )
    if (!token) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Realtime transport is not configured; use polling',
      })
    }
    return { data: token } satisfies NotificationRealtimeTokenResponse
  }
  catch (error: any) {
    if (error?.statusCode === 503) throw error
    console.warn('[crm-notifications] realtime authorization failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    throw createError({
      statusCode: 503,
      statusMessage: 'Realtime authorization is temporarily unavailable; use polling',
    })
  }
})
