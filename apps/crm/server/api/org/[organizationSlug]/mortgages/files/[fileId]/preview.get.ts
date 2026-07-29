import { getQuery, getRouterParam, sendRedirect } from 'h3'
import {
  createMortgageBankFileAccessUrl,
  requireMortgageBankFileAdmin,
} from '~~/server/utils/mortgage-bank-files'

export default defineEventHandler(async (event) => {
  const { session, serviceRole } = await requireMortgageBankFileAdmin(event)
  const query = getQuery(event)
  const versionId = Array.isArray(query.versionId) ? query.versionId[0] : query.versionId
  const pageValue = Array.isArray(query.page) ? query.page[0] : query.page
  const page = Math.max(1, Math.trunc(Number(pageValue) || 1))
  const signedUrl = await createMortgageBankFileAccessUrl(serviceRole, {
    fileId: String(getRouterParam(event, 'fileId') ?? ''),
    versionId: typeof versionId === 'string' ? versionId : null,
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: 'file.previewed',
  })
  return sendRedirect(event, `${signedUrl}#page=${page}&toolbar=0&navpanes=0`, 302)
})
