export const MAX_BANK_MAIL_PDF_TEXT_CHARACTERS = 250_000
export const MAX_BANK_MAIL_PDF_PAGES = 100

function ensurePdfJsTextGlobals(): void {
  const globals = globalThis as unknown as Record<string, unknown>
  if (globals.DOMMatrix && globals.Path2D && globals.ImageData) return

  // pdfjs checks these browser globals while its Node module is initialized,
  // even when the caller only uses getTextContent(). Text extraction never
  // renders a page or calls their APIs, so inert constructors are sufficient
  // and avoid loading a native canvas binary in serverless runtimes.
  globals.DOMMatrix ||= class DOMMatrix { constructor(..._args: unknown[]) {} }
  globals.Path2D ||= class Path2D { constructor(..._args: unknown[]) {} }
  globals.ImageData ||= class ImageData { constructor(..._args: unknown[]) {} }
}

function normalizedText(value: string): string {
  return value
    .replace(/\u0000/gu, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\s*\n\s*/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export async function extractBoundedPdfText(input: {
  bytes: Uint8Array
  maxBytes: number
}): Promise<{ pageCount: number, text: string }> {
  if (
    !(input.bytes instanceof Uint8Array)
    || !Number.isSafeInteger(input.maxBytes)
    || input.maxBytes < 5
    || input.bytes.byteLength < 5
    || input.bytes.byteLength > input.maxBytes
  ) {
    throw new TypeError('PDF text extraction input is invalid')
  }
  ensurePdfJsTextGlobals()
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = getDocument({
    data: input.bytes.slice(),
    useWorkerFetch: false,
    isEvalSupported: false,
  } as Parameters<typeof getDocument>[0] & { isEvalSupported: false })

  try {
    const document = await loadingTask.promise
    if (
      !Number.isSafeInteger(document.numPages)
      || document.numPages < 1
      || document.numPages > MAX_BANK_MAIL_PDF_PAGES
    ) {
      throw new TypeError('PDF page count is invalid')
    }
    const pages: string[] = []
    let totalCharacters = 0
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const lines: string[] = []
        let currentLine = ''
        for (const item of content.items) {
          if (!('str' in item)) continue
          const value = String(item.str ?? '').trim()
          if (value) currentLine = currentLine ? `${currentLine} ${value}` : value
          if ('hasEOL' in item && item.hasEOL && currentLine) {
            totalCharacters += currentLine.length + 1
            if (totalCharacters > MAX_BANK_MAIL_PDF_TEXT_CHARACTERS) {
              throw new TypeError('PDF text exceeds its character limit')
            }
            lines.push(currentLine)
            currentLine = ''
          }
        }
        if (currentLine) {
          totalCharacters += currentLine.length + 1
          if (totalCharacters > MAX_BANK_MAIL_PDF_TEXT_CHARACTERS) {
            throw new TypeError('PDF text exceeds its character limit')
          }
          lines.push(currentLine)
        }
        pages.push(normalizedText(lines.join('\n')))
      }
      finally {
        page.cleanup()
      }
    }
    const text = normalizedText(pages.filter(Boolean).join('\n\n'))
    if (!text || text.length > MAX_BANK_MAIL_PDF_TEXT_CHARACTERS) {
      throw new TypeError('PDF text is empty or exceeds its character limit')
    }
    return { pageCount: document.numPages, text }
  }
  finally {
    await loadingTask.destroy()
  }
}
