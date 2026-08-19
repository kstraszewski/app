import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertSafeStoragePath,
  assertSafeStoragePrefix,
  createInMemoryStorageProvider,
  createMinioStorageProvider,
  createStorageClient,
  createStorageBucketAdapter,
  createVercelBlobStorageProvider,
  getStorageNamespaceDefinition,
  STORAGE_NAMESPACES,
  StorageConfigurationError,
  StorageConflictError,
  StoragePathError,
  StorageUnsupportedError,
  StorageValidationError,
} from '../src/index.ts'

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  while (true) {
    const result = await reader.read()
    if (result.done) break
    chunks.push(result.value)
    size += result.value.byteLength
  }

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

test('declares the storage buckets as access-controlled namespaces', () => {
  assert.deepEqual(STORAGE_NAMESPACES, [
    'mortgage-source-documents',
    'mortgage-bank-logos',
    'crm-case-documents',
    'crm-legal-documents',
    'crm-message-attachments',
    'crm-mock-bank-outbox',
    'crm-property-images',
    'facility-images',
    'expert-brand-assets',
    'mortgage-bank-files',
  ])

  assert.equal(getStorageNamespaceDefinition('mortgage-bank-logos').access, 'public')
  assert.equal(getStorageNamespaceDefinition('expert-brand-assets').access, 'public')
  assert.equal(getStorageNamespaceDefinition('crm-case-documents').access, 'private')
  assert.deepEqual(
    getStorageNamespaceDefinition('crm-mock-bank-outbox'),
    {
      access: 'private',
      maxBytes: 5 * 1024 * 1024,
      allowedContentTypes: ['application/json', 'application/zip'],
    },
  )
  assert.deepEqual(
    getStorageNamespaceDefinition('crm-legal-documents'),
    {
      access: 'private',
      maxBytes: 5 * 1024 * 1024,
      allowedContentTypes: ['application/pdf'],
    },
  )
  assert.deepEqual(
    getStorageNamespaceDefinition('crm-message-attachments'),
    {
      access: 'private',
      maxBytes: 25 * 1024 * 1024,
      allowedContentTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'text/csv',
      ],
    },
  )
  assert.equal(getStorageNamespaceDefinition('mortgage-bank-files').maxBytes, 50 * 1024 * 1024)
})

test('rejects absolute, traversal, encoded traversal and ambiguous object paths', () => {
  const unsafePaths = [
    '',
    '../secret.pdf',
    'org/../secret.pdf',
    '/absolute.pdf',
    'C:/windows.pdf',
    'org\\..\\secret.pdf',
    'org//secret.pdf',
    '.',
    'org/%2e%2e/secret.pdf',
    'org/%252e%252e/secret.pdf',
    'org%2fsecret.pdf',
    'org%5csecret.pdf',
    'file.pdf?download=1',
    'file.pdf#fragment',
    'file\u0000.pdf',
    'invalid%',
  ]

  for (const path of unsafePaths) {
    assert.throws(
      () => assertSafeStoragePath(path),
      StoragePathError,
      `Expected "${path}" to be rejected`,
    )
  }

  assert.equal(assertSafeStoragePath('org/case/report 2026.pdf'), 'org/case/report 2026.pdf')
  assert.equal(assertSafeStoragePrefix('org/case/'), 'org/case/')
  assert.equal(assertSafeStoragePrefix(''), '')
})

