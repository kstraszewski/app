import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAnonymousDataApiClient,
  createAuthenticatedDataApiClient,
  PostgrestError,
} from '../src/index.ts'

interface CapturedRequest {
  init?: RequestInit
  url: URL
}

const statusTexts: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  406: 'Not Acceptable',
  409: 'Conflict',
  503: 'Service Unavailable',
}

function response(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const payload = status === 204 || body === undefined
    ? null
    : typeof body === 'string'
      ? body
      : JSON.stringify(body)
  return new Response(payload, {
    headers: {
      ...(payload === null ? {} : { 'content-type': 'application/json' }),
      ...Object.fromEntries(new Headers(headers)),
    },
    status,
    statusText: statusTexts[status] ?? '',
  })
}

function recorder(
  createResponse: (
    request: CapturedRequest,
    call: number,
  ) => Response | Promise<Response>,
): { calls: CapturedRequest[], fetch: typeof globalThis.fetch } {
  const calls: CapturedRequest[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = {
      init,
      url: new URL(input instanceof Request ? input.url : String(input)),
    }
    calls.push(request)
    return createResponse(request, calls.length)
  }
  return { calls, fetch }
}

function requestHeaders(request: CapturedRequest): Headers {
  return new Headers(request.init?.headers)
}

test('authenticated client injects a fresh bearer token and normalizes paths', async () => {
  let tokenCalls = 0
  const recorded = recorder(() => response([{ id: 'profile-1' }]))
  const client = createAuthenticatedDataApiClient(
    'http://127.0.0.1:55325/api/',
    async () => {
      tokenCalls += 1
      return 'signed-jwt'
    },
    { fetch: recorded.fetch, retry: false },
  )

  const result = await client.from('profiles').select('id').eq('id', 'profile-1')

  assert.equal(result.error, null)
  assert.deepEqual(result.data, [{ id: 'profile-1' }])
  assert.equal(tokenCalls, 1)
  assert.equal(recorded.calls.length, 1)
  const request = recorded.calls[0]!
  assert.equal(request.url.origin, 'http://127.0.0.1:55325')
  assert.equal(request.url.pathname, '/api/profiles')
  assert.equal(request.url.searchParams.get('select'), 'id')
  assert.equal(request.url.searchParams.get('id'), 'eq.profile-1')
  assert.equal(requestHeaders(request).get('authorization'), 'Bearer signed-jwt')
  assert.equal(requestHeaders(request).get('accept-profile'), 'public')
  assert.equal(request.init?.redirect, 'error')
})

test('encoded relation names cannot escape the configured Data API origin', async () => {
  const recorded = recorder(() => response([]))
  const client = createAuthenticatedDataApiClient(
    'https://data.example.test/rest/v1',
    () => 'origin-bound-token',
    { fetch: recorded.fetch, retry: false },
  )

  await client.from('//attacker.example/records').select()

  const request = recorded.calls[0]!
  assert.equal(request.url.origin, 'https://data.example.test')
  assert.match(request.url.pathname, /%2F%2Fattacker\.example%2Frecords$/u)
  assert.equal(
    requestHeaders(request).get('authorization'),
    'Bearer origin-bound-token',
  )
})

test('anonymous client preserves custom headers and uses the selected schema', async () => {
  const recorded = recorder(() => response([]))
  const client = createAnonymousDataApiClient('http://127.0.0.1:55325', {
    fetch: recorded.fetch,
    headers: { 'x-client-info': 'openexpert-test' },
    retry: false,
    schema: 'directory',
  })

  await client.from('facilities').select('id')

  const headers = requestHeaders(recorded.calls[0]!)
  assert.equal(headers.get('authorization'), null)
  assert.equal(headers.get('x-client-info'), 'openexpert-test')
  assert.equal(headers.get('accept-profile'), 'directory')
  assert.equal(headers.get('content-profile'), null)
})

