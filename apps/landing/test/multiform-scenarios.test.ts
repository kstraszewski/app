import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CANONICAL_COLLECTIONS,
  CANONICAL_COMPUTED_BINDINGS,
  CANONICAL_FIELDS,
  getTemplate,
  prepareBundle,
  templateApplicantCapacityIssues,
  type CanonicalFieldDefinition,
  type FieldCondition,
  type TemplateBinding,
} from '@openexpert/multiform'

import {
  isCanonicalFieldRequired,
  isCanonicalFieldVisible,
  isMissingValue,
  normalizeValues,
} from '../server/utils/multiform-api.ts'

import {
  MULTIFORM_SCENARIO_FIXTURES,
  type MultiformScenarioFixture,
  type MultiformFixtureValue,
} from './fixtures/multiform-scenarios.ts'

const FIELD_BY_KEY = new Map(CANONICAL_FIELDS.map(field => [field.canonicalKey, field]))
const COMPUTED_BY_KEY = new Map(CANONICAL_COMPUTED_BINDINGS.map(field => [field.canonicalKey, field]))

function normalizedConditionValue(value: MultiformFixtureValue | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function conditionMatches(
  condition: FieldCondition | undefined,
  values: Readonly<Record<string, MultiformFixtureValue>>,
): boolean {
  if (!condition) return true
  const actual = normalizedConditionValue(values[condition.canonicalKey])
  const expected = Array.isArray(condition.equals) ? condition.equals : [condition.equals]
  return actual !== undefined && expected.includes(actual)
}

function assertConditionHasSource(
  condition: FieldCondition | undefined,
  fixture: MultiformScenarioFixture,
  context: string,
) {
  if (!condition) return
  assert.ok(
    Object.hasOwn(fixture.values, condition.canonicalKey),
    `${fixture.id}: warunek ${context} nie ma źródła ${condition.canonicalKey}`,
  )
}

function collectionSlotIsActive(
  collection: CanonicalFieldDefinition['collection'],
  fixture: MultiformScenarioFixture,
): boolean {
  if (!collection) return true
  return collection.index < (fixture.collectionCounts[collection.key] ?? 0)
}

function bindingDefinition(binding: TemplateBinding) {
  return FIELD_BY_KEY.get(binding.canonicalKey) ?? COMPUTED_BY_KEY.get(binding.canonicalKey)
}

function bindingIsActive(binding: TemplateBinding, fixture: MultiformScenarioFixture): boolean {
  const definition = bindingDefinition(binding)
  assert.ok(definition, `${fixture.id}: brak definicji canonical dla ${binding.canonicalKey}`)

  if (!collectionSlotIsActive(definition.collection, fixture)) return false

  const visibleWhen = 'visibleWhen' in definition ? definition.visibleWhen : undefined
  assertConditionHasSource(visibleWhen, fixture, `widoczności ${binding.canonicalKey}`)
  if (!conditionMatches(visibleWhen, fixture.values)) return false

  assertConditionHasSource(binding.condition, fixture, `bindingu ${binding.canonicalKey}`)
  return conditionMatches(binding.condition, fixture.values)
}

function assertActiveBindingHasSource(binding: TemplateBinding, fixture: MultiformScenarioFixture) {
  if (!bindingIsActive(binding, fixture)) return

  const sourceKeys = binding.computed
    ? binding.valueFrom ?? COMPUTED_BY_KEY.get(binding.canonicalKey)?.valueFrom ?? []
    : [binding.canonicalKey]

  assert.ok(sourceKeys.length > 0, `${fixture.id}: ${binding.canonicalKey} nie wskazuje źródła`)
  for (const sourceKey of sourceKeys) {
    assert.ok(
      Object.hasOwn(fixture.values, sourceKey),
      `${fixture.id}: aktywny binding ${binding.canonicalKey} nie ma źródła ${sourceKey}`,
    )
  }
}

for (const fixture of MULTIFORM_SCENARIO_FIXTURES) {
  test(`${fixture.label}: aktywne bindingi mają źródła`, () => {
    assert.equal(fixture.collectionCounts.applicants, fixture.applicantCount)

    const banks = new Set<string>()
    for (const templateId of fixture.templateIds) {
      const template = getTemplate(templateId)
      assert.ok(template, `${fixture.id}: nie istnieje template ${templateId}`)
      banks.add(template.bank)
      for (const binding of template.bindings) assertActiveBindingHasSource(binding, fixture)
    }
    assert.equal(banks.size, 2, `${fixture.id}: scenariusz powinien obejmować dwa różne banki`)
  })

  test(`${fixture.label}: wartości select pochodzą z katalogu opcji`, () => {
    for (const [key, value] of Object.entries(fixture.values)) {
      const field = FIELD_BY_KEY.get(key)
      assert.ok(field, `${fixture.id}: nieznane pole canonical ${key}`)
      if (field.type !== 'select') continue

      assert.ok(
        field.options?.some(option => option.value === String(value)),
        `${fixture.id}: ${key}=${String(value)} nie należy do opcji pola`,
      )
    }
  })

  test(`${fixture.label}: payload API ma kompletne aktywne pola i dokładne kolekcje`, () => {
    const bundle = prepareBundle(fixture.templateIds)
    const collectionByKey = new Map(bundle.collections.map(collection => [collection.key, collection]))
    const normalizedValues = normalizeValues(fixture.values)

    assert.deepEqual(bundle.warnings, [], `${fixture.id}: bundle zawiera ostrzeżenia blokujące API`)
    assert.deepEqual(
      templateApplicantCapacityIssues(bundle.documents, fixture.applicantCount),
      [],
      `${fixture.id}: template nie obsługuje liczby wnioskodawców`,
    )

    assert.deepEqual(
      Object.keys(fixture.collectionCounts).sort(),
      bundle.collections.map(collection => collection.key).sort(),
      `${fixture.id}: collectionCounts musi odpowiadać dokładnie kolekcjom zwróconym przez prepareBundle`,
    )

    for (const field of bundle.fields) {
      const collection = field.collection
        ? collectionByKey.get(field.collection.key)
        : undefined
      if (
        field.collection
        && field.collection.index >= (fixture.collectionCounts[field.collection.key] ?? collection?.minItems ?? 0)
      ) {
        continue
      }
      if (!isCanonicalFieldVisible(field, normalizedValues)) continue

      assert.ok(
        Object.hasOwn(normalizedValues, field.canonicalKey),
        `${fixture.id}: aktywne pole payloadu ${field.canonicalKey} nie ma źródła`,
      )

      const requiredByCollection = Boolean(
        collection
        && field.collection
        && collection.requiredRelativeKeys.includes(field.collection.relativeKey),
      )
      if (isCanonicalFieldRequired(field, normalizedValues) || requiredByCollection) {
        assert.ok(
          !isMissingValue(normalizedValues[field.canonicalKey]),
          `${fixture.id}: wymagane pole payloadu ${field.canonicalKey} jest puste`,
        )
      }
    }
  })

  test(`${fixture.label}: wspólne dane finansowania są logicznie spójne dla obu banków`, () => {
    const value = (key: string) => fixture.values[key]
    assert.equal(
      Number(value('loan.amount')) + Number(value('investment.ownFunds')),
      Number(value('investment.totalCost')),
      `${fixture.id}: kredyt i wkład własny nie sumują się do kosztu inwestycji`,
    )
    assert.equal(
      Number(value('investment.ownFundsPaid'))
      + Number(value('investment.ownFundsBeforeDisbursement'))
      + Number(value('investment.ownFundsDuringInvestment')),
      Number(value('investment.ownFunds')),
      `${fixture.id}: etapy wkładu własnego nie sumują się do wkładu łącznie`,
    )
    assert.equal(
      Number(value('investment.ownFundsSources.bankAccounts.amount'))
      + Number(value('investment.ownFundsSources.investmentFunds.amount')),
      Number(value('investment.ownFunds')),
      `${fixture.id}: aktywne źródła wkładu nie sumują się do wkładu łącznie`,
    )
    assert.equal(value('property.landRegisterNumber'), value('collateralProperty.landRegisterNumber'))
    assert.equal(value('property.marketValue'), value('collateralProperty.marketValue'))

    const trancheCount = fixture.collectionCounts.tranches ?? 0
    if (trancheCount > 0) {
      const trancheTotal = Array.from({ length: trancheCount }, (_, index) => (
        Number(value(`tranches.${index}.amount`))
      )).reduce((sum, amount) => sum + amount, 0)
      assert.equal(trancheTotal, Number(value('loan.amount')), `${fixture.id}: transze nie sumują się do kwoty kredytu`)
    }

    for (let index = 0; index < fixture.applicantCount; index += 1) {
      const sharedWith = String(value(`applicants.${index}.sharedHouseholdWithApplicantNumber`) ?? '').trim()
      if (!sharedWith) continue
      const referencedApplicant = Number(sharedWith)
      assert.ok(
        Number.isInteger(referencedApplicant)
        && referencedApplicant >= 1
        && referencedApplicant <= fixture.applicantCount
        && referencedApplicant !== index + 1,
        `${fixture.id}: wnioskodawca ${index + 1} odwołuje się do nieaktywnej lub własnej osoby`,
      )
    }
  })

  test(`${fixture.label}: podane wartości spełniają typy, walidację i warunki widoczności`, () => {
    for (const [key, value] of Object.entries(fixture.values)) {
      const field = FIELD_BY_KEY.get(key)
      assert.ok(field, `${fixture.id}: nieznane pole canonical ${key}`)
      if (!collectionSlotIsActive(field.collection, fixture)) continue

      assertConditionHasSource(field.visibleWhen, fixture, `widoczności ${key}`)
      assert.ok(
        conditionMatches(field.visibleWhen, fixture.values),
        `${fixture.id}: pole ${key} ma wartość mimo niespełnionego warunku widoczności`,
      )

      if (field.type === 'boolean') {
        assert.equal(typeof value, 'boolean', `${fixture.id}: ${key} powinno być boolean`)
      } else if (field.type === 'number' || field.type === 'currency') {
        assert.equal(typeof value, 'number', `${fixture.id}: ${key} powinno być liczbą`)
      } else {
        assert.equal(typeof value, 'string', `${fixture.id}: ${key} powinno być tekstem`)
      }

      if (field.type === 'date') {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
        const parsed = match
          ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
          : undefined
        assert.ok(
          match
          && parsed
          && parsed.getUTCFullYear() === Number(match[1])
          && parsed.getUTCMonth() === Number(match[2]) - 1
          && parsed.getUTCDate() === Number(match[3]),
          `${fixture.id}: ${key} nie jest poprawną datą kalendarzową`,
        )
      }

      if (field.validation?.pattern) {
        assert.match(String(value), new RegExp(field.validation.pattern), `${fixture.id}: ${key} nie spełnia wzorca`)
      }
      if (field.validation?.maxLength !== undefined) {
        assert.ok(
          String(value).length <= field.validation.maxLength,
          `${fixture.id}: ${key} przekracza ${field.validation.maxLength} znaków`,
        )
      }
      if (field.validation?.min !== undefined) {
        assert.ok(Number(value) >= field.validation.min, `${fixture.id}: ${key} jest mniejsze niż minimum`)
      }
      if (field.validation?.max !== undefined) {
        assert.ok(Number(value) <= field.validation.max, `${fixture.id}: ${key} jest większe niż maksimum`)
      }
      if (field.validation?.integer) {
        assert.ok(Number.isInteger(value), `${fixture.id}: ${key} powinno być liczbą całkowitą`)
      }
    }
  })

  test(`${fixture.label}: nieaktywne sloty kolekcji są puste`, () => {
    for (const collection of CANONICAL_COLLECTIONS) {
      const count = fixture.collectionCounts[collection.key] ?? 0
      if (fixture.collectionCounts[collection.key] !== undefined) {
        assert.ok(
          count >= collection.minItems && count <= collection.maxItems,
          `${fixture.id}: liczność ${collection.key}=${count} poza zakresem ${collection.minItems}-${collection.maxItems}`,
        )
      }

      for (const field of CANONICAL_FIELDS) {
        if (field.collection?.key !== collection.key || field.collection.index < count) continue
        const value = fixture.values[field.canonicalKey]
        assert.ok(
          value === undefined || value === '',
          `${fixture.id}: nieaktywny slot ${field.canonicalKey} zawiera dane`,
        )
      }
    }
  })
}
