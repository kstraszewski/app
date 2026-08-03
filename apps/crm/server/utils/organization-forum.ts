import { createHash } from 'node:crypto'
import { gateway } from '@ai-sdk/gateway'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { embed, embedMany } from 'ai'
import { createError } from 'h3'
import type {
  ForumAuthor,
  ForumAuthorRole,
  ForumCategory,
  ForumCreateReplyInput,
  ForumCreateThreadInput,
  ForumMatchLocation,
  ForumPost,
  ForumRealtimeEvent,
  ForumRealtimeEventKind,
  ForumRealtimeSnapshot,
  ForumSearchMode,
  ForumThread,
  ForumThreadDetailPayload,
  ForumThreadListPayload,
  ForumThreadStatus,
  ForumThreadSummary,
  ForumThreadType,
} from '../../shared/types/forum'

type DataApiClient = any
type UnknownRecord = Record<string, unknown>

export const organizationForumEmbeddingModel = 'gemini-embedding-2'
export const organizationForumGatewayEmbeddingModel = `google/${organizationForumEmbeddingModel}` as const
export const organizationForumEmbeddingDimensions = 768
export const organizationForumEmbeddingRecipe = 'forum-search-v1'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const languageCodePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/u
const threadTypes = new Set<ForumThreadType>(['question', 'discussion'])
const threadStatuses = new Set<ForumThreadStatus>(['open', 'answered', 'resolved', 'closed'])
const authorRoles = new Set<ForumAuthorRole>(['expert', 'admin', 'member'])
const matchLocations = new Set<ForumMatchLocation>(['title', 'question', 'reply'])
const realtimeEventKinds = new Set<ForumRealtimeEventKind>([
  'thread.created',
  'thread.updated',
  'reply.created',
  'post.created',
  'post.updated',
  'category.created',
  'category.updated',
])

export interface OrganizationForumListInput {
  query: string | null
  categoryId: string | null
  status: ForumThreadStatus | null
  type: ForumThreadType | null
  limit: number
}

export interface OrganizationForumCreateThreadInput extends Omit<ForumCreateThreadInput, 'clientRequestId'> {
  clientRequestId: string | null
}

export interface OrganizationForumCreateReplyInput extends Omit<ForumCreateReplyInput, 'clientRequestId'> {
  clientRequestId: string | null
}

export interface OrganizationForumSearchOptions {
  query: string
  queryEmbedding?: number[] | null
  categoryId?: string | null
  status?: ForumThreadStatus | null
  type?: ForumThreadType | null
  limit?: number
}

export interface OrganizationForumEmbeddingJob {
  id: string
  organizationId: string
  documentId: string
  model: string
  dimensions: number
  recipeVersion: string
  sourceSha256: string
  sourceRevision: number
  title: string
  content: string
  attempts: number
  maxAttempts: number
}

export interface OrganizationForumEmbeddingWorkerInput {
  backendData: DataApiClient
  googleApiKey?: string | null
  workerId: string
  limit?: number
  embedValues?: (values: string[]) => Promise<number[][]>
}

export class OrganizationForumDatabaseError extends Error {
  readonly code?: string
  readonly details?: string | null
  readonly hint?: string | null

  constructor(error: { message?: string, code?: string, details?: string | null, hint?: string | null }) {
    super(error.message || 'Organization forum database operation failed')
    this.name = 'OrganizationForumDatabaseError'
    this.code = error.code
    this.details = error.details
    this.hint = error.hint
  }
}

export function organizationForumHttpError(
  error: unknown,
  notFoundMessage = 'Forum thread not found',
): Error {
  if (error instanceof RangeError) {
    return createError({ statusCode: 400, statusMessage: error.message })
  }
  if (error instanceof OrganizationForumDatabaseError) {
    const statusCode = ({
      P0002: 404,
      '22023': 400,
      '23503': 400,
      '23505': 409,
      '23514': 409,
      '42501': 403,
    } as Record<string, number>)[String(error.code)] ?? 500
    return createError({
      statusCode,
      statusMessage: statusCode === 404 ? notFoundMessage : error.message,
    })
  }
  return error instanceof Error
    ? error
    : createError({ statusCode: 500, statusMessage: 'Organization forum operation failed' })
}

function firstValue(input: unknown): unknown {
  return Array.isArray(input) ? input[0] : input
}

