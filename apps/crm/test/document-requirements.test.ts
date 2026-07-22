import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applicableDocumentRequirements,
  documentRequirementAppliesToScenario,
  documentRequirementIsRequired,
  documentScenarioSelections,
  parseDocumentRequirement,
  parseDocumentSelectionCondition,
  validateDocumentRequirement,
} from '../shared/document-requirements.ts'

const scenario = {
  selections: {
    'life-insurance': 'bank',
    account: 'active',
    card: 'none',
  },
}

function validRequirement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: 'identity.document',
    label: 'Identity document',
    category: 'identity',
    itemKind: 'client_document',
    scope: 'primary_applicant',
    stage: 'analysis',
    applicability: 'always',
    evidence: 'confirmed_bank_source',
    required: true,
    multiple: false,
    allowedMimeTypes: ['application/pdf', 'image/jpeg'],
    ...overrides,
  }
}

test('normalizes a valid requirement through the shared runtime parser', () => {
  assert.deepEqual(parseDocumentRequirement(validRequirement({
    label: ' Identity document ',
    allowedMimeTypes: ['application/pdf', 'application/pdf', 'image/png'],
    notes: ' Bank checklist ',
    when: {
      op: 'and',
      conditions: [
        { op: 'selection_is', featureId: 'account', optionId: 'active' },
      ],
    },
  })), {
    code: 'identity.document',
    label: 'Identity document',
    category: 'identity',
    itemKind: 'client_document',
    scope: 'primary_applicant',
    stage: 'analysis',
    applicability: 'always',
    evidence: 'confirmed_bank_source',
    required: true,
    multiple: false,
    allowedMimeTypes: ['application/pdf', 'image/png'],
    notes: 'Bank checklist',
    when: {
      op: 'all',
      conditions: [
        { op: 'selection_is', featureId: 'account', optionId: 'active' },
      ],
    },
  })
})

test('rejects every unsupported document requirement enum', () => {
  for (const field of ['category', 'itemKind', 'scope', 'stage', 'applicability', 'evidence']) {
    const validation = validateDocumentRequirement(validRequirement({ [field]: 'unsupported' }))
    assert.equal(validation.valid, false, field)
    assert.equal(validation.value, null, field)
    assert.ok(validation.issues.some(issue => issue.path === field), field)
    assert.equal(parseDocumentRequirement(validRequirement({ [field]: 'unsupported' })), null, field)
  }
})

test('rejects non-boolean required and multiple flags', () => {
  for (const [field, value] of [['required', 'true'], ['multiple', 0]] as const) {
    const validation = validateDocumentRequirement(validRequirement({ [field]: value }))
    assert.equal(validation.valid, false, field)
    assert.ok(validation.issues.some(issue => issue.path === field), field)
    assert.equal(parseDocumentRequirement(validRequirement({ [field]: value })), null, field)
  }
})

test('rejects malformed and unsupported MIME allowlists', () => {
  const cases = [
    validRequirement({ allowedMimeTypes: 'application/pdf' }),
    validRequirement({ allowedMimeTypes: ['application/pdf', 'image/gif'] }),
    validRequirement({ allowedMimeTypes: ['application/pdf', 42] }),
  ]

  for (const requirement of cases) {
    const validation = validateDocumentRequirement(requirement)
    assert.equal(validation.valid, false)
    assert.ok(validation.issues.some(issue => issue.path.startsWith('allowedMimeTypes')))
    assert.equal(parseDocumentRequirement(requirement), null)
  }
})

test('keeps legacy requirements without a machine-readable condition', () => {
  assert.equal(documentRequirementAppliesToScenario({ code: 'identity' }, scenario), true)
  assert.equal(documentRequirementAppliesToScenario({
    code: 'legacy-conditional',
    applicability: 'conditional',
    required: true,
  }, scenario), true)
  assert.equal(documentRequirementIsRequired({ applicability: 'conditional', required: true }), false)
})

test('filters selection_is requirements using the saved scenario selections', () => {
  const requirements = [
    { code: 'identity' },
    {
      code: 'bank-life-policy',
      when: { op: 'selection_is', featureId: 'life-insurance', optionId: 'bank' },
    },
    {
      code: 'external-life-policy',
      when: { op: 'selection_is', featureId: 'life-insurance', optionId: 'external' },
    },
  ]

  assert.deepEqual(
    applicableDocumentRequirements(requirements, scenario).map(requirement => requirement.code),
    ['identity', 'bank-life-policy'],
  )
})

test('supports nested all/any/not and the persisted and/or aliases', () => {
  const canonical = {
    op: 'all',
    conditions: [
      { op: 'selection_is', featureId: 'account', optionId: 'active' },
      {
        op: 'not',
        condition: { op: 'selection_is', featureId: 'card', optionId: 'active' },
      },
      {
        op: 'any',
        conditions: [
          { op: 'selection_is', featureId: 'life-insurance', optionId: 'bank' },
          { op: 'selection_is', featureId: 'life-insurance', optionId: 'external' },
        ],
      },
    ],
  }
  assert.equal(documentRequirementAppliesToScenario({ when: canonical }, scenario), true)

  const aliased = parseDocumentSelectionCondition({
    op: 'and',
    conditions: [
      { op: 'selection_is', featureId: 'account', optionId: 'active' },
      {
        op: 'or',
        conditions: [
          { op: 'selection_is', featureId: 'card', optionId: 'active' },
          { op: 'selection_is', featureId: 'card', optionId: 'none' },
        ],
      },
    ],
  })
  assert.ok(aliased)
  assert.equal(aliased.op, 'all')
  assert.equal(documentRequirementAppliesToScenario({ when: aliased }, scenario), true)
})

test('fails closed for malformed, unsupported and excessively deep conditions', () => {
  assert.equal(documentRequirementAppliesToScenario({ when: { op: 'compare' } }, scenario), false)
  assert.equal(documentRequirementAppliesToScenario({ when: { op: 'all', conditions: [] } }, scenario), false)
  assert.equal(documentRequirementAppliesToScenario({
    when: { op: 'selection_is', featureId: 'missing', optionId: 'anything' },
  }, scenario), false)

  let deep: unknown = { op: 'selection_is', featureId: 'account', optionId: 'active' }
  for (let index = 0; index < 14; index += 1) deep = { op: 'not', condition: deep }
  assert.equal(documentRequirementAppliesToScenario({ when: deep }, scenario), false)
})

test('sanitizes saved selections and treats a matched conditional item as required', () => {
  const selections = documentScenarioSelections({
    selections: {
      valid: 'selected',
      invalid: '',
      oversized: 'x'.repeat(121),
      '__proto__': 'safe-own-value',
    },
  })
  assert.equal(Object.getPrototypeOf(selections), null)
  assert.deepEqual(Object.entries(selections), [['valid', 'selected']])
  assert.equal(documentRequirementIsRequired({
    applicability: 'conditional',
    required: true,
    when: { op: 'selection_is', featureId: 'valid', optionId: 'selected' },
  }), true)
  assert.equal(documentRequirementIsRequired({ applicability: 'optional', required: true }), false)
})
