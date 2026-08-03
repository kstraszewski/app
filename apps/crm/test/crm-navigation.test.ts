import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CRM_CALCULATOR_PATHS,
  isCrmNavigationPathActive,
  type CrmNavigationTarget,
} from '../app/utils/crm-navigation.ts'

const organizationBase = '/org/acme'
const calculators = [
  {
    label: 'Zdolność',
    to: `${organizationBase}${CRM_CALCULATOR_PATHS.capacity}`,
  },
  {
    label: 'Hipoteki',
    to: `${organizationBase}${CRM_CALCULATOR_PATHS.mortgages}`,
  },
] satisfies Array<CrmNavigationTarget & { label: string }>

function activeCalculatorLabels(path: string) {
  return calculators
    .filter(item => isCrmNavigationPathActive(path, item))
    .map(item => item.label)
}

test('marks only capacity active on the capacity calculator route', () => {
  assert.deepEqual(
    activeCalculatorLabels(`${organizationBase}${CRM_CALCULATOR_PATHS.capacity}`),
    ['Zdolność'],
  )
})

test('marks only mortgages active on mortgage calculator routes', () => {
  assert.deepEqual(
    activeCalculatorLabels(`${organizationBase}${CRM_CALCULATOR_PATHS.mortgages}`),
    ['Hipoteki'],
  )
  assert.deepEqual(
    activeCalculatorLabels(`${organizationBase}${CRM_CALCULATOR_PATHS.mortgages}/details`),
    ['Hipoteki'],
  )
})

test('does not mark a calculator active on capacity administration routes', () => {
  assert.deepEqual(activeCalculatorLabels(`${organizationBase}/settings/capacity`), [])
})
