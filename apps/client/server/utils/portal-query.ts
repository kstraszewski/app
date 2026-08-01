import { createError } from 'h3'

export function chunkPortalQueryValues<T>(values: T[], size = 40): T[][] {
  const chunks: T[][] = []
  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size))
  }
  return chunks
}

export async function runPortalQueryChunks<T, R>(
  chunks: T[][],
  worker: (chunk: T[]) => Promise<R>,
  concurrency = 4,
): Promise<R[]> {
  const results = new Array<R>(chunks.length)
  let nextIndex = 0

  async function runWorker() {
    for (;;) {
      const index = nextIndex++
      if (index >= chunks.length) return
      results[index] = await worker(chunks[index]!)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, chunks.length) }, runWorker),
  )
  return results
}

export function enforcePortalRowLimit<T>(rows: T[], maxRows: number): T[] {
  if (rows.length > maxRows) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Client portal data set is temporarily too large',
    })
  }
  return rows
}
