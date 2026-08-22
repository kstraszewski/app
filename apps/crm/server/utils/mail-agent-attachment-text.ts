import {
  Uint8ArrayReader,
  ZipReader,
  type FileEntry,
} from '@zip.js/zip.js'

export const MAIL_AGENT_ATTACHMENT_MAX_INPUT_BYTES = 8 * 1024 * 1024
export const MAIL_AGENT_ATTACHMENT_MAX_TEXT_CHARACTERS = 200_000
export const MAIL_AGENT_ATTACHMENT_MAX_PDF_PAGES = 200
export const MAIL_AGENT_ATTACHMENT_MAX_ARCHIVE_ENTRIES = 256
export const MAIL_AGENT_ATTACHMENT_MAX_ARCHIVE_UNCOMPRESSED_BYTES = 24 * 1024 * 1024
export const MAIL_AGENT_ATTACHMENT_MAX_SELECTED_XML_BYTES = 12 * 1024 * 1024

export type MailAgentAttachmentTextStatus = 'ok' | 'unsupported' | 'no_text'

export type MailAgentAttachmentKind =
  | 'pdf'
  | 'plain_text'
  | 'csv'
  | 'json'
  | 'xml'
  | 'html'
  | 'markdown'
  | 'docx'
  | 'xlsx'
  | 'legacy_office'
  | 'image'
  | 'archive'
  | 'unknown'

export type MailAgentAttachmentTextReason =
  | 'empty_input'
  | 'input_too_large'
  | 'unsupported_type'
  | 'legacy_office_not_supported'
  | 'image_requires_ocr'
  | 'archive_not_supported'
  | 'encrypted_document'
  | 'unreadable_document'
  | 'no_extractable_text'
  | 'archive_entry_limit'
  | 'archive_size_limit'
  | 'archive_xml_limit'
  | 'missing_document_xml'
  | 'text_limit'
  | 'page_limit'

export interface MailAgentAttachmentTextResult {
  status: MailAgentAttachmentTextStatus
  kind: MailAgentAttachmentKind
  text: string
  pageCount?: number
  truncated: boolean
  reason?: MailAgentAttachmentTextReason
}

export interface MailAgentAttachmentTextInput {
  bytes: Uint8Array
  fileName?: string | null
  mimeType?: string | null
}

export interface MailAgentAttachmentExcerpt {
  text: string
  start: number
  end: number
  score: number
}

export interface MailAgentAttachmentExcerptOptions {
  maxExcerpts?: number
  maxExcerptCharacters?: number
  maxTotalCharacters?: number
}

type TextAttachmentKind = Extract<
  MailAgentAttachmentKind,
  'plain_text' | 'csv' | 'json' | 'xml' | 'html' | 'markdown'
>

interface CappedText {
  text: string
  truncated: boolean
}

interface ArchiveText {
  text: string
  truncated: boolean
}

interface CandidateExcerpt {
  text: string
  start: number
  end: number
  score: number
}

const ZIP_LOCAL_FILE_HEADER = [0x50, 0x4b, 0x03, 0x04] as const
const ZIP_EMPTY_ARCHIVE_HEADER = [0x50, 0x4b, 0x05, 0x06] as const
const ZIP_SPANNED_ARCHIVE_HEADER = [0x50, 0x4b, 0x07, 0x08] as const
const OLE_COMPOUND_HEADER = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d] as const
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const LEGACY_OFFICE_MIMES = new Set([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-office',
  'application/x-ole-storage',
])
const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-zip',
  'application/x-zip-compressed',
  'multipart/x-zip',
])
const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
])
const ARCHIVE_EXTENSIONS = new Set(['7z', 'gz', 'rar', 'tar', 'zip'])
const TEXT_EXTENSION_KINDS: Readonly<Record<string, TextAttachmentKind>> = {
  csv: 'csv',
  htm: 'html',
  html: 'html',
  json: 'json',
  jsonl: 'json',
  log: 'plain_text',
  markdown: 'markdown',
  md: 'markdown',
  txt: 'plain_text',
  tsv: 'csv',
  xml: 'xml',
}
const QUESTION_STOP_WORDS = new Set([
  'about',
  'albo',
  'also',
  'oraz',
  'bardzo',
  'byla',
  'bylo',
  'byly',
  'czy',
  'dla',
  'from',
  'gdzie',
  'have',
  'jak',
  'jaka',
  'jakie',
  'jaki',
  'jest',
  'ktora',
  'ktore',
  'ktory',
  'mail',
  'maila',
  'mnie',
  'or',
  'oraz',
  'przez',
  'that',
  'the',
  'this',
  'what',
  'with',
  'wyslal',
  'wyslala',
  'zalacznik',
  'zalacznika',
  'zalaczniku',
])

