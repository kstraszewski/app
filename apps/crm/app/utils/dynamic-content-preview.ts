export interface DynamicContentSource {
  html: string
  css: string
  javascript: string
}

export type DynamicContentPreviewMessage =
  | { type: 'ready' }
  | { type: 'rendered' }
  | { type: 'runtime-error', message: string }

export const DYNAMIC_CONTENT_PREVIEW_NAMESPACE = 'openexpert.dynamic-content-preview.v1'
export const DYNAMIC_CONTENT_IFRAME_SANDBOX = 'allow-scripts'
export const DYNAMIC_CONTENT_LIMITS = Object.freeze({
  html: 60_000,
  css: 60_000,
  javascript: 60_000,
  total: 60_000,
})

export const DYNAMIC_CONTENT_PREVIEW_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "script-src-attr 'none'",
].join('; ')

const BLOCKED_HTML_ELEMENTS = [
  'applet',
  'base',
  'embed',
  'frame',
  'frameset',
  'iframe',
  'link',
  'meta',
  'noscript',
  'object',
  'portal',
  'script',
  'style',
  'template',
].join(',')

const BLOCKED_URL_ATTRIBUTES = new Set([
  'action',
  'background',
  'cite',
  'data',
  'formaction',
  'manifest',
  'ping',
  'poster',
  'src',
  'srcdoc',
  'srcset',
  'xlink:href',
])

export function dynamicContentCharacterCount(source: DynamicContentSource): number {
  return source.html.length + source.css.length + source.javascript.length
}

export function isDynamicContentWithinLimits(source: DynamicContentSource): boolean {
  return source.html.length <= DYNAMIC_CONTENT_LIMITS.html
    && source.css.length <= DYNAMIC_CONTENT_LIMITS.css
    && source.javascript.length <= DYNAMIC_CONTENT_LIMITS.javascript
    && dynamicContentCharacterCount(source) <= DYNAMIC_CONTENT_LIMITS.total
}

export function sanitizeDynamicContentHtml(html: string): string {
  if (typeof DOMParser === 'undefined') {
    throw new TypeError('DOMParser is required to sanitize dynamic content HTML.')
  }

  const parsed = new DOMParser().parseFromString(html, 'text/html')
  parsed.querySelectorAll(BLOCKED_HTML_ELEMENTS).forEach(element => element.remove())

  parsed.body.querySelectorAll('*').forEach((element) => {
    if (
      element instanceof HTMLInputElement
      && ['file', 'password'].includes(element.type.toLocaleLowerCase('en'))
    ) {
      element.remove()
      return
    }

    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLocaleLowerCase('en')
      if (
        name.startsWith('on')
        || name === 'autofocus'
        || name === 'download'
        || name === 'target'
        || BLOCKED_URL_ATTRIBUTES.has(name)
      ) {
        element.removeAttribute(attribute.name)
        continue
      }

      if (name === 'href' && !/^#[A-Za-z][\w:.-]*$/u.test(attribute.value.trim())) {
        element.removeAttribute(attribute.name)
      }
    }
  })

  return parsed.body.innerHTML
}

export function buildDynamicContentBootMessage(channelId: string, source: DynamicContentSource) {
  assertPreviewChannelId(channelId)
  if (!isDynamicContentWithinLimits(source)) {
    throw new RangeError('Dynamic content exceeds the preview size limit.')
  }

  return {
    namespace: DYNAMIC_CONTENT_PREVIEW_NAMESPACE,
    channelId,
    type: 'boot' as const,
    html: source.html,
    css: source.css,
    javascript: source.javascript,
  }
}

export function parseDynamicContentPreviewMessage(
  value: unknown,
  channelId: string,
): DynamicContentPreviewMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (
    candidate.namespace !== DYNAMIC_CONTENT_PREVIEW_NAMESPACE
    || candidate.channelId !== channelId
  ) return null

  if (candidate.type === 'ready' || candidate.type === 'rendered') {
    return { type: candidate.type }
  }
  if (candidate.type === 'runtime-error' && typeof candidate.message === 'string') {
    return {
      type: 'runtime-error',
      message: candidate.message.trim().slice(0, 500) || 'Nieznany błąd JavaScript.',
    }
  }
  return null
}

export function buildDynamicContentPreviewShell(channelId: string, parentOrigin: string): string {
  assertPreviewChannelId(channelId)
  const normalizedParentOrigin = new URL(parentOrigin).origin
  if (!/^https?:\/\//u.test(normalizedParentOrigin)) {
    throw new TypeError('Dynamic content preview requires an HTTP(S) parent origin.')
  }

  const namespaceLiteral = JSON.stringify(DYNAMIC_CONTENT_PREVIEW_NAMESPACE)
  const channelLiteral = JSON.stringify(channelId)
  const parentOriginLiteral = JSON.stringify(normalizedParentOrigin)
  const csp = DYNAMIC_CONTENT_PREVIEW_CSP.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

  return `<!doctype html>
<html lang="pl">
<head><meta http-equiv="Content-Security-Policy" content="${csp}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Izolowany podgląd OpenExpert</title>
<style id="oe-user-style"></style>
</head>
<body>
<div id="oe-root"></div>
<script>
(() => {
  'use strict'
  const namespace = ${namespaceLiteral}
  const channelId = ${channelLiteral}
  const parentOrigin = ${parentOriginLiteral}
  const limits = { html: 60000, css: 60000, javascript: 60000, total: 60000 }
  let booted = false

  const notify = (type, payload = {}) => {
    try {
      parent.postMessage({ namespace, channelId, type, ...payload }, parentOrigin)
    }
    catch {}
  }
  const reportError = (value) => {
    const message = String(value && value.message ? value.message : value || 'Nieznany błąd JavaScript.').slice(0, 500)
    notify('runtime-error', { message })
  }

  window.addEventListener('error', event => reportError(event.error || event.message))
  window.addEventListener('unhandledrejection', event => reportError(event.reason))
  document.addEventListener('submit', event => event.preventDefault(), true)

  window.addEventListener('message', (event) => {
    if (booted || event.source !== parent || event.origin !== parentOrigin) return
    const message = event.data
    if (!message || typeof message !== 'object' || Array.isArray(message)) return
    if (message.namespace !== namespace || message.channelId !== channelId || message.type !== 'boot') return

    const html = typeof message.html === 'string' ? message.html : null
    const css = typeof message.css === 'string' ? message.css : null
    const javascript = typeof message.javascript === 'string' ? message.javascript : null
    if (html === null || css === null || javascript === null) return
    if (
      html.length > limits.html
      || css.length > limits.css
      || javascript.length > limits.javascript
      || html.length + css.length + javascript.length > limits.total
    ) {
      notify('runtime-error', { message: 'Zawartość przekracza limit bezpiecznego podglądu.' })
      return
    }

    booted = true
    document.getElementById('oe-root').innerHTML = html
    document.getElementById('oe-user-style').textContent = css
    notify('rendered')

    const userScript = document.createElement('script')
    userScript.textContent = "'use strict';\\n" + javascript + '\\n//# sourceURL=openexpert-dynamic-content.js'
    document.body.append(userScript)
  })

  document.currentScript.remove()
  notify('ready')
})()
</script>
</body>
</html>`
}

function assertPreviewChannelId(channelId: string): void {
  if (!/^[A-Za-z0-9:_-]{8,128}$/u.test(channelId)) {
    throw new TypeError('Invalid dynamic content preview channel id.')
  }
}
