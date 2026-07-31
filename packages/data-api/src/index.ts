export type AccessTokenProvider = () => Promise<string | null> | string | null

export type DataApiCountAlgorithm = 'exact' | 'planned' | 'estimated' | (string & {})

export interface DataApiError {
  code?: string
  details?: string | null
  hint?: string | null
  message: string
  [key: string]: unknown
}

export interface DataApiResponse<Result> {
  data: Result | null
  error: DataApiError | null
  count: number | null
  status: number
  statusText: string
}

export interface DataApiClientOptions {
  /** Neon Data API URL in production or a local PostgREST endpoint. */
  url: string
  accessToken?: AccessTokenProvider
  fetch?: typeof globalThis.fetch
  headers?: HeadersInit
  schema?: string
  timeout?: number
  retry?: boolean
}

interface PostgrestClientOptions {
  fetch?: typeof globalThis.fetch
  headers?: HeadersInit
  schema?: string
  timeout?: number
  retry?: boolean
}

interface SelectOptions {
  count?: DataApiCountAlgorithm
  head?: boolean
}

interface MutationOptions {
  count?: DataApiCountAlgorithm
}

interface InsertOptions extends MutationOptions {
  defaultToNull?: boolean
}

interface UpsertOptions extends InsertOptions {
  ignoreDuplicates?: boolean
  onConflict?: string
}

interface ReferencedTableOptions {
  /** Kept for compatibility with older callers. */
  foreignTable?: string
  referencedTable?: string
}

interface OrderOptions extends ReferencedTableOptions {
  ascending?: boolean
  nullsFirst?: boolean
}

interface TextSearchOptions {
  config?: string
  type?: 'plain' | 'phrase' | 'websearch'
}

interface RpcOptions extends SelectOptions {
  get?: boolean
}

type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PATCH' | 'DELETE'
type Cardinality = 'many' | 'single' | 'maybe-single'

interface QueryConfiguration {
  body?: unknown
  fetch: typeof globalThis.fetch
  headers: Headers
  method: HttpMethod
  retry: boolean
  schema?: string
  timeout: number
  url: URL
}

const RETRYABLE_METHODS = new Set<HttpMethod>(['GET', 'HEAD'])
const RETRYABLE_STATUSES = new Set([503, 520])
const MAX_RETRIES = 3
const RESERVED_LIST_VALUE = /[,()]/u

function normalizeDataApiUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('DATA_API_URL is required')

  const url = new URL(trimmed)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('DATA_API_URL must use http or https')
  }

  return url.toString().replace(/\/+$/u, '')
}

function assertPathSegment(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} must be a non-empty string`)
  return encodeURIComponent(trimmed)
}

function cleanColumns(columns = '*'): string {
  let quoted = false
  return columns
    .split('')
    .filter((character) => {
      if (character === '"') quoted = !quoted
      return quoted || !/\s/u.test(character)
    })
    .join('')
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  return String(value)
}

function jsonStringify(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => (
    typeof entry === 'bigint' ? entry.toString() : entry
  ))
}

function quoteListValue(value: unknown): string {
  const serialized = stringifyValue(value)
  if (typeof value !== 'string' || !RESERVED_LIST_VALUE.test(serialized)) {
    return serialized
  }
  return `"${serialized.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function collectionOperand(
  value: string | readonly unknown[] | Record<string, unknown>,
): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return `{${value.map(stringifyValue).join(',')}}`
  return jsonStringify(value)
}

function appendPreference(headers: Headers, directive: string): void {
  const name = directive.split('=', 1)[0]?.trim()
  const existing = (headers.get('prefer') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => !name || value.split('=', 1)[0]?.trim() !== name)
  existing.push(directive)
  headers.set('prefer', existing.join(','))
}

function appendCountPreference(
  headers: Headers,
  count: DataApiCountAlgorithm | undefined,
): void {
  if (count) appendPreference(headers, `count=${count}`)
}

function arrayColumns(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.flatMap(value => (
    value && typeof value === 'object' ? Object.keys(value) : []
  )))]
}

