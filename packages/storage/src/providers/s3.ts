import {
  isReadableStorageStream,
  storageBodyToUint8Array,
  uint8ArrayToStream,
} from '../body.ts'
import {
  StorageConfigurationError,
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

const S3_CLIENT_MODULE: string = '@aws-sdk/client-s3'
const S3_PRESIGNER_MODULE: string = '@aws-sdk/s3-request-presigner'

interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export interface S3StorageProviderOptions {
  endpoint: string
  region: string
  credentials: S3Credentials
  buckets: Record<StorageAccess, string>
  forcePathStyle?: boolean
  publicBaseUrl?: string
}

export interface MinioStorageProviderOptions {
  endpoint?: string
  region?: string
  accessKeyId: string
  secretAccessKey: string
  publicBucket?: string
  privateBucket?: string
  publicBaseUrl?: string
}

interface S3ClientLike {
  send(command: unknown): Promise<unknown>
}

interface S3CommandConstructor {
  new (input: Record<string, unknown>): unknown
}

interface S3Sdk {
  S3Client: new (options: Record<string, unknown>) => S3ClientLike
  PutObjectCommand: S3CommandConstructor
  GetObjectCommand: S3CommandConstructor
  DeleteObjectCommand: S3CommandConstructor
  ListObjectsV2Command: S3CommandConstructor
  getSignedUrl(
    client: S3ClientLike,
    command: unknown,
    options: { expiresIn: number },
  ): Promise<string>
}

let s3SdkPromise: Promise<S3Sdk> | undefined

function loadS3Sdk(): Promise<S3Sdk> {
  s3SdkPromise ??= Promise.all([
    import(S3_CLIENT_MODULE),
    import(S3_PRESIGNER_MODULE),
  ]).then(([clientModule, presignerModule]) => ({
    ...(clientModule as unknown as Omit<S3Sdk, 'getSignedUrl'>),
    getSignedUrl: (
      presignerModule as unknown as Pick<S3Sdk, 'getSignedUrl'>
    ).getSignedUrl,
  }))
  return s3SdkPromise
}

function assertNonEmptyString(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StorageConfigurationError(`${label} must be a non-empty string`)
  }
}

function assertBucketName(bucket: string, label: string): void {
  assertNonEmptyString(bucket, label)
  if (
    bucket.length < 3
    || bucket.length > 63
    || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)
    || bucket.includes('..')
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucket)
  ) {
    throw new StorageConfigurationError(`${label} is not a valid S3 bucket name`)
  }
}

function validateS3Options(options: S3StorageProviderOptions): void {
  let endpoint: URL
  try {
    endpoint = new URL(options.endpoint)
  }
  catch (error) {
    throw new StorageConfigurationError('S3 endpoint must be a valid URL', {
      cause: error,
    })
  }

  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new StorageConfigurationError('S3 endpoint must use HTTP or HTTPS')
  }

  assertNonEmptyString(options.region, 'S3 region')
  assertNonEmptyString(options.credentials.accessKeyId, 'S3 accessKeyId')
  assertNonEmptyString(options.credentials.secretAccessKey, 'S3 secretAccessKey')
  assertBucketName(options.buckets.public, 'Public bucket')
  assertBucketName(options.buckets.private, 'Private bucket')

  if (options.buckets.public === options.buckets.private) {
    throw new StorageConfigurationError(
      'Public and private S3 storage must use different buckets',
    )
  }

  if (options.publicBaseUrl !== undefined) {
    try {
      new URL(options.publicBaseUrl)
    }
    catch (error) {
      throw new StorageConfigurationError('publicBaseUrl must be a valid URL', {
        cause: error,
      })
    }
  }
}

