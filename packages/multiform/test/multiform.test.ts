import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CANONICAL_COLLECTIONS,
  CANONICAL_FIELDS,
  DEMO_TEMPLATE_IDS,
  MULTIFORM_MODEL_DEFINITIONS,
  type DocumentTemplate,
  getTemplate,
  getTemplateBySourceSha256,
  getTemplates,
  prepareBundle,
  templateApplicantCapacity,
  templateApplicantCapacityIssues,
  validateTemplateJson,
} from '../src/index.ts'

test('uses current public Gemini models for the agent and PDF template generator', () => {
  assert.equal(MULTIFORM_MODEL_DEFINITIONS.agent.gatewayId, 'google/gemini-3.6-flash')
  assert.equal(MULTIFORM_MODEL_DEFINITIONS.templateGenerator.gatewayId, 'google/gemini-3.5-flash-lite')
  assert.equal(MULTIFORM_MODEL_DEFINITIONS.agent.contextWindowTokens, 1_048_576)
  assert.equal(MULTIFORM_MODEL_DEFINITIONS.templateGenerator.contextWindowTokens, 1_048_576)
})

const PAGE_GEOMETRY = {
  page: 1,
  mediaBox: { x: 0, y: 0, width: 612, height: 792 },
  cropBox: { x: 0, y: 0, width: 612, height: 792 },
  rotation: 0,
  userUnit: 1,
} as const

const textAppearance = (fontSizePt = 9, letterSpacingPt = 0) => ({
  kind: 'text',
  fontId: 'dm-sans-regular',
  fontSizePt,
  minFontSizePt: 6,
  letterSpacingPt,
  lineHeightPt: Number((fontSizePt * 1.2).toFixed(2)),
  wrap: 'none',
  overflow: 'shrink',
  horizontalAlign: 'left',
  verticalAlign: 'middle',
  distribution: { kind: 'flow' },
  color: { space: 'rgb', red: 0, green: 0, blue: 0 },
  opacity: 1,
  paddingPt: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 },
})

const preciseTextTarget = (
  page: number,
  box: { x: number, y: number, width: number, height: number },
  fontSizePt = 9,
) => ({
  kind: 'overlay',
  rendererVersion: 2,
  page,
  box,
  coordinateSpace: {
    units: 'pt',
    referenceBox: 'crop',
    origin: 'top-left',
    orientation: 'visual',
  },
  appearance: textAppearance(fontSizePt),
})

const completeValidationTemplate = (target: unknown, formKind = 'overlay') => ({
  schemaVersion: 2,
  id: 'validation-template',
  bank: 'erste',
  label: 'Template walidacyjny',
  version: 1,
  source: {
    fileName: 'validation-template.pdf',
    sha256: 'b'.repeat(64),
    pageCount: 1,
    formKind,
    pages: [PAGE_GEOMETRY],
  },
  coverage: {
    status: 'complete',
    inScopeTargetCount: 1,
    mappedTargetCount: 1,
  },
  bindings: [{
    canonicalKey: 'loan.amount',
    reviewStatus: 'ready',
    target,
  }],
})

test('exposes a unique canonical catalog for the MVP form', () => {
  const keys = CANONICAL_FIELDS.map((field) => field.canonicalKey)
  const applicantFields = CANONICAL_FIELDS.filter(field => field.collection?.key === 'applicants')
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(keys.includes('applicants.0.pesel'))
  assert.ok(keys.includes('applicants.4.pesel'))
  assert.ok(keys.includes('loan.amount'))
  assert.ok(keys.includes('property.address.houseNumber'))
  assert.ok(keys.includes('property.landRegisterNumber'))
  assert.equal(applicantFields.length, 15)
  assert.deepEqual(
    [...new Set(applicantFields.map(field => field.collection?.index))],
    [0, 1, 2, 3, 4],
  )
  assert.ok(CANONICAL_FIELDS.every(field => (
    field.form.question
    && field.semanticDescription
    && field.semanticRole
    && field.aiMappingHints.aliases.length > 0
  )))
  assert.deepEqual(
    CANONICAL_FIELDS.find(field => field.canonicalKey === 'applicants.4.pesel')?.collection,
    {
      key: 'applicants',
      index: 4,
      displayIndex: 5,
      relativeKey: 'pesel',
      label: 'PESEL',
    },
  )
  const applicationPlace = CANONICAL_FIELDS.find(field => field.canonicalKey === 'application.place')
  assert.match(applicationPlace?.form.helpText ?? '', /zamieszkania/)
  assert.ok(applicationPlace?.aiMappingHints.exclude.includes('miejscowość nieruchomości'))
  assert.deepEqual(CANONICAL_COLLECTIONS, [{
    key: 'applicants',
    label: 'Wnioskodawcy',
    itemLabel: 'Wnioskodawca',
    minItems: 1,
    maxItems: 5,
    requiredRelativeKeys: ['firstName', 'lastName', 'pesel'],
  }])
})

