import {
  CANONICAL_COMPUTED_BINDINGS,
  CANONICAL_FIELDS,
  type DocumentTemplate,
  type PdfBox,
  type PdfCoordinateSpace,
  type PdfPageGeometry,
  type TemplateBinding,
} from '@openexpert/multiform'
import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, getHeader, readBody, setHeader } from 'h3'
import sharp from 'sharp'
import { targetBoxToVisualCropBox } from '~~/app/utils/multiform-visual-geometry'
import {
  mortgageBackofficeRevision,
  mortgageBackofficeUuid,
  throwMortgageBackofficeDbError,
} from '~~/server/utils/mortgage-backoffice'
import {
  mortgageTemplateJsonBytes,
  mortgageTemplateKey,
  validateMortgageTemplateForBank,
} from '~~/server/utils/mortgage-document-templates'
import {
  generateMortgageFieldSemanticContract,
  mortgageFieldSemanticModel,
} from '~~/server/utils/mortgage-template-semantic-ai'
import {
  getRequiredParam,
  requireCrmSession,
  requireSuperAdmin,
} from '~~/server/utils/crm'

const maxImageBytes = 3 * 1024 * 1024
const maxRequestBytes = 5 * 1024 * 1024
const generationWindowMs = 60 * 60 * 1000
const generationLimit = 60
const generationTimeoutMs = 35_000
const generationBuckets = new Map<string, { count: number, startedAt: number }>()
const definitions = [...CANONICAL_FIELDS, ...CANONICAL_COMPUTED_BINDINGS]
const definitionByKey = new Map<string, (typeof definitions)[number]>(
  definitions.map(definition => [definition.canonicalKey, definition]),
)

interface SemanticHintsBody {
  expectedRevision?: unknown
  template?: unknown
  bindingIndex?: unknown
  widgetIndex?: unknown
  selection?: {
    page?: unknown
    box?: unknown
  }
  image?: {
    mediaType?: unknown
    base64?: unknown
  }
}

const acroCoordinateSpace: PdfCoordinateSpace = {
  units: 'pt',
  referenceBox: 'media',
  origin: 'bottom-left',
  orientation: 'unrotated',
}

function consumeGenerationQuota(key: string) {
  const now = Date.now()
  const previous = generationBuckets.get(key)
  const bucket = !previous || now - previous.startedAt >= generationWindowMs
    ? { count: 0, startedAt: now }
    : previous
  if (bucket.count >= generationLimit) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Limit Agenta AI to 60 analiz pojedynczych pól na godzinę.',
    })
  }
  bucket.count += 1
  generationBuckets.set(key, bucket)
}

function selectedBox(value: unknown): PdfBox {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Brak geometrii zaznaczonego pola.' })
  }
  const box = value as Record<string, unknown>
  if (
    ![box.x, box.y, box.width, box.height].every(item => typeof item === 'number' && Number.isFinite(item))
    || Number(box.width) <= 0
    || Number(box.height) <= 0
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Geometria zaznaczonego pola jest nieprawidłowa.' })
  }
  return {
    x: Number(box.x),
    y: Number(box.y),
    width: Number(box.width),
    height: Number(box.height),
  }
}

