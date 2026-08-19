import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const catalog = source('../server/utils/mortgage-catalog.ts')
const calculator = source('../app/pages/org/[organizationSlug]/calculator/mortgages/index.vue')

test('calculator receives and clearly labels synthetic-bank offers', () => {
  assert.match(catalog, /isMock: rawBank\.is_mock === true/u)
  assert.match(calculator, /isMock: boolean/u)
  assert.match(calculator, /v-if="offer\.product\.bank\.isMock"/u)
  assert.match(calculator, /color="warning"/u)
  assert.match(calculator, /label="Bank testowy · dane syntetyczne"/u)
})
