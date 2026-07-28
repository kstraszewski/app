import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRobotsText,
  buildSitemapXml,
  INDEXABLE_PUBLIC_PATHS,
  normalizePublicOrigin,
} from '../server/utils/seo.ts'

test('normalizes the configured canonical origin and rejects unsupported protocols', () => {
  assert.equal(
    normalizePublicOrigin('https://www.openexpert.app/path', 'http://localhost:3003'),
    'https://www.openexpert.app',
  )
  assert.equal(
    normalizePublicOrigin('javascript:alert(1)', 'http://127.0.0.1:3003'),
    'http://127.0.0.1:3003',
  )
})

test('robots points to the canonical sitemap without blocking noindex pages', () => {
  const robots = buildRobotsText('https://www.openexpert.app')

  assert.match(robots, /^User-agent: \*\nAllow: \/\n/m)
  assert.match(robots, /Disallow: \/api\//)
  assert.match(robots, /Disallow: \/eve\//)
  assert.match(robots, /Disallow: \/_eve_internal\//)
  assert.match(robots, /Sitemap: https:\/\/www\.openexpert\.app\/sitemap\.xml/)
  assert.doesNotMatch(robots, /multiform-eve/)
})

test('sitemap contains only canonical, indexable URLs and no ignored hints', () => {
  const sitemap = buildSitemapXml('https://www.openexpert.app')

  for (const path of INDEXABLE_PUBLIC_PATHS) {
    const expected = new URL(path, 'https://www.openexpert.app/').toString()
    assert.match(sitemap, new RegExp(`<loc>${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>`))
  }

  assert.doesNotMatch(sitemap, /eksperci|placowki|plac%C3%B3wki|waitlist|multiform-eve|<priority>|<changefreq>/)
  assert.equal((sitemap.match(/<url>/g) ?? []).length, INDEXABLE_PUBLIC_PATHS.length)
})
