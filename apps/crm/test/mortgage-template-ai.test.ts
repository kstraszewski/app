import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ERSTE_TEMPLATE,
  type DocumentTemplate,
  type TemplateBinding,
  validateTemplateJson,
} from '@openexpert/multiform'

import { mergeAiMappingSuggestions } from '../server/utils/mortgage-template-ai.ts'
import {
  mortgageFieldSemanticContractFromOutput,
  mortgageFieldSemanticOutputSchema,
} from '../server/utils/mortgage-template-semantic-ai.ts'

function emptyTemplate(
  formKind: DocumentTemplate['source']['formKind'],
): DocumentTemplate {
  return {
    ...structuredClone(ERSTE_TEMPLATE),
    source: {
      ...structuredClone(ERSTE_TEMPLATE.source),
      formKind,
    },
    coverage: {
      ...structuredClone(ERSTE_TEMPLATE.coverage),
      status: 'incomplete',
      mappedTargetCount: 0,
    },
    bindings: [],
  }
}

function acroOptionSuggestion(
  canonicalValue: string,
  sourceValue: string,
  confidence: number,
  anchorReference: string,
): TemplateBinding {
  return {
    canonicalKey: 'loan.purpose',
    condition: {
      canonicalKey: 'loan.purpose',
      equals: canonicalValue,
    },
    reviewStatus: 'ready',
    mappingEvidence: {
      origin: 'ai',
      confidence,
      rationale: `Opcja ${canonicalValue} pola celu kredytu.`,
      anchors: [{
        kind: 'acroform-name',
        reference: anchorReference,
        page: 1,
        text: 'purpose-radio',
      }],
      model: 'test-model',
    },
    notes: `Sugestia ${canonicalValue}.`,
    target: {
      kind: 'acroform',
      field: 'purpose-radio',
      fieldType: 'radio',
      valueMap: {
        [canonicalValue]: sourceValue,
      },
    },
  }
}

function overlaySuggestion(
  canonicalKey: string,
  x: number,
  y: number,
): TemplateBinding {
  const fixture = ERSTE_TEMPLATE.bindings.find(binding => (
    binding.target.kind === 'overlay' && binding.target.rendererVersion === 2
  ))
  if (!fixture || fixture.target.kind !== 'overlay' || fixture.target.rendererVersion !== 2) {
    assert.fail('Expected a precise Erste overlay fixture.')
  }

  return {
    ...structuredClone(fixture),
    canonicalKey,
    reviewStatus: 'ready',
    mappingEvidence: {
      origin: 'ai',
      confidence: 0.9,
      rationale: 'Testowa propozycja overlay.',
    },
    target: {
      ...structuredClone(fixture.target),
      page: 1,
      box: {
        x,
        y,
        width: 100,
        height: 16,
      },
    },
  }
}

test('merges only new reviewable AI targets without certifying coverage', () => {
  const base = {
    ...ERSTE_TEMPLATE,
    bindings: ERSTE_TEMPLATE.bindings.filter(binding => (
      binding.canonicalKey !== 'applicants.4.pesel'
    )),
  }
  const existing = ERSTE_TEMPLATE.bindings[0]!
  assert.equal(existing.target.kind, 'overlay')
  if (existing.target.kind !== 'overlay' || existing.target.rendererVersion !== 2) {
    assert.fail('Expected a precise Erste overlay fixture.')
  }
  const proposedTarget = {
    ...structuredClone(existing.target),
    box: {
      ...existing.target.box,
      y: existing.target.box.y + 25,
    },
  }
  const suggestions: TemplateBinding[] = [
    {
      ...structuredClone(existing),
      canonicalKey: 'applicants.4.pesel',
      reviewStatus: 'ready',
      mappingEvidence: {
        origin: 'ai',
        confidence: 0.92,
        rationale: 'Sekcja Wnioskodawca 5 i etykieta PESEL.',
      },
      target: proposedTarget,
    },
    {
      ...structuredClone(existing),
      canonicalKey: 'applicants.3.pesel',
      reviewStatus: 'needsReview',
      target: structuredClone(existing.target),
    },
    {
      canonicalKey: 'applicants.2.pesel',
      reviewStatus: 'needsReview',
      target: { kind: 'unmapped', reason: 'Brak pewnej geometrii.' },
    },
  ]

  const merged = mergeAiMappingSuggestions(base, suggestions)

  assert.equal(merged.addedCount, 1)
  assert.equal(merged.skippedTargetCount, 1)
  assert.equal(merged.skippedUnmappedCount, 1)
  assert.equal(merged.template.id, base.id)
  assert.deepEqual(merged.template.source, base.source)
  assert.deepEqual(merged.template.coverage, base.coverage)
  assert.deepEqual(
    merged.template.bindings.slice(0, base.bindings.length),
    base.bindings,
  )
  const added = merged.template.bindings.at(-1)
  assert.equal(added?.canonicalKey, 'applicants.4.pesel')
  assert.equal(added?.reviewStatus, 'needsReview')
  assert.equal(added?.mappingEvidence?.origin, 'ai')
  assert.equal(added?.mappingEvidence?.confidence, 0.92)

  const repeated = mergeAiMappingSuggestions(merged.template, suggestions)
  assert.equal(repeated.addedCount, 0)
  assert.equal(repeated.template.bindings.length, merged.template.bindings.length)
})

