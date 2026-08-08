import {
  calculateMortgageOfferV2,
  validateMortgageOfferV2,
  type MortgageCalculationIssueV2,
  type MortgageOfferValidationV2,
  type MortgageOfferVersionV2,
} from '@openexpert/mortgage'
import { createError, readBody } from 'h3'
import {
  mortgageBackofficeRevision,
  mortgageBackofficeUuid,
  materializeMortgageOfferSources,
  mortgageOfferDocumentationIssues,
  requireMortgageBackoffice,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import { buildMortgagePublicationScenarioMatrix } from '~~/server/utils/mortgage-publication-scenarios'
import { mortgageTemplateIdsFromDraft } from '~~/server/utils/mortgage-document-templates'
import { asRecord, getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const { session, backendData } = await requireMortgageBackoffice(event)
  const offerId = mortgageBackofficeUuid(getRequiredParam(event, 'offerId'), 'offerId')
  const body = asRecord(await readBody(event))
  const expectedRevision = mortgageBackofficeRevision(body.expectedRevision)

  const [{ data: draft, error: draftError }, { data: product, error: productError }] = await Promise.all([
    backendData
      .from('mortgage_product_drafts')
      .select('id, revision, draft_data')
      .eq('product_id', offerId)
      .maybeSingle(),
    backendData
      .from('mortgage_products')
      .select('id, bank_id')
      .eq('id', offerId)
      .maybeSingle(),
  ])
  throwMortgageBackofficeDbError(draftError)
  throwMortgageBackofficeDbError(productError)
  if (!product) throw createError({ statusCode: 404, statusMessage: 'Mortgage offer not found' })
  if (!draft) throw createError({ statusCode: 409, statusMessage: 'Save a draft before publishing' })
  if (Number(draft.revision) !== expectedRevision) {
    throw createError({ statusCode: 409, statusMessage: 'The draft changed in another session' })
  }

  const draftData = draft.draft_data as MortgageOfferVersionV2
  let validation: MortgageOfferValidationV2
  try {
    validation = validateMortgageOfferV2(draftData)
  } catch {
    validation = {
      valid: false,
      issues: [{ kind: 'error', code: 'invalid_offer_shape', path: '', message: 'The mortgage offer structure is incomplete.' }],
    }
  }
  const assignedTemplateIds = mortgageTemplateIdsFromDraft(draft.draft_data)
  const templatesResult = assignedTemplateIds.length
    ? await backendData
        .from('mortgage_document_templates')
        .select('template_key')
        .eq('bank_id', product.bank_id)
        .gt('active_revision', 0)
        .not('source_file_version_id', 'is', null)
        .in('template_key', assignedTemplateIds)
    : { data: [], error: null }
  throwMortgageBackofficeDbError(templatesResult.error)
  const publishedTemplateIds = new Set((templatesResult.data ?? []).map((template: any) => String(template.template_key)))
  const documentationIssues = [
    ...mortgageOfferDocumentationIssues(draft.draft_data),
    ...assignedTemplateIds.flatMap((templateId) => (
      publishedTemplateIds.has(templateId)
        ? []
        : [{
            kind: 'error' as const,
            code: 'unpublished_multiform_template',
            path: 'documentation.requirements',
            message: `Szablon Multiwniosku „${templateId}” nie jest opublikowany albo nie pochodzi z plików tego banku.`,
          }]
    )),
  ]
  const today = new Date().toISOString().slice(0, 10)
  const validityIssues: MortgageCalculationIssueV2[] = []
  if (draftData.validity?.effectiveFrom > today) {
    validityIssues.push({ kind: 'error', code: 'future_offer_publication_unsupported', path: 'validity.effectiveFrom', message: 'Save future pricing as a draft and publish it on its effective date.' })
  }
  if (draftData.validity?.effectiveTo && draftData.validity.effectiveTo < today) {
    validityIssues.push({ kind: 'error', code: 'expired_offer_cannot_be_published', path: 'validity.effectiveTo', message: 'An expired mortgage offer cannot become the current catalogue version.' })
  }

  const scenarioIssues: MortgageCalculationIssueV2[] = []
  if (validation.valid && !validation.issues.some(issue => issue.kind === 'incomplete')) {
    const matrix = buildMortgagePublicationScenarioMatrix(draftData)
    scenarioIssues.push(...matrix.issues)
    const scenarioFailureKeys = new Set<string>()
    for (const publicationScenario of matrix.scenarios) {
      const result = calculateMortgageOfferV2(draftData, publicationScenario.scenario)
      for (const resultIssue of result.issues.filter(issue => issue.kind === 'error' || issue.kind === 'incomplete')) {
        const key = `${resultIssue.code}:${resultIssue.path}`
        if (scenarioFailureKeys.has(key)) continue
        scenarioFailureKeys.add(key)
        scenarioIssues.push({
          ...resultIssue,
          path: `publicationScenarios.${publicationScenario.id}${resultIssue.path ? `.${resultIssue.path}` : ''}`,
          message: `${publicationScenario.description}: ${resultIssue.message}`,
        })
      }
    }
  }
  const uniqueScenarioIssues = [...new Map(scenarioIssues.map(issue => [`${issue.code}:${issue.path}`, issue])).values()]
  const hasIncompleteData = validation.issues.some(issue => issue.kind === 'incomplete')
  if (!validation.valid || hasIncompleteData || documentationIssues.length || validityIssues.length || uniqueScenarioIssues.length) {
    const validationReport = {
      valid: false,
      issues: [...validation.issues, ...documentationIssues, ...validityIssues, ...uniqueScenarioIssues],
    }
    await backendData
      .from('mortgage_product_drafts')
      .update({ validation_report: validationReport })
      .eq('id', draft.id)
      .eq('revision', expectedRevision)
    throw createError({
      statusCode: 422,
      statusMessage: validityIssues.length
        ? 'Mortgage offer is not currently effective'
        : documentationIssues.length
        ? 'Mortgage offer documentation is incomplete'
        : hasIncompleteData
        ? 'Mortgage offer still contains unknown costs'
        : 'Mortgage offer is not ready for publication',
      data: { issues: validationReport.issues },
    })
  }

  const materializedDraftData = await materializeMortgageOfferSources(backendData, {
    bankId: product.bank_id,
    productId: offerId,
    draftData: draft.draft_data,
  })

  const validationUpdate = await backendData
    .from('mortgage_product_drafts')
    .update({
      draft_data: materializedDraftData,
      validation_report: validation,
      updated_by_user_id: session.userId,
    })
    .eq('id', draft.id)
    .eq('revision', expectedRevision)
    .select('id')
    .maybeSingle()
  throwMortgageBackofficeDbError(validationUpdate.error)
  if (!validationUpdate.data) throw createError({ statusCode: 409, statusMessage: 'The draft changed in another session' })

  const { data: published, error: publishError } = await backendData.rpc(
    'publish_mortgage_product_draft',
    {
      p_product_id: offerId,
      p_expected_revision: expectedRevision,
      p_actor_user_id: session.userId,
    },
  )
  throwMortgageBackofficeDbError(publishError)

  const versionId = typeof published === 'string'
    ? published
    : Array.isArray(published)
      ? published[0]?.version_id ?? published[0]?.id ?? null
      : published?.version_id ?? published?.id ?? null

  return { data: { productId: offerId, versionId, status: 'published' } }
})
