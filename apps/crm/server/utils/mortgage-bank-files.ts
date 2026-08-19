import { createHash, randomUUID } from 'node:crypto'
import { createGateway, gateway } from '@ai-sdk/gateway'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { embed, embedMany } from 'ai'
import { createError, type H3Event } from 'h3'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  requireCrmSession,
  requireSuperAdmin,
  type CrmSession,
} from './crm'

export const mortgageBankFileBucket = 'mortgage-bank-files'
export const mortgageBankFileEmbeddingModel = 'gemini-embedding-2'
export const mortgageBankFileGatewayEmbeddingModel = `google/${mortgageBankFileEmbeddingModel}` as const
export const mortgageBankFileEmbeddingDimensions = 768
export const mortgageBankFileMaximumBytes = 50 * 1024 * 1024

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const supportedMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
])

type BackendDataClient = any
type DatabaseRecord = Record<string, any>

export interface MortgageBankFileChunkInput {
  chunkIndex: number
  pageStart: number | null
  pageEnd: number | null
  locator: string | null
  content: string
  tokenCount: number
}

export interface MortgageBankFileIngestInput {
  bankId: string
  title: string
  categoryId?: string | null
  categoryKey?: string | null
  productId?: string | null
  sourcePageUrl?: string | null
  sourceDownloadUrl?: string | null
  resolvedDownloadUrl?: string | null
  sourceEtag?: string | null
  sourceLastModified?: string | null
  effectiveFrom?: string | null
  effectiveTo?: string | null
  publishedAt?: string | null
  originalFileName: string
  mimeType: string
  bytes: Uint8Array
  actorUserId?: string | null
  googleApiKey?: string | null
}

export interface MortgageBankFileAdminContext {
  session: CrmSession
  backendData: BackendDataClient
}

export function mortgageBankFileUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw createError({ statusCode: 400, statusMessage: `${field} must be a UUID` })
  }
  return value.toLowerCase()
}

export function mortgageBankFileOptionalUuid(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null
  return mortgageBankFileUuid(value, field)
}

export function mortgageBankFileMimeGroup(mimeType: string) {
  if (mimeType === 'application/pdf') return 'pdf' as const
  if (
    mimeType === 'application/vnd.ms-excel'
    || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) return 'spreadsheet' as const
  if (
    mimeType === 'application/msword'
    || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) return 'document' as const
  if (mimeType.startsWith('image/')) return 'image' as const
  return 'other' as const
}

export function mortgageBankFileSha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function mortgageBankFileSafeName(value: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 180)

  return normalized || 'document'
}

export function mortgageBankFileTitleFromName(value: string) {
  const withoutExtension = value.replace(/\.[^.]+$/u, '')
  const normalized = withoutExtension.replace(/[-_]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  return normalized ? normalized.charAt(0).toLocaleUpperCase('pl-PL') + normalized.slice(1) : 'Dokument bankowy'
}

export async function requireMortgageBankFileAdmin(event: H3Event): Promise<MortgageBankFileAdminContext> {
  const session = await requireCrmSession(event)
  await requireSuperAdmin(session)
  return {
    session,
    backendData: serverDataBackend(event) as BackendDataClient,
  }
}

function ensurePdfJsGlobals() {
  const globals = globalThis as unknown as Record<string, unknown>
  globals.DOMMatrix ||= class DOMMatrix { constructor(..._args: unknown[]) {} }
  globals.Path2D ||= class Path2D { constructor(..._args: unknown[]) {} }
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\u0000/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\s*\n\s*/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function splitPageText(text: string, pageNumber: number, firstChunkIndex: number) {
  const maximumCharacters = 5_500
  const minimumBreak = 2_600
  const chunks: MortgageBankFileChunkInput[] = []
  let offset = 0
  let chunkIndex = firstChunkIndex

  while (offset < text.length) {
    let end = Math.min(text.length, offset + maximumCharacters)
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end)
      const sentenceBreak = text.lastIndexOf('. ', end)
      const preferredBreak = Math.max(paragraphBreak, sentenceBreak)
      if (preferredBreak > offset + minimumBreak) end = preferredBreak + 1
    }

    const content = text.slice(offset, end).trim()
    if (content) {
      chunks.push({
        chunkIndex,
        pageStart: pageNumber,
        pageEnd: pageNumber,
        locator: `s. ${pageNumber}`,
        content,
        tokenCount: Math.max(1, Math.ceil(content.length / 4)),
      })
      chunkIndex += 1
    }
    offset = Math.max(end, offset + 1)
  }

  return chunks
}