class ArchiveExtractionError extends Error {
  readonly reason: MailAgentAttachmentTextReason

  constructor(reason: MailAgentAttachmentTextReason) {
    super(reason)
    this.name = 'ArchiveExtractionError'
    this.reason = reason
  }
}

function controlledResult(
  status: MailAgentAttachmentTextStatus,
  kind: MailAgentAttachmentKind,
  reason: MailAgentAttachmentTextReason,
  options: { pageCount?: number, truncated?: boolean } = {},
): MailAgentAttachmentTextResult {
  return {
    status,
    kind,
    text: '',
    ...(options.pageCount === undefined ? {} : { pageCount: options.pageCount }),
    truncated: options.truncated ?? false,
    reason,
  }
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.byteLength < prefix.length) return false
  return prefix.every((value, index) => bytes[index] === value)
}

function hasZipHeader(bytes: Uint8Array): boolean {
  return startsWithBytes(bytes, ZIP_LOCAL_FILE_HEADER)
    || startsWithBytes(bytes, ZIP_EMPTY_ARCHIVE_HEADER)
    || startsWithBytes(bytes, ZIP_SPANNED_ARCHIVE_HEADER)
}

function hasImageHeader(bytes: Uint8Array): boolean {
  return startsWithBytes(bytes, PNG_HEADER)
    || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    || (
      bytes[0] === 0x52
      && bytes[1] === 0x49
      && bytes[2] === 0x46
      && bytes[3] === 0x46
      && bytes[8] === 0x57
      && bytes[9] === 0x45
      && bytes[10] === 0x42
      && bytes[11] === 0x50
    )
}

function normalizedMimeType(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
    : ''
}

function filenameExtension(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  const name = value.trim().toLowerCase()
  const finalSegment = name.split(/[\\/]/u).pop() ?? ''
  const dot = finalSegment.lastIndexOf('.')
  return dot > -1 && dot < finalSegment.length - 1 ? finalSegment.slice(dot + 1) : ''
}

function textKindFromMime(mimeType: string): TextAttachmentKind | null {
  if (mimeType === 'text/csv' || mimeType === 'text/tab-separated-values') return 'csv'
  if (mimeType === 'application/json' || mimeType.endsWith('+json')) return 'json'
  if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') return 'html'
  if (mimeType === 'text/markdown' || mimeType === 'text/x-markdown') return 'markdown'
  if (mimeType === 'application/xml' || mimeType === 'text/xml' || mimeType.endsWith('+xml')) {
    return 'xml'
  }
  return mimeType.startsWith('text/') ? 'plain_text' : null
}

function inferAttachmentKind(input: MailAgentAttachmentTextInput): MailAgentAttachmentKind {
  const mimeType = normalizedMimeType(input.mimeType)
  const extension = filenameExtension(input.fileName)
  const { bytes } = input

  if (
    startsWithBytes(bytes, OLE_COMPOUND_HEADER)
    || extension === 'doc'
    || extension === 'xls'
    || LEGACY_OFFICE_MIMES.has(mimeType)
  ) return 'legacy_office'

  if (
    mimeType.startsWith('image/')
    || IMAGE_EXTENSIONS.has(extension)
    || hasImageHeader(bytes)
  ) return 'image'

  if (startsWithBytes(bytes, PDF_HEADER) || mimeType === 'application/pdf' || extension === 'pdf') {
    return 'pdf'
  }
  if (mimeType === DOCX_MIME || extension === 'docx') return 'docx'
  if (mimeType === XLSX_MIME || extension === 'xlsx') return 'xlsx'
  if (hasZipHeader(bytes) || ARCHIVE_MIMES.has(mimeType) || ARCHIVE_EXTENSIONS.has(extension)) {
    return 'archive'
  }

  const extensionKind = TEXT_EXTENSION_KINDS[extension]
  if (extensionKind) return extensionKind
  return textKindFromMime(mimeType) ?? 'unknown'
}

