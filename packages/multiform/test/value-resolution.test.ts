import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canonicalDerivationDependenciesForKey,
  decodePesel,
  formatCurrencyWords,
  resolveCanonicalValues,
} from '../src/index.ts'

const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]

function peselFor(date: string, genderDigit = 2) {
  const [year, month, day] = date.split('-').map(Number)
  assert.ok(year && month && day)
  const monthOffset = year >= 2200
    ? 60
    : year >= 2100
      ? 40
      : year >= 2000
        ? 20
        : year < 1900
          ? 80
          : 0
  const firstTen = [
    String(year % 100).padStart(2, '0'),
    String(month + monthOffset).padStart(2, '0'),
    String(day).padStart(2, '0'),
    '123',
    String(genderDigit),
  ].join('')
  const checksum = (10 - ([...firstTen].reduce((sum, digit, index) => (
    sum + Number(digit) * weights[index]!
  ), 0) % 10)) % 10
  return `${firstTen}${checksum}`
}

test('PESEL validates checksum and decodes all supported centuries', () => {
  for (const date of ['1899-12-31', '1990-01-01', '2001-02-03', '2104-05-06', '2207-08-09']) {
    const result = decodePesel(peselFor(date))
    assert.equal(result.valid, true)
    if (result.valid) {
      assert.equal(result.data.birthDate, date)
      assert.equal(result.data.gender, 'female')
    }
  }
  assert.deepEqual(decodePesel('87020223456'), {
    valid: false,
    error: 'Nieprawidłowa suma kontrolna numeru PESEL.',
  })
})

test('currency amount is written in Polish with correct inflection', () => {
  assert.equal(formatCurrencyWords(1), 'jeden złoty 00/100')
  assert.equal(formatCurrencyWords(2), 'dwa złote 00/100')
  assert.equal(formatCurrencyWords(5), 'pięć złotych 00/100')
  assert.equal(
    formatCurrencyWords('12 345,67'),
    'dwanaście tysięcy trzysta czterdzieści pięć złotych 67/100',
  )
  assert.equal(
    formatCurrencyWords('12.345,67'),
    'dwanaście tysięcy trzysta czterdzieści pięć złotych 67/100',
  )
  assert.equal(
    formatCurrencyWords('12,345.67'),
    'dwanaście tysięcy trzysta czterdzieści pięć złotych 67/100',
  )
})

test('resolver derives birth date and reports a conflicting manual date', () => {
  const pesel = peselFor('1990-01-01', 5)
  const clean = resolveCanonicalValues({ 'applicants.0.pesel': pesel })
  assert.equal(clean.values['applicants.0.birthDate'], '1990-01-01')
  assert.equal(clean.values['applicants.0.gender'], 'male')
  assert.equal(clean.metadata['applicants.0.birthDate']?.origin, 'derived')
  assert.deepEqual(clean.issues, [])

  const conflict = resolveCanonicalValues({
    'applicants.0.pesel': pesel,
    'applicants.0.birthDate': '1991-01-01',
  })
  assert.equal(conflict.issues[0]?.code, 'derived_value_conflict')
  assert.equal(conflict.issues[0]?.expectedValue, '1990-01-01')
})

test('resolver copies addresses and financed property only after explicit selection', () => {
  const result = resolveCanonicalValues({
    'applicants.0.correspondenceSameAsResidential': 'true',
    'applicants.0.residentialAddress': 'ul. Prosta 1/2, 00-001 Warszawa',
    'collateralProperty.sameAsFinancedProperty': 'true',
    'property.type': 'apartment',
    'property.address.street': 'Prosta',
    'property.address.houseNumber': '1',
    'property.address.unitNumber': '2',
    'property.address.postalCode': '00-001',
    'property.address.city': 'Warszawa',
    'property.landRegisterNumber': 'WA1M/00123456/7',
    'property.marketValue': 700000,
  })
  assert.equal(
    result.values['applicants.0.correspondenceAddress'],
    'ul. Prosta 1/2, 00-001 Warszawa',
  )
  assert.equal(result.values['collateralProperty.type'], 'apartment')
  assert.equal(result.values['collateralProperty.address'], 'Prosta 1/2, 00-001 Warszawa')
  assert.equal(result.values['collateralProperty.landRegisterNumber'], 'WA1M/00123456/7')
  assert.equal(result.values['collateralProperty.marketValue'], 700000)
})

test('resolver derives words, applicant reference, own funds and liability aggregates', () => {
  const result = resolveCanonicalValues({
    'applicants.0.firstName': 'Alicja',
    'applicants.0.lastName': 'Nowak',
    'applicants.0.averageNetIncome': '12 500,00',
    'applicants.0.incomeCurrency': 'PLN',
    'additionalProducts.creditCardApplicantIndex': '0',
    'investment.ownFundsPaid': 50000,
    'investment.ownFundsBeforeDisbursement': 40000,
    'investment.ownFundsDuringInvestment': 10000,
    'liabilities.0.installmentAmount': 1200,
    'liabilities.0.outstandingAmount': 90000,
    'liabilities.1.installmentAmount': 300,
    'liabilities.1.outstandingAmount': 10000,
  })
  assert.equal(
    result.values['applicants.0.averageNetIncomeInWords'],
    'dwanaście tysięcy pięćset złotych 00/100',
  )
  assert.equal(result.values['additionalProducts.creditCardApplicant'], 'Alicja Nowak')
  assert.equal(result.values['investment.ownFunds'], 100000)
  assert.equal(result.values['households.0.monthlyDebtInstallments'], 1500)
  assert.equal(result.values['households.0.outstandingDebt'], 100000)
})

test('resolver asks for a two-person household relation only once', () => {
  const result = resolveCanonicalValues({
    'applicants.0.sharedHouseholdWithApplicantNumber': '2',
  })
  assert.equal(result.values['applicants.1.sharedHouseholdWithApplicantNumber'], '1')
  assert.equal(
    result.metadata['applicants.1.sharedHouseholdWithApplicantNumber']?.origin,
    'derived',
  )
  assert.deepEqual(result.issues, [])
})

test('dependency planner exposes source fields needed by derived targets', () => {
  assert.deepEqual(
    canonicalDerivationDependenciesForKey('applicants.2.birthDate'),
    ['applicants.2.pesel'],
  )
  assert.ok(
    canonicalDerivationDependenciesForKey('collateralProperty.marketValue')
      .includes('collateralProperty.sameAsFinancedProperty'),
  )
  assert.ok(
    canonicalDerivationDependenciesForKey('additionalProducts.creditCardApplicant')
      .includes('additionalProducts.creditCardApplicantIndex'),
  )
})
