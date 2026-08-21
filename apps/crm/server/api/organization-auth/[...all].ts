import {
  createError,
  getRouterParam,
  toWebRequest,
} from 'h3'
import { serverOrganizationInvitationAuth } from '~~/server/utils/platform-auth'

export default defineEventHandler((event) => {
  const authPath = String(getRouterParam(event, 'all') || '').replace(/^\/+|\/+$/gu, '')
  if (event.method !== 'GET' || authPath !== 'magic-link/verify') {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  return serverOrganizationInvitationAuth(event).auth.handler(toWebRequest(event))
})
