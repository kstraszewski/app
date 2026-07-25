import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createMortgageComparisonArtifact,
  mortgageProcessArtifact,
} from '../app/utils/crm-meeting-artifacts.ts'

test('process artifact exposes a complete, uniquely keyed client journey', () => {
  assert.equal(mortgageProcessArtifact.steps.length, 5)
  assert.equal(
    new Set(mortgageProcessArtifact.steps.map(step => step.id)).size,
    mortgageProcessArtifact.steps.length,
  )
  assert.ok(mortgageProcessArtifact.steps.every(step => step.clientPrompt.length > 0))
})

test('mortgage comparison keeps only selected CRM fields and caps the artifact at three offers', () => {
  const artifact = createMortgageComparisonArtifact({
    id: 'comparison-1',
    title: 'Wybrane oferty',
    description: 'Porównanie',
    sourceLabel: 'CRM',
    scenario: {
      propertyValue: 600_000,
      loanAmount: 480_000,
      years: 25,
      ltvPct: 80,
    },
    offers: Array.from({ length: 4 }, (_, index) => ({
      id: `offer-${index + 1}`,
      bankName: `Bank ${index + 1}`,
      productName: `Oferta ${index + 1}`,
      firstInstallment: 3_000 + index,
      firstMonthlyOutflow: 3_100 + index,
      costFirstFiveYears: 200_000 + index,
      totalCost: 900_000 + index,
      representativeAprPct: 7.5 + index,
      unknownFieldCount: index,
    })),
  }, '2026-07-25T12:00:00.000Z')

  assert.equal(artifact.kind, 'mortgage-comparison')
  assert.equal(artifact.offers.length, 3)
  assert.equal(artifact.offers[0]?.bankName, 'Bank 1')
  assert.equal(artifact.scenario.loanAmount, 480_000)
  assert.equal(artifact.publishedAt, '2026-07-25T12:00:00.000Z')
})

test('mortgage comparison rejects an empty selection', () => {
  assert.throws(() => createMortgageComparisonArtifact({
    id: 'empty',
    title: 'Brak',
    description: 'Brak',
    sourceLabel: 'CRM',
    scenario: {
      propertyValue: 600_000,
      loanAmount: 480_000,
      years: 25,
      ltvPct: 80,
    },
    offers: [],
  }), /requires at least one selected offer/)
})
