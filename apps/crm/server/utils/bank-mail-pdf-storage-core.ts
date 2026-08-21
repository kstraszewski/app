import { createHash } from 'node:crypto'
import type { StorageClient } from '@openexpert/storage'
import { BankMailPdfProcessingError } from './bank-mail-pdf-attachment-core.ts'
import { MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES } from './openexpert-mock-bank-documents.ts'

async function readStoredPdf(
  storage: StorageClient,
  path: string,
): Promise<{ bytes: Uint8Array, sha256: string } | null> {
  const stored = await storage.download({
    namespace: 'crm-case-documents',
    path,
  })
  if (!stored) return null
  if (
    stored.object.contentType !== 'application/pdf'
    || !Number.isSafeInteger(stored.object.size)
    || stored.object.size < 5
    || stored.object.size > MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES
  ) {
    throw new BankMailPdfProcessingError('storage_object_conflict', false)
  }
  const reader = stored.stream.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      if (!(item.value instanceof Uint8Array)
        || totalBytes + item.value.byteLength > MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new BankMailPdfProcessingError('storage_object_conflict', false)
      }
      totalBytes += item.value.byteLength
      chunks.push(item.value.slice())
    }
  }
  finally {
    reader.releaseLock()
  }
  if (totalBytes !== stored.object.size) {
    throw new BankMailPdfProcessingError('storage_object_conflict', false)
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

/**
 * Persists the deterministic private PDF and verifies the immutable object.
 * An exact readback is authoritative even if the upload response was lost.
 * A missing readback is retryable because the upload may not have committed or
 * the provider may still be eventually consistent. Only an existing object
 * with different metadata or bytes is a permanent deterministic conflict.
 */
export async function persistExactBankMailPdf(input: {
  storage: StorageClient
  path: string
  bytes: Uint8Array
  sha256: string
}): Promise<void> {
  try {
    await input.storage.upload({
      namespace: 'crm-case-documents',
      path: input.path,
      body: input.bytes,
      contentType: 'application/pdf',
      size: input.bytes.byteLength,
      overwrite: false,
    })
  }
  catch {
    // The provider may have committed an immutable object and lost the
    // response. The exact readback below is the only safe recovery record.
  }

  let stored: Awaited<ReturnType<typeof readStoredPdf>>
  try {
    stored = await readStoredPdf(input.storage, input.path)
  }
  catch (error) {
    if (error instanceof BankMailPdfProcessingError) throw error
    throw new BankMailPdfProcessingError('storage_unavailable', true)
  }
  if (!stored) {
    throw new BankMailPdfProcessingError('storage_unavailable', true)
  }
  if (
    stored.bytes.byteLength !== input.bytes.byteLength
    || stored.sha256 !== input.sha256
  ) {
    // Never remove an unexpected deterministic object here. The database
    // reservation/publish RPC owns reconciliation with a winning prior attempt.
    throw new BankMailPdfProcessingError('storage_object_conflict', false)
  }
}
