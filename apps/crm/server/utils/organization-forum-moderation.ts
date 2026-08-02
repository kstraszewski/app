import type {
  ForumAuthor,
  ForumCategory,
  ForumPost,
  ForumThreadSummary,
} from '../../shared/types/forum'
import {
  mapOrganizationForumAuthor,
  mapOrganizationForumCategory,
  mapOrganizationForumPost,
  mapOrganizationForumThreadSummary,
  OrganizationForumDatabaseError,
} from './organization-forum.ts'

type DataApiClient = any
type UnknownRecord = Record<string, unknown>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const categorySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const threadActions = new Set<ForumThreadModerationAction>([
  'hide',
  'restore',
  'close',
  'reopen',
  'move',
])
const postActions = new Set<ForumPostModerationAction>(['hide', 'restore'])

export type ForumThreadModerationAction = 'hide' | 'restore' | 'close' | 'reopen' | 'move'
export type ForumPostModerationAction = 'hide' | 'restore'

export interface ForumModerationContext {
  canModerate: boolean
  canManageCategories: boolean
  isForumAdmin: boolean
  isOrganizationAdmin: boolean
  roleLabel: string | null
}

export interface ForumThreadModerationInput {
  action: ForumThreadModerationAction
  reason: string | null
  categoryId: string | null
}

export interface ForumPostModerationInput {
  action: ForumPostModerationAction
  reason: string | null
}

export interface ForumCategoryCreateInput {
  slug: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  sortOrder: number
  reason: string | null
}

export interface ForumCategoryUpdateInput {
  slug?: string
  name?: string
  description?: string | null
  icon?: string | null
  color?: string | null
  sortOrder?: number
  isActive?: boolean
  reason: string | null
}

export interface ForumModerationHiddenItem {
  targetType: 'thread' | 'post'
  id: string
  threadId: string
  postId?: string
  title: string
  threadTitle?: string
  excerpt: string
  author: ForumAuthor
  hiddenAt: string
  hiddenBy: ForumAuthor | null
  reason: string | null
}

export interface ForumModerationItemsPayload {
  hiddenThreads: ForumModerationHiddenItem[]
  hiddenPosts: ForumModerationHiddenItem[]
  total: number
}

export interface ForumThreadModerationPayload {
  changed: boolean
  auditEventId: string | null
  thread: ForumThreadSummary
}

export interface ForumPostModerationPayload {
  changed: boolean
  auditEventId: string | null
  post: ForumPost
  thread: ForumThreadSummary
}

export interface ForumCategoriesPayload {
  categories: ForumCategory[]
}

export interface ForumCategoryMutationPayload {
  changed: boolean
  auditEventId: string | null
  category: ForumCategory
}

function asRecord(input: unknown): UnknownRecord {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as UnknownRecord
    : {}
}

function recordArray(input: unknown): UnknownRecord[] {
  return Array.isArray(input)
    ? input.map(asRecord).filter(row => Object.keys(row).length > 0)
    : []
}

function firstValue(input: unknown): unknown {
  return Array.isArray(input) ? input[0] : input
}

function text(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  const value = input.trim()
  return value || undefined
}

function compactText(input: unknown): string | undefined {
  return text(firstValue(input))?.replace(/\s+/gu, ' ')
}

function stringValue(row: UnknownRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(row[key])
    if (value) return value
  }
  return undefined
}

function booleanValue(input: unknown): boolean {
  return input === true || input === 'true'
}

function integerValue(input: unknown): number | undefined {
  const value = typeof input === 'number'
    ? input
    : typeof input === 'string' && input.trim()
      ? Number(input)
      : Number.NaN
  return Number.isSafeInteger(value) ? value : undefined
}

function assertOnlyKeys(
  row: UnknownRecord,
  allowed: readonly string[],
  field = 'body',
): void {
  const unexpected = Object.keys(row).filter(key => !allowed.includes(key)).sort()[0]
  if (unexpected) throw new RangeError(`Unsupported field in ${field}: ${unexpected}`)
}

function requiredText(
  input: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  const value = compactText(input)
  if (!value || value.length < minimum || value.length > maximum) {
    throw new RangeError(`${field} must contain between ${minimum} and ${maximum} characters`)
  }
  return value
}