test('read builder serializes filters, modifiers, embedded options, and counts', async () => {
  const recorded = recorder(() => response(
    [{ id: 7 }],
    200,
    { 'content-range': '10-19/42' },
  ))
  const client = createAnonymousDataApiClient('https://data.example.test', {
    fetch: recorded.fetch,
    retry: false,
  })

  const result = await client
    .from('records')
    .select(' id, profile:profiles ( "display name" ) ', { count: 'exact' })
    .eq('id', 7)
    .neq('state', 'archived')
    .gt('score', 1)
    .gte('rank', 2)
    .lt('age', 90)
    .lte('attempts', 3)
    .is('deleted_at', null)
    .in('label', ['plain', 'A,B', 'plain'])
    .like('code', 'OE%')
    .ilike('name', '%expert%')
    .contains('metadata', { active: true })
    .contains('tags', ['one', 'two'])
    .containedBy('permissions', ['read', 'write'])
    .overlaps('busy_period', '[2026-07-31,2026-08-01)')
    .filter('reviewed_at', 'not.is', null)
    .not('status', 'in', '(done,cancelled)')
    .or('kind.eq.one,kind.eq.two', { referencedTable: 'children' })
    .match({ active: true, ignored: undefined })
    .textSearch('search_document', 'mortgage advisor', {
      config: 'simple',
      type: 'websearch',
    })
    .order('created_at', { ascending: false, nullsFirst: false })
    .order('id')
    .order('position', { referencedTable: 'children' })
    .limit(50)
    .range(10, 19)
    .range(2, 4, { referencedTable: 'children' })

  assert.equal(result.error, null)
  assert.equal(result.count, 42)
  const request = recorded.calls[0]!
  const query = request.url.searchParams
  assert.equal(query.get('select'), 'id,profile:profiles("display name")')
  assert.equal(query.get('id'), 'eq.7')
  assert.equal(query.get('state'), 'neq.archived')
  assert.equal(query.get('score'), 'gt.1')
  assert.equal(query.get('rank'), 'gte.2')
  assert.equal(query.get('age'), 'lt.90')
  assert.equal(query.get('attempts'), 'lte.3')
  assert.equal(query.get('deleted_at'), 'is.null')
  assert.equal(query.get('label'), 'in.(plain,"A,B")')
  assert.equal(query.get('code'), 'like.OE%')
  assert.equal(query.get('name'), 'ilike.%expert%')
  assert.deepEqual(query.getAll('metadata'), ['cs.{"active":true}'])
  assert.deepEqual(query.getAll('tags'), ['cs.{one,two}'])
  assert.equal(query.get('permissions'), 'cd.{read,write}')
  assert.equal(query.get('busy_period'), 'ov.[2026-07-31,2026-08-01)')
  assert.equal(query.get('reviewed_at'), 'not.is.null')
  assert.equal(query.get('status'), 'not.in.(done,cancelled)')
  assert.equal(query.get('children.or'), '(kind.eq.one,kind.eq.two)')
  assert.equal(query.get('active'), 'eq.true')
  assert.equal(query.has('ignored'), false)
  assert.equal(query.get('search_document'), 'wfts(simple).mortgage advisor')
  assert.equal(query.get('order'), 'created_at.desc.nullslast,id.asc')
  assert.equal(query.get('children.order'), 'position.asc')
  assert.equal(query.get('offset'), '10')
  assert.equal(query.get('limit'), '10')
  assert.equal(query.get('children.offset'), '2')
  assert.equal(query.get('children.limit'), '3')
  assert.equal(requestHeaders(request).get('prefer'), 'count=exact')
})

test('insert sends JSON, array columns, schema, preferences, and a single result', async () => {
  const recorded = recorder(() => response({ id: '1' }, 201))
  const client = createAnonymousDataApiClient('https://data.example.test', {
    fetch: recorded.fetch,
    retry: false,
    schema: 'tenant',
  })

  const result = await client
    .from('records')
    .insert(
      [{ id: 1n, name: 'One' }, { id: 2n, optional: true }],
      { count: 'exact', defaultToNull: false },
    )
    .select('id')
    .single()

  assert.deepEqual(result.data, { id: '1' })
  const request = recorded.calls[0]!
  const headers = requestHeaders(request)
  assert.equal(request.init?.method, 'POST')
  assert.equal(headers.get('content-type'), 'application/json')
  assert.equal(headers.get('content-profile'), 'tenant')
  assert.equal(headers.get('accept-profile'), null)
  assert.equal(headers.get('accept'), 'application/vnd.pgrst.object+json')
  assert.equal(headers.get('prefer'), 'count=exact,missing=default,return=representation')
  assert.equal(request.url.searchParams.get('select'), 'id')
  assert.equal(request.url.searchParams.get('columns'), '"id","name","optional"')
  assert.deepEqual(JSON.parse(String(request.init?.body)), [
    { id: '1', name: 'One' },
    { id: '2', optional: true },
  ])
})

