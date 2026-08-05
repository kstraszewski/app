import {
  inferStorageBodySize,
  isStorageBody,
} from './body.ts'
import {
  StorageProviderContractError,
  StorageValidationError,
} from './errors.ts'
import {
  getStorageNamespaceDefinition,
  type StorageAccess,
  type StorageNamespace,
} from './namespaces.ts'
import {
  assertSafeStoragePath,
  assertSafeStoragePrefix,
  fromProviderKey,
  toProviderKey,
  toProviderPrefix,
} from './path.ts'
import type {
  ProviderObject,
  StorageClient,
  StorageDownload,
  StorageListInput,
  StorageListResult,
  StorageObject,
  StorageObjectInput,
  StorageProvider,
  StorageSignedUrl,
  StorageSignedUrlInput,
  StorageSignedUploadUrl,
  StorageSignedUploadUrlInput,
  StorageUploadInput,
} from './types.ts'

const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 1000
const DEFAULT_SIGNED_URL_TTL_SECONDS = 15 * 60
const MAX_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60
const DEFAULT_SIGNED_UPLOAD_URL_TTL_SECONDS = 5 * 60
const MAX_SIGNED_UPLOAD_URL_TTL_SECONDS = 15 * 60
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new StorageValidationError(`${label} must be a positive integer`)
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new StorageValidationError(`${label} must be a non-negative integer`)
  }
}

function normalizeContentType(contentType: string): string {
  if (
    typeof contentType !== 'string'
    || contentType.trim() === ''
    || /[\r\n]/.test(contentType)
  ) {
    throw new StorageValidationError('contentType must be a non-empty MIME type')
  }

  return contentType.split(';', 1)[0]!.trim().toLowerCase()
}

function resolveUploadSize(input: StorageUploadInput): number {
  if (!isStorageBody(input.body)) {
    throw new StorageValidationError('Unsupported storage body')
  }

  const inferredSize = inferStorageBodySize(input.body)
  if (input.size !== undefined) {
    assertNonNegativeInteger(input.size, 'size')
    if (inferredSize !== undefined && input.size !== inferredSize) {
      throw new StorageValidationError(
        `Declared size ${input.size} does not match body size ${inferredSize}`,
      )
    }
    return input.size
  }

  if (inferredSize === undefined) {
    throw new StorageValidationError('size is required for streaming uploads')
  }

  return inferredSize
}

function namespaceObjectConstraints(
  namespace: StorageNamespace,
  contentType: string,
  size: number,
) {
  const definition = getStorageNamespaceDefinition(namespace)
  const normalizedContentType = normalizeContentType(contentType)

  if (
    definition.allowedContentTypes
    && !definition.allowedContentTypes.includes(normalizedContentType)
  ) {
    throw new StorageValidationError(
      `Content type "${normalizedContentType}" is not allowed in "${namespace}"`,
    )
  }

  if (size > definition.maxBytes) {
    throw new StorageValidationError(
      `Object exceeds the ${definition.maxBytes}-byte limit for "${namespace}"`,
    )
  }

  return { definition, normalizedContentType }
}

function providerHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
    throw new StorageProviderContractError(
      'Provider returned invalid signed upload headers',
    )
  }

  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (
      !HTTP_HEADER_NAME_PATTERN.test(name)
      || typeof value !== 'string'
      || /[\r\n]/.test(value)
    ) {
      throw new StorageProviderContractError(
        'Provider returned invalid signed upload headers',
      )
    }
    result[name] = value
  }
  return result
}

