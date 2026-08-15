import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CRM_CALCULATOR_PATHS,
  createOrganizationAdministrationNavigationItems,
  createSystemAdministrationNavigationItems,
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

test('builds compact organization administration navigation', () => {
  const items = createOrganizationAdministrationNavigationItems('acme')

  assert.deepEqual(items.map(item => ({ label: item.label, to: item.to })), [
    { label: 'Użytkownicy', to: `${organizationBase}/users` },
    { label: 'Zgody', to: `${organizationBase}/consents` },
    { label: 'Ustawienia', to: `${organizationBase}/settings/organization` },
  ])
})

test('keeps organization settings active across every settings tab and the legacy capacity URL', () => {
  const items = createOrganizationAdministrationNavigationItems('acme')
  const settingsPaths = [
    '/settings/organization',
    '/settings/intermediary',
    '/settings/capacity',
    '/settings/design',
    '/settings/design/materials',
    '/mortgages/capacity/admin',
  ]

  for (const path of settingsPaths) {
    assert.deepEqual(
      items.filter(item => isCrmNavigationPathActive(`${organizationBase}${path}`, item)).map(item => item.label),
      ['Ustawienia'],
    )
  }

  for (const path of ['/settings/account', '/settings/institutions', '/settings/products']) {
    assert.deepEqual(
      items.filter(item => isCrmNavigationPathActive(`${organizationBase}${path}`, item)).map(item => item.label),
      [],
    )
  }
})

test('builds the sidebar navigation for system administration pages', () => {
  assert.deepEqual(createSystemAdministrationNavigationItems('acme'), [
    {
      label: 'Instytucje',
      to: `${organizationBase}/settings/institutions`,
      icon: 'i-lucide-landmark',
      exact: false,
    },
    {
      label: 'Produkty kredytowe',
      to: `${organizationBase}/settings/products`,
      icon: 'i-lucide-package-search',
      exact: false,
    },
    {
      label: 'Dokumenty bankowe',
      to: `${organizationBase}/settings/institution-files`,
      icon: 'i-lucide-folder-search-2',
      exact: false,
    },
  ])
})

test('marks exactly one system administration item active on base and nested paths', () => {
  const items = createSystemAdministrationNavigationItems('acme')

  for (const activeItem of items) {
    assert.deepEqual(
      items.filter(item => isCrmNavigationPathActive(activeItem.to, item)).map(item => item.label),
      [activeItem.label],
    )
  }

  const nestedPaths = [
    [`${organizationBase}/settings/institutions/institution-1`, 'Instytucje'],
    [`${organizationBase}/settings/products/product-1`, 'Produkty kredytowe'],
    [`${organizationBase}/settings/institution-files/file-1`, 'Dokumenty bankowe'],
  ] as const

  for (const [path, expectedLabel] of nestedPaths) {
    assert.deepEqual(
      items.filter(item => isCrmNavigationPathActive(path, item)).map(item => item.label),
      [expectedLabel],
    )
  }
})

test('encodes organization slugs in system administration links', () => {
  assert.equal(
    createSystemAdministrationNavigationItems('oddział warszawa')[0]?.to,
    '/org/oddzia%C5%82%20warszawa/settings/institutions',
  )
})
