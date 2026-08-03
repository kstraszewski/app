import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bookingContextWithCrmMeeting,
  createCrmMeetingContext,
  normalizeClientMeetingOffer,
  normalizeCrmMeetingPreparation,
  parseExpertMeetingPreviewOrganizationSlug,
  parseCrmMeetingContext,
} from '../server/utils/crm-meetings.ts'

const caseId = '11111111-1111-4111-8111-111111111111'
const offerId = '22222222-2222-4222-8222-222222222222'
const appointmentId = '33333333-3333-4333-8333-333333333333'

test('accepts expert preview only with a valid organization slug', () => {
  assert.equal(
    parseExpertMeetingPreviewOrganizationSlug({
      preview: 'expert',
      organizationSlug: 'openexpert-local',
    }),
    'openexpert-local',
  )
  assert.equal(
    parseExpertMeetingPreviewOrganizationSlug({
      preview: 'client',
      organizationSlug: 'openexpert-local',
    }),
    null,
  )
  assert.throws(
    () => parseExpertMeetingPreviewOrganizationSlug({
      preview: 'expert',
      organizationSlug: '../other',
    }),
    (error: any) => error?.statusCode === 400,
  )
})

test('creates and parses the versioned meeting context without losing other booking data', () => {
  const context = createCrmMeetingContext(caseId, 'first')
  const bookingContext = bookingContextWithCrmMeeting(
    { source: 'crm' },
    context,
  )

  assert.equal(bookingContext.source, 'crm')
  assert.deepEqual(parseCrmMeetingContext(bookingContext), context)
})

test('accepts only internally consistent published material state', () => {
  const context = createCrmMeetingContext(caseId, 'follow-up')
  const published = {
    ...context,
    status: 'live' as const,
    startedAt: '2026-07-25T10:00:00.000Z',
    shared: {
      kind: 'mortgage-offers' as const,
      processStepId: null,
      offerIds: [offerId],
      activeOfferId: offerId,
      updatedAt: '2026-07-25T10:05:00.000Z',
    },
  }

  assert.deepEqual(
    parseCrmMeetingContext({ crmMeeting: published }),
    published,
  )
  assert.equal(parseCrmMeetingContext({
    crmMeeting: {
      ...published,
      shared: {
        ...published.shared,
        activeOfferId: '33333333-3333-4333-8333-333333333333',
      },
    },
  }), null)
})

test('normalizes only the safe offer fields sent to a client', () => {
  assert.deepEqual(normalizeClientMeetingOffer({
    id: offerId,
    bank_name: 'Bank Testowy',
    product_name: 'Kredyt stały',
    first_installment: '3100.50',
    first_monthly_outflow: 3250,
    cost_first_five_years: 190000,
    total_cost: 510000,
    representative_apr_pct: null,
    calculation_snapshot: {
      status: 'partial',
      issues: [{ kind: 'incomplete', code: 'unknown_cost' }],
    },
    scenario_snapshot: { sensitive: 'not returned' },
  }), {
    id: offerId,
    bankName: 'Bank Testowy',
    productName: 'Kredyt stały',
    calculationStatus: 'partial',
    firstInstallment: 3100.5,
    firstMonthlyOutflow: 3250,
    costFirstFiveYears: 190000,
    totalCost: 510000,
    representativeAprPct: null,
  })
})

test('treats a missing or unexpected calculation status as incomplete', () => {
  const normalized = normalizeClientMeetingOffer({
    id: offerId,
    bank_name: 'Bank Testowy',
    product_name: 'Kredyt stały',
    first_installment: 3100,
    first_monthly_outflow: 3250,
    cost_first_five_years: 190000,
    total_cost: 510000,
    representative_apr_pct: 6.4,
    calculation_snapshot: {},
  })

  assert.equal(normalized.calculationStatus, 'partial')
})

test('normalizes a versioned client preparation saved for the meeting case', () => {
  const row = {
    case_id: caseId,
    appointment_id: appointmentId,
    answers: {
      version: 2,
      activeStep: 3,
      profile: {
        goal: 'purchase',
        stage: 'selected',
        incomeSources: ['employment', 'rental'],
        coBorrower: 'yes',
        propertyBudget: '600k_800k',
        ownFunds: '100k_200k',
        loanAmount: '500k_700k',
        loanTerm: '25',
        monthlyNetIncome: '15k_20k',
        monthlyObligations: 'up_to_1k',
        comfortablePayment: '3500_4500',
      },
      readConceptIds: ['fixed-rate'],
      checkedItemIds: ['id-card'],
      selectedQuestionIds: ['early-repayment'],
    },
    revision: 7,
    completed_at: null,
    updated_at: '2026-08-03T12:00:00.000Z',
  }

  assert.deepEqual(normalizeCrmMeetingPreparation(row), {
    caseId,
    appointmentId,
    answers: row.answers,
    revision: 7,
    completedAt: null,
    updatedAt: '2026-08-03T12:00:00.000Z',
  })
  assert.equal(normalizeCrmMeetingPreparation({
    ...row,
    answers: {
      ...row.answers,
      profile: { ...row.answers.profile, goal: 'unsupported' },
    },
  }), null)
})
