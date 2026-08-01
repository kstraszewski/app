import { setHeader } from 'h3'
import { loadPortalAppointments } from '~~/server/utils/portal-appointments'
import { loadPortalCases } from '~~/server/utils/portal-cases'
import { loadClientPortalSession } from '~~/server/utils/portal-auth'
import {
  buildPortalDashboardNextStep,
  selectNextPortalAppointment,
} from '~~/server/utils/portal-dashboard'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const session = await loadClientPortalSession(event)
  const [{ cases }, appointments] = await Promise.all([
    loadPortalCases(event, session),
    loadPortalAppointments(event, session),
  ])
  const nextAppointment = selectNextPortalAppointment(appointments)
  const nextStep = buildPortalDashboardNextStep(cases, nextAppointment)
  return {
    data: {
      user: {
        id: session.identity.userId,
        name: session.identity.name,
        email: session.identity.email,
      },
      linked: session.links.length > 0,
      cases,
      appointments,
      nextAppointment,
      nextStep,
      activeCaseId: nextStep.caseId ?? cases[0]?.id ?? null,
    },
  }
})
