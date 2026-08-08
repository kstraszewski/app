import { validateTemplateJson } from '@openexpert/multiform'
import { createError } from 'h3'
import {
  createMortgageDocumentTemplateSkeleton,
  mortgageTemplateContentSha256,
} from '~~/server/utils/mortgage-document-templates'
import { loadMortgageDocumentTemplateSource } from '~~/server/utils/mortgage-document-template-source'
import {
  mortgageBankFileUuid,
  requireMortgageBankFileAdmin,
} from '~~/server/utils/mortgage-bank-files'
import { getRequiredParam } from '~~/server/utils/crm'

type DatabaseRecord = Record<string, any>

function templateSegment(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('pl-PL')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 55) || 'formularz'
}

export default defineEventHandler(async (event) => {
  const { session, backendData } = await requireMortgageBankFileAdmin(event)
  const fileId = mortgageBankFileUuid(getRequiredParam(event, 'fileId'), 'fileId')

  const fileResult = await backendData
    .from('mortgage_bank_files')
    .select('id, bank_id, title, current_version_id')
    .eq('id', fileId)
    .is('archived_at', null)
    .maybeSingle()
  if (fileResult.error) throw fileResult.error
  if (!fileResult.data?.current_version_id) {
    throw createError({ statusCode: 404, statusMessage: 'Plik bankowy nie ma dostępnej wersji.' })
  }
  const file = fileResult.data as DatabaseRecord
  const versionId = String(file.current_version_id)

  const [bankResult, versionResult, existingResult] = await Promise.all([
    backendData
      .from('mortgage_banks')
      .select('id, slug, name')
      .eq('id', file.bank_id)
      .maybeSingle(),
    backendData
      .from('mortgage_bank_file_versions')
      .select('id, file_id, original_file_name, mime_type, status, checksum_sha256')
      .eq('id', versionId)
      .eq('file_id', fileId)
      .maybeSingle(),
    backendData
      .from('mortgage_document_templates')
      .select('id, template_key, draft_revision')
      .eq('source_file_version_id', versionId)
      .maybeSingle(),
  ])
  if (bankResult.error) throw bankResult.error
  if (versionResult.error) throw versionResult.error
  if (existingResult.error) throw existingResult.error
  if (!bankResult.data || !versionResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono banku albo wersji źródłowej.' })
  }
  if (existingResult.data) {
    return {
      data: {
        id: String(existingResult.data.id),
        templateKey: String(existingResult.data.template_key),
        draftRevision: Number(existingResult.data.draft_revision ?? 0),
        created: false,
      },
    }
  }

  const version = versionResult.data as DatabaseRecord
  if (version.mime_type !== 'application/pdf' || version.status !== 'current') {
    throw createError({
      statusCode: 422,
      statusMessage: 'Szablon Multiwniosku można utworzyć tylko z aktualnej wersji PDF.',
    })
  }

  const bankSlug = String(bankResult.data.slug)
  const checksum = String(version.checksum_sha256)
  const templateId = [
    templateSegment(bankSlug),
    templateSegment(String(file.title)),
    fileId.slice(0, 8),
    checksum.slice(0, 8),
  ].join('-').slice(0, 120)
  const source = await loadMortgageDocumentTemplateSource(backendData, {
    source_file_id: fileId,
    source_file_version_id: versionId,
  }, undefined)
  const template = await createMortgageDocumentTemplateSkeleton({
    templateId,
    bankSlug,
    label: String(file.title),
    fileName: source.fileName,
    sha256: source.sha256,
    bytes: source.bytes,
  })
  const validation = validateTemplateJson(template)
  if (!validation.valid || validation.kind !== 'document-template') {
    throw createError({
      statusCode: 422,
      statusMessage: 'Nie udało się utworzyć poprawnego szkicu z tego PDF-u.',
      data: { validation },
    })
  }

  const contentSha256 = mortgageTemplateContentSha256(template)
  const { data, error } = await backendData.rpc(
    'create_mortgage_document_template_from_bank_file',
    {
      p_file_id: fileId,
      p_version_id: versionId,
      p_template_key: templateId,
      p_label: template.label,
      p_template_json: template,
      p_validation_report: { ...validation, contentSha256 },
      p_actor_user_id: session.userId,
    },
  )
  if (error) throw error

  setHeader(event, 'Cache-Control', 'private, no-store')
  return { data, validation, contentSha256 }
})
