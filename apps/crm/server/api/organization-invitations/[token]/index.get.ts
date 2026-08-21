import { createError, getRouterParam, setHeader } from 'h3'
import { previewOrganizationInvitation } from '~~/server/utils/organization-invitations'

function setPublicHeaders(event: Parameters<typeof setHeader>[0]): void {
  setHeader(event, 'Cache-Control', 'no-store, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
}

export default defineEventHandler(async (event) => {
  setPublicHeaders(event)
  const invitation = await previewOrganizationInvitation(
    event,
    getRouterParam(event, 'token'),
  )
  if (!invitation) {
    throw createError({ statusCode: 404, statusMessage: 'Invitation not found' })
  }
  return { invitation }
})
