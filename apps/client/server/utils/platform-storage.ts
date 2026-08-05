import {
  createMinioStorageProvider,
  createStorageBucketAdapter,
  createStorageClient,
  createVercelBlobStorageProvider,
  type StorageBucketAdapter,
  type StorageClient,
} from '@openexpert/storage'
import { useRuntimeConfig } from '#imports'
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

function optional(value: string): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

function storageBoundary(event: H3Event) {
  const config = useRuntimeConfig(event).storage as PlatformStorageConfig
  const fingerprint = JSON.stringify(config)
  if (cachedStorage?.fingerprint === fingerprint) return cachedStorage

  const provider = config.provider === 'vercel-blob'
    ? createVercelBlobStorageProvider({
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