function normalizeExtractedText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, ' ')
    .replace(/[\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function capText(value: string, alreadyTruncated = false): CappedText {
  const normalized = normalizeExtractedText(value)
  if (normalized.length <= MAIL_AGENT_ATTACHMENT_MAX_TEXT_CHARACTERS) {
    return { text: normalized, truncated: alreadyTruncated }
  }

  let end = MAIL_AGENT_ATTACHMENT_MAX_TEXT_CHARACTERS
  if (/^[\uDC00-\uDFFF]$/u.test(normalized[end] ?? '')) end -= 1
  const capped = normalized.slice(0, end).trimEnd()
  return { text: capped, truncated: true }
}

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|apos|gt|lt|nbsp|quot);/giu,
    (entity) => {
      const normalized = entity.toLowerCase()
      if (normalized === '&amp;') return '&'
      if (normalized === '&apos;') return "'"
      if (normalized === '&gt;') return '>'
      if (normalized === '&lt;') return '<'
      if (normalized === '&nbsp;') return ' '
      if (normalized === '&quot;') return '"'

      const hex = normalized.startsWith('&#x')
      const codePoint = Number.parseInt(
        normalized.slice(hex ? 3 : 2, -1),
        hex ? 16 : 10,
      )
      if (
        !Number.isInteger(codePoint)
        || codePoint < 0
        || codePoint > 0x10ffff
        || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) return '\uFFFD'
      return String.fromCodePoint(codePoint)
    },
  )
}

function removeMarkup(value: string, html: boolean): string {
  let text = value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/giu, '$1')
    .replace(/<!--([\s\S]*?)-->/gu, ' ')

  if (html) {
    text = text
      .replace(/<(?:script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template|svg)\s*>/giu, ' ')
      .replace(/<(?:br|hr)\b[^>]*\/?\s*>/giu, '\n')
      .replace(/<\/(?:address|article|aside|blockquote|div|dl|fieldset|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)\s*>/giu, '\n')
      .replace(/<\/(?:td|th)\s*>/giu, '\t')
  }

  return decodeXmlEntities(
    text
      .replace(/<\?[\s\S]{0,4096}?\?>/gu, ' ')
      .replace(/<![^>]{0,4096}>/gu, ' ')
      .replace(/<[^>]{0,4096}>/gu, html ? ' ' : '\n'),
  )
}

function utf16WithoutBom(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sampleLength = Math.min(bytes.byteLength - (bytes.byteLength % 2), 512)
  if (sampleLength < 8) return null
  let evenNulls = 0
  let oddNulls = 0
  for (let index = 0; index < sampleLength; index += 2) {
    if (bytes[index] === 0) evenNulls += 1
    if (bytes[index + 1] === 0) oddNulls += 1
  }
  const pairs = sampleLength / 2
  if (oddNulls / pairs > 0.3 && evenNulls / pairs < 0.05) return 'utf-16le'
  if (evenNulls / pairs > 0.3 && oddNulls / pairs < 0.05) return 'utf-16be'
  return null
}

function looksReadable(value: string): boolean {
  if (!value.trim()) return true
  const sample = value.slice(0, 16_384)
  let suspicious = 0
  for (const character of sample) {
    const codePoint = character.codePointAt(0) ?? 0
    if (
      codePoint === 0
      || codePoint === 0xfffd
      || (codePoint < 0x20 && character !== '\n' && character !== '\r' && character !== '\t')
      || (codePoint >= 0x7f && codePoint <= 0x9f)
    ) suspicious += 1
  }
  return suspicious / Math.max(1, sample.length) <= 0.01
}

function decodeTextBytes(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0) return ''
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      const decoded = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.slice(2))
      return looksReadable(decoded) ? decoded : null
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      const decoded = new TextDecoder('utf-16be', { fatal: true }).decode(bytes.slice(2))
      return looksReadable(decoded) ? decoded : null
    }
    const inferredUtf16 = utf16WithoutBom(bytes)
    if (inferredUtf16) {
      const decoded = new TextDecoder(inferredUtf16, { fatal: true }).decode(bytes)
      return looksReadable(decoded) ? decoded : null
    }
    const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(start))
    return looksReadable(decoded) ? decoded : null
  }
  catch {
    try {
      const decoded = new TextDecoder('windows-1250', { fatal: true }).decode(bytes)
      return looksReadable(decoded) ? decoded : null
    }
    catch {
      return null
    }
  }
}