function optionalText(
  input: unknown,
  field: string,
  maximum: number,
): string | null {
  if (input === undefined || input === null || input === '') return null
  const value = compactText(input)
  if (!value || value.length > maximum) {
    throw new RangeError(`${field} must contain at most ${maximum} characters`)
  }
  return value
}

function moderationReason(input: unknown, required: boolean): string | null {
  if (input === undefined || input === null || input === '') {
    if (required) throw new RangeError('reason must contain between 5 and 1000 characters')
    return null
  }
  return requiredText(input, 'reason', 5, 1000)
}

export function parseOrganizationForumModerationId(input: unknown, field: string): string {
  const value = compactText(input)
  if (!value || !uuidPattern.test(value)) throw new RangeError(`${field} must be a UUID`)
  return value.toLowerCase()
}

export function parseOrganizationForumModerationItemsInput(
  input: UnknownRecord,
): { limit: number } {
  const rawLimit = firstValue(input.limit)
  const limit = rawLimit === undefined || rawLimit === null || rawLimit === ''
    ? 50
    : integerValue(rawLimit)
  if (limit === undefined || limit < 1 || limit > 100) {
    throw new RangeError('limit must be an integer between 1 and 100')
  }
  return { limit }
}

export function parseOrganizationForumThreadModerationInput(
  input: unknown,
): ForumThreadModerationInput {
  const body = asRecord(input)
  assertOnlyKeys(body, ['action', 'reason', 'categoryId'])
  const action = compactText(body.action) as ForumThreadModerationAction | undefined
  if (!action || !threadActions.has(action)) {
    throw new RangeError('action must be hide, restore, close, reopen or move')
  }

  const categoryId = body.categoryId === undefined || body.categoryId === null || body.categoryId === ''
    ? null
    : parseOrganizationForumModerationId(body.categoryId, 'categoryId')
  if (action === 'move' && !categoryId) throw new RangeError('categoryId is required for move')
  if (action !== 'move' && categoryId) throw new RangeError('categoryId is supported only for move')

  return {
    action,
    reason: moderationReason(body.reason, action === 'hide'),
    categoryId,
  }
}

export function parseOrganizationForumPostModerationInput(
  input: unknown,
): ForumPostModerationInput {
  const body = asRecord(input)
  assertOnlyKeys(body, ['action', 'reason'])
  const action = compactText(body.action) as ForumPostModerationAction | undefined
  if (!action || !postActions.has(action)) {
    throw new RangeError('action must be hide or restore')
  }
  return {
    action,
    reason: moderationReason(body.reason, action === 'hide'),
  }
}

function categorySlug(input: unknown): string {
  const value = requiredText(input, 'slug', 2, 100).toLowerCase()
  if (!categorySlugPattern.test(value)) {
    throw new RangeError('slug must contain lowercase letters, numbers and single hyphens')
  }
  return value
}

function categorySortOrder(input: unknown, fallback?: number): number {
  if (input === undefined && fallback !== undefined) return fallback
  const value = integerValue(input)
  if (value === undefined || value < 0 || value > 100_000) {
    throw new RangeError('sortOrder must be an integer between 0 and 100000')
  }
  return value
}

export function parseOrganizationForumCategoryCreateInput(
  input: unknown,
): ForumCategoryCreateInput {
  const body = asRecord(input)
  assertOnlyKeys(body, [
    'slug',
    'name',
    'description',
    'icon',
    'color',
    'sortOrder',
    'reason',
  ])
  return {
    slug: categorySlug(body.slug),
    name: requiredText(body.name, 'name', 2, 120),
    description: optionalText(body.description, 'description', 1000),
    icon: optionalText(body.icon, 'icon', 100),
    color: optionalText(body.color, 'color', 40),
    sortOrder: categorySortOrder(body.sortOrder, 100),
    reason: moderationReason(body.reason, false),
  }
}

