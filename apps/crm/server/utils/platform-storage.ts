import {
  createMinioStorageProvider,
  createStorageClient,
  createStorageBucketAdapter,
  createVercelBlobStorageProvider,
  type StorageBucketAdapter,
  type StorageClient,
} from '@openexpert/storage'
import type { H3Event } from 'h3'

interface PlatformStorageConfig {
  provider: 'minio' | 'vercel-blob'
  minio: {
    endpoint: string
    region: string
    accessKeyId: string
    secretAccessKey: string
    publicBucket: string
    privateBucket: string
    publicBaseUrl: string
  }
  vercelBlob: {
    publicToken: string
    publicStoreId: string
    publicBaseUrl: string
    privateToken: string
    privateStoreId: string
  }
}

let cachedStorage:
  | {
      fingerprint: string
      adapter: StorageBucketAdapter
      client: StorageClient
    }
  | undefined

function storageConfig(event: H3Event): PlatformStorageConfig {
  return useRuntimeConfig(event).storage as PlatformStorageConfig
}

function optional(value: string): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

/**
 * Creates one provider-backed storage boundary per server process. No request
 * identity is cached here; authorization stays in the database/API handlers.
 */
function storageBoundary(event: H3Event) {
  const config = storageConfig(event)
  const fingerprint = JSON.stringify(config)
  if (cachedStorage?.fingerprint === fingerprint) return cachedStorage

  const provider = config.provider === 'vercel-blob'
    ? createVercelBlobStorageProvider({
        // @vercel/blob resolves the request-scoped, auto-rotating Vercel OIDC
        // token itself. Passing VERCEL_OIDC_TOKEN from Nuxt runtimeConfig would
        // pin the short-lived build token until the next deployment.
        stores: {
          public: {
            token: optional(config.vercelBlob.publicToken),
            storeId: optional(config.vercelBlob.publicStoreId),
            publicBaseUrl: optional(config.vercelBlob.publicBaseUrl),
          },
          private: {
            token: optional(config.vercelBlob.privateToken),
            storeId: optional(config.vercelBlob.privateStoreId),
          },
        },
        // Private Blob reads can otherwise observe a cached 404 immediately
        // after an immutable outbox upload. The mock-bank dispatcher verifies
        // the object before committing its hashes, so it requires read-after-
        // write semantics for this server-side path.
        bypassPrivateDownloadCache: true,
      })
    : createMinioStorageProvider({
        endpoint: config.minio.endpoint,
        region: config.minio.region,
        accessKeyId: config.minio.accessKeyId,
        secretAccessKey: config.minio.secretAccessKey,
        publicBucket: config.minio.publicBucket,
        privateBucket: config.minio.privateBucket,
        publicBaseUrl: config.minio.publicBaseUrl,
      })

  const client = createStorageClient(provider)
  const adapter = createStorageBucketAdapter(client)
  cachedStorage = { fingerprint, adapter, client }
  return cachedStorage
}

export function serverStorage(event: H3Event): StorageBucketAdapter {
  return storageBoundary(event).adapter
}

export function serverStorageClient(event: H3Event): StorageClient {
  return storageBoundary(event).client
}
