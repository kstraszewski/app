import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildPortalCaseAction,
  buildPortalDashboardNextStep,
  isSafePortalDocumentSummary,
  selectNextPortalAppointment,
} from '../server/utils/portal-dashboard.ts'
import {
  selectPreferredPortalGrantScope,
  type PortalGrantScopeLike,
} from '../shared/utils/portal-grant-scope.ts'

const now = Date.parse('2026-08-01T10:00:00.000Z')

describe('client portal case action', () => {
  it('prioritizes required documents over an unfinished Multiwniosek', () => {
    assert.equal(buildPortalCaseAction({
      caseId: 'case-1',
      statusCode: 'analiza',
      progressPercent: 30,
      missingDocumentCount: 2,
      multiformEnabled: true,
      multiformEligible: true,
      multiformCompletedAt: null,
    }).kind, 'upload_document')
  })

  it('offers Multiwniosek only to an eligible person while it is unfinished', () => {
    assert.equal(buildPortalCaseAction({
      caseId: 'case-1',
      missingDocumentCount: 0,
      multiformEnabled: true,
      multiformEligible: true,
      multiformCompletedAt: null,
    }).kind, 'complete_multiform')
    assert.equal(buildPortalCaseAction({
      caseId: 'case-1',
      missingDocumentCount: 0,
      multiformEnabled: true,
      multiformEligible: false,
      multiformCompletedAt: null,
    }).kind, 'wait')
  })

  it('never asks for work on a completed case', () => {
    assert.equal(buildPortalCaseAction({
      caseId: 'case-1',
      statusCode: 'zakonczona',
      progressPercent: 100,
      missingDocumentCount: 3,
      multiformEnabled: true,
      multiformEligible: true,
      multiformCompletedAt: null,
    }).kind, 'wait')
  })

  it('treats the canonical Polish archive status as terminal', () => {
    const action = buildPortalCaseAction({
      caseId: 'case-1',
      statusCode: 'archiwum',
      progressPercent: 40,
      missingDocumentCount: 3,
      multiformEnabled: true,
      multiformEligible: true,
      multiformCompletedAt: null,
    })
    assert.equal(action.kind, 'wait')
    assert.match(action.title, /zakończona/)
  })

  it('treats closedAt as terminal even before status catches up', () => {
    assert.equal(buildPortalCaseAction({
      caseId: 'case-1',
      statusCode: 'analiza',
      closedAt: '2026-08-01T10:00:00.000Z',
      progressPercent: 40,
      missingDocumentCount: 3,
      multiformEnabled: true,
      multiformEligible: true,
      multiformCompletedAt: null,
    }).kind, 'wait')
  })
})

describe('client portal document summary privacy', () => {
  const primaryScope = {
    organizationId: 'org-1',
    caseId: 'case-1',
    clientId: 'client-1',
    clientPersonId: 'person-1',
    clientPersonRole: 'primary',
  }

  it('shows own uploads but hides uploads made by another person', () => {
    const document = {
      organizationId: 'org-1',
      caseId: 'case-1',
      clientId: 'client-1',
      uploadedByClientPersonId: 'person-1',
      statusCode: 'received',
    }
    assert.equal(isSafePortalDocumentSummary(document, primaryScope), true)
    assert.equal(isSafePortalDocumentSummary({
      ...document,
      uploadedByClientPersonId: 'person-2',
    }, primaryScope), false)
  })

  it('shows unassigned missing requirements only to the primary person', () => {
    const requirement = {
      organizationId: 'org-1',
      caseId: 'case-1',
      clientId: null,
      uploadedByClientPersonId: null,
      statusCode: 'missing',
    }
    assert.equal(isSafePortalDocumentSummary(requirement, primaryScope), true)
    assert.equal(isSafePortalDocumentSummary(requirement, {
      ...primaryScope,
      clientPersonRole: 'co_borrower',
    }), false)
    assert.equal(isSafePortalDocumentSummary({
      ...requirement,
      statusCode: 'received',
    }, primaryScope), false)
  })

  it('rejects summaries outside the exact granted tenant and case', () => {
    assert.equal(isSafePortalDocumentSummary({
      organizationId: 'org-2',
      caseId: 'case-1',
      clientId: 'client-1',
      uploadedByClientPersonId: 'person-1',
      statusCode: 'received',
    }, primaryScope), false)
  })
})

