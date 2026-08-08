import { serverDataBackend } from '~~/server/utils/data-api'
import { validateTemplateJson, type DocumentTemplate } from '@openexpert/multiform'
import { createError } from 'h3'
import {
  mortgageBackofficeUuid,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import {
  mortgageTemplateKey,
  mortgageTemplateSummary,
  mortgageTemplateText,
  registeredMortgageTemplate,
} from '~~/server/utils/mortgage-document-templates'
import { mortgageDocumentTemplateSourceDescriptor } from '~~/server/utils/mortgage-document-template-source'
import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
} from '~~/server/utils/crm'

type DatabaseRecord = Record<string, any>

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const bankId = mortgageBackofficeUuid(getRequiredParam(event, 'bankId'), 'bankId')
  const templateId = mortgageTemplateKey(getRequiredParam(event, 'templateId'))
  const backendData = serverDataBackend(event) as any

  const [bankResult, templateResult] = await Promise.all([
    backendData
      .from('mortgage_banks')
      .select('id, slug, name')
      .eq('id', bankId)
      .maybeSingle(),
    backendData
      .from('mortgage_document_templates')
      .select('id, template_key, label, registry_version, source_file_id, source_file_version_id, source_file_name, source_sha256, draft_json, draft_validation_report, draft_revision, draft_updated_at, draft_updated_by_user_id, active_json, active_validation_report, active_revision, active_published_at, active_published_by_user_id, current_published_revision_id, created_at, updated_at')
      .eq('bank_id', bankId)
      .eq('template_key', templateId)
      .maybeSingle(),
  ])
  throwMortgageBackofficeDbError(bankResult.error)
  throwMortgageBackofficeDbError(templateResult.error)
  if (!bankResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono instytucji finansowej.' })
  }

  const bank = bankResult.data as DatabaseRecord
  const registered = registeredMortgageTemplate(String(bank.slug), templateId)
  const row = templateResult.data as DatabaseRecord | null
  const sourceDescriptor = mortgageDocumentTemplateSourceDescriptor(String(bank.slug), row, registered)
  if (!registered && !row?.draft_json && !row?.active_json) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Nie znaleziono szablonu utworzonego z pliku tej instytucji.',
    })
  }
  if (!sourceDescriptor) {
    throw createError({ statusCode: 409, statusMessage: 'Szablon nie ma zweryfikowanego źródła PDF.' })
  }

  const catalogId = mortgageTemplateText(row?.id)
  const revisionsResult = catalogId
    ? await backendData
        .from('mortgage_document_template_revisions')
        .select('id, action, revision, actor_user_id, created_at')
        .eq('template_id', catalogId)
        .order('created_at', { ascending: false })
        .limit(30)
    : { data: [], error: null }
  throwMortgageBackofficeDbError(revisionsResult.error)

  const revisions = (revisionsResult.data ?? []) as DatabaseRecord[]
  const actorIds = [...new Set(revisions
    .map(revision => mortgageTemplateText(revision.actor_user_id))
    .filter((value): value is string => Boolean(value)))]
  const actorsResult = actorIds.length
    ? await backendData.from('users').select('id, full_name, email').in('id', actorIds)
    : { data: [], error: null }
  throwMortgageBackofficeDbError(actorsResult.error)
  const actorById = new Map(((actorsResult.data ?? []) as DatabaseRecord[])
    .map(actor => [String(actor.id), actor]))

  const activeTemplate = row?.active_json as DocumentTemplate | undefined
  const draftTemplate = row?.draft_json as DocumentTemplate | undefined
  const editorTemplate = draftTemplate ?? activeTemplate ?? registered!
  const editorValidation = row?.draft_validation_report
    ?? (draftTemplate ? validateTemplateJson(draftTemplate) : validateTemplateJson(editorTemplate))
  const activeValidation = row?.active_validation_report
    ?? validateTemplateJson(activeTemplate ?? registered ?? editorTemplate)

  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    schemaVersion: 1 as const,
    bank: { id: String(bank.id), slug: String(bank.slug), name: String(bank.name) },
    template: {
      id: templateId,
      label: mortgageTemplateText(row?.label) ?? registered?.label ?? templateId,
      sourceKind: row?.source_file_version_id ? 'bank-file' as const : 'registered' as const,
      sourceFile: row?.source_file_id
        ? {
            id: String(row.source_file_id),
            versionId: String(row.source_file_version_id),
          }
        : null,
      pdfUrl: `/api/org/${encodeURIComponent(session.organizationSlug)}/mortgages/banks/${encodeURIComponent(bankId)}/templates/${encodeURIComponent(templateId)}/source`,
      editor: {
        template: editorTemplate,
        validation: editorValidation,
        basedOn: draftTemplate ? 'draft' as const : activeTemplate ? 'catalog' as const : 'registry' as const,
      },
      draft: draftTemplate
        ? {
            revision: Number(row?.draft_revision ?? 0),
            updatedAt: mortgageTemplateText(row?.draft_updated_at),
            summary: mortgageTemplateSummary(draftTemplate),
          }
        : null,
      active: {
        origin: activeTemplate ? 'catalog' as const : registered ? 'registry' as const : 'missing' as const,
        revision: Number(row?.active_revision ?? 0),
        publishedAt: mortgageTemplateText(row?.active_published_at),
        template: activeTemplate ?? registered ?? editorTemplate,
        validation: activeValidation,
        summary: mortgageTemplateSummary(activeTemplate ?? registered ?? editorTemplate),
      },
      history: revisions.map((revision) => {
        const actor = actorById.get(String(revision.actor_user_id ?? ''))
        return {
          id: String(revision.id),
          action: String(revision.action),
          revision: Number(revision.revision),
          createdAt: mortgageTemplateText(revision.created_at),
          actor: actor
            ? {
                id: String(actor.id),
                name: mortgageTemplateText(actor.full_name),
                email: mortgageTemplateText(actor.email),
              }
            : null,
        }
      }),
    },
  }
})
