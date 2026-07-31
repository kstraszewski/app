import assert from 'node:assert/strict'
import test from 'node:test'
import {
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
    completed: 14,
    total: 14,
    percentage: 100,
    complete: true,
    applicants: {
      'client-jan': { completed: 5, total: 5, percentage: 100, complete: true },
      'client-anna': { completed: 4, total: 4, percentage: 100, complete: true },
    },
    case: { completed: 5, total: 5, percentage: 100, complete: true },
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
      loanPurpose: 'purchase_primary',
      preliminaryAgreement: false,
      landRegister: true,
      appraisalAvailable: false,
      trancheDisbursement: null,
    },
  }, clientIds)

  assert.equal(validation.valid, false)
  assert.equal(validation.progress.completed, 8)
  assert.equal(validation.progress.total, 14)
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