function asRecord(input: unknown): UnknownRecord {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as UnknownRecord
    : {}
}

function relatedRecord(input: unknown): UnknownRecord {
  return asRecord(Array.isArray(input) ? input[0] : input)
}

function recordArray(input: unknown): UnknownRecord[] {
  return Array.isArray(input)
    ? input.map(asRecord).filter(row => Object.keys(row).length > 0)
    : []
}

function text(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const value = input.trim()
  return value || undefined
}

function normalizedText(input: unknown): string | undefined {
  const value = text(firstValue(input))
  return value?.replace(/\s+/gu, ' ')
}

function numberValue(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) return input
  if (typeof input === 'string' && input.trim()) {
    const value = Number(input)
    if (Number.isFinite(value)) return value
  }
  return undefined
}

function integerValue(input: unknown): number | undefined {
  const value = numberValue(input)
  return value !== undefined && Number.isSafeInteger(value) ? value : undefined
}

function booleanValue(input: unknown): boolean {
  return input === true || input === 'true'
}

function optionalStringValue(row: UnknownRecord, ...keys: string[]): string | undefined {
  return stringValue(row, ...keys)
}

function requiredText(input: unknown, field: string, minimum: number, maximum: number): string {
  const value = normalizedText(input)
  if (!value || value.length < minimum || value.length > maximum) {
    throw new RangeError(`${field} must contain between ${minimum} and ${maximum} characters`)
  }
  return value
}

function optionalUuid(input: unknown, field: string): string | null {
  const value = normalizedText(input)
  if (!value || value === 'all') return null
  if (!uuidPattern.test(value)) throw new RangeError(`${field} must be a UUID`)
  return value.toLowerCase()
}

function optionalEnum<T extends string>(
  input: unknown,
  field: string,
  allowed: ReadonlySet<T>,
): T | null {
  const value = normalizedText(input)
  if (!value || value === 'all') return null
  if (!allowed.has(value as T)) throw new RangeError(`${field} is invalid`)
  return value as T
}

function stringValue(row: UnknownRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(row[key])
    if (value) return value
  }
  return undefined
}

function relationValue(row: UnknownRecord, ...keys: string[]): UnknownRecord {
  for (const key of keys) {
    const value = relatedRecord(row[key])
    if (Object.keys(value).length) return value
  }
  return {}
}

function excerpt(value: unknown, maximum = 280): string {
  const normalized = normalizedText(value) ?? ''
  if (normalized.length <= maximum) return normalized
  return `${normalized.slice(0, maximum - 1).trimEnd()}…`
}

function enumOr<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  fallback: T,
): T {
  const normalized = text(value)
  return normalized && allowed.has(normalized as T) ? normalized as T : fallback
}

function mapMatchLocations(value: unknown): ForumMatchLocation | ForumMatchLocation[] | null {
  if (Array.isArray(value)) {
    const locations = [...new Set(value
      .map(text)
      .filter((entry): entry is ForumMatchLocation => Boolean(entry && matchLocations.has(entry as ForumMatchLocation))))]
    return locations.length ? locations : null
  }
  const location = text(value)
  return location && matchLocations.has(location as ForumMatchLocation)
    ? location as ForumMatchLocation
    : null
}

export function parseOrganizationForumListInput(input: UnknownRecord): OrganizationForumListInput {
  const query = normalizedText(input.q)
  if (query && (query.length < 3 || query.length > 200)) {
    throw new RangeError('q must contain between 3 and 200 characters')
  }

  const rawLimit = firstValue(input.limit)
  const limit = rawLimit === undefined || rawLimit === null || rawLimit === ''
    ? 20
    : integerValue(rawLimit)
  if (limit === undefined || limit < 1 || limit > 50) {
    throw new RangeError('limit must be an integer between 1 and 50')
  }

  return {
    query: query ?? null,
    categoryId: optionalUuid(input.category, 'category'),
    status: optionalEnum(input.status, 'status', threadStatuses),
    type: optionalEnum(input.type, 'type', threadTypes),
    limit,
  }
}

