import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOrganizationForumReply,
  createOrganizationForumThread,
  getOrganizationForumThread,
  listOrganizationForumThreads,
  mapOrganizationForumThreadDetailPayload,
  mapOrganizationForumThreadListPayload,
  loadOrganizationForumRealtimeSnapshot,
  mapOrganizationForumRealtimeSnapshot,
  organizationForumDocumentEmbeddingInput,
  organizationForumEmbeddingDimensions,
  organizationForumQueryEmbeddingInput,
  organizationForumSourceSha256,
  parseOrganizationForumCreateReplyInput,
  parseOrganizationForumCreateThreadInput,
  parseOrganizationForumListInput,
  parseOrganizationForumThreadId,
  processOrganizationForumEmbeddingJobs,
} from '../server/utils/organization-forum.ts'

const categoryId = '00000000-0000-4000-8000-000000000001'
const threadId = '00000000-0000-4000-8000-000000000002'
const postId = '00000000-0000-4000-8000-000000000003'
const authorId = '00000000-0000-4000-8000-000000000004'
const requestId = '00000000-0000-4000-8000-000000000005'
const embeddingJobId = '00000000-0000-4000-8000-000000000006'
const embeddingDocumentId = '00000000-0000-4000-8000-000000000007'

test('parses and bounds forum list filters', () => {
  assert.deepEqual(parseOrganizationForumListInput({
    q: '  dochód   B2B  ',
    category: categoryId,
    status: 'answered',
    type: 'question',
    limit: '4',
  }), {
    query: 'dochód B2B',
    categoryId,
    status: 'answered',
    type: 'question',
    limit: 4,
  })

  assert.deepEqual(parseOrganizationForumListInput({}), {
    query: null,
    categoryId: null,
    status: null,
    type: null,
    limit: 20,
  })
  assert.throws(() => parseOrganizationForumListInput({ q: 'ab' }), /between 3 and 200/)
  assert.throws(() => parseOrganizationForumListInput({ status: 'draft' }), /status is invalid/)
  assert.throws(() => parseOrganizationForumListInput({ limit: 51 }), /between 1 and 50/)
})

test('validates thread and reply mutations using the shared camelCase contract', () => {
  assert.deepEqual(parseOrganizationForumCreateThreadInput({
    type: 'question',
    title: '  Jak rozliczyć   dochód z B2B? ',
    body: '  Potrzebuję pomocy przy analizie dochodu z działalności.  ',
    categoryId,
    languageCode: 'pl',
    visibility: 'organization',
    clientRequestId: requestId,
  }), {
    type: 'question',
    title: 'Jak rozliczyć dochód z B2B?',
    body: 'Potrzebuję pomocy przy analizie dochodu z działalności.',
    categoryId,
    languageCode: 'pl',
    visibility: 'organization',
    clientRequestId: requestId,
  })

  assert.deepEqual(parseOrganizationForumCreateReplyInput({
    body: '  Bank przyjmuje średnią z ostatnich 12 miesięcy. ',
  }), {
    body: 'Bank przyjmuje średnią z ostatnich 12 miesięcy.',
    clientRequestId: null,
  })
  assert.equal(parseOrganizationForumThreadId(threadId.toUpperCase()), threadId)
  assert.throws(() => parseOrganizationForumCreateThreadInput({}), /type is required/)
  assert.throws(() => parseOrganizationForumCreateReplyInput({ body: '' }), /between 2 and 12000/)
})

