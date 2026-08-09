import type { DocumentTemplate } from '@openexpert/multiform'
import { createHash } from 'node:crypto'
import { createError } from 'h3'
import { mortgageBankFileBucket } from './mortgage-bank-files'
import {
  normalizeMortgageTemplatePdfAsset,
  validateMortgageTemplatePdf,
} from './mortgage-template-source'

type BackendDataClient = any
type DatabaseRecord = Record<string, any>
const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const maxTemplateBytes = 25 * 1024 * 1024

function validateXlsx(bytes: Uint8Array, checksum: string) {
  return bytes.byteLength > 0
    && bytes.byteLength <= maxTemplateBytes
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && createHash('sha256').update(bytes).digest('hex') === checksum
}

export interface MortgageDocumentTemplateCatalogSource {
  source_file_id?: string | null
  source_file_version_id?: string | null
  source_file_name?: string | null
  source_sha256?: string | null
}

export function mortgageDocumentTemplateSourceDescriptor(
  bankSlug: string,
  row: MortgageDocumentTemplateCatalogSource | null | undefined,
  registered: DocumentTemplate | undefined,
) {
  if (
    row?.source_file_id
    && row.source_file_version_id
    && row.source_file_name
    && row.source_sha256
  ) {
    return {
      bankSlug,
      fileName: String(row.source_file_name),
      sha256: String(row.source_sha256),
      mimeType: registered?.source.mimeType ?? 'application/pdf',
    }
  }
  return registered
    ? {
        bankSlug: registered.bank,
        fileName: registered.source.fileName,
        sha256: registered.source.sha256,
        mimeType: registered.source.mimeType ?? 'application/pdf',
      }
    : undefined
}

export async function loadMortgageDocumentTemplateSource(
  backendData: BackendDataClient,
  row: MortgageDocumentTemplateCatalogSource | null | undefined,
  registered: DocumentTemplate | undefined,
) {
  if (row?.source_file_id && row.source_file_version_id) {
    const versionResult = await backendData
      .from('mortgage_bank_file_versions')
      .select('id, file_id, storage_path, original_file_name, mime_type, checksum_sha256')
      .eq('id', row.source_file_version_id)
      .eq('file_id', row.source_file_id)
      .maybeSingle()
    if (versionResult.error) throw versionResult.error
    const version = versionResult.data as DatabaseRecord | null
    if (!version || !['application/pdf', xlsxMimeType].includes(String(version.mime_type))) {
      throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono źródłowej wersji dokumentu w plikach banku.' })
    }

    const downloadResult = await backendData.storage
      .from(mortgageBankFileBucket)
      .download(String(version.storage_path))
    if (downloadResult.error || !downloadResult.data) {
      throw createError({ statusCode: 404, statusMessage: 'Źródłowy dokument nie jest dostępny w magazynie plików banku.' })
    }
    const bytes = new Uint8Array(await downloadResult.data.arrayBuffer())
    const isPdf = version.mime_type === 'application/pdf'
    const validation = isPdf
      ? validateMortgageTemplatePdf(bytes, String(version.checksum_sha256))
      : { valid: validateXlsx(bytes, String(version.checksum_sha256)), reason: 'invalid' as const }
    if (!validation.valid) {
      throw createError({
        statusCode: validation.reason === 'too_large' ? 413 : 409,
        statusMessage: validation.reason === 'too_large'
          ? 'Źródłowy dokument przekracza limit 25 MB.'
          : 'Źródłowy dokument nie przeszedł weryfikacji integralności.',
      })
    }
    return {
      bytes,
      fileName: String(version.original_file_name),
      sha256: String(version.checksum_sha256),
      mimeType: String(version.mime_type),
      sourceKind: 'bank-file' as const,
    }
  }

  if (!registered) {
    throw createError({ statusCode: 404, statusMessage: 'Template nie ma źródłowego dokumentu w plikach banku.' })
  }
  const rawAsset = await useStorage('assets:mortgage-template-pdfs')
    .getItemRaw(registered.source.fileName)
  const bytes = normalizeMortgageTemplatePdfAsset(rawAsset)
  if (!bytes) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Źródłowy dokument nie został dołączony do wdrożenia CRM.',
    })
  }
  const registeredMimeType = registered.source.mimeType ?? 'application/pdf'
  const validation = registeredMimeType === 'application/pdf'
    ? validateMortgageTemplatePdf(bytes, registered.source.sha256)
    : { valid: validateXlsx(bytes, registered.source.sha256), reason: 'invalid' as const }
  if (!validation.valid) {
    throw createError({
      statusCode: validation.reason === 'too_large' ? 413 : 500,
      statusMessage: validation.reason === 'too_large'
        ? 'Źródłowy dokument przekracza limit 25 MB.'
        : 'Źródłowy dokument nie przeszedł weryfikacji integralności.',
    })
  }
  return {
    bytes,
    fileName: registered.source.fileName,
    sha256: registered.source.sha256,
    mimeType: registeredMimeType,
    sourceKind: 'registered' as const,
  }
}
