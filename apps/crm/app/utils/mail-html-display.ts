export const MAIL_HTML_IFRAME_SANDBOX = 'allow-same-origin'

const MAIL_HTML_CSP_DIRECTIVES = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "script-src-attr 'none'",
  "style-src 'unsafe-inline'",
  "font-src 'none'",
  "media-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
]

export const MAIL_HTML_BLOCKED_IMAGES_CSP = [
  ...MAIL_HTML_CSP_DIRECTIVES,
  'img-src data:',
].join('; ')

export const MAIL_HTML_REMOTE_IMAGES_CSP = [
  ...MAIL_HTML_CSP_DIRECTIVES,
  "img-src data: 'self'",
].join('; ')

export interface MailHtmlSrcdocOptions {
  loadRemoteImages?: boolean
  remoteImageProxyPath?: string
}

const MAIL_REMOTE_IMAGE_PROXY_PATH = /^\/api\/org\/[a-z0-9]+(?:-[a-z0-9]+)*\/mail\/remote-image$/u
const MAIL_REMOTE_IMAGE_MARKER = /(<img\b(?:"[^"]*"|'[^']*'|[^'">])*)\sdata-mail-remote-src\s*=\s*(?:"([^"]*)"|'([^']*)')/giu

/**
 * Replaces only the inert image marker emitted by the server-side sanitizer.
 * The sender's URL remains server-side input to the fixed same-origin proxy;
 * it is never promoted to a browser-loadable src directly.
 */
export function enableMailRemoteImages(
  html: string,
  remoteImageProxyPath?: string,
): string {
  const proxyPath = safeMailRemoteImageProxyPath(remoteImageProxyPath)
  if (!proxyPath) return html

  return html.replace(
    MAIL_REMOTE_IMAGE_MARKER,
    (match, imagePrefix: string, doubleQuotedSource: string | undefined, singleQuotedSource: string | undefined) => {
      const sourceUrl = safeMailRemoteImageUrl(doubleQuotedSource ?? singleQuotedSource ?? '')
      if (!sourceUrl) return match
      const proxyUrl = `${proxyPath}?url=${encodeURIComponent(sourceUrl)}`
      return `${imagePrefix} src="${escapeHtmlAttribute(proxyUrl)}"`
    },
  )
}

export function buildMailHtmlSrcdoc(
  html: string,
  options: MailHtmlSrcdocOptions = {},
): string {
  const proxyPath = safeMailRemoteImageProxyPath(options.remoteImageProxyPath)
  const loadRemoteImages = options.loadRemoteImages === true && proxyPath !== null
  const csp = loadRemoteImages
    ? MAIL_HTML_REMOTE_IMAGES_CSP
    : MAIL_HTML_BLOCKED_IMAGES_CSP
  const displayHtml = loadRemoteImages
    ? enableMailRemoteImages(html, proxyPath)
    : html

  return `<!doctype html>
<html lang="pl">
<head><meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Treść wiadomości</title>
<style>
  :root { color-scheme: light; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { width: 100%; max-width: 100%; min-width: 0; margin: 0; padding: 0; }
  body { display: flow-root; overflow-x: auto; overflow-wrap: anywhere; word-break: normal; }
  img { max-width: 100% !important; height: auto !important; }
  table { max-width: 100% !important; }
  pre { max-width: 100%; overflow-wrap: anywhere; white-space: pre-wrap; }
</style>
</head>
<body>${displayHtml}</body>
</html>`
}

function safeMailRemoteImageProxyPath(value: string | undefined): string | null {
  const path = String(value || '').trim()
  return MAIL_REMOTE_IMAGE_PROXY_PATH.test(path) ? path : null
}

function decodeHtmlAttribute(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', quot: '"',
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|quot);/giu, (match, entity: string) => {
    if (entity.toLowerCase().startsWith('#x')) {
      const codePoint = Number.parseInt(entity.slice(2), 16)
      return validCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10)
      return validCodePoint(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return named[entity.toLowerCase()] ?? match
  })
}

function validCodePoint(value: number): boolean {
  return Number.isInteger(value)
    && value >= 0
    && value <= 0x10ffff
    && !(value >= 0xd800 && value <= 0xdfff)
}

function safeMailRemoteImageUrl(value: string): string | null {
  const decoded = decodeHtmlAttribute(value)
  const source = decoded.startsWith('//') ? `https:${decoded}` : decoded
  if (
    !source
    || source.length > 4096
    || /[\u0000-\u0020\u007f]/u.test(source)
  ) {
    return null
  }

  try {
    const url = new URL(source)
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || (url.port && !(
        (url.protocol === 'http:' && url.port === '80')
        || (url.protocol === 'https:' && url.port === '443')
      ))
      || url.href.length > 4096
    ) {
      return null
    }
    return url.href
  }
  catch {
    return null
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