export async function extractMortgageBankPdf(bytes: Uint8Array): Promise<{
  pageCount: number
  text: string
  chunks: MortgageBankFileChunkInput[]
}> {
  ensurePdfJsGlobals()
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
  })

  try {
    const document = await loadingTask.promise
    const chunks: MortgageBankFileChunkInput[] = []
    const pages: string[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const lines: string[] = []
      let currentLine = ''

      for (const item of content.items) {
        if (!('str' in item)) continue
        const text = String(item.str ?? '').trim()
        if (text) currentLine = currentLine ? `${currentLine} ${text}` : text
        if ('hasEOL' in item && item.hasEOL && currentLine) {
          lines.push(currentLine)
          currentLine = ''
        }
      }
      if (currentLine) lines.push(currentLine)

      const pageText = normalizeExtractedText(lines.join('\n'))
      pages.push(pageText)
      chunks.push(...splitPageText(pageText, pageNumber, chunks.length))
      page.cleanup()
    }

    return {
      pageCount: document.numPages,
      text: pages.filter(Boolean).join('\n\n').slice(0, 250_000),
      chunks,
    }
  } finally {
    await loadingTask.destroy()
  }
}

export function mortgageBankFileEmbeddingProvider(
  googleApiKey: string | null | undefined,
  gatewayApiKey?: string | null,
) {
  const normalizedGoogleApiKey = googleApiKey?.trim()
  if (normalizedGoogleApiKey) {
    return createGoogleGenerativeAI({ apiKey: normalizedGoogleApiKey }).embedding(mortgageBankFileEmbeddingModel)
  }
  const normalizedGatewayApiKey = gatewayApiKey?.trim()
  return normalizedGatewayApiKey
    ? createGateway({ apiKey: normalizedGatewayApiKey }).embedding(mortgageBankFileGatewayEmbeddingModel)
    : gateway.embedding(mortgageBankFileGatewayEmbeddingModel)
}

async function generateMortgageBankFileEmbeddings(
  apiKey: string | null | undefined,
  title: string,
  chunks: MortgageBankFileChunkInput[],
) {
  if (!chunks.length) return []
  const model = mortgageBankFileEmbeddingProvider(apiKey)
  const values = chunks.map(chunk => `title: ${title} | text: ${chunk.content}`)
  const result: number[][] = []

  for (let offset = 0; offset < values.length; offset += 40) {
    const batch = values.slice(offset, offset + 40)
    const response = await embedMany({
      model,
      values: batch,
      providerOptions: {
        google: {
          outputDimensionality: mortgageBankFileEmbeddingDimensions,
        },
      },
    })
    if (response.embeddings.length !== batch.length) {
      throw new Error('Gemini returned an unexpected number of bank file embeddings')
    }
    if (response.embeddings.some(value => value.length !== mortgageBankFileEmbeddingDimensions)) {
      throw new Error('Gemini returned an unexpected bank file embedding dimensionality')
    }
    result.push(...response.embeddings)
  }

  return result
}

