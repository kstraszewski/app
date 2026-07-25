import type {
  CrmMeetingMortgageComparisonArtifact,
  CrmMeetingMortgageComparisonInput,
  CrmMeetingMortgageOffer,
  CrmMeetingMortgageScenario,
  CrmMeetingProcessArtifact,
} from '../types/crm-meeting.ts'

export const mortgageProcessArtifact: CrmMeetingProcessArtifact = {
  id: 'mortgage-process',
  kind: 'mortgage-process',
  title: 'Droga do kredytu hipotecznego',
  description: 'Pięć kroków, które ekspert może omówić z klientem bez pokazywania całego CRM.',
  sourceLabel: 'Materiał edukacyjny OpenExpert',
  steps: [
    {
      id: 'needs',
      label: 'Potrzeby i możliwości',
      summary: 'Ustalamy cel, budżet, wkład własny oraz bezpieczny poziom miesięcznej raty.',
      clientPrompt: 'Czy kwota raty jest ważniejsza niż najniższy koszt całkowity?',
    },
    {
      id: 'comparison',
      label: 'Porównanie ofert',
      summary: 'Liczymy te same założenia dla wybranych banków i jawnie pokazujemy koszty oraz braki danych.',
      clientPrompt: 'Które dwie lub trzy oferty warto omówić dokładniej?',
    },
    {
      id: 'documents',
      label: 'Dokumenty i wniosek',
      summary: 'Kompletujemy dokumenty klienta, nieruchomości i źródeł dochodu, a potem składamy wnioski.',
      clientPrompt: 'Które dokumenty możesz przygotować jako pierwsze?',
    },
    {
      id: 'analysis',
      label: 'Analiza banku',
      summary: 'Monitorujemy status, odpowiadamy na pytania analityka i uzupełniamy ewentualne braki.',
      clientPrompt: 'Czy chcesz otrzymywać powiadomienie przy każdej zmianie statusu?',
    },
    {
      id: 'agreement',
      label: 'Decyzja i umowa',
      summary: 'Porównujemy decyzje, sprawdzamy warunki umowy i planujemy bezpieczne uruchomienie kredytu.',
      clientPrompt: 'Które warunki decyzji wymagają dodatkowego wyjaśnienia?',
    },
  ],
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function normalizeScenario(
  scenario: CrmMeetingMortgageScenario,
): CrmMeetingMortgageScenario {
  return {
    propertyValue: Math.max(0, finiteNumber(scenario.propertyValue)),
    loanAmount: Math.max(0, finiteNumber(scenario.loanAmount)),
    years: Math.max(1, Math.round(finiteNumber(scenario.years))),
    ltvPct: Math.max(0, finiteNumber(scenario.ltvPct)),
  }
}

function normalizeOffer(offer: CrmMeetingMortgageOffer): CrmMeetingMortgageOffer {
  return {
    id: String(offer.id),
    bankName: String(offer.bankName),
    productName: String(offer.productName),
    firstInstallment: Math.max(0, finiteNumber(offer.firstInstallment)),
    firstMonthlyOutflow: Math.max(0, finiteNumber(offer.firstMonthlyOutflow)),
    costFirstFiveYears: Math.max(0, finiteNumber(offer.costFirstFiveYears)),
    totalCost: Math.max(0, finiteNumber(offer.totalCost)),
    representativeAprPct: offer.representativeAprPct == null
      ? null
      : Math.max(0, finiteNumber(offer.representativeAprPct)),
    unknownFieldCount: Math.max(0, Math.round(finiteNumber(offer.unknownFieldCount))),
  }
}

export function createMortgageComparisonArtifact(
  input: CrmMeetingMortgageComparisonInput,
  publishedAt = new Date().toISOString(),
): CrmMeetingMortgageComparisonArtifact {
  const offers = input.offers.slice(0, 3).map(normalizeOffer)
  if (!offers.length) {
    throw new Error('Mortgage comparison requires at least one selected offer.')
  }

  return {
    id: String(input.id),
    kind: 'mortgage-comparison',
    title: String(input.title),
    description: String(input.description),
    sourceLabel: String(input.sourceLabel),
    publishedAt,
    scenario: normalizeScenario(input.scenario),
    offers,
  }
}
