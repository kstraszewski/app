import { StorageConfigurationError } from '../errors.ts'
import type { StorageAccess } from '../namespaces.ts'
import type {
  ProviderDownload,
  ProviderListInput,
  ProviderListResult,
  ProviderObject,
  ProviderObjectInput,
  ProviderSignedUrl,
  ProviderSignedUrlInput,
  ProviderSignedUploadUrl,
  ProviderSignedUploadUrlInput,
  ProviderUploadInput,
  StorageProvider,
} from '../types.ts'

export interface VercelBlobStoreConfig {
  token?: string
  storeId?: string
  oidcToken?: string
  publicBaseUrl?: string
}

export interface VercelBlobStorageProviderOptions {
  stores: Record<StorageAccess, VercelBlobStoreConfig>
  bypassPrivateDownloadCache?: boolean
}

interface VercelBlobResult {
  url: string
  pathname: string
  contentType: string
  etag: string
}

interface VercelBlobGetResult {
  statusCode: 200 | 304
  stream: ReadableStream<Uint8Array> | null
  blob: {
    url: string
    pathname: string
    contentType: string | null
    size: number | null
    uploadedAt: Date
    etag: string
  }
}

interface VercelBlobHeadResult {
  url: string
  pathname: string
  contentType: string
  size: number
  uploadedAt: Date
  etag: string
}

interface VercelBlobListResult {
  blobs: Array<{
    url: string
    pathname: string
    size: number
    uploadedAt: Date
    etag: string
  }>
  cursor?: string
  hasMore: boolean
}

interface VercelIssuedSignedToken {
  delegationToken: string
  clientSigningToken: string
  validUntil: number
}

interface VercelBlobSdk {
  BlobNotFoundError: new () => Error
  put(
    pathname: string,
    body: unknown,
    options: Record<string, unknown>,
  ): Promise<VercelBlobResult>
  get(
    pathname: string,
    options: Record<string, unknown>,
  ): Promise<VercelBlobGetResult | null>
  head(
    pathname: string,
    options: Record<string, unknown>,
  ): Promise<VercelBlobHeadResult>
  del(pathname: string, options: Record<string, unknown>): Promise<void>
  list(options: Record<string, unknown>): Promise<VercelBlobListResult>
  issueSignedToken(
    options: Record<string, unknown>,
  ): Promise<VercelIssuedSignedToken>
  presignUrl(
    token: VercelIssuedSignedToken,
    options: Record<string, unknown>,
  ): Promise<{ presignedUrl: string }>
  parseStoreIdFromDelegationToken(delegationToken: string): string
}

const SIGNED_UPLOAD_CACHE_CONTROL_SECONDS = 60

let vercelBlobSdkPromise: Promise<VercelBlobSdk> | undefined

function loadVercelBlobSdk(): Promise<VercelBlobSdk> {
  vercelBlobSdkPromise ??= import('@vercel/blob')
    .then(module => module as unknown as VercelBlobSdk)
  return vercelBlobSdkPromise
}

function validateStoreConfig(
  access: StorageAccess,
  config: VercelBlobStoreConfig | undefined,
): void {
  if (!config || (!config.token && !config.storeId)) {
    throw new StorageConfigurationError(
      `Vercel Blob ${access} store requires a token or storeId`,
    )
  }

  for (const [name, value] of Object.entries(config)) {
    if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
      throw new StorageConfigurationError(
        `Vercel Blob ${access} ${name} must be a non-empty string`,
      )
    }
  }
}

function validateDistinctStores(
  stores: Record<StorageAccess, VercelBlobStoreConfig>,
): void {
  const publicStore = stores.public
  const privateStore = stores.private

  if (
    publicStore.storeId
    && privateStore.storeId
    && publicStore.storeId === privateStore.storeId
  ) {
    throw new StorageConfigurationError(
      'Public and private Vercel Blob storage must use different stores',
    )
  }

  if (
    !publicStore.storeId
    && !privateStore.storeId
    && publicStore.token
    && publicStore.token === privateStore.token
  ) {
    throw new StorageConfigurationError(
      'Public and private Vercel Blob storage must use different tokens',
    )
  }
}

function authOptions(config: VercelBlobStoreConfig): Record<string, string> {
  const entries = [
    ['token', config.token],
    ['storeId', config.storeId],
    ['oidcToken', config.oidcToken],
  ]
  return Object.fromEntries(entries.filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ))
}

