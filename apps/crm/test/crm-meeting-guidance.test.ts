import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  CrmMeetingMortgageOffer,
  CrmMeetingTranscriptSegment,
} from '../app/types/crm-meeting.ts'
import { deriveConservativeOfferGuidance } from '../app/utils/crm-meeting-guidance.ts'

const offers: CrmMeetingMortgageOffer[] = [
  {
    id: 'bank-a',
    bankName: 'Bank A',
    productName: 'Oferta A',
    firstInstallment: 3200,
    firstMonthlyOutflow: 3400,
    costFirstFiveYears: 215000,
    totalCost: 720000,
    representativeAprPct: 7.8,
    unknownFieldCount: 0,
  },
  {
    id: 'bank-b',
    bankName: 'Bank B',
    productName: 'Oferta B',
    firstInstallment: 3300,
    firstMonthlyOutflow: 3320,
    costFirstFiveYears: 205000,
    totalCost: 750000,
    representativeAprPct: 7.6,
    unknownFieldCount: 0,
  },
]

function segment(
  text: string,
  overrides: Partial<CrmMeetingTranscriptSegment> = {},
): CrmMeetingTranscriptSegment {
  return {
    id: 'segment-1',
    speaker: 'client',
    text,
    source: 'sample',
    isFinal: true,
    observedAt: '2026-07-25T10:00:00.000Z',
    ...overrides,
  }
}

describe('deriveConservativeOfferGuidance', () => {
  it('uses only an explicit client cost priority', () => {
    const result = deriveConservativeOfferGuidance(
      [segment('Najważniejszy jest koszt w pierwszych 5 latach.')],
      offers,
    )

    assert.equal(result.status, 'suggestion')
    assert.equal(result.metric, 'five-year-cost')
    assert.equal(result.suggestedOfferId, 'bank-b')
    assert.deepEqual(result.matchedSegmentIds, ['segment-1'])
  })

  it('does not treat expert or interim text as a client signal', () => {
    const result = deriveConservativeOfferGuidance([
      segment('Rata ma być jak najniższa.', { speaker: 'expert' }),
      segment('Najważniejszy jest koszt całkowity.', { isFinal: false }),
    ], offers)

    assert.equal(result.status, 'insufficient-signal')
    assert.equal(result.suggestedOfferId, null)
  })

  it('does not rank a single offer', () => {
    const result = deriveConservativeOfferGuidance(
      [segment('Miesięczny budżet jest kluczowy.')],
      offers.slice(0, 1),
    )

    assert.equal(result.status, 'insufficient-offers')
    assert.equal(result.suggestedOfferId, null)
  })
})