function successfulTextResult(
  kind: MailAgentAttachmentKind,
  capped: CappedText,
  options: { pageCount?: number, reason?: MailAgentAttachmentTextReason } = {},
): MailAgentAttachmentTextResult {
  if (!capped.text) {
    return controlledResult('no_text', kind, 'no_extractable_text', {
      pageCount: options.pageCount,
      truncated: capped.truncated,
    })
  }
  return {
    status: 'ok',
    kind,
    text: capped.text,
    ...(options.pageCount === undefined ? {} : { pageCount: options.pageCount }),
    truncated: capped.truncated,
    ...(options.reason ? { reason: options.reason } : {}),
  }
}

function extractTextAttachment(
  bytes: Uint8Array,
  kind: TextAttachmentKind,
): MailAgentAttachmentTextResult {
  const decoded = decodeTextBytes(bytes)
  if (decoded === null) return controlledResult('no_text', kind, 'unreadable_document')
  const visibleText = kind === 'html'
    ? removeMarkup(decoded, true)
    : kind === 'xml'
      ? removeMarkup(decoded, false)
      : decoded
  const capped = capText(visibleText)
  return successfulTextResult(kind, capped, {
    reason: capped.truncated ? 'text_limit' : undefined,
  })
}

function ensurePdfJsGlobals(): void {
  const globals = globalThis as unknown as Record<string, unknown>
  globals.DOMMatrix ||= class DOMMatrix { constructor(..._args: unknown[]) {} }
  globals.Path2D ||= class Path2D { constructor(..._args: unknown[]) {} }
}

function boundedPdfPageText(items: readonly unknown[]): CappedText {
  const maximum = MAIL_AGENT_ATTACHMENT_MAX_TEXT_CHARACTERS + 4_096
  const parts: string[] = []
  let currentLine = ''
  let length = 0
  let truncated = false

  const flushLine = () => {
    if (!currentLine) return
    parts.push(currentLine)
    length += currentLine.length
    currentLine = ''
  }

  for (const item of items) {
    if (!item || typeof item !== 'object' || !('str' in item)) continue
    const value = String((item as { str?: unknown }).str ?? '').trim()
    if (value) {
      const separator = currentLine ? ' ' : ''
      const remaining = maximum - length - currentLine.length - separator.length
      if (remaining <= 0) {
        truncated = true
        break
      }
      currentLine += separator + value.slice(0, remaining)
      if (value.length > remaining) truncated = true
    }
    if ('hasEOL' in item && Boolean((item as { hasEOL?: unknown }).hasEOL)) {
      flushLine()
      parts.push('\n')
      length += 1
    }
    if (truncated) break
  }
  flushLine()
  return { text: normalizeExtractedText(parts.join('')), truncated }
}

async function extractPdfAttachment(bytes: Uint8Array): Promise<MailAgentAttachmentTextResult> {
  ensurePdfJsGlobals()
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    useWasm: false,
    stopAtErrors: true,
    maxImageSize: 0,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableFontFace: true,
  })

  try {
    const document = await loadingTask.promise
    const pageCount = Number(document.numPages)
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
      return controlledResult('no_text', 'pdf', 'unreadable_document')
    }

    const pageLimit = Math.min(pageCount, MAIL_AGENT_ATTACHMENT_MAX_PDF_PAGES)
    const pages: string[] = []
    let accumulatedLength = 0
    let truncatedByText = false

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      try {
        const content = await page.getTextContent({ disableNormalization: false })
        const pageText = boundedPdfPageText(content.items)
        const separatorLength = pages.length && pageText.text ? 2 : 0
        const remaining = MAIL_AGENT_ATTACHMENT_MAX_TEXT_CHARACTERS - accumulatedLength - separatorLength
        if (remaining <= 0) {
          truncatedByText = true
          break
        }
        if (pageText.text) {
          pages.push(pageText.text.slice(0, remaining))
          accumulatedLength += separatorLength + Math.min(pageText.text.length, remaining)
        }
        if (pageText.truncated || pageText.text.length > remaining) {
          truncatedByText = true
          break
        }
      }
      finally {
        page.cleanup()
      }
    }

    const truncatedByPages = pageCount > MAIL_AGENT_ATTACHMENT_MAX_PDF_PAGES
    const capped = capText(pages.join('\n\n'), truncatedByText || truncatedByPages)
    return successfulTextResult('pdf', capped, {
      pageCount,
      reason: truncatedByText
        ? 'text_limit'
        : truncatedByPages
          ? 'page_limit'
          : undefined,
    })
  }
  finally {
    await loadingTask.destroy()
  }
}

