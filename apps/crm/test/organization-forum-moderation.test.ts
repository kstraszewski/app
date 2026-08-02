import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createOrganizationForumCategory,
  getOrganizationForumModerationContext,
  listOrganizationForumModerationItems,
  mapOrganizationForumModerationContext,
  mapOrganizationForumModerationItems,
  moderateOrganizationForumPost,
  moderateOrganizationForumThread,
  parseOrganizationForumCategoryCreateInput,
  parseOrganizationForumCategoryUpdateInput,
  parseOrganizationForumModerationId,
  parseOrganizationForumModerationItemsInput,
  parseOrganizationForumPostModerationInput,
  parseOrganizationForumThreadModerationInput,
  updateOrganizationForumCategory,
} from '../server/utils/organization-forum-moderation.ts'
import {
  mapOrganizationForumPost,
  mapOrganizationForumThreadSummary,
} from '../server/utils/organization-forum.ts'

const organizationId = '00000000-0000-4000-8000-000000000001'
const threadId = '00000000-0000-4000-8000-000000000002'
const postId = '00000000-0000-4000-8000-000000000003'
const categoryId = '00000000-0000-4000-8000-000000000004'
const actorId = '00000000-0000-4000-8000-000000000005'
const auditEventId = '00000000-0000-4000-8000-000000000006'

test('parses strict thread and post moderation commands', () => {
  assert.deepEqual(parseOrganizationForumThreadModerationInput({
    action: 'hide',
    reason: '  Naruszenie zasad forum. ',
  }), {
    action: 'hide',
    reason: 'Naruszenie zasad forum.',
    categoryId: null,
  })
  assert.deepEqual(parseOrganizationForumThreadModerationInput({
    action: 'move',
    categoryId: categoryId.toUpperCase(),
  }), {
    action: 'move',
    reason: null,
    categoryId,
  })
  assert.deepEqual(parseOrganizationForumPostModerationInput({
    action: 'restore',
  }), {
    action: 'restore',
    reason: null,
  })

  assert.throws(
    () => parseOrganizationForumThreadModerationInput({ action: 'hide' }),
    /reason must contain between 5 and 1000/,
  )
  assert.throws(
    () => parseOrganizationForumThreadModerationInput({ action: 'move' }),
    /categoryId is required/,
  )
  assert.throws(
    () => parseOrganizationForumPostModerationInput({ action: 'delete' }),
    /hide or restore/,
  )
  assert.throws(
    () => parseOrganizationForumPostModerationInput({ action: 'restore', actorId }),
    /Unsupported field/,
  )
})

test('parses moderation IDs and hidden-items limits', () => {
  assert.equal(parseOrganizationForumModerationId(threadId.toUpperCase(), 'threadId'), threadId)
  assert.deepEqual(parseOrganizationForumModerationItemsInput({}), { limit: 50 })
  assert.deepEqual(parseOrganizationForumModerationItemsInput({ limit: '100' }), { limit: 100 })
  assert.throws(
    () => parseOrganizationForumModerationItemsInput({ limit: 101 }),
    /between 1 and 100/,
  )
})

test('accepts category create and partial update including explicit null clears', () => {
  assert.deepEqual(parseOrganizationForumCategoryCreateInput({
    slug: '  ryzyko-kredytowe ',
    name: ' Ryzyko   kredytowe ',
    description: '  Dyskusje o ocenie ryzyka. ',
    icon: 'i-lucide-shield-check',
    color: 'warning',
  }), {
    slug: 'ryzyko-kredytowe',
    name: 'Ryzyko kredytowe',
    description: 'Dyskusje o ocenie ryzyka.',
    icon: 'i-lucide-shield-check',
    color: 'warning',
    sortOrder: 100,
    reason: null,
  })

  assert.deepEqual(parseOrganizationForumCategoryUpdateInput({
    description: null,
    icon: null,
    color: null,
    isActive: false,
  }), {
    description: null,
    icon: null,
    color: null,
    isActive: false,
    reason: null,
  })
  assert.throws(
    () => parseOrganizationForumCategoryUpdateInput({ reason: 'Tylko notatka' }),
    /at least one mutable field/,
  )
  assert.throws(
    () => parseOrganizationForumCategoryCreateInput({ slug: 'Nie Poprawny', name: 'Nazwa' }),
    /slug must contain/,
  )
})

test('maps context and redacted hidden-item recovery payloads', () => {
  assert.deepEqual(mapOrganizationForumModerationContext({
    canModerate: true,
    canManageCategories: true,
    isForumAdmin: true,
    isOrganizationAdmin: false,
    roleLabel: 'Administrator forum',
  }), {
    canModerate: true,
    canManageCategories: true,
    isForumAdmin: true,
    isOrganizationAdmin: false,
    roleLabel: 'Administrator forum',
  })

  const payload = mapOrganizationForumModerationItems({
    hiddenThreads: [{
      targetType: 'thread',
      id: threadId,
      threadId,
      title: 'Ukryty temat',
      excerpt: 'Krótki fragment bez pełnej treści.',
      author: { id: actorId, name: 'Anna Nowak', role: 'expert' },
      hiddenAt: '2026-08-02T10:00:00.000Z',
      hiddenBy: { id: actorId, name: 'Anna Nowak', role: 'expert', roleLabel: 'Administrator forum' },
      reason: 'Naruszenie zasad forum.',
      fullContent: 'nie może wyciec przez mapper',
    }],
    hiddenPosts: [{
      targetType: 'post',
      id: postId,
      postId,
      threadId,
      threadTitle: 'Temat',
      title: 'Temat',
      excerpt: 'Krótki fragment odpowiedzi.',
      author: { id: actorId, name: 'Ekspert', role: 'expert' },
      hiddenAt: '2026-08-02T11:00:00.000Z',
      hiddenBy: null,
      reason: null,
    }],
    total: 2,
  })

  assert.equal(payload.hiddenThreads[0]?.hiddenBy?.roleLabel, 'Administrator forum')
  assert.equal(payload.hiddenPosts[0]?.postId, postId)
  assert.equal(JSON.stringify(payload).includes('nie może wyciec'), false)
})

