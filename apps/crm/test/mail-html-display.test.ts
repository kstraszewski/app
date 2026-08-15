import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMailHtmlSrcdoc,
  enableMailRemoteImages,
  MAIL_HTML_BLOCKED_IMAGES_CSP,
  MAIL_HTML_IFRAME_SANDBOX,
  MAIL_HTML_REMOTE_IMAGES_CSP,
} from '../app/utils/mail-html-display.ts'

describe('sandboxed mail HTML display', () => {
  const proxyPath = '/api/org/demo/mail/remote-image'

  it('uses a deny-by-default iframe boundary and allows only inline styles', () => {
    const srcdoc = buildMailHtmlSrcdoc('<p style="color: red">Wiadomość</p>')

    assert.equal(MAIL_HTML_IFRAME_SANDBOX, 'allow-same-origin')
    assert.doesNotMatch(MAIL_HTML_IFRAME_SANDBOX, /scripts|forms|popups|downloads|navigation/u)
    assert.match(MAIL_HTML_BLOCKED_IMAGES_CSP, /default-src 'none'/u)
    assert.match(MAIL_HTML_BLOCKED_IMAGES_CSP, /style-src 'unsafe-inline'/u)
    assert.match(MAIL_HTML_BLOCKED_IMAGES_CSP, /script-src 'none'/u)
    assert.match(MAIL_HTML_BLOCKED_IMAGES_CSP, /form-action 'none'/u)
    assert.doesNotMatch(MAIL_HTML_BLOCKED_IMAGES_CSP, /https?:/u)
    assert.match(srcdoc, /<head><meta http-equiv="Content-Security-Policy"/u)
    assert.match(srcdoc, /<meta name="referrer" content="no-referrer">/u)
  })

  it('keeps remote images inert until the user explicitly enables them', () => {
    const html = '<img data-mail-remote-src="https://tracker.example/pixel.png" alt="Oferta">'
    const blocked = buildMailHtmlSrcdoc(html)
    const enabled = buildMailHtmlSrcdoc(html, {
      loadRemoteImages: true,
      remoteImageProxyPath: proxyPath,
    })

    assert.match(blocked, /data-mail-remote-src="https:\/\/tracker\.example\/pixel\.png"/u)
    assert.doesNotMatch(blocked, /<img src="https:\/\/tracker\.example/u)
    assert.doesNotMatch(MAIL_HTML_BLOCKED_IMAGES_CSP, /https?:/u)

    assert.match(
      enabled,
      /<img src="\/api\/org\/demo\/mail\/remote-image\?url=https%3A%2F%2Ftracker\.example%2Fpixel\.png"/u,
    )
    assert.doesNotMatch(enabled, /data-mail-remote-src/u)
    assert.doesNotMatch(enabled, /<img src="https?:\/\//u)
    assert.match(MAIL_HTML_REMOTE_IMAGES_CSP, /img-src data: 'self'/u)
    assert.doesNotMatch(MAIL_HTML_REMOTE_IMAGES_CSP, /https?:/u)
  })

  it('normalizes protocol-relative sources and keeps unrelated markup unchanged', () => {
    const html = [
      '<p data-mail-remote-src="https://example.com/not-an-image">data-mail-remote-src="tekst"</p>',
      '<img class="offer" width="640" alt="data-mail-remote-src" data-mail-remote-src="//images.example/offer.jpg?one=1&amp;two=2">',
    ].join('')

    assert.equal(enableMailRemoteImages(html, proxyPath), [
      '<p data-mail-remote-src="https://example.com/not-an-image">data-mail-remote-src="tekst"</p>',
      '<img class="offer" width="640" alt="data-mail-remote-src" src="/api/org/demo/mail/remote-image?url=https%3A%2F%2Fimages.example%2Foffer.jpg%3Fone%3D1%26two%3D2">',
    ].join(''))
  })

  it('fails closed without the fixed same-origin proxy path', () => {
    const html = '<img data-mail-remote-src="https://tracker.example/pixel.png">'

    for (const remoteImageProxyPath of [
      undefined,
      'https://proxy.example/image',
      '//proxy.example/image',
      '/api/org/demo/mail/remote-image?next=https://proxy.example',
      '/api/org/DEMO/mail/remote-image',
    ]) {
      assert.equal(enableMailRemoteImages(html, remoteImageProxyPath), html)
      const srcdoc = buildMailHtmlSrcdoc(html, {
        loadRemoteImages: true,
        remoteImageProxyPath,
      })
      assert.match(srcdoc, /data-mail-remote-src/u)
      assert.match(srcdoc, new RegExp(escapeRegExp(MAIL_HTML_BLOCKED_IMAGES_CSP), 'u'))
    }
  })

  it('leaves malformed or unsafe markers inert', () => {
    const sources = [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'https://user:secret@example.com/pixel.png',
      'https://example.com:8443/pixel.png',
      'https://example.com/space here.png',
    ]

    for (const source of sources) {
      const html = `<img data-mail-remote-src="${source}">`
      assert.equal(enableMailRemoteImages(html, proxyPath), html)
    }
  })
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