test('upsert, update, and delete use the expected methods and preferences', async () => {
  const recorded = recorder((_request, call) => (
    call === 2 ? response([{ id: 'one', active: false }]) : response(undefined, 204)
  ))
  const client = createAnonymousDataApiClient('https://data.example.test', {
    fetch: recorded.fetch,
    retry: false,
  })

  await client.from('records').upsert(
    [{ id: 'one', label: 'First' }],
    {
      count: 'planned',
      defaultToNull: false,
      ignoreDuplicates: true,
      onConflict: 'id,tenant_id',
    },
  )
  const updated = await client
    .from('records')
    .update({ active: false })
    .eq('id', 'one')
    .select('id,active')
    .maybeSingle()
  await client.from('records').delete({ count: 'estimated' }).eq('id', 'two')

  assert.deepEqual(updated.data, { id: 'one', active: false })

  const upsert = recorded.calls[0]!
  assert.equal(upsert.init?.method, 'POST')
  assert.equal(upsert.url.searchParams.get('on_conflict'), 'id,tenant_id')
  assert.equal(upsert.url.searchParams.get('columns'), '"id","label"')
  assert.equal(
    requestHeaders(upsert).get('prefer'),
    'resolution=ignore-duplicates,count=planned,missing=default',
  )

  const update = recorded.calls[1]!
  assert.equal(update.init?.method, 'PATCH')
  assert.equal(update.url.searchParams.get('id'), 'eq.one')
  assert.equal(requestHeaders(update).get('prefer'), 'return=representation')
  assert.deepEqual(JSON.parse(String(update.init?.body)), { active: false })

  const deletion = recorded.calls[2]!
  assert.equal(deletion.init?.method, 'DELETE')
  assert.equal(deletion.url.searchParams.get('id'), 'eq.two')
  assert.equal(requestHeaders(deletion).get('prefer'), 'count=estimated')
})

test('RPC supports POST, read-only GET, and object-safe HEAD semantics', async () => {
  const recorded = recorder((_request, call) => (
    call === 1 ? response({ created: true }) : response(undefined, 204)
  ))
  const client = createAnonymousDataApiClient('https://data.example.test', {
    fetch: recorded.fetch,
    retry: false,
    schema: 'private_api',
  })

  await client.rpc('create_record', { name: 'One', flags: ['a', 'b'] })
  await client.rpc(
    'find_records',
    { ids: ['one', 'two'], query: 'active', skipped: undefined },
    { count: 'planned', get: true },
  )
  await client.rpc(
    'count_records',
    { criteria: { active: true } },
    { count: 'exact', head: true },
  )

  const post = recorded.calls[0]!
  assert.equal(post.init?.method, 'POST')
  assert.equal(post.url.pathname, '/rpc/create_record')
  assert.deepEqual(JSON.parse(String(post.init?.body)), {
    flags: ['a', 'b'],
    name: 'One',
  })
  assert.equal(requestHeaders(post).get('content-profile'), 'private_api')

  const get = recorded.calls[1]!
  assert.equal(get.init?.method, 'GET')
  assert.equal(get.url.searchParams.get('ids'), '{one,two}')
  assert.equal(get.url.searchParams.get('query'), 'active')
  assert.equal(get.url.searchParams.has('skipped'), false)
  assert.equal(requestHeaders(get).get('accept-profile'), 'private_api')
  assert.equal(requestHeaders(get).get('prefer'), 'count=planned')

  const headWithObject = recorded.calls[2]!
  assert.equal(headWithObject.init?.method, 'POST')
  assert.deepEqual(JSON.parse(String(headWithObject.init?.body)), {
    criteria: { active: true },
  })
  assert.equal(
    requestHeaders(headWithObject).get('prefer'),
    'return=minimal,count=exact',
  )
})

test('head requests return total count without reading a body', async () => {
  const recorded = recorder(() => response(undefined, 200, {
    'content-range': '*/137',
  }))
  const client = createAnonymousDataApiClient('https://data.example.test', {
    fetch: recorded.fetch,
    retry: false,
  })

  const result = await client
    .from('records')
    .select('id', { count: 'exact', head: true })

  assert.equal(recorded.calls[0]!.init?.method, 'HEAD')
  assert.equal(result.data, null)
  assert.equal(result.count, 137)
})

