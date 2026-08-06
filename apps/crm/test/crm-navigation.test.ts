import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CRM_CALCULATOR_PATHS,
  createMortgageAdminNavigationItems,
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

test('builds the sidebar navigation for mortgage administration pages', () => {
  assert.deepEqual(createMortgageAdminNavigationItems('acme'), [
    {
      label: 'Instytucje',
      to: `${organizationBase}/settings/institutions`,
      icon: 'i-lucide-landmark',
      exact: false,
    },
    {
      label: 'Produkty',
      to: `${organizationBase}/settings/products`,
      icon: 'i-lucide-package-search',
      exact: false,
    },
    {
      label: 'Pliki z banków',
      to: `${organizationBase}/settings/institution-files`,
      icon: 'i-lucide-folder-search-2',
      exact: false,
    },
  ])
})

test('marks exactly one mortgage administration item active on each page', () => {
  const items = createMortgageAdminNavigationItems('acme')

  for (const activeItem of items) {
    assert.deepEqual(
      items.filter(item => isCrmNavigationPathActive(activeItem.to, item)).map(item => item.label),
      [activeItem.label],
    )
  }

  assert.deepEqual(
    items
      .filter(item => isCrmNavigationPathActive(`${organizationBase}/settings/products/product-1`, item))
      .map(item => item.label),
    ['Produkty'],
  )
})

test('encodes organization slugs in mortgage administration links', () => {
  assert.equal(
    createMortgageAdminNavigationItems('oddział warszawa')[0]?.to,
    '/org/oddzia%C5%82%20warszawa/settings/institutions',
  )
})
