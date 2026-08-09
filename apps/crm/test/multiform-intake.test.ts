import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMultiformSubmissionReadinessManifest,
  createEmptyMultiformIntake,
  getMultiformApplicantIntakeProgress,
  getMultiformIntakeProgress,
  multiformIntakeBooleanOptions,
  multiformIntakeIncomeSourceOptions,
  normalizeMultiformIntake,
  resolveMultiformIntakeRequirement,
  resolveMultiformIntakeRequirementStatus,
  validateMultiformIntake,
  type MultiformIntakeAnswers,
  type MultiformIntakeRequirement,
  type MultiformSubmissionReadinessDocument,
  type MultiformSubmissionReadinessRequirement,
} from '../shared/multiform-intake.ts'

const clientIds = ['client-jan', 'client-anna']

function completeAnswers(): MultiformIntakeAnswers {
  return normalizeMultiformIntake({
    applicants: {
      'client-jan': {
        incomeSource: 'employment',
        employmentType: 'indefinite',
        incomePaidToAccount: true,
        additionalIncome: false,
        liabilities: true,
      },
      'client-anna': {
        incomeSource: 'business',
        employmentType: 'fixed',
        incomePaidToAccount: false,
        additionalIncome: true,
        liabilities: false,
      },
    },
    case: {
      loanProgram: 'standard',
      loanPurpose: 'refinance',
      preliminaryAgreement: false,
      landRegister: true,
      appraisalAvailable: false,
      trancheDisbursement: true,
    },
  }, clientIds)
}

function requirement(
  overrides: Partial<MultiformIntakeRequirement> = {},
): MultiformIntakeRequirement {
  return {
    code: 'conditional_document',
    category: 'other',
    stage: 'analysis',
    applicability: 'conditional',
    required: true,
    ownerClientId: null,
    ...overrides,
  }
}

test('exports UI-ready labels and typed options', () => {
  assert.deepEqual(
    multiformIntakeIncomeSourceOptions.map(option => option.value),
    ['employment', 'business', 'civil_contract', 'retirement', 'rental', 'foreign', 'other'],
  )
  assert.deepEqual(multiformIntakeBooleanOptions, [
    { label: 'Tak', value: true },
    { label: 'Nie', value: false },
  ])
})

test('strictly normalizes untrusted JSON to current client IDs and exact values', () => {
  const normalized = normalizeMultiformIntake({
    applicants: {
      'client-jan': {
        incomeSource: 'employment',
        employmentType: 'fixed',
        incomePaidToAccount: 'true',
        additionalIncome: false,
        liabilities: 1,
        injected: 'discard me',
      },
      'client-anna': {
        incomeSource: 'business',
        employmentType: 'indefinite',
        incomePaidToAccount: true,
        additionalIncome: true,
        liabilities: false,
      },
      outsider: {
        incomeSource: 'foreign',
      },
    },
    case: {
      loanPurpose: 'purchase_secondary',
      preliminaryAgreement: true,
      landRegister: 'yes',
      appraisalAvailable: false,
      trancheDisbursement: false,
      injected: 'discard me',
    },
  }, [...clientIds, 'client-jan'])

  assert.equal(Object.getPrototypeOf(normalized.applicants), null)
  assert.deepEqual(Object.keys(normalized.applicants), clientIds)
  assert.deepEqual(normalized.applicants['client-jan'], {
    incomeSource: 'employment',
    employmentType: 'fixed',
    incomePaidToAccount: null,
    additionalIncome: false,
    liabilities: null,
  })
  assert.deepEqual(normalized.applicants['client-anna'], {
    incomeSource: 'business',
    employmentType: null,
    incomePaidToAccount: true,
    additionalIncome: true,
    liabilities: false,
  })
  assert.deepEqual(normalized.case, {
    loanProgram: null,
    rkmGuarantee: null,
    loanPurpose: 'purchase_secondary',
    preliminaryAgreement: true,
    landRegister: null,
    appraisalAvailable: false,
    trancheDisbursement: false,
  })
})

