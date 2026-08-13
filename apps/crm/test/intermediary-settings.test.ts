import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEmptyIntermediarySettings,
  intermediarySettingsReadiness,
  normalizeIntermediarySettings,
} from '../shared/intermediary-settings.ts'

test('normalizes and deduplicates cooperation and statutory lender lists independently', () => {
  const settings = normalizeIntermediarySettings({
    providerRole: 'agent',
    relationship: {
      isTiedMortgageIntermediary: true,
      cooperatingLenderBankIds: [' bank-c ', 'bank-a', 'bank-c', ''],
      cooperatingLenderNames: [' Bank C ', 'Bank A', 'Bank C', ''],
      lenderBankIds: [' bank-a ', 'bank-b', 'bank-a', ''],
      lenderNames: [' Bank A ', 'Bank B', 'Bank A', ''],
    },
  })

  assert.equal(settings.providerRole, 'agent')
  assert.deepEqual(settings.relationship.cooperatingLenderBankIds, ['bank-c', 'bank-a'])
  assert.deepEqual(settings.relationship.cooperatingLenderNames, ['Bank C', 'Bank A'])
  assert.deepEqual(settings.relationship.lenderBankIds, ['bank-a', 'bank-b'])
  assert.deepEqual(settings.relationship.lenderNames, ['Bank A', 'Bank B'])
  assert.equal(settings.intermediary.country, 'Polska')
})

test('uses a tied version 1 lender list as the cooperation fallback', () => {
  const settings = normalizeIntermediarySettings({
    version: 1,
    relationship: {
      isTiedMortgageIntermediary: true,
      lenderBankIds: ['bank-a', 'bank-b'],
      lenderNames: ['Bank A', 'Bank B'],
    },
  })

  assert.equal(settings.version, 2)
  assert.deepEqual(settings.relationship.cooperatingLenderBankIds, ['bank-a', 'bank-b'])
  assert.deepEqual(settings.relationship.cooperatingLenderNames, ['Bank A', 'Bank B'])
})

test('does not infer cooperation for non-tied or version 2 settings', () => {
  const nonTied = normalizeIntermediarySettings({
    version: 1,
    relationship: {
      isTiedMortgageIntermediary: false,
      lenderBankIds: ['bank-a'],
      lenderNames: ['Bank A'],
    },
  })
  const explicitlyEmpty = normalizeIntermediarySettings({
    version: 2,
    relationship: {
      isTiedMortgageIntermediary: true,
      cooperatingLenderBankIds: [],
      cooperatingLenderNames: [],
      lenderBankIds: ['bank-a'],
      lenderNames: ['Bank A'],
    },
  })
  const versionTwoWithoutNewFields = normalizeIntermediarySettings({
    version: 2,
    relationship: {
      isTiedMortgageIntermediary: true,
      lenderBankIds: ['bank-a'],
      lenderNames: ['Bank A'],
    },
  })

  assert.deepEqual(nonTied.relationship.cooperatingLenderNames, [])
  assert.deepEqual(explicitlyEmpty.relationship.cooperatingLenderNames, [])
  assert.deepEqual(versionTwoWithoutNewFields.relationship.cooperatingLenderNames, [])
})

test('requires the statutory OFI identity, complaint and remuneration fields', () => {
  const readiness = intermediarySettingsReadiness(createEmptyIntermediarySettings())

  assert.equal(readiness.ofi.ready, false)
  assert.ok(readiness.ofi.missing.includes('firma pośrednika'))
  assert.ok(readiness.ofi.missing.includes('numer RPH pośrednika'))
  assert.ok(readiness.ofi.missing.includes('wewnętrzna procedura reklamacji'))
  assert.ok(readiness.ofi.missing.includes('opis wynagrodzenia od kredytodawców lub innych podmiotów'))
  assert.ok(readiness.recommendations.some(item => item.includes('aktywne umowy współpracy')))
  assert.ok(!readiness.ofi.missing.some(item => item.includes('umowy współpracy')))
})

test('adds conditional requirements for a tied intermediary and an agent', () => {
  const settings = createEmptyIntermediarySettings({
    providerRole: 'agent',
  })
  settings.relationship.isTiedMortgageIntermediary = true

  const readiness = intermediarySettingsReadiness(settings)

  assert.ok(readiness.ofi.missing.includes('lista kredytodawców powiązanego pośrednika'))
  assert.ok(readiness.ofi.missing.includes('firma lub nazwa agenta'))
  assert.ok(readiness.recommendations.some(item => item.includes('numer RHA')))
})

test('requires controller identity and IOD contact only when an IOD is appointed', () => {
  const settings = createEmptyIntermediarySettings()
  settings.privacy.controllerName = 'Pośrednik sp. z o.o.'
  settings.privacy.controllerAddress = 'ul. Testowa 1, 00-001 Warszawa'
  settings.privacy.controllerEmail = 'rodo@example.pl'
  settings.privacy.purposesAndLegalBases = 'Obsługa procesu kredytowego — art. 6 ust. 1 lit. b RODO.'
  settings.privacy.recipientCategories = 'Kredytodawcy i dostawcy usług IT.'
  settings.privacy.retentionPolicy = 'Do upływu okresów przedawnienia roszczeń.'
  settings.privacy.dataSubjectRights = 'Dostęp, sprostowanie, usunięcie i ograniczenie przetwarzania.'
  settings.privacy.dataProvisionRequirements = 'Podanie danych jest niezbędne do obsługi wniosku.'

  assert.equal(intermediarySettingsReadiness(settings).rodo.ready, true)

  settings.privacy.dpoAppointed = true
  const readiness = intermediarySettingsReadiness(settings)
  assert.equal(readiness.rodo.ready, false)
  assert.ok(readiness.rodo.missing.includes('kontakt do inspektora ochrony danych'))
})

test('adds the conditional article 13 and 14 RODO disclosures', () => {
  const settings = createEmptyIntermediarySettings()
  settings.privacy.usesLegitimateInterests = true
  settings.privacy.transfersOutsideEea = true
  settings.privacy.usesAutomatedDecisionMaking = true
  settings.privacy.obtainsDataIndirectly = true

  const missing = intermediarySettingsReadiness(settings).rodo.missing

  assert.ok(missing.includes('opis prawnie uzasadnionych interesów'))
  assert.ok(missing.includes('państwa trzecie i zabezpieczenia transferu danych'))
  assert.ok(missing.includes('zasady i skutki zautomatyzowanego podejmowania decyzji'))
  assert.ok(missing.includes('kategorie danych pozyskiwanych pośrednio'))
  assert.ok(missing.includes('źródła danych pozyskiwanych pośrednio'))
})
