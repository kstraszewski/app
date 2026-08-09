import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  PDFCheckBox,
  PDFDocument,
  PDFTextField,
  TextAlignment,
} from 'pdf-lib'
import {
  CANONICAL_COLLECTIONS,
  CANONICAL_FIELDS,
  DEMO_TEMPLATE_IDS,
  MULTIFORM_MODEL_DEFINITIONS,
  type DocumentTemplate,
  getTemplate,
  getTemplateBySourceSha256,
  getTemplates,
  instantiateTemplate,
  prepareBundle,
  resolveTemplateFillMethod,
  templateApplicantCapacity,
  templateApplicantCapacityIssues,
  templateInstanceIndexes,
  templateMatchesValues,
  validateTemplateJson,
} from '../src/index.ts'
import { createTemplateSkeleton } from '../src/template-generator.ts'

test('uses current public Gemini models for the agent and PDF template generator', () => {
  assert.equal(MULTIFORM_MODEL_DEFINITIONS.agent.gatewayId, 'google/gemini-3.6-flash')
  assert.equal(MULTIFORM_MODEL_DEFINITIONS.templateGenerator.gatewayId, 'google/gemini-3.5-flash-lite')
  assert.equal(MULTIFORM_MODEL_DEFINITIONS.agent.contextWindowTokens, 1_048_576)
  assert.equal(MULTIFORM_MODEL_DEFINITIONS.templateGenerator.contextWindowTokens, 1_048_576)
})

test('creates a non-publishable template skeleton for any bank slug', async () => {
  const pdf = await PDFDocument.create()
  pdf.addPage([420, 595])
  const bytes = await pdf.save()
  const template = await createTemplateSkeleton({
    templateId: 'mbank-wniosek-12345678',
    bank: 'mbank',
    label: 'Wniosek mBank',
    fileName: 'wniosek-mbank.pdf',
    sha256: 'a'.repeat(64),
    bytes,
  })
  const validation = validateTemplateJson(template)

  assert.equal(template.bank, 'mbank')
  assert.equal(template.source.pageCount, 1)
  assert.deepEqual(template.fillMethod, { kind: 'pdf_overlay' })
  assert.equal(template.coverage.status, 'incomplete')
  assert.equal(validation.kind, 'document-template')
  assert.equal(validation.valid, true)
  assert.equal(validation.summary.activationReady, false)
})

