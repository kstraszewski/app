import { setHeader } from 'h3'
import { serverDataTokenSigner } from '~~/server/utils/platform-data'

export default defineEventHandler((event) => {
  setHeader(event, 'Cache-Control', 'public, max-age=300, s-maxage=3600')
  return serverDataTokenSigner(event).jwks
})