export async function mortgageBankFileQueryEmbedding(
  apiKey: string | null | undefined,
  query: string,
  abortSignal?: AbortSignal,
): Promise<number[] | null> {
  const normalizedApiKey = apiKey?.trim()
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return null

  const response = await embed({
    model: mortgageBankFileEmbeddingProvider(normalizedApiKey),
    value: `task: search result | query: ${normalizedQuery}`,
    abortSignal,
    providerOptions: {
      google: {
        outputDimensionality: mortgageBankFileEmbeddingDimensions,
      },
    },
  })
  if (response.embedding.length !== mortgageBankFileEmbeddingDimensions) {
    throw new Error('Gemini returned an unexpected bank file query embedding dimensionality')
  }
  return response.embedding
}

function assertIngestInput(input: MortgageBankFileIngestInput) {
  mortgageBankFileUuid(input.bankId, 'bankId')
  if (input.productId) mortgageBankFileUuid(input.productId, 'productId')
  if (input.categoryId) mortgageBankFileUuid(input.categoryId, 'categoryId')
  if (!input.title.trim() || input.title.trim().length > 500) {
    throw createError({ statusCode: 400, statusMessage: 'title is invalid' })
  }
  if (!supportedMimeTypes.has(input.mimeType)) {
    throw createError({ statusCode: 415, statusMessage: 'Unsupported bank file type' })
  }
  if (!input.bytes.byteLength || input.bytes.byteLength > mortgageBankFileMaximumBytes) {
    throw createError({ statusCode: 413, statusMessage: 'Bank file size is invalid' })
  }
}

async function resolveCategoryId(backendData: BackendDataClient, input: MortgageBankFileIngestInput) {
  if (input.categoryId) return input.categoryId
  const categoryKey = input.categoryKey?.trim() || 'other'
  const result = await backendData
    .from('mortgage_bank_file_categories')
    .select('id')
    .eq('category_key', categoryKey)
    .maybeSingle()
  if (result.error) throw result.error
  if (!result.data) {
    throw createError({ statusCode: 400, statusMessage: 'Bank file category not found' })
  }
  return String(result.data.id)
}

