import { createError, getHeader, type H3Event } from 'h3'

export interface MailMultipartPart {
  name?: string
  filename?: string
  type?: string
  data: Buffer
}

export async function readBoundedMultipartFormData(
  event: H3Event,
  maxBytes: number,
): Promise<MailMultipartPart[] | undefined> {
  const contentType = getHeader(event, 'content-type') || ''
  const rawBody = await readBoundedRequestBody(event, maxBytes)
  if (!rawBody.length) return undefined
  return parseMailMultipartBody(contentType, rawBody)
}

export async function parseMailMultipartBody(
  contentType: string,
  rawBody: Buffer,
): Promise<MailMultipartPart[]> {
  let formData: FormData
  try {
    formData = await new Request('http://openexpert.invalid/', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: new Uint8Array(rawBody),
    }).formData()
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { message: 'Formularz wiadomości jest nieprawidłowy.' },
    })
  }

  const parts: MailMultipartPart[] = []
  for (const [name, value] of formData.entries()) {
    if (typeof value === 'string') {
      parts.push({ name, data: Buffer.from(value, 'utf8') })
      continue
    }
    parts.push({
      name,
      filename: value.name,
      type: value.type,
      data: Buffer.from(await value.arrayBuffer()),
    })
  }
  return parts
}

export function readBoundedRequestBody(
  event: H3Event,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    let settled = false
    let oversized = false

    event.node.req.on('data', (chunk: Buffer | string) => {
      if (oversized) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes > maxBytes) {
        oversized = true
        settled = true
        chunks.length = 0
        reject(createError({
          statusCode: 413,
          statusMessage: 'Payload Too Large',
          data: { message: 'Wiadomość z załącznikami jest zbyt duża.' },
        }))
        return
      }
      chunks.push(buffer)
    })
    event.node.req.once('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks, totalBytes))
    })
    event.node.req.once('aborted', () => {
      if (settled) return
      settled = true
      reject(createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: { message: 'Przesyłanie wiadomości zostało przerwane.' },
      }))
    })
    event.node.req.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}
