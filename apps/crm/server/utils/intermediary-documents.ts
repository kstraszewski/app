import { createHash } from 'node:crypto'
import { cloneDefaultOrganizationDesign, normalizeOrganizationDesign } from '#shared/design'
import { normalizeIntermediarySettings } from '#shared/intermediary-settings'
import {
  buildIntermediaryDocumentContent,
  intermediaryDocumentKinds,
  type IntermediaryDocumentKind,
} from './intermediary-document-content.ts'
import { generateIntermediaryDocumentPdf } from './intermediary-document-pdf.ts'

const INTERMEDIARY_DOCUMENT_FONT_FILE = 'DMSans-VariableFont_opsz,wght.ttf'

function bytesFromAsset(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (typeof value === 'string') return new TextEncoder().encode(value)
  throw new Error('Font generatora dokumentów OFI/RODO nie jest dostępny.')
}

let documentFontPromise: Promise<Uint8Array> | undefined

export function intermediaryDocumentKind(value: unknown): IntermediaryDocumentKind | null {
  return typeof value === 'string'
    && intermediaryDocumentKinds.includes(value as IntermediaryDocumentKind)
    ? value as IntermediaryDocumentKind
    : null
}

export async function loadIntermediaryDocumentFont(): Promise<Uint8Array> {
  documentFontPromise ??= useStorage('assets:intermediary-document-fonts')
    .getItemRaw(INTERMEDIARY_DOCUMENT_FONT_FILE)
    .then(bytesFromAsset)
  return documentFontPromise
}

export async function createIntermediaryDocument(input: {
  kind: IntermediaryDocumentKind
  settings: unknown
  design?: unknown
  organizationName: string
  revision: number
  generatedAt: string
  fontBytes?: Uint8Array
}) {
  const settings = normalizeIntermediarySettings(input.settings)
  const design = input.design === undefined
    ? cloneDefaultOrganizationDesign()
    : normalizeOrganizationDesign(input.design)
  const content = buildIntermediaryDocumentContent({
    kind: input.kind,
    settings,
    organizationName: input.organizationName,
    revision: input.revision,
    generatedAt: input.generatedAt,
  })
  const bytes = await generateIntermediaryDocumentPdf(content, {
    fontBytes: input.fontBytes ?? await loadIntermediaryDocumentFont(),
    primaryColor: design.colors.light.primary,
  })
  return {
    bytes,
    content,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    fileName: input.kind === 'ofi'
      ? `OFI-${input.organizationName || 'organizacja'}.pdf`
      : `RODO-${input.organizationName || 'organizacja'}.pdf`,
  }
}
