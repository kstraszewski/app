export type ExperimentKnowledgeKind = 'text' | 'dynamic_html'

export interface ExperimentKnowledgeSource {
  kind: ExperimentKnowledgeKind
  title: string
  textContent: string | null
  htmlContent: string | null
  cssContent: string | null
  javascriptContent: string | null
}

export interface ExperimentKnowledgeChunk {
  chunkIndex: number
  content: string
  tokenCount: number
}

export const EXPERIMENT_KNOWLEDGE_MAX_TITLE_CHARACTERS = 160
export const EXPERIMENT_KNOWLEDGE_MAX_TEXT_CHARACTERS = 250_000
export const EXPERIMENT_KNOWLEDGE_MAX_DYNAMIC_CHARACTERS = 60_000

const blockTagPattern = /<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/giu
const namedEntities: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  quot: '"',
}

export function normalizeExperimentKnowledgeText(value: string) {
  return value
    .replace(/\u0000/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/giu, (entity, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const point = Number.parseInt(code.slice(2), 16)
      return Number.isFinite(point) && point > 0 && point <= 0x10FFFF
        ? String.fromCodePoint(point)
        : entity
    }
    if (code.startsWith('#')) {
      const point = Number.parseInt(code.slice(1), 10)
      return Number.isFinite(point) && point > 0 && point <= 0x10FFFF
        ? String.fromCodePoint(point)
        : entity
    }
    return namedEntities[code.toLowerCase()] ?? entity
  })
}

export function experimentKnowledgeHtmlToText(html: string) {
  return normalizeExperimentKnowledgeText(decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/gu, ' ')
      .replace(/<(?:script|style|template|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|template|svg)\s*>/giu, ' ')
      .replace(blockTagPattern, '\n')
      .replace(/<[^>]+>/gu, ' '),
  ))
}

export function experimentKnowledgePlainText(source: ExperimentKnowledgeSource) {
  if (source.kind === 'text') {
    return normalizeExperimentKnowledgeText(source.textContent ?? '')
  }
  return experimentKnowledgeHtmlToText(source.htmlContent ?? '')
}

export function splitExperimentKnowledgeText(value: string): ExperimentKnowledgeChunk[] {
  const text = normalizeExperimentKnowledgeText(value)
  if (!text) return []

  const maximumCharacters = 5_500
  const minimumBreak = 2_700
  const overlapCharacters = 320
  const chunks: ExperimentKnowledgeChunk[] = []
  let offset = 0

  while (offset < text.length) {
    let end = Math.min(text.length, offset + maximumCharacters)
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end)
      const lineBreak = text.lastIndexOf('\n', end)
      const sentenceBreak = Math.max(
        text.lastIndexOf('. ', end),
        text.lastIndexOf('? ', end),
        text.lastIndexOf('! ', end),
      )
      const preferredBreak = Math.max(paragraphBreak, lineBreak, sentenceBreak)
      if (preferredBreak > offset + minimumBreak) end = preferredBreak + 1
    }

    const content = text.slice(offset, end).trim()
    if (content) {
      chunks.push({
        chunkIndex: chunks.length,
        content,
        tokenCount: Math.max(1, Math.ceil(content.length / 4)),
      })
    }
    if (end >= text.length) break
    offset = Math.max(offset + 1, end - overlapCharacters)
  }

  return chunks
}

export function assertExperimentKnowledgeSource(source: ExperimentKnowledgeSource) {
  if (!source.title || source.title.length > EXPERIMENT_KNOWLEDGE_MAX_TITLE_CHARACTERS) {
    throw new RangeError('Tytuł musi mieć od 1 do 160 znaków.')
  }

  if (source.kind === 'text') {
    const length = source.textContent?.length ?? 0
    if (!length || length > EXPERIMENT_KNOWLEDGE_MAX_TEXT_CHARACTERS) {
      throw new RangeError('Dokument tekstowy musi mieć od 1 do 250 000 znaków.')
    }
    return
  }

  const dynamicLength = (source.htmlContent?.length ?? 0)
    + (source.cssContent?.length ?? 0)
    + (source.javascriptContent?.length ?? 0)
  if (!source.htmlContent?.trim() || dynamicLength > EXPERIMENT_KNOWLEDGE_MAX_DYNAMIC_CHARACTERS) {
    throw new RangeError('Dynamiczna strona musi zawierać HTML i mieć najwyżej 60 000 znaków źródła.')
  }
}
