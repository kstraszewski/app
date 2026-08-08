import { useRuntimeConfig } from '#imports'
import { getQuery } from 'h3'
import {
  mortgageBankFileEmbeddingDimensions,
  mortgageBankFileEmbeddingModel,
  mortgageBankFileOptionalUuid,
  mortgageBankFileQueryEmbedding,
  requireMortgageBankFileAdmin,
} from '~~/server/utils/mortgage-bank-files'
import {
  cleanMortgageBankFileSearchSnippet,
  mortgageBankFileSearchMatch,
} from '~~/server/utils/mortgage-bank-file-search'

type DatabaseRecord = Record<string, any>

const mimeGroups = new Set(['pdf', 'spreadsheet', 'document', 'image', 'other'])
const statuses = new Set(['current', 'draft', 'expired', 'archived', 'processing', 'failed'])

function firstQueryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

function optionalQueryText(value: unknown, maximum = 500) {
  const input = firstQueryValue(value)
  if (typeof input !== 'string') return null
  const normalized = input.trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function integer(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

function fileMatchFallback(version: DatabaseRecord, description: string | null) {
  const value = String(
    version.generated_description
      ?? description
      ?? version.extracted_text
      ?? '',
  ).replace(/\s+/gu, ' ').trim()
  return value ? value.slice(0, 260) : ''
}

export default defineEventHandler(async (event) => {
  const { session, backendData } = await requireMortgageBankFileAdmin(event)
  const query = getQuery(event)
  const bankId = mortgageBankFileOptionalUuid(firstQueryValue(query.bankId), 'bankId')
  const productId = mortgageBankFileOptionalUuid(firstQueryValue(query.productId), 'productId')
  const searchText = optionalQueryText(query.q)
  const requestedCategory = optionalQueryText(query.category, 80)
  const requestedMimeGroup = optionalQueryText(query.mimeGroup, 40)
  const requestedStatus = optionalQueryText(query.status, 40)
  const mimeGroup = requestedMimeGroup && mimeGroups.has(requestedMimeGroup)
    ? requestedMimeGroup
    : null
  const statusFilter = requestedStatus && statuses.has(requestedStatus)
    ? requestedStatus
    : null

  const [
    categoriesResult,
    institutionsResult,
    productsResult,
  ] = await Promise.all([
    backendData
      .from('mortgage_bank_file_categories')
      .select('id, category_key, label, icon, sort_order, is_archived')
      .order('sort_order'),
    backendData
      .from('mortgage_banks')
      .select('id, name, logo_url')
      .order('name'),
    (() => {
      let request = backendData
        .from('mortgage_products')
        .select('id, bank_id, name')
        .eq('is_active', true)
        .order('name')
      if (bankId) request = request.eq('bank_id', bankId)
      return request
    })(),
  ])
  if (categoriesResult.error) throw categoriesResult.error
  if (institutionsResult.error) throw institutionsResult.error
  if (productsResult.error) throw productsResult.error

  const categories = (categoriesResult.data ?? []) as DatabaseRecord[]
  const category = requestedCategory
    ? categories.find(item => String(item.id) === requestedCategory || item.category_key === requestedCategory)
    : null

  let fileRequest = backendData
    .from('mortgage_bank_files')
    .select('id, bank_id, category_id, title, description, source_page_url, current_version_id, created_by_user_id, created_at, updated_at')
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
  if (bankId) fileRequest = fileRequest.eq('bank_id', bankId)
  if (category) fileRequest = fileRequest.eq('category_id', category.id)

  const filesResult = await fileRequest
  if (filesResult.error) throw filesResult.error
  let files = (filesResult.data ?? []) as DatabaseRecord[]

  const fileIds = files.map(file => String(file.id))
  const versionIds = files.flatMap(file => file.current_version_id ? [String(file.current_version_id)] : [])
  const [
    versionsResult,
    linksResult,
    templatesResult,
  ] = await Promise.all([
    versionIds.length
      ? backendData
          .from('mortgage_bank_file_versions')
          .select('id, file_id, version_number, version_label, original_file_name, storage_path, mime_type, mime_group, size_bytes, checksum_sha256, source_download_url, resolved_download_url, effective_from, effective_to, published_at, status, extraction_status, embedding_status, page_count, extracted_text, generated_description, retrieved_at, created_by_user_id, created_at')
          .in('id', versionIds)
      : Promise.resolve({ data: [], error: null }),
    fileIds.length
      ? backendData
          .from('mortgage_bank_file_products')
          .select('file_id, product_id')
          .in('file_id', fileIds)
      : Promise.resolve({ data: [], error: null }),
    fileIds.length
      ? backendData
          .from('mortgage_document_templates')
          .select('id, source_file_id, source_file_version_id, template_key, label, draft_revision, active_revision, updated_at')
          .in('source_file_id', fileIds)
          .order('updated_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (versionsResult.error) throw versionsResult.error
  if (linksResult.error) throw linksResult.error
  if (templatesResult.error) throw templatesResult.error

  const versions = (versionsResult.data ?? []) as DatabaseRecord[]
  const versionById = new Map(versions.map(version => [String(version.id), version]))
  const links = (linksResult.data ?? []) as DatabaseRecord[]
  const linkedProductIds = [...new Set(links.map(link => String(link.product_id)))]
  const linkedProductsResult = linkedProductIds.length
    ? await backendData
        .from('mortgage_products')
        .select('id, bank_id, name')
        .in('id', linkedProductIds)
    : { data: [], error: null }
  if (linkedProductsResult.error) throw linkedProductsResult.error

  const products = [
    ...((productsResult.data ?? []) as DatabaseRecord[]),
    ...((linkedProductsResult.data ?? []) as DatabaseRecord[]),
  ]
  const productById = new Map(products.map(product => [String(product.id), product]))
  const productsByFile = new Map<string, DatabaseRecord[]>()
  for (const link of links) {
    const linkedProduct = productById.get(String(link.product_id))
    if (!linkedProduct) continue
    const fileId = String(link.file_id)
    productsByFile.set(fileId, [...(productsByFile.get(fileId) ?? []), linkedProduct])
  }
  const templatesByFile = new Map<string, DatabaseRecord[]>()
  for (const template of (templatesResult.data ?? []) as DatabaseRecord[]) {
    const sourceFileId = String(template.source_file_id)
    templatesByFile.set(sourceFileId, [
      ...(templatesByFile.get(sourceFileId) ?? []),
      template,
    ])
  }

  files = files.filter((file) => {
    const version = versionById.get(String(file.current_version_id ?? ''))
    if (!version) return false
    if (mimeGroup && version.mime_group !== mimeGroup) return false
    if (statusFilter && version.status !== statusFilter) return false
    if (productId && !(productsByFile.get(String(file.id)) ?? []).some(product => product.id === productId)) return false
    return true
  })

  const runtimeConfig = useRuntimeConfig(event)
  const googleApiKey = String(runtimeConfig.googleGenerativeAiApiKey || '').trim()
  const gatewayAvailable = Boolean(
    runtimeConfig.aiGatewayApiKey
    || process.env.AI_GATEWAY_API_KEY
    || process.env.VERCEL_OIDC_TOKEN,
  )
  const embeddingAvailable = Boolean(googleApiKey || gatewayAvailable)
  let usedQueryEmbedding = false
  const matchByFile = new Map<string, DatabaseRecord[]>()
  if (searchText) {
    let queryEmbedding: number[] | null = null
    try {
      queryEmbedding = await mortgageBankFileQueryEmbedding(
        googleApiKey,
        searchText,
        AbortSignal.timeout(1_500),
      )
    } catch {
      queryEmbedding = null
    }
    usedQueryEmbedding = Boolean(queryEmbedding)

    const searchResult = await backendData.rpc('search_mortgage_bank_file_chunks', {
      query_text: searchText,
      query_embedding: queryEmbedding,
      filter_bank_id: bankId,
      filter_category_key: category?.category_key ?? null,
      filter_mime_group: mimeGroup,
      filter_product_id: productId,
      filter_status: statusFilter,
      match_count: 100,
      full_text_weight: 1.35,
      semantic_weight: 1,
      rrf_k: 50,
    })
    if (searchResult.error) throw searchResult.error

    for (const match of (searchResult.data ?? []) as DatabaseRecord[]) {
      const fileId = String(match.file_id)
      matchByFile.set(fileId, [...(matchByFile.get(fileId) ?? []), match].slice(0, 3))
    }

    files = files.filter((file) => {
      if (matchByFile.has(String(file.id))) return true
      const version = versionById.get(String(file.current_version_id ?? ''))
      return mortgageBankFileSearchMatch(searchText, [
        file.title,
        file.description,
        version?.original_file_name,
        version?.generated_description,
      ])
    })
  }

  const institutionById = new Map(
    ((institutionsResult.data ?? []) as DatabaseRecord[])
      .map(institution => [String(institution.id), institution]),
  )
  const actorIds = [...new Set(files.flatMap((file) => {
    const version = versionById.get(String(file.current_version_id ?? ''))
    return [file.created_by_user_id, version?.created_by_user_id]
      .filter(Boolean)
      .map(String)
  }))]
  const actorsResult = actorIds.length
    ? await backendData.from('users').select('id, full_name, email').in('id', actorIds)
    : { data: [], error: null }
  if (actorsResult.error) throw actorsResult.error
  const actorById = new Map(
    ((actorsResult.data ?? []) as DatabaseRecord[])
      .map(actor => [String(actor.id), actor]),
  )

  const mappedFiles = files.map((file) => {
    const fileId = String(file.id)
    const version = versionById.get(String(file.current_version_id ?? ''))!
    const institution = institutionById.get(String(file.bank_id))
    const accessBase = `/api/org/${encodeURIComponent(session.organizationSlug)}/mortgages/files/${encodeURIComponent(fileId)}`
    const versionQuery = `versionId=${encodeURIComponent(String(version.id))}`

    const actor = actorById.get(String(version.created_by_user_id ?? file.created_by_user_id ?? ''))
    const fileTemplates = templatesByFile.get(fileId) ?? []
    const relatedTemplate = fileTemplates.find(template => (
      String(template.source_file_version_id) === String(version.id)
    )) ?? fileTemplates[0]
    const rankedMatches = matchByFile.get(fileId) ?? []
    const titleMatchesSearch = searchText
      ? mortgageBankFileSearchMatch(searchText, [file.title, version.original_file_name])
      : false
    const matches = rankedMatches.length
      ? rankedMatches.map(match => ({
          snippet: cleanMortgageBankFileSearchSnippet(match.snippet),
          location: match.locator ? String(match.locator) : null,
          page: integer(match.page_number),
          score: Number(match.score ?? 0),
        }))
      : [{
          snippet: fileMatchFallback(version, file.description ? String(file.description) : null),
          location: version.page_count ? 's. 1' : null,
          page: version.page_count ? 1 : null,
          score: null,
        }].filter(match => match.snippet)

    return {
      id: fileId,
      title: String(file.title),
      fileName: String(version.original_file_name),
      categoryId: file.category_id ? String(file.category_id) : null,
      institution: {
        id: String(file.bank_id),
        name: String(institution?.name ?? 'Instytucja'),
        logoUrl: institution?.logo_url ? String(institution.logo_url) : null,
      },
      products: (productsByFile.get(fileId) ?? []).map(product => ({
        id: String(product.id),
        name: String(product.name),
      })),
      template: relatedTemplate
        ? {
            id: String(relatedTemplate.id),
            key: String(relatedTemplate.template_key),
            label: String(relatedTemplate.label),
            status: Number(relatedTemplate.active_revision ?? 0) > 0
              ? Number(relatedTemplate.draft_revision ?? 0) > 0
                ? 'published_with_draft' as const
                : 'published' as const
              : 'draft' as const,
            draftRevision: Number(relatedTemplate.draft_revision ?? 0),
            activeRevision: Number(relatedTemplate.active_revision ?? 0),
            sourceVersionId: String(relatedTemplate.source_file_version_id),
            usesCurrentVersion: String(relatedTemplate.source_file_version_id) === String(version.id),
          }
        : null,
      currentVersion: {
        id: String(version.id),
        version: String(version.version_label),
        status: String(version.status),
        mimeType: String(version.mime_type),
        mimeGroup: String(version.mime_group),
        sizeBytes: integer(version.size_bytes),
        checksumSha256: version.checksum_sha256 ? String(version.checksum_sha256) : null,
        pageCount: integer(version.page_count),
        publishedAt: version.published_at ? String(version.published_at) : null,
        effectiveFrom: version.effective_from ? String(version.effective_from) : null,
        effectiveTo: version.effective_to ? String(version.effective_to) : null,
        sourceUrl: file.source_page_url ? String(file.source_page_url) : null,
        previewUrl: `${accessBase}/preview?${versionQuery}`,
        downloadUrl: `${accessBase}/download?${versionQuery}`,
        extractedText: version.extracted_text ? String(version.extracted_text).slice(0, 100_000) : null,
      },
      matches,
      addedBy: actor ? String(actor.full_name || actor.email || '') : null,
      createdAt: file.created_at ? String(file.created_at) : null,
      updatedAt: file.updated_at ? String(file.updated_at) : null,
      score: Number(titleMatchesSearch) + Number(matches[0]?.score ?? 0),
    }
  })

  mappedFiles.sort((left, right) => (
    Number(right.score ?? 0) - Number(left.score ?? 0)
    || String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))
  ))

  const categoryCounts = new Map<string, number>()
  for (const file of mappedFiles) {
    if (file.categoryId) {
      categoryCounts.set(file.categoryId, (categoryCounts.get(file.categoryId) ?? 0) + 1)
    }
  }
  const statusCounts: Record<string, number> = {}
  const mimeCounts: Record<string, number> = {}
  for (const file of mappedFiles) {
    const fileStatus = file.currentVersion.status
    const fileMimeGroup = file.currentVersion.mimeGroup
    statusCounts[fileStatus] = (statusCounts[fileStatus] ?? 0) + 1
    mimeCounts[fileMimeGroup] = (mimeCounts[fileMimeGroup] ?? 0) + 1
  }

  return {
    files: mappedFiles.map(({ score: _score, ...file }) => file),
    total: mappedFiles.length,
    categories: categories.map(categoryRow => ({
      id: String(categoryRow.id),
      label: String(categoryRow.label),
      count: categoryCounts.get(String(categoryRow.id)) ?? 0,
      icon: categoryRow.icon ? String(categoryRow.icon) : undefined,
      archived: Boolean(categoryRow.is_archived),
    })),
    institutions: ((institutionsResult.data ?? []) as DatabaseRecord[]).map(institution => ({
      id: String(institution.id),
      name: String(institution.name),
      logoUrl: institution.logo_url ? String(institution.logo_url) : null,
    })),
    products: [...new Map(
      ((productsResult.data ?? []) as DatabaseRecord[])
        .map(product => [String(product.id), {
          id: String(product.id),
          name: String(product.name),
        }]),
    ).values()],
    facets: {
      statuses: statusCounts,
      mimeGroups: mimeCounts,
    },
    permissions: {
      canUpload: true,
      canManageCategories: true,
      canCreateTemplates: true,
    },
    search: {
      mode: searchText
        ? usedQueryEmbedding
          ? 'hybrid'
          : 'full_text'
        : 'none',
      embeddingModel: embeddingAvailable
        ? mortgageBankFileEmbeddingModel
        : null,
      embeddingDimensions: embeddingAvailable ? mortgageBankFileEmbeddingDimensions : null,
      organizationId: session.organizationId,
    },
  }
})
