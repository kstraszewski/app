import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isMortgageCalculationShortlistable,
  mortgageCalculationSnapshot,
} from '../server/utils/mortgage-case-offers.ts'

test('shortlists complete and partial calculations, but never invalid scenarios', () => {
  assert.equal(isMortgageCalculationShortlistable('complete', true), true)
  assert.equal(isMortgageCalculationShortlistable('partial', true), true)
  assert.equal(isMortgageCalculationShortlistable('ineligible', true), false)
  assert.equal(isMortgageCalculationShortlistable('unsupported', true), false)
  assert.equal(isMortgageCalculationShortlistable('complete', false), false)
  assert.equal(isMortgageCalculationShortlistable('partial', false), false)
})

test('keeps the calculation status and issues inside the frozen snapshot', () => {
  assert.deepEqual(
    mortgageCalculationSnapshot(
      { netLoanAmount: '480000.00' },
      'partial',
      [{ kind: 'incomplete', code: 'unknown_cost' }],
    ),
    {
      netLoanAmount: '480000.00',
      status: 'partial',
      issues: [{ kind: 'incomplete', code: 'unknown_cost' }],
    },
  )
})