export function parseOrganizationForumCreateThreadInput(
  input: unknown,
): OrganizationForumCreateThreadInput {
  const body = asRecord(input)
  const type = optionalEnum(body.type, 'type', threadTypes)
  if (!type) throw new RangeError('type is required')

  const visibility = normalizedText(body.visibility)
  if (visibility !== 'organization') {
    throw new RangeError('visibility must equal organization')
  }

  const languageCode = normalizedText(body.languageCode)
  if (!languageCode || !languageCodePattern.test(languageCode)) {
    throw new RangeError('languageCode must use a value such as pl or pl-PL')
  }

  const categoryId = optionalUuid(body.categoryId, 'categoryId')
  if (!categoryId) throw new RangeError('categoryId is required')

  return {
    type,
    title: requiredText(body.title, 'title', 8, 180),
    body: requiredText(body.body, 'body', 20, 12_000),
    categoryId,
    languageCode,
    visibility: 'organization',
    clientRequestId: optionalUuid(body.clientRequestId, 'clientRequestId'),
  }
}

export function parseOrganizationForumCreateReplyInput(
  input: unknown,
): OrganizationForumCreateReplyInput {
  const body = asRecord(input)
  return {
    body: requiredText(body.body, 'body', 2, 12_000),
    clientRequestId: optionalUuid(body.clientRequestId, 'clientRequestId'),
  }
}

export function parseOrganizationForumThreadId(input: unknown): string {
  const value = normalizedText(input)
  if (!value || !uuidPattern.test(value)) throw new RangeError('threadId must be a UUID')
  return value.toLowerCase()
}

export function mapOrganizationForumCategory(input: unknown): ForumCategory {
  const row = asRecord(input)
  return {
    id: stringValue(row, 'id', 'category_id') ?? '',
    slug: stringValue(row, 'slug', 'category_slug') ?? 'general',
    name: stringValue(row, 'name', 'category_name') ?? 'Ogólne',
    description: stringValue(row, 'description', 'category_description') ?? null,
    icon: stringValue(row, 'icon', 'category_icon') ?? null,
    color: stringValue(row, 'color', 'category_color') ?? null,
    sortOrder: integerValue(row.sort_order ?? row.sortOrder) ?? 0,
    isActive: row.is_active === undefined && row.isActive === undefined
      ? true
      : booleanValue(row.is_active ?? row.isActive),
    threadCount: integerValue(row.thread_count ?? row.threadCount) ?? 0,
    createdAt: stringValue(row, 'created_at', 'createdAt'),
    updatedAt: stringValue(row, 'updated_at', 'updatedAt') ?? null,
  }
}

export function mapOrganizationForumAuthor(input: unknown, fallback: UnknownRecord = {}): ForumAuthor {
  const row = asRecord(input)
  const role = enumOr(
    row.role ?? fallback.author_role ?? fallback.membership_role,
    authorRoles,
    'member',
  )
  return {
    id: stringValue(row, 'id', 'user_id')
      ?? stringValue(fallback, 'author_id', 'author_user_id')
      ?? '',
    name: stringValue(row, 'name', 'display_name', 'full_name')
      ?? stringValue(fallback, 'author_name', 'author_display_name', 'author_full_name')
      ?? 'Użytkownik organizacji',
    avatarUrl: stringValue(row, 'avatar_url', 'avatarUrl')
      ?? stringValue(fallback, 'author_avatar_url')
      ?? null,
    role,
    roleLabel: stringValue(row, 'role_label', 'roleLabel')
      ?? stringValue(fallback, 'author_role_label')
      ?? null,
    expertise: stringValue(row, 'expertise')
      ?? stringValue(fallback, 'author_expertise')
      ?? null,
  }
}