test('creates empty answers and safely supports an own __proto__ client ID', () => {
  const empty = createEmptyMultiformIntake(['__proto__'])
  assert.equal(Object.getPrototypeOf(empty.applicants), null)
  assert.deepEqual(empty.applicants.__proto__, {
    incomeSource: null,
    employmentType: null,
    incomePaidToAccount: null,
    additionalIncome: null,
    liabilities: null,
  })
})

test('counts false answers as complete and employment type only for employment', () => {
  const answers = completeAnswers()
  assert.deepEqual(getMultiformApplicantIntakeProgress(answers, 'client-jan'), {
    completed: 5,
    total: 5,
    percentage: 100,
    complete: true,
  })
  assert.deepEqual(getMultiformApplicantIntakeProgress(answers, 'client-anna'), {
    completed: 4,
    total: 4,
    percentage: 100,
    complete: true,
  })
  const progress = getMultiformIntakeProgress(answers, clientIds)
  assert.deepEqual({
    ...progress,
    applicants: { ...progress.applicants },
  }, {
    completed: 15,
    total: 15,
    percentage: 100,
    complete: true,
    applicants: {
      'client-jan': { completed: 5, total: 5, percentage: 100, complete: true },
      'client-anna': { completed: 4, total: 4, percentage: 100, complete: true },
    },
    case: { completed: 6, total: 6, percentage: 100, complete: true },
  })
})

test('validation reports missing answers with the responsible client IDs', () => {
  const validation = validateMultiformIntake({
    applicants: {
      'client-jan': {
        incomeSource: 'employment',
        employmentType: null,
        incomePaidToAccount: false,
        additionalIncome: false,
        liabilities: false,
      },
      'client-anna': {
        incomeSource: 'unsupported',
      },
    },
    case: {
      loanProgram: 'standard',
      loanPurpose: 'purchase_primary',
      preliminaryAgreement: false,
      landRegister: true,
      appraisalAvailable: false,
      trancheDisbursement: null,
    },
  }, clientIds)

  assert.equal(validation.valid, false)
  assert.equal(validation.progress.completed, 9)
  assert.equal(validation.progress.total, 15)
  assert.deepEqual(
    validation.issues.map(issue => [issue.clientId, issue.field]),
    [
      ['client-jan', 'employmentType'],
      ['client-anna', 'incomeSource'],
      ['client-anna', 'incomePaidToAccount'],
      ['client-anna', 'additionalIncome'],
      ['client-anna', 'liabilities'],
      [null, 'trancheDisbursement'],
    ],
  )
})

test('keeps always requirements required and optional requirements optional', () => {
  const answers = createEmptyMultiformIntake(clientIds)
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    applicability: 'always',
    required: false,
  }), answers), 'required')
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    applicability: 'optional',
  }), answers), 'optional')
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    applicability: 'conditional',
    required: false,
  }), answers), 'optional')
})

test('resolves income evidence and account statements by requirement owner', () => {
  const answers = completeAnswers()
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    code: 'income_evidence',
    applicability: 'case_requested',
    ownerClientId: 'client-jan',
  }), answers), 'required')
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    code: 'income_evidence',
    applicability: 'case_requested',
    ownerClientId: 'missing-client',
  }), answers), 'unknown')
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    code: 'bank_account_statements',
    applicability: 'case_requested',
    ownerClientId: 'client-jan',
  }), answers), 'required')
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    code: 'bank_account_statements',
    applicability: 'case_requested',
    ownerClientId: 'client-anna',
  }), answers), 'not_applicable')
})

test('resolves preliminary agreement, land register and appraisal answers', () => {
  const answers = completeAnswers()
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    code: 'transaction.preliminary_agreement',
    category: 'transaction',
  }), answers), 'not_applicable')
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    code: 'land_register_verification',
    category: 'property_legal',
  }), answers), 'required')
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    code: 'valuation.appraisal_report',
    category: 'valuation',
  }), answers), 'not_applicable')
})