export function parseOrganizationForumCategoryUpdateInput(
  input: unknown,
): ForumCategoryUpdateInput {
  const body = asRecord(input)
  assertOnlyKeys(body, [
    'slug',
    'name',
    'description',
    'icon',
    'color',
    'sortOrder',
    'isActive',
    'reason',
  ])
  const mutableKeys = ['slug', 'name', 'description', 'icon', 'color', 'sortOrder', 'isActive']
  if (!mutableKeys.some(key => Object.hasOwn(body, key))) {
    throw new RangeError('category update must contain at least one mutable field')
  }
  if (Object.hasOwn(body, 'isActive') && typeof body.isActive !== 'boolean') {
    throw new RangeError('isActive must be a boolean')
  }

  return {
    ...(Object.hasOwn(body, 'slug') ? { slug: categorySlug(body.slug) } : {}),
    ...(Object.hasOwn(body, 'name')
      ? { name: requiredText(body.name, 'name', 2, 120) }
      : {}),
    ...(Object.hasOwn(body, 'description')
      ? { description: optionalText(body.description, 'description', 1000) }
      : {}),
    ...(Object.hasOwn(body, 'icon')
      ? { icon: optionalText(body.icon, 'icon', 100) }
      : {}),
    ...(Object.hasOwn(body, 'color')
      ? { color: optionalText(body.color, 'color', 40) }
      : {}),
    ...(Object.hasOwn(body, 'sortOrder')
      ? { sortOrder: categorySortOrder(body.sortOrder) }
      : {}),
    ...(Object.hasOwn(body, 'isActive') ? { isActive: body.isActive as boolean } : {}),
    reason: moderationReason(body.reason, false),
  }
}

function dataOrThrow<T>(result: {
  data?: T | null
  error?: { message?: string, code?: string, details?: string | null, hint?: string | null } | null
}): T | null {
  if (result.error) throw new OrganizationForumDatabaseError(result.error)
  return result.data ?? null
}

export function mapOrganizationForumModerationContext(input: unknown): ForumModerationContext {
  const row = asRecord(input)
  return {
    canModerate: booleanValue(row.can_moderate ?? row.canModerate),
    canManageCategories: booleanValue(row.can_manage_categories ?? row.canManageCategories),
    isForumAdmin: booleanValue(row.is_forum_admin ?? row.isForumAdmin),
    isOrganizationAdmin: booleanValue(row.is_organization_admin ?? row.isOrganizationAdmin),
    roleLabel: stringValue(row, 'role_label', 'roleLabel') ?? null,
  }
}

function mapHiddenItem(input: unknown, targetType: 'thread' | 'post'): ForumModerationHiddenItem {
  const row = asRecord(input)
  const author = asRecord(row.author)
  const hiddenBy = asRecord(row.hidden_by ?? row.hiddenBy)
  const id = stringValue(row, targetType === 'post' ? 'post_id' : 'thread_id', 'id') ?? ''
  const title = stringValue(row, 'title', 'thread_title', 'threadTitle') ?? ''
  return {
    targetType,
    id,
    threadId: stringValue(row, 'thread_id', 'threadId') ?? (targetType === 'thread' ? id : ''),
    ...(targetType === 'post' ? { postId: id } : {}),
    title,
    ...(targetType === 'post' ? { threadTitle: title } : {}),
    excerpt: stringValue(row, 'excerpt') ?? '',
    author: mapOrganizationForumAuthor(author, row),
    hiddenAt: stringValue(row, 'hidden_at', 'hiddenAt') ?? '',
    hiddenBy: Object.keys(hiddenBy).length
      ? mapOrganizationForumAuthor(hiddenBy)
      : null,
    reason: stringValue(row, 'reason', 'hidden_reason', 'hiddenReason') ?? null,
  }
}

export function mapOrganizationForumModerationItems(
  input: unknown,
): ForumModerationItemsPayload {
  const row = asRecord(input)
  const hiddenThreads = recordArray(row.hidden_threads ?? row.hiddenThreads)
    .map(item => mapHiddenItem(item, 'thread'))
  const hiddenPosts = recordArray(row.hidden_posts ?? row.hiddenPosts)
    .map(item => mapHiddenItem(item, 'post'))
  return {
    hiddenThreads,
    hiddenPosts,
    total: integerValue(row.total) ?? hiddenThreads.length + hiddenPosts.length,
  }
}

export async function getOrganizationForumModerationContext(
  dataApi: DataApiClient,
  organizationId: string,
): Promise<ForumModerationContext> {
  const result = await dataApi.rpc('get_organization_forum_moderation_context', {
    p_organization_id: organizationId,
  })
  return mapOrganizationForumModerationContext(dataOrThrow(result))
}