test('maps a camelCase list payload without leaking unrecognized database fields', () => {
  const payload = mapOrganizationForumThreadListPayload({
    searchMode: 'hybrid',
    query: 'dochód B2B',
    total: 1,
    categories: [{
      id: categoryId,
      slug: 'dochody',
      name: 'Dochody',
      icon: 'i-lucide-wallet-cards',
      color: 'success',
      sortOrder: 10,
      threadCount: 7,
    }],
    threads: [{
      id: threadId,
      title: 'Jak rozliczyć dochód z B2B?',
      type: 'question',
      status: 'answered',
      category: {
        id: categoryId,
        slug: 'dochody',
        name: 'Dochody',
        icon: 'i-lucide-wallet-cards',
        color: 'success',
      },
      excerpt: 'Treść pytania',
      author: { id: authorId, name: 'Anna Ekspert', role: 'expert' },
      replyCount: 3,
      participantCount: 2,
      viewCount: 14,
      createdAt: '2026-08-01T08:00:00.000Z',
      lastActivityAt: '2026-08-02T09:00:00.000Z',
      hasVerifiedExpertAnswer: true,
      matchedIn: 'reply',
      snippet: 'Bank przyjmuje średnią…',
      score: 0.031,
      internalNotes: 'must not leak',
    }],
  })

  assert.equal(payload.searchMode, 'hybrid')
  assert.equal(payload.categories[0]?.threadCount, 7)
  assert.equal(payload.categories[0]?.isActive, true)
  assert.equal(payload.threads[0]?.author.name, 'Anna Ekspert')
  assert.equal(payload.threads[0]?.matchedIn, 'reply')
  assert.equal(JSON.stringify(payload).includes('must not leak'), false)
})

test('maps a snake_case thread detail with posts and related threads', () => {
  const payload = mapOrganizationForumThreadDetailPayload({
    thread: {
      thread_id: threadId,
      title: 'Dokumenty do dochodu z B2B',
      thread_type: 'discussion',
      thread_status: 'open',
      category_id: categoryId,
      category_slug: 'dochody',
      category_name: 'Dochody',
      question_body: 'Jakie dokumenty są wymagane?',
      author_user_id: authorId,
      author_name: 'Adam Doradca',
      author_role: 'expert',
      reply_count: 1,
      created_at: '2026-08-01T08:00:00.000Z',
      last_activity_at: '2026-08-02T09:00:00.000Z',
    },
    posts: [{
      post_id: postId,
      thread_id: threadId,
      post_kind: 'reply',
      body: 'Najczęściej KPiR i wyciągi bankowe.',
      author_user_id: authorId,
      author_name: 'Adam Doradca',
      author_role: 'expert',
      is_verified_expert_answer: true,
      created_at: '2026-08-02T09:00:00.000Z',
    }],
    related_threads: [],
  })

  assert.equal(payload.thread.id, threadId)
  assert.equal(payload.thread.body, 'Jakie dokumenty są wymagane?')
  assert.equal(payload.posts?.[0]?.body, 'Najczęściej KPiR i wyciągi bankowe.')
  assert.equal(payload.posts?.[0]?.isVerifiedExpertAnswer, true)
})

test('maps and loads the durable forum realtime cursor without exposing content', async () => {
  const organizationId = '00000000-0000-4000-8000-000000000008'
  const eventId = '00000000-0000-4000-8000-000000000009'
  const rawSnapshot = {
    revision: '17',
    lastEvent: {
      schemaVersion: 1,
      eventId,
      kind: 'reply.created',
      organizationId,
      threadId,
      postId,
      revision: 17,
      occurredAt: '2026-08-02T12:00:00.000Z',
      body: 'must not leak',
    },
    updatedAt: '2026-08-02T12:00:00.000Z',
  }
  const calls: Array<{ name: string, args: Record<string, unknown> }> = []
  const dataApi = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      return { data: rawSnapshot, error: null }
    },
  }

  const mapped = mapOrganizationForumRealtimeSnapshot(rawSnapshot)
  const loaded = await loadOrganizationForumRealtimeSnapshot(dataApi, organizationId)
  assert.deepEqual(loaded, mapped)
  assert.equal(mapped.revision, 17)
  assert.equal(mapped.lastEvent?.kind, 'reply.created')
  assert.equal(JSON.stringify(mapped).includes('must not leak'), false)
  assert.deepEqual(calls, [{
    name: 'get_organization_forum_realtime_state',
    args: { p_organization_id: organizationId },
  }])
})

