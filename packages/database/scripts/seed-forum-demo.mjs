import { Client } from 'pg'
import {
  demoNamespace,
  forumCategorySeeds,
  forumThreadSeeds,
  isoOffset,
  metadataFor,
  stableUuid,
} from './demo-crm.mjs'

const defaultOrganizationSlug = 'openexpert-local'
const qaOrganizationSlug = 'qa-flow-149284-13aa5272'
const allowedOrganizationSlugs = new Set([
  defaultOrganizationSlug,
  qaOrganizationSlug,
])
const forumAdminReason =
  'Demo: moderacja forum ekspertów i zarządzanie kategoriami.'

const seedAuthorKeys = ['admin', 'anna-nowak', 'piotr-zielinski', 'marta-wojcik']

const localAuthorSeeds = [
  {
    key: 'admin',
    email: 'admin@openexpert.local',
    membershipRole: 'admin',
  },
  {
    key: 'anna-nowak',
    email: 'anna.nowak@openexpert.local',
    fullName: 'Anna Nowak',
    membershipRole: 'expert',
  },
  {
    key: 'piotr-zielinski',
    email: 'piotr.zielinski@openexpert.local',
    fullName: 'Piotr Zieliński',
    membershipRole: 'expert',
  },
  {
    key: 'marta-wojcik',
    email: 'marta.wojcik@openexpert.local',
    fullName: 'Marta Wójcik',
    membershipRole: 'expert',
  },
]

const requiredRelations = [
  'public.organizations',
  'public.users',
  'public.organization_memberships',
  'public.organization_user_admin_roles',
  'public.administrative_roles',
  'public.forum_categories',
  'public.forum_threads',
  'public.forum_posts',
  'public.forum_search_documents',
  'public.forum_embedding_jobs',
  'public.forum_realtime_state',
]

function usage() {
  return `Usage:
  pnpm --filter @openexpert/database db:seed-forum-demo -- --organization openexpert-local
  pnpm --filter @openexpert/database db:seed-forum-demo -- --apply --organization openexpert-local --confirm openexpert-local
  pnpm --filter @openexpert/database db:seed-forum-demo -- --apply --organization qa-flow-149284-13aa5272 --confirm qa-flow-149284-13aa5272

The command is read-only by default. Persistent writes require all three apply flags
shown above and are intentionally limited to approved demo and QA organizations.`
}