test('registers the three curated PDF templates', () => {
  const templates = getTemplates()
  assert.deepEqual(templates.map((template) => template.id), [...DEMO_TEMPLATE_IDS])
  assert.ok(DEMO_TEMPLATE_IDS.length <= 5)
  assert.equal(getTemplate('erste-mortgage-2026')?.source.formKind, 'overlay')
  assert.equal(getTemplate('pko-bp-mortgage-2022')?.source.formKind, 'acroform')
  assert.equal(getTemplate('pekao-mortgage-2025')?.source.pageCount, 6)
})

test('computes applicant capacity per template without hiding index gaps', () => {
  const erste = getTemplate('erste-mortgage-2026')!
  const pko = getTemplate('pko-bp-mortgage-2022')!
  assert.equal(templateApplicantCapacity(erste), 5)
  assert.equal(templateApplicantCapacity(pko), 2)
  assert.deepEqual(
    templateApplicantCapacityIssues([erste, pko], 3).map(issue => issue.templateId),
    ['pko-bp-mortgage-2022'],
  )
  assert.deepEqual(templateApplicantCapacityIssues([erste, pko], 2), [])

  const withGap: DocumentTemplate = {
    ...erste,
    bindings: erste.bindings.filter(binding => (
      !/^applicants\.(?:2|4)\./u.test(binding.canonicalKey)
    )),
  }
  assert.equal(templateApplicantCapacity(withGap), 2)

  const withoutFirstApplicant: DocumentTemplate = {
    ...erste,
    bindings: erste.bindings.filter(binding => (
      !/^applicants\.0\./u.test(binding.canonicalKey)
      && !(binding.valueFrom ?? []).some(key => /^applicants\.0\./u.test(key))
    )),
  }
  assert.equal(templateApplicantCapacity(withoutFirstApplicant), 0)

  const withoutApplicants: DocumentTemplate = {
    ...erste,
    bindings: erste.bindings.filter(binding => !binding.canonicalKey.startsWith('applicants.')),
  }
  assert.equal(templateApplicantCapacity(withoutApplicants), null)
  assert.deepEqual(templateApplicantCapacityIssues([withoutApplicants], 5), [])
})