test('builds stable asymmetric Gemini retrieval inputs and checksums', () => {
  const document = organizationForumDocumentEmbeddingInput(
    'Dochód B2B',
    'Bank analizuje ostatnie 12 miesięcy.',
  )
  assert.equal(document, 'title: Dochód B2B | text: Bank analizuje ostatnie 12 miesięcy.')
  assert.equal(
    organizationForumQueryEmbeddingInput(' dochód przedsiębiorcy '),
    'task: search result | query: dochód przedsiębiorcy',
  )
  assert.equal(organizationForumSourceSha256(document).length, 64)
  assert.equal(organizationForumSourceSha256(document), organizationForumSourceSha256(document))
})

test('calls the aggregate list RPC with tenant filters and the optional query vector', async () => {
  const calls: Array<{ name: string, args: Record<string, unknown> }> = []
  const dataApi = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      return {
        data: {
          categories: [],
          threads: [],
          searchMode: 'hybrid',
          query: 'dochód B2B',
          total: 0,
        },
        error: null,
      }
    },
  }
  const vector = [0.1, 0.2, 0.3]
  const payload = await listOrganizationForumThreads(dataApi, categoryId, {
    query: 'dochód B2B',
    categoryId,
    status: 'answered',
    type: 'question',
    limit: 4,
  }, vector)

  assert.equal(payload.searchMode, 'hybrid')
  assert.deepEqual(calls, [{
    name: 'list_organization_forum_threads',
    args: {
      p_organization_id: categoryId,
      p_query: 'dochód B2B',
      p_query_embedding: vector,
      p_category_id: categoryId,
      p_status: 'answered',
      p_thread_type: 'question',
      p_limit: 4,
    },
  }])
})

test('calls detail and mutation RPCs with camelCase input mapped to SQL arguments', async () => {
  const calls: Array<{ name: string, args: Record<string, unknown> }> = []
  const thread = {
    id: threadId,
    title: 'Jak rozliczyć dochód z B2B?',
    type: 'question',
    status: 'open',
    category: { id: categoryId, slug: 'dochody', name: 'Dochody' },
    excerpt: 'Pytanie',
    content: 'Pytanie o dochód przedsiębiorcy.',
    author: { id: authorId, name: 'Anna Ekspert', role: 'expert' },
    replyCount: 0,
    createdAt: '2026-08-01T08:00:00.000Z',
    lastActivityAt: '2026-08-01T08:00:00.000Z',
  }
  const dataApi = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      if (name === 'create_organization_forum_reply') {
        return {
          data: {
            post: {
              id: postId,
              threadId,
              kind: 'reply',
              content: 'Odpowiedź eksperta.',
              author: { id: authorId, name: 'Anna Ekspert', role: 'expert' },
              createdAt: '2026-08-02T08:00:00.000Z',
            },
            thread,
          },
          error: null,
        }
      }
      return { data: { thread, posts: [], relatedThreads: [] }, error: null }
    },
  }

  await getOrganizationForumThread(dataApi, categoryId, threadId)
  await createOrganizationForumThread(dataApi, categoryId, {
    type: 'question',
    title: thread.title,
    body: thread.content,
    categoryId,
    languageCode: 'pl',
    visibility: 'organization',
    clientRequestId: requestId,
  })
  await createOrganizationForumReply(dataApi, categoryId, threadId, {
    body: 'Odpowiedź eksperta.',
    clientRequestId: requestId,
  })

  assert.deepEqual(calls.map(call => call.name), [
    'get_organization_forum_thread',
    'create_organization_forum_thread',
    'create_organization_forum_reply',
  ])
  assert.equal(calls[1]?.args.p_thread_type, 'question')
  assert.equal(calls[1]?.args.p_client_request_id, requestId)
  assert.equal(calls[2]?.args.p_thread_id, threadId)
  assert.equal(calls[2]?.args.p_body, 'Odpowiedź eksperta.')
})

