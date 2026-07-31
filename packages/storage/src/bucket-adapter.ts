import {
  StorageNamespaceError,
  StorageValidationError,
} from './errors.ts'
import {
  isStorageNamespace,
  type StorageNamespace,
} from './namespaces.ts'
import type {
  StorageBody,
  StorageClient,
} from './types.ts'

export interface BucketUploadOptions {
  cacheControl?: string | number
  contentType?: string
  upsert?: boolean
}

export interface BucketTransformOptions {
  width?: number
  height?: number
  quality?: number
  resize?: 'contain' | 'cover' | 'fill'
  format?: 'origin'
}

export interface BucketSignedUrlOptions {
  download?: boolean | string
  transform?: BucketTransformOptions
}

export interface BucketDownloadOptions {
  transform?: BucketTransformOptions
}

export interface BucketPublicUrlOptions {
  download?: boolean | string
  transform?: BucketTransformOptions
}

export type BucketResult<T> =
  | { data: T; error: null }
  | { data: null; error: Error }

export interface BucketUploadData {
  id: string
  path: string
  fullPath: string
}

export interface BucketRemoveData {
  name: string
}

export interface StorageBucket {
  upload(
    path: string,
    body: StorageBody,
    options?: BucketUploadOptions,
  ): Promise<BucketResult<BucketUploadData>>
  download(
    path: string,
    options?: BucketDownloadOptions,
  ): Promise<BucketResult<Blob>>
  remove(
    paths: string[],
  ): Promise<BucketResult<BucketRemoveData[]>>
  createSignedUrl(
    path: string,
    expiresIn: number,
    options?: BucketSignedUrlOptions,
  ): Promise<BucketResult<{ signedUrl: string }>>
  getPublicUrl(
    path: string,
    options?: BucketPublicUrlOptions,
  ): {
    data: { publicUrl: string }
    error: Error | null
  }
}

export interface StorageBucketAdapter {
  from(bucket: string): StorageBucket
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error))
}

function namespaceFromBucket(bucket: string): StorageNamespace {
  if (!isStorageNamespace(bucket)) {
    throw new StorageNamespaceError(`Unknown storage bucket: ${bucket}`)
  }
  return bucket
}

function inferContentType(body: StorageBody): string {
  if (typeof Blob !== 'undefined' && body instanceof Blob && body.type) {
    return body.type
  }
  return 'application/octet-stream'
}

function normalizedCacheTtl(
  cacheControl: string | number | undefined,
): number | undefined {
  if (cacheControl === undefined) return undefined
  const value = typeof cacheControl === 'number'
    ? cacheControl
    : Number(cacheControl)

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StorageValidationError(
      'cacheControl must be a non-negative integer number of seconds',
    )
  }

  // Vercel Blob enforces a 60-second lower bound. Existing callers commonly
  // use "0"; clamp it to the narrowest portable value instead of silently
  // falling back to a provider's much longer default.
  return Math.max(60, value)
}

function withDownloadQuery(url: string, download: boolean | string | undefined): string {
  if (!download) return url
  const result = new URL(url)
  result.searchParams.set('download', typeof download === 'string' ? download : '1')
  return result.toString()
}

class ProviderStorageBucket implements StorageBucket {
  readonly #storage: StorageClient
  readonly #bucket: string

  constructor(storage: StorageClient, bucket: string) {
    this.#storage = storage
    this.#bucket = bucket
  }

  async upload(
    path: string,
    body: StorageBody,
    options: BucketUploadOptions = {},
  ): Promise<BucketResult<BucketUploadData>> {
    try {
      const namespace = namespaceFromBucket(this.#bucket)
      const object = await this.#storage.upload({
        namespace,
        path,
        body,
        contentType: options.contentType ?? inferContentType(body),
        cacheControlMaxAge: normalizedCacheTtl(options.cacheControl),
        overwrite: options.upsert === true,
      })

      return {
        data: {
          id: object.etag ?? '',
          path: object.path,
          fullPath: `${namespace}/${object.path}`,
        },
        error: null,
      }
    }
    catch (error) {
      return { data: null, error: toError(error) }
    }
  }

  async download(
    path: string,
    _options: BucketDownloadOptions = {},
  ): Promise<BucketResult<Blob>> {
    try {
      const namespace = namespaceFromBucket(this.#bucket)
      const result = await this.#storage.download({ namespace, path })
      if (!result) {
        throw new Error(`Storage object "${namespace}/${path}" was not found`)
      }

      const bytes = await new Response(result.stream).arrayBuffer()
      return {
        data: new Blob([bytes], {
          type: result.object.contentType ?? 'application/octet-stream',
        }),
        error: null,
      }
    }
    catch (error) {
      return { data: null, error: toError(error) }
    }
  }

  async remove(
    paths: string[],
  ): Promise<BucketResult<BucketRemoveData[]>> {
    try {
      if (!Array.isArray(paths) || paths.length === 0) {
        throw new StorageValidationError('remove requires at least one storage path')
      }

      const namespace = namespaceFromBucket(this.#bucket)
      await Promise.all(paths.map(path => this.#storage.delete({ namespace, path })))
      return {
        data: paths.map(name => ({ name })),
        error: null,
      }
    }
    catch (error) {
      return { data: null, error: toError(error) }
    }
  }

  async createSignedUrl(
    path: string,
    expiresIn: number,
    options: BucketSignedUrlOptions = {},
  ): Promise<BucketResult<{ signedUrl: string }>> {
    try {
      const namespace = namespaceFromBucket(this.#bucket)
      const result = await this.#storage.createSignedUrl({
        namespace,
        path,
        expiresInSeconds: expiresIn,
      })
      return {
        data: {
          signedUrl: withDownloadQuery(result.url, options.download),
        },
        error: null,
      }
    }
    catch (error) {
      return { data: null, error: toError(error) }
    }
  }

  getPublicUrl(
    path: string,
    options: BucketPublicUrlOptions = {},
  ): {
      data: { publicUrl: string }
      error: Error | null
    } {
    try {
      const namespace = namespaceFromBucket(this.#bucket)
      const publicUrl = this.#storage.getPublicUrl({ namespace, path })
      return {
        data: {
          publicUrl: withDownloadQuery(publicUrl, options.download),
        },
        error: null,
      }
    }
    catch (error) {
      return {
        data: { publicUrl: '' },
        error: toError(error),
      }
    }
  }
}

export function createStorageBucketAdapter(
  storage: StorageClient,
): StorageBucketAdapter {
  return {
    from(bucket: string): StorageBucket {
      return new ProviderStorageBucket(storage, bucket)
    },
  }
}