test('uploads, downloads, signs and deletes public and private objects offline', async () => {
  const fixedNow = new Date('2026-07-30T12:00:00.000Z')
  const storage = createStorageClient(createInMemoryStorageProvider({
    now: () => fixedNow,
    signingSecret: 'offline-test-secret',
  }))

  const publicObject = await storage.upload({
    namespace: 'mortgage-bank-logos',
    path: 'organization/bank/logo.webp',
    body: new TextEncoder().encode('public logo'),
    contentType: 'image/webp',
  })
  const privateObject = await storage.upload({
    namespace: 'crm-case-documents',
    path: 'organization/case/contract.pdf',
    body: 'private contract',
    contentType: 'application/pdf',
  })

  assert.equal(publicObject.access, 'public')
  assert.equal(publicObject.path, 'organization/bank/logo.webp')
  assert.equal(privateObject.access, 'private')
  assert.equal(privateObject.size, 16)
  assert.deepEqual(privateObject.uploadedAt, fixedNow)

  const metadata = await storage.head({
    namespace: 'crm-case-documents',
    path: 'organization/case/contract.pdf',
  })
  assert.deepEqual(metadata, privateObject)
  assert.equal(await storage.head({
    namespace: 'crm-case-documents',
    path: 'organization/case/missing.pdf',
  }), null)

  const downloaded = await storage.download({
    namespace: 'crm-case-documents',
    path: 'organization/case/contract.pdf',
  })
  assert.ok(downloaded)
  assert.equal(
    new TextDecoder().decode(await readStream(downloaded.stream)),
    'private contract',
  )

  const publicUrl = await storage.createSignedUrl({
    namespace: 'mortgage-bank-logos',
    path: 'organization/bank/logo.webp',
    expiresInSeconds: 300,
  })
  const privateUrl = await storage.createSignedUrl({
    namespace: 'crm-case-documents',
    path: 'organization/case/contract.pdf',
    expiresInSeconds: 300,
  })

  assert.equal(publicUrl.method, 'GET')
  assert.equal(new URL(publicUrl.url).pathname.includes('/public/mortgage-bank-logos/'), true)
  assert.equal(new URL(privateUrl.url).pathname.includes('/private/crm-case-documents/'), true)
  assert.ok(new URL(privateUrl.url).searchParams.get('signature'))
  assert.equal(
    storage.getPublicUrl({
      namespace: 'mortgage-bank-logos',
      path: 'organization/bank/logo.webp',
    }),
    'memory://storage/public/mortgage-bank-logos/organization/bank/logo.webp',
  )
  assert.throws(
    () => storage.getPublicUrl({
      namespace: 'crm-case-documents',
      path: 'organization/case/contract.pdf',
    }),
    StorageValidationError,
  )

  await storage.delete({
    namespace: 'crm-case-documents',
    path: 'organization/case/contract.pdf',
  })
  assert.equal(await storage.download({
    namespace: 'crm-case-documents',
    path: 'organization/case/contract.pdf',
  }), null)
  assert.equal(await storage.head({
    namespace: 'crm-case-documents',
    path: 'organization/case/contract.pdf',
  }), null)
})

test('keeps identical paths isolated by logical namespace and access store', async () => {
  const storage = createStorageClient(createInMemoryStorageProvider())

  await storage.upload({
    namespace: 'mortgage-bank-logos',
    path: 'shared/object.webp',
    body: 'public',
    contentType: 'image/webp',
  })
  await storage.upload({
    namespace: 'expert-brand-assets',
    path: 'shared/object.webp',
    body: 'brand',
    contentType: 'image/webp',
  })
  await storage.upload({
    namespace: 'facility-images',
    path: 'shared/object.webp',
    body: 'private',
    contentType: 'image/webp',
  })

  const logos = await storage.list({ namespace: 'mortgage-bank-logos' })
  const brands = await storage.list({ namespace: 'expert-brand-assets' })
  const facilities = await storage.list({ namespace: 'facility-images' })

  assert.deepEqual(logos.objects.map(object => object.path), ['shared/object.webp'])
  assert.deepEqual(brands.objects.map(object => object.path), ['shared/object.webp'])
  assert.deepEqual(facilities.objects.map(object => object.path), ['shared/object.webp'])
  assert.equal(logos.objects[0]?.access, 'public')
  assert.equal(facilities.objects[0]?.access, 'private')
})

test('lists by safe prefix with opaque cursor pagination', async () => {
  const storage = createStorageClient(createInMemoryStorageProvider())

  for (const path of ['org/a.pdf', 'org/b.pdf', 'org/c.pdf', 'other/d.pdf']) {
    await storage.upload({
      namespace: 'crm-case-documents',
      path,
      body: path,
      contentType: 'application/pdf',
    })
  }

  const firstPage = await storage.list({
    namespace: 'crm-case-documents',
    prefix: 'org/',
    limit: 2,
  })
  assert.deepEqual(firstPage.objects.map(object => object.path), ['org/a.pdf', 'org/b.pdf'])
  assert.ok(firstPage.cursor)

  const secondPage = await storage.list({
    namespace: 'crm-case-documents',
    prefix: 'org/',
    cursor: firstPage.cursor,
    limit: 2,
  })
  assert.deepEqual(secondPage.objects.map(object => object.path), ['org/c.pdf'])
  assert.equal(secondPage.cursor, undefined)
})

