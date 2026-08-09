import { setHeader } from 'h3'
import { listClientMultiformCases } from '~~/server/utils/client-multiform'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return listClientMultiformCases(event)
})
