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
  'img-src data: https: http:',
].join('; ')

export interface MailHtmlSrcdocOptions {
  loadRemoteImages?: boolean
}

/**
 * Promotes only the inert image-source attribute emitted by the server-side
 * mail sanitizer. All other markup is deliberately left untouched.
 */
export function enableMailRemoteImages(html: string): string {
  return html.replace(
    /(<img\b(?:"[^"]*"|'[^']*'|[^'">])*)\sdata-mail-remote-src(?=\s*=)/giu,
    '$1 src',
  )
}

export function buildMailHtmlSrcdoc(
  html: string,
  options: MailHtmlSrcdocOptions = {},
): string {
  const loadRemoteImages = options.loadRemoteImages === true
  const csp = loadRemoteImages
    ? MAIL_HTML_REMOTE_IMAGES_CSP
    : MAIL_HTML_BLOCKED_IMAGES_CSP
  const displayHtml = loadRemoteImages ? enableMailRemoteImages(html) : html

  return `<!doctype html>
<html lang="pl">
<head><meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Treść wiadomości</title>
<style>
  :root { color-scheme: light; }
  html, body { width: 100%; min-width: 0; margin: 0; padding: 0; }
  body { overflow-wrap: anywhere; word-break: normal; }
  img { max-width: 100%; }
  table { max-width: 100%; }
</style>
</head>
<body>${displayHtml}</body>
</html>`
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