function encodeKeyForUrl(key: string): string {
  return key.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

function buildPublicUrl(baseUrl: string | undefined, key: string): string | undefined {
  if (!baseUrl) return undefined
  return `${baseUrl.replace(/\/+$/, '')}/${encodeKeyForUrl(key)}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalDate(value: unknown): Date | undefined {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined
}

function isNotFoundError(error: unknown): boolean {
  const record = asRecord(error)
  const metadata = asRecord(record.$metadata)
  return record.name === 'NoSuchKey'
    || record.name === 'NotFound'
    || metadata.httpStatusCode === 404
}

function chunkToUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk)
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  }
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk)
  throw new StorageValidationError('S3 returned an unsupported stream chunk')
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator]
      === 'function'
}

async function s3BodyToStream(body: unknown): Promise<ReadableStream<Uint8Array>> {
  if (isReadableStorageStream(body)) return body
  if (body instanceof Uint8Array) return uint8ArrayToStream(body)
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return uint8ArrayToStream(chunkToUint8Array(body))
  }

  const record = asRecord(body)
  if (typeof record.transformToWebStream === 'function') {
    const stream = (record.transformToWebStream as () => unknown)()
    if (isReadableStorageStream(stream)) return stream
  }

  if (typeof record.transformToByteArray === 'function') {
    const bytes = await (record.transformToByteArray as () => Promise<unknown>)()
    return uint8ArrayToStream(chunkToUint8Array(bytes))
  }

  if (isAsyncIterable(body)) {
    const iterator = body[Symbol.asyncIterator]()
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const result = await iterator.next()
        if (result.done) {
          controller.close()
          return
        }
        controller.enqueue(chunkToUint8Array(result.value))
      },
      async cancel() {
        await iterator.return?.()
      },
    })
  }

  throw new StorageValidationError('S3 response did not contain a readable body')
}

export function createS3StorageProvider(
  options: S3StorageProviderOptions,
): StorageProvider {
  validateS3Options(options)

  let clientPromise: Promise<S3ClientLike> | undefined
  const getClient = (): Promise<S3ClientLike> => {
    clientPromise ??= loadS3Sdk().then(({ S3Client }) => new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      credentials: options.credentials,
      forcePathStyle: options.forcePathStyle ?? false,
    }))
    return clientPromise
  }

  return {
    kind: 's3',

    async upload(input: ProviderUploadInput): Promise<ProviderObject> {
      const [sdk, client, bytes] = await Promise.all([
        loadS3Sdk(),
        getClient(),
        storageBodyToUint8Array(input.body),
      ])

      if (bytes.byteLength !== input.size) {
        throw new StorageValidationError(
          `Uploaded body size ${bytes.byteLength} does not match declared size ${input.size}`,
        )
      }

      const cacheControl = input.cacheControlMaxAge === undefined
        ? undefined
        : `${input.access === 'public' ? 'public' : 'private'}, max-age=${input.cacheControlMaxAge}`
      const response = asRecord(await client.send(new sdk.PutObjectCommand({
        Bucket: options.buckets[input.access],
        Key: input.key,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: input.contentType,
        CacheControl: cacheControl,
        IfNoneMatch: input.overwrite ? undefined : '*',
      })))

      return {
        access: input.access,
        key: input.key,
        size: input.size,
        contentType: input.contentType,
        etag: optionalString(response.ETag),
        uploadedAt: new Date(),
        url: input.access === 'public'
          ? buildPublicUrl(options.publicBaseUrl, input.key)
          : undefined,
      }
    },

    async download(input: ProviderObjectInput): Promise<ProviderDownload | null> {
      const [sdk, client] = await Promise.all([loadS3Sdk(), getClient()])

      try {
        const response = asRecord(await client.send(new sdk.GetObjectCommand({
          Bucket: options.buckets[input.access],
          Key: input.key,
        })))
        const size = optionalNumber(response.ContentLength)
        if (size === undefined || size < 0) {
          throw new StorageValidationError(
            `S3 returned an invalid content length for "${input.key}"`,
          )
        }

        return {
          object: {
            access: input.access,
            key: input.key,
            size,
            contentType: optionalString(response.ContentType),
            etag: optionalString(response.ETag),
            uploadedAt: optionalDate(response.LastModified),
            url: input.access === 'public'
              ? buildPublicUrl(options.publicBaseUrl, input.key)
              : undefined,
          },
          stream: await s3BodyToStream(response.Body),
        }
      }
      catch (error) {
        if (isNotFoundError(error)) return null
        throw error
      }
    },

    async delete(input: ProviderObjectInput): Promise<void> {
      const [sdk, client] = await Promise.all([loadS3Sdk(), getClient()])
      await client.send(new sdk.DeleteObjectCommand({
        Bucket: options.buckets[input.access],
        Key: input.key,
      }))
    },

    async list(input: ProviderListInput): Promise<ProviderListResult> {
      const [sdk, client] = await Promise.all([loadS3Sdk(), getClient()])
      const response = asRecord(await client.send(new sdk.ListObjectsV2Command({
        Bucket: options.buckets[input.access],
        Prefix: input.prefix,
        ContinuationToken: input.cursor,
        MaxKeys: input.limit,
      })))
      const contents = Array.isArray(response.Contents) ? response.Contents : []

      return {
        objects: contents.flatMap((rawObject): ProviderObject[] => {
          const object = asRecord(rawObject)
          const key = optionalString(object.Key)
          const size = optionalNumber(object.Size)
          if (!key || size === undefined || size < 0) return []

          return [{
            access: input.access,
            key,
            size,
            etag: optionalString(object.ETag),
            uploadedAt: optionalDate(object.LastModified),
            url: input.access === 'public'
              ? buildPublicUrl(options.publicBaseUrl, key)
              : undefined,
          }]
        }),
        cursor: response.IsTruncated === true
          ? optionalString(response.NextContinuationToken)
          : undefined,
      }
    },

    async createSignedUrl(
      input: ProviderSignedUrlInput,
    ): Promise<ProviderSignedUrl> {
      const [sdk, client] = await Promise.all([loadS3Sdk(), getClient()])
      const command = new sdk.GetObjectCommand({
        Bucket: options.buckets[input.access],
        Key: input.key,
      })
      const url = await sdk.getSignedUrl(client, command, {
        expiresIn: input.expiresInSeconds,
      })
      return { url }
    },

    getPublicUrl(input: ProviderObjectInput): string {
      if (input.access !== 'public') {
        throw new StorageValidationError('Private S3 objects do not have public URLs')
      }

      const url = buildPublicUrl(options.publicBaseUrl, input.key)
      if (!url) {
        throw new StorageConfigurationError(
          'publicBaseUrl is required to build public S3 object URLs',
        )
      }
      return url
    },
  }
}

export function createMinioStorageProvider(
  options: MinioStorageProviderOptions,
): StorageProvider {
  return createS3StorageProvider({
    endpoint: options.endpoint ?? 'http://127.0.0.1:9000',
    region: options.region ?? 'us-east-1',
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    buckets: {
      public: options.publicBucket ?? 'openexpert-public',
      private: options.privateBucket ?? 'openexpert-private',
    },
    forcePathStyle: true,
    publicBaseUrl: options.publicBaseUrl,
  })
}