test('claims, embeds and completes a forum embedding job using the leased worker identity', async () => {
  const calls: Array<{ name: string, args: Record<string, unknown> }> = []
  const title = 'Dochód B2B'
  const content = 'Bank analizuje ostatnie 12 miesięcy.'
  const source = organizationForumDocumentEmbeddingInput(title, content)
  const vector = Array.from({ length: organizationForumEmbeddingDimensions }, () => 0.125)
  const dataApi = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      if (name === 'claim_forum_embedding_jobs') {
        return {
          data: [{
            id: embeddingJobId,
            organization_id: categoryId,
            document_id: embeddingDocumentId,
            source_sha256: organizationForumSourceSha256(source),
            source_revision: 1,
            attempts: 1,
            max_attempts: 6,
            title,
            content,
            model: 'gemini-embedding-2',
            dimensions: organizationForumEmbeddingDimensions,
            recipe_version: 'forum-search-v1',
          }],
          error: null,
        }
      }
      return { data: { status: 'completed' }, error: null }
    },
  }
  const embeddedValues: string[][] = []

  const result = await processOrganizationForumEmbeddingJobs({
    backendData: dataApi,
    googleApiKey: 'test-api-key',
    workerId: 'forum:test-worker',
    limit: 1,
    async embedValues(values) {
      embeddedValues.push(values)
      return [vector]
    },
  })

  assert.deepEqual(result, {
    claimed: 1,
    completed: 1,
    failed: 0,
    outcomes: [{ jobId: embeddingJobId, status: 'completed' }],
  })
  assert.deepEqual(embeddedValues, [[source]])
  assert.deepEqual(calls.map(call => call.name), [
    'claim_forum_embedding_jobs',
    'complete_forum_embedding_job',
  ])
  assert.deepEqual(calls[0]?.args, {
    p_worker_id: 'forum:test-worker',
    p_limit: 1,
    p_lock_timeout: '5 minutes',
  })
  assert.equal(calls[1]?.args.p_job_id, embeddingJobId)
  assert.equal(calls[1]?.args.p_worker_id, 'forum:test-worker')
  assert.equal(calls[1]?.args.p_embedding, vector)
})

test('retries a claimed forum embedding job when the provider batch fails', async () => {
  const calls: Array<{ name: string, args: Record<string, unknown> }> = []
  const title = 'Procedura bankowa'
  const content = 'Wymagane są dokumenty dochodowe.'
  const source = organizationForumDocumentEmbeddingInput(title, content)
  const dataApi = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      if (name === 'claim_forum_embedding_jobs') {
        return {
          data: [{
            id: embeddingJobId,
            organization_id: categoryId,
            document_id: embeddingDocumentId,
            source_sha256: organizationForumSourceSha256(source),
            source_revision: 2,
            attempts: 2,
            max_attempts: 6,
            title,
            content,
            model: 'gemini-embedding-2',
            dimensions: organizationForumEmbeddingDimensions,
            recipe_version: 'forum-search-v1',
          }],
          error: null,
        }
      }
      return { data: { status: 'failed' }, error: null }
    },
  }

  const result = await processOrganizationForumEmbeddingJobs({
    backendData: dataApi,
    googleApiKey: 'test-api-key',
    workerId: 'forum:test-worker',
    async embedValues() {
      throw new Error('temporary provider outage')
    },
  })

  assert.equal(result.claimed, 1)
  assert.equal(result.completed, 0)
  assert.equal(result.failed, 1)
  assert.deepEqual(calls.map(call => call.name), [
    'claim_forum_embedding_jobs',
    'retry_forum_embedding_job',
  ])
  assert.equal(calls[1]?.args.p_job_id, embeddingJobId)
  assert.equal(calls[1]?.args.p_worker_id, 'forum:test-worker')
  assert.equal(calls[1]?.args.p_error, 'temporary provider outage')
  assert.match(String(calls[1]?.args.p_retry_delay), /^\d+ seconds$/u)
})
