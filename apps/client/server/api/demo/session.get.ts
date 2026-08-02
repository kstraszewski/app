import { setHeader } from 'h3'
import { hasDemoSession } from '~~/server/utils/demo-auth'

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { authenticated: hasDemoSession(event) }
})
