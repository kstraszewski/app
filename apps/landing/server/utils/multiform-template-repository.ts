import { createHash } from 'node:crypto'
import { serverDataBackend } from './data-api'
import {
  getTemplate,
  validateTemplateJson,
  type DocumentTemplate,
} from '@openexpert/multiform'
import { createError, type H3Event } from 'h3'

type DatabaseRecord = Record<string, any>
const mortgageBankFileBucket = 'mortgage-bank-files'

export interface MultiformTemplateApplicationRef {
  productVersionId: string | null
  templateIds: readonly string[]
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function databaseError(error: { message?: string } | null | undefined): never | void {
  if (!error) return
  console.error('[multiform-template-repository] database query failed')
  throw createError({
    statusCode: 500,
    statusMessage: 'Nie udało się odczytać opublikowanej wersji formularza PDF.',
  })
}

export async function resolvePinnedMultiformTemplates(
  event: H3Event,
  applications: readonly MultiformTemplateApplicationRef[],
) {
  const productVersionIds = [...new Set(applications
    .map(application => nonEmptyString(application.productVersionId))
    .filter((value): value is string => Boolean(value)))]
  if (!productVersionIds.length) return [] as DocumentTemplate[]

  const backendData = serverDataBackend(event) as any
  const linksResult = await backendData
    .from('mortgage_product_version_document_templates')
    .select('product_version_id, template_revision_id, requirement_code, sort_order')
    .in('product_version_id', productVersionIds)
  databaseError(linksResult.error)
  const links = (linksResult.data ?? []) as DatabaseRecord[]
  if (!links.length) return [] as DocumentTemplate[]

  const revisionIds = [...new Set(links.map(link => String(link.template_revision_id)))]
  const revisionsResult = await backendData
    .from('mortgage_document_template_revisions')
    .select('id, template_id, action, template_json, validation_report')
    .in('id', revisionIds)
  databaseError(revisionsResult.error)
  const revisions = (revisionsResult.data ?? []) as DatabaseRecord[]
  const templateDefinitionIds = [...new Set(revisions.map(revision => String(revision.template_id)))]
  const definitionsResult = await backendData
    .from('mortgage_document_templates')
    .select('id, template_key, bank_id, source_file_id, source_file_version_id, source_file_name, source_sha256')
    .in('id', templateDefinitionIds)
  databaseError(definitionsResult.error)

  const definitionById = new Map(((definitionsResult.data ?? []) as DatabaseRecord[])
    .map(definition => [String(definition.id), definition]))
  const revisionById = new Map(revisions.map(revision => [String(revision.id), revision]))
  const overrideByTemplateId = new Map<string, { revisionId: string, template: DocumentTemplate }>()
  const linksByProductVersion = new Map<string, DatabaseRecord[]>()
  for (const link of links) {
    const productVersionId = String(link.product_version_id)
    linksByProductVersion.set(productVersionId, [
      ...(linksByProductVersion.get(productVersionId) ?? []),
      link,
    ])
  }

  for (const application of applications) {
    if (!application.productVersionId) continue
    const expectedIds = new Set(application.templateIds)
    for (const link of linksByProductVersion.get(application.productVersionId) ?? []) {
      const revisionId = String(link.template_revision_id)
      const revision = revisionById.get(revisionId)
      const definition = revision
        ? definitionById.get(String(revision.template_id))
        : undefined
      const templateId = nonEmptyString(definition?.template_key)
      if (!revision || revision.action !== 'published' || !templateId || !expectedIds.has(templateId)) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Wersja produktu ma nieprawidłowe przypięcie formularza PDF.',
        })
      }

      const validation = validateTemplateJson(revision.template_json)
      const template = revision.template_json as DocumentTemplate
      const registered = getTemplate(templateId)
      const linkedSourceMatches = Boolean(
        definition?.source_file_id
        && definition?.source_file_version_id
        && template.source.fileName === definition.source_file_name
        && template.source.sha256 === definition.source_sha256,
      )
      const registeredSourceMatches = Boolean(
        registered
        && template.source.fileName === registered.source.fileName
        && template.source.sha256 === registered.source.sha256,
      )
      if (
        !validation.summary.activationReady
        || template.id !== templateId
        || (!linkedSourceMatches && !registeredSourceMatches)
      ) {
        throw createError({
          statusCode: 409,
          statusMessage: `${templateId}: przypięta wersja formularza nie jest gotowa do bezpiecznego eksportu.`,
        })
      }

      const existing = overrideByTemplateId.get(templateId)
      if (existing && existing.revisionId !== revisionId) {
        throw createError({
          statusCode: 409,
          statusMessage: `${templateId}: aktywne produkty wskazują różne rewizje tego samego formularza.`,
        })
      }
      overrideByTemplateId.set(templateId, { revisionId, template })
    }
  }

  return [...overrideByTemplateId.values()].map(value => value.template)
}

export async function readPinnedMultiformTemplateSource(
  event: H3Event,
  template: DocumentTemplate,
): Promise<Uint8Array | null> {
  const backendData = serverDataBackend(event) as any
  const definitionResult = await backendData
    .from('mortgage_document_templates')
    .select('source_file_id, source_file_version_id, source_file_name, source_sha256')
    .eq('template_key', template.id)
    .maybeSingle()
  databaseError(definitionResult.error)
  const definition = definitionResult.data as DatabaseRecord | null
  if (!definition?.source_file_id || !definition.source_file_version_id) return null
  if (
    definition.source_file_name !== template.source.fileName
    || definition.source_sha256 !== template.source.sha256
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: `${template.id}: źródło przypiętej rewizji nie odpowiada wersji pliku bankowego.`,
    })
  }

  const versionResult = await backendData
    .from('mortgage_bank_file_versions')
    .select('id, file_id, storage_path, original_file_name, mime_type, checksum_sha256')
    .eq('id', definition.source_file_version_id)
    .eq('file_id', definition.source_file_id)
    .maybeSingle()
  databaseError(versionResult.error)
  const version = versionResult.data as DatabaseRecord | null
  if (
    !version
    || version.mime_type !== 'application/pdf'
    || version.original_file_name !== template.source.fileName
    || version.checksum_sha256 !== template.source.sha256
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: `${template.id}: źródłowa wersja PDF nie jest dostępna albo ma inne metadane.`,
    })
  }

  const downloadResult = await backendData.storage
    .from(mortgageBankFileBucket)
    .download(String(version.storage_path))
  if (downloadResult.error || !downloadResult.data) {
    throw createError({
      statusCode: 404,
      statusMessage: `${template.id}: nie znaleziono źródłowego PDF-u w magazynie plików banku.`,
    })
  }
  const bytes = new Uint8Array(await downloadResult.data.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== template.source.sha256) {
    throw createError({
      statusCode: 409,
      statusMessage: `${template.id}: źródłowy PDF nie przeszedł weryfikacji integralności.`,
    })
  }
  return bytes
}