test('creates an AcroForm completion contract when the source has native fields', async () => {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([420, 595])
  pdf.getForm().createTextField('loan_amount').addToPage(page, {
    x: 40,
    y: 500,
    width: 160,
    height: 20,
  })
  const bytes = await pdf.save()
  const template = await createTemplateSkeleton({
    templateId: 'native-form-12345678',
    bank: 'test-bank',
    label: 'Native form',
    fileName: 'native-form.pdf',
    sha256: 'c'.repeat(64),
    bytes,
  })

  assert.equal(template.source.formKind, 'acroform')
  assert.deepEqual(template.fillMethod, { kind: 'pdf_acroform' })
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

const completeValidationTemplate = (
  target: unknown,
  formKind: DocumentTemplate['source']['formKind'] = 'overlay',
) => ({
  schemaVersion: 2,
  id: 'validation-template',
  bank: 'erste',
  label: 'Template walidacyjny',
  version: 1,
  fillMethod: resolveTemplateFillMethod({ source: { formKind } }),
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
  const keys: string[] = CANONICAL_FIELDS.map(field => field.canonicalKey)
  const applicantFields = CANONICAL_FIELDS.filter(field => field.collection?.key === 'applicants')
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(keys.includes('applicants.0.pesel'))
  assert.ok(keys.includes('applicants.4.pesel'))
  assert.ok(keys.includes('loan.amount'))
  assert.ok(keys.includes('property.address.houseNumber'))
  assert.ok(keys.includes('property.landRegisterNumber'))
  assert.ok(applicantFields.length >= 31)
  for (const index of [0, 1, 2, 3, 4]) {
    for (const relativeKey of ['firstName', 'lastName', 'pesel']) {
      assert.ok(keys.includes(`applicants.${index}.${relativeKey}`))
    }
  }
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
  assert.deepEqual(CANONICAL_COLLECTIONS, [
    {
      key: 'applicants',
      label: 'Wnioskodawcy',
      itemLabel: 'Wnioskodawca',
      minItems: 1,
      maxItems: 5,
      requiredRelativeKeys: [
        'firstName',
        'lastName',
        'pesel',
        'targetPropertyOwner',
        'willOccupyFinancedProperty',
        'lifeInsuranceSelected',
        'postContractDataProcessingConsent',
      ],
    },
    {
      key: 'tranches',
      label: 'Planowane transze',
      itemLabel: 'Transza',
      minItems: 1,
      maxItems: 6,
      requiredRelativeKeys: ['date', 'amount', 'accountOwner'],
    },
    {
      key: 'investorPayments',
      label: 'Harmonogram płatności inwestorowi',
      itemLabel: 'Płatność',
      minItems: 1,
      maxItems: 8,
      requiredRelativeKeys: ['date', 'amount', 'purpose'],
    },
    {
      key: 'households',
      label: 'Gospodarstwa domowe',
      itemLabel: 'Gospodarstwo',
      minItems: 1,
      maxItems: 3,
      requiredRelativeKeys: [
        'monthlyDebtInstallments',
        'outstandingDebt',
        'otherFixedExpenses',
        'externalCreditLimits',
        'householdExpenses',
      ],
    },
    {
      key: 'liabilities',
      label: 'Zobowiązania przeznaczone do spłaty',
      itemLabel: 'Zobowiązanie',
      minItems: 0,
      maxItems: 11,
      requiredRelativeKeys: [],
    },
    {
      key: 'mortgageDischarges',
      label: 'Obciążenia hipoteczne',
      itemLabel: 'Hipoteka',
      minItems: 0,
      maxItems: 4,
      requiredRelativeKeys: [],
    },
    {
      key: 'collateralProperties',
      label: 'Nieruchomości pod hipotekę',
      itemLabel: 'Nieruchomość',
      minItems: 1,
      maxItems: 3,
      requiredRelativeKeys: ['relationshipToFinancedProperty', 'hasLandRegister'],
    },
  ])
})

test('registers the demo templates and the complete Erste document set', () => {
  const templates = getTemplates()
  const templateIds = templates.map(template => template.id)
  assert.ok(DEMO_TEMPLATE_IDS.every(id => templateIds.includes(id)))
  assert.ok(templateIds.includes('erste-risk-cost-information-2026'))
  assert.ok(templateIds.includes('erste-general-mortgage-information-2026'))
  assert.ok(templateIds.includes('erste-rkm-guarantee-conditions-2026'))
  assert.ok(templateIds.includes('erste-rkm-family-conditions-2026'))
  assert.ok(DEMO_TEMPLATE_IDS.length <= 5)
  assert.equal(getTemplate('erste-mortgage-2026')?.source.formKind, 'overlay')
  assert.equal(getTemplate('pko-bp-mortgage-2022')?.source.formKind, 'acroform')
  assert.equal(getTemplate('pekao-mortgage-2025')?.source.pageCount, 6)
  assert.deepEqual(getTemplate('erste-mortgage-2026')?.fillMethod, { kind: 'pdf_overlay' })
  assert.deepEqual(getTemplate('pko-bp-mortgage-2022')?.fillMethod, { kind: 'pdf_acroform' })
  assert.deepEqual(getTemplate('pekao-mortgage-2025')?.fillMethod, { kind: 'pdf_acroform' })
})

test('resolves legacy source.formKind through one public fill-method contract', () => {
  const template = completeValidationTemplate(preciseTextTarget(
    1,
    { x: 120, y: 640, width: 180, height: 17 },
  ))
  const { fillMethod: _fillMethod, ...legacyTemplate } = template

  assert.deepEqual(resolveTemplateFillMethod(legacyTemplate), { kind: 'pdf_overlay' })
  assert.deepEqual(resolveTemplateFillMethod({ source: { formKind: 'acroform' } }), { kind: 'pdf_acroform' })
  assert.deepEqual(resolveTemplateFillMethod({ source: { formKind: 'hybrid' } }), { kind: 'pdf_hybrid' })
  const result = validateTemplateJson(legacyTemplate)
  assert.equal(result.valid, true)
  assert.equal(result.fillReady, true)
  assert.ok(result.warnings.some(issue => (
    issue.path === 'fillMethod' && issue.code === 'legacy_fill_method'
  )))
})

test('rejects unknown or malformed completion methods at the domain boundary', () => {
  const template = completeValidationTemplate(preciseTextTarget(
    1,
    { x: 120, y: 640, width: 180, height: 17 },
  ))
  const unknown = validateTemplateJson({
    ...template,
    fillMethod: { kind: 'email_attachment' },
  })
  assert.ok(unknown.errors.some(issue => (
    issue.path === 'fillMethod.kind' && issue.code === 'invalid_fill_method_kind'
  )))

  const malformed = validateTemplateJson({
    ...template,
    fillMethod: 'pdf_overlay',
  })
  assert.ok(malformed.errors.some(issue => (
    issue.path === 'fillMethod' && issue.code === 'invalid_fill_method'
  )))
})

test('keeps future fill methods typed but non-activatable until handlers exist', () => {
  for (const kind of ['web_form', 'api'] as const) {
    const template = {
      ...completeValidationTemplate(preciseTextTarget(
        1,
        { x: 120, y: 640, width: 180, height: 17 },
      )),
      fillMethod: { kind },
    }
    assert.deepEqual(resolveTemplateFillMethod(template), { kind })

    const result = validateTemplateJson(template)
    assert.equal(result.valid, true, kind)
    assert.equal(result.fillReady, false, kind)
    assert.equal(result.summary.activationReady, false, kind)
    assert.ok(result.warnings.some(issue => (
      issue.path === 'fillMethod.kind' && issue.code === 'fill_method_handler_unavailable'
    )), kind)
  }
})

test('accepts an audited official PDF as a manual package document without automatic targets', () => {
  const template = completeValidationTemplate(preciseTextTarget(
    1,
    { x: 120, y: 640, width: 180, height: 17 },
  ))
  const manual = {
    ...template,
    fillMethod: { kind: 'pdf_manual' },
    coverage: {
      status: 'complete',
      inScopeTargetCount: 0,
      mappedTargetCount: 0,
      manualUserActionCount: 1,
      notes: ['Oficjalny formularz banku jest dołączany do paczki i uzupełniany ręcznie.'],
    },
    bindings: [],
  }

  const result = validateTemplateJson(manual)
  assert.equal(result.valid, true)
  assert.equal(result.fillReady, true)
  assert.equal(result.summary.activationReady, true)

  const invalid = validateTemplateJson({
    ...manual,
    bindings: template.bindings,
  })
  assert.ok(invalid.errors.some(issue => issue.code === 'fill_method_target_mismatch'))
})

test('rejects PDF fill methods that drift from source metadata or target kinds', () => {
  const overlay = completeValidationTemplate(preciseTextTarget(
    1,
    { x: 120, y: 640, width: 180, height: 17 },
  ))
  const sourceMismatch = validateTemplateJson({
    ...overlay,
    fillMethod: { kind: 'pdf_acroform' },
  })
  assert.ok(sourceMismatch.errors.some(issue => issue.code === 'fill_method_source_mismatch'))

  const acroBinding = {
    ...overlay.bindings[0],
    target: {
      kind: 'acroform' as const,
      field: 'loan_amount',
      fieldType: 'text' as const,
      expectedWidgets: [{
        index: 0,
        page: 1,
        rect: { x: 120, y: 640, width: 180, height: 17 },
      }],
      text: { alignment: 'left' as const, multiline: false, comb: false },
      appearance: textAppearance(),
    },
  }
  const targetMismatch = validateTemplateJson({
    ...overlay,
    bindings: [acroBinding],
  })
  assert.ok(targetMismatch.errors.some(issue => issue.code === 'fill_method_target_mismatch'))

  const { fillMethod: _fillMethod, ...legacyOverlay } = overlay
  const legacyTargetMismatch = validateTemplateJson({
    ...legacyOverlay,
    bindings: [acroBinding],
  })
  assert.equal(legacyTargetMismatch.valid, true)
  assert.equal(legacyTargetMismatch.fillReady, false)
  assert.ok(legacyTargetMismatch.warnings.some(issue => (
    issue.code === 'fill_method_target_mismatch'
  )))
})

test('accepts pdf_hybrid only when both native and overlay targets are present', () => {
  const overlay = completeValidationTemplate(preciseTextTarget(
    1,
    { x: 120, y: 640, width: 180, height: 17 },
  ))
  const acroTarget = {
    kind: 'acroform',
    field: 'loan_term',
    fieldType: 'text',
    expectedWidgets: [{
      index: 0,
      page: 1,
      rect: { x: 120, y: 600, width: 180, height: 17 },
    }],
    text: { alignment: 'left', multiline: false, comb: false },
    appearance: textAppearance(),
  }
  const hybrid = {
    ...overlay,
    fillMethod: { kind: 'pdf_hybrid' },
    source: { ...overlay.source, formKind: 'hybrid' },
    coverage: {
      ...overlay.coverage,
      inScopeTargetCount: 2,
      mappedTargetCount: 2,
    },
    bindings: [
      overlay.bindings[0],
      {
        canonicalKey: 'loan.termMonths',
        reviewStatus: 'ready',
        target: acroTarget,
      },
    ],
  }

  const valid = validateTemplateJson(hybrid)
  assert.equal(valid.valid, true)
  assert.equal(valid.fillReady, true)

  const incompleteHybrid = validateTemplateJson({
    ...hybrid,
    coverage: overlay.coverage,
    bindings: overlay.bindings,
  })
  assert.ok(incompleteHybrid.errors.some(issue => issue.code === 'fill_method_target_mismatch'))
})

test('computes applicant capacity per template without hiding index gaps', () => {
  const erste = getTemplate('erste-mortgage-2026')!
  const pko = getTemplate('pko-bp-mortgage-2022')!
  assert.equal(templateApplicantCapacity(erste), 4)
  assert.equal(templateApplicantCapacity(pko), 4)
  assert.deepEqual(
    templateApplicantCapacityIssues([erste, pko], 5).map(issue => issue.templateId),
    ['erste-mortgage-2026', 'pko-bp-mortgage-2022'],
  )
  assert.deepEqual(templateApplicantCapacityIssues([erste, pko], 4), [])

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

test('validates every reviewed registered template as fill-ready', () => {
  for (const template of getTemplates()) {
    const result = validateTemplateJson(template)

    assert.equal(result.kind, 'document-template', template.id)
    assert.equal(result.valid, true, template.id)
    assert.equal(result.fillReady, true, template.id)
    assert.equal(result.summary.activationReady, true, template.id)
    assert.equal(result.summary.bindingCount, template.bindings.length, template.id)
    assert.equal(result.summary.mappedBindingCount, template.bindings.length, template.id)
    assert.equal(
      result.summary.needsReviewCount,
      0,
      template.id,
    )
    assert.equal(result.summary.unmappedCount, 0, template.id)
    assert.deepEqual(result.errors, [], template.id)
    assert.equal(
      result.warnings.some(issue => issue.code === 'incomplete_coverage'),
      false,
      template.id,
    )
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
  const pkoAmount = pko.bindings.find((binding) => (
    binding.canonicalKey === 'loan.amount'
    && binding.target.kind === 'acroform'
    && binding.target.field === 'wnioskowany_kredyt'
  ))
  assert.equal(pkoAmount?.target.kind, 'acroform')
  assert.equal(pkoAmount?.target.kind === 'acroform' ? pkoAmount.target.field : undefined, 'wnioskowany_kredyt')

  const pekaoKw = getTemplate('pekao-mortgage-2025')!.bindings.find(
    (binding) => binding.canonicalKey === 'property.landRegisterNumber',
  )
  assert.equal(pekaoKw?.target.kind, 'acroform')
  assert.equal(pekaoKw?.target.kind === 'acroform' ? pekaoKw.target.field : undefined, 'Text Field 40')

  const ersteApplicant = getTemplate('erste-mortgage-2026')!.bindings.find(
    (binding) => binding.canonicalKey === 'applicants.0.fullName',
  )
  assert.equal(ersteApplicant?.computed, true)
  assert.deepEqual(ersteApplicant?.target, preciseTextTarget(
    1,
    { x: 155, y: 481, width: 374, height: 17 },
  ))

  const erste = getTemplate('erste-mortgage-2026')!
  const bindingsByPage = Object.fromEntries(
    [...Array.from({ length: 8 }, (_, index) => index + 1)].map(page => [
      page,
      erste.bindings.filter(binding => binding.target.kind === 'overlay' && binding.target.page === page).length,
    ]),
  )
  assert.deepEqual(bindingsByPage, {
    1: 10,
    2: 15,
    3: 17,
    4: 25,
    5: 14,
    6: 4,
    7: 14,
    8: 3,
  })
  assert.equal(erste.bindings.length, 102)
  assert.equal(erste.bindings.every(binding => binding.reviewStatus === 'ready'), true)
  const refinancingTarget = erste.bindings.find(binding => (
    binding.canonicalKey === 'loan.purpose'
    && binding.condition?.equals === 'refinancing'
  ))?.target
  assert.equal(refinancingTarget?.kind, 'overlay')
  assert.deepEqual(
    refinancingTarget?.kind === 'overlay' && refinancingTarget.rendererVersion === 2
      ? { page: refinancingTarget.page, box: refinancingTarget.box }
      : undefined,
    { page: 2, box: { x: 63, y: 327, width: 17, height: 17 } },
  )
  assert.deepEqual(
    erste.bindings.find(binding => binding.canonicalKey === 'intermediary.name')?.target,
    preciseTextTarget(7, { x: 167, y: 430, width: 362, height: 17 }, 8.5),
  )
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
  assert.ok(!keys.includes('applicants.4.pesel'))
  assert.ok(keys.includes('property.address.houseNumber'))
  assert.ok(keys.includes('property.address.unitNumber'))
  assert.ok(!keys.includes('applicants.0.fullName'))
  assert.ok(!keys.includes('property.address.full'))
  assert.ok(!keys.includes('property.address.houseAndUnit'))
  assert.deepEqual(bundle.collections.map(collection => collection.key), [
    'applicants',
    'tranches',
    'households',
    'liabilities',
    'mortgageDischarges',
  ])
})

test('every curated source form has complete reviewed customer-field coverage', () => {
  for (const template of getTemplates()) {
    const needsReviewCount = template.bindings.filter(binding => binding.reviewStatus === 'needsReview').length
    assert.ok(template.bindings.every(binding => binding.target.kind !== 'unmapped'))
    assert.equal(needsReviewCount, 0)
    assert.equal(template.coverage.status, 'complete')
    assert.equal(template.coverage.mappedTargetCount, template.coverage.inScopeTargetCount)
    assert.equal(
      template.bindings.filter(binding => binding.target.kind !== 'unmapped').length,
      template.coverage.mappedTargetCount,
    )

    const warnings = prepareBundle([template.id]).warnings
    assert.equal(warnings.length, 0)
    assert.equal(warnings.some(warning => (
      warning.canonicalKey === '__templateCoverage__' && warning.status === 'unmapped'
    )), false)
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

  const purposeTargets = DEMO_TEMPLATE_IDS.map(id => getTemplate(id)?.bindings.find(binding => (
    binding.canonicalKey === 'loan.purposeOther'
  ))?.target)
  assert.deepEqual(purposeTargets.map(target => (
    target?.kind === 'acroform' ? target.field : target
  )), [
    preciseTextTarget(2, { x: 153, y: 383, width: 376, height: 17 }, 8.5),
    'inny_cel_opis',
    'Text Field 29',
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
    'investment.landValue',
  ])
  assert.equal(total?.valueFormat, 'currency.sum')
  const remaining = pko.bindings.find(binding => (
    binding.computed
    && binding.target.kind === 'acroform'
    && binding.target.field === 'wlasne_do_wniesienia_razem'
  ))
  assert.deepEqual(remaining?.valueFrom, [
    'investment.ownFundsBeforeDisbursement',
    'investment.ownFundsDuringInvestment',
  ])
  assert.equal(remaining?.valueFormat, 'currency.sum')
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
    .map(binding => binding.target.kind === 'acroform'
      ? { field: binding.target.field, valueMap: binding.target.valueMap }
      : undefined)
  assert.deepEqual(permitTargets, [
    { field: 'C19', valueMap: { required: 'Yes' } },
    { field: 'C20', valueMap: { not_required: 'Yes' } },
  ])
  const otherPurposeTarget = pekao.bindings.find(binding => (
    binding.canonicalKey === 'loan.purpose'
      && binding.target.kind === 'acroform'
      && binding.target.valueMap?.other
  ))?.target
  assert.deepEqual(otherPurposeTarget?.kind === 'acroform' ? {
    field: otherPurposeTarget.field,
    valueMap: otherPurposeTarget.valueMap,
  } : undefined, {
    field: 'C31',
    valueMap: { other: 'Yes' },
  })
})

test('Pekao inventories every customer-facing AcroForm widget exactly once', async () => {
  const sourceBytes = await readFile(new URL(
    '../../../mock-files/pekao-wniosek-o-kredyt-mieszkaniowy.pdf',
    import.meta.url,
  ))
  const source = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  const pages = source.getPages()
  const pageByReference = new Map(pages.map((page, index) => [page.ref.toString(), index + 1]))
  const pageByAnnotationReference = new Map<string, number>()
  for (const [pageIndex, page] of pages.entries()) {
    for (const annotation of page.node.Annots()?.asArray() ?? []) {
      pageByAnnotationReference.set(annotation.toString(), pageIndex + 1)
    }
  }
  const sourceFields = source.getForm().getFields()
  const sourceFieldNames = sourceFields.map(field => field.getName())
  const excludedBankFields = new Set([
    'Text Field 1',
    'Text Field 3',
    'Text Field 120',
    'Text Field 122',
    'C101',
    'C102',
    'Text Field 123',
    'Text Field 124',
    'Text Field 125',
  ])
  const customerFieldNames = sourceFieldNames.filter(name => !excludedBankFields.has(name))
  const pekao = getTemplate('pekao-mortgage-2025')!
  const validation = validateTemplateJson(pekao)
  const targetNames = pekao.bindings.map((binding) => {
    assert.equal(binding.target.kind, 'acroform')
    return binding.target.kind === 'acroform' ? binding.target.field : ''
  })

  assert.equal(sourceFields.length, 287)
  assert.equal(sourceFields.reduce((count, field) => (
    count + field.acroField.getWidgets().length
  ), 0), 287)
  assert.equal(customerFieldNames.length, 278)
  assert.equal(pekao.version, 3)
  assert.equal(pekao.coverage.status, 'complete')
  assert.equal(pekao.coverage.mappedTargetCount, 278)
  assert.equal(validation.valid, true)
  assert.equal(validation.fillReady, true)
  assert.equal(validation.summary.activationReady, true)
  assert.deepEqual(validation.errors, [])
  assert.deepEqual(validation.warnings, [])
  assert.equal(targetNames.length, 278)
  assert.equal(new Set(targetNames).size, 278)
  assert.deepEqual(
    [...customerFieldNames].sort((left, right) => left.localeCompare(right)),
    [...targetNames].sort((left, right) => left.localeCompare(right)),
  )
  assert.deepEqual(targetNames.filter(name => excludedBankFields.has(name)), [])

  const targetsByField = new Map(pekao.bindings.map((binding) => {
    assert.equal(binding.target.kind, 'acroform')
    return [binding.target.kind === 'acroform' ? binding.target.field : '', binding.target]
  }))
  for (const field of sourceFields) {
    if (excludedBankFields.has(field.getName())) continue
    const target = targetsByField.get(field.getName())
    assert.equal(target?.kind, 'acroform')
    if (target?.kind !== 'acroform') continue

    const expectedType = field instanceof PDFTextField
      ? 'text'
      : field instanceof PDFCheckBox
        ? 'checkbox'
        : undefined
    assert.ok(expectedType, `Unsupported source field type: ${field.getName()}`)
    assert.equal(target.fieldType, expectedType, field.getName())
    assert.equal(target.expectedWidgets?.length, 1, field.getName())

    const widget = field.acroField.getWidgets()[0]!
    const annotationReference = source.context.getObjectRef(widget.dict)
    const page = widget.P()
      ? pageByReference.get(widget.P()!.toString())
      : annotationReference
        ? pageByAnnotationReference.get(annotationReference.toString())
        : undefined
    const rect = widget.getRectangle()
    assert.deepEqual(target.expectedWidgets?.[0], {
      index: 0,
      page,
      rect: {
        x: Number(rect.x.toFixed(2)),
        y: Number(rect.y.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
      },
      ...(field instanceof PDFCheckBox && widget.getOnValue()
        ? { exportValue: widget.getOnValue()!.decodeText() }
        : {}),
    }, field.getName())

    if (field instanceof PDFTextField) {
      const alignment = field.getAlignment() === TextAlignment.Center
        ? 'center'
        : field.getAlignment() === TextAlignment.Right
          ? 'right'
          : 'left'
      assert.deepEqual(target.text, {
        alignment,
        multiline: field.isMultiline(),
        comb: field.isCombed(),
        ...(field.getMaxLength() !== undefined ? { maxLength: field.getMaxLength() } : {}),
      }, field.getName())
      assert.equal(target.appearance?.kind, 'text', field.getName())
      if (target.appearance?.kind === 'text') {
        assert.equal(target.appearance.horizontalAlign, alignment, field.getName())
        assert.equal(target.appearance.wrap, field.isMultiline() ? 'word' : 'none', field.getName())
      }
    }
    else {
      assert.equal(target.appearance?.kind, 'mark', field.getName())
      if (target.appearance?.kind === 'mark') {
        assert.equal(target.appearance.role, 'checkbox', field.getName())
      }
    }
  }
})

test('Pekao checkbox mappings use declared canonical option values', () => {
  const pekao = getTemplate('pekao-mortgage-2025')!
  const definitions = new Map<string, (typeof CANONICAL_FIELDS)[number]>(
    CANONICAL_FIELDS.map(field => [field.canonicalKey, field]),
  )

  for (const binding of pekao.bindings) {
    if (binding.computed || binding.target.kind !== 'acroform') continue
    const definition = definitions.get(binding.canonicalKey)
    assert.ok(definition, `Missing canonical definition for ${binding.canonicalKey}`)
    if (!binding.target.valueMap) continue

    const mappedValues = Object.keys(binding.target.valueMap)
    if (definition.type === 'boolean') {
      assert.ok(mappedValues.every(value => value === 'true' || value === 'false'))
      continue
    }

    assert.equal(definition.type, 'select', binding.canonicalKey)
    const allowedValues = new Set(definition.options?.map(option => option.value))
    for (const value of mappedValues) {
      assert.ok(allowedValues.has(value), `${binding.canonicalKey}: ${value}`)
    }
  }
})

test('prepareBundle de-duplicates template ids and rejects unknown templates', () => {
  const bundle = prepareBundle(['erste-mortgage-2026', 'erste-mortgage-2026'])
  assert.deepEqual(bundle.templateIds, ['erste-mortgage-2026'])
  assert.equal(bundle.documents.length, 1)
  assert.throws(() => prepareBundle(['does-not-exist']), /Unknown multiform template/)
})

test('repeats one audited applicant form for every active applicant', () => {
  const erste = getTemplate('erste-mortgage-2026')!
  const applicantBinding = erste.bindings.find(binding => (
    binding.canonicalKey === 'applicants.0.fullName'
  ))!
  const repeated: DocumentTemplate = {
    ...erste,
    id: 'erste-repeat-test-2026',
    label: 'Karta klienta',
    version: 1,
    repeatFor: {
      collection: 'applicants',
      templateIndex: 0,
      maxInstances: 5,
      itemLabel: 'Wnioskodawca',
    },
    requiredCanonicalKeys: ['applicants.0.firstName'],
    coverage: {
      status: 'complete',
      inScopeTargetCount: 1,
      mappedTargetCount: 1,
      manualUserActionCount: 0,
      excludedTargetCount: 0,
      notes: [],
    },
    bindings: [applicantBinding],
  }

  const validation = validateTemplateJson(repeated)
  assert.equal(validation.valid, true, JSON.stringify(validation.errors))
  assert.equal(validation.fillReady, true)
  assert.equal(templateApplicantCapacity(repeated), 5)
  assert.deepEqual(templateInstanceIndexes(repeated, { applicants: 2 }), [0, 1])

  const second = instantiateTemplate(repeated, 1)
  assert.equal(second.repeatFor, undefined)
  assert.equal(second.bindings[0]?.canonicalKey, 'applicants.1.fullName')
  assert.deepEqual(second.requiredCanonicalKeys, ['applicants.1.firstName'])
  assert.deepEqual(second.bindings[0]?.valueFrom, [
    'applicants.1.firstName',
    'applicants.1.lastName',
  ])

  const bundle = prepareBundle([repeated.id], [repeated])
  for (let index = 0; index < 5; index += 1) {
    assert.ok(bundle.fields.some(field => field.canonicalKey === `applicants.${index}.firstName`))
    assert.ok(bundle.fields.some(field => field.canonicalKey === `applicants.${index}.lastName`))
  }
})

test('rejects unknown and duplicated template-specific required inputs', () => {
  const erste = getTemplate('erste-mortgage-2026')!
  const invalid = {
    ...erste,
    id: 'erste-invalid-required-inputs-2026',
    requiredCanonicalKeys: [
      'applicants.0.firstName',
      'applicants.0.firstName',
      'not-a-canonical-key',
    ],
  }
  const validation = validateTemplateJson(invalid)
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.some(issue => issue.code === 'duplicate_required_canonical_key'))
  assert.ok(validation.errors.some(issue => issue.code === 'unknown_required_canonical_key'))
})

test('rejects repeated forms that leak data from another applicant slot', () => {
  const erste = getTemplate('erste-mortgage-2026')!
  const firstName = erste.bindings.find(binding => (
    binding.canonicalKey === 'applicants.0.firstName'
  ))!
  const invalid = {
    ...erste,
    id: 'erste-repeat-invalid-2026',
    repeatFor: {
      collection: 'applicants',
      templateIndex: 0,
      maxInstances: 5,
      itemLabel: 'Wnioskodawca',
    },
    bindings: [
      firstName,
      { ...firstName, canonicalKey: 'applicants.1.firstName' },
    ],
  }
  const validation = validateTemplateJson(invalid)
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.some(issue => issue.code === 'repeat_cross_instance_reference'))
})

test('includes informational Erste documents only for the matching loan program', () => {
  const family = getTemplate('erste-rkm-family-conditions-2026')!
  const guarantee = getTemplate('erste-rkm-guarantee-conditions-2026')!
  const standardValues = { 'loan.program': 'standard', 'loan.rkmGuarantee': false }
  const rkmValues = { 'loan.program': 'rkm', 'loan.rkmGuarantee': true }

  assert.equal(templateMatchesValues(family, standardValues), false)
  assert.equal(templateMatchesValues(guarantee, standardValues), false)
  assert.equal(templateMatchesValues(family, rkmValues), true)
  assert.equal(templateMatchesValues(guarantee, rkmValues), true)

  const bundle = prepareBundle([family.id, guarantee.id])
  assert.ok(bundle.fields.some(field => field.canonicalKey === 'loan.program'))
  assert.ok(bundle.fields.some(field => field.canonicalKey === 'loan.rkmGuarantee'))
  assert.equal(validateTemplateJson(family).fillReady, true)
  assert.equal(validateTemplateJson(guarantee).fillReady, true)
})
