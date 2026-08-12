import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CANONICAL_FIELDS,
  ERSTE_EMPLOYMENT_INCOME_TEMPLATE,
  ERSTE_TEMPLATE,
  PKO_TEMPLATE,
} from '@openexpert/multiform'

import {
  canonicalMaxLengthIssue,
  firstUnsupportedTemplateFillMethod,
  summarizeTemplate,
  toPreparedDocument,
  toUiField,
  unsupportedTemplateFillMethodHttpDetails,
} from '../server/utils/multiform-api.ts'

test('boolean bank questions expose an explicit unanswered / Tak / Nie state', () => {
  const definition = CANONICAL_FIELDS.find(field => field.canonicalKey === 'loan.gracePeriod')
  assert.ok(definition)

  const field = toUiField(definition)
  assert.equal(field.type, 'select')
  assert.deepEqual(field.options, [
    { label: 'Tak', value: 'true' },
    { label: 'Nie', value: 'false' },
  ])
  assert.equal(field.placeholder, 'Wybierz opcję')
})

test('derived fields expose their source dependencies to the shared form clients', () => {
  const birthDate = CANONICAL_FIELDS.find(field => (
    field.canonicalKey === 'applicants.0.birthDate'
  ))
  const collateralAddress = CANONICAL_FIELDS.find(field => (
    field.canonicalKey === 'collateralProperty.address'
  ))
  assert.ok(birthDate)
  assert.ok(collateralAddress)
  assert.deepEqual(toUiField(birthDate).derivation, {
    mode: 'when_available',
    dependencies: ['applicants.0.pesel'],
  })
  assert.ok(toUiField(collateralAddress).derivation?.dependencies.includes(
    'collateralProperty.sameAsFinancedProperty',
  ))
})

test('PDF-constrained text validation reaches the UI contract', () => {
  const schedule = CANONICAL_FIELDS.find(field => (
    field.canonicalKey === 'investment.ownFundsContributionDates'
  ))
  const account = CANONICAL_FIELDS.find(field => (
    field.canonicalKey === 'loan.repaymentAccountNumber'
  ))
  assert.ok(schedule)
  assert.ok(account)

  assert.equal(toUiField(schedule).validation?.maxLength, 25)
  assert.equal(canonicalMaxLengthIssue(schedule, 'przed wypłatą; 30.11.2026'), undefined)
  assert.equal(
    canonicalMaxLengthIssue(
      schedule,
      '60 000 zł przed pierwszą transzą; 20 000 zł do 2026-11-30',
    ),
    'Wartość może mieć maksymalnie 25 znaków.',
  )
  const accountPattern = new RegExp(toUiField(account).validation?.pattern ?? '')
  assert.equal(accountPattern.test('12 3456 7890 1234 5678 9012 3456'), true)
  assert.equal(accountPattern.test('12345678901234567890123456'), true)
  assert.equal(accountPattern.test('1234567890123456789012345'), false)
  assert.equal(accountPattern.test('PL12345678901234567890123456'), false)
})

test('template-specific requirements and per-applicant conditions reach the UI contract', () => {
  const identityType = CANONICAL_FIELDS.find(field => (
    field.canonicalKey === 'applicants.0.identityDocumentType'
  ))
  assert.ok(identityType)
  assert.equal(toUiField(identityType).required, false)
  assert.equal(toUiField(
    identityType,
    new Set(['applicants.0.identityDocumentType']),
  ).required, true)

  const secondIncomeForm = toPreparedDocument(
    ERSTE_EMPLOYMENT_INCOME_TEMPLATE,
    { index: 1, label: 'Anna Nowak' },
  )
  assert.deepEqual(secondIncomeForm.includeWhen, {
    canonicalKey: 'applicants.1.incomeSource',
    equals: ['employment', 'civil_contract', 'retirement'],
  })
})

test('template summary exposes the explicit completion method and resolves legacy PDF metadata', () => {
  const legacy = structuredClone(PKO_TEMPLATE)
  delete legacy.fillMethod
  legacy.source.formKind = 'hybrid'

  const legacySummary = summarizeTemplate(legacy)
  assert.deepEqual(legacySummary.fillMethod, { kind: 'pdf_hybrid' })
  assert.equal(legacySummary.fillMode, 'hybrid')
  assert.deepEqual(toPreparedDocument(legacy).fillMethod, { kind: 'pdf_hybrid' })

  const future = structuredClone(ERSTE_TEMPLATE)
  future.fillMethod = { kind: 'web_form' }
  const futureSummary = summarizeTemplate(future)
  assert.deepEqual(futureSummary.fillMethod, { kind: 'web_form' })
  assert.equal(futureSummary.fillMode, 'web_form')
  assert.equal(futureSummary.ready, false)
  assert.equal(futureSummary.status, 'nieobsługiwany')
  assert.match(futureSummary.warnings.join(' '), /nie ma jeszcze aktywnego handlera/)

  const manual = structuredClone(ERSTE_TEMPLATE)
  manual.id = 'manual-official-pdf'
  manual.fillMethod = { kind: 'pdf_manual' }
  manual.coverage = {
    status: 'complete',
    inScopeTargetCount: 0,
    mappedTargetCount: 0,
    manualUserActionCount: 1,
  }
  manual.bindings = []
  const manualSummary = summarizeTemplate(manual)
  assert.equal(manualSummary.fillMode, 'manual')
  assert.equal(manualSummary.ready, true)
  assert.equal(manualSummary.status, 'gotowy')
  assert.equal(firstUnsupportedTemplateFillMethod([manual]), undefined)
})

test('fill preflight identifies deferred methods before field and bundle validation', () => {
  const supported = structuredClone(PKO_TEMPLATE)
  const webForm = structuredClone(ERSTE_TEMPLATE)
  webForm.id = 'future-web-form'
  webForm.fillMethod = { kind: 'web_form' }

  assert.equal(firstUnsupportedTemplateFillMethod([supported]), undefined)
  const webFormIssue = firstUnsupportedTemplateFillMethod([supported, webForm])
  assert.deepEqual(webFormIssue, {
    templateId: 'future-web-form',
    fillMethod: { kind: 'web_form' },
  })
  assert.ok(webFormIssue)
  assert.deepEqual(unsupportedTemplateFillMethodHttpDetails(webFormIssue), {
    statusCode: 501,
    statusMessage: 'Formularz internetowy nie jest jeszcze obsługiwany w eksporcie PDF/ZIP.',
    data: {
      fillMethod: 'web_form',
      templateId: 'future-web-form',
    },
  })

  webForm.fillMethod = { kind: 'api' }
  assert.deepEqual(firstUnsupportedTemplateFillMethod([webForm]), {
    templateId: 'future-web-form',
    fillMethod: { kind: 'api' },
  })
})