function parseArguments(argv) {
  const parsed = {
    apply: false,
    confirm: null,
    help: false,
    organization: defaultOrganizationSlug,
    organizationWasExplicit: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--apply') {
      parsed.apply = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      parsed.help = true
      continue
    }
    if (argument === '--organization' || argument === '--confirm') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`)
      }
      index += 1
      if (argument === '--organization') {
        parsed.organization = value
        parsed.organizationWasExplicit = true
      }
      else {
        parsed.confirm = value
      }
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  if (!allowedOrganizationSlugs.has(parsed.organization)) {
    throw new Error(
      `This seeder is restricted to approved demo and QA organizations`,
    )
  }
  if (!parsed.apply && parsed.confirm !== null) {
    throw new Error('--confirm is only valid together with --apply')
  }
  if (parsed.apply && (
    !parsed.organizationWasExplicit
    || parsed.confirm !== parsed.organization
  )) {
    throw new Error(
      `Applying requires --organization ${parsed.organization} --confirm ${parsed.organization}`,
    )
  }

  return parsed
}

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function assertSingleRow(result, message) {
  if (result.rowCount !== 1) throw new Error(message)
  return result.rows[0]
}

function seedId(organizationSlug, key) {
  return stableUuid(`forum:${organizationSlug}:${key}`)
}

function seedEntities(organizationSlug) {
  const categories = forumCategorySeeds.map((seed, index) => ({
    ...seed,
    id: seedId(organizationSlug, `category:${seed.slug}`),
    sortOrder: (index + 1) * 10,
  }))
  const threads = forumThreadSeeds.map(seed => ({
    ...seed,
    id: seedId(organizationSlug, `thread:${seed.key}`),
  }))
  const posts = threads.flatMap((thread) => {
    const question = {
      id: seedId(organizationSlug, `post:${thread.key}:question`),
      key: `${thread.key}:question`,
      threadId: thread.id,
      authorKey: thread.authorKey,
      kind: 'question',
      body: thread.body,
      verified: false,
      official: false,
      accepted: false,
      dayOffset: -thread.daysAgo,
    }
    const replies = thread.replies.map(reply => ({
      id: seedId(organizationSlug, `post:${thread.key}:reply:${reply.key}`),
      key: `${thread.key}:reply:${reply.key}`,
      threadId: thread.id,
      authorKey: reply.authorKey,
      kind: 'reply',
      body: reply.body,
      verified: reply.verified === true,
      official: reply.official === true,
      accepted: reply.accepted === true,
      dayOffset: -thread.daysAgo + reply.daysAfter,
    }))
    return [question, ...replies]
  })

  return { categories, threads, posts }
}

function assertSeedShape(entities) {
  if (entities.categories.length !== 5) {
    throw new Error(`Expected 5 forum categories, got ${entities.categories.length}`)
  }
  if (entities.threads.length !== 6) {
    throw new Error(`Expected 6 forum threads, got ${entities.threads.length}`)
  }
  if (entities.posts.length !== 16) {
    throw new Error(`Expected 16 forum posts, got ${entities.posts.length}`)
  }

  const categorySlugs = new Set(entities.categories.map(seed => seed.slug))
  const authorKeys = new Set(seedAuthorKeys)
  const allIds = [
    ...entities.categories.map(seed => seed.id),
    ...entities.threads.map(seed => seed.id),
    ...entities.posts.map(seed => seed.id),
  ]
  if (new Set(allIds).size !== allIds.length) {
    throw new Error('The deterministic forum seed UUIDs are not unique')
  }

  for (const thread of entities.threads) {
    if (!categorySlugs.has(thread.categorySlug)) {
      throw new Error(`Unknown category ${thread.categorySlug} in ${thread.key}`)
    }
    if (!authorKeys.has(thread.authorKey)) {
      throw new Error(`Unknown author ${thread.authorKey} in ${thread.key}`)
    }
    for (const reply of thread.replies) {
      if (!authorKeys.has(reply.authorKey)) {
        throw new Error(`Unknown reply author ${reply.authorKey} in ${thread.key}`)
      }
    }
  }
}

async function assertRequiredSchema(database) {
  const relations = await database.query(
    `select requested, to_regclass(requested)::text as relation
       from unnest($1::text[]) as requested`,
    [requiredRelations],
  )
  const missing = relations.rows
    .filter(row => row.relation === null)
    .map(row => row.requested)
  if (missing.length > 0) {
    throw new Error(`Required forum migrations are missing: ${missing.join(', ')}`)
  }

  const forumRole = await database.query(
    `select role_key
       from public.administrative_roles
      where role_key = 'forum_admin'`,
  )
  if (forumRole.rowCount !== 1) {
    throw new Error('The forum_admin administrative role is missing')
  }
}

async function resolveOrganization(database, slug) {
  return assertSingleRow(
    await database.query(
      `select id::text, slug, name
         from public.organizations
        where slug = $1
        for share`,
      [slug],
    ),
    `Expected exactly one organization with slug ${slug}`,
  )
}

async function resolveAuthors(database, organizationId, organizationSlug) {
  if (organizationSlug === qaOrganizationSlug) {
    const result = await database.query(
      `select membership.user_id::text as id,
              membership.role as membership_role
         from public.organization_memberships as membership
        where membership.organization_id = $1::uuid`,
      [organizationId],
    )
    const members = result.rows
    const administrator = members.find(member => member.membership_role === 'admin')
    const seedAuthors = [...members].sort((left, right) => (
      Number(right.membership_role === 'expert') - Number(left.membership_role === 'expert')
      || left.id.localeCompare(right.id)
    ))

    if (!administrator || seedAuthors.length < 3) {
      throw new Error(
        `QA forum seed requires one administrator and three organization members in ${organizationSlug}`,
      )
    }

    return new Map([
      ['admin', administrator],
      ['anna-nowak', seedAuthors[0]],
      ['piotr-zielinski', seedAuthors[1]],
      ['marta-wojcik', seedAuthors[2]],
    ])
  }

  const emails = localAuthorSeeds.map(seed => seed.email)
  const result = await database.query(
    `select app_user.id::text,
            lower(btrim(app_user.email)) as email,
            app_user.full_name,
            membership.role as membership_role
       from public.users as app_user
       join public.organization_memberships as membership
         on membership.organization_id = $1::uuid
        and membership.user_id = app_user.id
      where lower(btrim(app_user.email)) = any($2::text[])
      for share of app_user, membership`,
    [organizationId, emails],
  )

  const authorByKey = new Map()
  for (const seed of localAuthorSeeds) {
    const matches = result.rows.filter(row => row.email === seed.email)
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one ${seed.email} membership in ${defaultOrganizationSlug}`,
      )
    }
    const author = matches[0]
    if (author.membership_role !== seed.membershipRole) {
      throw new Error(
        `${seed.email} must have the ${seed.membershipRole} organization role`,
      )
    }
    if (seed.fullName && author.full_name !== seed.fullName) {
      throw new Error(`${seed.email} must have the exact name ${seed.fullName}`)
    }
    authorByKey.set(seed.key, author)
  }
  return authorByKey
}