test('validates applicant five and structured mapping evidence deterministically', () => {
  const baseTemplate = completeValidationTemplate(preciseTextTarget(
    1,
    { x: 120, y: 640, width: 180, height: 17 },
  )) as DocumentTemplate
  const template: DocumentTemplate = {
    ...baseTemplate,
    bindings: [{
      ...baseTemplate.bindings[0]!,
      canonicalKey: 'applicants.4.pesel',
      reviewStatus: 'needsReview',
      mappingEvidence: {
        origin: 'ai',
        confidence: 0.94,
        rationale: 'Etykieta PESEL znajduje się w sekcji Wnioskodawca 5.',
        model: 'test/model',
        anchors: [{
          kind: 'ordinal',
          reference: 'p1:t42',
          page: 1,
          text: 'Wnioskodawca 5',
          box: { x: 40, y: 660, width: 90, height: 12 },
        }],
      },
    }],
  }

  const valid = validateTemplateJson(template)
  assert.equal(valid.valid, true)
  assert.ok(!valid.warnings.some(issue => issue.code === 'unknown_canonical_key'))

  const invalidConfidence: DocumentTemplate = {
    ...template,
    bindings: [{
      ...template.bindings[0]!,
      mappingEvidence: {
        ...template.bindings[0]!.mappingEvidence!,
        confidence: 1.2,
      },
    }],
  }
  const invalid = validateTemplateJson(invalidConfidence)
  assert.equal(invalid.valid, false)
  assert.ok(invalid.errors.some(issue => (
    issue.path === 'bindings[0].mappingEvidence.confidence'
    && issue.code === 'invalid_mapping_confidence'
  )))

  const unknown: DocumentTemplate = {
    ...template,
    bindings: [{
      ...template.bindings[0]!,
      canonicalKey: 'applicants.5.pesel',
    }],
  }
  const unknownResult = validateTemplateJson(unknown)
  assert.equal(unknownResult.valid, false)
  assert.ok(unknownResult.errors.some(issue => issue.code === 'unknown_canonical_key'))

  const unknownComputed: DocumentTemplate = {
    ...template,
    bindings: [{
      ...template.bindings[0]!,
      canonicalKey: 'applicants.5.fullName',
      computed: true,
      valueFrom: ['applicants.4.firstName', 'applicants.4.lastName'],
      valueFormat: 'fullName',
    }],
  }
  const unknownComputedResult = validateTemplateJson(unknownComputed)
  assert.equal(unknownComputedResult.valid, false)
  assert.ok(unknownComputedResult.errors.some(issue => issue.code === 'unknown_computed_key'))

  const mismatchedComputed: DocumentTemplate = {
    ...template,
    bindings: [{
      ...template.bindings[0]!,
      canonicalKey: 'applicants.4.fullName',
      computed: true,
      valueFrom: ['applicants.3.firstName', 'applicants.3.lastName'],
      valueFormat: 'fullName',
    }],
  }
  const mismatchedComputedResult = validateTemplateJson(mismatchedComputed)
  assert.equal(mismatchedComputedResult.valid, false)
  assert.ok(mismatchedComputedResult.errors.some(issue => (
    issue.code === 'computed_dependencies_mismatch'
  )))

  const disguisedCanonicalInput: DocumentTemplate = {
    ...template,
    bindings: [{
      ...template.bindings[0]!,
      canonicalKey: 'applicants.4.pesel',
      computed: true,
      valueFrom: ['applicants.0.pesel'],
    }],
  }
  const disguisedCanonicalInputResult = validateTemplateJson(disguisedCanonicalInput)
  assert.equal(disguisedCanonicalInputResult.valid, false)
  assert.ok(disguisedCanonicalInputResult.errors.some(issue => (
    issue.path === 'bindings[0].canonicalKey'
    && issue.code === 'unknown_computed_key'
  )))
})

test('validates optional per-binding semantic contracts without breaking legacy templates', () => {
  const baseTemplate = completeValidationTemplate(preciseTextTarget(
    1,
    { x: 120, y: 640, width: 180, height: 17 },
  )) as DocumentTemplate

  assert.equal(validateTemplateJson(baseTemplate).valid, true)

  const customized: DocumentTemplate = structuredClone(baseTemplate)
  customized.bindings[0]!.semanticContract = {
    semanticDescription: 'Kwota kredytu wnioskowana w tym formularzu.',
    semanticRole: 'loan.requested.amount',
    aiMappingHints: {
      aliases: ['kwota kredytu', 'wnioskowana kwota'],
      exclude: ['wartość nieruchomości', 'wkład własny'],
    },
    source: 'ai',
    rationale: 'Pole leży przy etykiecie „Kwota kredytu”.',
    model: 'google/test-model',
  }
  assert.equal(validateTemplateJson(customized).valid, true)

  const invalid: DocumentTemplate = structuredClone(customized)
  invalid.bindings[0]!.semanticContract = {
    ...invalid.bindings[0]!.semanticContract!,
    semanticRole: 'rola ze spacją',
    aiMappingHints: {
      aliases: Array.from({ length: 31 }, (_, index) => `alias-${index}`),
      exclude: ['', 'ALIAS-0'],
    },
  }
  const result = validateTemplateJson(invalid)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(issue => issue.code === 'invalid_semantic_role'))
  assert.ok(result.errors.some(issue => issue.code === 'invalid_semantic_hint_list'))
  assert.ok(result.errors.some(issue => issue.code === 'invalid_semantic_hint'))
  assert.ok(result.errors.some(issue => issue.code === 'conflicting_semantic_hint'))
})

