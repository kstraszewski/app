import { createError, getRouterParam, setHeader } from 'h3'
import { findOrganizationMemberInvitationByToken } from '~~/server/utils/organization-member-invitations'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Referrer-Policy', 'no-referrer')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-Robots-Tag', 'noindex, nofollow')

  const invitation = await findOrganizationMemberInvitationByToken(
    event,
    getRouterParam(event, 'token'),
  )
  if (!invitation) {
    throw createError({ statusCode: 404, statusMessage: 'Member invitation not found' })
  }
  return {
    invitation: {
      email: invitation.email,
      invitedName: invitation.invitedName,
      role: invitation.role,
      status: invitation.status,
      organizationName: invitation.organizationName,
      organizationSlug: invitation.organizationSlug,
      expiresAt: invitation.expiresAt,
      sentAt: invitation.sentAt,
      canAccept: invitation.canAccept,
      canResume: invitation.canResume,
    },
  }
})