async function selectedImage(value: SemanticHintsBody['image']) {
  const mediaType = value?.mediaType
  const base64 = value?.base64
  if (
    (mediaType !== 'image/jpeg' && mediaType !== 'image/png')
    || typeof base64 !== 'string'
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)
    || base64.length > Math.ceil(maxImageBytes / 3) * 4 + 4
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Podgląd zaznaczonej strony ma nieprawidłowy format.' })
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.byteLength < 32 || bytes.byteLength > maxImageBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Podgląd zaznaczonej strony przekracza limit 3 MB.' })
  }
  const jpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF
  const png = bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4E
    && bytes[3] === 0x47
  if ((mediaType === 'image/jpeg' && !jpeg) || (mediaType === 'image/png' && !png)) {
    throw createError({ statusCode: 400, statusMessage: 'Sygnatura obrazu nie zgadza się z jego typem.' })
  }
  try {
    const image = sharp(bytes, {
      failOn: 'error',
      limitInputPixels: 16_000_000,
    })
    const metadata = await image.metadata()
    if (
      !metadata.width
      || !metadata.height
      || metadata.width < 320
      || metadata.height < 320
      || metadata.width / metadata.height > 4
      || metadata.height / metadata.width > 4
    ) {
      throw new Error('invalid_dimensions')
    }
    const normalized = await image
      .rotate()
      .resize({
        width: 1_800,
        height: 2_400,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer()
    return {
      bytes: new Uint8Array(normalized.buffer, normalized.byteOffset, normalized.byteLength),
      mediaType: 'image/jpeg' as const,
    }
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Nie udało się bezpiecznie odczytać podglądu strony PDF.' })
  }
}

function visualPageSize(page: {
  cropBox: PdfBox
  rotation: 0 | 90 | 180 | 270
  userUnit: number
}) {
  const rotated = page.rotation === 90 || page.rotation === 270
  return {
    width: (rotated ? page.cropBox.height : page.cropBox.width) * page.userUnit,
    height: (rotated ? page.cropBox.width : page.cropBox.height) * page.userUnit,
  }
}

function sourceWidgetBox(rect: PdfBox, page: PdfPageGeometry): PdfBox {
  return {
    x: (rect.x - page.mediaBox.x) * page.userUnit,
    y: (rect.y - page.mediaBox.y) * page.userUnit,
    width: rect.width * page.userUnit,
    height: rect.height * page.userUnit,
  }
}

function expectedBindingSelection(
  template: DocumentTemplate,
  binding: TemplateBinding,
  widgetIndex: number | undefined,
) {
  const pageByNumber = new Map(template.source.pages.map(page => [page.page, page]))
  const target = binding.target
  if (target.kind === 'overlay' && target.rendererVersion === 2) {
    if (widgetIndex !== undefined) return null
    const page = pageByNumber.get(target.page)
    if (!page) return null
    return {
      page: target.page,
      box: targetBoxToVisualCropBox(page, target.box, target.coordinateSpace),
    }
  }
  if (target.kind !== 'acroform' || widgetIndex === undefined) return null
  const widget = target.expectedWidgets?.find(item => item.index === widgetIndex)
  if (!widget) return null
  const override = target.placementOverrides?.find(item => item.widgetIndex === widget.index)
  const pageNumber = override?.page ?? widget.page
  const page = pageByNumber.get(pageNumber)
  if (!page) return null
  return {
    page: pageNumber,
    box: targetBoxToVisualCropBox(
      page,
      override?.box ?? sourceWidgetBox(widget.rect, page),
      override?.coordinateSpace ?? acroCoordinateSpace,
    ),
  }
}

function boxesMatch(left: PdfBox, right: PdfBox) {
  return (['x', 'y', 'width', 'height'] as const)
    .every(key => Math.abs(left[key] - right[key]) <= 0.05)
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  const contentLength = Number(getHeader(event, 'content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Żądanie analizy pola przekracza limit 5 MB.' })
  }
  const bankId = mortgageBackofficeUuid(getRequiredParam(event, 'bankId'), 'bankId')
  const templateId = mortgageTemplateKey(getRequiredParam(event, 'templateId'))
  const body = await readBody<SemanticHintsBody>(event)
  const expectedRevision = mortgageBackofficeRevision(body?.expectedRevision)
  const bindingIndex = Number(body?.bindingIndex)
  const widgetIndex = body?.widgetIndex === undefined
    ? undefined
    : Number(body.widgetIndex)
  if (!Number.isInteger(bindingIndex) || bindingIndex < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowy indeks wybranego mapowania.' })
  }
  if (widgetIndex !== undefined && (!Number.isInteger(widgetIndex) || widgetIndex < 0)) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowy indeks widgetu źródłowego PDF-u.' })
  }
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'template')) {
    throw createError({ statusCode: 400, statusMessage: 'Brak Template JSON do analizy pola.' })
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
  if (Number(templateResult.data?.draft_revision ?? 0) !== expectedRevision) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Szkic zmienił się w innej sesji. Odśwież edytor przed analizą pola.',
    })
  }

  const bankSlug = String(bankResult.data.slug)
  const { template } = validateMortgageTemplateForBank(
    body.template,
    bankSlug,
    templateId,
  )
  const binding = template.bindings[bindingIndex]
  const definition = binding ? definitionByKey.get(binding.canonicalKey) : undefined
  if (!binding || !definition) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono wybranego pola w aktualnym Template JSON.' })
  }

  const pageNumber = Number(body.selection?.page)
  const page = Number.isInteger(pageNumber)
    ? template.source.pages.find(item => item.page === pageNumber)
    : undefined
  const box = selectedBox(body.selection?.box)
  if (!page) {
    throw createError({ statusCode: 400, statusMessage: 'Zaznaczenie wskazuje stronę spoza źródłowego PDF-u.' })
  }
  const pageSize = visualPageSize(page)
  if (
    box.x < 0
    || box.y < 0
    || box.x + box.width > pageSize.width
    || box.y + box.height > pageSize.height
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Zaznaczenie wychodzi poza obszar strony PDF.' })
  }
  const expectedSelection = expectedBindingSelection(template, binding, widgetIndex)
  if (
    !expectedSelection
    || expectedSelection.page !== page.page
    || !boxesMatch(expectedSelection.box, box)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Zaznaczenie nie odpowiada aktualnej pozycji wybranego pola. Odśwież podgląd i spróbuj ponownie.',
    })
  }
  const image = await selectedImage(body.image)

  const config = useRuntimeConfig(event)
  const gatewayApiKey = String(config.aiGatewayApiKey || process.env.AI_GATEWAY_API_KEY || '').trim()
  if (!gatewayApiKey && !process.env.VERCEL_OIDC_TOKEN) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Agent AI nie ma skonfigurowanego dostępu do modelu.',
    })
  }
  consumeGenerationQuota(`${session.userId}:${bankId}:${templateId}`)

  const currentContract = binding.semanticContract ?? definition
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), generationTimeoutMs)
  let semanticContract: Awaited<ReturnType<typeof generateMortgageFieldSemanticContract>>
  try {
    semanticContract = await generateMortgageFieldSemanticContract({
      canonicalKey: binding.canonicalKey,
      label: definition.label,
      ...('form' in definition
        ? {
            question: definition.form.question,
            helpText: definition.form.helpText,
          }
        : {}),
      currentContract: {
        semanticDescription: currentContract.semanticDescription,
        semanticRole: currentContract.semanticRole,
        aiMappingHints: currentContract.aiMappingHints,
      },
      page: page.page,
      box,
      image,
    }, {
      gatewayApiKey,
      abortSignal: abortController.signal,
    })
  }
  catch (caught) {
    if (abortController.signal.aborted) {
      throw createError({
        statusCode: 504,
        statusMessage: 'Analiza zaznaczonego pola przekroczyła limit czasu.',
      })
    }
    console.error(
      '[mortgage-template-field-semantics] generation failed',
      caught instanceof Error ? caught.name : 'UnknownError',
    )
    throw createError({
      statusCode: 502,
      statusMessage: 'Agent AI nie zdołał wygenerować wskazówek dla tego pola.',
    })
  }
  finally {
    clearTimeout(timeout)
  }

  const currentRevisionResult = await backendData
    .from('mortgage_document_templates')
    .select('draft_revision')
    .eq('bank_id', bankId)
    .eq('template_key', templateId)
    .maybeSingle()
  throwMortgageBackofficeDbError(currentRevisionResult.error)
  const currentRevision = Number(currentRevisionResult.data?.draft_revision ?? 0)
  if (currentRevision !== expectedRevision) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Szkic zmienił się podczas analizy pola. Uruchom generowanie ponownie dla aktualnej wersji.',
    })
  }

  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    schemaVersion: 1 as const,
    bindingIndex,
    canonicalKey: binding.canonicalKey,
    semanticContract,
    generation: {
      model: mortgageFieldSemanticModel,
      page: page.page,
      box,
      revision: currentRevision,
    },
  }
})
