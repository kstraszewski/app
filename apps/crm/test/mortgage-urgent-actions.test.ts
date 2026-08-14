import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countDeliveredRecipients,
  mortgageUrgentActionCounts,
  requiredMortgageRecipientIds,
  resolveMortgageUrgentActions,
  type MortgageUrgentActionSource,
} from '../server/utils/mortgage-urgent-actions.ts'

const now = new Date('2026-08-13T10:00:00.000Z')

function source(overrides: Partial<MortgageUrgentActionSource> = {}): MortgageUrgentActionSource {
  return {
    caseId: 'case-1',
    caseTitle: 'Zakup mieszkania',
    applicationId: 'application-1',
    bankId: 'bank-1',
    bankName: 'Bank Testowy',
    stage: 'under_review',
    decisionDueAt: null,
    decisionReceivedAt: null,
    requiredRecipientCount: 2,
    esisDeliveryCount: 2,
    decisionDeliveryCount: 0,
    earlyDecisionConsentCount: 0,
    esisArtifact: {
      id: 'esis-current',
      kind: 'esis',
      receivedAt: '2026-08-01T10:00:00.000Z',
      validUntil: '2026-09-01T10:00:00.000Z',
      decisionOutcome: null,
    },
    decisionArtifact: null,
    ...overrides,
  }
}

test('marks overdue and approaching decision deadlines only while decision is missing', () => {
  const actions = resolveMortgageUrgentActions([
    source({
      applicationId: 'overdue',
      decisionDueAt: '2026-08-12T10:00:00.000Z',
    }),
    source({
      applicationId: 'soon',
      decisionDueAt: '2026-08-18T10:00:00.000Z',
    }),
    source({
      applicationId: 'later',
      decisionDueAt: '2026-08-25T10:00:00.000Z',
    }),
    source({
      applicationId: 'received',
      decisionDueAt: '2026-08-12T10:00:00.000Z',
      decisionArtifact: {
        id: 'decision-1',
        kind: 'credit_decision',
        receivedAt: '2026-08-12T09:00:00.000Z',
        validUntil: null,
        decisionOutcome: 'negative',
      },
      decisionDeliveryCount: 2,
    }),
  ], { now, organizationSlug: 'openexpert-local' })

  assert.deepEqual(
    actions.map(action => [action.applicationId, action.kind, action.severity]),
    [
      ['overdue', 'decision_overdue', 'critical'],
      ['soon', 'decision_due_soon', 'warning'],
    ],
  )
  assert.match(actions[0]!.action.href, /application=overdue/)
  assert.match(actions[0]!.action.href, /action=upload-decision/)
})

test('requires a valid ESIS and delivery evidence for every applicant before application', () => {
  const actions = resolveMortgageUrgentActions([
    source({ applicationId: 'missing', stage: 'pre_application', esisArtifact: null, esisDeliveryCount: 0 }),
    source({
      applicationId: 'expired',
      stage: 'pre_application',
      esisArtifact: {
        id: 'esis-expired',
        kind: 'esis',
        receivedAt: '2026-07-01T10:00:00.000Z',
        validUntil: '2026-08-12T10:00:00.000Z',
        decisionOutcome: null,
      },
    }),
    source({
      applicationId: 'undelivered',
      stage: 'pre_application',
      esisArtifact: {
        id: 'esis-current',
        kind: 'esis',
        receivedAt: '2026-08-12T10:00:00.000Z',
        validUntil: '2026-08-27T10:00:00.000Z',
        decisionOutcome: null,
      },
      esisDeliveryCount: 1,
    }),
  ], { now, organizationSlug: 'openexpert-local' })

  assert.deepEqual(
    actions.map(action => [action.applicationId, action.kind, action.severity]),
    [
      ['expired', 'esis_missing', 'critical'],
      ['undelivered', 'esis_delivery_missing', 'warning'],
      ['missing', 'esis_missing', 'info'],
    ],
  )
  assert.match(actions[1]!.action.href, /action=deliver-esis/)
})

test('alerts about a stale or undelivered ESIS after submission', () => {
  const actions = resolveMortgageUrgentActions([
    source({
      applicationId: 'expired-in-review',
      stage: 'under_review',
      esisArtifact: {
        id: 'esis-expired',
        kind: 'esis',
        receivedAt: '2026-07-01T10:00:00.000Z',
        validUntil: '2026-08-12T10:00:00.000Z',
        decisionOutcome: null,
      },
    }),
    source({
      applicationId: 'decision-blocked',
      stage: 'decision_received',
      esisDeliveryCount: 1,
    }),
  ], { now, organizationSlug: 'openexpert-local' })

  assert.deepEqual(
    actions.map(action => [action.applicationId, action.kind, action.severity]),
    [
      ['expired-in-review', 'esis_missing', 'critical'],
      ['decision-blocked', 'esis_delivery_missing', 'critical'],
    ],
  )
})