test('merges sibling AcroForm options into one deterministic valueMap binding', () => {
  const base = emptyTemplate('acroform')
  const purchase = acroOptionSuggestion(
    'purchase_primary',
    'PURCHASE',
    0.81,
    'acroform:purpose-radio:0',
  )
  const construction = acroOptionSuggestion(
    'construction',
    'BUILD',
    0.94,
    'acroform:purpose-radio:1',
  )

  const merged = mergeAiMappingSuggestions(base, [purchase, construction])
  const reversed = mergeAiMappingSuggestions(base, [construction, purchase])

  assert.equal(merged.addedCount, 1)
  assert.equal(merged.skippedTargetCount, 0)
  assert.equal(merged.template.bindings.length, 1)
  const binding = merged.template.bindings[0]
  assert.equal(binding?.canonicalKey, 'loan.purpose')
  assert.equal(binding?.condition, undefined)
  assert.equal(binding?.reviewStatus, 'needsReview')
  assert.equal(binding?.mappingEvidence?.confidence, 0.94)
  assert.deepEqual(
    binding?.mappingEvidence?.anchors?.map(anchor => anchor.reference),
    ['acroform:purpose-radio:1', 'acroform:purpose-radio:0'],
  )
  assert.equal(binding?.target.kind, 'acroform')
  if (binding?.target.kind !== 'acroform') assert.fail('Expected a merged AcroForm binding.')
  assert.deepEqual(binding.target.valueMap, {
    construction: 'BUILD',
    purchase_primary: 'PURCHASE',
  })
  assert.deepEqual(reversed.template.bindings, merged.template.bindings)

  const validation = validateTemplateJson(merged.template)
  assert.equal(validation.valid, true)
  assert.equal(
    validation.warnings.some(issue => issue.code === 'duplicate_target'),
    false,
  )

  const repeated = mergeAiMappingSuggestions(merged.template, [purchase, construction])
  assert.equal(repeated.addedCount, 0)
  assert.equal(repeated.skippedTargetCount, 1)
  assert.equal(repeated.template.bindings.length, 1)
})

test('keeps distant repeated overlays on one page and skips an overlapping duplicate', () => {
  const base = emptyTemplate('overlay')
  const first = overlaySuggestion('applicants.2.pesel', 40, 500)
  const repeatedElsewhere = overlaySuggestion('applicants.2.pesel', 280, 500)
  const shiftedDuplicate = overlaySuggestion('applicants.2.pesel', 41, 500.5)

  const merged = mergeAiMappingSuggestions(base, [
    first,
    repeatedElsewhere,
    shiftedDuplicate,
  ])

  assert.equal(merged.addedCount, 2)
  assert.equal(merged.skippedTargetCount, 1)
  assert.equal(merged.template.bindings.length, 2)
  assert.deepEqual(
    merged.template.bindings.map((binding) => {
      assert.equal(binding.target.kind, 'overlay')
      if (binding.target.kind !== 'overlay' || binding.target.rendererVersion !== 2) {
        assert.fail('Expected a precise overlay binding.')
      }
      return binding.target.box.x
    }),
    [40, 280],
  )
})

test('preserves source formKind when AI adds no target', () => {
  const base = emptyTemplate('acroform')
  const merged = mergeAiMappingSuggestions(base, [{
    canonicalKey: 'applicants.2.pesel',
    reviewStatus: 'needsReview',
    target: {
      kind: 'unmapped',
      reason: 'Brak pewnego targetu.',
    },
  }])

  assert.equal(merged.addedCount, 0)
  assert.equal(merged.skippedUnmappedCount, 1)
  assert.deepEqual(merged.template.source, base.source)
  assert.equal(merged.template.source.formKind, 'acroform')
})

test('normalizes a field semantic proposal while preserving its controlled role', () => {
  const output = mortgageFieldSemanticOutputSchema.parse({
    semanticDescription: '  Data, w której wniosek jest formalnie składany. ',
    aliases: ['Data wniosku', ' data wniosku ', 'dnia'],
    exclude: ['Data urodzenia', 'DATA WNIOSKU', 'data urodzenia'],
    rationale: '  Zaznaczenie leży przy etykiecie daty w nagłówku wniosku. ',
  })
  const contract = mortgageFieldSemanticContractFromOutput(
    output,
    ' application.submission.date ',
  )

  assert.deepEqual(contract, {
    semanticDescription: 'Data, w której wniosek jest formalnie składany.',
    semanticRole: 'application.submission.date',
    aiMappingHints: {
      aliases: ['Data wniosku', 'dnia'],
      exclude: ['Data urodzenia'],
    },
    source: 'ai',
    rationale: 'Zaznaczenie leży przy etykiecie daty w nagłówku wniosku.',
    model: 'google/gemini-3.5-flash-lite',
  })
})

test('rejects oversized field semantic proposals at the model boundary', () => {
  assert.equal(mortgageFieldSemanticOutputSchema.safeParse({
    semanticDescription: 'Opis',
    aliases: Array.from({ length: 13 }, (_, index) => `alias-${index}`),
    exclude: [],
    rationale: 'Uzasadnienie',
  }).success, false)
})
