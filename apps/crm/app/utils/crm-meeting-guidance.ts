import type {
  CrmMeetingGuidanceMetric,
  CrmMeetingMortgageOffer,
  CrmMeetingOfferGuidance,
  CrmMeetingTranscriptSegment,
} from '../types/crm-meeting.ts'

interface GuidanceRule {
  metric: CrmMeetingGuidanceMetric
  metricLabel: string
  keywords: string[]
  value: (offer: CrmMeetingMortgageOffer) => number | null
}

const guidanceRules: GuidanceRule[] = [
  {
    metric: 'five-year-cost',
    metricLabel: 'koszt w pierwszych 5 latach',
    keywords: ['5 lat', 'pieciu lat', 'pierwszych lat', 'koszt pieciu'],
    value: offer => offer.costFirstFiveYears,
  },
  {
    metric: 'total-cost',
    metricLabel: 'koszt całkowity',
    keywords: ['koszt calkowity', 'laczny koszt', 'caly okres'],
    value: offer => offer.totalCost,
  },
  {
    metric: 'monthly-outflow',
    metricLabel: 'pierwszy miesięczny wydatek',
    keywords: ['rata', 'miesiecz', 'budzet', 'co miesiac'],
    value: offer => offer.firstMonthlyOutflow,
  },
  {
    metric: 'representative-apr',
    metricLabel: 'RRSO reprezentatywne',
    keywords: ['rrso'],
    value: offer => offer.representativeAprPct,
  },
]

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pl-PL')
}

function insufficient(
  status: CrmMeetingOfferGuidance['status'],
  reason: string,
): CrmMeetingOfferGuidance {
  return {
    status,
    source: 'deterministic-rules',
    suggestedOfferId: null,
    metric: null,
    metricLabel: null,
    reason,
    matchedSegmentIds: [],
  }
}

/**
 * Conservative, deterministic bridge for a future transcript adapter.
 *
 * The caller may eventually pass final `lk.transcription` segments here.
 * This function deliberately does not infer eligibility or suitability: it
 * only identifies an explicitly named cost priority and finds the lowest
 * known value among offers already selected by the expert.
 */
export function deriveConservativeOfferGuidance(
  segments: CrmMeetingTranscriptSegment[],
  offers: CrmMeetingMortgageOffer[],
): CrmMeetingOfferGuidance {
  if (offers.length < 2) {
    return insufficient(
      'insufficient-offers',
      'Dodaj co najmniej dwie obliczone oferty, aby porównać wskazany koszt.',
    )
  }

  const clientSegments = segments
    .filter(segment => segment.speaker === 'client' && segment.isFinal)
    .map(segment => ({ ...segment, normalizedText: normalizeText(segment.text) }))

  const matchingRule = guidanceRules.find(rule => (
    clientSegments.some(segment => (
      rule.keywords.some(keyword => segment.normalizedText.includes(keyword))
    ))
  ))

  if (!matchingRule) {
    return insufficient(
      'insufficient-signal',
      'W przykładowych notatkach klient nie wskazał jeszcze jednoznacznego priorytetu kosztowego.',
    )
  }

  const rankedOffers = offers
    .map(offer => ({ offer, value: matchingRule.value(offer) }))
    .filter((candidate): candidate is { offer: CrmMeetingMortgageOffer, value: number } => (
      candidate.value !== null && Number.isFinite(candidate.value)
    ))
    .sort((left, right) => left.value - right.value)

  if (rankedOffers.length < 2) {
    return insufficient(
      'insufficient-offers',
      `Za mało kompletnych danych, aby porównać ${matchingRule.metricLabel}.`,
    )
  }

  const best = rankedOffers[0]!
  const matchedSegmentIds = clientSegments
    .filter(segment => (
      matchingRule.keywords.some(keyword => segment.normalizedText.includes(keyword))
    ))
    .map(segment => segment.id)

  return {
    status: 'suggestion',
    source: 'deterministic-rules',
    suggestedOfferId: best.offer.id,
    metric: matchingRule.metric,
    metricLabel: matchingRule.metricLabel,
    reason: `${best.offer.bankName} ma najniższy znany parametr „${matchingRule.metricLabel}” wśród ofert wybranych przez eksperta.`,
    matchedSegmentIds,
  }
}
