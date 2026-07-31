export type OpenExpertHeaderSource =
  | Headers
  | Record<string, string | string[] | undefined>

function readHeader(headers: OpenExpertHeaderSource, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name)

  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1]

  if (Array.isArray(entry)) return entry.length === 1 ? entry[0] ?? null : null
  return entry ?? null
}

export function getBearerToken(headers: OpenExpertHeaderSource): string | null {
  const authorization = readHeader(headers, 'authorization')
  if (!authorization) return null
  return authorization.match(/^Bearer ([^\s,]+)$/i)?.[1] ?? null
}