test('resolves refinance and tranche documents while distinguishing later stages', () => {
  const answers = completeAnswers()
  assert.deepEqual(resolveMultiformIntakeRequirement(requirement({
    code: 'refinance.creditor_release_consent',
    category: 'refinance_discharge',
    stage: 'agreement',
  }), answers), {
    status: 'required',
    stage: 'agreement',
    phase: 'later',
  })
  assert.deepEqual(resolveMultiformIntakeRequirement(requirement({
    code: 'disbursement.tranche_request',
    category: 'disbursement',
    stage: 'tranche',
  }), answers), {
    status: 'required',
    stage: 'tranche',
    phase: 'later',
  })
  assert.deepEqual(resolveMultiformIntakeRequirement(requirement(), answers), {
    status: 'unknown',
    stage: 'analysis',
    phase: 'analysis',
  })
})

test('resolves Erste investor and RKM documents from Multiwniosek intake answers', () => {
  const primaryMarket = completeAnswers()
  primaryMarket.case.loanPurpose = 'purchase_primary'
  primaryMarket.case.loanProgram = 'standard'
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    code: 'erste_investor_statement',
    applicability: 'case_requested',
  }), primaryMarket), 'required')
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    code: 'erste_rkm_credit_and_family_repayment_conditions',
  }), primaryMarket), 'not_applicable')

  const rkm = completeAnswers()
  rkm.case.loanProgram = 'rkm'
  rkm.case.rkmGuarantee = true
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    code: 'erste_rkm_guarantee_conditions',
  }), rkm), 'required')
  assert.equal(resolveMultiformIntakeRequirementStatus(requirement({
    code: 'erste_rkm_credit_and_family_repayment_conditions',
  }), rkm), 'required')
})

function readinessRequirement(
  overrides: Partial<MultiformSubmissionReadinessRequirement> = {},
): MultiformSubmissionReadinessRequirement {
  return {
    key: 'application-1:identity_document:client-jan',
    code: 'identity_document',
    label: 'Dokument tożsamości',
    category: 'identity',
    itemKind: 'client_document',
    stage: 'analysis',
    applicability: 'always',
    required: true,
    ownerClientId: 'client-jan',
    applicationIds: ['application-1'],
    documentIds: ['document-1'],
    fulfillment: 'attached',
    ...overrides,
  }
}

function readinessDocument(
  overrides: Partial<MultiformSubmissionReadinessDocument> = {},
): MultiformSubmissionReadinessDocument {
  return {
    id: 'document-1',
    status_code: 'verified',
    readiness: {
      issuedAt: '2026-08-01T10:00:00.000Z',
      validUntil: null,
      deliveryEvidenceAt: null,
    },
    ...overrides,
  }
}

test('marks a verified and current working set ready while leaving bank employee action non-blocking', () => {
  const manifest = buildMultiformSubmissionReadinessManifest({
    applicationId: 'application-1',
    requirements: [
      readinessRequirement({
        readiness: {
          requiresExpertVerification: true,
          maxAgeDays: 30,
        },
      }),
      readinessRequirement({
        key: 'application-1:credit_application:case',
        code: 'credit_application',
        label: 'Wniosek kredytowy',
        itemKind: 'bank_document',
        ownerClientId: null,
        templateId: 'erste-mortgage',
        documentIds: [],
        fulfillment: 'generated',
        readiness: { signatures: ['bank_employee'] },
      }),
    ],
    documents: [readinessDocument()],
    selectedDocumentIds: ['document-1'],
    intakeAnswers: completeAnswers(),
    now: '2026-08-09T12:00:00.000Z',
  })

  assert.equal(manifest.version, '1.0')
  assert.equal(manifest.status, 'ready_for_submission')
  assert.equal(manifest.readyForSubmission, true)
  assert.equal(manifest.blockingIssues.length, 0)
  assert.deepEqual(manifest.issues.map(issue => [issue.code, issue.blocking]), [
    ['bank_action_required', false],
  ])
})