test('validates every registered template but keeps incomplete coverage out of fill-ready state', () => {
  for (const template of getTemplates()) {
    const result = validateTemplateJson(template)

    assert.equal(result.kind, 'document-template', template.id)
    assert.equal(result.valid, true, template.id)
    assert.equal(result.fillReady, false, template.id)
    assert.equal(result.summary.activationReady, false, template.id)
    assert.equal(result.summary.bindingCount, template.bindings.length, template.id)
    assert.equal(result.summary.mappedBindingCount, template.bindings.length, template.id)
    assert.equal(
      result.summary.needsReviewCount,
      template.id === 'erste-mortgage-2026' ? 6 : 0,
      template.id,
    )
    assert.equal(result.summary.unmappedCount, 0, template.id)
    assert.deepEqual(result.errors, [], template.id)
    assert.ok(result.warnings.some(issue => issue.code === 'incomplete_coverage'), template.id)
  }
})

test('rejects malformed template JSON with actionable paths and issue codes', () => {
  const result = validateTemplateJson({
    id: 'broken-template',
    bank: 'erste',
    label: 'Uszkodzony template',
    version: 1,
    source: {
      fileName: 'not-a-pdf.txt',
      sha256: 'too-short',
      pageCount: 1,
      formKind: 'overlay',
    },
    coverage: {
      status: 'complete',
      inScopeTargetCount: 1,
      mappedTargetCount: 2,
    },
    bindings: [{
      canonicalKey: 'not.in.canonical.catalog',
      target: {
        kind: 'overlay',
        page: 2,
        x: 'left',
        y: 10,
      },
    }],
  })

  assert.equal(result.kind, 'document-template')
  assert.equal(result.valid, false)
  assert.equal(result.fillReady, false)
  assert.ok(result.errors.some(issue => issue.path === 'source.fileName' && issue.code === 'invalid_pdf_filename'))
  assert.ok(result.errors.some(issue => issue.path === 'source.sha256' && issue.code === 'invalid_sha256'))
  assert.ok(result.errors.some(issue => issue.path === 'coverage.mappedTargetCount' && issue.code === 'coverage_exceeds_scope'))
  assert.ok(result.errors.some(issue => issue.path === 'bindings[0].target.page' && issue.code === 'overlay_page_out_of_range'))
  assert.ok(result.errors.some(issue => issue.path === 'bindings[0].target.x' && issue.code === 'invalid_overlay_coordinate'))
  assert.ok(result.errors.some(issue => (
    issue.path === 'bindings[0].canonicalKey' && issue.code === 'unknown_canonical_key'
  )))
})

test('accepts a fully specified V2 overlay with exact geometry and text appearance', () => {
  const target = preciseTextTarget(
    1,
    { x: 72, y: 118, width: 216, height: 24 },
    10,
  )
  target.appearance.letterSpacingPt = 0.6
  target.appearance.lineHeightPt = 12.5
  target.appearance.wrap = 'word'
  target.appearance.horizontalAlign = 'right'

  const result = validateTemplateJson(completeValidationTemplate(target))

  assert.equal(result.valid, true)
  assert.equal(result.fillReady, true)
  assert.equal(result.summary.activationReady, true)
  assert.deepEqual(result.errors, [])
  assert.ok(!result.warnings.some(issue => issue.code === 'render_geometry_not_auditable'))
})

test('reports unsafe V2 box and appearance values at their exact JSON paths', () => {
  const validTarget = preciseTextTarget(
    1,
    { x: 604, y: 118, width: 24, height: 24 },
    10,
  )
  const target = {
    ...validTarget,
    appearance: {
      ...validTarget.appearance,
      letterSpacingPt: 'wide',
      color: { space: 'rgb', red: 0, green: 0, blue: 1.2 },
    },
  }

  const result = validateTemplateJson(completeValidationTemplate(target))

  assert.equal(result.valid, false)
  assert.equal(result.fillReady, false)
  assert.ok(result.errors.some(issue => (
    issue.path === 'bindings[0].target.box' && issue.code === 'overlay_box_out_of_bounds'
  )))
  assert.ok(result.errors.some(issue => (
    issue.path === 'bindings[0].target.appearance.letterSpacingPt' && issue.code === 'invalid_letter_spacing'
  )))
  assert.ok(result.errors.some(issue => (
    issue.path === 'bindings[0].target.appearance.color.blue' && issue.code === 'invalid_pdf_color_channel'
  )))
})

