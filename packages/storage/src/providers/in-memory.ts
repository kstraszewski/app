import {
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto'
import {
  storageBodyToUint8Array,
  uint8ArrayToStream,
} from '../body.ts'
import {
  StorageConflictError,
  StorageValidationError,
} from '../errors.ts'
import type { StorageAccess } from '../namespaces.ts'
import type {
  ProviderDownload,
  ProviderListInput,
  ProviderListResult,
  ProviderObject,
  ProviderObjectInput,
  ProviderSignedUrl,
  ProviderSignedUrlInput,
  ProviderUploadInput,
  StorageProvider,
} from '../types.ts'

interface InMemoryEntry {
  access: StorageAccess
  key: string
  bytes: Uint8Array
  contentType: string
  etag: string
  uploadedAt: Date
}

export interface InMemoryStorageProviderOptions {
  now?: () => Date
  signingSecret?: string | Uint8Array
}

function encodeKeyForUrl(key: string): string {
  return key.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

function encodeCursor(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): string {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8')
    if (decoded === '') throw new Error('Empty cursor')
    return decoded
  }
  catch (error) {
    throw new StorageValidationError('Invalid in-memory storage cursor', {
      cause: error,
    })
  }
}

function entryId(access: StorageAccess, key: string): string {
  return `${access}\u0000${key}`
}

function toProviderObject(entry: InMemoryEntry): ProviderObject {
  return {
    access: entry.access,
    key: entry.key,
    size: entry.bytes.byteLength,
    contentType: entry.contentType,
    etag: entry.etag,
    uploadedAt: new Date(entry.uploadedAt),
    url: `memory://storage/${entry.access}/${encodeKeyForUrl(entry.key)}`,
  }
}

export function createInMemoryStorageProvider(
  options: InMemoryStorageProviderOptions = {},
): StorageProvider {
  const entries = new Map<string, InMemoryEntry>()
  const now = options.now ?? (() => new Date())
  const signingSecret = options.signingSecret ?? randomBytes(32)

  return {
    kind: 'memory',

    async upload(input: ProviderUploadInput): Promise<ProviderObject> {
      const id = entryId(input.access, input.key)
      if (!input.overwrite && entries.has(id)) {
        throw new StorageConflictError(`Object "${input.key}" already exists`)
      }

      const bytes = await storageBodyToUint8Array(input.body)
      if (bytes.byteLength !== input.size) {
        throw new StorageValidationError(
          `Uploaded body size ${bytes.byteLength} does not match declared size ${input.size}`,
        )
      }

      const entry: InMemoryEntry = {
        access: input.access,
        key: input.key,
        bytes,
        contentType: input.contentType,
        etag: createHash('sha256').update(bytes).digest('hex'),
        uploadedAt: new Date(now()),
      }
      entries.set(id, entry)
      return toProviderObject(entry)
    },

    async download(input: ProviderObjectInput): Promise<ProviderDownload | null> {
      const entry = entries.get(entryId(input.access, input.key))
      if (!entry) return null

      return {
        object: toProviderObject(entry),
        stream: uint8ArrayToStream(entry.bytes),
      }
    },

    async delete(input: ProviderObjectInput): Promise<void> {
      entries.delete(entryId(input.access, input.key))
    },

    async list(input: ProviderListInput): Promise<ProviderListResult> {
      const afterKey = input.cursor ? decodeCursor(input.cursor) : undefined
      const matchingEntries = [...entries.values()]
        .filter(entry => entry.access === input.access)
        .filter(entry => entry.key.startsWith(input.prefix))
        .filter(entry => afterKey === undefined || entry.key > afterKey)
        .sort((left, right) => left.key.localeCompare(right.key))

      const page = matchingEntries.slice(0, input.limit)
      const hasMore = matchingEntries.length > page.length
      const lastEntry = page.at(-1)

      return {
        objects: page.map(toProviderObject),
        cursor: hasMore && lastEntry ? encodeCursor(lastEntry.key) : undefined,
      }
    },

    async createSignedUrl(
      input: ProviderSignedUrlInput,
    ): Promise<ProviderSignedUrl> {
      const expires = Math.floor(input.expiresAt.getTime() / 1000)
      const payload = `${input.access}\n${input.key}\n${expires}`
      const signature = createHmac('sha256', signingSecret)
        .update(payload)
        .digest('base64url')
      const url = new URL(
        `memory://storage/${input.access}/${encodeKeyForUrl(input.key)}`,
      )
      url.searchParams.set('expires', String(expires))
      url.searchParams.set('signature', signature)

      return { url: url.toString() }
    },

    getPublicUrl(input: ProviderObjectInput): string {
      if (input.access !== 'public') {
        throw new StorageValidationError('Private in-memory objects do not have public URLs')
      }
      return `memory://storage/public/${encodeKeyForUrl(input.key)}`
    },
  }
}
