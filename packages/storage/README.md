# `@openexpert/storage`

Provider-agnostic object storage for OpenExpert.

- Production provider: two Vercel Blob stores (`public` and `private`).
- Local provider: two S3-compatible MinIO buckets.
- Tests: an in-memory provider with no network calls.
- Stable bucket names are represented as logical namespaces, while database
  `storage_path` values remain provider-independent.

The package routes every namespace to its fixed access level. Callers cannot
turn a private namespace into a public upload.

## Logical namespaces

| Namespace | Access | Maximum size |
| --- | --- | ---: |
| `mortgage-source-documents` | private | 20 MiB |
| `mortgage-bank-logos` | public | 2 MiB |
| `crm-case-documents` | private | 25 MiB |
| `crm-property-images` | private | 8 MiB |
| `facility-images` | private | 8 MiB |
| `expert-brand-assets` | public | 5 MiB |
| `mortgage-bank-files` | private | 50 MiB |

Allowed MIME types live in the namespace registry and are validated before
provider calls.

Objects use this physical layout:

```text
public store/bucket
├── mortgage-bank-logos/<existing storage_path>
└── expert-brand-assets/<existing storage_path>

private store/bucket
├── mortgage-source-documents/<existing storage_path>
├── crm-case-documents/<existing storage_path>
├── crm-property-images/<existing storage_path>
├── facility-images/<existing storage_path>
└── mortgage-bank-files/<existing storage_path>
```

## Core API

```ts
import {
  createStorageClient,
  createVercelBlobStorageProvider,
} from '@openexpert/storage'

const provider = createVercelBlobStorageProvider({
  stores: {
    public: {
      storeId: runtimeConfig.vercelBlobPublicStoreId,
      oidcToken: process.env.VERCEL_OIDC_TOKEN,
    },
    private: {
      storeId: runtimeConfig.vercelBlobPrivateStoreId,
      oidcToken: process.env.VERCEL_OIDC_TOKEN,
    },
  },
})

const storage = createStorageClient(provider)

await storage.upload({
  namespace: 'crm-case-documents',
  path: `${organizationId}/${caseId}/${fileName}`,
  body: file,
  contentType: file.type,
  size: file.size,
})

const download = await storage.download({
  namespace: 'crm-case-documents',
  path: storagePath,
})

const page = await storage.list({
  namespace: 'crm-case-documents',
  prefix: `${organizationId}/${caseId}/`,
  limit: 100,
})

const signed = await storage.createSignedUrl({
  namespace: 'crm-case-documents',
  path: storagePath,
  expiresInSeconds: 15 * 60,
})

await storage.delete({
  namespace: 'crm-case-documents',
  path: storagePath,
})
```

Vercel Blob access is fixed at store creation time, so production needs two
stores. OIDC can use the same project token with two distinct store IDs.
Alternatively, pass a distinct read-write `token` for each store. When using a
token without `storeId`, set `publicBaseUrl` on the public store if
`getPublicUrl` is needed.

## Local MinIO

Create one anonymous-read bucket and one private bucket, then configure:

```ts
import {
  createMinioStorageProvider,
  createStorageClient,
} from '@openexpert/storage'

const storage = createStorageClient(createMinioStorageProvider({
  endpoint: 'http://127.0.0.1:9000',
  accessKeyId: process.env.MINIO_ACCESS_KEY!,
  secretAccessKey: process.env.MINIO_SECRET_KEY!,
  publicBucket: 'openexpert-public',
  privateBucket: 'openexpert-private',
  publicBaseUrl: 'http://127.0.0.1:9000/openexpert-public',
}))
```

`createMinioStorageProvider` enables path-style S3 addressing and defaults to
the endpoint above, region `us-east-1`, and the two bucket names in the example.
Bucket creation and anonymous-read policy are infrastructure responsibilities;
the package never broadens a bucket policy at runtime.

## Bucket adapter

For concise bucket-oriented call sites:

```ts
import {
  createStorageBucketAdapter,
  createStorageClient,
} from '@openexpert/storage'

const storage = createStorageBucketAdapter(
  createStorageClient(provider),
)

const { data, error } = await storage
  .from('crm-case-documents')
  .upload(storagePath, bytes, {
    contentType: 'application/pdf',
    cacheControl: '0',
    upsert: false,
  })
```

The adapter implements:

- `from(bucket).upload(path, body, options)`
- `from(bucket).download(path)`
- `from(bucket).remove(paths)`
- `from(bucket).createSignedUrl(path, expiresIn, options)`
- `from(bucket).getPublicUrl(path, options)`

Async methods return `{ data, error }`. `getPublicUrl` is synchronous and also
includes `error`, while retaining `result.data.publicUrl` compatibility.

Adapter notes:

- Image `transform` options are accepted but ignored. The signed URL
  serves the original object.
- Vercel Blob has a 60-second minimum cache age. A `cacheControl: "0"`
  is therefore clamped to 60 seconds instead of falling back to a longer
  provider default.
- `download` buffers the core stream into a `Blob`, matching existing call
  sites that use `blob.arrayBuffer()`. New code should use the streaming core
  API for large files.

## Security boundary

All object paths are relative POSIX paths. Absolute paths, empty segments,
backslashes, `.`/`..`, control characters, invalid percent encoding, and
encoded traversal/separators are rejected before a provider call.

This package controls storage addressing, not application authorization.
Server routes must still verify organization, case, facility, or admin access
before calling it or issuing a signed URL. Signed URLs are limited to seven
days by the common API.

## Workspace integration

An application can add `"@openexpert/storage": "workspace:*"` to its own
`package.json`, configure the appropriate provider in a server-only helper,
and expose it through the bucket adapter. Run the normal
workspace install afterwards so pnpm records the package dependencies in the
lockfile.
