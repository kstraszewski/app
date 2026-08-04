import {
  cleanMortgageBankFileSearchSnippet,
  mortgageBankFileSearchMatch,
} from './mortgage-bank-file-search.ts'

type BackendDataClient = any
type UnknownRecord = Record<string, unknown>

export interface MortgageBankFileOmnisearchInput {
  query: string
  limit: number
  queryEmbedding?: number[] | null
}

export interface MortgageBankFileOmnisearchSource {
  files: unknown[]
  versions: unknown[]
  banks: unknown[]
  categories: unknown[]
  matches: unknown[]
}

export interface MortgageBankFileOmnisearchResult {
  file_id: string
  bank_id: string
  title: string
  bank_name: string
  bank_logo_url?: string
  bank_logo_background_color?: string
  category_label?: string
  original_file_name: string
  status: string
  snippet?: string
  locator?: string
  page_number?: number
  score: number
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {}
}

function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter(row => Object.keys(row).length > 0)
    : []
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function integer(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function score(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function uniqueTexts(rows: UnknownRecord[], key: string): string[] {
  return [...new Set(rows.map(row => text(row[key])).filter((value): value is string => Boolean(value)))]
}

export function rankMortgageBankFileOmnisearchResults(
  source: MortgageBankFileOmnisearchSource,
  query: string,
  limit: number,
): MortgageBankFileOmnisearchResult[] {
  const files = recordArray(source.files)
  const versionById = new Map(
    recordArray(source.versions).flatMap((row) => {
      const id = text(row.id)
      return id ? [[id, row] as const] : []
    }),
  )
  const bankById = new Map(
    recordArray(source.banks).flatMap((row) => {
      const id = text(row.id)
      return id ? [[id, row] as const] : []
    }),
  )
  const categoryById = new Map(
    recordArray(source.categories).flatMap((row) => {
      const id = text(row.id)
      return id ? [[id, row] as const] : []
    }),
  )
  const bestMatchByFile = new Map<string, UnknownRecord>()

  for (const match of recordArray(source.matches)) {
    const fileId = text(match.file_id)
    if (!fileId) continue
    const current = bestMatchByFile.get(fileId)
    if (!current || score(match.score) > score(current.score)) {
      bestMatchByFile.set(fileId, match)
    }
  }

  const ranked = files.flatMap((file): Array<MortgageBankFileOmnisearchResult & { updatedAt: string }> => {
    const fileId = text(file.id)
    const bankId = text(file.bank_id)
    const title = text(file.title)
    const version = versionById.get(text(file.current_version_id) ?? '')
    const bank = bankById.get(bankId ?? '')
    const category = categoryById.get(text(file.category_id) ?? '')
    const fileName = text(version?.original_file_name)
    const versionStatus = text(version?.status)
    if (!fileId || !bankId || !title || !fileName || !version || versionStatus !== 'current') {
      return []
    }

    const bankName = text(bank?.name) ?? 'Instytucja'
    const bankLogoUrl = text(bank?.logo_url)
    const bankLogoBackgroundColor = text(bank?.logo_background_color)
    const categoryLabel = text(category?.label)
    const titleMatch = mortgageBankFileSearchMatch(query, [title, fileName])
    const metadataMatch = titleMatch || mortgageBankFileSearchMatch(query, [
      file.description,
      bankName,
      categoryLabel,
    ])
    const vectorMatch = bestMatchByFile.get(fileId)
    if (!metadataMatch && !vectorMatch) return []

    const rawSnippet = vectorMatch ? cleanMortgageBankFileSearchSnippet(vectorMatch.snippet) : ''
    const snippet = rawSnippet ? rawSnippet.slice(0, 280) : undefined
    const locator = text(vectorMatch?.locator)
    const pageNumber = integer(vectorMatch?.page_number)
    const lexicalScore = titleMatch ? 2 : metadataMatch ? 1 : 0

    return [{
      file_id: fileId,
      bank_id: bankId,
      title,
      bank_name: bankName,
      ...(bankLogoUrl ? { bank_logo_url: bankLogoUrl } : {}),
      ...(bankLogoBackgroundColor ? { bank_logo_background_color: bankLogoBackgroundColor } : {}),
      ...(categoryLabel ? { category_label: categoryLabel } : {}),
      original_file_name: fileName,
      status: versionStatus,
      ...(snippet ? { snippet } : {}),
      ...(locator ? { locator } : {}),
      ...(pageNumber !== undefined && pageNumber > 0 ? { page_number: pageNumber } : {}),
      score: lexicalScore + score(vectorMatch?.score),
      updatedAt: text(file.updated_at) ?? '',
    }]
  })

  return ranked
    .sort((left, right) => (
      right.score - left.score
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.file_id.localeCompare(right.file_id)
    ))
    .slice(0, Math.max(1, Math.min(limit, 8)))
    .map(({ updatedAt: _updatedAt, ...result }) => result)
}

export async function searchMortgageBankFilesForOmnisearch(
  backendData: BackendDataClient,
  input: MortgageBankFileOmnisearchInput,
): Promise<MortgageBankFileOmnisearchResult[]> {
  const targetLimit = Math.max(1, Math.min(input.limit, 8))
  const [filesResult, matchesResult] = await Promise.all([
    backendData
      .from('mortgage_bank_files')
      .select('id, bank_id, category_id, title, description, current_version_id, updated_at')
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(1_000),
    backendData.rpc('search_mortgage_bank_file_chunks', {
      query_text: input.query,
      query_embedding: input.queryEmbedding ?? null,
      filter_bank_id: null,
      filter_category_key: null,
      filter_mime_group: null,
      filter_product_id: null,
      filter_status: 'current',
      match_count: Math.min(Math.max(targetLimit * 8, 24), 100),
      full_text_weight: 1.35,
      semantic_weight: 1,
      rrf_k: 50,
    }),
  ])
  if (filesResult.error) throw filesResult.error
  if (matchesResult.error) throw matchesResult.error

  const files = recordArray(filesResult.data)
  if (!files.length) return []

  const versionIds = uniqueTexts(files, 'current_version_id')
  const bankIds = uniqueTexts(files, 'bank_id')
  const categoryIds = uniqueTexts(files, 'category_id')
  const [versionsResult, banksResult, categoriesResult] = await Promise.all([
    versionIds.length
      ? backendData
          .from('mortgage_bank_file_versions')
          .select('id, original_file_name, status')
          .in('id', versionIds)
      : Promise.resolve({ data: [], error: null }),
    bankIds.length
      ? backendData
          .from('mortgage_banks')
          .select('id, name, logo_url, logo_background_color')
          .in('id', bankIds)
      : Promise.resolve({ data: [], error: null }),
    categoryIds.length
      ? backendData
          .from('mortgage_bank_file_categories')
          .select('id, label')
          .in('id', categoryIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (versionsResult.error) throw versionsResult.error
  if (banksResult.error) throw banksResult.error
  if (categoriesResult.error) throw categoriesResult.error

  return rankMortgageBankFileOmnisearchResults({
    files,
    versions: versionsResult.data ?? [],
    banks: banksResult.data ?? [],
    categories: categoriesResult.data ?? [],
    matches: matchesResult.data ?? [],
  }, input.query, targetLimit)
}