export function mapOrganizationForumPost(input: unknown): ForumPost {
  const row = asRecord(input)
  const content = stringValue(row, 'content', 'body') ?? ''
  const author = relationValue(row, 'author', 'author_user', 'user', 'users')
  const hiddenBy = relationValue(row, 'hiddenBy', 'hidden_by')
  const kind = stringValue(row, 'kind', 'post_kind') === 'question' ? 'question' : 'reply'
  return {
    id: stringValue(row, 'id', 'post_id') ?? '',
    threadId: stringValue(row, 'thread_id', 'threadId'),
    kind,
    content,
    body: content,
    author: mapOrganizationForumAuthor(author, row),
    isVerifiedExpertAnswer: booleanValue(row.is_verified_expert_answer ?? row.isVerifiedExpertAnswer),
    isOfficialAdminAnswer: booleanValue(row.is_official_admin_answer ?? row.isOfficialAdminAnswer),
    isAcceptedAnswer: booleanValue(row.is_accepted_answer ?? row.isAcceptedAnswer),
    isHidden: booleanValue(row.is_hidden ?? row.isHidden),
    hiddenAt: stringValue(row, 'hidden_at', 'hiddenAt') ?? null,
    hiddenReason: stringValue(row, 'hidden_reason', 'hiddenReason') ?? null,
    hiddenBy: Object.keys(hiddenBy).length
      ? mapOrganizationForumAuthor(hiddenBy)
      : null,
    createdAt: stringValue(row, 'created_at', 'createdAt') ?? '',
    updatedAt: stringValue(row, 'updated_at', 'updatedAt') ?? null,
    sources: recordArray(row.sources).map(source => ({
      id: stringValue(source, 'id', 'source_id') ?? '',
      title: stringValue(source, 'title', 'source_title') ?? '',
      kind: enumOr(source.kind, new Set(['internal', 'external', 'other'] as const), 'other'),
      url: stringValue(source, 'url') ?? null,
      label: stringValue(source, 'label') ?? null,
    })),
  }
}

export function mapOrganizationForumThreadSummary(input: unknown): ForumThreadSummary {
  const row = asRecord(input)
  const categoryRow = relationValue(row, 'category', 'forum_category', 'organization_forum_category')
  const authorRow = relationValue(row, 'author', 'author_user', 'user', 'users')
  const hiddenByRow = relationValue(row, 'hiddenBy', 'hidden_by')
  const content = stringValue(row, 'excerpt', 'question_excerpt', 'body', 'content', 'question_body') ?? ''
  const createdAt = stringValue(row, 'created_at', 'createdAt') ?? ''
  const updatedAt = stringValue(row, 'updated_at', 'updatedAt') ?? null
  const category = mapOrganizationForumCategory(
    Object.keys(categoryRow).length ? categoryRow : row,
  )

  return {
    id: stringValue(row, 'id', 'thread_id') ?? '',
    title: stringValue(row, 'title', 'thread_title') ?? '',
    type: enumOr(row.type ?? row.thread_type, threadTypes, 'question'),
    status: enumOr(row.status ?? row.thread_status, threadStatuses, 'open'),
    category: {
      id: category.id,
      slug: category.slug,
      name: category.name,
      icon: category.icon,
      color: category.color,
    },
    categoryId: category.id || stringValue(row, 'category_id'),
    excerpt: excerpt(content),
    author: mapOrganizationForumAuthor(authorRow, row),
    replyCount: integerValue(row.reply_count ?? row.replyCount) ?? 0,
    participantCount: integerValue(row.participant_count ?? row.participantCount) ?? 0,
    viewCount: integerValue(row.view_count ?? row.viewCount) ?? 0,
    createdAt,
    updatedAt,
    lastActivityAt: stringValue(row, 'last_activity_at', 'lastActivityAt')
      ?? updatedAt
      ?? createdAt,
    acceptedPostId: stringValue(row, 'accepted_post_id', 'acceptedPostId') ?? null,
    hasVerifiedExpertAnswer: booleanValue(row.has_verified_expert_answer ?? row.hasVerifiedExpertAnswer),
    hasOfficialAdminAnswer: booleanValue(row.has_official_admin_answer ?? row.hasOfficialAdminAnswer),
    matchedIn: mapMatchLocations(row.matched_in ?? row.matchedIn),
    snippet: normalizedText(row.snippet) ?? null,
    score: numberValue(row.score) ?? null,
    languageCode: stringValue(row, 'language_code', 'languageCode') ?? 'pl',
    visibility: 'organization',
    isHidden: booleanValue(row.is_hidden ?? row.isHidden),
    hiddenAt: stringValue(row, 'hidden_at', 'hiddenAt') ?? null,
    hiddenReason: stringValue(row, 'hidden_reason', 'hiddenReason') ?? null,
    hiddenBy: Object.keys(hiddenByRow).length
      ? mapOrganizationForumAuthor(hiddenByRow)
      : null,
  }
}

export function mapOrganizationForumThread(input: unknown): ForumThread {
  const row = asRecord(input)
  const summary = mapOrganizationForumThreadSummary(row)
  const posts = recordArray(row.posts).map(mapOrganizationForumPost)
  const content = stringValue(row, 'content', 'body', 'question_body')
    ?? posts.find(post => post.kind === 'question')?.content
    ?? summary.excerpt

  return {
    ...summary,
    content,
    body: content,
    posts,
    relatedThreads: recordArray(row.related_threads ?? row.relatedThreads)
      .map(mapOrganizationForumThreadSummary),
  }
}