function selectedArchiveXml(kind: 'docx' | 'xlsx', filename: string): boolean {
  if (kind === 'docx') {
    return filename === 'word/document.xml'
      || /^word\/(?:comments|endnotes|footnotes)\.xml$/u.test(filename)
      || /^word\/(?:header|footer)[0-9]+\.xml$/u.test(filename)
  }
  return filename === 'xl/sharedStrings.xml'
    || /^xl\/worksheets\/sheet[0-9]+\.xml$/u.test(filename)
}

async function readArchiveEntryBounded(
  entry: FileEntry,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (maximumBytes < 0) throw new ArchiveExtractionError('archive_xml_limit')
  const chunks: Uint8Array[] = []
  let size = 0
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      if (!(chunk instanceof Uint8Array)) {
        throw new ArchiveExtractionError('unreadable_document')
      }
      if (chunk.byteLength > maximumBytes - size) {
        throw new ArchiveExtractionError('archive_xml_limit')
      }
      const copy = chunk.slice()
      chunks.push(copy)
      size += copy.byteLength
    },
  })

  await entry.getData(writable, {
    useWebWorkers: false,
    strictness: 'strict',
    checkAmbiguity: true,
    checkOverlappingEntry: true,
    checkSignature: true,
    onstart(total) {
      if (!Number.isSafeInteger(total) || total < 0 || total > maximumBytes) {
        throw new ArchiveExtractionError('archive_xml_limit')
      }
    },
    onprogress(progress, total) {
      if (
        !Number.isSafeInteger(progress)
        || !Number.isSafeInteger(total)
        || progress < 0
        || total < 0
        || progress > maximumBytes
        || total > maximumBytes
      ) throw new ArchiveExtractionError('archive_xml_limit')
    },
    onend(computedSize) {
      if (!Number.isSafeInteger(computedSize) || computedSize < 0 || computedSize > maximumBytes) {
        throw new ArchiveExtractionError('archive_xml_limit')
      }
    },
  })

  if (size !== entry.uncompressedSize) {
    throw new ArchiveExtractionError('unreadable_document')
  }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function readSelectedOfficeXml(
  bytes: Uint8Array,
  kind: 'docx' | 'xlsx',
): Promise<Map<string, string>> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    useWebWorkers: false,
    strictness: 'strict',
    checkAmbiguity: true,
    maxAppendedDataSize: 0,
  })
  try {
    const selectedEntries: FileEntry[] = []
    let entryCount = 0
    let declaredUncompressedBytes = 0

    for await (const entry of reader.getEntriesGenerator({
      strictness: 'strict',
      checkAmbiguity: true,
      maxAppendedDataSize: 0,
    })) {
      entryCount += 1
      if (entryCount > MAIL_AGENT_ATTACHMENT_MAX_ARCHIVE_ENTRIES) {
        throw new ArchiveExtractionError('archive_entry_limit')
      }
      if (
        !Number.isSafeInteger(entry.compressedSize)
        || !Number.isSafeInteger(entry.uncompressedSize)
        || entry.compressedSize < 0
        || entry.uncompressedSize < 0
      ) throw new ArchiveExtractionError('unreadable_document')
      if (entry.uncompressedSize > MAIL_AGENT_ATTACHMENT_MAX_ARCHIVE_UNCOMPRESSED_BYTES - declaredUncompressedBytes) {
        throw new ArchiveExtractionError('archive_size_limit')
      }
      declaredUncompressedBytes += entry.uncompressedSize
      if (entry.encrypted) throw new ArchiveExtractionError('encrypted_document')
      if (!entry.directory && selectedArchiveXml(kind, entry.filename)) selectedEntries.push(entry)
    }

    const requiredEntryPresent = kind === 'docx'
      ? selectedEntries.some(entry => entry.filename === 'word/document.xml')
      : selectedEntries.some(entry => /^xl\/worksheets\/sheet[0-9]+\.xml$/u.test(entry.filename))
    if (!requiredEntryPresent) throw new ArchiveExtractionError('missing_document_xml')

    selectedEntries.sort((left, right) => left.filename.localeCompare(right.filename, 'en'))
    const xmlByName = new Map<string, string>()
    let extractedXmlBytes = 0
    for (const entry of selectedEntries) {
      const remaining = MAIL_AGENT_ATTACHMENT_MAX_SELECTED_XML_BYTES - extractedXmlBytes
      if (entry.uncompressedSize > remaining) {
        throw new ArchiveExtractionError('archive_xml_limit')
      }
      const entryBytes = await readArchiveEntryBounded(entry, remaining)
      extractedXmlBytes += entryBytes.byteLength
      const xml = decodeTextBytes(entryBytes)
      if (xml === null) throw new ArchiveExtractionError('unreadable_document')
      xmlByName.set(entry.filename, xml)
    }
    return xmlByName
  }
  finally {
    await reader.close()
  }
}

