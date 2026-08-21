import { isIP } from 'node:net'
import { domainToASCII } from 'node:url'
import sanitizeHtml from 'sanitize-html'
import { isPublicMailAddress } from './mail-host-security.ts'

export type SanitizedMailHtml = {
  html: string | null
  hasRemoteImages: boolean
  truncated: boolean
}

const MAX_INPUT_LENGTH = 400_000
const MAX_OUTPUT_LENGTH = 400_000
const MAX_TAG_COUNT = 8_000
const MAX_REMOTE_IMAGE_COUNT = 100
const OUTPUT_REBALANCE_HEADROOM = 10_000
const MAX_REMOTE_IMAGE_URL_LENGTH = 4_096
const MAX_STYLE_ATTRIBUTE_LENGTH = 16_384

const ALLOWED_TAGS = [
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'bdi',
  'bdo',
  'big',
  'blockquote',
  'body',
  'br',
  'caption',
  'center',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'font',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'main',
  'mark',
  'nav',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
  'wbr',
]

const ALLOWED_STYLE_PROPERTIES = [
  'background',
  'background-color',
  'background-image',
  'background-position',
  'background-repeat',
  'background-size',
  'border',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-style',
  'border-bottom-width',
  'border-collapse',
  'border-color',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-spacing',
  'border-style',
  'border-top',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-style',
  'border-top-width',
  'border-width',
  'box-sizing',
  'caption-side',
  'clear',
  'color',
  'direction',
  'display',
  'empty-cells',
  'float',
  'font',
  'font-family',
  'font-size',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'height',
  'letter-spacing',
  'line-height',
  'list-style',
  'list-style-position',
  'list-style-type',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'mso-hide',
  'mso-line-height-rule',
  'mso-table-lspace',
  'mso-table-rspace',
  'object-fit',
  'opacity',
  'overflow',
  'overflow-wrap',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'table-layout',
  'text-align',
  'text-decoration',
  'text-indent',
  'text-overflow',
  'text-transform',
  'text-size-adjust',
  'vertical-align',
  'visibility',
  'white-space',
  'width',
  'word-break',
  'word-spacing',
  'word-wrap',
  '-ms-text-size-adjust',
  '-webkit-text-size-adjust',
]

