export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)
  const configuredEmbedOrigin = String(config.meetingsEmbedOrigin || '').trim()
  let embedOrigin = ''

  if (configuredEmbedOrigin) {
    try {
      const parsed = new URL(configuredEmbedOrigin)
      const isSecure = parsed.protocol === 'https:'
      const isLocal = parsed.protocol === 'http:'
        && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      if (isSecure || isLocal) embedOrigin = parsed.origin
    } catch {
      // Invalid values fail closed: only the application's own origin may embed it.
    }
  }

  const frameAncestors = ["'self'", ...(embedOrigin ? [embedOrigin] : [])].join(' ')
  setHeader(event, 'Content-Security-Policy', `frame-ancestors ${frameAncestors};`)
  setHeader(event, 'Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)')
  setHeader(event, 'Referrer-Policy', 'same-origin')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
})
