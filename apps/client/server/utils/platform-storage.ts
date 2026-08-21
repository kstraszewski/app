import {
  createStorageBucketAdapter,
  createStorageClient,
  createVercelBlobStorageProvider,
  type StorageBucketAdapter,
  type StorageClient,
} from '@openexpert/storage'
import { useRuntimeConfig } from '#imports'
import type { H3Event } from 'h3'

interface PlatformStorageConfig {
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

  const provider = createVercelBlobStorageProvider({
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
