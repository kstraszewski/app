import assert from 'node:assert/strict'
import test from 'node:test'
import { isMortgageOfferApplicationReady } from '../app/utils/mortgage-offer-readiness.ts'

test('a saved shortlist calculation can start a draft bank application', () => {
  assert.equal(isMortgageOfferApplicationReady('complete'), true)
  assert.equal(isMortgageOfferApplicationReady('partial'), true)
  assert.equal(isMortgageOfferApplicationReady('ineligible'), false)
  assert.equal(isMortgageOfferApplicationReady('unsupported'), false)
  assert.equal(isMortgageOfferApplicationReady(undefined), false)
})