test('maybeSingle enforces zero-or-one cardinality client-side', async () => {
  const recorded = recorder((_request, call) => {
    if (call === 1) return response([])
    if (call === 2) return response([{ id: 'one' }])
    return response([{ id: 'one' }, { id: 'two' }])
  })
  const client = createAnonymousDataApiClient('https://data.example.test', {
    fetch: recorded.fetch,
    retry: false,
  })

  const empty = await client.from('records').select().maybeSingle()
  const one = await client.from('records').select().maybeSingle()
  const many = await client.from('records').select().maybeSingle()

  assert.equal(empty.data, null)
  assert.deepEqual(one.data, { id: 'one' })
  assert.equal(many.data, null)
  assert.equal(many.error?.code, 'PGRST116')
  assert.equal(many.status, 406)
})

test('HTTP errors are returned by default and thrown on request', async () => {
  const databaseError = {
    code: '23505',
    details: 'Key already exists',
    hint: null,
    message: 'duplicate key value violates unique constraint',
  }
  const recorded = recorder(() => response(databaseError, 409))
  const client = createAnonymousDataApiClient('https://data.example.test', {
    fetch: recorded.fetch,
    retry: false,
  })

  const result = await client.from('records').insert({ id: 'duplicate' })
  assert.equal(result.data, null)
  assert.deepEqual(result.error, databaseError)
  assert.equal(result.status, 409)
  assert.equal(result.statusText, 'Conflict')

  await assert.rejects(
    async () => await client
      .from('records')
      .insert({ id: 'duplicate' })
      .throwOnError(),
    (error: unknown) => {
      assert.ok(error instanceof PostgrestError)
      assert.equal(error.code, '23505')
      assert.equal(error.details, 'Key already exists')
      return true
    },
  )
})

test('network and abort failures retain the standard result shape', async () => {
  const networkClient = createAnonymousDataApiClient('https://data.example.test', {
    fetch: async () => { throw new TypeError('connection failed') },
    retry: false,
  })
  const networkResult = await networkClient.from('records').select()

  assert.equal(networkResult.data, null)
  assert.equal(networkResult.count, null)
  assert.equal(networkResult.status, 0)
  assert.equal(networkResult.statusText, '')
  assert.match(networkResult.error?.message ?? '', /connection failed/u)

  const controller = new AbortController()
  controller.abort()
  const abortClient = createAnonymousDataApiClient('https://data.example.test', {
    fetch: async (_input, init) => {
      assert.equal(init?.signal?.aborted, true)
      throw new DOMException('aborted', 'AbortError')
    },
    retry: false,
  })
  const aborted = await abortClient
    .from('records')
    .select()
    .abortSignal(controller.signal)
  assert.equal(aborted.status, 0)
  assert.match(aborted.error?.hint ?? '', /aborted/u)
})

test('idempotent reads retry transient responses and mark later attempts', async () => {
  const recorded = recorder((_request, call) => (
    call === 1
      ? response({ message: 'try later' }, 503, { 'retry-after': '0' })
      : response([{ id: 'ready' }])
  ))
  const client = createAnonymousDataApiClient('https://data.example.test', {
    fetch: recorded.fetch,
  })

  const result = await client.from('records').select('id')

  assert.deepEqual(result.data, [{ id: 'ready' }])
  assert.equal(recorded.calls.length, 2)
  assert.equal(requestHeaders(recorded.calls[0]!).get('x-retry-count'), null)
  assert.equal(requestHeaders(recorded.calls[1]!).get('x-retry-count'), '1')
})

test('returns and overrideTypes are runtime no-ops with useful static types', async () => {
  const recorded = recorder(() => response([{ id: 'one', name: 'One' }]))
  const client = createAnonymousDataApiClient('https://data.example.test', {
    fetch: recorded.fetch,
    retry: false,
  })

  const result = await client
    .from('records')
    .select('id,name')
    .returns<Array<{ id: string }>>()
    .overrideTypes<Array<{ id: string, name: string }>, { merge: false }>()

  const typed: Array<{ id: string, name: string }> | null = result.data
  assert.deepEqual(typed, [{ id: 'one', name: 'One' }])
})

test('rejects invalid Data API URLs and empty protocol paths', () => {
  assert.throws(
    () => createAnonymousDataApiClient('file:///tmp/database'),
    /must use http or https/u,
  )
  const client = createAnonymousDataApiClient('https://data.example.test')
  assert.throws(() => client.from('   '), /non-empty/u)
  assert.throws(() => client.rpc(''), /non-empty/u)
})
