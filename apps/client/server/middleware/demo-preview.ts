import {
  getRequestURL,
  sendRedirect,
  setHeader,
} from 'h3'
import { hasDemoSession } from '~~/server/utils/demo-auth'

export default defineEventHandler((event) => {
  if (process.env.NODE_ENV !== 'production') return

  const url = getRequestURL(event)
  if (url.pathname !== '/preview' && !url.pathname.startsWith('/preview/')) return

  setHeader(event, 'Cache-Control', 'private, no-store')
  if (hasDemoSession(event)) return

  const redirect = encodeURIComponent(`${url.pathname}${url.search}`)
  return sendRedirect(event, `/demo?redirect=${redirect}`, 302)
})
