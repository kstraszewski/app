import {
  createStorageClient,
  createStorageBucketAdapter,
  createVercelBlobStorageProvider,
  type StorageBucketAdapter,
} from '@openexpert/storage'
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
  | { fingerprint: string, adapter: StorageBucketAdapter }
  | undefined

function optional(value: string): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

export function serverStorage(event: H3Event): StorageBucketAdapter {
  const config = useRuntimeConfig(event).storage as PlatformStorageConfig
  const fingerprint = JSON.stringify(config)
  if (cachedStorage?.fingerprint === fingerprint) return cachedStorage.adapter

  const provider = createVercelBlobStorageProvider({
    // @vercel/blob resolves Vercel's request-scoped OIDC token itself.
    // Explicit read-write tokens remain available as an optional fallback.
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

  const adapter = createStorageBucketAdapter(
    createStorageClient(provider),
  )
  cachedStorage = { fingerprint, adapter }
  return adapter
}