describe('client portal dashboard next step', () => {
  it('selects the nearest non-cancelled future appointment', () => {
    const appointments = [
      { id: 'past', status: 'confirmed', startsAt: '2026-07-31T09:00:00Z', endsAt: '2026-07-31T10:00:00Z' },
      { id: 'later', status: 'confirmed', startsAt: '2026-08-05T09:00:00Z', endsAt: '2026-08-05T10:00:00Z' },
      { id: 'next', status: 'confirmed', startsAt: '2026-08-02T09:00:00Z', endsAt: '2026-08-02T10:00:00Z' },
      { id: 'cancelled', status: 'cancelled', startsAt: '2026-08-01T12:00:00Z', endsAt: '2026-08-01T13:00:00Z' },
    ]
    assert.equal(selectNextPortalAppointment(appointments, now)?.id, 'next')
  })

  it('prioritizes document work over Multiwniosek across shared cases', () => {
    const nextStep = buildPortalDashboardNextStep([
      {
        id: 'form-case',
        action: {
          kind: 'complete_multiform',
          title: 'Formularz',
          description: 'Formularz',
          label: 'Otwórz',
          to: '/cases/form-case/multiform',
        },
      },
      {
        id: 'document-case',
        action: {
          kind: 'upload_document',
          title: 'Dokumenty',
          description: 'Dokumenty',
          label: 'Dodaj',
          to: '/cases/document-case',
        },
      },
    ], null, now)
    assert.equal(nextStep.kind, 'upload_document')
    assert.equal(nextStep.caseId, 'document-case')
  })

  it('uses appointment and unshared-case fallbacks deterministically', () => {
    const appointment = {
      id: 'appointment-1',
      status: 'confirmed',
      startsAt: '2026-08-02T09:00:00Z',
      endsAt: '2026-08-02T10:00:00Z',
    }
    const preparation = buildPortalDashboardNextStep([], appointment, now)
    assert.equal(preparation.kind, 'prepare_appointment')
    assert.equal(preparation.label, 'Przygotuj się do spotkania')
    assert.equal(preparation.to, '/prepare')
    assert.match(
      buildPortalDashboardNextStep([], null, now).title,
      /udostępnienie sprawy/,
    )
  })

  it('prepares for an explicitly first meeting even when its case already exists', () => {
    const nextStep = buildPortalDashboardNextStep([{
      id: 'first-meeting-case',
      action: {
        kind: 'wait',
        title: 'Sprawa jest po stronie eksperta',
        description: 'Spotkanie jest umówione',
        label: null,
        to: null,
      },
    }], {
      id: 'first-meeting',
      status: 'confirmed',
      startsAt: '2026-08-03T09:00:00Z',
      endsAt: '2026-08-03T10:00:00Z',
      relationship: 'first',
    }, now)

    assert.equal(nextStep.kind, 'prepare_appointment')
    assert.match(nextStep.title, /pierwszego spotkania/)
  })

  it('keeps required client work ahead of first-meeting preparation', () => {
    const nextStep = buildPortalDashboardNextStep([{
      id: 'document-case',
      action: {
        kind: 'upload_document',
        title: 'Dokumenty',
        description: 'Brakuje dokumentu',
        label: 'Dodaj',
        to: '/cases/document-case',
      },
    }], {
      id: 'first-meeting',
      status: 'confirmed',
      startsAt: '2026-08-03T09:00:00Z',
      endsAt: '2026-08-03T10:00:00Z',
      relationship: 'first',
    }, now)

    assert.equal(nextStep.kind, 'upload_document')
    assert.equal(nextStep.caseId, 'document-case')
  })

  it('does not call an explicit follow-up the first meeting', () => {
    const nextStep = buildPortalDashboardNextStep([], {
      id: 'follow-up',
      status: 'confirmed',
      startsAt: '2026-08-03T09:00:00Z',
      endsAt: '2026-08-03T10:00:00Z',
      relationship: 'follow-up',
    }, now)

    assert.equal(nextStep.kind, 'wait')
    assert.doesNotMatch(nextStep.title, /pierwszego spotkania/)
  })

  it('prefers an active waiting case over a more recent completed case', () => {
    const nextStep = buildPortalDashboardNextStep([
      {
        id: 'completed-case',
        action: {
          kind: 'wait',
          title: 'Sprawa została zakończona',
          description: 'Zakończona',
          label: null,
          to: null,
        },
      },
      {
        id: 'active-case',
        action: {
          kind: 'wait',
          title: 'Sprawa jest po stronie eksperta',
          description: 'Analizujemy sprawę',
          label: null,
          to: null,
        },
      },
    ], null, now)
    assert.equal(nextStep.caseId, 'active-case')
    assert.match(nextStep.title, /stronie eksperta/)
  })
})

describe('client portal multi-person grant selection', () => {
  function scope(personId: string, role: string): PortalGrantScopeLike {
    return {
      link: {
        organizationId: 'org-1',
        clientId: `client-${personId}`,
        clientPersonId: personId,
        person: { role },
      },
    }
  }

  it('prefers the primary person independently of query order', () => {
    const primary = scope('person-b', 'primary')
    const coBorrower = scope('person-a', 'co_borrower')
    assert.equal(
      selectPreferredPortalGrantScope([coBorrower, primary])?.link.clientPersonId,
      'person-b',
    )
    assert.equal(
      selectPreferredPortalGrantScope([primary, coBorrower])?.link.clientPersonId,
      'person-b',
    )
  })

  it('uses clientPersonId as a stable tie-break between primary people', () => {
    assert.equal(
      selectPreferredPortalGrantScope([
        scope('person-b', 'primary'),
        scope('person-a', 'primary'),
      ])?.link.clientPersonId,
      'person-a',
    )
  })
})
