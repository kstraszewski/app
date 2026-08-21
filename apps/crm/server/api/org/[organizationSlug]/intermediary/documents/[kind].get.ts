import { createError, getQuery, setHeader } from 'h3'
import { cloneDefaultOrganizationDesign, normalizeOrganizationDesign } from '#shared/design'
import { createEmptyIntermediarySettings, normalizeIntermediarySettings } from '#shared/intermediary-settings'
import {
  createIntermediaryDocument,
  intermediaryDocumentKind,
} from '~~/server/utils/intermediary-documents'
import {
  OfiSinglePageOverflowError,
  RodoSinglePageOverflowError,
} from '~~/server/utils/intermediary-document-pdf'
import {
  getRequiredParam,
  requireCrmSession,
  requireOrganizationAdmin,
  throwDbError,
} from '~~/server/utils/crm'

function contentDisposition(fileName: string, download: boolean): string {
  const safeName = fileName.replace(/[\r\n"\\]/gu, '_')
  const asciiName = safeName.replace(/[^\x20-\x7e]/gu, '_')
  return `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  if (session.organizationKind !== 'intermediary') {
    throw createError({ statusCode: 404, statusMessage: 'Intermediary documents are not available' })
  }
  requireOrganizationAdmin(session)
  const kind = intermediaryDocumentKind(getRequiredParam(event, 'kind'))
  if (!kind) throw createError({ statusCode: 404, statusMessage: 'Nieznany rodzaj dokumentu.' })

  const [settingsResult, designResult] = await Promise.all([
    session.dataApi
      .from('organization_intermediary_settings')
      .select('settings, revision')
      .eq('organization_id', session.organizationId)
      .maybeSingle(),
    session.dataApi
      .from('organization_design_settings')
      .select('settings')
      .eq('organization_id', session.organizationId)
      .maybeSingle(),
  ])
  throwDbError(settingsResult.error)
  throwDbError(designResult.error)

  let document
  try {
    document = await createIntermediaryDocument({
      kind,
      settings: settingsResult.data
        ? normalizeIntermediarySettings(settingsResult.data.settings)
        : createEmptyIntermediarySettings(),
      design: designResult.data
        ? normalizeOrganizationDesign(designResult.data.settings)
        : cloneDefaultOrganizationDesign(),
      organizationName: session.organizationName,
      revision: Number(settingsResult.data?.revision ?? 0),
      generatedAt: new Date().toISOString(),
    })
  }
  catch (error) {
    if (
      error instanceof OfiSinglePageOverflowError
      || error instanceof RodoSinglePageOverflowError
    ) {
      const documentName = error instanceof RodoSinglePageOverflowError ? 'RODO' : 'OFI'
      throw createError({
        statusCode: 422,
        statusMessage: `Treść ${documentName} nie mieści się na jednej stronie. Skróć opisy w ustawieniach pośrednika.`,
        data: { code: error.code },
      })
    }
    throw error
  }
  const download = getQuery(event).download === '1'

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Length', document.bytes.byteLength)
  setHeader(event, 'Content-Disposition', contentDisposition(document.fileName, download))
  setHeader(event, 'Cache-Control', 'private, no-store, max-age=0')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'X-OpenExpert-Document-Kind', kind)
  setHeader(event, 'X-OpenExpert-Settings-Revision', String(settingsResult.data?.revision ?? 0))
  return document.bytes
})
