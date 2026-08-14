export type MailBodyParagraphKind = 'text' | 'quote' | 'signature'

export type MailBodySegment =
  | { type: 'text', value: string }
  | {
    type: 'url'
    value: string
    label: string
    domain: string
  }

export interface MailBodyParagraph {
  kind: MailBodyParagraphKind
  segments: MailBodySegment[]
}

const WEB_URL_PATTERN = /https?:\/\/[^\s<>"\u0000-\u001F\u007F]+/giu
const SHORT_URL_LENGTH = 72
const SHORT_PATH_SEGMENT_LENGTH = 22
const MAX_MAIL_BODY_PARAGRAPHS = 200
const MAX_MAIL_BODY_URLS = 100

export function mailBodyParagraphs(value: string): MailBodyParagraph[] {
  const sourceParagraphs = normalizeMailBodyDisplayText(value).split(/\n{2,}/u)
  const paragraphTexts = sourceParagraphs.length <= MAX_MAIL_BODY_PARAGRAPHS
    ? sourceParagraphs
    : [
        ...sourceParagraphs.slice(0, MAX_MAIL_BODY_PARAGRAPHS - 1),
        sourceParagraphs.slice(MAX_MAIL_BODY_PARAGRAPHS - 1).join('\n\n'),
      ]
  let remainingUrls = MAX_MAIL_BODY_URLS

  return paragraphTexts
    .map((paragraph) => {
      const kind = paragraphKind(paragraph)
      const displayText = kind === 'quote'
        ? paragraph.replace(/^> ?/gmu, '')
        : paragraph
      const segments = mailBodySegments(displayText, remainingUrls)
      remainingUrls -= segments.filter(segment => segment.type === 'url').length
      return {
        kind,
        segments,
      }
    })
    .filter(paragraph => paragraph.segments.length > 0)
}

export function normalizeMailBodyDisplayText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(line => line
      .replace(/[ \t]+$/gu, '')
      .replace(/^ {16,}(?=\S)/u, '    ')
      .replace(/^\t{4,}(?=\S)/u, '\t'))
    .join('\n')
    .replace(/\n{4,}/gu, '\n\n\n')
    .replace(/^\n+/u, '')
    .replace(/\n+$/u, '')
}

export function mailBodySegments(
  value: string,
  maxUrlSegments = MAX_MAIL_BODY_URLS,
): MailBodySegment[] {
  const segments: MailBodySegment[] = []
  let cursor = 0
  let urlCount = 0

  for (const match of value.matchAll(WEB_URL_PATTERN)) {
    if (urlCount >= Math.max(0, maxUrlSegments)) break
    const start = match.index
    const candidate = match[0]
    if (start === undefined || !candidate) continue

    if (start > cursor) {
      segments.push({ type: 'text', value: value.slice(cursor, start) })
    }

    const { url, suffix } = splitTrailingPunctuation(candidate)
    if (url) {
      const { label, domain } = mailUrlDisplay(url)
      segments.push({ type: 'url', value: url, label, domain })
      urlCount += 1
    }
    if (suffix) segments.push({ type: 'text', value: suffix })
    cursor = start + candidate.length
  }

  if (cursor < value.length) {
    segments.push({ type: 'text', value: value.slice(cursor) })
  }

  return segments.filter(segment => segment.value.length > 0)
}

export function mailUrlDisplay(value: string): { label: string, domain: string } {
  try {
    const url = new URL(value)
    const domain = url.hostname.replace(/^www\./iu, '')
    if (value.length <= SHORT_URL_LENGTH) return { label: value, domain }

    const firstPathSegment = url.pathname
      .split('/')
      .find(Boolean)
      ?.slice(0, SHORT_PATH_SEGMENT_LENGTH)
    const label = firstPathSegment
      ? `${domain}/${firstPathSegment}/…`
      : `${domain}/…`
    return { label, domain }
  }
  catch {
    return {
      label: value.length <= SHORT_URL_LENGTH
        ? value
        : `${value.slice(0, SHORT_URL_LENGTH - 1)}…`,
      domain: 'adresu internetowego',
    }
  }
}

function paragraphKind(value: string): MailBodyParagraphKind {
  const nonEmptyLines = value.split('\n').filter(line => line.trim())
  if (nonEmptyLines.length && nonEmptyLines.every(line => line.startsWith('>'))) {
    return 'quote'
  }
  if (/^-- ?(?:\n|$)/u.test(value)) return 'signature'
  return 'text'
}

function splitTrailingPunctuation(value: string): { url: string, suffix: string } {
  let url = value
  let suffix = ''

  while (/[.,;:!?]$/u.test(url)) {
    suffix = `${url.at(-1)}${suffix}`
    url = url.slice(0, -1)
  }

  for (const [opening, closing] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
    while (url.endsWith(closing) && characterCount(url, opening) < characterCount(url, closing)) {
      suffix = `${closing}${suffix}`
      url = url.slice(0, -1)
    }
  }

  return { url, suffix }
}

function characterCount(value: string, character: string): number {
  return value.split(character).length - 1
}
