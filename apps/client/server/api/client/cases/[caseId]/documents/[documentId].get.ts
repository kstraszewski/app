import {
  createError,
  getQuery,
  getRouterParam,
  setHeader,
} from 'h3'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  portalCaseDocumentBucket,
  portalDocumentContentDisposition,
} from '~~/server/utils/portal-files'
import {
  requirePortalCaseAccess,
  requiredUuid,
  throwPortalDbError,
} from '~~/server/utils/portal-auth'
import { serverStorage } from '~~/server/utils/platform-storage'

export default defineEventHandler(async (event) => {
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const documentId = requiredUuid(getRouterParam(event, 'documentId'), 'documentId')
  const access = await requirePortalCaseAccess(event, caseId)
  const backend = serverDataBackend(event) as any
  const result = await backend
    .from('crm_documents')
    .select('id, organization_id, case_id, uploaded_by_client_person_id, name, status_code, storage_bucket, storage_path, mime_type')
    .eq('organization_id', access.grant.organizationId)
    .eq('case_id', caseId)
    .eq('id', documentId)
    .eq('uploaded_by_client_person_id', access.link.clientPersonId)
    .maybeSingle()
  throwPortalDbError(result.error, 'could not load client document')
  const document = result.data
  const storagePath = String(document?.storage_path ?? '')
  if (
    !document
    || document.status_code === 'missing'
    || document.storage_bucket !== portalCaseDocumentBucket
    || !storagePath.startsWith(`${access.grant.organizationId}/${caseId}/client/`)
    || !document.mime_type
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Document file not found' })
  }

  const download = await serverStorage(event)
    .from(portalCaseDocumentBucket)
    .download(storagePath)
  if (download.error || !download.data) {
    throw createError({ statusCode: 404, statusMessage: 'Document file not found' })
  }
  const bytes = Buffer.from(await download.data.arrayBuffer())
  const query = getQuery(event)
  const forceDownload = query.download === '1' || query.download === 'true'

  setHeader(event, 'Content-Type', String(document.mime_type))
  setHeader(event, 'Content-Length', bytes.byteLength)
  setHeader(
    event,
    'Content-Disposition',
    portalDocumentContentDisposition(
      String(document.name),
      forceDownload ? 'attachment' : 'inline',
    ),
  )
  setHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  return bytes
})
