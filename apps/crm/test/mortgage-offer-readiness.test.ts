import assert from 'node:assert/strict'
import test from 'node:test'
import { isMortgageOfferApplicationReady } from '../app/utils/mortgage-offer-readiness.ts'

test('only a complete frozen calculation can advance to a bank application', () => {
  assert.equal(isMortgageOfferApplicationReady('complete'), true)
  assert.equal(isMortgageOfferApplicationReady('partial'), false)
  assert.equal(isMortgageOfferApplicationReady('ineligible'), false)
  assert.equal(isMortgageOfferApplicationReady('unsupported'), false)
  assert.equal(isMortgageOfferApplicationReady(undefined), false)
})
