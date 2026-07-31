import { StorageValidationError } from './errors.ts'
import type { StorageBody } from './types.ts'

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

export function isReadableStorageStream(
  value: unknown,
): value is ReadableStream<Uint8Array> {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { getReader?: unknown }).getReader === 'function'
}

export function isStorageBody(value: unknown): value is StorageBody {
  return typeof value === 'string'
    || value instanceof Uint8Array
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
    || isBlob(value)
    || isReadableStorageStream(value)
}

export function inferStorageBodySize(body: StorageBody): number | undefined {
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength
  if (body instanceof Uint8Array) return body.byteLength
  if (body instanceof ArrayBuffer) return body.byteLength
  if (ArrayBuffer.isView(body)) return body.byteLength
  if (isBlob(body)) return body.size
  return undefined
}

export async function storageBodyToUint8Array(body: StorageBody): Promise<Uint8Array> {
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (body instanceof Uint8Array) return body.slice()
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0))
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice()
  }
  if (isBlob(body)) return new Uint8Array(await body.arrayBuffer())

  if (isReadableStorageStream(body)) {
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0

    while (true) {
      const result = await reader.read()
      if (result.done) break
      if (!(result.value instanceof Uint8Array)) {
        throw new StorageValidationError('Storage stream chunks must be Uint8Array values')
      }
      chunks.push(result.value)
      totalBytes += result.value.byteLength
    }

    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  }

  throw new StorageValidationError('Unsupported storage body')
}

export function uint8ArrayToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const snapshot = bytes.slice()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(snapshot)
      controller.close()
    },
  })
}
