import { setHeader } from 'h3'
import { bookingWidgetScriptUrl } from '#shared/utils/booking-widget-urls'

function legacyBookingWidgetShim(frameOrigin: string): string {
  return `(function () {
  'use strict'

  var currentScript = document.currentScript
  var scripts = document.querySelectorAll('script[data-openexpert-widget]')
  var script = currentScript && currentScript.hasAttribute('data-openexpert-widget')
    ? currentScript
    : scripts[scripts.length - 1]
  if (!script) return
  if (script.getAttribute('data-openexpert-initialized') === 'true') return
  script.setAttribute('data-openexpert-initialized', 'true')

  var widgetKey = script.getAttribute('data-openexpert-widget')
  if (!widgetKey) {
    console.error('[OpenExpert] Missing data-openexpert-widget attribute.')
    return
  }

  var frameOrigin = ${JSON.stringify(frameOrigin)}
  var frame = document.createElement('iframe')
  var query = new URLSearchParams({ embed: '1' })
  var theme = script.getAttribute('data-theme')
  if (theme) query.set('theme', theme)

  frame.src = frameOrigin + '/book/' + encodeURIComponent(widgetKey) + '?' + query.toString()
  frame.title = script.getAttribute('data-title') || 'Umów spotkanie'
  frame.loading = script.getAttribute('data-loading') || 'lazy'
  frame.referrerPolicy = 'strict-origin-when-cross-origin'
  frame.allow = 'clipboard-write'
  frame.style.display = 'block'
  frame.style.width = '100%'
  frame.style.height = script.getAttribute('data-height') || '760px'
  frame.style.border = '0'
  frame.style.borderRadius = script.getAttribute('data-radius') || '16px'
  frame.style.background = 'transparent'
  frame.setAttribute('data-openexpert-widget-frame', widgetKey)

  if (!script.parentNode) return
  script.parentNode.insertBefore(frame, script.nextSibling)

  window.addEventListener('message', function (event) {
    if (event.origin !== frameOrigin || event.source !== frame.contentWindow) return
    var payload = event.data
    if (!payload || payload.type !== 'openexpert:booking-widget:resize') return
    if (payload.widgetKey !== widgetKey || !Number.isFinite(payload.height)) return
    frame.style.height = Math.max(420, Math.ceil(payload.height)) + 'px'
  })
})()
`
}

export default defineEventHandler((event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const clientPortalBaseUrl = String(
    runtimeConfig.public.openexpert.clientPortalBaseUrl || 'http://127.0.0.1:3006',
  )
  const frameOrigin = new URL(bookingWidgetScriptUrl(clientPortalBaseUrl)).origin

  setHeader(event, 'Content-Type', 'text/javascript; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=300, must-revalidate')
  setHeader(event, 'X-Content-Type-Options', 'nosniff')

  return legacyBookingWidgetShim(frameOrigin)
})
