import { sendRedirect } from 'h3'

const CANONICAL_REDIRECTS = new Map([
  ['/eksperci/', '/eksperci'],
  ['/placowki/', '/placowki'],
  ['/placówki/', '/placowki'],
  ['/personalizacja/', '/personalizacja'],
  ['/poczta-dla-ekseprta/', '/poczta-dla-ekseprta'],
  ['/posrednictwo-kredytowe/', '/posrednictwo-kredytowe'],
  ['/o-nas/', '/o-nas'],
])

export default defineEventHandler((event) => {
  const requestUrl = new URL(event.node.req.url || '/', 'http://localhost')
  let pathname = requestUrl.pathname

  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    return
  }

  const canonicalPath = CANONICAL_REDIRECTS.get(pathname)
  if (!canonicalPath) return

  return sendRedirect(event, `${canonicalPath}${requestUrl.search}`, 301)
})
