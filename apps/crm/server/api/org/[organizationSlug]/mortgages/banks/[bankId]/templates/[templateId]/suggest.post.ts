import { serverDataBackend } from '~~/server/utils/data-api'
import {
  generateTemplateDraft,
  MultiformPdfInputError,
  TEMPLATE_GENERATOR_MODEL,
} from '@openexpert/multiform/template-generator'
import type { TemplateBinding } from '@openexpert/multiform'
import { createError, readBody } from 'h3'
import {
  mortgageBackofficeRevision,
  mortgageBackofficeUuid,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import {
  mortgageTemplateJsonBytes,
  mortgageTemplateKey,
  registeredMortgageTemplate,
  validateMortgageTemplateForBank,
} from '~~/server/utils/mortgage-document-templates'
import {
  loadMortgageDocumentTemplateSource,
  mortgageDocumentTemplateSourceDescriptor,
} from '~~/server/utils/mortgage-document-template-source'
import { mergeAiMappingSuggestions } from '~~/server/utils/mortgage-template-ai'
import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
} from '~~/server/utils/crm'

const generationWindowMs = 60 * 60 * 1000
const generationLimit = 6
const generationTimeoutMs = 55_000
const generationBuckets = new Map<string, { count: number, startedAt: number }>()

function consumeGenerationQuota(key: string) {
  const now = Date.now()
  const previous = generationBuckets.get(key)
  const bucket = !previous || now - previous.startedAt >= generationWindowMs
    ? { count: 0, startedAt: now }
    : previous
  if (bucket.count >= generationLimit) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Limit Agenta AI to 6 analiz tego szablonu na godzinę.',
    })
  }
  bucket.count += 1
  generationBuckets.set(key, bucket)
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const bankId = mortgageBackofficeUuid(getRequiredParam(event, 'bankId'), 'bankId')
  const templateId = mortgageTemplateKey(getRequiredParam(event, 'templateId'))
  const body = await readBody<{ expectedRevision?: unknown, template?: unknown }>(event)
  const expectedRevision = mortgageBackofficeRevision(body?.expectedRevision)
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'template')) {
    throw createError({ statusCode: 400, statusMessage: 'Brak Template JSON do analizy.' })
  }
  mortgageTemplateJsonBytes(body.template)

  const backendData = serverDataBackend(event) as any
  const [bankResult, templateResult] = await Promise.all([
    backendData
      .from('mortgage_banks')
      .select('id, slug')
      .eq('id', bankId)
      .maybeSingle(),
    backendData
      .from('mortgage_document_templates')
      .select('source_file_id, source_file_version_id, source_file_name, source_sha256, draft_revision')
      .eq('bank_id', bankId)
      .eq('template_key', templateId)
      .maybeSingle(),
  ])
  throwMortgageBackofficeDbError(bankResult.error)
  throwMortgageBackofficeDbError(templateResult.error)
  if (!bankResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono instytucji finansowej.' })
  }
  const currentRevision = Number(templateResult.data?.draft_revision ?? 0)
  if (currentRevision !== expectedRevision) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Szkic zmienił się w innej sesji. Odśwież edytor przed ponowną analizą AI.',
    })
  }

  const bankSlug = String(bankResult.data.slug)
  const registered = registeredMortgageTemplate(bankSlug, templateId)
  const sourceDescriptor = mortgageDocumentTemplateSourceDescriptor(
    bankSlug,
    templateResult.data,
    registered,
  )
  const { template: currentTemplate } = validateMortgageTemplateForBank(
    body.template,
    bankSlug,
    templateId,
    sourceDescriptor,
  )

  const source = await loadMortgageDocumentTemplateSource(
    backendData,
    templateResult.data,
    registered,
  )
  const bytes = source.bytes

  const config = useRuntimeConfig(event)
  const gatewayApiKey = String(config.aiGatewayApiKey || process.env.AI_GATEWAY_API_KEY || '').trim()
  if (!gatewayApiKey && !process.env.VERCEL_OIDC_TOKEN) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Agent AI nie ma skonfigurowanego dostępu do modelu.',
    })
  }
  consumeGenerationQuota(`${session.userId}:${bankId}:${templateId}`)

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), generationTimeoutMs)
  let generated: Awaited<ReturnType<typeof generateTemplateDraft>>
  try {
    generated = await generateTemplateDraft(
      source.fileName,
      bytes,
      {
        gatewayApiKey,
        abortSignal: abortController.signal,
      },
    )
  }
  catch (caught) {
    if (caught instanceof MultiformPdfInputError) {
      throw createError({ statusCode: caught.statusCode, statusMessage: caught.message })
    }
    if (abortController.signal.aborted) {
      throw createError({
        statusCode: 504,
        statusMessage: 'Analiza PDF przez Agenta AI przekroczyła limit czasu.',
      })
    }
    console.error(
      '[mortgage-template-ai] generation failed',
      caught instanceof Error ? caught.name : 'UnknownError',
    )
    throw createError({
      statusCode: 502,
      statusMessage: 'Agent AI nie zdołał przeanalizować formularza PDF.',
    })
  }
  finally {
    clearTimeout(timeout)
  }

  if (generated.source.sha256 !== currentTemplate.source.sha256) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Wynik Agenta AI dotyczy innej wersji źródłowego PDF-u.',
    })
  }
  const merged = mergeAiMappingSuggestions(
    currentTemplate,
    generated.bindings as unknown as readonly TemplateBinding[],
  )
  const { template, validation } = validateMortgageTemplateForBank(
    merged.template,
    bankSlug,
    templateId,
    sourceDescriptor,
  )

  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    schemaVersion: 1 as const,
    template,
    validation,
    generation: {
      model: TEMPLATE_GENERATOR_MODEL,
      proposedCount: generated.bindings.length,
      addedCount: merged.addedCount,
      skippedTargetCount: merged.skippedTargetCount,
      skippedUnmappedCount: merged.skippedUnmappedCount,
    },
  }
})
