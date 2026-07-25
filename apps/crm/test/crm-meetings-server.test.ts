import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bookingContextWithCrmMeeting,
  createCrmMeetingContext,
  normalizeClientMeetingOffer,
  parseCrmMeetingContext,
} from '../server/utils/crm-meetings.ts'

const caseId = '11111111-1111-4111-8111-111111111111'
const offerId = '22222222-2222-4222-8222-222222222222'

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