test('rejects a legacy coordinate-only overlay inside a schema V2 template', () => {
  const result = validateTemplateJson(completeValidationTemplate({
    kind: 'overlay',
    page: 1,
    x: 72,
    y: 118,
    width: 216,
    height: 24,
    fontSize: 10,
    format: 'text',
  }))

  assert.equal(result.valid, false)
  assert.equal(result.fillReady, false)
  assert.ok(result.errors.some(issue => (
    issue.path === 'bindings[0].target.rendererVersion' && issue.code === 'legacy_overlay_in_v2_template'
  )))
})

test('keeps AcroForm mappings without a widget geometry snapshot out of fill-ready state', () => {
  const result = validateTemplateJson(completeValidationTemplate({
    kind: 'acroform',
    field: 'loan_amount',
    fieldType: 'text',
    text: {
      alignment: 'right',
      multiline: false,
      comb: false,
    },
    appearance: {
      ...textAppearance(10),
      horizontalAlign: 'right',
    },
  }, 'acroform'))

  assert.equal(result.valid, true)
  assert.equal(result.fillReady, false)
  assert.equal(result.summary.activationReady, false)
  assert.ok(result.warnings.some(issue => (
    issue.path === 'bindings' && issue.code === 'render_geometry_not_auditable'
  )))
})

test('validates administrator-approved AcroForm placement overrides independently from source snapshots', () => {
  const target = {
    kind: 'acroform',
    field: 'loan_amount',
    fieldType: 'text',
    expectedWidgets: [{
      index: 0,
      page: 1,
      rect: { x: 72, y: 118, width: 216, height: 24 },
    }],
    placementOverrides: [{
      widgetIndex: 0,
      page: 1,
      box: { x: 84, y: 132, width: 220, height: 25 },
      coordinateSpace: {
        units: 'pt',
        referenceBox: 'crop',
        origin: 'top-left',
        orientation: 'visual',
      },
    }],
    text: {
      alignment: 'right',
      multiline: false,
      comb: false,
    },
    appearance: {
      ...textAppearance(10),
      horizontalAlign: 'right',
    },
  }

  const valid = validateTemplateJson(completeValidationTemplate(target, 'acroform'))
  assert.equal(valid.valid, true)
  assert.equal(valid.fillReady, true)

  const invalid = validateTemplateJson(completeValidationTemplate({
    ...target,
    placementOverrides: [{
      ...target.placementOverrides[0],
      widgetIndex: 7,
      box: { x: 600, y: 132, width: 220, height: 25 },
    }],
  }, 'acroform'))
  assert.equal(invalid.valid, false)
  assert.ok(invalid.errors.some(issue => issue.code === 'unknown_widget_override'))
  assert.ok(invalid.errors.some(issue => issue.code === 'placement_override_out_of_bounds'))
})

test('recognizes a machine-generated AI template as an auditable, non-fill-ready draft', () => {
  const result = validateTemplateJson({
    schemaVersion: 2,
    id: 'generated-bank-form',
    status: 'draft',
    version: 1,
    bank: null,
    label: 'Draft wygenerowany przez AI',
    source: {
      fileName: 'generated-bank-form.pdf',
      sha256: 'a'.repeat(64),
      pageCount: 2,
      formKind: 'acroform',
      pages: [
        PAGE_GEOMETRY,
        {
          ...PAGE_GEOMETRY,
          page: 2,
        },
      ],
    },
    coverage: {
      status: 'auditRequired',
      sourceFieldCount: 1,
      fillableSourceFieldCount: 1,
      mergedSourceFieldCount: 1,
      documentSpecificFieldCount: 0,
      unaccountedSourceFieldCount: 0,
    },
    bindings: [{
      canonicalKey: 'loan.amount',
      target: {
        kind: 'acroform',
        field: 'loan_amount',
        fieldType: 'text',
        expectedWidgets: [{
          index: 0,
          page: 1,
          rect: { x: 120, y: 650, width: 180, height: 18 },
        }],
        text: {
          alignment: 'right',
          multiline: false,
          comb: false,
        },
        appearance: {
          ...textAppearance(10, 0.25),
          horizontalAlign: 'right',
        },
      },
      reviewStatus: 'needsReview',
      notes: 'Mapowanie zaproponowane przez AI; wymaga zatwierdzenia.',
    }],
  })

  assert.equal(result.kind, 'generated-draft')
  assert.equal(result.valid, true)
  assert.equal(result.fillReady, false)
  assert.equal(result.summary.bindingCount, 1)
  assert.equal(result.summary.mappedBindingCount, 1)
  assert.equal(result.summary.readyBindingCount, 0)
  assert.equal(result.summary.needsReviewCount, 1)
  assert.equal(result.summary.activationReady, false)
  assert.deepEqual(result.errors, [])
  assert.ok(result.warnings.some(issue => issue.code === 'audit_required'))
  assert.ok(result.warnings.some(issue => issue.code === 'review_required'))
  assert.ok(!result.warnings.some(issue => issue.code === 'render_geometry_not_auditable'))
})