async function assertDeterministicIdOwnership(
  database,
  organizationId,
  entities,
) {
  const checks = [
    {
      label: 'category',
      table: 'public.forum_categories',
      expected: new Map(entities.categories.map(seed => [seed.id, seed.slug])),
      query: `select id::text, organization_id::text, slug as seed_identity
                from public.forum_categories
               where id = any($1::uuid[])
               for share`,
    },
    {
      label: 'thread',
      table: 'public.forum_threads',
      expected: new Map(entities.threads.map(seed => [seed.id, seed.key])),
      query: `select id::text,
                     organization_id::text,
                     metadata ->> 'demo_seed_key' as seed_identity,
                     metadata ->> 'demo_seed_namespace' as seed_namespace
                from public.forum_threads
               where id = any($1::uuid[])
               for share`,
    },
    {
      label: 'post',
      table: 'public.forum_posts',
      expected: new Map(entities.posts.map(seed => [seed.id, seed.key])),
      expectedThreads: new Map(entities.posts.map(seed => [seed.id, seed.threadId])),
      query: `select id::text,
                     organization_id::text,
                     thread_id::text,
                     metadata ->> 'demo_seed_key' as seed_identity,
                     metadata ->> 'demo_seed_namespace' as seed_namespace
                from public.forum_posts
               where id = any($1::uuid[])
               for share`,
    },
  ]

  for (const check of checks) {
    const rows = await database.query(check.query, [[...check.expected.keys()]])
    for (const row of rows.rows) {
      if (row.organization_id !== organizationId) {
        throw new Error(
          `Refusing to reuse deterministic ${check.label} UUID ${row.id} from another organization`,
        )
      }
      if (row.seed_identity !== check.expected.get(row.id)) {
        throw new Error(
          `Deterministic ${check.label} UUID ${row.id} belongs to different content`,
        )
      }
      if ('seed_namespace' in row && row.seed_namespace !== demoNamespace) {
        throw new Error(
          `Deterministic ${check.label} UUID ${row.id} has a different seed namespace`,
        )
      }
      if (check.expectedThreads && row.thread_id !== check.expectedThreads.get(row.id)) {
        throw new Error(
          `Deterministic post UUID ${row.id} belongs to a different thread`,
        )
      }
    }
  }
}

async function assertExistingSeedIdentity(database, organizationId, entities) {
  const checks = [
    {
      label: 'thread',
      table: 'public.forum_threads',
      expected: new Map(entities.threads.map(seed => [seed.key, seed.id])),
    },
    {
      label: 'post',
      table: 'public.forum_posts',
      expected: new Map(entities.posts.map(seed => [seed.key, seed.id])),
    },
  ]

  for (const check of checks) {
    const result = await database.query(
      `select id::text, metadata ->> 'demo_seed_key' as seed_key
         from ${check.table}
        where organization_id = $1::uuid
          and metadata ->> 'demo_seed_namespace' = $2
        for share`,
      [organizationId, demoNamespace],
    )
    const seenKeys = new Set()
    for (const row of result.rows) {
      const expectedId = check.expected.get(row.seed_key)
      if (!expectedId) {
        throw new Error(
          `Unexpected ${check.label} ${row.seed_key ?? '(without key)'} uses ${demoNamespace}`,
        )
      }
      if (seenKeys.has(row.seed_key)) {
        throw new Error(`Duplicate seeded ${check.label} key ${row.seed_key}`)
      }
      if (row.id !== expectedId) {
        throw new Error(
          `Seeded ${check.label} ${row.seed_key} has a non-deterministic UUID`,
        )
      }
      seenKeys.add(row.seed_key)
    }
  }
}

