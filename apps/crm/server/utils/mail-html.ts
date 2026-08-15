import sanitizeHtml from 'sanitize-html'

export type SanitizedMailHtml = {
  html: string | null
  hasRemoteImages: boolean
  truncated: boolean
}

const MAX_INPUT_LENGTH = 1_000_000
const MAX_OUTPUT_LENGTH = 1_000_000
const MAX_REMOTE_IMAGE_URL_LENGTH = 8_192
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
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || !parsed.hostname
      || parsed.username
      || parsed.password
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

function sanitizePass(value: string): {
  html: string
  hasRemoteImages: boolean
} {
  let hasRemoteImages = false

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
      'xmp',
    ],
    transformTags: {
      '*': (tagName, attributes) => {
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
          delete attribs['data-mail-remote-src']
          delete attribs.srcset

          const source = attribs.src?.trim() || ''
          const remoteSource = safeRemoteImageSource(source)
          if (remoteSource) {
            hasRemoteImages = true
            attribs['data-mail-remote-src'] = remoteSource
            delete attribs.src
          } else if (SAFE_DATA_IMAGE.test(source)) {
            attribs.src = source
          } else {
            delete attribs.src
          }
        }

        return { tagName, attribs }
      },
    },
  })

  return { html, hasRemoteImages }
}

export function sanitizeMailHtml(value: string): SanitizedMailHtml {
  let truncated = value.length > MAX_INPUT_LENGTH
  const source = truncated ? safeSourcePrefix(value, MAX_INPUT_LENGTH) : value
  let sanitized = sanitizePass(source)

  if (sanitized.html.length > MAX_OUTPUT_LENGTH) {
    truncated = true

    // Re-sanitize prefixes instead of cutting the serialized output. Every
    // candidate is therefore a complete, balanced HTML fragment.
    let low = 0
    let high = Math.max(0, source.length - 1)
    let best = sanitizePass('')

    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2)
      const candidate = sanitizePass(safeSourcePrefix(source, middle))

      if (candidate.html.length <= MAX_OUTPUT_LENGTH) {
        best = candidate
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    sanitized = best
  }

  return {
    html: sanitized.html.trim().length > 0 ? sanitized.html : null,
    hasRemoteImages: sanitized.hasRemoteImages,
    truncated,
  }
}
