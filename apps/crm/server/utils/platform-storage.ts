import {
  createMinioStorageProvider,
  createStorageClient,
  createStorageBucketAdapter,
  createVercelBlobStorageProvider,
  type StorageBucketAdapter,
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
    oidcToken: string
  }
}

let cachedStorage:
  | { fingerprint: string, adapter: StorageBucketAdapter }
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
export function serverStorage(event: H3Event): StorageBucketAdapter {
  const config = storageConfig(event)
  const fingerprint = JSON.stringify(config)
  if (cachedStorage?.fingerprint === fingerprint) return cachedStorage.adapter

  const provider = config.provider === 'vercel-blob'
    ? createVercelBlobStorageProvider({
        stores: {
          public: {
            token: optional(config.vercelBlob.publicToken),
            storeId: optional(config.vercelBlob.publicStoreId),
            publicBaseUrl: optional(config.vercelBlob.publicBaseUrl),
            oidcToken: optional(config.vercelBlob.oidcToken),
          },
          private: {
            token: optional(config.vercelBlob.privateToken),
            storeId: optional(config.vercelBlob.privateStoreId),
            oidcToken: optional(config.vercelBlob.oidcToken),
          },
        },
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

  const adapter = createStorageBucketAdapter(
    createStorageClient(provider),
  )
  cachedStorage = { fingerprint, adapter }
  return adapter
}
