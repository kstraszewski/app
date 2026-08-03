import { getRouterParam, setHeader } from 'h3'
import { loadPortalMeetingPreparation } from '~~/server/utils/portal-meeting-preparation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const preparation = await loadPortalMeetingPreparation(
    event,
    getRouterParam(event, 'appointmentId'),
  )
  return { data: preparation }
})
