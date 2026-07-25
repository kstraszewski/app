import { serverSupabaseServiceRole } from '#supabase/server'
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
import { mergeAiMappingSuggestions } from '~~/server/utils/mortgage-template-ai'
import {
  normalizeMortgageTemplatePdfAsset,
  validateMortgageTemplatePdf,
} from '~~/server/utils/mortgage-template-source'
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

  const serviceRole = serverSupabaseServiceRole(event) as any
  const [bankResult, templateResult] = await Promise.all([
    serviceRole
      .from('mortgage_banks')
      .select('id, slug')
      .eq('id', bankId)
      .maybeSingle(),
    serviceRole
      .from('mortgage_document_templates')
      .select('draft_revision')
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
  if (!registered) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Nie znaleziono zarejestrowanego formularza PDF tej instytucji.',
    })
  }
  const { template: currentTemplate } = validateMortgageTemplateForBank(
    body.template,
    bankSlug,
    templateId,
  )

  const rawAsset = await useStorage('assets:mortgage-template-pdfs')
    .getItemRaw(registered.source.fileName)
  const bytes = normalizeMortgageTemplatePdfAsset(rawAsset)
  if (!bytes) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Źródłowy formularz PDF nie został dołączony do wdrożenia CRM.',
    })
  }
  const sourceValidation = validateMortgageTemplatePdf(bytes, registered.source.sha256)
  if (!sourceValidation.valid) {
    throw createError({
      statusCode: sourceValidation.reason === 'too_large' ? 413 : 500,
      statusMessage: sourceValidation.reason === 'too_large'
        ? 'Źródłowy PDF przekracza limit 25 MB.'
        : 'Źródłowy PDF nie przeszedł weryfikacji integralności.',
    })
  }

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
      registered.source.fileName,
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
