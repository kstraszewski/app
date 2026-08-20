import type { DataApiClient } from '@openexpert/data-api'

/**
 * Service RPC errors are intentionally collapsed before they reach the model.
 * Database details stay in server-side operational logs, not in EVE history.
 */
export async function callBankMailServiceRpc(
  dataApi: DataApiClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await dataApi.rpc(functionName, args)
  if (result.error) {
    const code = typeof result.error.code === 'string' && result.error.code
      ? result.error.code
      : 'rpc_rejected'
    throw new Error(`Bank-mail policy RPC failed (${code}).`)
  }
  return result.data
}

export function rpcRecord(value: unknown): Record<string, unknown> {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : {}
}