test('enforces content type, size, cache and signed URL constraints before provider calls', async () => {
  const storage = createStorageClient(createInMemoryStorageProvider())

  await assert.rejects(
    storage.upload({
      namespace: 'facility-images',
      path: 'facility/photo.png',
      body: 'not webp',
      contentType: 'image/png',
    }),
    StorageValidationError,
  )

  await assert.rejects(
    storage.upload({
      namespace: 'facility-images',
      path: 'facility/photo.webp',
      body: new Uint8Array(1),
      contentType: 'image/webp',
      size: 2,
    }),
    /Declared size 2 does not match body size 1/,
  )

  await assert.rejects(
    storage.upload({
      namespace: 'mortgage-bank-logos',
      path: 'bank/logo.webp',
      body: new ReadableStream<Uint8Array>(),
      contentType: 'image/webp',
      size: 2 * 1024 * 1024 + 1,
    }),
    /Object exceeds/,
  )

  await assert.rejects(
    storage.upload({
      namespace: 'expert-brand-assets',
      path: 'brand/logo.webp',
      body: 'logo',
      contentType: 'image/webp',
      cacheControlMaxAge: 30,
    }),
    /cannot be lower than 60/,
  )

  await assert.rejects(
    storage.createSignedUrl({
      namespace: 'crm-case-documents',
      path: 'case/document.pdf',
      expiresInSeconds: 7 * 24 * 60 * 60 + 1,
    }),
    /cannot exceed/,
  )

  await assert.rejects(
    storage.createSignedUploadUrl({
      namespace: 'crm-message-attachments',
      path: 'case/attachment.svg',
      contentType: 'image/svg+xml',
      size: 1024,
    }),
    /is not allowed/,
  )

  await assert.rejects(
    storage.createSignedUploadUrl({
      namespace: 'crm-message-attachments',
      path: 'case/attachment.pdf',
      contentType: 'application/pdf',
      size: 25 * 1024 * 1024 + 1,
    }),
    /Object exceeds/,
  )

  await assert.rejects(
    storage.createSignedUploadUrl({
      namespace: 'crm-message-attachments',
      path: 'case/attachment.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresInSeconds: 15 * 60 + 1,
    }),
    /cannot exceed 900/,
  )

  await assert.rejects(
    storage.createSignedUploadUrl({
      namespace: 'crm-message-attachments',
      path: 'case/attachment.txt',
      contentType: 'text/plain; charset=utf-8',
      size: 1024,
      expiresInSeconds: 300,
    }),
    StorageUnsupportedError,
  )
})

test('supports sized streaming uploads and overwrite control', async () => {
  const storage = createStorageClient(createInMemoryStorageProvider())
  const bytes = new TextEncoder().encode('streamed')

  await storage.upload({
    namespace: 'mortgage-source-documents',
    path: 'catalog/source.txt',
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
    contentType: 'text/plain; charset=utf-8',
    size: bytes.byteLength,
  })

  await assert.rejects(
    storage.upload({
      namespace: 'mortgage-source-documents',
      path: 'catalog/source.txt',
      body: 'duplicate',
      contentType: 'text/plain',
    }),
    StorageConflictError,
  )

  const overwritten = await storage.upload({
    namespace: 'mortgage-source-documents',
    path: 'catalog/source.txt',
    body: 'replacement',
    contentType: 'text/plain',
    overwrite: true,
  })
  assert.equal(overwritten.size, 11)
  assert.equal(overwritten.contentType, 'text/plain')
})

test('validates external provider topology without loading either network SDK', () => {
  const vercel = createVercelBlobStorageProvider({
    stores: {
      public: { storeId: 'store_public' },
      private: { storeId: 'store_private' },
    },
  })
  const minio = createMinioStorageProvider({
    accessKeyId: 'openexpert',
    secretAccessKey: 'local-secret',
  })

  assert.equal(vercel.kind, 'vercel-blob')
  assert.equal(minio.kind, 's3')

  assert.throws(
    () => createVercelBlobStorageProvider({
      stores: {
        public: { storeId: 'store_same' },
        private: { storeId: 'store_same' },
      },
    }),
    StorageConfigurationError,
  )

  assert.throws(
    () => createMinioStorageProvider({
      accessKeyId: 'openexpert',
      secretAccessKey: 'local-secret',
      publicBucket: 'same-bucket',
      privateBucket: 'same-bucket',
    }),
    StorageConfigurationError,
  )
})