test('keeps a downloadable package in working state until checks, delivery and applicant signatures are done', () => {
  const manifest = buildMultiformSubmissionReadinessManifest({
    applicationId: 'application-1',
    requirements: [
      readinessRequirement({
        key: 'application-1:credit_application:case',
        code: 'credit_application',
        label: 'Wniosek kredytowy',
        itemKind: 'bank_document',
        ownerClientId: null,
        templateId: 'erste-mortgage',
        documentIds: [],
        fulfillment: 'generated',
        readiness: { signatures: ['each_applicant'] },
      }),
      readinessRequirement({
        key: 'application-1:bik_check:case',
        code: 'bik_check',
        label: 'Weryfikacja zewnętrzna',
        itemKind: 'external_check',
        ownerClientId: null,
        documentIds: [],
        fulfillment: 'manual',
      }),
      readinessRequirement({
        key: 'application-1:client_information:case',
        code: 'client_information',
        label: 'Karta informacyjna klienta',
        itemKind: 'bank_document',
        ownerClientId: null,
        templateId: 'erste-client-information',
        documentIds: [],
        fulfillment: 'generated',
        readiness: { deliveryEvidenceRequired: true },
      }),
    ],
    documents: [],
    selectedDocumentIds: [],
    intakeAnswers: completeAnswers(),
  })

  assert.equal(manifest.status, 'working_package')
  assert.equal(manifest.readyForSubmission, false)
  assert.deepEqual(new Set(manifest.blockingIssues.map(issue => issue.code)), new Set([
    'signature_required',
    'external_check_required',
    'delivery_evidence_required',
  ]))
})

test('reports missing, unverified, expired and undated evidence instead of a false complete status', () => {
  const manifest = buildMultiformSubmissionReadinessManifest({
    applicationId: 'application-1',
    requirements: [
      readinessRequirement({
        documentIds: [],
        fulfillment: 'missing',
      }),
      readinessRequirement({
        key: 'application-1:income_evidence:client-jan',
        code: 'income_evidence',
        label: 'Dokument dochodowy',
        documentIds: ['document-2'],
        readiness: { requiresExpertVerification: true, maxAgeDays: 30 },
      }),
      readinessRequirement({
        key: 'application-1:bank_statements:client-jan',
        code: 'bank_statements',
        label: 'Wyciąg z rachunku',
        documentIds: ['document-3'],
        readiness: { maxAgeDays: 30 },
      }),
    ],
    documents: [
      readinessDocument({
        id: 'document-2',
        status_code: 'received',
        readiness: { issuedAt: '2026-06-01T00:00:00.000Z' },
      }),
      readinessDocument({
        id: 'document-3',
        readiness: {},
      }),
    ],
    selectedDocumentIds: ['document-2', 'document-3'],
    intakeAnswers: completeAnswers(),
    now: '2026-08-09T12:00:00.000Z',
  })

  assert.equal(manifest.status, 'incomplete')
  assert.deepEqual(new Set(manifest.blockingIssues.map(issue => issue.code)), new Set([
    'missing_attachment',
    'expert_verification_required',
    'document_expired',
    'document_validity_unknown',
  ]))
})

test('does not block submission with an intake requirement resolved as not applicable', () => {
  const manifest = buildMultiformSubmissionReadinessManifest({
    applicationId: 'application-1',
    requirements: [readinessRequirement({
      key: 'application-1:appraisal_report:case',
      code: 'appraisal_report',
      label: 'Operat szacunkowy',
      category: 'valuation',
      applicability: 'conditional',
      ownerClientId: null,
      documentIds: [],
      fulfillment: 'conditional',
    })],
    documents: [],
    selectedDocumentIds: [],
    intakeAnswers: completeAnswers(),
  })

  assert.equal(manifest.readyForSubmission, true)
  assert.equal(manifest.issues.length, 0)
})
