import assert from 'node:assert/strict'
import test from 'node:test'

import { clientLegalDocumentsEmailTemplate } from '../server/utils/client-legal-documents-email.ts'

test('builds accessible Polish HTML and a matching plain-text alternative', () => {
  const template = clientLegalDocumentsEmailTemplate({ organizationName: 'Dobry Kredyt' })

  assert.equal(template.subject, 'Dokumenty OFI i RODO – Dobry Kredyt')
  assert.match(template.html, /<html lang="pl" dir="ltr">/u)
  assert.match(template.html, /<title>Dokumenty OFI i RODO – Dobry Kredyt<\/title>/u)
  assert.match(template.html, /<main\b/u)
  assert.equal(template.html.match(/<h1\b/gu)?.length, 1)
  assert.match(template.text, /Informacja dla konsumenta \(OFI\.pdf\)/u)
  assert.match(template.text, /Klauzula informacyjna RODO \(RODO\.pdf\)/u)
  assert.match(template.text, /nie jest prośbą o wyrażenie zgody/u)
  assert.match(template.text, /skontaktuj się bezpośrednio z Dobry Kredyt/u)
})

test('escapes interpolated organization data and prevents subject header injection', () => {
  const template = clientLegalDocumentsEmailTemplate({
    organizationName: '  Firma & <script>alert("x")</script>\r\nBcc: osoba@example.com  ',
  })

  assert.ok(!template.subject.includes('\r'))
  assert.ok(!template.subject.includes('\n'))
  assert.match(template.subject, /<script>alert\("x"\)<\/script> Bcc:/u)
  assert.ok(!template.html.includes('<script>'))
  assert.match(
    template.html,
    /Firma &amp; &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; Bcc: osoba@example\.com/u,
  )
})

test('keeps the transactional template free from tracking and marketing controls', () => {
  const template = clientLegalDocumentsEmailTemplate({ organizationName: 'Dobry Kredyt' })

  assert.doesNotMatch(template.html, /<a\b|https?:\/\/|unsubscribe|wypisz/iu)
  assert.doesNotMatch(template.text, /https?:\/\/|unsubscribe|wypisz/iu)
})

test('uses a clear fallback when the organization name is empty', () => {
  const template = clientLegalDocumentsEmailTemplate({ organizationName: '   ' })

  assert.equal(template.subject, 'Dokumenty OFI i RODO')
  assert.match(template.text, /dokumenty od Twojego pośrednika kredytowego/u)
  assert.match(template.text, /skontaktuj się bezpośrednio ze swoim pośrednikiem kredytowym/u)
})