test('resolves a reviewed template only for an exact source PDF checksum', () => {
  const erste = getTemplate('erste-mortgage-2026')!

  assert.equal(getTemplateBySourceSha256(erste.source.sha256)?.id, erste.id)
  assert.equal(getTemplateBySourceSha256(erste.source.sha256.toUpperCase())?.id, erste.id)
  assert.equal(getTemplateBySourceSha256('0'.repeat(64)), undefined)
})

test('uses verified AcroForm names and overlay coordinates', () => {
  const pko = getTemplate('pko-bp-mortgage-2022')!
  const pkoAmount = pko.bindings.find((binding) => binding.canonicalKey === 'loan.amount')
  assert.deepEqual(pkoAmount?.target, { kind: 'acroform', field: 'wnioskowany_kredyt' })

  const pekaoKw = getTemplate('pekao-mortgage-2025')!.bindings.find(
    (binding) => binding.canonicalKey === 'property.landRegisterNumber',
  )
  assert.deepEqual(pekaoKw?.target, { kind: 'acroform', field: 'Text Field 40' })

  const ersteApplicant = getTemplate('erste-mortgage-2026')!.bindings.find(
    (binding) => binding.canonicalKey === 'applicants.0.fullName',
  )
  assert.equal(ersteApplicant?.computed, true)
  assert.deepEqual(ersteApplicant?.target, preciseTextTarget(
    1,
    { x: 155, y: 499, width: 374, height: 17 },
  ))
})

test('prepareBundle merges canonical inputs and omits computed presentation fields', () => {
  const bundle = prepareBundle(['erste-mortgage-2026', 'pekao-mortgage-2025'])
  const keys = bundle.fields.map((field) => field.canonicalKey)

  assert.equal(bundle.documents.length, 2)
  assert.equal(keys.filter((key) => key === 'loan.amount').length, 1)
  assert.ok(keys.includes('applicants.0.firstName'))
  assert.ok(keys.includes('applicants.0.lastName'))
  assert.ok(keys.includes('applicants.2.firstName'))
  assert.ok(keys.includes('applicants.3.lastName'))
  assert.ok(keys.includes('applicants.4.pesel'))
  assert.ok(keys.includes('property.address.houseNumber'))
  assert.ok(keys.includes('property.address.unitNumber'))
  assert.ok(!keys.includes('applicants.0.fullName'))
  assert.ok(!keys.includes('property.address.full'))
  assert.ok(!keys.includes('property.address.houseAndUnit'))
  assert.deepEqual(bundle.collections.map(collection => collection.key), ['applicants'])
})

test('resolved bindings do not masquerade as complete source-form coverage', () => {
  const expectedCoverage = new Map([
    ['erste-mortgage-2026', { mapped: 33, total: 106 }],
    ['pko-bp-mortgage-2022', { mapped: 43, total: 144 }],
    ['pekao-mortgage-2025', { mapped: 34, total: 278 }],
  ])

  for (const template of getTemplates()) {
    const needsReviewCount = template.bindings.filter(binding => binding.reviewStatus === 'needsReview').length
    assert.ok(template.bindings.length > 0)
    assert.ok(template.bindings.every(binding => binding.target.kind !== 'unmapped'))
    assert.equal(needsReviewCount, template.id === 'erste-mortgage-2026' ? 6 : 0)
    assert.equal(template.coverage.status, 'incomplete')
    assert.equal(template.coverage.mappedTargetCount, expectedCoverage.get(template.id)?.mapped)
    assert.equal(template.coverage.inScopeTargetCount, expectedCoverage.get(template.id)?.total)

    const warnings = prepareBundle([template.id]).warnings
    assert.equal(warnings.length, 1 + needsReviewCount)
    assert.ok(warnings.some(warning => (
      warning.canonicalKey === '__templateCoverage__' && warning.status === 'unmapped'
    )))
  }
})