test('alerts when a decision is not delivered and when a positive offer expires', () => {
  const actions = resolveMortgageUrgentActions([
    source({
      stage: 'decision_received',
      decisionReceivedAt: '2026-08-13T08:00:00.000Z',
      decisionDeliveryCount: 1,
      decisionArtifact: {
        id: 'decision-positive',
        kind: 'credit_decision',
        receivedAt: '2026-08-13T08:00:00.000Z',
        validUntil: '2026-08-15T10:00:00.000Z',
        decisionOutcome: 'positive',
      },
    }),
  ], { now, organizationSlug: 'openexpert-local' })

  assert.deepEqual(actions.map(action => action.kind), [
    'decision_received_not_delivered',
    'offer_expiring',
  ])
  assert.equal(actions[0]!.action.label, 'Przekaż decyzję')
  assert.equal(actions[1]!.daysRemaining, 2)
  assert.deepEqual(mortgageUrgentActionCounts(actions), {
    total: 2,
    critical: 1,
    warning: 1,
    info: 0,
  })
})

test('waits until the statutory date when an early decision lacks all consents', () => {
  const actions = resolveMortgageUrgentActions([
    source({
      stage: 'decision_received',
      decisionDueAt: '2026-08-18T10:00:00.000Z',
      decisionArtifact: {
        id: 'early-decision',
        kind: 'credit_decision',
        receivedAt: '2026-08-13T08:00:00.000Z',
        validUntil: null,
        decisionOutcome: 'negative',
      },
      earlyDecisionConsentCount: 1,
    }),
  ], { now, organizationSlug: 'openexpert-local' })

  const action = actions.find(item => item.kind === 'decision_received_not_delivered')
  assert.equal(action?.severity, 'warning')
  assert.equal(action?.daysRemaining, 5)
  assert.equal(action?.action.label, 'Zapisz decyzje klientów')
  assert.match(action?.action.href ?? '', /action=record-early-consent/)
})

test('ignores completed and closed applications', () => {
  const actions = resolveMortgageUrgentActions([
    source({ stage: 'completed', decisionDueAt: '2026-08-01T10:00:00.000Z' }),
    source({ applicationId: 'closed', stage: 'closed', decisionDueAt: '2026-08-01T10:00:00.000Z' }),
  ], { now, organizationSlug: 'openexpert-local' })

  assert.deepEqual(actions, [])
})

test('keeps a ready-for-contract offer visible until a contract is signed', () => {
  const actions = resolveMortgageUrgentActions([
    source({
      stage: 'ready_for_contract',
      decisionArtifact: {
        id: 'decision-ready',
        kind: 'credit_decision',
        receivedAt: '2026-08-01T10:00:00.000Z',
        validUntil: '2026-08-14T10:00:00.000Z',
        decisionOutcome: 'positive',
      },
      decisionDeliveryCount: 2,
    }),
  ], { now, organizationSlug: 'openexpert-local' })

  assert.deepEqual(actions.map(action => action.kind), ['offer_expiring'])
})

test('routes an expired positive decision to uploading its renewed version', () => {
  const actions = resolveMortgageUrgentActions([
    source({
      stage: 'ready_for_contract',
      decisionArtifact: {
        id: 'decision-expired',
        kind: 'credit_decision',
        receivedAt: '2026-07-20T10:00:00.000Z',
        validUntil: '2026-08-12T10:00:00.000Z',
        decisionOutcome: 'positive',
      },
      decisionDeliveryCount: 2,
    }),
  ], { now, organizationSlug: 'openexpert-local' })

  assert.equal(actions[0]?.action.label, 'Załącz odnowioną decyzję')
  assert.match(actions[0]?.action.href ?? '', /action=upload-decision/)
})

test('counts delivery evidence only for frozen recipients', () => {
  assert.equal(countDeliveredRecipients(
    ['client-1', 'client-2'],
    ['client-1', 'client-1', 'unrelated-client'],
  ), 1)
})

test('uses current case clients only before submit and frozen parties afterwards', () => {
  assert.deepEqual(requiredMortgageRecipientIds(
    'pre_application',
    ['current-1', 'current-2'],
    ['frozen-1'],
  ), ['current-1', 'current-2'])

  assert.deepEqual(requiredMortgageRecipientIds(
    'under_review',
    ['current-1', 'client-added-after-submit'],
    ['frozen-1', 'frozen-2', 'frozen-2'],
  ), ['frozen-1', 'frozen-2'])

  assert.deepEqual(requiredMortgageRecipientIds(
    'decision_received',
    ['current-1'],
    [],
  ), [])
})
