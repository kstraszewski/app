import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDynamicContentBootMessage,
  buildDynamicContentPreviewShell,
  DYNAMIC_CONTENT_IFRAME_SANDBOX,
  DYNAMIC_CONTENT_PREVIEW_CSP,
  DYNAMIC_CONTENT_PREVIEW_NAMESPACE,
  isDynamicContentWithinLimits,
  parseDynamicContentPreviewMessage,
} from '../app/utils/dynamic-content-preview.ts'

describe('dynamic content preview boundary', () => {
  it('uses only script execution in the opaque-origin iframe sandbox', () => {
    assert.equal(DYNAMIC_CONTENT_IFRAME_SANDBOX, 'allow-scripts')
    assert.doesNotMatch(DYNAMIC_CONTENT_IFRAME_SANDBOX, /same-origin|forms|popups|downloads|navigation/u)
  })

  it('puts a deny-by-default CSP before every other head element', () => {
    const shell = buildDynamicContentPreviewShell(
      'test-channel_123',
      'http://127.0.0.1:3004/org/openexpert-local',
    )

    const headStart = shell.indexOf('<head>')
    const cspStart = shell.indexOf('<meta http-equiv="Content-Security-Policy"')
    const charsetStart = shell.indexOf('<meta charset="utf-8">')
    assert.ok(headStart >= 0 && cspStart === headStart + '<head>'.length)
    assert.ok(cspStart < charsetStart)
    assert.match(DYNAMIC_CONTENT_PREVIEW_CSP, /default-src 'none'/u)
    assert.match(DYNAMIC_CONTENT_PREVIEW_CSP, /connect-src 'none'/u)
    assert.match(DYNAMIC_CONTENT_PREVIEW_CSP, /form-action 'none'/u)
    assert.match(DYNAMIC_CONTENT_PREVIEW_CSP, /frame-src 'none'/u)
    assert.match(DYNAMIC_CONTENT_PREVIEW_CSP, /worker-src 'none'/u)
    assert.match(DYNAMIC_CONTENT_PREVIEW_CSP, /script-src-attr 'none'/u)
    assert.doesNotMatch(DYNAMIC_CONTENT_PREVIEW_CSP, /https?:|unsafe-eval/u)
  })

  it('keeps model-authored source entirely outside the srcdoc envelope', () => {
    const attack = '</script><img src="https://attacker.invalid/leak">'
    const shell = buildDynamicContentPreviewShell('test-channel_456', 'https://crm.example.com')
    const source = {
      html: `<p>${attack}</p>`,
      css: `body::after { content: '${attack}' }`,
      javascript: `document.body.dataset.attack = ${JSON.stringify(attack)}`,
    }
    const message = buildDynamicContentBootMessage('test-channel_456', source)

    assert.doesNotMatch(shell, /attacker\.invalid|dataset\.attack/u)
    assert.equal(message.html, source.html)
    assert.equal(message.css, source.css)
    assert.equal(message.javascript, source.javascript)
  })

  it('rejects oversized content before sending it to the iframe', () => {
    const source = { html: 'x'.repeat(60_001), css: '', javascript: '' }
    assert.equal(isDynamicContentWithinLimits(source), false)
    assert.throws(
      () => buildDynamicContentBootMessage('test-channel_789', source),
      /exceeds the preview size limit/u,
    )
  })

  it('accepts only bounded messages for the current channel and namespace', () => {
    const current = 'test-channel_current'
    assert.deepEqual(parseDynamicContentPreviewMessage({
      namespace: DYNAMIC_CONTENT_PREVIEW_NAMESPACE,
      channelId: current,
      type: 'ready',
    }, current), { type: 'ready' })

    assert.equal(parseDynamicContentPreviewMessage({
      namespace: DYNAMIC_CONTENT_PREVIEW_NAMESPACE,
      channelId: 'test-channel_stale',
      type: 'ready',
    }, current), null)
    assert.equal(parseDynamicContentPreviewMessage({
      namespace: 'another-app',
      channelId: current,
      type: 'ready',
    }, current), null)
    assert.equal(parseDynamicContentPreviewMessage({
      namespace: DYNAMIC_CONTENT_PREVIEW_NAMESPACE,
      channelId: current,
      type: 'crm-action',
      action: 'read-session',
    }, current), null)

    const error = parseDynamicContentPreviewMessage({
      namespace: DYNAMIC_CONTENT_PREVIEW_NAMESPACE,
      channelId: current,
      type: 'runtime-error',
      message: 'x'.repeat(900),
    }, current)
    assert.equal(error?.type, 'runtime-error')
    assert.equal(error?.type === 'runtime-error' ? error.message.length : 0, 500)
  })
})