export async function listOrganizationForumModerationItems(
  dataApi: DataApiClient,
  organizationId: string,
  limit: number,
): Promise<ForumModerationItemsPayload> {
  const result = await dataApi.rpc('list_organization_forum_moderation_items', {
    p_organization_id: organizationId,
    p_limit: limit,
  })
  return mapOrganizationForumModerationItems(dataOrThrow(result))
}

export async function moderateOrganizationForumThread(
  dataApi: DataApiClient,
  organizationId: string,
  threadId: string,
  input: ForumThreadModerationInput,
): Promise<ForumThreadModerationPayload> {
  const result = await dataApi.rpc('moderate_organization_forum_thread', {
    p_organization_id: organizationId,
    p_thread_id: threadId,
    p_action: input.action,
    p_reason: input.reason,
    p_category_id: input.categoryId,
  })
  const row = asRecord(dataOrThrow(result))
  return {
    changed: booleanValue(row.changed),
    auditEventId: stringValue(row, 'audit_event_id', 'auditEventId') ?? null,
    thread: mapOrganizationForumThreadSummary(row.thread),
  }
}

export async function moderateOrganizationForumPost(
  dataApi: DataApiClient,
  organizationId: string,
  postId: string,
  input: ForumPostModerationInput,
): Promise<ForumPostModerationPayload> {
  const result = await dataApi.rpc('moderate_organization_forum_post', {
    p_organization_id: organizationId,
    p_post_id: postId,
    p_action: input.action,
    p_reason: input.reason,
  })
  const row = asRecord(dataOrThrow(result))
  return {
    changed: booleanValue(row.changed),
    auditEventId: stringValue(row, 'audit_event_id', 'auditEventId') ?? null,
    post: mapOrganizationForumPost(row.post),
    thread: mapOrganizationForumThreadSummary(row.thread),
  }
}

export async function listOrganizationForumCategories(
  dataApi: DataApiClient,
  organizationId: string,
): Promise<ForumCategoriesPayload> {
  const result = await dataApi.rpc('list_organization_forum_categories', {
    p_organization_id: organizationId,
  })
  const row = asRecord(dataOrThrow(result))
  return {
    categories: recordArray(row.categories).map(mapOrganizationForumCategory),
  }
}

export async function createOrganizationForumCategory(
  dataApi: DataApiClient,
  organizationId: string,
  input: ForumCategoryCreateInput,
): Promise<ForumCategoryMutationPayload> {
  const result = await dataApi.rpc('create_organization_forum_category', {
    p_organization_id: organizationId,
    p_slug: input.slug,
    p_name: input.name,
    p_description: input.description,
    p_icon: input.icon,
    p_color: input.color,
    p_sort_order: input.sortOrder,
    p_reason: input.reason,
  })
  const row = asRecord(dataOrThrow(result))
  return {
    changed: booleanValue(row.changed),
    auditEventId: stringValue(row, 'audit_event_id', 'auditEventId') ?? null,
    category: mapOrganizationForumCategory(row.category),
  }
}

export async function updateOrganizationForumCategory(
  dataApi: DataApiClient,
  organizationId: string,
  categoryId: string,
  input: ForumCategoryUpdateInput,
): Promise<ForumCategoryMutationPayload> {
  const result = await dataApi.rpc('update_organization_forum_category', {
    p_organization_id: organizationId,
    p_category_id: categoryId,
    p_set_slug: input.slug !== undefined,
    p_slug: input.slug ?? null,
    p_set_name: input.name !== undefined,
    p_name: input.name ?? null,
    p_set_description: input.description !== undefined,
    p_description: input.description ?? null,
    p_set_icon: input.icon !== undefined,
    p_icon: input.icon ?? null,
    p_set_color: input.color !== undefined,
    p_color: input.color ?? null,
    p_set_sort_order: input.sortOrder !== undefined,
    p_sort_order: input.sortOrder ?? null,
    p_set_is_active: input.isActive !== undefined,
    p_is_active: input.isActive ?? null,
    p_reason: input.reason,
  })
  const row = asRecord(dataOrThrow(result))
  return {
    changed: booleanValue(row.changed),
    auditEventId: stringValue(row, 'audit_event_id', 'auditEventId') ?? null,
    category: mapOrganizationForumCategory(row.category),
  }
}
