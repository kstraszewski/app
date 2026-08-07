import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  canonicalJson,
  semanticVersionDigest,
} from '../scripts/sync-mortgage-catalog.mjs'

test('kanonizuje obiekty niezależnie od kolejności kluczy', () => {
  assert.equal(
    canonicalJson({ z: 1, nested: { b: 2, a: 1 } }),
    canonicalJson({ nested: { a: 1, b: 2 }, z: 1 }),
  )
})

test('hash wersji ignoruje klucz techniczny, ale wykrywa zmianę parametrów', () => {
  const version = {
    versionKey: 'bank-product-2026-07-25',
    fixedRatePct: 6.25,
    requirements: [{ code: 'income', required: true }],
  }

  assert.equal(
    semanticVersionDigest(version),
    semanticVersionDigest({ ...version, versionKey: 'renamed-key' }),
  )
  assert.notEqual(
    semanticVersionDigest(version),
    semanticVersionDigest({ ...version, fixedRatePct: 6.35 }),
  )
})

test('manifest Erste uses a direct HTTPS image asset', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../data/mortgages/pl-2026-07-12.json', import.meta.url),
    'utf8',
  ))
  const erste = manifest.products.find(item => item.bank?.slug === 'erste')

  assert.ok(erste)
  assert.match(erste.bank.logoUrl, /^https:\/\/.+\.(png|jpe?g|webp|svg)(?:[?#].*)?$/iu)
  assert.deepEqual(erste.bank.aliases, [
    { value: 'Santander Bank Polska', type: 'former_name' },
    { value: 'santander.pl', type: 'former_domain' },
  ])
})

test('manifest provides accessible brand pairs for every mortgage bank', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../data/mortgages/pl-2026-07-12.json', import.meta.url),
    'utf8',
  ))

  const banks = manifest.products.map(item => item.bank)
  assert.deepEqual(banks.map(bank => bank.slug).sort(), ['erste', 'ing', 'mbank', 'pekao', 'pko-bp'])
  for (const bank of banks) {
    assert.match(bank.brandColor, /^#[0-9A-F]{6}$/u)
    assert.match(bank.brandForegroundColor, /^#[0-9A-F]{6}$/u)
  }
})
