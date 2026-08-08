import { serverDataBackend } from '~~/server/utils/data-api'
import { createError } from 'h3'
import {
  mortgageBackofficeUuid,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import {
  mortgageTemplateIdsFromDraft,
  mortgageTemplateIdsFromVersion,
  mortgageTemplateRecord,
  mortgageTemplateSummary,
  mortgageTemplateText,
  registeredMortgageTemplates,
  type MortgageTemplateReference,
} from '~~/server/utils/mortgage-document-templates'
import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
} from '~~/server/utils/crm'
import type { DocumentTemplate } from '@openexpert/multiform'

type DatabaseRecord = Record<string, any>

function requirementReferences(
  value: unknown,
  product: DatabaseRecord,
  source: MortgageTemplateReference['source'],
) {
  if (!Array.isArray(value)) return [] as Array<MortgageTemplateReference & { templateId: string }>
  return value.flatMap((entry, index) => {
    const requirement = mortgageTemplateRecord(entry)
    const templateId = mortgageTemplateText(requirement.templateId ?? requirement.template_id)
    if (!templateId) return []
    return [{
      templateId,
      productId: String(product.id),
      productName: String(product.name ?? 'Produkt hipoteczny'),
      requirementCode: mortgageTemplateText(requirement.code) ?? `document-${index + 1}`,
      requirementLabel: mortgageTemplateText(requirement.label) ?? 'Wniosek bankowy',
      source,
    }]
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const bankId = mortgageBackofficeUuid(getRequiredParam(event, 'bankId'), 'bankId')
  const backendData = serverDataBackend(event) as any

  const [bankResult, productsResult, catalogResult] = await Promise.all([
    backendData
      .from('mortgage_banks')
      .select('id, slug, name')
      .eq('id', bankId)
      .maybeSingle(),
    backendData
      .from('mortgage_products')
      .select('id, name, current_published_version_id')
      .eq('bank_id', bankId)
      .order('name'),
    backendData
      .from('mortgage_document_templates')
      .select('id, template_key, label, source_file_id, source_file_version_id, source_file_name, source_sha256, registry_version, draft_json, draft_validation_report, draft_revision, draft_updated_at, active_json, active_validation_report, active_revision, active_published_at, current_published_revision_id, updated_at')
      .eq('bank_id', bankId),
  ])
  throwMortgageBackofficeDbError(bankResult.error)
  throwMortgageBackofficeDbError(productsResult.error)
  throwMortgageBackofficeDbError(catalogResult.error)
  if (!bankResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono instytucji finansowej.' })
  }

  const bank = bankResult.data as DatabaseRecord
  const products = (productsResult.data ?? []) as DatabaseRecord[]
  const productIds = products.map(product => String(product.id))
  const currentVersionIds = products
    .map(product => mortgageTemplateText(product.current_published_version_id))
    .filter((value): value is string => Boolean(value))

  const [versionsResult, draftsResult] = productIds.length
    ? await Promise.all([
        currentVersionIds.length
          ? backendData
              .from('mortgage_product_versions')
              .select('id, product_id, multiform_template_ids, document_requirements')
              .in('id', currentVersionIds)
          : Promise.resolve({ data: [], error: null }),
        backendData
          .from('mortgage_product_drafts')
          .select('product_id, draft_data')
          .in('product_id', productIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]
  throwMortgageBackofficeDbError(versionsResult.error)
  throwMortgageBackofficeDbError(draftsResult.error)

  const productById = new Map(products.map(product => [String(product.id), product]))
  const referencesByTemplate = new Map<string, MortgageTemplateReference[]>()
  const addReferences = (
    templateIds: readonly string[],
    references: Array<MortgageTemplateReference & { templateId: string }>,
    product: DatabaseRecord,
    source: MortgageTemplateReference['source'],
  ) => {
    const referencedIds = new Set(references.map(reference => reference.templateId))
    for (const reference of references) {
      referencesByTemplate.set(reference.templateId, [
        ...(referencesByTemplate.get(reference.templateId) ?? []),
        reference,
      ])
    }
    for (const templateId of templateIds) {
      if (referencedIds.has(templateId)) continue
      referencesByTemplate.set(templateId, [
        ...(referencesByTemplate.get(templateId) ?? []),
        {
          productId: String(product.id),
          productName: String(product.name ?? 'Produkt hipoteczny'),
          requirementCode: 'multiform_template_ids',
          requirementLabel: 'Formularz przypisany do wersji produktu',
          source,
        },
      ])
    }
  }

  for (const version of (versionsResult.data ?? []) as DatabaseRecord[]) {
    const product = productById.get(String(version.product_id))
    if (!product) continue
    const references = requirementReferences(version.document_requirements, product, 'published')
    addReferences(mortgageTemplateIdsFromVersion(version), references, product, 'published')
  }
  for (const draft of (draftsResult.data ?? []) as DatabaseRecord[]) {
    const product = productById.get(String(draft.product_id))
    if (!product) continue
    const draftData = mortgageTemplateRecord(draft.draft_data)
    const documentation = mortgageTemplateRecord(draftData.documentation)
    const references = requirementReferences(documentation.requirements, product, 'draft')
    addReferences(mortgageTemplateIdsFromDraft(draftData), references, product, 'draft')
  }

  const registered = registeredMortgageTemplates(String(bank.slug))
  const registeredById = new Map(registered.map(template => [template.id, template]))
  const catalogRows = (catalogResult.data ?? []) as DatabaseRecord[]
  const catalogById = new Map(catalogRows.map(row => [String(row.template_key), row]))
  const templateIds = [...new Set([
    ...registered.map(template => template.id),
    ...catalogRows.map(row => String(row.template_key)),
    ...referencesByTemplate.keys(),
  ])].sort()

  const templates = templateIds.map((templateId) => {
    const registryTemplate = registeredById.get(templateId)
    const row = catalogById.get(templateId)
    const activeTemplate = row?.active_json as DocumentTemplate | undefined
    const effectiveTemplate = activeTemplate ?? registryTemplate
    const draftTemplate = row?.draft_json as DocumentTemplate | undefined
    const referenceList = referencesByTemplate.get(templateId) ?? []

    return {
      id: templateId,
      label: mortgageTemplateText(row?.label) ?? registryTemplate?.label ?? templateId,
      bank: String(bank.name),
      registered: Boolean(registryTemplate),
      editable: Boolean(registryTemplate || row?.source_file_version_id),
      sourceKind: row?.source_file_version_id
        ? 'bank-file' as const
        : registryTemplate
          ? 'registered' as const
          : 'missing' as const,
      sourceFile: row?.source_file_id
        ? {
            id: String(row.source_file_id),
            versionId: String(row.source_file_version_id),
          }
        : null,
      source: effectiveTemplate
        ? {
            fileName: effectiveTemplate.source.fileName,
            sha256: effectiveTemplate.source.sha256,
            pageCount: effectiveTemplate.source.pageCount,
          }
        : null,
      active: {
        origin: activeTemplate ? 'catalog' as const : registryTemplate ? 'registry' as const : 'missing' as const,
        revision: Number(row?.active_revision ?? 0),
        publishedAt: mortgageTemplateText(row?.active_published_at),
        summary: effectiveTemplate ? mortgageTemplateSummary(effectiveTemplate) : null,
      },
      draft: draftTemplate
        ? {
            revision: Number(row?.draft_revision ?? 0),
            updatedAt: mortgageTemplateText(row?.draft_updated_at),
            summary: mortgageTemplateSummary(draftTemplate),
          }
        : null,
      references: referenceList,
      referencedProductCount: new Set(referenceList.map(reference => reference.productId)).size,
      updatedAt: mortgageTemplateText(row?.updated_at),
    }
  })

  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    schemaVersion: 1 as const,
    bank: { id: String(bank.id), slug: String(bank.slug), name: String(bank.name) },
    templates,
    summary: {
      total: templates.length,
      withDraft: templates.filter(template => template.draft).length,
      activationReady: templates.filter(template => template.active.summary?.activationReady).length,
      referenced: templates.filter(template => template.references.length).length,
    },
  }
})