function encodeKeyForUrl(key: string): string {
  return key.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

/**
 * The public storage contract accepts ArrayBufferView values, while
 * @vercel/blob intentionally does not accept Uint8Array/DataView directly.
 * Copy views into an exact ArrayBuffer so byte offsets cannot leak unrelated
 * bytes and the SDK does not silently persist an empty object.
 */
export function normalizeVercelBlobPutBody(
  body: ProviderUploadInput['body'],
): ProviderUploadInput['body'] {
  if (!ArrayBuffer.isView(body)) return body
  const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  return Uint8Array.from(bytes).buffer
}

export function createVercelBlobStorageProvider(
  options: VercelBlobStorageProviderOptions,
): StorageProvider {
  validateStoreConfig('public', options?.stores?.public)
  validateStoreConfig('private', options?.stores?.private)
  validateDistinctStores(options.stores)

  return {
    kind: 'vercel-blob',

    async upload(input: ProviderUploadInput): Promise<ProviderObject> {
      const sdk = await loadVercelBlobSdk()
      const result = await sdk.put(input.key, normalizeVercelBlobPutBody(input.body), {
        ...authOptions(options.stores[input.access]),
        access: input.access,
        addRandomSuffix: false,
        allowOverwrite: input.overwrite,
        contentType: input.contentType,
        cacheControlMaxAge: input.cacheControlMaxAge,
      })

      return {
        access: input.access,
        key: result.pathname,
        size: input.size,
        contentType: result.contentType,
        etag: result.etag,
        url: result.url,
      }
    },

    async head(input: ProviderObjectInput): Promise<ProviderObject | null> {
      const sdk = await loadVercelBlobSdk()
      try {
        const result = await sdk.head(
          input.key,
          authOptions(options.stores[input.access]),
        )
        return {
          access: input.access,
          key: result.pathname,
          size: result.size,
          contentType: result.contentType,
          etag: result.etag,
          uploadedAt: result.uploadedAt,
          url: result.url,
        }
      }
      catch (error) {
        if (error instanceof sdk.BlobNotFoundError) return null
        throw error
      }
    },

    async download(input: ProviderObjectInput): Promise<ProviderDownload | null> {
      const sdk = await loadVercelBlobSdk()
      const result = await sdk.get(input.key, {
        ...authOptions(options.stores[input.access]),
        access: input.access,
        useCache: input.access === 'private'
          && options.bypassPrivateDownloadCache === true
          ? false
          : undefined,
      })

      if (result === null) return null
      if (
        result.statusCode !== 200
        || result.stream === null
        || result.blob.size === null
      ) {
        throw new Error(`Unexpected Vercel Blob response for "${input.key}"`)
      }

      return {
        object: {
          access: input.access,
          key: result.blob.pathname,
          size: result.blob.size,
          contentType: result.blob.contentType ?? undefined,
          etag: result.blob.etag,
          uploadedAt: result.blob.uploadedAt,
          url: result.blob.url,
        },
        stream: result.stream,
      }
    },

    async delete(input: ProviderObjectInput): Promise<void> {
      const sdk = await loadVercelBlobSdk()
      await sdk.del(input.key, authOptions(options.stores[input.access]))
    },

    async list(input: ProviderListInput): Promise<ProviderListResult> {
      const sdk = await loadVercelBlobSdk()
      const result = await sdk.list({
        ...authOptions(options.stores[input.access]),
        prefix: input.prefix,
        cursor: input.cursor,
        limit: input.limit,
      })

      return {
        objects: result.blobs.map(blob => ({
          access: input.access,
          key: blob.pathname,
          size: blob.size,
          etag: blob.etag,
          uploadedAt: blob.uploadedAt,
          url: blob.url,
        })),
        cursor: result.hasMore ? result.cursor : undefined,
      }
    },

    async createSignedUrl(
      input: ProviderSignedUrlInput,
    ): Promise<ProviderSignedUrl> {
      const sdk = await loadVercelBlobSdk()
      const auth = authOptions(options.stores[input.access])
      const validUntil = input.expiresAt.getTime()
      const token = await sdk.issueSignedToken({
        ...auth,
        pathname: input.key,
        operations: ['get'],
        validUntil,
      })
      const result = await sdk.presignUrl(token, {
        pathname: input.key,
        operation: 'get',
        validUntil,
        access: input.access,
      })

      return { url: result.presignedUrl }
    },

    async createSignedUploadUrl(
      input: ProviderSignedUploadUrlInput,
    ): Promise<ProviderSignedUploadUrl> {
      const sdk = await loadVercelBlobSdk()
      const auth = authOptions(options.stores[input.access])
      const validUntil = input.expiresAt.getTime()
      const allowedContentTypes = [input.contentType]
      const token = await sdk.issueSignedToken({
        ...auth,
        pathname: input.key,
        operations: ['put'],
        validUntil,
        allowedContentTypes,
        maximumSizeInBytes: input.size,
      })
      const result = await sdk.presignUrl(token, {
        pathname: input.key,
        operation: 'put',
        validUntil,
        access: input.access,
        allowedContentTypes,
        maximumSizeInBytes: input.size,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: SIGNED_UPLOAD_CACHE_CONTROL_SECONDS,
      })

      return {
        url: result.presignedUrl,
        headers: {
          'x-content-type': input.contentType,
          'x-vercel-blob-access': input.access,
          'x-vercel-blob-store-id': sdk.parseStoreIdFromDelegationToken(
            token.delegationToken,
          ),
        },
      }
    },

    getPublicUrl(input: ProviderObjectInput): string {
      if (input.access !== 'public') {
        throw new StorageConfigurationError(
          'Private Vercel Blob objects do not have public URLs',
        )
      }

      const store = options.stores.public
      const baseUrl = store.publicBaseUrl
        ?? (store.storeId
          ? `https://${store.storeId}.public.blob.vercel-storage.com`
          : undefined)
      if (!baseUrl) {
        throw new StorageConfigurationError(
          'Vercel Blob public store requires storeId or publicBaseUrl for getPublicUrl',
        )
      }

      return `${baseUrl.replace(/\/+$/, '')}/${encodeKeyForUrl(input.key)}`
    },
  }
}