test('merges conditional other descriptions once and maps them in every applicable PDF', () => {
  const bundle = prepareBundle([...DEMO_TEMPLATE_IDS])
  const purposeOtherFields = bundle.fields.filter(field => field.canonicalKey === 'loan.purposeOther')
  const propertyOtherFields = bundle.fields.filter(field => field.canonicalKey === 'property.typeOther')

  assert.equal(purposeOtherFields.length, 1)
  assert.deepEqual(purposeOtherFields[0]?.visibleWhen, {
    canonicalKey: 'loan.purpose',
    equals: 'other',
  })
  assert.deepEqual(purposeOtherFields[0]?.requiredWhen, {
    canonicalKey: 'loan.purpose',
    equals: 'other',
  })
  assert.equal(propertyOtherFields.length, 1)

  const purposeTargets = getTemplates().map(template => template.bindings.find(binding => (
    binding.canonicalKey === 'loan.purposeOther'
  ))?.target)
  assert.deepEqual(purposeTargets, [
    preciseTextTarget(2, { x: 153, y: 383, width: 376, height: 17 }, 8.5),
    { kind: 'acroform', field: 'inny_cel_opis' },
    { kind: 'acroform', field: 'Text Field 29' },
  ])
})

test('uses one staged own-funds model and computes totals for simpler documents', () => {
  const bundle = prepareBundle([...DEMO_TEMPLATE_IDS])
  const keys = bundle.fields.map(field => field.canonicalKey)

  assert.ok(keys.includes('investment.ownFundsPaid'))
  assert.ok(keys.includes('investment.ownFundsBeforeDisbursement'))
  assert.ok(keys.includes('investment.ownFundsDuringInvestment'))
  assert.equal(keys.filter(key => key === 'investment.ownFundsPaid').length, 1)
  assert.ok(!keys.includes('investment.ownFunds'))

  const pko = getTemplate('pko-bp-mortgage-2022')!
  const total = pko.bindings.find(binding => (
    binding.computed && binding.target.kind === 'acroform' && binding.target.field === 'wlasne_razem'
  ))
  assert.deepEqual(total?.valueFrom, [
    'investment.ownFundsPaid',
    'investment.ownFundsBeforeDisbursement',
    'investment.ownFundsDuringInvestment',
  ])
  assert.equal(total?.valueFormat, 'currency.sum')
})

test('Pekao requests only concepts present in that PDF and resolves conditional variants', () => {
  const bundle = prepareBundle(['pekao-mortgage-2025'])
  const keys = bundle.fields.map(field => field.canonicalKey)
  const pekao = getTemplate('pekao-mortgage-2025')!

  assert.ok(keys.includes('application.place'))
  assert.ok(keys.includes('application.date'))
  assert.ok(keys.includes('loan.constructionMethod'))
  assert.ok(keys.includes('loan.renovationPermit'))
  assert.ok(!keys.includes('applicants.0.pesel'))
  assert.ok(!keys.includes('loan.disbursementType'))
  assert.ok(!keys.includes('property.type'))

  const permitTargets = pekao.bindings
    .filter(binding => binding.canonicalKey === 'loan.renovationPermit')
    .map(binding => binding.target)
  assert.deepEqual(permitTargets, [
    { kind: 'acroform', field: 'C19', valueMap: { required: 'Yes' } },
    { kind: 'acroform', field: 'C20', valueMap: { not_required: 'Yes' } },
  ])
  assert.deepEqual(pekao.bindings.find(binding => (
    binding.canonicalKey === 'loan.purpose'
      && binding.target.kind === 'acroform'
      && binding.target.valueMap?.other
  ))?.target, {
    kind: 'acroform',
    field: 'C31',
    valueMap: { other: 'Yes' },
  })
})

test('prepareBundle de-duplicates template ids and rejects unknown templates', () => {
  const bundle = prepareBundle(['erste-mortgage-2026', 'erste-mortgage-2026'])
  assert.deepEqual(bundle.templateIds, ['erste-mortgage-2026'])
  assert.equal(bundle.documents.length, 1)
  assert.throws(() => prepareBundle(['does-not-exist']), /Unknown multiform template/)
})
