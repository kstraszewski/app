import { createError, setHeader } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  getRequiredParam,
  requireCrmSession,
} from '~~/server/utils/crm'
import {
  markNotificationRead,
  nudgeNotificationOutbox,
} from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  const notificationId = getRequiredParam(event, 'notificationId')
  if (!caseUuidPattern.test(notificationId)) {
    throw createError({ statusCode: 404, statusMessage: 'Notification not found' })
  }

  const response = await markNotificationRead(session, notificationId.toLowerCase())
  if (response.changed) await nudgeNotificationOutbox(event)
  return response
})
