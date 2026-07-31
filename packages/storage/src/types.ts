import type {
  StorageAccess,
  StorageNamespace,
} from './namespaces.ts'

export type StorageBody =
  | string
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | ReadableStream<Uint8Array>

export interface StorageObject {
  namespace: StorageNamespace
  path: string
  access: StorageAccess
  size: number
  contentType?: string
  etag?: string
  uploadedAt?: Date
  url?: string
}

export interface StorageUploadInput {
  namespace: StorageNamespace
  path: string
  body: StorageBody
  contentType: string
  size?: number
  cacheControlMaxAge?: number
  overwrite?: boolean
}

export interface StorageObjectInput {
  namespace: StorageNamespace
  path: string
}

export interface StorageDownload {
  object: StorageObject
  stream: ReadableStream<Uint8Array>
}

export interface StorageListInput {
  namespace: StorageNamespace
  prefix?: string
  cursor?: string
  limit?: number
}

export interface StorageListResult {
  objects: StorageObject[]
  cursor?: string
}

export interface StorageSignedUrlInput extends StorageObjectInput {
  expiresInSeconds?: number
}

export interface StorageSignedUrl {
  url: string
  method: 'GET'
  expiresAt: Date
}

export interface StorageClient {
  upload(input: StorageUploadInput): Promise<StorageObject>
  download(input: StorageObjectInput): Promise<StorageDownload | null>
  delete(input: StorageObjectInput): Promise<void>
  list(input: StorageListInput): Promise<StorageListResult>
  createSignedUrl(input: StorageSignedUrlInput): Promise<StorageSignedUrl>
  getPublicUrl(input: StorageObjectInput): string
}

export interface ProviderObject {
  access: StorageAccess
  key: string
  size: number
  contentType?: string
  etag?: string
  uploadedAt?: Date
  url?: string
}

export interface ProviderUploadInput {
  access: StorageAccess
  key: string
  body: StorageBody
  contentType: string
  size: number
  cacheControlMaxAge?: number
  overwrite: boolean
}

export interface ProviderObjectInput {
  access: StorageAccess
  key: string
}

export interface ProviderDownload {
  object: ProviderObject
  stream: ReadableStream<Uint8Array>
}

export interface ProviderListInput {
  access: StorageAccess
  prefix: string
  cursor?: string
  limit: number
}

export interface ProviderListResult {
  objects: ProviderObject[]
  cursor?: string
}

export interface ProviderSignedUrlInput extends ProviderObjectInput {
  expiresInSeconds: number
  expiresAt: Date
}

export interface ProviderSignedUrl {
  url: string
}

export interface StorageProvider {
  readonly kind: string
  upload(input: ProviderUploadInput): Promise<ProviderObject>
  download(input: ProviderObjectInput): Promise<ProviderDownload | null>
  delete(input: ProviderObjectInput): Promise<void>
  list(input: ProviderListInput): Promise<ProviderListResult>
  createSignedUrl(input: ProviderSignedUrlInput): Promise<ProviderSignedUrl>
  getPublicUrl(input: ProviderObjectInput): string
}
