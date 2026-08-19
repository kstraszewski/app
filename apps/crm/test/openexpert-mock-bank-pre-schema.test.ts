import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const files = [
  'server/api/org/[organizationSlug]/mortgages/banks.get.ts',
  'server/utils/mortgage-catalog.ts',
  'server/utils/experiment-knowledge.ts',
  'server/utils/intermediary-lenders.ts',
  'server/api/org/[organizationSlug]/mortgages/files/index.get.ts',
  'server/utils/mortgage-bank-files.ts',
]

test('pre-schema bridge hides the reserved mock-bank slug without new columns', async () => {
  const sources = await Promise.all(files.map(async path => ({
    path,
    source: await readFile(new URL(`../${path}`, import.meta.url), 'utf8'),
  })))
  for (const { path, source } of sources) {
    assert.match(source, /openexpert-bank/u, `${path} must reserve the mock-bank slug`)
    assert.doesNotMatch(source, /is_mock/u, `${path} must remain compatible with schema 0056`)
  }
  assert.equal(
    sources.find(item => item.path.endsWith('experiment-knowledge.ts'))
      ?.source.match(/\.neq\('slug', 'openexpert-bank'\)/gu)?.length,
    2,
  )
})