test('creates a constrained browser PUT URL for S3-compatible storage', async () => {
  const storage = createStorageClient(createMinioStorageProvider({
    accessKeyId: 'openexpert',
    secretAccessKey: 'local-secret',
  }))
  const startedAt = Date.now()
  const upload = await storage.createSignedUploadUrl({
    namespace: 'crm-message-attachments',
    path: 'organization/case/conversation/attachment.pdf',
    contentType: 'application/pdf; charset=binary',
    size: 123,
    expiresInSeconds: 300,
  })

  const url = new URL(upload.url)
  assert.equal(upload.method, 'PUT')
  assert.equal(
    url.pathname,
    '/openexpert-private/crm-message-attachments/organization/case/conversation/attachment.pdf',
  )
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300')
  assert.deepEqual(
    new Set(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')),
    new Set([
      'cache-control',
      'content-length',
      'content-type',
      'host',
      'if-none-match',
    ]),
  )
  assert.equal(url.searchParams.has('x-amz-checksum-crc32'), false)
  assert.deepEqual(upload.headers, {
    'cache-control': 'private, max-age=60',
    'content-type': 'application/pdf',
    'if-none-match': '*',
  })
  assert.ok(upload.expiresAt.getTime() >= startedAt + 300_000)
  assert.ok(upload.expiresAt.getTime() <= Date.now() + 300_000)
})

test('offers a provider-neutral from(bucket) adapter with data/error results', async () => {
  const storage = createStorageClient(createInMemoryStorageProvider({
    signingSecret: 'compatibility-test-secret',
  }))
  const compatibleStorage = createStorageBucketAdapter(storage)
  const bucket = compatibleStorage.from('mortgage-bank-logos')

  const upload = await bucket.upload('org/bank/logo.webp', 'logo bytes', {
    cacheControl: '0',
    contentType: 'image/webp',
    upsert: false,
  })
  assert.equal(upload.error, null)
  assert.deepEqual(upload.data && {
    path: upload.data.path,
    fullPath: upload.data.fullPath,
  }, {
    path: 'org/bank/logo.webp',
    fullPath: 'mortgage-bank-logos/org/bank/logo.webp',
  })

  const publicUrl = bucket.getPublicUrl('org/bank/logo.webp')
  assert.equal(publicUrl.error, null)
  assert.equal(
    publicUrl.data.publicUrl,
    'memory://storage/public/mortgage-bank-logos/org/bank/logo.webp',
  )

  const signed = await bucket.createSignedUrl('org/bank/logo.webp', 60, {
    download: true,
    transform: {
      width: 192,
      height: 144,
      resize: 'cover',
      quality: 72,
    },
  })
  assert.equal(signed.error, null)
  assert.equal(
    signed.data ? new URL(signed.data.signedUrl).searchParams.get('download') : null,
    '1',
  )

  const download = await bucket.download('org/bank/logo.webp')
  assert.equal(download.error, null)
  assert.equal(download.data ? await download.data.text() : null, 'logo bytes')

  const duplicate = await bucket.upload('org/bank/logo.webp', 'new logo', {
    contentType: 'image/webp',
  })
  assert.ok(duplicate.error instanceof StorageConflictError)
  assert.equal(duplicate.data, null)

  const overwrite = await bucket.upload('org/bank/logo.webp', 'new logo', {
    contentType: 'image/webp',
    upsert: true,
  })
  assert.equal(overwrite.error, null)

  const removed = await bucket.remove(['org/bank/logo.webp'])
  assert.deepEqual(removed, {
    data: [{ name: 'org/bank/logo.webp' }],
    error: null,
  })

  const missing = await bucket.download('org/bank/logo.webp')
  assert.equal(missing.data, null)
  assert.ok(missing.error)
})

test('compatibility adapter reports invalid buckets and paths without throwing', async () => {
  const compatibleStorage = createStorageBucketAdapter(
    createStorageClient(createInMemoryStorageProvider()),
  )

  const invalidBucket = await compatibleStorage
    .from('unknown-bucket')
    .download('file.pdf')
  assert.equal(invalidBucket.data, null)
  assert.ok(invalidBucket.error)

  const traversal = await compatibleStorage
    .from('crm-case-documents')
    .upload('../secret.pdf', 'secret', {
      contentType: 'application/pdf',
    })
  assert.equal(traversal.data, null)
  assert.ok(traversal.error instanceof StoragePathError)

  const privatePublicUrl = compatibleStorage
    .from('crm-case-documents')
    .getPublicUrl('case/document.pdf')
  assert.equal(privatePublicUrl.data.publicUrl, '')
  assert.ok(privatePublicUrl.error)
})