function wordXmlText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<!--([\s\S]*?)-->/gu, ' ')
      .replace(/<(?:[A-Za-z_][\w.-]*:)?tab\b[^>]*\/?\s*>/giu, '\t')
      .replace(/<(?:[A-Za-z_][\w.-]*:)?br\b[^>]*\/?\s*>/giu, '\n')
      .replace(/<\/(?:[A-Za-z_][\w.-]*:)?(?:p|tr)\s*>/giu, '\n')
      .replace(/<\/(?:[A-Za-z_][\w.-]*:)?tc\s*>/giu, '\t')
      .replace(/<\?[\s\S]{0,4096}?\?>/gu, ' ')
      .replace(/<[^>]{0,4096}>/gu, ''),
  )
}

function extractDocxText(xmlByName: ReadonlyMap<string, string>): ArchiveText {
  const names = [...xmlByName.keys()].sort((left, right) => {
    if (left === 'word/document.xml') return -1
    if (right === 'word/document.xml') return 1
    return left.localeCompare(right, 'en')
  })
  const sections = names.map(name => wordXmlText(xmlByName.get(name) ?? '')).filter(Boolean)
  return capText(sections.join('\n\n'))
}

function xmlTextNodes(fragment: string): string {
  const values: string[] = []
  const pattern = /<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t\s*>/giu
  for (const match of fragment.matchAll(pattern)) {
    values.push(decodeXmlEntities(match[1] ?? ''))
  }
  return values.join('')
}

function xlsxSharedStrings(xml: string | undefined): { values: string[], truncated: boolean } {
  if (!xml) return { values: [], truncated: false }
  const values: string[] = []
  let truncated = false
  const pattern = /<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si\s*>/giu
  for (const match of xml.matchAll(pattern)) {
    if (values.length >= 100_000) {
      truncated = true
      break
    }
    values.push(xmlTextNodes(match[1] ?? ''))
  }
  return { values, truncated }
}

function xmlElementValue(fragment: string, localName: 'f' | 'v'): string {
  const pattern = localName === 'f'
    ? /<(?:[A-Za-z_][\w.-]*:)?f\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?f\s*>/iu
    : /<(?:[A-Za-z_][\w.-]*:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v\s*>/iu
  return decodeXmlEntities(pattern.exec(fragment)?.[1] ?? '').trim()
}

function xlsxCellText(
  attributes: string,
  body: string,
  sharedStrings: readonly string[],
): string {
  const type = /(?:^|\s)t\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1]?.toLowerCase() ?? ''
  const value = xmlElementValue(body, 'v')
  if (type === 's') {
    const index = Number.parseInt(value, 10)
    return Number.isSafeInteger(index) && index >= 0 ? sharedStrings[index] ?? '' : ''
  }
  if (type === 'inlinestr') return xmlTextNodes(body)
  if (type === 'b') return value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : value
  if (type === 'str') return value
  const formula = xmlElementValue(body, 'f')
  if (formula && value) return `${value} (formula: ${formula})`
  return value || formula
}