export function mapOrganizationForumThreadListPayload(
  input: unknown,
  options: {
    query?: string | null
    searchMode?: ForumSearchMode
    categories?: unknown
    total?: number
  } = {},
): ForumThreadListPayload {
  const row = asRecord(input)
  const rows = Array.isArray(input)
    ? recordArray(input)
    : recordArray(row.threads ?? row.data ?? row.results)
  const categories = options.categories === undefined
    ? recordArray(row.categories)
    : recordArray(options.categories)
  const query = options.query ?? normalizedText(row.query) ?? null
  const inferredMode: ForumSearchMode = query ? 'lexical' : 'browse'
  const total = options.total
    ?? integerValue(row.total ?? row.count)
    ?? rows.length

  return {
    categories: categories.map(mapOrganizationForumCategory),
    threads: rows.map(mapOrganizationForumThreadSummary),
    searchMode: options.searchMode ?? enumOr(row.search_mode ?? row.searchMode, new Set<ForumSearchMode>(['browse', 'lexical', 'hybrid']), inferredMode),
    query,
    total,
  }
}

export function mapOrganizationForumThreadDetailPayload(input: unknown): ForumThreadDetailPayload {
  const row = asRecord(input)
  const threadRow = Object.keys(asRecord(row.thread)).length ? asRecord(row.thread) : row
  const thread = mapOrganizationForumThread({
    ...threadRow,
    posts: row.posts ?? threadRow.posts,
    related_threads: row.related_threads ?? row.relatedThreads ?? threadRow.related_threads,
  })
  const posts = recordArray(row.posts ?? threadRow.posts).map(mapOrganizationForumPost)
  const relatedThreads = recordArray(
    row.related_threads ?? row.relatedThreads ?? threadRow.related_threads,
  ).map(mapOrganizationForumThreadSummary)

  return {
    thread: {
      ...thread,
      posts,
      relatedThreads,
    },
    posts,
    relatedThreads,
  }
}

export function organizationForumDocumentEmbeddingInput(title: string, content: string): string {
  return `title: ${title.trim() || 'none'} | text: ${content.trim()}`
}

export function organizationForumQueryEmbeddingInput(query: string): string {
  return `task: search result | query: ${query.trim()}`
}

export function organizationForumSourceSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export async function organizationForumQueryEmbedding(
  apiKey: string | null | undefined,
  query: string,
  abortSignal?: AbortSignal,
): Promise<number[] | null> {
  const normalizedApiKey = apiKey?.trim()
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return null

  const response = await embed({
    model: organizationForumEmbeddingProvider(normalizedApiKey),
    value: organizationForumQueryEmbeddingInput(normalizedQuery),
    abortSignal,
    providerOptions: {
      google: {
        outputDimensionality: organizationForumEmbeddingDimensions,
      },
    },
  })
  if (response.embedding.length !== organizationForumEmbeddingDimensions) {
    throw new Error('Gemini returned an unexpected forum query embedding dimensionality')
  }
  return response.embedding
}

export async function organizationForumDocumentEmbeddings(
  apiKey: string | null | undefined,
  values: string[],
  abortSignal?: AbortSignal,
): Promise<number[][]> {
  if (!values.length) return []

  const model = organizationForumEmbeddingProvider(apiKey)
  const embeddings: number[][] = []
  for (let offset = 0; offset < values.length; offset += 40) {
    const batch = values.slice(offset, offset + 40)
    const response = await embedMany({
      model,
      values: batch,
      abortSignal,
      providerOptions: {
        google: {
          outputDimensionality: organizationForumEmbeddingDimensions,
        },
      },
    })
    if (response.embeddings.length !== batch.length) {
      throw new Error('Gemini returned an unexpected number of forum embeddings')
    }
    if (response.embeddings.some(value => value.length !== organizationForumEmbeddingDimensions)) {
      throw new Error('Gemini returned an unexpected forum embedding dimensionality')
    }
    embeddings.push(...response.embeddings)
  }
  return embeddings
}

