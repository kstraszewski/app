import type { DocumentTemplate } from '@openexpert/multiform'
import { createError } from 'h3'
import { mortgageBankFileBucket } from './mortgage-bank-files'
import {
  normalizeMortgageTemplatePdfAsset,
  validateMortgageTemplatePdf,
} from './mortgage-template-source'

type BackendDataClient = any
type DatabaseRecord = Record<string, any>

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
    }
  }
  return registered
    ? {
        bankSlug: registered.bank,
        fileName: registered.source.fileName,
        sha256: registered.source.sha256,
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
    if (!version || version.mime_type !== 'application/pdf') {
      throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono źródłowej wersji PDF w plikach banku.' })
    }

    const downloadResult = await backendData.storage
      .from(mortgageBankFileBucket)
      .download(String(version.storage_path))
    if (downloadResult.error || !downloadResult.data) {
      throw createError({ statusCode: 404, statusMessage: 'Źródłowy PDF nie jest dostępny w magazynie plików banku.' })
    }
    const bytes = new Uint8Array(await downloadResult.data.arrayBuffer())
    const validation = validateMortgageTemplatePdf(bytes, String(version.checksum_sha256))
    if (!validation.valid) {
      throw createError({
        statusCode: validation.reason === 'too_large' ? 413 : 409,
        statusMessage: validation.reason === 'too_large'
          ? 'Źródłowy PDF przekracza limit 25 MB.'
          : 'Źródłowy PDF nie przeszedł weryfikacji integralności.',
      })
    }
    return {
      bytes,
      fileName: String(version.original_file_name),
      sha256: String(version.checksum_sha256),
      sourceKind: 'bank-file' as const,
    }
  }

  if (!registered) {
    throw createError({ statusCode: 404, statusMessage: 'Template nie ma źródłowego PDF-u w plikach banku.' })
  }
  const rawAsset = await useStorage('assets:mortgage-template-pdfs')
    .getItemRaw(registered.source.fileName)
  const bytes = normalizeMortgageTemplatePdfAsset(rawAsset)
  if (!bytes) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Źródłowy formularz PDF nie został dołączony do wdrożenia CRM.',
    })
  }
  const validation = validateMortgageTemplatePdf(bytes, registered.source.sha256)
  if (!validation.valid) {
    throw createError({
      statusCode: validation.reason === 'too_large' ? 413 : 500,
      statusMessage: validation.reason === 'too_large'
        ? 'Źródłowy PDF przekracza limit 25 MB.'
        : 'Źródłowy PDF nie przeszedł weryfikacji integralności.',
    })
  }
  return {
    bytes,
    fileName: registered.source.fileName,
    sha256: registered.source.sha256,
    sourceKind: 'registered' as const,
  }
}
