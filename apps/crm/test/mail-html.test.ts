import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeMailHtml } from '../server/utils/mail-html.ts'

test('removes executable and embedded document content', () => {
  const result = sanitizeMailHtml(`
    <script>alert('script')</script>
    <style>body { background: red }</style>
    <svg onload="alert('svg')"><script>alert('nested')</script></svg>
    <form action="https://attacker.example"><input autofocus onfocus="alert(1)"></form>
    <iframe srcdoc="<script>alert(1)</script>"></iframe>
    <object data="https://attacker.example/payload"></object>
    <p onclick="alert(1)">Bezpieczna treść</p>
  `)

  assert.match(result.html || '', /Bezpieczna treść/u)
  assert.doesNotMatch(
    result.html || '',
    /script|style|svg|form|input|iframe|object|on(?:load|click|focus)|srcdoc|autofocus/iu,
  )
  assert.equal(result.hasRemoteImages, false)
})

test('preserves common email layout and safe inline styles', () => {
  const result = sanitizeMailHtml(`
    <table role="presentation" width="600" cellpadding="0" cellspacing="0">
      <tbody><tr><td align="center" bgcolor="#ffffff">
        <font face="Arial" color="#222222">
          <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">
            Preheader&nbsp;&zwnj;&zwnj;
          </div>
          <span style="color:#e21;font-size:18px;text-align:center">Oferta</span>
        </font>
      </td></tr></tbody>
    </table>
  `)

  const html = result.html || ''
  assert.match(html, /<table[^>]*role="presentation"[^>]*width="600"/u)
  assert.match(html, /<font face="Arial" color="#222222">/u)
  assert.match(html, /style="display:none;max-height:0;overflow:hidden;mso-hide:all"/u)
  assert.match(html, /style="color:#e21;font-size:18px;text-align:center"/u)
  assert.ok(html.includes('\u00A0'))
  assert.ok(html.includes('\u200C'))
  assert.doesNotMatch(html, /&amp;zwnj;/u)
})

test('drops unsafe CSS declarations while retaining safe declarations', () => {
  const result = sanitizeMailHtml(`
    <div style="color:#123; background-image:url(https://tracker.example/pixel); width:expression(alert(1)); font-family:Arial; border:1px solid #ddd">
      Treść
    </div>
    <span style="background:-webkit-image-set('https://tracker.example/x' 1x);javascript:alert(1)">Druga</span>
  `)

  const html = result.html || ''
  assert.match(html, /color:#123/u)
  assert.match(html, /font-family:Arial/u)
  assert.match(html, /border:1px solid #ddd/u)
  assert.doesNotMatch(html, /url\s*\(|expression\s*\(|image-set\s*\(|javascript|tracker\.example/iu)
})

test('blocks remote images until explicitly enabled and preserves raster data images', () => {
  const result = sanitizeMailHtml(`
    <img src="https://cdn.example/image.png?one=1&amp;two=&quot;quoted&quot;" onerror="alert(1)" srcset="https://cdn.example/2x.png 2x" alt="Remote">
    <img src="//images.example/banner.jpg" alt="Protocol relative">
    <img src="data:image/png;base64,iVBORw0KGgo=" alt="Inline">
    <img src="cid:logo@example.com" alt="CID">
    <img src="javascript:alert(1)" data-mail-remote-src="https://attacker.example/forged" alt="Forged">
    <img src="data:image/svg+xml,%3Csvg%20onload='alert(1)'%3E" alt="SVG">
  `)

  const html = result.html || ''
  assert.equal(result.hasRemoteImages, true)
  assert.match(
    html,
    /data-mail-remote-src="https:\/\/cdn\.example\/image\.png\?one=1&amp;two=&quot;quoted&quot;"/u,
  )
  assert.match(html, /data-mail-remote-src="\/\/images\.example\/banner\.jpg"/u)
  assert.match(html, /src="data:image\/png;base64,iVBORw0KGgo="/u)
  assert.doesNotMatch(html, /\ssrc="(?:https?:|\/\/|cid:|javascript:|data:image\/svg)/iu)
  assert.doesNotMatch(html, /srcset|onerror|attacker\.example/iu)
})

test('keeps link formatting but removes every active destination', () => {
  const result = sanitizeMailHtml(`
    <a href="https://example.com/offer" target="_blank" ping="https://tracker.example" style="color:#06c;text-decoration:underline" onclick="alert(1)">
      Przejrzyj ofertę
    </a>
    <a href="javascript:alert(1)">Niebezpieczny link</a>
  `)

  const html = result.html || ''
  assert.match(html, /<a style="color:#06c;text-decoration:underline">/u)
  assert.match(html, /Przejrzyj ofertę/u)
  assert.match(html, /Niebezpieczny link/u)
  assert.doesNotMatch(html, /href|target|ping|onclick|example\.com/iu)
})

test('does not reactivate markup hidden inside xmp or malformed raw-text tags', () => {
  const result = sanitizeMailHtml(`
    <xmp><img src=x onerror=alert(1)></xmp>
    <p>Widoczna treść</p>
    <xmp><svg onload=alert(2)>
  `)

  const html = result.html || ''
  assert.equal(html.trim(), '<p>Widoczna treść</p>')
  assert.doesNotMatch(html, /img|svg|onerror|onload|alert/iu)
})

test('limits amplified output by re-sanitizing a balanced input prefix', () => {
  const result = sanitizeMailHtml(`<div>${'&'.repeat(300_000)}</div>`)
  const html = result.html || ''

  assert.equal(result.truncated, true)
  assert.ok(html.length <= 1_000_000)
  assert.match(html, /^<div>/u)
  assert.match(html, /<\/div>$/u)
  assert.equal((html.match(/<div>/gu) || []).length, (html.match(/<\/div>/gu) || []).length)
})

test('limits extreme input and still returns closed HTML', () => {
  const result = sanitizeMailHtml(`<div><span>${'A'.repeat(1_100_000)}</span></div>`)
  const html = result.html || ''

  assert.equal(result.truncated, true)
  assert.ok(html.length <= 1_000_000)
  assert.match(html, /^<div><span>/u)
  assert.match(html, /<\/span><\/div>$/u)
})