function parseCount(headers: Headers, response: Response): number | null {
  if (!/(?:^|,)\s*count=(?:exact|planned|estimated)(?:,|$)/u.test(
    headers.get('prefer') ?? '',
  )) return null

  const total = response.headers.get('content-range')?.split('/').at(-1)
  if (!total || total === '*') return null
  const parsed = Number.parseInt(total, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeError(value: unknown, fallback: string): DataApiError {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>
    return {
      ...source,
      message: typeof source.message === 'string' && source.message
        ? source.message
        : fallback,
    }
  }
  return { message: typeof value === 'string' && value ? value : fallback }
}

function networkError(error: unknown): DataApiError {
  const source = error as {
    code?: unknown
    message?: unknown
    name?: unknown
    stack?: unknown
  } | null
  const name = typeof source?.name === 'string' ? source.name : 'FetchError'
  const message = typeof source?.message === 'string'
    ? source.message
    : stringifyValue(error)
  const aborted = name === 'AbortError' || source?.code === 'ABORT_ERR'
  return {
    code: '',
    details: typeof source?.stack === 'string' ? source.stack : '',
    hint: aborted ? 'Request was aborted (timeout or manual cancellation)' : '',
    message: `${name}: ${message}`,
  }
}

function isAbortError(error: unknown): boolean {
  const source = error as { code?: unknown, name?: unknown } | null
  return source?.name === 'AbortError' || source?.code === 'ABORT_ERR'
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const timeout = setTimeout(done, milliseconds)
    function done() {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

function requestSignal(
  signal: AbortSignal | undefined,
  timeout: number,
): { cleanup: () => void, signal?: AbortSignal } {
  if ((!timeout || timeout <= 0) && !signal) return { cleanup: () => {} }

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const abort = () => controller.abort(signal?.reason)

  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  if (timeout > 0) timer = setTimeout(() => controller.abort(), timeout)

  return {
    signal: controller.signal,
    cleanup() {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    },
  }
}

function tokenFetch(
  dataApiUrl: string,
  accessToken: AccessTokenProvider | undefined,
  fetchImplementation: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const expectedOrigin = new URL(dataApiUrl).origin

  return async (input, init) => {
    const requestUrl = new URL(
      input instanceof Request ? input.url : String(input),
      dataApiUrl,
    )
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))

    if (requestUrl.origin === expectedOrigin && accessToken) {
      const token = await accessToken()
      if (token) headers.set('authorization', `Bearer ${token}`)
      else headers.delete('authorization')
    } else if (requestUrl.origin !== expectedOrigin) {
      headers.delete('authorization')
    }

    return fetchImplementation(input, {
      ...init,
      headers,
      redirect: 'error',
    })
  }
}

export class PostgrestError extends Error {
  code?: string
  details?: string | null
  hint?: string | null

  constructor(error: DataApiError) {
    super(error.message)
    this.name = 'PostgrestError'
    this.code = error.code
    this.details = error.details
    this.hint = error.hint
  }
}

export class DataApiQueryBuilder<Result = any, Throws extends boolean = false>
implements PromiseLike<DataApiResponse<Result>> {
  readonly #body?: unknown
  readonly #fetch: typeof globalThis.fetch
  readonly #headers: Headers
  readonly #method: HttpMethod
  readonly #schema?: string
  readonly #timeout: number
  readonly #url: URL
  #cardinality: Cardinality = 'many'
  #retry: boolean
  #shouldThrow = false
  #signal?: AbortSignal

  constructor(configuration: QueryConfiguration) {
    this.#body = configuration.body
    this.#fetch = configuration.fetch
    this.#headers = new Headers(configuration.headers)
    this.#method = configuration.method
    this.#retry = configuration.retry
    this.#schema = configuration.schema
    this.#timeout = configuration.timeout
    this.#url = new URL(configuration.url)
  }

  select(columns = '*', options: SelectOptions = {}): DataApiQueryBuilder<any[], Throws> {
    this.#url.searchParams.set('select', cleanColumns(columns))
    if (this.#method !== 'GET' && this.#method !== 'HEAD') {
      appendPreference(this.#headers, 'return=representation')
    }
    appendCountPreference(this.#headers, options.count)
    return this as unknown as DataApiQueryBuilder<any[], Throws>
  }

  eq(column: string, value: unknown): this {
    return this.filter(column, 'eq', value)
  }

  neq(column: string, value: unknown): this {
    return this.filter(column, 'neq', value)
  }

  gt(column: string, value: unknown): this {
    return this.filter(column, 'gt', value)
  }

  gte(column: string, value: unknown): this {
    return this.filter(column, 'gte', value)
  }

  lt(column: string, value: unknown): this {
    return this.filter(column, 'lt', value)
  }

  lte(column: string, value: unknown): this {
    return this.filter(column, 'lte', value)
  }

  is(column: string, value: boolean | null): this {
    return this.filter(column, 'is', value)
  }

  in(column: string, values: readonly unknown[]): this {
    const uniqueValues = [...new Set(values)].map(quoteListValue).join(',')
    this.#url.searchParams.append(column, `in.(${uniqueValues})`)
    return this
  }

  like(column: string, pattern: string): this {
    return this.filter(column, 'like', pattern)
  }

  ilike(column: string, pattern: string): this {
    return this.filter(column, 'ilike', pattern)
  }

  contains(
    column: string,
    value: string | readonly unknown[] | Record<string, unknown>,
  ): this {
    this.#url.searchParams.append(column, `cs.${collectionOperand(value)}`)
    return this
  }

  containedBy(
    column: string,
    value: string | readonly unknown[] | Record<string, unknown>,
  ): this {
    this.#url.searchParams.append(column, `cd.${collectionOperand(value)}`)
    return this
  }

  overlaps(column: string, value: string | readonly unknown[]): this {
    const operand = typeof value === 'string'
      ? value
      : `{${value.map(stringifyValue).join(',')}}`
    this.#url.searchParams.append(column, `ov.${operand}`)
    return this
  }

  filter(column: string, operator: string, value: unknown): this {
    this.#url.searchParams.append(column, `${operator}.${stringifyValue(value)}`)
    return this
  }

  not(column: string, operator: string, value: unknown): this {
    this.#url.searchParams.append(
      column,
      `not.${operator}.${stringifyValue(value)}`,
    )
    return this
  }

  or(filters: string, options: ReferencedTableOptions = {}): this {
    const referencedTable = options.referencedTable ?? options.foreignTable
    const key = referencedTable ? `${referencedTable}.or` : 'or'
    this.#url.searchParams.append(key, `(${filters})`)
    return this
  }

  match(values: Record<string, unknown>): this {
    for (const [column, value] of Object.entries(values)) {
      if (value !== undefined) this.eq(column, value)
    }
    return this
  }

  textSearch(
    column: string,
    query: string,
    options: TextSearchOptions = {},
  ): this {
    const prefix = options.type === 'plain'
      ? 'pl'
      : options.type === 'phrase'
        ? 'ph'
        : options.type === 'websearch'
          ? 'w'
          : ''
    const config = options.config ? `(${options.config})` : ''
    this.#url.searchParams.append(column, `${prefix}fts${config}.${query}`)
    return this
  }

  order(column: string, options: OrderOptions = {}): this {
    const referencedTable = options.referencedTable ?? options.foreignTable
    const key = referencedTable ? `${referencedTable}.order` : 'order'
    const direction = options.ascending === false ? 'desc' : 'asc'
    const nulls = options.nullsFirst === undefined
      ? ''
      : options.nullsFirst
        ? '.nullsfirst'
        : '.nullslast'
    const order = `${column}.${direction}${nulls}`
    const existing = this.#url.searchParams.get(key)
    this.#url.searchParams.set(key, existing ? `${existing},${order}` : order)
    return this
  }

  limit(rows: number, options: ReferencedTableOptions = {}): this {
    const referencedTable = options.referencedTable ?? options.foreignTable
    const key = referencedTable ? `${referencedTable}.limit` : 'limit'
    this.#url.searchParams.set(key, stringifyValue(rows))
    return this
  }

  range(from: number, to: number, options: ReferencedTableOptions = {}): this {
    const referencedTable = options.referencedTable ?? options.foreignTable
    const prefix = referencedTable ? `${referencedTable}.` : ''
    this.#url.searchParams.set(`${prefix}offset`, stringifyValue(from))
    this.#url.searchParams.set(`${prefix}limit`, stringifyValue(to - from + 1))
    return this
  }

  single(): DataApiQueryBuilder<Result extends Array<infer Item> ? Item : Result, Throws> {
    this.#cardinality = 'single'
    this.#headers.set('accept', 'application/vnd.pgrst.object+json')
    return this as unknown as DataApiQueryBuilder<
      Result extends Array<infer Item> ? Item : Result,
      Throws
    >
  }

  maybeSingle(): DataApiQueryBuilder<
    (Result extends Array<infer Item> ? Item : Result) | null,
    Throws
  > {
    this.#cardinality = 'maybe-single'
    return this as unknown as DataApiQueryBuilder<
      (Result extends Array<infer Item> ? Item : Result) | null,
      Throws
    >
  }

  abortSignal(signal: AbortSignal): this {
    this.#signal = signal
    return this
  }

  retry(enabled: boolean): this {
    this.#retry = enabled
    return this
  }

  setHeader(name: string, value: string): this {
    this.#headers.set(name, value)
    return this
  }

  throwOnError(): DataApiQueryBuilder<Result, true> {
    this.#shouldThrow = true
    return this as unknown as DataApiQueryBuilder<Result, true>
  }

  returns<NewResult>(): DataApiQueryBuilder<NewResult, Throws> {
    return this as unknown as DataApiQueryBuilder<NewResult, Throws>
  }

  overrideTypes<
    NewResult,
    _Options extends { merge?: boolean } = { merge: true },
  >(): DataApiQueryBuilder<NewResult, Throws> {
    return this as unknown as DataApiQueryBuilder<NewResult, Throws>
  }

  then<TResult1 = DataApiResponse<Result>, TResult2 = never>(
    onfulfilled?: ((value: DataApiResponse<Result>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.#execute().then(onfulfilled, onrejected)
  }

  async #execute(): Promise<DataApiResponse<Result>> {
    const headers = new Headers(this.#headers)
    if (this.#schema) {
      headers.set(
        this.#method === 'GET' || this.#method === 'HEAD'
          ? 'accept-profile'
          : 'content-profile',
        this.#schema,
      )
    }
    if (this.#method !== 'GET' && this.#method !== 'HEAD') {
      headers.set('content-type', 'application/json')
    }
    if (!headers.has('accept')) headers.set('accept', 'application/json')

    let attempt = 0
    while (true) {
      const scopedSignal = requestSignal(this.#signal, this.#timeout)
      let response: Response
      try {
        const plainHeaders: Record<string, string> = {}
        headers.forEach((value, key) => { plainHeaders[key] = value })
        if (attempt > 0) plainHeaders['x-retry-count'] = stringifyValue(attempt)

        response = await this.#fetch(this.#url.toString(), {
          body: this.#body === undefined ? undefined : jsonStringify(this.#body),
          headers: plainHeaders,
          method: this.#method,
          signal: scopedSignal.signal,
        })
      } catch (error) {
        scopedSignal.cleanup()
        const mayRetry = this.#retry
          && RETRYABLE_METHODS.has(this.#method)
          && !isAbortError(error)
          && attempt < MAX_RETRIES
        if (mayRetry) {
          await delay(2 ** attempt * 1_000, this.#signal)
          attempt += 1
          continue
        }
        if (this.#shouldThrow) throw error
        return {
          count: null,
          data: null,
          error: networkError(error),
          status: 0,
          statusText: '',
        }
      }
      scopedSignal.cleanup()

      if (
        this.#retry
        && RETRYABLE_METHODS.has(this.#method)
        && RETRYABLE_STATUSES.has(response.status)
        && attempt < MAX_RETRIES
      ) {
        const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
        await response.text()
        await delay(
          Number.isFinite(retryAfter) ? Math.max(0, retryAfter) * 1_000 : 2 ** attempt * 1_000,
          this.#signal,
        )
        attempt += 1
        continue
      }

      return this.#processResponse(response, headers)
    }
  }

  async #processResponse(
    response: Response,
    requestHeaders: Headers,
  ): Promise<DataApiResponse<Result>> {
    const count = parseCount(requestHeaders, response)
    const body = this.#method === 'HEAD' ? '' : await response.text()

    if (!response.ok) {
      let parsed: unknown = body
      try {
        if (body) parsed = JSON.parse(body)
      } catch {
        // Keep the response text as the most useful error message.
      }
      const error = normalizeError(
        parsed,
        response.statusText || `HTTP ${response.status}`,
      )
      if (this.#shouldThrow) throw new PostgrestError(error)
      return {
        count: null,
        data: null,
        error,
        status: response.status,
        statusText: response.statusText,
      }
    }

    let data: unknown = null
    let error: DataApiError | null = null
    let status = response.status
    let statusText = response.statusText
    if (body) {
      try {
        data = JSON.parse(body)
      } catch {
        error = { message: body }
      }
    }

    if (!error && Array.isArray(data) && this.#cardinality !== 'many') {
      if (data.length === 1) data = data[0]
      else if (data.length === 0 && this.#cardinality === 'maybe-single') data = null
      else {
        error = {
          code: 'PGRST116',
          details: `Results contain ${data.length} rows; exactly one row is required`,
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        }
        data = null
        status = 406
        statusText = 'Not Acceptable'
      }
    }

    if (error && this.#shouldThrow) throw new PostgrestError(error)
    return {
      count: error ? null : count,
      data: error ? null : data as Result,
      error,
      status,
      statusText,
    }
  }
}

export class DataApiRelationBuilder {
  readonly #configuration: Omit<QueryConfiguration, 'body' | 'method'>

  constructor(configuration: Omit<QueryConfiguration, 'body' | 'method'>) {
    this.#configuration = configuration
  }

  #query<Result>(
    method: HttpMethod,
    body?: unknown,
    configure?: (state: { headers: Headers, url: URL }) => void,
  ): DataApiQueryBuilder<Result> {
    const state = {
      headers: new Headers(this.#configuration.headers),
      url: new URL(this.#configuration.url),
    }
    configure?.(state)
    return new DataApiQueryBuilder<Result>({
      ...this.#configuration,
      body,
      headers: state.headers,
      method,
      url: state.url,
    })
  }

  select(columns = '*', options: SelectOptions = {}): DataApiQueryBuilder<any[]> {
    const query = this.#query<any[]>(options.head ? 'HEAD' : 'GET')
    query.select(columns, options)
    return query
  }

  insert(values: unknown, options: InsertOptions = {}): DataApiQueryBuilder<null> {
    return this.#query<null>('POST', values, ({ headers, url }) => {
      appendCountPreference(headers, options.count)
      if (options.defaultToNull === false) {
        appendPreference(headers, 'missing=default')
      }
      addArrayColumns(url, values)
    })
  }

  upsert(values: unknown, options: UpsertOptions = {}): DataApiQueryBuilder<null> {
    return this.#query<null>('POST', values, ({ headers, url }) => {
      appendPreference(
        headers,
        `resolution=${options.ignoreDuplicates ? 'ignore' : 'merge'}-duplicates`,
      )
      appendCountPreference(headers, options.count)
      if (options.defaultToNull === false) {
        appendPreference(headers, 'missing=default')
      }
      if (options.onConflict !== undefined) {
        url.searchParams.set('on_conflict', options.onConflict)
      }
      addArrayColumns(url, values)
    })
  }

  update(values: unknown, options: MutationOptions = {}): DataApiQueryBuilder<null> {
    return this.#query<null>('PATCH', values, ({ headers }) => {
      appendCountPreference(headers, options.count)
    })
  }

  delete(options: MutationOptions = {}): DataApiQueryBuilder<null> {
    return this.#query<null>('DELETE', undefined, ({ headers }) => {
      appendCountPreference(headers, options.count)
    })
  }
}

function addArrayColumns(url: URL, values: unknown): void {
  const columns = arrayColumns(values)
  if (columns.length) {
    url.searchParams.set('columns', columns.map(column => `"${column}"`).join(','))
  }
}

export class PostgrestClient<Database = any> {
  readonly #fetch: typeof globalThis.fetch
  readonly #headers: Headers
  readonly #retry: boolean
  readonly #schema?: string
  readonly #timeout: number
  readonly #url: string

  constructor(url: string, options: PostgrestClientOptions = {}) {
    this.#url = normalizeDataApiUrl(url)
    const fetchImplementation = options.fetch ?? globalThis.fetch
    if (typeof fetchImplementation !== 'function') {
      throw new Error('A fetch implementation is required')
    }
    this.#fetch = fetchImplementation
    this.#headers = new Headers(options.headers)
    this.#retry = options.retry ?? true
    this.#schema = options.schema ?? 'public'
    this.#timeout = options.timeout ?? 0
  }

  from(_relation: string & keyof Database): DataApiRelationBuilder
  from(relation: string): DataApiRelationBuilder
  from(relation: string): DataApiRelationBuilder {
    const segment = assertPathSegment(relation, 'Relation name')
    return new DataApiRelationBuilder({
      fetch: this.#fetch,
      headers: new Headers(this.#headers),
      retry: this.#retry,
      schema: this.#schema,
      timeout: this.#timeout,
      url: new URL(`${this.#url}/${segment}`),
    })
  }

  rpc<Result = any>(
    functionName: string,
    args: Record<string, unknown> = {},
    options: RpcOptions = {},
  ): DataApiQueryBuilder<Result> {
    const segment = assertPathSegment(functionName, 'Function name')
    const url = new URL(`${this.#url}/rpc/${segment}`)
    const headers = new Headers(this.#headers)
    let method: HttpMethod
    let body: unknown

    const hasObjectArgument = options.head && Object.values(args).some(value => (
      value !== null
      && typeof value === 'object'
      && (!Array.isArray(value) || value.some(entry => entry && typeof entry === 'object'))
    ))

    if (hasObjectArgument) {
      method = 'POST'
      body = args
      appendPreference(headers, 'return=minimal')
    } else if (options.head || options.get) {
      method = options.head ? 'HEAD' : 'GET'
      for (const [name, value] of Object.entries(args)) {
        if (value === undefined) continue
        url.searchParams.append(
          name,
          Array.isArray(value)
            ? `{${value.map(stringifyValue).join(',')}}`
            : stringifyValue(value),
        )
      }
    } else {
      method = 'POST'
      body = args
    }
    appendCountPreference(headers, options.count)

    return new DataApiQueryBuilder<Result>({
      body,
      fetch: this.#fetch,
      headers,
      method,
      retry: this.#retry,
      schema: this.#schema,
      timeout: this.#timeout,
      url,
    })
  }

  schema<NextDatabase = Database>(schema: string): PostgrestClient<NextDatabase> {
    return new PostgrestClient<NextDatabase>(this.#url, {
      fetch: this.#fetch,
      headers: this.#headers,
      retry: this.#retry,
      schema,
      timeout: this.#timeout,
    })
  }
}

export type DataApiClient<Database = any> = PostgrestClient<Database>

export function createDataApiClient<Database = any>(
  options: DataApiClientOptions,
): DataApiClient<Database> {
  const url = normalizeDataApiUrl(options.url)
  const fetchImplementation = options.fetch ?? globalThis.fetch
  if (typeof fetchImplementation !== 'function') {
    throw new Error('A fetch implementation is required')
  }

  return new PostgrestClient<Database>(url, {
    fetch: tokenFetch(url, options.accessToken, fetchImplementation),
    headers: options.headers,
    retry: options.retry ?? true,
    schema: options.schema ?? 'public',
    timeout: options.timeout ?? 30_000,
  })
}

export function createAnonymousDataApiClient<Database = any>(
  url: string,
  options: Omit<DataApiClientOptions, 'url' | 'accessToken'> = {},
): DataApiClient<Database> {
  return createDataApiClient<Database>({ ...options, url })
}

export function createAuthenticatedDataApiClient<Database = any>(
  url: string,
  accessToken: AccessTokenProvider,
  options: Omit<DataApiClientOptions, 'url' | 'accessToken'> = {},
): DataApiClient<Database> {
  return createDataApiClient<Database>({ ...options, url, accessToken })
}

export * from './token.ts'