function mapProviderObject(
  namespace: StorageNamespace,
  expectedAccess: StorageAccess,
  object: ProviderObject,
  expectedKey?: string,
): StorageObject {
  if (object.access !== expectedAccess) {
    throw new StorageProviderContractError(
      `Provider returned access "${object.access}" for "${expectedAccess}" storage`,
    )
  }

  if (expectedKey !== undefined && object.key !== expectedKey) {
    throw new StorageProviderContractError(
      `Provider returned key "${object.key}" instead of "${expectedKey}"`,
    )
  }

  let path: string
  try {
    path = fromProviderKey(namespace, object.key)
  }
  catch (error) {
    throw new StorageProviderContractError(
      `Provider returned a key outside namespace "${namespace}"`,
      { cause: error },
    )
  }

  if (!Number.isSafeInteger(object.size) || object.size < 0) {
    throw new StorageProviderContractError(
      `Provider returned an invalid size for "${object.key}"`,
    )
  }

  return {
    namespace,
    path,
    access: object.access,
    size: object.size,
    contentType: object.contentType,
    etag: object.etag,
    uploadedAt: object.uploadedAt,
    url: object.url,
  }
}

class DefaultStorageClient implements StorageClient {
  readonly #provider: StorageProvider

  constructor(provider: StorageProvider) {
    this.#provider = provider
  }

