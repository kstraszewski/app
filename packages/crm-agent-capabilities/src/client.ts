export interface DataApiErrorLike {
  message?: string
}

export interface DataApiResponseLike {
  data: unknown
  error: DataApiErrorLike | null
}

/**
 * The deliberately small structural surface used by the capabilities. A real
 * `DataApiClient` from `@openexpert/data-api` satisfies this contract, while
 * tests can provide an in-memory implementation without an HTTP server.
 */
export interface DataApiQueryLike extends PromiseLike<DataApiResponseLike> {
  eq(column: string, value: unknown): DataApiQueryLike
  in(column: string, values: readonly unknown[]): DataApiQueryLike
  limit(count: number): DataApiQueryLike
  maybeSingle(): DataApiQueryLike
  order(column: string, options?: {
    ascending?: boolean
    nullsFirst?: boolean
  }): DataApiQueryLike
  select(columns?: string): DataApiQueryLike
}

export interface DataApiRelationLike {
  select(columns?: string): DataApiQueryLike
}

export interface DataApiClientLike {
  from(relation: string): DataApiRelationLike
  rpc(functionName: string, args?: Record<string, unknown>): DataApiQueryLike
}

export type DataApiRow = Record<string, unknown>

export function dataApiRows(value: unknown): DataApiRow[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is DataApiRow => (
        Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
      ))
    : []
}

export function dataApiRecord(value: unknown): DataApiRow {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as DataApiRow
    : {}
}

export async function requireDataApiResult(
  query: DataApiQueryLike,
  label: string,
): Promise<unknown> {
  const result = await query
  if (result.error) {
    throw new Error(`${label}: ${result.error.message ?? 'Data API error'}`)
  }
  return result.data
}
