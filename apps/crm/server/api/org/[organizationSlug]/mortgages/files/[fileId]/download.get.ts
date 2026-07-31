import { getQuery, getRouterParam, sendRedirect } from 'h3'
import {
  createMortgageBankFileAccessUrl,
  requireMortgageBankFileAdmin,
} from '~~/server/utils/mortgage-bank-files'

export default defineEventHandler(async (event) => {
  const { session, backendData } = await requireMortgageBankFileAdmin(event)
  const query = getQuery(event)
  const versionId = Array.isArray(query.versionId) ? query.versionId[0] : query.versionId
  const signedUrl = await createMortgageBankFileAccessUrl(backendData, {
    fileId: String(getRouterParam(event, 'fileId') ?? ''),
    versionId: typeof versionId === 'string' ? versionId : null,
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: 'file.downloaded',
  })
  return sendRedirect(event, signedUrl, 302)
})