async function assertSeedThreadContentSafety(database, organizationId, entities) {
  const threadIds = entities.threads.map(seed => seed.id)
  const expectedQuestionByThread = new Map(
    entities.posts
      .filter(seed => seed.kind === 'question')
      .map(seed => [seed.threadId, seed.id]),
  )
  const posts = await database.query(
    `select id::text,
            thread_id::text,
            kind,
            is_accepted_answer,
            metadata ->> 'demo_seed_namespace' as seed_namespace
       from public.forum_posts
      where organization_id = $1::uuid
        and thread_id = any($2::uuid[])
        and (kind = 'question' or is_accepted_answer)
      for share`,
    [organizationId, threadIds],
  )

  for (const post of posts.rows) {
    if (
      post.kind === 'question'
      && post.id !== expectedQuestionByThread.get(post.thread_id)
    ) {
      throw new Error(
        `A seeded thread ${post.thread_id} already contains a non-seed question`,
      )
    }
    if (post.is_accepted_answer && post.seed_namespace !== demoNamespace) {
      throw new Error(
        `A seeded thread ${post.thread_id} has a non-seed accepted answer`,
      )
    }
  }
}

async function currentSeedCounts(database, organizationId, entities) {
  const result = assertSingleRow(
    await database.query(
      `select
         (select count(*)::integer
            from public.forum_categories
           where organization_id = $1::uuid
             and slug = any($2::text[])) as categories,
         (select count(*)::integer
            from public.forum_threads
           where organization_id = $1::uuid
             and metadata ->> 'demo_seed_namespace' = $3
             and metadata ->> 'demo_seed_kind' = 'forum_thread') as threads,
         (select count(*)::integer
            from public.forum_posts
           where organization_id = $1::uuid
             and metadata ->> 'demo_seed_namespace' = $3
             and metadata ->> 'demo_seed_kind' = 'forum_post') as posts,
         (select count(*)::integer
            from public.forum_posts
           where organization_id = $1::uuid
             and kind = 'reply'
             and metadata ->> 'demo_seed_namespace' = $3
             and metadata ->> 'demo_seed_kind' = 'forum_post') as replies,
         (select count(*)::integer
            from public.forum_search_documents as document
            join public.forum_posts as post
              on post.organization_id = document.organization_id
             and post.id = document.post_id
           where post.organization_id = $1::uuid
             and post.metadata ->> 'demo_seed_namespace' = $3
             and post.metadata ->> 'demo_seed_kind' = 'forum_post') as search_documents,
         (select count(*)::integer
            from public.organization_user_admin_roles
           where organization_id = $1::uuid
             and role_key = 'forum_admin'
             and user_id = $4::uuid) as anna_forum_admin`,
      [
        organizationId,
        entities.categories.map(seed => seed.slug),
        demoNamespace,
        entities.authorByKey.get('anna-nowak').id,
      ],
    ),
    'Could not count the forum demo seed',
  )
  return {
    categories: result.categories,
    threads: result.threads,
    posts: result.posts,
    replies: result.replies,
    searchDocuments: result.search_documents,
    annaForumAdmin: result.anna_forum_admin,
  }
}

