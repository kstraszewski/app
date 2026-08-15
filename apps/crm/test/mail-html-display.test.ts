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
    const enabled = buildMailHtmlSrcdoc(html, { loadRemoteImages: true })

    assert.match(blocked, /data-mail-remote-src="https:\/\/tracker\.example\/pixel\.png"/u)
    assert.doesNotMatch(blocked, /<img src="https:\/\/tracker\.example/u)
    assert.doesNotMatch(MAIL_HTML_BLOCKED_IMAGES_CSP, /https?:/u)

    assert.match(enabled, /<img src="https:\/\/tracker\.example\/pixel\.png"/u)
    assert.doesNotMatch(enabled, /data-mail-remote-src/u)
    assert.match(MAIL_HTML_REMOTE_IMAGES_CSP, /img-src data: https: http:/u)
  })

  it('does not mutate unrelated attributes, text, or non-image elements', () => {
    const html = [
      '<p data-mail-remote-src="https://example.com/not-an-image">data-mail-remote-src="tekst"</p>',
      '<img class="offer" width="640" alt="data-mail-remote-src" data-mail-remote-src="https://images.example/offer.jpg">',
    ].join('')

    assert.equal(enableMailRemoteImages(html), [
      '<p data-mail-remote-src="https://example.com/not-an-image">data-mail-remote-src="tekst"</p>',
      '<img class="offer" width="640" alt="data-mail-remote-src" src="https://images.example/offer.jpg">',
    ].join(''))
  })
})
