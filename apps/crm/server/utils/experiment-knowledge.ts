import { createHash } from 'node:crypto'
import { embed, embedMany } from 'ai'
import { createError, type H3Event } from 'h3'
import {
  assertExperimentKnowledgeSource,
  experimentKnowledgePlainText,
  normalizeExperimentKnowledgeText,
  splitExperimentKnowledgeText,
  type ExperimentKnowledgeKind,
  type ExperimentKnowledgeSource,
} from '~~/app/utils/experiment-knowledge'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  mortgageBankFileEmbeddingDimensions,
  mortgageBankFileEmbeddingModel,
  mortgageBankFileEmbeddingProvider,
} from '~~/server/utils/mortgage-bank-files'
import {
  requireAdministrativePermission,
  requireCrmSession,
  type CrmSession,
} from '~~/server/utils/crm'

type BackendDataClient = any
type DatabaseRecord = Record<string, any>

export interface ExperimentKnowledgeContext {
  session: CrmSession
  backendData: BackendDataClient
}

export interface ExperimentKnowledgeWriteInput extends ExperimentKnowledgeSource {
  expectedRevision?: number | null
  institutionIds?: string[]
}

export interface ExperimentKnowledgeInstitution {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  brandColor: string | null
  brandForegroundColor: string | null
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export async function requireExperimentKnowledgeAccess(event: H3Event): Promise<ExperimentKnowledgeContext> {
  const session = await requireCrmSession(event)
  await requireAdministrativePermission(session, 'experiments.use')
  return {
    session,
    backendData: serverDataBackend(event) as BackendDataClient,
  }
}

export function experimentKnowledgeUuid(value: unknown, field = 'documentId') {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a UUID` })
  }
  return value.toLowerCase()
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null
}

export function parseExperimentKnowledgeWriteInput(value: unknown): ExperimentKnowledgeWriteInput {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const kind: ExperimentKnowledgeKind | null = body.kind === 'text' || body.kind === 'dynamic_html'
    ? body.kind
    : null
  if (!kind) throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowy rodzaj dokumentu.' })

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const input: ExperimentKnowledgeWriteInput = {
    kind,
    title,
    textContent: kind === 'text' ? nullableString(body.textContent) : null,
    htmlContent: kind === 'dynamic_html' ? nullableString(body.htmlContent) : null,
    cssContent: kind === 'dynamic_html' ? nullableString(body.cssContent) ?? '' : null,
    javascriptContent: kind === 'dynamic_html' ? nullableString(body.javascriptContent) ?? '' : null,
    expectedRevision: typeof body.expectedRevision === 'number'
      && Number.isInteger(body.expectedRevision)
      && body.expectedRevision >= 1
      ? body.expectedRevision
      : null,
    institutionIds: body.institutionIds === undefined
      ? undefined
      : parseExperimentKnowledgeInstitutionIds(body.institutionIds),
  }

  try {
    assertExperimentKnowledgeSource(input)
  }
  catch (caught) {
    throw createError({
      statusCode: 400,
      statusMessage: caught instanceof Error ? caught.message : 'Nieprawidłowa zawartość dokumentu.',
    })
  }

  const plainText = experimentKnowledgePlainText(input)
  if (!plainText) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Dokument nie zawiera tekstu, który można dodać do wyszukiwarki.',
    })
  }
  return input
}

function parseExperimentKnowledgeInstitutionIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: 'Lista instytucji finansowych jest nieprawidłowa.' })
  }
  if (value.length > 20) {
    throw createError({ statusCode: 400, statusMessage: 'Dokument może być powiązany z maksymalnie 20 instytucjami.' })
  }
  return [...new Set(value.map(item => experimentKnowledgeUuid(item, 'institutionIds')))]
}

function knowledgeContentSha256(source: ExperimentKnowledgeSource) {
  return createHash('sha256').update(JSON.stringify({
    kind: source.kind,
    title: source.title,
    textContent: source.textContent,
    htmlContent: source.htmlContent,
    cssContent: source.cssContent,
    javascriptContent: source.javascriptContent,
  })).digest('hex')
}

async function generateExperimentKnowledgeEmbeddings(
  googleApiKey: string | null | undefined,
  gatewayApiKey: string | null | undefined,
  title: string,
  chunks: ReturnType<typeof splitExperimentKnowledgeText>,
) {
  const values = chunks.map(chunk => `title: ${title} | text: ${chunk.content}`)
  const embeddings: number[][] = []

  for (let offset = 0; offset < values.length; offset += 40) {
    const batch = values.slice(offset, offset + 40)
    const response = await embedMany({
      model: mortgageBankFileEmbeddingProvider(googleApiKey, gatewayApiKey),
      values: batch,
      providerOptions: {
        google: { outputDimensionality: mortgageBankFileEmbeddingDimensions },
      },
    })
    if (
      response.embeddings.length !== batch.length
      || response.embeddings.some(embedding => embedding.length !== mortgageBankFileEmbeddingDimensions)
    ) {
      throw new Error('Model zwrócił embeddingi o nieprawidłowym wymiarze.')
    }
    embeddings.push(...response.embeddings)
  }

  return embeddings
}

export async function experimentKnowledgeQueryEmbedding(
  googleApiKey: string | null | undefined,
  gatewayApiKey: string | null | undefined,
  query: string,
  abortSignal?: AbortSignal,
) {
  const normalizedQuery = normalizeExperimentKnowledgeText(query)
  if (!normalizedQuery) return null
  const response = await embed({
    model: mortgageBankFileEmbeddingProvider(googleApiKey, gatewayApiKey),
    value: `task: search result | query: ${normalizedQuery}`,
    abortSignal,
    providerOptions: {
      google: { outputDimensionality: mortgageBankFileEmbeddingDimensions },
    },
  })
  if (response.embedding.length !== mortgageBankFileEmbeddingDimensions) {
    throw new Error('Model zwrócił embedding zapytania o nieprawidłowym wymiarze.')
  }
  return response.embedding
}

function institutionResponse(row: DatabaseRecord): ExperimentKnowledgeInstitution {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    logoUrl: row.logo_url === null ? null : String(row.logo_url),
    brandColor: row.brand_color === null ? null : String(row.brand_color),
    brandForegroundColor: row.brand_foreground_color === null
      ? null
      : String(row.brand_foreground_color),
  }
}

export async function listExperimentKnowledgeInstitutions(
  context: ExperimentKnowledgeContext,
) {
  const result = await context.backendData
    .from('mortgage_banks')
    .select('id, slug, name, logo_url, brand_color, brand_foreground_color')
    .eq('is_mock', false)
    .order('name')
  if (result.error) throw result.error
  return ((result.data ?? []) as DatabaseRecord[]).map(institutionResponse)
}

async function resolveExperimentKnowledgeInstitutions(
  context: ExperimentKnowledgeContext,
  institutionIds: string[],
) {
  if (!institutionIds.length) return []
  const result = await context.backendData
    .from('mortgage_banks')
    .select('id, slug, name, logo_url, brand_color, brand_foreground_color')
    .eq('is_mock', false)
    .in('id', institutionIds)
    .order('name')
  if (result.error) throw result.error
  const institutions = ((result.data ?? []) as DatabaseRecord[]).map(institutionResponse)
  if (institutions.length !== institutionIds.length) {
    throw createError({ statusCode: 400, statusMessage: 'Jedna z wybranych instytucji finansowych nie istnieje.' })
  }
  return institutions
}

export async function experimentKnowledgeInstitutionsByDocumentIds(
  context: ExperimentKnowledgeContext,
  documentIds: string[],
) {
  const mapped = new Map<string, ExperimentKnowledgeInstitution[]>()
  if (!documentIds.length) return mapped

  const linksResult = await context.backendData
    .from('experiment_knowledge_document_institutions')
    .select('document_id, financial_institution_id')
    .eq('organization_id', context.session.organizationId)
    .in('document_id', documentIds)
  if (linksResult.error) throw linksResult.error
  const links = (linksResult.data ?? []) as DatabaseRecord[]
  const institutionIds = [...new Set(links.map(row => String(row.financial_institution_id)))]
  const institutions = await resolveExperimentKnowledgeInstitutions(context, institutionIds)
  const institutionsById = new Map(institutions.map(institution => [institution.id, institution]))

  for (const link of links) {
    const documentId = String(link.document_id)
    const institution = institutionsById.get(String(link.financial_institution_id))
    if (!institution) continue
    const current = mapped.get(documentId) ?? []
    current.push(institution)
    mapped.set(documentId, current)
  }
  for (const documentInstitutions of mapped.values()) {
    documentInstitutions.sort((left, right) => left.name.localeCompare(right.name, 'pl'))
  }
  return mapped
}

async function replaceExperimentKnowledgeInstitutions(
  context: ExperimentKnowledgeContext,
  documentId: string,
  institutionIds: string[],
) {
  const deleteResult = await context.backendData
    .from('experiment_knowledge_document_institutions')
    .delete()
    .eq('organization_id', context.session.organizationId)
    .eq('document_id', documentId)
  if (deleteResult.error) throw deleteResult.error
  if (!institutionIds.length) return

  const insertResult = await context.backendData
    .from('experiment_knowledge_document_institutions')
    .insert(institutionIds.map(institutionId => ({
      organization_id: context.session.organizationId,
      document_id: documentId,
      financial_institution_id: institutionId,
      linked_by_user_id: context.session.userId,
    })))
  if (insertResult.error) throw insertResult.error
}

function documentResponse(
  row: DatabaseRecord,
  institutions: ExperimentKnowledgeInstitution[] = [],
) {
  return {
    id: String(row.id),
    kind: String(row.kind) as ExperimentKnowledgeKind,
    title: String(row.title),
    textContent: row.text_content === null ? null : String(row.text_content),
    htmlContent: row.html_content === null ? null : String(row.html_content),
    cssContent: row.css_content === null ? null : String(row.css_content),
    javascriptContent: row.javascript_content === null ? null : String(row.javascript_content),
    plainText: String(row.plain_text),
    revision: Number(row.revision),
    indexingStatus: String(row.indexing_status),
    indexingError: row.indexing_error === null ? null : String(row.indexing_error),
    embeddingModel: String(row.embedding_model),
    chunkCount: Number(row.chunk_count),
    ownerUserId: String(row.owner_user_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    institutions,
  }
}

const documentSelect = 'id, organization_id, owner_user_id, kind, title, text_content, html_content, css_content, javascript_content, plain_text, content_sha256, revision, indexing_status, indexing_error, embedding_model, chunk_count, created_at, updated_at, archived_at'

export async function writeExperimentKnowledgeDocument(
  context: ExperimentKnowledgeContext,
  input: ExperimentKnowledgeWriteInput,
  options: { documentId?: string, googleApiKey?: string | null, gatewayApiKey?: string | null } = {},
) {
  const { backendData, session } = context
  const documentId = options.documentId ? experimentKnowledgeUuid(options.documentId) : null
  const selectedInstitutions = input.institutionIds === undefined
    ? null
    : await resolveExperimentKnowledgeInstitutions(context, input.institutionIds)
  const plainText = experimentKnowledgePlainText(input)
  const chunks = splitExperimentKnowledgeText(plainText)
  const contentSha256 = knowledgeContentSha256(input)
  const indexedAt = new Date().toISOString()
  let embeddings: number[][] = []
  let indexingStatus: 'ready' | 'failed' = 'ready'
  let indexingError: string | null = null

  try {
    embeddings = await generateExperimentKnowledgeEmbeddings(
      options.googleApiKey,
      options.gatewayApiKey,
      input.title,
      chunks,
    )
  }
  catch (caught) {
    indexingStatus = 'failed'
    indexingError = caught instanceof Error
      ? caught.message.slice(0, 2_000)
      : 'Nie udało się utworzyć embeddingów.'
  }

  let documentRow: DatabaseRecord
  if (documentId) {
    if (!input.expectedRevision) {
      throw createError({ statusCode: 400, statusMessage: 'Brakuje wersji aktualizowanego dokumentu.' })
    }
    const currentResult = await backendData
      .from('experiment_knowledge_documents')
      .select('id, revision')
      .eq('organization_id', session.organizationId)
      .eq('id', documentId)
      .is('archived_at', null)
      .maybeSingle()
    if (currentResult.error) throw currentResult.error
    if (!currentResult.data) throw createError({ statusCode: 404, statusMessage: 'Dokument wiedzy nie istnieje.' })
    if (Number(currentResult.data.revision) !== input.expectedRevision) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Dokument został zmieniony w innym miejscu. Odśwież go i spróbuj ponownie.',
      })
    }

    const updateResult = await backendData
      .from('experiment_knowledge_documents')
      .update({
        kind: input.kind,
        title: input.title,
        text_content: input.textContent,
        html_content: input.htmlContent,
        css_content: input.cssContent,
        javascript_content: input.javascriptContent,
        plain_text: plainText,
        content_sha256: contentSha256,
        revision: input.expectedRevision + 1,
        indexing_status: 'processing',
        indexing_error: null,
        chunk_count: 0,
        updated_at: indexedAt,
      })
      .eq('organization_id', session.organizationId)
      .eq('id', documentId)
      .eq('revision', input.expectedRevision)
      .is('archived_at', null)
      .select(documentSelect)
      .maybeSingle()
    if (updateResult.error) throw updateResult.error
    if (!updateResult.data) {
      throw createError({ statusCode: 409, statusMessage: 'Dokument został równocześnie zmieniony.' })
    }
    documentRow = updateResult.data
  }
  else {
    const insertResult = await backendData
      .from('experiment_knowledge_documents')
      .insert({
        organization_id: session.organizationId,
        owner_user_id: session.userId,
        kind: input.kind,
        title: input.title,
        text_content: input.textContent,
        html_content: input.htmlContent,
        css_content: input.cssContent,
        javascript_content: input.javascriptContent,
        plain_text: plainText,
        content_sha256: contentSha256,
        indexing_status: 'processing',
        embedding_model: mortgageBankFileEmbeddingModel,
        chunk_count: 0,
        updated_at: indexedAt,
      })
      .select(documentSelect)
      .single()
    if (insertResult.error) throw insertResult.error
    documentRow = insertResult.data
  }

  const resolvedDocumentId = String(documentRow.id)
  if (selectedInstitutions !== null) {
    await replaceExperimentKnowledgeInstitutions(
      context,
      resolvedDocumentId,
      selectedInstitutions.map(institution => institution.id),
    )
  }
  if (documentId) {
    const deleteResult = await backendData
      .from('experiment_knowledge_chunks')
      .delete()
      .eq('organization_id', session.organizationId)
      .eq('document_id', resolvedDocumentId)
    if (deleteResult.error) throw deleteResult.error
  }

  const chunkRows = chunks.map((chunk, index) => ({
    organization_id: session.organizationId,
    document_id: resolvedDocumentId,
    chunk_index: chunk.chunkIndex,
    title: input.title,
    content: chunk.content,
    token_count: chunk.tokenCount,
    source_sha256: createHash('sha256')
      .update(`title: ${input.title} | text: ${chunk.content}`)
      .digest('hex'),
    embedding: embeddings[index] ?? null,
  }))
  const chunksResult = await backendData.from('experiment_knowledge_chunks').insert(chunkRows)
  if (chunksResult.error) {
    await backendData
      .from('experiment_knowledge_documents')
      .update({ indexing_status: 'failed', indexing_error: String(chunksResult.error.message ?? chunksResult.error).slice(0, 2_000) })
      .eq('organization_id', session.organizationId)
      .eq('id', resolvedDocumentId)
    throw chunksResult.error
  }

  const finalizeResult = await backendData
    .from('experiment_knowledge_documents')
    .update({
      indexing_status: indexingStatus,
      indexing_error: indexingError,
      chunk_count: chunks.length,
    })
    .eq('organization_id', session.organizationId)
    .eq('id', resolvedDocumentId)
    .select(documentSelect)
    .single()
  if (finalizeResult.error) throw finalizeResult.error

  const institutionsByDocument = await experimentKnowledgeInstitutionsByDocumentIds(context, [resolvedDocumentId])
  return documentResponse(finalizeResult.data, institutionsByDocument.get(resolvedDocumentId) ?? [])
}

export async function getExperimentKnowledgeDocument(
  context: ExperimentKnowledgeContext,
  documentId: string,
) {
  const result = await context.backendData
    .from('experiment_knowledge_documents')
    .select(documentSelect)
    .eq('organization_id', context.session.organizationId)
    .eq('id', experimentKnowledgeUuid(documentId))
    .is('archived_at', null)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw createError({ statusCode: 404, statusMessage: 'Dokument wiedzy nie istnieje.' })
  const resolvedDocumentId = String(result.data.id)
  const institutionsByDocument = await experimentKnowledgeInstitutionsByDocumentIds(context, [resolvedDocumentId])
  return documentResponse(result.data, institutionsByDocument.get(resolvedDocumentId) ?? [])
}