async function upsertCategories(database, organizationId, ownerUserId, entities) {
  const categoryBySlug = new Map()
  for (const seed of entities.categories) {
    const category = assertSingleRow(
      await database.query(
        `insert into public.forum_categories (
           id,
           organization_id,
           slug,
           name,
           description,
           icon,
           color,
           sort_order,
           is_active,
           created_by_user_id
         ) values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, true, $9::uuid)
         on conflict (organization_id, slug) do update set
           name = excluded.name,
           description = excluded.description,
           icon = excluded.icon,
           color = excluded.color,
           sort_order = excluded.sort_order,
           is_active = true,
           created_by_user_id = excluded.created_by_user_id
         returning id::text, slug`,
        [
          seed.id,
          organizationId,
          seed.slug,
          seed.name,
          seed.description,
          seed.icon,
          seed.color,
          seed.sortOrder,
          ownerUserId,
        ],
      ),
      `Could not upsert forum category ${seed.slug}`,
    )
    categoryBySlug.set(category.slug, category.id)
  }
  return categoryBySlug
}

async function upsertThreadsAndPosts({
  authorByKey,
  categoryBySlug,
  database,
  entities,
  organizationId,
  seedNow,
}) {
  const postsByThread = new Map()
  for (const post of entities.posts) {
    const posts = postsByThread.get(post.threadId) ?? []
    posts.push(post)
    postsByThread.set(post.threadId, posts)
  }

  for (const thread of entities.threads) {
    const categoryId = categoryBySlug.get(thread.categorySlug)
    const author = authorByKey.get(thread.authorKey)
    if (!categoryId || !author) {
      throw new Error(`Forum thread ${thread.key} has invalid seed references`)
    }

    await database.query(
      `insert into public.forum_threads (
         id,
         organization_id,
         category_id,
         author_user_id,
         thread_type,
         status,
         title,
         language_code,
         visibility,
         metadata,
         is_hidden,
         hidden_at,
         hidden_by_user_id,
         hidden_reason,
         created_at,
         last_activity_at
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8,
         'organization', $9::jsonb, false, null, null, null, $10::timestamptz,
         $10::timestamptz
       )
       on conflict (id) do update set
         category_id = excluded.category_id,
         author_user_id = excluded.author_user_id,
         thread_type = excluded.thread_type,
         status = excluded.status,
         title = excluded.title,
         language_code = excluded.language_code,
         visibility = excluded.visibility,
         metadata = excluded.metadata,
         is_hidden = false,
         hidden_at = null,
         hidden_by_user_id = null,
         hidden_reason = null`,
      [
        thread.id,
        organizationId,
        categoryId,
        author.id,
        thread.type,
        thread.status,
        thread.title,
        thread.languageCode,
        JSON.stringify(metadataFor(thread.key, { demo_seed_kind: 'forum_thread' })),
        isoOffset(seedNow, -thread.daysAgo),
      ],
    )

    await database.query(
      `update public.forum_posts
          set is_accepted_answer = false
        where organization_id = $1::uuid
          and thread_id = $2::uuid
          and is_accepted_answer
          and metadata ->> 'demo_seed_namespace' = $3`,
      [organizationId, thread.id, demoNamespace],
    )

    for (const post of postsByThread.get(thread.id) ?? []) {
      const postAuthor = authorByKey.get(post.authorKey)
      if (!postAuthor) throw new Error(`Unknown forum post author ${post.authorKey}`)
      const isExpert = postAuthor.membership_role === 'expert'
      const isAdministrator = postAuthor.membership_role === 'admin'
      const verified = post.verified && isExpert
      const official = isAdministrator && (post.official || post.accepted)
      const accepted = post.accepted && (verified || official)
      await database.query(
        `insert into public.forum_posts (
           id,
           organization_id,
           thread_id,
           author_user_id,
           kind,
           content,
           is_verified_expert_answer,
           is_official_admin_answer,
           is_accepted_answer,
           metadata,
           is_hidden,
           hidden_at,
           hidden_by_user_id,
           hidden_reason,
           created_at
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9,
           $10::jsonb, false, null, null, null, $11::timestamptz
         )
         on conflict (id) do update set
           thread_id = excluded.thread_id,
           author_user_id = excluded.author_user_id,
           kind = excluded.kind,
           content = excluded.content,
           is_verified_expert_answer = excluded.is_verified_expert_answer,
           is_official_admin_answer = excluded.is_official_admin_answer,
           is_accepted_answer = excluded.is_accepted_answer,
           metadata = excluded.metadata,
           is_hidden = false,
           hidden_at = null,
           hidden_by_user_id = null,
           hidden_reason = null`,
        [
          post.id,
          organizationId,
          thread.id,
          postAuthor.id,
          post.kind,
          post.body,
          verified,
          official,
          accepted,
          JSON.stringify(metadataFor(post.key, { demo_seed_kind: 'forum_post' })),
          isoOffset(seedNow, post.dayOffset),
        ],
      )
    }

    await database.query(
      `update public.forum_threads
          set status = $3
        where organization_id = $1::uuid
          and id = $2::uuid`,
      [organizationId, thread.id, thread.status],
    )
  }
}