export function organizationForumEmbeddingProvider(apiKey: string | null | undefined) {
  const normalizedApiKey = apiKey?.trim()
  return normalizedApiKey
    ? createGoogleGenerativeAI({ apiKey: normalizedApiKey }).embedding(organizationForumEmbeddingModel)
    : gateway.embedding(organizationForumGatewayEmbeddingModel)
}

function forumDataOrThrow<T>(result: {
  data?: T | null
  error?: { message?: string, code?: string, details?: string | null, hint?: string | null } | null
}): T | null {
  if (result.error) throw new OrganizationForumDatabaseError(result.error)
  return result.data ?? null
}

function mapOrganizationForumRealtimeEvent(input: unknown): ForumRealtimeEvent | null {
  const row = asRecord(input)
  const schemaVersion = integerValue(row.schemaVersion ?? row.schema_version)
  const eventId = stringValue(row, 'eventId', 'event_id')
  const kind = stringValue(row, 'kind')
  const organizationId = stringValue(row, 'organizationId', 'organization_id')
  const revision = integerValue(row.revision)
  const occurredAt = stringValue(row, 'occurredAt', 'occurred_at')
  if (
    schemaVersion !== 1
    || !eventId
    || !kind
    || !realtimeEventKinds.has(kind as ForumRealtimeEventKind)
    || !organizationId
    || revision === undefined
    || revision < 0
    || !occurredAt
  ) return null

  const threadId = optionalStringValue(row, 'threadId', 'thread_id')
  const postId = optionalStringValue(row, 'postId', 'post_id')
  const categoryId = optionalStringValue(row, 'categoryId', 'category_id')

  return {
    schemaVersion: 1,
    eventId,
    kind: kind as ForumRealtimeEventKind,
    organizationId,
    revision,
    ...(threadId ? { threadId } : {}),
    ...(postId ? { postId } : {}),
    ...(categoryId ? { categoryId } : {}),
    occurredAt,
  }
}

export function mapOrganizationForumRealtimeSnapshot(input: unknown): ForumRealtimeSnapshot {
  const row = asRecord(firstValue(input))
  const revision = integerValue(row.revision) ?? 0
  const lastEvent = mapOrganizationForumRealtimeEvent(row.lastEvent ?? row.last_event)
  return {
    revision: Math.max(0, revision),
    lastEvent: lastEvent?.revision === revision ? lastEvent : null,
    updatedAt: stringValue(row, 'updatedAt', 'updated_at') ?? null,
  }
}

export async function loadOrganizationForumRealtimeSnapshot(
  dataApi: DataApiClient,
  organizationId: string,
): Promise<ForumRealtimeSnapshot> {
  const result = await dataApi.rpc('get_organization_forum_realtime_state', {
    p_organization_id: organizationId,
  })
  return mapOrganizationForumRealtimeSnapshot(forumDataOrThrow<unknown>(result))
}

export async function listOrganizationForumThreads(
  dataApi: DataApiClient,
  organizationId: string,
  input: OrganizationForumListInput,
  queryEmbedding: number[] | null = null,
): Promise<ForumThreadListPayload> {
  const result = await dataApi.rpc('list_organization_forum_threads', {
    p_organization_id: organizationId,
    p_query: input.query,
    p_query_embedding: input.query ? queryEmbedding : null,
    p_category_id: input.categoryId,
    p_status: input.status,
    p_thread_type: input.type,
    p_limit: input.limit,
  })
  const data = forumDataOrThrow<unknown>(result)
  return mapOrganizationForumThreadListPayload(data, {
    query: input.query,
    searchMode: input.query
      ? queryEmbedding
        ? 'hybrid'
        : 'lexical'
      : 'browse',
  })
}

export async function getOrganizationForumThread(
  dataApi: DataApiClient,
  organizationId: string,
  threadId: string,
): Promise<ForumThreadDetailPayload> {
  const result = await dataApi.rpc('get_organization_forum_thread', {
    p_organization_id: organizationId,
    p_thread_id: threadId,
  })
  const data = forumDataOrThrow<unknown>(result)
  if (!data) {
    throw new OrganizationForumDatabaseError({
      code: 'P0002',
      message: 'Forum thread not found',
    })
  }
  return mapOrganizationForumThreadDetailPayload(data)
}