test('forum detail mappers retain moderator-visible hidden state and public hider identity', () => {
  const hiddenBy = {
    id: actorId,
    name: 'Anna Nowak',
    role: 'expert',
    roleLabel: 'Administrator forum',
  }
  const post = mapOrganizationForumPost({
    id: postId,
    threadId,
    kind: 'reply',
    content: 'Ukryta odpowiedź.',
    author: { id: actorId, name: 'Ekspert', role: 'expert' },
    isHidden: true,
    hiddenAt: '2026-08-02T10:00:00.000Z',
    hiddenReason: 'Naruszenie zasad forum.',
    hiddenBy,
    createdAt: '2026-08-01T10:00:00.000Z',
  })
  const thread = mapOrganizationForumThreadSummary({
    id: threadId,
    title: 'Ukryty temat',
    type: 'question',
    status: 'open',
    category: { id: categoryId, slug: 'ogolne', name: 'Ogólne' },
    excerpt: 'Treść pytania.',
    author: { id: actorId, name: 'Ekspert', role: 'expert' },
    replyCount: 0,
    createdAt: '2026-08-01T10:00:00.000Z',
    lastActivityAt: '2026-08-01T10:00:00.000Z',
    isHidden: true,
    hiddenAt: '2026-08-02T10:00:00.000Z',
    hiddenReason: 'Naruszenie zasad forum.',
    hiddenBy,
  })

  assert.equal(post.isHidden, true)
  assert.equal(post.hiddenBy?.name, 'Anna Nowak')
  assert.equal(thread.isHidden, true)
  assert.equal(thread.hiddenReason, 'Naruszenie zasad forum.')
})

test('calls tenant-scoped moderation and category RPCs with normalized arguments', async () => {
  const calls: Array<{ name: string, args: Record<string, unknown> }> = []
  const thread = {
    id: threadId,
    title: 'Temat',
    type: 'question',
    status: 'closed',
    category: { id: categoryId, slug: 'ogolne', name: 'Ogólne' },
    excerpt: 'Pytanie',
    author: { id: actorId, name: 'Ekspert', role: 'expert' },
    replyCount: 0,
    createdAt: '2026-08-01T10:00:00.000Z',
    lastActivityAt: '2026-08-01T10:00:00.000Z',
    isHidden: true,
  }
  const post = {
    id: postId,
    threadId,
    kind: 'reply',
    content: 'Odpowiedź',
    author: { id: actorId, name: 'Ekspert', role: 'expert' },
    createdAt: '2026-08-01T11:00:00.000Z',
  }
  const category = {
    id: categoryId,
    slug: 'ogolne',
    name: 'Ogólne',
    sortOrder: 10,
    isActive: true,
  }
  const dataApi = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      if (name === 'get_organization_forum_moderation_context') {
        return { data: { canModerate: true, roleLabel: 'Administrator forum' }, error: null }
      }
      if (name === 'list_organization_forum_moderation_items') {
        return { data: { hiddenThreads: [], hiddenPosts: [], total: 0 }, error: null }
      }
      if (name === 'moderate_organization_forum_thread') {
        return { data: { changed: true, auditEventId, thread }, error: null }
      }
      if (name === 'moderate_organization_forum_post') {
        return { data: { changed: true, auditEventId, post, thread }, error: null }
      }
      return { data: { changed: true, auditEventId, category }, error: null }
    },
  }

  await getOrganizationForumModerationContext(dataApi, organizationId)
  await listOrganizationForumModerationItems(dataApi, organizationId, 25)
  await moderateOrganizationForumThread(dataApi, organizationId, threadId, {
    action: 'hide',
    reason: 'Naruszenie zasad forum.',
    categoryId: null,
  })
  await moderateOrganizationForumPost(dataApi, organizationId, postId, {
    action: 'restore',
    reason: null,
  })
  await createOrganizationForumCategory(dataApi, organizationId, {
    slug: 'ogolne',
    name: 'Ogólne',
    description: null,
    icon: null,
    color: null,
    sortOrder: 10,
    reason: null,
  })
  await updateOrganizationForumCategory(dataApi, organizationId, categoryId, {
    description: null,
    isActive: false,
    reason: 'Porządkowanie kategorii.',
  })

  assert.deepEqual(calls[2], {
    name: 'moderate_organization_forum_thread',
    args: {
      p_organization_id: organizationId,
      p_thread_id: threadId,
      p_action: 'hide',
      p_reason: 'Naruszenie zasad forum.',
      p_category_id: null,
    },
  })
  assert.deepEqual(calls[5], {
    name: 'update_organization_forum_category',
    args: {
      p_organization_id: organizationId,
      p_category_id: categoryId,
      p_set_slug: false,
      p_slug: null,
      p_set_name: false,
      p_name: null,
      p_set_description: true,
      p_description: null,
      p_set_icon: false,
      p_icon: null,
      p_set_color: false,
      p_color: null,
      p_set_sort_order: false,
      p_sort_order: null,
      p_set_is_active: true,
      p_is_active: false,
      p_reason: 'Porządkowanie kategorii.',
    },
  })
})