async function assignForumAdministrator(
  database,
  organizationId,
  ownerUserId,
  annaUserId,
) {
  await database.query(
    `insert into public.organization_user_admin_roles (
       organization_id,
       user_id,
       role_key,
       assigned_by_user_id,
       reason
     ) values ($1::uuid, $2::uuid, 'forum_admin', $3::uuid, $4)
     on conflict (organization_id, user_id, role_key) do update set
       assigned_by_user_id = excluded.assigned_by_user_id,
       reason = excluded.reason`,
    [organizationId, annaUserId, ownerUserId, forumAdminReason],
  )
}

function assertFinalCounts(counts) {
  const expected = {
    categories: 5,
    threads: 6,
    posts: 16,
    replies: 10,
    searchDocuments: 16,
    annaForumAdmin: 1,
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (counts[key] !== expectedValue) {
      throw new Error(
        `Forum demo verification failed for ${key}: expected ${expectedValue}, got ${counts[key]}`,
      )
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  const entities = seedEntities(options.organization)
  assertSeedShape(entities)

  const database = new Client({
    connectionString: requiredEnvironment('DATABASE_URL'),
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    application_name: 'openexpert-forum-demo-seeder',
  })

  await database.connect()
  let transactionOpen = false
  try {
    await database.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    transactionOpen = true
    await database.query('SET LOCAL lock_timeout = 5000')
    await database.query('SET LOCAL statement_timeout = 30000')
    await database.query(
      `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`forum-demo-seed:${options.organization}`],
    )

    await assertRequiredSchema(database)
    const organization = await resolveOrganization(database, options.organization)
    const authorByKey = await resolveAuthors(
      database,
      organization.id,
      options.organization,
    )
    entities.authorByKey = authorByKey
    await assertDeterministicIdOwnership(
      database,
      organization.id,
      entities,
    )
    await assertExistingSeedIdentity(database, organization.id, entities)
    await assertSeedThreadContentSafety(database, organization.id, entities)

    const before = await currentSeedCounts(database, organization.id, entities)
    if (!options.apply) {
      await database.query('ROLLBACK')
      transactionOpen = false
      console.log(JSON.stringify({
        mode: 'dry-run',
        organization: organization.slug,
        preflight: 'passed',
        current: before,
        target: {
          categories: entities.categories.length,
          threads: entities.threads.length,
          posts: entities.posts.length,
          replies: entities.posts.filter(post => post.kind === 'reply').length,
          forumAdministrator: 'Anna Nowak',
        },
      }, null, 2))
      return
    }

    const ownerUserId = authorByKey.get('admin').id
    const categoryBySlug = await upsertCategories(
      database,
      organization.id,
      ownerUserId,
      entities,
    )
    await upsertThreadsAndPosts({
      authorByKey,
      categoryBySlug,
      database,
      entities,
      organizationId: organization.id,
      seedNow: new Date(),
    })
    await assignForumAdministrator(
      database,
      organization.id,
      ownerUserId,
      authorByKey.get('anna-nowak').id,
    )

    const after = await currentSeedCounts(database, organization.id, entities)
    assertFinalCounts(after)
    await database.query('COMMIT')
    transactionOpen = false

    console.log(JSON.stringify({
      mode: 'apply',
      organization: organization.slug,
      verification: 'passed',
      before,
      after,
    }, null, 2))
  }
  catch (error) {
    if (transactionOpen) {
      try {
        await database.query('ROLLBACK')
      }
      catch {
        // Preserve the original error while still attempting a safe rollback.
      }
    }
    throw error
  }
  finally {
    await database.end()
  }
}

main().catch((error) => {
  console.error(`Forum demo seed failed: ${error?.message ?? String(error)}`)
  process.exitCode = 1
})
