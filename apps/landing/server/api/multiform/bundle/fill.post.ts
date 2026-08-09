import { createHash } from 'node:crypto'
import {
  getTemplate,
  prepareBundle,
  templateApplicantCapacityIssues,
  type DocumentTemplate,
} from '@openexpert/multiform'
import { createError, readBody, setHeader } from 'h3'
import {
  canonicalMaxLengthIssue,
  firstUnsupportedTemplateFillMethod,
  isCanonicalFieldRequired,
  isCanonicalFieldVisible,
  isMissingValue,
  normalizeValues,
  readMultiformAsset,
  unsupportedTemplateFillMethodHttpDetails,
} from '../../../utils/multiform-api'
import {
  downloadSelectedCrmAttachments,
  loadCrmMultiformContext,
  parseCrmMultiformSelection,
} from '../../../utils/multiform-crm'
import {
  readPinnedMultiformTemplateSource,
  resolvePinnedMultiformTemplates,
} from '../../../utils/multiform-template-repository'
import {
  createPdfBundle,
  fillPdfTemplate,
  MultiformPdfValueError,
  UnsupportedMultiformFillMethodError,
  safeArchiveDirectoryName,
} from '../../../utils/multiform-pdf'

interface FillBundleBody {
  templateIds?: unknown
  values?: unknown
  collectionCounts?: unknown
  crmContext?: unknown
  output?: unknown
  templateId?: unknown
  password?: unknown
}

interface ValidationIssue {
  key: string
  message: string
}

const MAX_DOCUMENTS = 10
const FONT_FILE = 'DMSans-VariableFont_opsz,wght.ttf'

type BundleFields = ReturnType<typeof prepareBundle>['fields']
type BundleCollections = ReturnType<typeof prepareBundle>['collections']
type NormalizedValues = ReturnType<typeof normalizeValues>

function parseNumber(value: string | number | boolean) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string') return undefined

  const compact = value.trim().replace(/[\s\u00A0\u202F]/g, '')
  if (!compact) return undefined

  const decimalCommas = compact.match(/,/g)?.length ?? 0
  if (decimalCommas > 1) return undefined

  const normalized = decimalCommas === 1
    ? compact.replaceAll('.', '').replace(',', '.')
    : compact
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return undefined

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function validateValues(
  fields: BundleFields,
  collections: BundleCollections,
  values: NormalizedValues,
  collectionCounts: Readonly<Record<string, number>>,
) {
  const issues: ValidationIssue[] = []
  const collectionByKey = new Map(collections.map(collection => [collection.key, collection]))

  for (const field of fields) {
    const collection = field.collection
      ? collectionByKey.get(field.collection.key)
      : undefined
    if (
      field.collection
      && field.collection.index >= (collectionCounts[field.collection.key] ?? collection?.minItems ?? 0)
    ) {
      continue
    }
    if (!isCanonicalFieldVisible(field, values)) continue

    const value = values[field.canonicalKey]
    if (isMissingValue(value)) {
      const requiredByCollection = Boolean(
        collection
        && field.collection
        && collection.requiredRelativeKeys.includes(field.collection.relativeKey),
      )
      if (isCanonicalFieldRequired(field, values) || requiredByCollection) {
        issues.push({ key: field.canonicalKey, message: 'Pole jest wymagane.' })
      }
      continue
    }
    if (value === undefined) continue

    const maxLengthIssue = canonicalMaxLengthIssue(field, value)
    if (maxLengthIssue) {
      issues.push({
        key: field.canonicalKey,
        message: maxLengthIssue,
      })
      continue
    }

    if (field.options?.length && !field.options.some(option => option.value === String(value))) {
      issues.push({ key: field.canonicalKey, message: 'Wybrano nieobsługiwaną opcję.' })
      continue
    }

    if (field.type === 'date') {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
      const parsed = match
        ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
        : undefined
      if (
        !match
        || !parsed
        || parsed.getUTCFullYear() !== Number(match[1])
        || parsed.getUTCMonth() !== Number(match[2]) - 1
        || parsed.getUTCDate() !== Number(match[3])
      ) {
        issues.push({ key: field.canonicalKey, message: 'Nieprawidłowa data.' })
        continue
      }
    }

    const validation = field.validation
    if (!validation) continue

    if (validation.pattern && !new RegExp(validation.pattern).test(String(value))) {
      issues.push({ key: field.canonicalKey, message: 'Nieprawidłowy format.' })
      continue
    }

    const hasNumericRule = validation.min !== undefined
      || validation.max !== undefined
      || validation.integer === true
    if (!hasNumericRule) continue

    const numericValue = parseNumber(value)
    if (numericValue === undefined) {
      issues.push({ key: field.canonicalKey, message: 'Wartość musi być liczbą.' })
      continue
    }
    if (validation.integer && !Number.isInteger(numericValue)) {
      issues.push({ key: field.canonicalKey, message: 'Wartość musi być liczbą całkowitą.' })
      continue
    }
    if (validation.min !== undefined && numericValue < validation.min) {
      issues.push({
        key: field.canonicalKey,
        message: `Wartość nie może być mniejsza niż ${validation.min}.`,
      })
      continue
    }
    if (validation.max !== undefined && numericValue > validation.max) {
      issues.push({
        key: field.canonicalKey,
        message: `Wartość nie może być większa niż ${validation.max}.`,
      })
    }
  }

  return issues
}

