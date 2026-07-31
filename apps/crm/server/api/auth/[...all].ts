import { toWebRequest } from 'h3'
import { serverAuth } from '~~/server/utils/platform-auth'

export default defineEventHandler(event => (
  serverAuth(event).auth.handler(toWebRequest(event))
))