  async upload(input: StorageUploadInput): Promise<StorageObject> {
    const key = toProviderKey(input.namespace, input.path)
    const size = resolveUploadSize(input)
    const { definition, normalizedContentType } = namespaceObjectConstraints(
      input.namespace,
      input.contentType,
      size,
    )

    if (input.cacheControlMaxAge !== undefined) {
      assertPositiveInteger(input.cacheControlMaxAge, 'cacheControlMaxAge')
      if (input.cacheControlMaxAge < 60) {
        throw new StorageValidationError(
          'cacheControlMaxAge cannot be lower than 60 seconds',
        )
      }
    }

    const object = await this.#provider.upload({
      access: definition.access,
      key,
      body: input.body,
      contentType: normalizedContentType,
      size,
      cacheControlMaxAge: input.cacheControlMaxAge,
      overwrite: input.overwrite === true,
    })

    return mapProviderObject(input.namespace, definition.access, object, key)
  }

  async head(input: StorageObjectInput): Promise<StorageObject | null> {
    const definition = getStorageNamespaceDefinition(input.namespace)
    const key = toProviderKey(input.namespace, input.path)
    const object = await this.#provider.head({
      access: definition.access,
      key,
    })

    return object === null
      ? null
      : mapProviderObject(input.namespace, definition.access, object, key)
  }

  async download(input: StorageObjectInput): Promise<StorageDownload | null> {
    const definition = getStorageNamespaceDefinition(input.namespace)
    const key = toProviderKey(input.namespace, input.path)
    const result = await this.#provider.download({
      access: definition.access,
      key,
    })

    if (result === null) return null
    return {
      object: mapProviderObject(
        input.namespace,
        definition.access,
        result.object,
        key,
      ),
      stream: result.stream,
    }
  }

  async delete(input: StorageObjectInput): Promise<void> {
    const definition = getStorageNamespaceDefinition(input.namespace)
    await this.#provider.delete({
      access: definition.access,
      key: toProviderKey(input.namespace, input.path),
    })
  }

  async list(input: StorageListInput): Promise<StorageListResult> {
    const definition = getStorageNamespaceDefinition(input.namespace)
    const prefix = assertSafeStoragePrefix(input.prefix ?? '')
    const providerPrefix = toProviderPrefix(input.namespace, prefix)
    const limit = input.limit ?? DEFAULT_LIST_LIMIT

    assertPositiveInteger(limit, 'limit')
    if (limit > MAX_LIST_LIMIT) {
      throw new StorageValidationError(`limit cannot exceed ${MAX_LIST_LIMIT}`)
    }

    if (
      input.cursor !== undefined
      && (typeof input.cursor !== 'string' || input.cursor === '')
    ) {
      throw new StorageValidationError('cursor must be a non-empty string')
    }

    const result = await this.#provider.list({
      access: definition.access,
      prefix: providerPrefix,
      cursor: input.cursor,
      limit,
    })

    return {
      objects: result.objects.map((object) => {
        if (!object.key.startsWith(providerPrefix)) {
          throw new StorageProviderContractError(
            `Provider returned key "${object.key}" outside requested prefix`,
          )
        }
        return mapProviderObject(input.namespace, definition.access, object)
      }),
      cursor: result.cursor,
    }
  }

  async createSignedUrl(input: StorageSignedUrlInput): Promise<StorageSignedUrl> {
    const definition = getStorageNamespaceDefinition(input.namespace)
    const expiresInSeconds = input.expiresInSeconds
      ?? DEFAULT_SIGNED_URL_TTL_SECONDS

    assertPositiveInteger(expiresInSeconds, 'expiresInSeconds')
    if (expiresInSeconds > MAX_SIGNED_URL_TTL_SECONDS) {
      throw new StorageValidationError(
        `expiresInSeconds cannot exceed ${MAX_SIGNED_URL_TTL_SECONDS}`,
      )
    }

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)
    const result = await this.#provider.createSignedUrl({
      access: definition.access,
      key: toProviderKey(input.namespace, input.path),
      expiresInSeconds,
      expiresAt,
    })

    try {
      new URL(result.url)
    }
    catch (error) {
      throw new StorageProviderContractError(
        'Provider returned an invalid signed URL',
        { cause: error },
      )
    }

    return {
      url: result.url,
      method: 'GET',
      expiresAt,
    }
  }

  async createSignedUploadUrl(
    input: StorageSignedUploadUrlInput,
  ): Promise<StorageSignedUploadUrl> {
    assertNonNegativeInteger(input.size, 'size')
    const { definition, normalizedContentType } = namespaceObjectConstraints(
      input.namespace,
      input.contentType,
      input.size,
    )
    const expiresInSeconds = input.expiresInSeconds
      ?? DEFAULT_SIGNED_UPLOAD_URL_TTL_SECONDS

    assertPositiveInteger(expiresInSeconds, 'expiresInSeconds')
    if (expiresInSeconds > MAX_SIGNED_UPLOAD_URL_TTL_SECONDS) {
      throw new StorageValidationError(
        `expiresInSeconds cannot exceed ${MAX_SIGNED_UPLOAD_URL_TTL_SECONDS}`,
      )
    }

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)
    const result = await this.#provider.createSignedUploadUrl({
      access: definition.access,
      key: toProviderKey(input.namespace, input.path),
      contentType: normalizedContentType,
      size: input.size,
      expiresInSeconds,
      expiresAt,
    })

    let url: URL
    try {
      url = new URL(result.url)
    }
    catch (error) {
      throw new StorageProviderContractError(
        'Provider returned an invalid signed upload URL',
        { cause: error },
      )
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new StorageProviderContractError(
        'Provider returned a signed upload URL with an unsupported protocol',
      )
    }

    return {
      url: url.toString(),
      method: 'PUT',
      headers: providerHeaders(result.headers),
      expiresAt,
    }
  }

  getPublicUrl(input: StorageObjectInput): string {
    const definition = getStorageNamespaceDefinition(input.namespace)
    if (definition.access !== 'public') {
      throw new StorageValidationError(
        `Namespace "${input.namespace}" does not expose public URLs`,
      )
    }

    const url = this.#provider.getPublicUrl({
      access: definition.access,
      key: toProviderKey(input.namespace, input.path),
    })

    try {
      return new URL(url).toString()
    }
    catch (error) {
      throw new StorageProviderContractError(
        'Provider returned an invalid public URL',
        { cause: error },
      )
    }
  }
}

export function createStorageClient(provider: StorageProvider): StorageClient {
  if (
    typeof provider !== 'object'
    || provider === null
    || typeof provider.upload !== 'function'
    || typeof provider.head !== 'function'
    || typeof provider.download !== 'function'
    || typeof provider.delete !== 'function'
    || typeof provider.list !== 'function'
    || typeof provider.createSignedUrl !== 'function'
    || typeof provider.createSignedUploadUrl !== 'function'
    || typeof provider.getPublicUrl !== 'function'
  ) {
    throw new StorageValidationError('A complete storage provider is required')
  }

  return new DefaultStorageClient(provider)
}

export function storagePath(path: string): string {
  return assertSafeStoragePath(path)
}