function parseCollectionCounts(
  input: unknown,
  collections: BundleCollections,
  fields: BundleFields,
  values: NormalizedValues,
) {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw createError({ statusCode: 400, statusMessage: 'Lista elementów formularza jest nieprawidłowa.' })
  }

  const provided = (input ?? {}) as Record<string, unknown>
  const allowedKeys = new Set(collections.map(collection => collection.key))
  if (Object.keys(provided).some(key => !allowedKeys.has(key))) {
    throw createError({ statusCode: 400, statusMessage: 'Lista elementów formularza zawiera nieznaną kolekcję.' })
  }

  return Object.fromEntries(collections.map((collection) => {
    const rawCount = provided[collection.key]
    if (rawCount !== undefined) {
      if (
        typeof rawCount !== 'number'
        || !Number.isInteger(rawCount)
        || rawCount < collection.minItems
        || rawCount > collection.maxItems
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: `${collection.label}: nieprawidłowa liczba elementów.`,
        })
      }
      return [collection.key, rawCount]
    }

    const inferredCount = fields.reduce((count, field) => {
      if (
        field.collection?.key !== collection.key
        || isMissingValue(values[field.canonicalKey])
      ) {
        return count
      }
      return Math.max(count, field.collection.index + 1)
    }, collection.minItems)
    return [collection.key, Math.min(inferredCount, collection.maxItems)]
  }))
}

function activeCollectionValues(
  fields: BundleFields,
  values: NormalizedValues,
  collectionCounts: Readonly<Record<string, number>>,
) {
  const activeValues = { ...values }
  for (const field of fields) {
    if (
      field.collection
      && field.collection.index >= (collectionCounts[field.collection.key] ?? 0)
    ) {
      delete activeValues[field.canonicalKey]
    }
  }
  return activeValues
}

function checksum(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseCrmFillContext(value: unknown) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Kontekst sprawy CRM jest nieprawidłowy.' })
  }

  const source = value as Record<string, unknown>
  if (source.documentIds !== undefined && !Array.isArray(source.documentIds)) {
    throw createError({ statusCode: 400, statusMessage: 'Lista załączników CRM jest nieprawidłowa.' })
  }
  const documentIds = (source.documentIds ?? []) as unknown[]
  if (documentIds.some(documentId => typeof documentId !== 'string' || !documentId.trim())) {
    throw createError({ statusCode: 400, statusMessage: 'Lista załączników CRM jest nieprawidłowa.' })
  }

  return {
    selection: parseCrmMultiformSelection(source),
    documentIds: [...new Set(documentIds.map(documentId => (documentId as string).trim()))],
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every(value => rightSet.has(value))
}

function parseArchivePassword(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length < 11 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Hasło paczki ZIP jest nieprawidłowe.' })
  }
  return value
}

function applicationArchiveDirectories(context: Awaited<ReturnType<typeof loadCrmMultiformContext>>) {
  const used = new Set<string>()
  return new Map(context.applications
    .slice()
    .sort((left, right) => left.slot - right.slot)
    .map((application) => {
      const base = safeArchiveDirectoryName(application.bankName, 'Bank')
      let directory = base
      let suffix = 2
      while (used.has(directory.toLocaleLowerCase('pl-PL'))) {
        directory = `${base}-${suffix}`
        suffix += 1
      }
      used.add(directory.toLocaleLowerCase('pl-PL'))
      return [application.applicationId, directory] as const
    }))
}