// Values are checked after PostCSS has separated declarations. Backslash and
// comment escapes are intentionally rejected so blocked CSS functions cannot be
// reconstructed by the browser after sanitization.
const SAFE_STYLE_VALUE = /^(?![\s\S]*(?:\\|\/\*|\*\/|[;{}<>]|@import|expression\s*\(|(?:java|vb)script\s*:|data\s*:|url\s*\(|(?:-webkit-)?image-set\s*\(|cross-fade\s*\(|image\s*\(|attr\s*\(|(?:https?|ftp|file|blob)\s*:|\/\/))(?![\s\S]*[\u0000-\u001f\u007f-\u009f])[\s\S]+$/iu

const ALLOWED_STYLES: Record<string, Record<string, RegExp[]>> = {
  '*': Object.fromEntries(
    ALLOWED_STYLE_PROPERTIES.map(property => [property, [SAFE_STYLE_VALUE]]),
  ),
}

const SAFE_DATA_IMAGE = /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp|x-icon|vnd\.microsoft\.icon)(?:;[^,\u0000-\u001f\u007f]*)?,[^\u0000-\u001f\u007f]*$/iu

function safeSourcePrefix(value: string, length: number): string {
  let prefix = value.slice(0, length)
  const lastCodeUnit = prefix.charCodeAt(prefix.length - 1)
  if (lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF) {
    prefix = prefix.slice(0, -1)
  }
  return prefix
}

function limitMailHtmlTags(value: string): {
  source: string
  truncated: boolean
} {
  let tagCount = 0

  // This deliberately counts conservatively before invoking the HTML parser.
  // A false positive only shortens hostile/malformed input; a second counter in
  // the sanitizer transform enforces the same limit on tags the parser accepts.
  for (const match of value.matchAll(/<[a-z][a-z0-9:-]*(?=[\t\n\f\r />])/giu)) {
    tagCount += 1
    if (tagCount > MAX_TAG_COUNT) {
      return {
        source: safeSourcePrefix(value, match.index),
        truncated: true,
      }
    }
  }

  return { source: value, truncated: false }
}

function safeRemoteImageSource(value: string): string | null {
  const source = value.trim()
  if (
    source.length === 0
    || source.length > MAX_REMOTE_IMAGE_URL_LENGTH
    || /[\u0000-\u0020\u007f]/u.test(source)
  ) {
    return null
  }

  const protocolRelative = source.startsWith('//')
  if (!protocolRelative && !/^https?:\/\//iu.test(source)) return null

  try {
    const parsed = new URL(protocolRelative ? `https:${source}` : source)
    const hostname = parsed.hostname.replace(/^\[|\]$/gu, '').toLowerCase()
    const asciiHostname = domainToASCII(hostname).toLowerCase()
    const addressFamily = isIP(hostname)
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || !asciiHostname
      || parsed.username
      || parsed.password
      || (parsed.port && !(
        (parsed.protocol === 'http:' && parsed.port === '80')
        || (parsed.protocol === 'https:' && parsed.port === '443')
      ))
      || (addressFamily !== 0 && !isPublicMailAddress(hostname))
      || (addressFamily === 0 && (
        !asciiHostname.includes('.')
        || asciiHostname.endsWith('.')
        || /(?:^|\.)(?:home\.arpa|internal|lan|local|localhost)$/u.test(asciiHostname)
      ))
    ) {
      return null
    }
  } catch {
    return null
  }

  // Keep the sender's URL byte-for-byte (apart from surrounding whitespace).
  // sanitize-html escapes it when serializing the inert data attribute.
  return source
}

function sanitizePass(
  value: string,
  options: { trustRemoteImageMarkers?: boolean } = {},
): {
  html: string
  hasRemoteImages: boolean
  tagLimitExceeded: boolean
} {
  let hasRemoteImages = false
  let remoteImageCount = 0
  let tagCount = 0
  let tagLimitExceeded = false

  const html = sanitizeHtml(value, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      '*': [
        'align',
        'aria-hidden',
        'aria-label',
        'dir',
        'lang',
        'role',
        'style',
        'title',
        'valign',
      ],
      a: ['style', 'title'],
      blockquote: ['cite'],
      col: ['span', 'width'],
      colgroup: ['span', 'width'],
      font: ['color', 'face', 'size'],
      img: [
        'align',
        'alt',
        'border',
        'data-mail-remote-src',
        'decoding',
        'height',
        'hspace',
        'loading',
        'src',
        'style',
        'title',
        'valign',
        'vspace',
        'width',
      ],
      li: ['type', 'value'],
      ol: ['reversed', 'start', 'type'],
      table: [
        'align',
        'bgcolor',
        'border',
        'cellpadding',
        'cellspacing',
        'height',
        'role',
        'summary',
        'width',
      ],
      td: [
        'abbr',
        'align',
        'bgcolor',
        'colspan',
        'headers',
        'height',
        'rowspan',
        'scope',
        'valign',
        'width',
      ],
      th: [
        'abbr',
        'align',
        'bgcolor',
        'colspan',
        'headers',
        'height',
        'rowspan',
        'scope',
        'valign',
        'width',
      ],
      time: ['datetime'],
      ul: ['type'],
    },
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: [],
    allowedSchemesByTag: {
      img: ['data'],
    },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    enforceHtmlBoundary: false,
    nestingLimit: 100,
    nonTextTags: [
      'iframe',
      'math',
      'noembed',
      'noframes',
      'noscript',
      'object',
      'plaintext',
      'script',
      'style',
      'svg',
      'template',
      'textarea',
      'title',
      'xmp',
    ],
    transformTags: {
      '*': (tagName, attributes) => {
        tagCount += 1
        if (tagCount > MAX_TAG_COUNT) {
          tagLimitExceeded = true
          return { tagName: 'mail-overflow', attribs: {} }
        }

        const attribs = { ...attributes }

        for (const attributeName of Object.keys(attribs)) {
          if (attributeName.toLowerCase().startsWith('on')) {
            delete attribs[attributeName]
          }
        }

        if ((attribs.style?.length || 0) > MAX_STYLE_ATTRIBUTE_LENGTH) {
          delete attribs.style
        }

        if (tagName === 'a') {
          delete attribs.href
          delete attribs.ping
          delete attribs.target
          delete attribs.download
          delete attribs.referrerpolicy
          delete attribs.rel
        }

        if (tagName === 'img') {
          // Never trust a marker supplied by the sender. Only this transform can
          // mint data-mail-remote-src after validating the original src.
          const trustedRemoteSource = options.trustRemoteImageMarkers
            ? safeRemoteImageSource(attribs['data-mail-remote-src'] || '')
            : null
          delete attribs['data-mail-remote-src']
          delete attribs.srcset

          const source = attribs.src?.trim() || ''
          const remoteSource = safeRemoteImageSource(source)
          if (remoteSource && remoteImageCount < MAX_REMOTE_IMAGE_COUNT) {
            remoteImageCount += 1
            hasRemoteImages = true
            attribs['data-mail-remote-src'] = remoteSource
            delete attribs.src
          } else if (SAFE_DATA_IMAGE.test(source)) {
            attribs.src = source
          } else if (trustedRemoteSource && remoteImageCount < MAX_REMOTE_IMAGE_COUNT) {
            remoteImageCount += 1
            hasRemoteImages = true
            attribs['data-mail-remote-src'] = trustedRemoteSource
            delete attribs.src
          } else {
            delete attribs.src
          }
        }

        // sanitize-html removes the document envelope around fragments. Keep
        // the safe body presentation on an inert wrapper so inherited email
        // styles (especially font-family, color and text sizing) still reach
        // the message, just as they do in regular mail clients.
        return { tagName: tagName === 'body' ? 'div' : tagName, attribs }
      },
    },
  })

  return { html, hasRemoteImages, tagLimitExceeded }
}

export function sanitizeMailHtml(value: string): SanitizedMailHtml {
  let truncated = value.length > MAX_INPUT_LENGTH
  const rawSource = truncated ? safeSourcePrefix(value, MAX_INPUT_LENGTH) : value
  const tagLimited = limitMailHtmlTags(rawSource)
  truncated ||= tagLimited.truncated

  let sanitized = sanitizePass(tagLimited.source)
  truncated ||= sanitized.tagLimitExceeded

  if (sanitized.html.length > MAX_OUTPUT_LENGTH) {
    truncated = true

    // The first result is already trusted HTML, so one deterministic second
    // pass can repair a prefix without binary-searching and reparsing untrusted
    // input many times. Headroom covers repaired entities and implied closing
    // tags. The empty fallback is balanced if a future serializer exceeds it.
    const balanced = sanitizePass(
      safeSourcePrefix(
        sanitized.html,
        MAX_OUTPUT_LENGTH - OUTPUT_REBALANCE_HEADROOM,
      ),
      { trustRemoteImageMarkers: true },
    )
    sanitized = balanced.html.length <= MAX_OUTPUT_LENGTH
      ? balanced
      : { html: '', hasRemoteImages: false, tagLimitExceeded: false }
  }

  return {
    html: sanitized.html.trim().length > 0 ? sanitized.html : null,
    hasRemoteImages: sanitized.hasRemoteImages,
    truncated,
  }
}