export async function createOrganizationForumThread(
  dataApi: DataApiClient,
  organizationId: string,
  input: OrganizationForumCreateThreadInput,
): Promise<{ thread: ForumThread | ForumThreadSummary }> {
  const result = await dataApi.rpc('create_organization_forum_thread', {
    p_organization_id: organizationId,
    p_category_id: input.categoryId,
    p_thread_type: input.type,
    p_title: input.title,
    p_body: input.body,
    p_language_code: input.languageCode,
    p_visibility: input.visibility,
    p_client_request_id: input.clientRequestId,
  })
  const data = asRecord(forumDataOrThrow<unknown>(result))
  const threadRow = Object.keys(asRecord(data.thread)).length ? data.thread : data
  return { thread: mapOrganizationForumThread(threadRow) }
}

export async function createOrganizationForumReply(
  dataApi: DataApiClient,
  organizationId: string,
  threadId: string,
  input: OrganizationForumCreateReplyInput,
): Promise<{ post: ForumPost, thread?: ForumThread | ForumThreadSummary }> {
  const result = await dataApi.rpc('create_organization_forum_reply', {
    p_organization_id: organizationId,
    p_thread_id: threadId,
    p_body: input.body,
    p_client_request_id: input.clientRequestId,
  })
  const data = asRecord(forumDataOrThrow<unknown>(result))
  const postRow = Object.keys(asRecord(data.post)).length ? data.post : data
  const threadRow = asRecord(data.thread)
  return {
    post: mapOrganizationForumPost(postRow),
    ...(Object.keys(threadRow).length
      ? { thread: mapOrganizationForumThread(threadRow) }
      : {}),
  }
}

function mapOrganizationForumEmbeddingJob(input: unknown): OrganizationForumEmbeddingJob {
  const row = asRecord(input)
  const id = stringValue(row, 'id', 'job_id')
  const organizationId = stringValue(row, 'organization_id', 'organizationId')
  const documentId = stringValue(row, 'document_id', 'documentId')
  const sourceSha256 = stringValue(row, 'source_sha256', 'sourceSha256')
  const title = stringValue(row, 'title')
  const content = stringValue(row, 'content')
  const sourceRevision = integerValue(row.source_revision ?? row.sourceRevision)
  const attempts = integerValue(row.attempts)
  const maxAttempts = integerValue(row.max_attempts ?? row.maxAttempts)
  if (
    !id
    || !organizationId
    || !documentId
    || !sourceSha256
    || title === undefined
    || content === undefined
    || sourceRevision === undefined
    || attempts === undefined
    || maxAttempts === undefined
  ) {
    throw new Error('Forum embedding claim returned an invalid job')
  }

  return {
    id,
    organizationId,
    documentId,
    model: stringValue(row, 'model') ?? organizationForumEmbeddingModel,
    dimensions: integerValue(row.dimensions) ?? organizationForumEmbeddingDimensions,
    recipeVersion: stringValue(row, 'recipe_version', 'recipeVersion')
      ?? organizationForumEmbeddingRecipe,
    sourceSha256,
    sourceRevision,
    title,
    content,
    attempts,
    maxAttempts,
  }
}

export async function claimOrganizationForumEmbeddingJobs(
  backendData: DataApiClient,
  workerId: string,
  limit = 20,
): Promise<OrganizationForumEmbeddingJob[]> {
  const normalizedWorkerId = workerId.trim()
  if (!normalizedWorkerId || normalizedWorkerId.length > 200) {
    throw new RangeError('workerId must contain between 1 and 200 characters')
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 40) {
    throw new RangeError('limit must be an integer between 1 and 40')
  }

  const result = await backendData.rpc('claim_forum_embedding_jobs', {
    p_worker_id: normalizedWorkerId,
    p_limit: limit,
    p_lock_timeout: '5 minutes',
  })
  return recordArray(forumDataOrThrow<unknown>(result)).map(mapOrganizationForumEmbeddingJob)
}

export async function completeOrganizationForumEmbeddingJob(
  backendData: DataApiClient,
  jobId: string,
  workerId: string,
  embedding: number[],
): Promise<unknown> {
  if (embedding.length !== organizationForumEmbeddingDimensions) {
    throw new RangeError(`embedding must contain ${organizationForumEmbeddingDimensions} dimensions`)
  }
  const result = await backendData.rpc('complete_forum_embedding_job', {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_embedding: embedding,
  })
  return forumDataOrThrow<unknown>(result)
}