function pdfAttachmentHeader(fileName: string, prefix = 'uzupelniony-') {
  const normalized = fileName
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'wniosek.pdf'
  const pdfName = normalized.toLocaleLowerCase('pl-PL').endsWith('.pdf')
    ? normalized
    : `${normalized}.pdf`
  const outputName = `${prefix}${pdfName}`
  const asciiName = outputName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(outputName)}`
}

export default defineEventHandler(async (event) => {
  const body = await readBody<FillBundleBody>(event)
  if (!Array.isArray(body?.templateIds) || body.templateIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Wybierz co najmniej jeden dokument.' })
  }
  if (body.templateIds.some(id => typeof id !== 'string' || id.trim() === '')) {
    throw createError({ statusCode: 400, statusMessage: 'Lista dokumentów jest nieprawidłowa.' })
  }

  const templateIds = [...new Set(body.templateIds.map(id => (id as string).trim()))]
  if (templateIds.length > MAX_DOCUMENTS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Pakiet może zawierać maksymalnie ${MAX_DOCUMENTS} dokumentów.`,
    })
  }

  const output = body.output === undefined ? 'zip' : body.output
  if (output !== 'zip' && output !== 'pdf' && output !== 'source') {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowy format eksportu.' })
  }
  const requestedTemplateId = typeof body.templateId === 'string'
    ? body.templateId.trim()
    : ''
  if (output !== 'zip' && (!requestedTemplateId || !templateIds.includes(requestedTemplateId))) {
    throw createError({ statusCode: 400, statusMessage: 'Wybierz formularz PDF do pobrania.' })
  }
  const archivePassword = output === 'zip' ? parseArchivePassword(body.password) : undefined

  const requestedCrmContext = parseCrmFillContext(body.crmContext)
  const crmContext = requestedCrmContext
    ? await loadCrmMultiformContext(event, requestedCrmContext.selection)
    : undefined
  if (crmContext && !sameStringSet(templateIds, crmContext.templateIds)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Zestaw template’ów nie odpowiada aktywnym wnioskom CRM. Odśwież kontekst sprawy.',
    })
  }
  const templateOverrides = crmContext
    ? await resolvePinnedMultiformTemplates(event, crmContext.applications)
    : []
  const overrideById = new Map(templateOverrides.map(template => [template.id, template]))
  const templates = templateIds.map(id => overrideById.get(id) ?? getTemplate(id))
  if (templates.some(template => !template)) {
    throw createError({ statusCode: 400, statusMessage: 'Wybrano nieznany template dokumentu.' })
  }
  const unsupportedTemplate = firstUnsupportedTemplateFillMethod(
    templates.filter((template): template is DocumentTemplate => Boolean(template)),
  )
  if (unsupportedTemplate) {
    throw createError(unsupportedTemplateFillMethodHttpDetails(unsupportedTemplate))
  }
  const templatesToRender = output !== 'zip'
    ? templates.filter(template => template?.id === requestedTemplateId)
    : templates
  if (crmContext && !crmContext.validation.valid) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Template’y aktywnych wniosków nie są gotowe do eksportu.',
      data: { blockers: crmContext.validation.blockers },
    })
  }
  const archiveDirectoryByApplicationId = crmContext
    ? applicationArchiveDirectories(crmContext)
    : new Map<string, string>()

  if (output === 'source') {
    const template = templatesToRender[0]
    if (!template) throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono szablonu PDF.' })
    try {
      const pinnedSourceBytes = crmContext
        ? await readPinnedMultiformTemplateSource(event, template)
        : null
      const sourceBytes = pinnedSourceBytes ?? await readMultiformAsset(
        'assets:multiform-mocks',
        template.source.fileName,
      )
      if (checksum(sourceBytes) !== template.source.sha256) {
        throw new Error('PDF source checksum mismatch')
      }
      setHeader(event, 'Content-Type', 'application/pdf')
      setHeader(event, 'Content-Disposition', pdfAttachmentHeader(template.source.fileName, ''))
      setHeader(event, 'Cache-Control', 'no-store, max-age=0')
      return sourceBytes
    }
    catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error
      throw createError({ statusCode: 500, statusMessage: 'Nie udało się pobrać pustego szablonu PDF.' })
    }
  }

  const bundle = prepareBundle(templateIds, templateOverrides)
  if (bundle.warnings.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Co najmniej jeden dokument nie ma pełnego, zatwierdzonego mapowania.',
      data: { warnings: bundle.warnings },
    })
  }
  const normalizedValues = normalizeValues(body.values)
  const collectionCounts = parseCollectionCounts(
    body.collectionCounts,
    bundle.collections,
    bundle.fields,
    normalizedValues,
  )
  if (
    crmContext
    && bundle.collections.some(collection => collection.key === 'applicants')
    && collectionCounts.applicants !== crmContext.applicants.length
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Liczba wnioskodawców formularza nie odpowiada aktualnej sprawie CRM.',
      data: {
        blockers: [
          `Formularz zawiera ${collectionCounts.applicants ?? 0} `
          + `wnioskodawców, a sprawa zawiera ${crmContext.applicants.length}.`,
        ],
      },
    })
  }
  const applicantCapacityIssues = templateApplicantCapacityIssues(
    templates.filter((template): template is DocumentTemplate => Boolean(template)),
    collectionCounts.applicants ?? 0,
  )
  if (applicantCapacityIssues.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Co najmniej jeden dokument nie obsługuje liczby wnioskodawców w formularzu.',
      data: {
        blockers: applicantCapacityIssues.map(issue => (
          `${issue.templateLabel} obsługuje maksymalnie ${issue.supportedCount} `
          + `wnioskodawców, a formularz zawiera ${issue.requestedCount}.`
        )),
      },
    })
  }
  const values = activeCollectionValues(bundle.fields, normalizedValues, collectionCounts)
  const validationIssues = validateValues(
    bundle.fields,
    bundle.collections,
    values,
    collectionCounts,
  )
  if (validationIssues.length > 0) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Uzupełnij lub popraw dane formularza.',
      data: { errors: validationIssues },
    })
  }

  try {
    const [documents, fontBytes, attachments] = await Promise.all([
      Promise.all(templatesToRender.map(async (template) => {
        // The earlier unknown-template check narrows this at runtime.
        if (!template) throw new Error('Unknown template')

        const pinnedSourceBytes = crmContext
          ? await readPinnedMultiformTemplateSource(event, template)
          : null
        const sourceBytes = pinnedSourceBytes ?? await readMultiformAsset(
          'assets:multiform-mocks',
          template.source.fileName,
        )
        if (checksum(sourceBytes) !== template.source.sha256) {
          throw new Error('PDF source checksum mismatch')
        }

        return {
          fileName: template.source.fileName,
          template,
          sourceBytes,
          directory: crmContext
            ? archiveDirectoryByApplicationId.get(
                crmContext.applications.find(application => (
                  application.templateIds.includes(template.id)
                ))?.applicationId ?? '',
              )
            : undefined,
        }
      })),
      readMultiformAsset('assets:multiform-fonts', FONT_FILE),
      output === 'zip' && crmContext && requestedCrmContext
        ? downloadSelectedCrmAttachments(crmContext, requestedCrmContext.documentIds)
        : Promise.resolve([]),
    ])

    if (output === 'pdf') {
      const document = documents[0]
      if (!document) throw new Error('Requested PDF template is unavailable')
      const filled = await fillPdfTemplate(
        document.template,
        document.sourceBytes,
        fontBytes,
        values,
      )
      setHeader(event, 'Content-Type', 'application/pdf')
      setHeader(event, 'Content-Disposition', pdfAttachmentHeader(document.fileName))
      setHeader(event, 'Cache-Control', 'no-store, max-age=0')
      return filled
    }

    const archiveAttachments = attachments.map(attachment => ({
      ...attachment,
      directory: attachment.submissionId
        ? archiveDirectoryByApplicationId.get(attachment.submissionId)
        : 'Wspólne',
    }))
    const archive = await createPdfBundle(
      documents,
      fontBytes,
      values,
      archiveAttachments,
      { password: archivePassword },
    )
    setHeader(event, 'Content-Type', 'application/zip')
    setHeader(event, 'Content-Disposition', 'attachment; filename="uzupelnione-wnioski.zip"')
    setHeader(event, 'Cache-Control', 'no-store, max-age=0')
    return archive
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    if (error instanceof UnsupportedMultiformFillMethodError) {
      const label = error.fillMethod === 'web_form'
        ? 'Formularz internetowy'
        : 'Integracja API'
      throw createError({
        statusCode: 501,
        statusMessage: `${label} nie jest jeszcze obsługiwany w eksporcie PDF/ZIP.`,
        data: { fillMethod: error.fillMethod },
      })
    }
    if (error instanceof MultiformPdfValueError) {
      throw createError({
        statusCode: 422,
        statusMessage: 'Uzupełnij lub popraw dane formularza.',
        data: {
          errors: [{ key: error.canonicalKey, message: error.message }],
        },
      })
    }
    console.error(
      'Multiform PDF bundle rendering failed:',
      error instanceof Error ? error.name : 'UnknownError',
    )
    throw createError({
      statusCode: 500,
      statusMessage: 'Nie udało się przygotować pakietu dokumentów.',
    })
  }
})