export async function ingestMortgageBankFile(
  backendData: BackendDataClient,
  input: MortgageBankFileIngestInput,
) {
  assertIngestInput(input)
  const title = input.title.trim()
  const checksum = mortgageBankFileSha256(input.bytes)
  const categoryId = await resolveCategoryId(backendData, input)
  const bankResult = await backendData
    .from('mortgage_banks')
    .select('id')
    .eq('id', input.bankId)
    .eq('is_mock', false)
    .maybeSingle()
  if (bankResult.error) throw bankResult.error
  if (!bankResult.data) throw createError({ statusCode: 404, statusMessage: 'Financial institution not found' })

  if (input.productId) {
    const productResult = await backendData
      .from('mortgage_products')
      .select('id')
      .eq('id', input.productId)
      .eq('bank_id', input.bankId)
      .maybeSingle()
    if (productResult.error) throw productResult.error
    if (!productResult.data) {
      throw createError({ statusCode: 400, statusMessage: 'Product does not belong to this institution' })
    }
  }

  let fileResult = await backendData
    .from('mortgage_bank_files')
    .select('id, current_version_id')
    .eq('bank_id', input.bankId)
    .ilike('title', title)
    .is('archived_at', null)
    .maybeSingle()
  if (fileResult.error) throw fileResult.error

  let createdLogicalFile = false
  if (!fileResult.data) {
    fileResult = await backendData
      .from('mortgage_bank_files')
      .insert({
        bank_id: input.bankId,
        category_id: categoryId,
        title,
        source_page_url: input.sourcePageUrl ?? null,
        created_by_user_id: input.actorUserId ?? null,
        updated_by_user_id: input.actorUserId ?? null,
      })
      .select('id, current_version_id')
      .single()
    if (fileResult.error) throw fileResult.error
    createdLogicalFile = true
  } else {
    const updateFileResult = await backendData
      .from('mortgage_bank_files')
      .update({
        category_id: categoryId,
        source_page_url: input.sourcePageUrl ?? null,
        updated_by_user_id: input.actorUserId ?? null,
      })
      .eq('id', fileResult.data.id)
    if (updateFileResult.error) throw updateFileResult.error
  }

  const fileId = String(fileResult.data.id)
  const duplicateResult = await backendData
    .from('mortgage_bank_file_versions')
    .select('id, version_number, version_label, status')
    .eq('file_id', fileId)
    .eq('checksum_sha256', checksum)
    .maybeSingle()
  if (duplicateResult.error) {
    if (createdLogicalFile) await backendData.from('mortgage_bank_files').delete().eq('id', fileId)
    throw duplicateResult.error
  }
  if (duplicateResult.data) {
    return { fileId, version: duplicateResult.data, duplicate: true }
  }

  const latestResult = await backendData
    .from('mortgage_bank_file_versions')
    .select('version_number')
    .eq('file_id', fileId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestResult.error) {
    if (createdLogicalFile) await backendData.from('mortgage_bank_files').delete().eq('id', fileId)
    throw latestResult.error
  }

  const versionNumber = Number(latestResult.data?.version_number ?? 0) + 1
  const versionId = randomUUID()
  const originalFileName = mortgageBankFileSafeName(input.originalFileName)
  const storagePath = `${input.bankId}/${fileId}/${versionId}/${originalFileName}`
  const previousVersionId = fileResult.data.current_version_id
    ? String(fileResult.data.current_version_id)
    : null
  let uploaded = false

  try {
    const uploadResult = await backendData.storage
      .from(mortgageBankFileBucket)
      .upload(storagePath, input.bytes, {
        contentType: input.mimeType,
        upsert: false,
      })
    if (uploadResult.error) throw uploadResult.error
    uploaded = true

    const insertVersionResult = await backendData
      .from('mortgage_bank_file_versions')
      .insert({
        id: versionId,
        file_id: fileId,
        version_number: versionNumber,
        version_label: `${versionNumber}.0`,
        storage_path: storagePath,
        original_file_name: originalFileName,
        mime_type: input.mimeType,
        mime_group: mortgageBankFileMimeGroup(input.mimeType),
        size_bytes: input.bytes.byteLength,
        checksum_sha256: checksum,
        source_download_url: input.sourceDownloadUrl ?? null,
        resolved_download_url: input.resolvedDownloadUrl ?? null,
        source_etag: input.sourceEtag ?? null,
        source_last_modified: input.sourceLastModified ?? null,
        effective_from: input.effectiveFrom ?? null,
        effective_to: input.effectiveTo ?? null,
        published_at: input.publishedAt ?? null,
        status: 'processing',
        extraction_status: input.mimeType === 'application/pdf' ? 'processing' : 'unsupported',
        embedding_status: input.mimeType === 'application/pdf' ? 'pending' : 'disabled',
        created_by_user_id: input.actorUserId ?? null,
      })
    if (insertVersionResult.error) throw insertVersionResult.error

    const jobsResult = await backendData
      .from('mortgage_bank_file_processing_jobs')
      .insert([
        {
          version_id: versionId,
          job_type: 'extract',
          status: input.mimeType === 'application/pdf' ? 'processing' : 'completed',
        },
        {
          version_id: versionId,
          job_type: 'embed',
          status: input.mimeType === 'application/pdf' ? 'pending' : 'cancelled',
        },
      ])
    if (jobsResult.error) throw jobsResult.error

    let pageCount: number | null = null
    let extractedText: string | null = null
    let chunks: MortgageBankFileChunkInput[] = []
    let embeddingStatus: 'disabled' | 'pending' | 'completed' | 'failed' = 'disabled'
    if (input.mimeType === 'application/pdf') {
      const extracted = await extractMortgageBankPdf(input.bytes)
      pageCount = extracted.pageCount
      extractedText = extracted.text
      chunks = extracted.chunks
      embeddingStatus = chunks.length ? 'pending' : 'disabled'

      if (chunks.length) {
        const chunksResult = await backendData
          .from('mortgage_bank_file_chunks')
          .insert(chunks.map(chunk => ({
            version_id: versionId,
            chunk_index: chunk.chunkIndex,
            page_start: chunk.pageStart,
            page_end: chunk.pageEnd,
            locator: chunk.locator,
            content: chunk.content,
            token_count: chunk.tokenCount,
          })))
          .select('id, chunk_index, content')
        if (chunksResult.error) throw chunksResult.error

        const googleApiKey = input.googleApiKey?.trim()
        try {
          const embeddings = await generateMortgageBankFileEmbeddings(googleApiKey, title, chunks)
          const chunkRows = (chunksResult.data ?? []) as DatabaseRecord[]
          const sourceChunkByIndex = new Map(chunks.map(chunk => [chunk.chunkIndex, chunk]))
          const embeddingRows = chunkRows.flatMap((chunkRow) => {
            const chunkIndex = Number(chunkRow.chunk_index)
            const embedding = embeddings[chunkIndex]
            const sourceChunk = sourceChunkByIndex.get(chunkIndex)
            if (!embedding || !sourceChunk) return []
            return [{
              chunk_id: chunkRow.id,
              embedding_kind: 'content',
              model: mortgageBankFileEmbeddingModel,
              dimensions: mortgageBankFileEmbeddingDimensions,
              recipe_version: 'search-result-v1',
              source_sha256: createHash('sha256')
                .update(`title: ${title} | text: ${sourceChunk.content}`)
                .digest('hex'),
              embedding,
            }]
          })
          if (embeddingRows.length) {
            const embeddingsResult = await backendData
              .from('mortgage_bank_file_embeddings')
              .insert(embeddingRows)
            if (embeddingsResult.error) throw embeddingsResult.error
          }
          await backendData
            .from('mortgage_bank_file_processing_jobs')
            .update({ status: 'completed', finished_at: new Date().toISOString() })
            .eq('version_id', versionId)
            .eq('job_type', 'embed')
          embeddingStatus = 'completed'
        } catch (embeddingError) {
          await backendData
            .from('mortgage_bank_file_processing_jobs')
            .update({
              status: 'failed',
              attempts: 1,
              finished_at: new Date().toISOString(),
              last_error: embeddingError instanceof Error ? embeddingError.message.slice(0, 10_000) : 'Embedding failed',
            })
            .eq('version_id', versionId)
            .eq('job_type', 'embed')
          embeddingStatus = 'failed'
        }
      }
    }

    if (previousVersionId) {
      const archiveResult = await backendData
        .from('mortgage_bank_file_versions')
        .update({ status: 'archived' })
        .eq('id', previousVersionId)
      if (archiveResult.error) throw archiveResult.error
    }

    const finalizeVersionResult = await backendData
      .from('mortgage_bank_file_versions')
      .update({
        status: 'current',
        extraction_status: input.mimeType === 'application/pdf' ? 'completed' : 'unsupported',
        embedding_status: embeddingStatus,
        page_count: pageCount,
        extracted_text: extractedText,
        embedding_model: chunks.length ? mortgageBankFileEmbeddingModel : null,
        embedding_dimensions: chunks.length ? mortgageBankFileEmbeddingDimensions : null,
        extraction_metadata: {
          chunkCount: chunks.length,
          extraction: input.mimeType === 'application/pdf' ? 'pdfjs-dist' : 'unsupported',
        },
      })
      .eq('id', versionId)
    if (finalizeVersionResult.error) throw finalizeVersionResult.error

    const finalizeJobResult = await backendData
      .from('mortgage_bank_file_processing_jobs')
      .update({ status: 'completed', finished_at: new Date().toISOString() })
      .eq('version_id', versionId)
      .eq('job_type', 'extract')
    if (finalizeJobResult.error) throw finalizeJobResult.error

    const updateCurrentResult = await backendData
      .from('mortgage_bank_files')
      .update({
        current_version_id: versionId,
        category_id: categoryId,
        updated_by_user_id: input.actorUserId ?? null,
      })
      .eq('id', fileId)
    if (updateCurrentResult.error) throw updateCurrentResult.error

    if (input.productId) {
      const linkResult = await backendData
        .from('mortgage_bank_file_products')
        .upsert({
          file_id: fileId,
          product_id: input.productId,
          created_by_user_id: input.actorUserId ?? null,
        }, { onConflict: 'file_id,product_id' })
      if (linkResult.error) throw linkResult.error
    }

    const eventResult = await backendData
      .from('mortgage_bank_file_events')
      .insert({
        file_id: fileId,
        version_id: versionId,
        actor_user_id: input.actorUserId ?? null,
        action: versionNumber === 1 ? 'file.created' : 'version.created',
        metadata: {
          versionNumber,
          mimeType: input.mimeType,
          sizeBytes: input.bytes.byteLength,
          checksumSha256: checksum,
          source: input.sourceDownloadUrl ? 'official_url' : 'manual_upload',
        },
      })
    if (eventResult.error) throw eventResult.error

    return {
      fileId,
      version: {
        id: versionId,
        version_number: versionNumber,
        version_label: `${versionNumber}.0`,
        status: 'current',
        page_count: pageCount,
        chunk_count: chunks.length,
      },
      duplicate: false,
    }
  } catch (error) {
    if (uploaded) {
      await backendData.storage.from(mortgageBankFileBucket).remove([storagePath])
    }
    await backendData.from('mortgage_bank_file_versions').delete().eq('id', versionId)
    if (createdLogicalFile) {
      await backendData.from('mortgage_bank_files').delete().eq('id', fileId)
    }
    throw error
  }
}

