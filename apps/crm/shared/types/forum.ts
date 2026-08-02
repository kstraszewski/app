export type ForumThreadType = 'question' | 'discussion'

export type ForumThreadStatus = 'open' | 'answered' | 'resolved' | 'closed'

export type ForumSearchMode = 'browse' | 'lexical' | 'hybrid'

export type ForumAuthorRole = 'expert' | 'admin' | 'member'

export type ForumMatchLocation = 'title' | 'question' | 'reply'

export interface ForumCategory {
  id: string
  slug: string
  name: string
  description?: string | null
  icon?: string | null
  color?: string | null
  sortOrder?: number
  isActive?: boolean
  threadCount?: number
  createdAt?: string
  updatedAt?: string | null
}

export interface ForumAuthor {
  id: string
  name: string
  avatarUrl?: string | null
  role: ForumAuthorRole
  roleLabel?: string | null
  expertise?: string | null
}

export interface ForumSource {
  id: string
  title: string
  kind?: 'internal' | 'external' | 'other'
  url?: string | null
  label?: string | null
}

export interface ForumPost {
  id: string
  threadId?: string
  kind: 'question' | 'reply'
  content: string
  /** Compatibility alias for endpoints exposing the agreed `body` field. */
  body?: string
  author: ForumAuthor
  isVerifiedExpertAnswer?: boolean
  isOfficialAdminAnswer?: boolean
  isAcceptedAnswer?: boolean
  isHidden?: boolean
  hiddenAt?: string | null
  hiddenReason?: string | null
  hiddenBy?: ForumAuthor | null
  createdAt: string
  updatedAt?: string | null
  sources?: ForumSource[]
}

export interface ForumThreadSummary {
  id: string
  title: string
  type: ForumThreadType
  status: ForumThreadStatus
  category: Pick<ForumCategory, 'id' | 'slug' | 'name' | 'icon' | 'color'>
  categoryId?: string
  excerpt: string
  author: ForumAuthor
  replyCount: number
  participantCount?: number
  viewCount?: number
  createdAt: string
  updatedAt?: string | null
  lastActivityAt: string
  acceptedPostId?: string | null
  hasVerifiedExpertAnswer?: boolean
  hasOfficialAdminAnswer?: boolean
  matchedIn?: ForumMatchLocation | ForumMatchLocation[] | null
  snippet?: string | null
  score?: number | null
  languageCode?: string
  visibility?: 'organization'
  isHidden?: boolean
  hiddenAt?: string | null
  hiddenReason?: string | null
  hiddenBy?: ForumAuthor | null
}

export interface ForumThread extends ForumThreadSummary {
  content: string
  /** Compatibility alias for endpoints exposing the agreed `body` field. */
  body?: string
  posts?: ForumPost[]
  relatedThreads?: ForumThreadSummary[]
}

export interface ForumThreadListPayload {
  categories: ForumCategory[]
  threads: ForumThreadSummary[]
  searchMode: ForumSearchMode
  query?: string | null
  total: number
}

export interface ForumThreadDetailPayload {
  thread: ForumThread
  posts?: ForumPost[]
  relatedThreads?: ForumThreadSummary[]
}

export interface ForumCreateThreadInput {
  type: ForumThreadType
  title: string
  body: string
  categoryId: string
  languageCode: string
  visibility: 'organization'
  clientRequestId?: string | null
}

export interface ForumCreateThreadPayload {
  thread: ForumThread | ForumThreadSummary
}

export interface ForumCreateReplyInput {
  body: string
  clientRequestId?: string | null
}

export interface ForumCreateReplyPayload {
  post: ForumPost
  thread?: ForumThread | ForumThreadSummary
}

export type ForumRealtimeEventKind =
  | 'thread.created'
  | 'thread.updated'
  | 'reply.created'
  | 'post.created'
  | 'post.updated'
  | 'category.created'
  | 'category.updated'

export interface ForumRealtimeEvent {
  schemaVersion: 1
  eventId: string
  kind: ForumRealtimeEventKind
  organizationId: string
  revision: number
  threadId?: string
  postId?: string
  categoryId?: string
  occurredAt: string
}

export interface ForumRealtimeSnapshot {
  revision: number
  lastEvent: ForumRealtimeEvent | null
  updatedAt: string | null
}

export interface ForumRealtimeTransport {
  mode: 'ably' | 'polling'
  channel: string | null
  pollIntervalMs: number
}

export interface ForumRealtimeBootstrapPayload extends ForumRealtimeSnapshot {
  realtime: ForumRealtimeTransport
}

export type ForumRealtimeConnectionState =
  | 'connecting'
  | 'connected'
  | 'polling'
  | 'offline'
