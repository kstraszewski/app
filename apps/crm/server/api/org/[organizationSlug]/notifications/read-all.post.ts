import { readBody, setHeader } from 'h3'
import { requireCrmSession } from '~~/server/utils/crm'
import {
  markNotificationsReadThrough,
  nudgeNotificationOutbox,
  parseNotificationsReadThroughInput,
} from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')
  const throughAt = parseNotificationsReadThroughInput(await readBody(event))
  const response = await markNotificationsReadThrough(session, throughAt)
  if (response.changed) await nudgeNotificationOutbox(event)
  return response
})