export async function createMortgageBankFileAccessUrl(
  backendData: BackendDataClient,
  input: {
    fileId: string
    versionId?: string | null
    actorUserId: string
    organizationId: string
    action: 'file.previewed' | 'file.downloaded'
  },
) {
  const fileId = mortgageBankFileUuid(input.fileId, 'fileId')
  const requestedVersionId = mortgageBankFileOptionalUuid(input.versionId, 'versionId')
  const fileResult = await backendData
    .from('mortgage_bank_files')
    .select('id, current_version_id')
    .eq('id', fileId)
    .is('archived_at', null)
    .maybeSingle()
  if (fileResult.error) throw fileResult.error
  if (!fileResult.data) throw createError({ statusCode: 404, statusMessage: 'Bank file not found' })

  const versionId = requestedVersionId ?? String(fileResult.data.current_version_id ?? '')
  if (!versionId) throw createError({ statusCode: 409, statusMessage: 'Bank file has no available version' })
  const versionResult = await backendData
    .from('mortgage_bank_file_versions')
    .select('id, file_id, storage_path, original_file_name')
    .eq('id', versionId)
    .eq('file_id', fileId)
    .maybeSingle()
  if (versionResult.error) throw versionResult.error
  if (!versionResult.data) throw createError({ statusCode: 404, statusMessage: 'Bank file version not found' })

  const signedResult = await backendData.storage
    .from(mortgageBankFileBucket)
    .createSignedUrl(String(versionResult.data.storage_path), 60)
  if (signedResult.error) throw signedResult.error

  const auditResult = await backendData
    .from('mortgage_bank_file_events')
    .insert({
      file_id: fileId,
      version_id: versionId,
      actor_user_id: input.actorUserId,
      action: input.action,
      metadata: {
        organizationId: input.organizationId,
        originalFileName: String(versionResult.data.original_file_name),
      },
    })
  if (auditResult.error) throw auditResult.error

  return signedResult.data.signedUrl
}