function extractXlsxText(xmlByName: ReadonlyMap<string, string>): ArchiveText {
  const shared = xlsxSharedStrings(xmlByName.get('xl/sharedStrings.xml'))
  const lines: string[] = []
  let length = 0
  let cellCount = 0
  let truncated = shared.truncated
  const sheetNames = [...xmlByName.keys()]
    .filter(name => /^xl\/worksheets\/sheet[0-9]+\.xml$/u.test(name))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))

  outer: for (const sheetName of sheetNames) {
    const sheetXml = xmlByName.get(sheetName) ?? ''
    const sheetLabel = `[${sheetName.slice('xl/worksheets/'.length, -'.xml'.length)}]`
    lines.push(sheetLabel)
    length += sheetLabel.length + 1
    const cellPattern = /<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c\s*>/giu
    for (const match of sheetXml.matchAll(cellPattern)) {
      cellCount += 1
      if (cellCount > 200_000 || length >= MAIL_AGENT_ATTACHMENT_MAX_TEXT_CHARACTERS + 4_096) {
        truncated = true
        break outer
      }
      const attributes = match[1] ?? ''
      const value = xlsxCellText(attributes, match[2] ?? '', shared.values)
      if (!value) continue
      const reference = /(?:^|\s)r\s*=\s*["']([^"']{1,32})["']/iu.exec(attributes)?.[1] ?? ''
      const line = reference ? `${reference}: ${value}` : value
      lines.push(line)
      length += line.length + 1
    }
  }
  return capText(lines.join('\n'), truncated)
}

async function extractOfficeAttachment(
  bytes: Uint8Array,
  kind: 'docx' | 'xlsx',
): Promise<MailAgentAttachmentTextResult> {
  if (!hasZipHeader(bytes)) return controlledResult('no_text', kind, 'unreadable_document')
  const xmlByName = await readSelectedOfficeXml(bytes, kind)
  const capped = kind === 'docx' ? extractDocxText(xmlByName) : extractXlsxText(xmlByName)
  return successfulTextResult(kind, capped, {
    reason: capped.truncated ? 'text_limit' : undefined,
  })
}

function parserErrorLooksEncrypted(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name.toLowerCase().includes('password')
    || /password|encrypted|encryption/iu.test(error.message)
}

export async function extractMailAgentAttachmentText(
  input: MailAgentAttachmentTextInput,
): Promise<MailAgentAttachmentTextResult> {
  if (!input || !(input.bytes instanceof Uint8Array)) {
    return controlledResult('no_text', 'unknown', 'unreadable_document')
  }
  const kind = inferAttachmentKind(input)
  if (input.bytes.byteLength === 0) return controlledResult('no_text', kind, 'empty_input')
  if (input.bytes.byteLength > MAIL_AGENT_ATTACHMENT_MAX_INPUT_BYTES) {
    return controlledResult('unsupported', kind, 'input_too_large')
  }

  if (kind === 'legacy_office') {
    return controlledResult('unsupported', kind, 'legacy_office_not_supported')
  }
  if (kind === 'image') return controlledResult('unsupported', kind, 'image_requires_ocr')
  if (kind === 'archive') return controlledResult('unsupported', kind, 'archive_not_supported')
  if (kind === 'unknown') return controlledResult('unsupported', kind, 'unsupported_type')

  try {
    if (kind === 'pdf') return await extractPdfAttachment(input.bytes)
    if (kind === 'docx' || kind === 'xlsx') {
      return await extractOfficeAttachment(input.bytes, kind)
    }
    return extractTextAttachment(input.bytes, kind)
  }
  catch (error) {
    if (error instanceof ArchiveExtractionError) {
      const unsupportedReasons = new Set<MailAgentAttachmentTextReason>([
        'archive_entry_limit',
        'archive_size_limit',
        'archive_xml_limit',
        'encrypted_document',
      ])
      return controlledResult(
        unsupportedReasons.has(error.reason) ? 'unsupported' : 'no_text',
        kind,
        error.reason,
      )
    }
    if (parserErrorLooksEncrypted(error)) {
      return controlledResult('unsupported', kind, 'encrypted_document')
    }
    return controlledResult('no_text', kind, 'unreadable_document')
  }
}

function clampedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isSafeInteger(value)
    ? Math.min(maximum, Math.max(minimum, value as number))
    : fallback
}

function normalizedSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('pl-PL')
}

function questionTerms(question: string): string[] {
  const normalized = normalizedSearchText(question).slice(0, 4_000)
  const terms = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}._@%+/-]*/gu) ?? []
  return [...new Set(terms.filter(term => (
    (term.length >= 3 || /\d/u.test(term))
    && !QUESTION_STOP_WORDS.has(term)
  )))].slice(0, 32)
}

