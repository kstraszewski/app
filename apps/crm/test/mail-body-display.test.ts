import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mailBodyParagraphs,
  mailBodySegments,
  mailUrlDisplay,
  normalizeMailBodyDisplayText,
} from '../app/utils/mail-body-display.ts'

test('shortens a long tracking URL without losing its inert source value', () => {
  const trackingUrl = `https://www.linkedin.com/comm/feed/update/urn:li:activity:7490354621656272896?${'tracking=value&'.repeat(120)}`
  const paragraphs = mailBodyParagraphs([
    'Mariusz udostępnił publikację.',
    '',
    `Przeczytaj więcej: ${trackingUrl}`,
  ].join('\n'))
  const url = paragraphs[1]?.segments.find(segment => segment.type === 'url')

  assert.equal(url?.type, 'url')
  if (url?.type !== 'url') return
  assert.equal(url.value, trackingUrl)
  assert.equal(url.domain, 'linkedin.com')
  assert.equal(url.label, 'linkedin.com/comm/…')
  assert.ok(url.label.length < 40)
})

test('removes accidental line indentation while preserving paragraphs and hard breaks', () => {
  const normalized = normalizeMailBodyDisplayText([
    'Pierwszy akapit',
    '',
    '                                3W S.A. udostępnił(a) publikację',
    '  dalszy wiersz',
    '',
    '',
    '',
    'Koniec   ',
  ].join('\r\n'))

  assert.equal(normalized, [
    'Pierwszy akapit',
    '',
    '    3W S.A. udostępnił(a) publikację',
    '  dalszy wiersz',
    '',
    '',
    'Koniec',
  ].join('\n'))
})

test('preserves ordinary nested indentation in plain text', () => {
  const value = normalizeMailBodyDisplayText([
    '        poziom drugi',
    '            poziom trzeci',
  ].join('\n'))

  assert.equal(value, [
    '        poziom drugi',
    '            poziom trzeci',
  ].join('\n'))
})

test('caps URL and paragraph DOM fan-out for an untrusted message body', () => {
  const urlFlood = Array.from({ length: 1_000 }, (_, index) => `https://example.com/${index}`).join(' ')
  const segments = mailBodySegments(urlFlood)
  const urlSegments = segments.filter(segment => segment.type === 'url')

  assert.equal(urlSegments.length, 100)
  assert.ok(segments.length <= 201)
  assert.match(segments.at(-1)?.value || '', /https:\/\/example\.com\/999/u)

  const paragraphFlood = Array.from({ length: 1_000 }, (_, index) => `Akapit ${index}`).join('\n\n')
  const paragraphs = mailBodyParagraphs(paragraphFlood)
  assert.equal(paragraphs.length, 200)
  assert.match(paragraphs.at(-1)?.segments.at(-1)?.value || '', /Akapit 999/u)
})

test('keeps unsafe schemes and markup as ordinary escaped display text', () => {
  const input = '<script>alert(1)</script> javascript:alert(1) data:text/html,boom'
  assert.deepEqual(mailBodySegments(input), [{ type: 'text', value: input }])
})

test('leaves sentence punctuation outside the URL segment', () => {
  assert.deepEqual(mailBodySegments('Zobacz (https://example.com/oferta).'), [
    { type: 'text', value: 'Zobacz (' },
    {
      type: 'url',
      value: 'https://example.com/oferta',
      label: 'https://example.com/oferta',
      domain: 'example.com',
    },
    { type: 'text', value: ').' },
  ])
})

test('marks quoted replies and signatures for quieter presentation', () => {
  const paragraphs = mailBodyParagraphs([
    'Nowa odpowiedź.',
    '',
    '> Poprzednia wiadomość',
    '> Drugi wiersz',
    '',
    '-- ',
    'Anna Nowak',
  ].join('\n'))

  assert.deepEqual(paragraphs.map(paragraph => paragraph.kind), [
    'text',
    'quote',
    'signature',
  ])
  assert.equal(paragraphs[1]?.segments[0]?.value, 'Poprzednia wiadomość\nDrugi wiersz')
})

test('uses the full label for concise web addresses', () => {
  assert.deepEqual(mailUrlDisplay('https://example.com/oferta'), {
    label: 'https://example.com/oferta',
    domain: 'example.com',
  })
})
