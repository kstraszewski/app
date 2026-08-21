export const INDEXABLE_PUBLIC_PATHS = [
  '/',
  '/personalizacja',
  '/poczta-dla-ekseprta',
  '/posrednictwo-kredytowe',
  '/o-nas',
] as const

export function normalizePublicOrigin(configured: string, fallback: string): string {
  for (const candidate of [configured, fallback, 'https://www.openexpert.app']) {
    try {
      const url = new URL(candidate)
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin
    } catch {
      // Try the next explicit fallback.
    }
  }

  return 'https://www.openexpert.app'
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;')
}

export function buildRobotsText(origin: string): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /eve/',
    'Disallow: /_eve_internal/',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')
}

export function buildSitemapXml(
  origin: string,
  paths: readonly string[] = INDEXABLE_PUBLIC_PATHS,
): string {
  const urls = paths.map(path => [
    '  <url>',
    `    <loc>${escapeXml(new URL(path, `${origin}/`).toString())}</loc>`,
    '  </url>',
  ].join('\n')).join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n')
}