export function organizationForumEmbeddingRetryDelaySeconds(attempts: number): number {
  const normalizedAttempts = Math.max(1, Math.trunc(attempts))
  const baseSeconds = Math.min(6 * 60 * 60, 30 * 2 ** Math.max(0, normalizedAttempts - 1))
  return Math.max(1, Math.round(baseSeconds * (0.75 + Math.random() * 0.5)))
}

export async function retryOrganizationForumEmbeddingJob(
  backendData: DataApiClient,
  job: OrganizationForumEmbeddingJob,
  workerId: string,
  error: unknown,
): Promise<unknown> {
  const message = error instanceof Error ? error.message : 'Forum embedding failed'
  const retryDelay = organizationForumEmbeddingRetryDelaySeconds(job.attempts)
  const result = await backendData.rpc('retry_forum_embedding_job', {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_error: message.slice(0, 4_000),
    p_retry_delay: `${retryDelay} seconds`,
  })
  return forumDataOrThrow<unknown>(result)
}

export async function processOrganizationForumEmbeddingJobs(
  input: OrganizationForumEmbeddingWorkerInput,
): Promise<{
  claimed: number
  completed: number
  failed: number
  outcomes: Array<{ jobId: string, status: 'completed' | 'failed', error?: string }>
}> {
  const apiKey = input.googleApiKey?.trim()
  const limit = Math.min(40, Math.max(1, Math.trunc(input.limit ?? 20)))
  const jobs = await claimOrganizationForumEmbeddingJobs(
    input.backendData,
    input.workerId,
    limit,
  )
  if (!jobs.length) return { claimed: 0, completed: 0, failed: 0, outcomes: [] }

  const outcomes: Array<{
    jobId: string
    status: 'completed' | 'failed'
    error?: string
  }> = []
  const validJobs: OrganizationForumEmbeddingJob[] = []
  const values: string[] = []

  for (const job of jobs) {
    try {
      if (
        job.model !== organizationForumEmbeddingModel
        || job.dimensions !== organizationForumEmbeddingDimensions
        || job.recipeVersion !== organizationForumEmbeddingRecipe
      ) {
        throw new Error('Forum embedding job uses an unsupported model contract')
      }
      const value = organizationForumDocumentEmbeddingInput(job.title, job.content)
      if (organizationForumSourceSha256(value) !== job.sourceSha256) {
        throw new Error('Forum embedding source checksum does not match the claimed document')
      }
      validJobs.push(job)
      values.push(value)
    } catch (error) {
      await retryOrganizationForumEmbeddingJob(
        input.backendData,
        job,
        input.workerId,
        error,
      )
      outcomes.push({
        jobId: job.id,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Forum embedding validation failed',
      })
    }
  }

  if (validJobs.length) {
    let embeddings: number[][]
    try {
      embeddings = input.embedValues
        ? await input.embedValues(values)
        : await organizationForumDocumentEmbeddings(
            apiKey,
            values,
            AbortSignal.timeout(25_000),
          )
      if (
        embeddings.length !== validJobs.length
        || embeddings.some(value => value.length !== organizationForumEmbeddingDimensions)
      ) {
        throw new Error('Forum embedding provider returned an invalid batch')
      }
    } catch (error) {
      for (const job of validJobs) {
        await retryOrganizationForumEmbeddingJob(
          input.backendData,
          job,
          input.workerId,
          error,
        )
        outcomes.push({
          jobId: job.id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Forum embedding provider failed',
        })
      }
      return {
        claimed: jobs.length,
        completed: outcomes.filter(outcome => outcome.status === 'completed').length,
        failed: outcomes.filter(outcome => outcome.status === 'failed').length,
        outcomes,
      }
    }

    for (let index = 0; index < validJobs.length; index += 1) {
      const job = validJobs[index]!
      try {
        await completeOrganizationForumEmbeddingJob(
          input.backendData,
          job.id,
          input.workerId,
          embeddings[index]!,
        )
        outcomes.push({ jobId: job.id, status: 'completed' })
      } catch (error) {
        await retryOrganizationForumEmbeddingJob(
          input.backendData,
          job,
          input.workerId,
          error,
        )
        outcomes.push({
          jobId: job.id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Forum embedding completion failed',
        })
      }
    }
  }

  return {
    claimed: jobs.length,
    completed: outcomes.filter(outcome => outcome.status === 'completed').length,
    failed: outcomes.filter(outcome => outcome.status === 'failed').length,
    outcomes,
  }
}
