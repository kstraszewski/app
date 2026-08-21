import assert from 'node:assert/strict'

const baseUrl = new URL(process.env.SEO_BASE_URL || 'http://127.0.0.1:3003')
const canonicalOrigin = new URL(
  process.env.SEO_CANONICAL_ORIGIN || 'https://www.openexpert.app',
).origin

const publicRoutes = ['/', '/personalizacja', '/poczta-dla-ekseprta', '/posrednictwo-kredytowe', '/o-nas']
const noindexRoutes = ['/waitlist', '/multiform-eve', '/multiform-eve/admin', '/eksperci', '/placowki']
const socialImages = new Map([
  ['/', '/openexpert-og.png'],
  ['/eksperci', '/eksperci-og.png'],
  ['/placowki', '/placowki-og.png'],
  ['/personalizacja', '/openexpert-og.png'],
  ['/poczta-dla-ekseprta', '/openexpert-og.png'],
  ['/posrednictwo-kredytowe', '/openexpert-og.png'],
  ['/o-nas', '/o-nas-og.png'],
])

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    redirect: 'manual',
    ...options,
  })
  return {
    response,
    text: await response.text(),
  }
}

for (const path of publicRoutes) {
  const { response, text } = await request(path)
  assert.equal(response.status, 200, `${path} should return 200`)
  assert.match(text, /<html[^>]+lang="pl"/, `${path} should declare Polish`)
  assert.match(text, /<meta name="robots" content="index, follow, max-image-preview:large">/)
  assert.equal((text.match(/<h1(?:\s|>)/g) ?? []).length, 1, `${path} should have one H1`)

  const expectedCanonical = new URL(path, `${canonicalOrigin}/`).toString()
  assert.match(
    text,
    new RegExp(`<link rel="canonical" href="${escapeRegExp(expectedCanonical)}">`),
    `${path} should use its final canonical URL`,
  )
  const expectedSocialImage = new URL(socialImages.get(path), `${canonicalOrigin}/`).toString()
  assert.match(
    text,
    new RegExp(`<meta property="og:image" content="${escapeRegExp(expectedSocialImage)}">`),
    `${path} should expose its representative social image`,
  )
  assert.match(text, /<meta property="og:image:width" content="1200">/)
  assert.match(text, /<meta property="og:image:height" content="630">/)
  assert.match(text, /<meta property="og:image:type" content="image\/png">/)
  assert.match(text, /<meta property="og:image:alt" content="[^"]+">/)
  assert.doesNotMatch(text, /fonts\.googleapis\.com/, `${path} should not block on Google Fonts`)

  for (const json of text.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)) {
    assert.doesNotThrow(() => JSON.parse(json[1]), `${path} should contain valid JSON-LD`)
  }
}

for (const path of noindexRoutes) {
  const { response, text } = await request(path)
  assert.equal(response.status, 200, `${path} should remain reachable for noindex`)
  assert.match(
    response.headers.get('x-robots-tag') || text,
    /noindex/i,
    `${path} should be excluded from indexing`,
  )
}

for (const [source, target] of [
  ['/eksperci/', '/eksperci'],
  ['/placowki/', '/placowki'],
  ['/plac%C3%B3wki', '/placowki'],
  ['/personalizacja/', '/personalizacja'],
  ['/poczta-dla-ekseprta/', '/poczta-dla-ekseprta'],
  ['/posrednictwo-kredytowe/', '/posrednictwo-kredytowe'],
  ['/o-nas/', '/o-nas'],
]) {
  const { response } = await request(source)
  assert.equal(response.status, 301, `${source} should redirect permanently`)
  assert.equal(response.headers.get('location'), target)
}

const missing = await request('/seo-smoke-url-that-does-not-exist')
assert.equal(missing.response.status, 404, 'unknown routes should return a real 404')
const removedAuthCallback = await request('/confirm')
assert.equal(removedAuthCallback.response.status, 404, 'removed auth callback should not be a blank indexable 200')

for (const socialImage of new Set(socialImages.values())) {
  const { response } = await request(socialImage)
  assert.equal(response.status, 200, `${socialImage} should be available`)
  assert.match(response.headers.get('content-type') || '', /^image\/png\b/)
}

const robots = await request('/robots.txt')
assert.equal(robots.response.status, 200)
assert.match(robots.text, new RegExp(`Sitemap: ${escapeRegExp(canonicalOrigin)}/sitemap\\.xml`))

const sitemap = await request('/sitemap.xml')
assert.equal(sitemap.response.status, 200)
assert.doesNotMatch(sitemap.text, /<priority>|<changefreq>|eksperci|placowki|plac%C3%B3wki|waitlist/)
for (const path of publicRoutes) {
  assert.match(sitemap.text, new RegExp(`<loc>${escapeRegExp(new URL(path, `${canonicalOrigin}/`).toString())}</loc>`))
}

console.log(`SEO smoke passed for ${baseUrl.origin}`)
