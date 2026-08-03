import { getRouterParam, readBody, setHeader } from 'h3'
import { savePortalMeetingPreparation } from '~~/server/utils/portal-meeting-preparation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const preparation = await savePortalMeetingPreparation(
    event,
    getRouterParam(event, 'appointmentId'),
    await readBody(event),
  )
  return { data: preparation }
})