function excerptCandidates(text: string, maximumCharacters: number): CandidateExcerpt[] {
  const candidates: CandidateExcerpt[] = []
  const overlap = Math.min(240, Math.floor(maximumCharacters / 4))
  const step = Math.max(1, maximumCharacters - overlap)
  for (let start = 0; start < text.length && candidates.length < 512; start += step) {
    let end = Math.min(text.length, start + maximumCharacters)
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end)
      const sentence = text.lastIndexOf('. ', end)
      const boundary = Math.max(newline, sentence)
      if (boundary > start + Math.floor(maximumCharacters / 2)) end = boundary + 1
    }
    const raw = text.slice(start, end)
    const leadingWhitespace = raw.length - raw.trimStart().length
    const excerptText = raw.trim()
    if (excerptText) {
      const excerptStart = start + leadingWhitespace
      candidates.push({
        text: excerptText,
        start: excerptStart,
        end: excerptStart + excerptText.length,
        score: 0,
      })
    }
    if (end >= text.length) break
  }
  return candidates
}

function countOccurrences(value: string, term: string): number {
  let count = 0
  let offset = 0
  while (count < 4) {
    const index = value.indexOf(term, offset)
    if (index < 0) break
    count += 1
    offset = index + Math.max(1, term.length)
  }
  return count
}

function overlapRatio(left: CandidateExcerpt, right: CandidateExcerpt): number {
  const overlap = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start))
  return overlap / Math.max(1, Math.min(left.end - left.start, right.end - right.start))
}

export function selectMailAgentAttachmentExcerpts(
  extraction: MailAgentAttachmentTextResult,
  question?: string | null,
  options: MailAgentAttachmentExcerptOptions = {},
): MailAgentAttachmentExcerpt[] {
  if (!extraction || extraction.status !== 'ok' || !extraction.text.trim()) return []
  const source = normalizeExtractedText(extraction.text).slice(0, MAIL_AGENT_ATTACHMENT_MAX_TEXT_CHARACTERS)
  if (!source) return []

  const maxExcerpts = clampedInteger(options.maxExcerpts, 4, 1, 8)
  const maxExcerptCharacters = clampedInteger(options.maxExcerptCharacters, 1_200, 1, 2_400)
  const maxTotalCharacters = clampedInteger(options.maxTotalCharacters, 6_000, 1, 12_000)
  const normalizedQuestion = typeof question === 'string' ? question : ''
  const terms = questionTerms(normalizedQuestion)
  const phrase = normalizedSearchText(normalizedQuestion).replace(/\s+/gu, ' ').trim().slice(0, 240)
  const candidates = excerptCandidates(source, Math.min(maxExcerptCharacters, maxTotalCharacters))

  for (const candidate of candidates) {
    const searchable = normalizedSearchText(candidate.text)
    let score = 0
    for (const term of terms) {
      const occurrences = countOccurrences(searchable, term)
      if (!occurrences) continue
      const specificTermWeight = /\d|@|%/u.test(term) ? 8 : Math.min(7, 2 + term.length / 3)
      score += occurrences * specificTermWeight
    }
    if (phrase.length >= 6 && searchable.includes(phrase)) score += 20
    candidate.score = Math.round(score * 100) / 100
  }

  candidates.sort((left, right) => right.score - left.score || left.start - right.start)
  const hasRelevantMatch = candidates.some(candidate => candidate.score > 0)
  const selected: CandidateExcerpt[] = []
  let totalCharacters = 0
  for (const candidate of candidates) {
    if (selected.length >= maxExcerpts) break
    if (hasRelevantMatch && candidate.score <= 0) break
    if (selected.some(existing => overlapRatio(existing, candidate) > 0.35)) continue
    const remaining = maxTotalCharacters - totalCharacters
    if (remaining <= 0) break
    const textWithinBudget = candidate.text.slice(0, remaining).trimEnd()
    if (!textWithinBudget) continue
    selected.push({
      ...candidate,
      text: textWithinBudget,
      end: candidate.start + textWithinBudget.length,
    })
    totalCharacters += textWithinBudget.length
  }

  if (!selected.length && candidates[0]) {
    const fallback = candidates[0]
    const fallbackText = fallback.text.slice(0, maxTotalCharacters).trimEnd()
    selected.push({
      ...fallback,
      text: fallbackText,
      end: fallback.start + fallbackText.length,
    })
  }
  return selected.map(candidate => ({
    text: candidate.text,
    start: candidate.start,
    end: candidate.end,
    score: candidate.score,
  }))
}
