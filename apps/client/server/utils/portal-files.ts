import { basename } from 'node:path'
import {
  createError,
  getHeader,
  readMultipartFormData,
  type H3Event,
} from 'h3'

export const portalCaseDocumentBucket = 'crm-case-documents'
export const maxPortalDocumentBytes = 20 * 1024 * 1024

export const portalDocumentMimeExtensions = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
} as const

export type PortalDocumentMimeType = keyof typeof portalDocumentMimeExtensions

/**
 * Reads at most maxBytes from the request. H3 1.x does not expose the newer
 * assertBodySize helper, so this is the bounded equivalent used before the
 * multipart parser. Once the limit is crossed, the remaining request bytes
 * are drained without retaining them in memory.
 */
export async function readLimitedMultipartFormData(
  event: H3Event,
  maxBytes: number,
): ReturnType<typeof readMultipartFormData> {
  const contentLengthValue = getHeader(event, 'content-length')
  const transferEncoding = getHeader(event, 'transfer-encoding')
  if (contentLengthValue && transferEncoding) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Content-Length and Transfer-Encoding cannot be combined',
    })
  }
  if (contentLengthValue) {
    const contentLength = Number(contentLengthValue)
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid Content-Length' })
    }
    if (contentLength > maxBytes) {
      throw createError({ statusCode: 413, statusMessage: 'Request body is too large' })
    }
  }

  const request = event.node.req
  const body = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let settled = false

    const cleanup = () => {
      request.removeListener('data', onData)
      request.removeListener('end', onEnd)
      request.removeListener('error', onError)
      request.removeListener('aborted', onAborted)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onData = (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += bytes.length
      if (totalBytes > maxBytes) {
        finish(() => {
          // Keep the connection usable while ensuring excess bytes are never
          // buffered by this handler.
          request.resume()
          reject(createError({
            statusCode: 413,
            statusMessage: 'Request body is too large',
          }))
        })
        return
      }
      chunks.push(bytes)
    }
    const onEnd = () => finish(() => resolve(Buffer.concat(chunks, totalBytes)))
    const onError = (error: Error) => finish(() => reject(error))
    const onAborted = () => finish(() => reject(createError({
      statusCode: 400,
      statusMessage: 'Request body was interrupted',
    })))

    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    request.once('aborted', onAborted)
  })
  ;(request as typeof request & Record<symbol, Promise<Buffer>>)[
    Symbol.for('h3RawBody')
  ] = Promise.resolve(body)
  return await readMultipartFormData(event)
}

export function hasValidPortalDocumentSignature(
  mimeType: PortalDocumentMimeType,
  bytes: Uint8Array,
): boolean {
  if (mimeType === 'application/pdf') {
    return bytes.length >= 5
      && bytes[0] === 0x25
      && bytes[1] === 0x50
      && bytes[2] === 0x44
      && bytes[3] === 0x46
      && bytes[4] === 0x2d
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff
  }
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
}

export function safePortalFileName(
  input: string | undefined,
  fallback: string,
): string {
  const candidate = basename(String(input || ''))
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .replace(/[\\/]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!candidate || candidate === '.' || candidate === '..') return fallback
  return candidate.slice(0, 180)
}
