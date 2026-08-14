import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMortgageApplicationReadModels,
  type BuildMortgageApplicationReadModelsInput,
} from '../server/utils/mortgage-application-read-model.ts'

const now = new Date('2026-08-13T10:00:00.000Z')

function build(overrides: Partial<BuildMortgageApplicationReadModelsInput> = {}) {
  return buildMortgageApplicationReadModels({
    applications: [{ id: 'application-1', bankName: 'Bank Testowy' }],
    processes: [{
      application_id: 'application-1',
      stage: 'pre_application',
      revision: 0,
      application_submitted_at: null,
      completeness_confirmed_at: null,
      decision_due_at: null,
      decision_received_at: null,
      decision_outcome: null,
    }],
    artifacts: [],
    parties: [],
    deliveries: [],
    currentCaseClientIds: ['client-1', 'client-2'],
    now,
    ...overrides,
  }).get('application-1')!
}

test('asks for a current ESIS before allowing an application to be submitted', () => {
  const model = build()

  assert.equal(model.next_action.kind, 'upload-esis')
  assert.equal(model.mortgage_process.steps.esis.status, 'missing')
})

test('uses actual delivery evidence before exposing the submit command', () => {
  const artifacts = [{
    id: 'esis-1',
    application_id: 'application-1',
    kind: 'esis',
    version: 1,
    valid_until: '2026-09-01T21:59:59.000Z',
  }]
  const oneDelivery = build({
    artifacts,
    deliveries: [{ artifact_id: 'esis-1', recipient_client_id: 'client-1', delivered_at: '2026-08-13T09:00:00.000Z' }],
  })
  assert.equal(oneDelivery.next_action.kind, 'deliver-esis')
  assert.equal(oneDelivery.mortgage_process.steps.esis.detail, 'Przekazano 1/2')

  const complete = build({
    artifacts,
    deliveries: [
      { artifact_id: 'esis-1', recipient_client_id: 'client-1', delivered_at: '2026-08-13T09:00:00.000Z' },
      { artifact_id: 'esis-1', recipient_client_id: 'client-2', delivered_at: '2026-08-13T09:01:00.000Z' },
    ],
  })
  assert.equal(complete.next_action.kind, 'submit-application')
  assert.equal(complete.mortgage_process.steps.esis.status, 'complete')
})

test('turns an overdue decision deadline into a concrete upload action', () => {
  const model = build({
    processes: [{
      application_id: 'application-1',
      stage: 'under_review',
      revision: 3,
      application_submitted_at: '2026-07-01T10:00:00.000Z',
      completeness_confirmed_at: '2026-07-02T10:00:00.000Z',
      decision_due_at: '2026-08-12T21:59:59.000Z',
      deadline_policy_version: 'pl-art14-v1',
      decision_received_at: null,
      decision_outcome: null,
    }],
    parties: [
      { application_id: 'application-1', client_id: 'client-1' },
      { application_id: 'application-1', client_id: 'client-2' },
    ],
    artifacts: [{
      id: 'esis-current',
      application_id: 'application-1',
      kind: 'esis',
      version: 1,
      valid_until: '2026-09-01T21:59:59.000Z',
    }],
    deliveries: [
      { artifact_id: 'esis-current', recipient_client_id: 'client-1', delivered_at: '2026-08-01T09:00:00.000Z' },
      { artifact_id: 'esis-current', recipient_client_id: 'client-2', delivered_at: '2026-08-01T09:01:00.000Z' },
    ],
  })

  assert.equal(model.next_action.kind, 'upload-decision')
  assert.equal(model.next_action.overdue, true)
  assert.equal(model.mortgage_process.steps.decision.status, 'missing')
})

test('requires a refreshed ESIS when it expires during bank review', () => {
  const model = build({
    processes: [{
      application_id: 'application-1',
      stage: 'under_review',
      revision: 4,
      application_submitted_at: '2026-07-01T10:00:00.000Z',
      completeness_confirmed_at: '2026-07-02T10:00:00.000Z',
      decision_due_at: '2026-08-20T21:59:59.000Z',
      decision_received_at: null,
      decision_outcome: null,
    }],
    parties: [{ application_id: 'application-1', client_id: 'client-1' }],
    artifacts: [{
      id: 'esis-expired',
      application_id: 'application-1',
      kind: 'esis',
      version: 1,
      valid_until: '2026-08-12T21:59:59.000Z',
    }],
    deliveries: [{ artifact_id: 'esis-expired', recipient_client_id: 'client-1', delivered_at: '2026-08-01T09:00:00.000Z' }],
  })

  assert.equal(model.next_action.kind, 'upload-esis')
  assert.equal(model.next_action.severity, 'critical')
  assert.equal(model.mortgage_process.steps.esis.status, 'expired')
})

test('digitizes a historical decision without reopening submission or completeness', () => {
  const model = build({
    processes: [{
      application_id: 'application-1',
      stage: 'decision_received',
      revision: 0,
      application_submitted_at: null,
      completeness_confirmed_at: null,
      decision_due_at: null,
      decision_received_at: '2026-08-10T10:00:00.000Z',
      decision_outcome: 'negative',
    }],
    parties: [{ application_id: 'application-1', client_id: 'client-1' }],
    artifacts: [{
      id: 'esis-current',
      application_id: 'application-1',
      kind: 'esis',
      version: 1,
      valid_until: '2026-09-01T21:59:59.000Z',
    }],
    deliveries: [{ artifact_id: 'esis-current', recipient_client_id: 'client-1', delivered_at: '2026-08-01T09:00:00.000Z' }],
  })

  assert.equal(model.next_action.kind, 'upload-decision')
  assert.equal(model.mortgage_process.steps.application.status, 'complete')
})

test('resumes review after requested information has been completed', () => {
  const model = build({
    processes: [{
      application_id: 'application-1',
      stage: 'additional_information_requested',
      revision: 5,
      application_submitted_at: '2026-07-01T10:00:00.000Z',
      completeness_confirmed_at: '2026-07-02T10:00:00.000Z',
      additional_information_requested_at: '2026-08-10T10:00:00.000Z',
      decision_due_at: '2026-08-20T21:59:59.000Z',
      decision_received_at: null,
      decision_outcome: null,
    }],
    parties: [{ application_id: 'application-1', client_id: 'client-1' }],
  })

  assert.equal(model.next_action.kind, 'resume-review')
})

test('waits for the statutory date when an attached early decision lacks consents', () => {
  const model = build({
    processes: [{
      application_id: 'application-1',
      stage: 'decision_received',
      revision: 5,
      application_submitted_at: '2026-07-01T10:00:00.000Z',
      completeness_confirmed_at: '2026-08-01T10:00:00.000Z',
      decision_due_at: '2026-08-20T21:59:59.000Z',
      decision_received_at: '2026-08-13T08:00:00.000Z',
      decision_outcome: 'negative',
    }],
    parties: [
      { application_id: 'application-1', client_id: 'client-1' },
      { application_id: 'application-1', client_id: 'client-2' },
    ],
    artifacts: [
      {
        id: 'esis-current',
        application_id: 'application-1',
        kind: 'esis',
        version: 1,
        valid_until: '2026-09-01T21:59:59.000Z',
      },
      {
        id: 'decision-early',
        application_id: 'application-1',
        kind: 'credit_decision',
        version: 1,
        decision_outcome: 'negative',
        received_at: '2026-08-13T08:00:00.000Z',
      },
    ],
    deliveries: [
      { artifact_id: 'esis-current', recipient_client_id: 'client-1', delivered_at: '2026-08-01T09:00:00.000Z' },
      { artifact_id: 'esis-current', recipient_client_id: 'client-2', delivered_at: '2026-08-01T09:01:00.000Z' },
    ],
    consents: [{
      id: 'consent-1',
      application_id: 'application-1',
      client_id: 'client-1',
      decision: 'granted',
      captured_at: '2026-08-13T09:00:00.000Z',
      created_at: '2026-08-13T09:00:00.000Z',
    }],
  })

  assert.equal(model.next_action.kind, 'wait-bank')
  assert.equal(model.mortgage_process.early_decision_consent_granted_count, 1)
  assert.equal(model.mortgage_process.early_decision_consent_complete, false)
})

test('uses frozen applicants after submit and requires delivery of the agreement', () => {
  const model = build({
    processes: [{
      application_id: 'application-1',
      stage: 'decision_delivered',
      revision: 7,
      application_submitted_at: '2026-07-01T10:00:00.000Z',
      completeness_confirmed_at: '2026-07-02T10:00:00.000Z',
      decision_due_at: '2026-08-12T21:59:59.000Z',
      decision_received_at: '2026-08-10T10:00:00.000Z',
      decision_outcome: 'positive',
    }],
    currentCaseClientIds: ['client-added-later'],
    parties: [
      { application_id: 'application-1', client_id: 'client-1' },
      { application_id: 'application-1', client_id: 'client-2' },
    ],
    artifacts: [
      {
        id: 'decision-1',
        application_id: 'application-1',
        kind: 'credit_decision',
        version: 1,
        decision_outcome: 'positive',
        received_at: '2026-08-10T10:00:00.000Z',
        valid_until: '2026-08-28T21:59:59.000Z',
      },
      {
        id: 'agreement-1',
        application_id: 'application-1',
        kind: 'draft_credit_agreement',
        version: 1,
      },
    ],
    deliveries: [
      { artifact_id: 'decision-1', recipient_client_id: 'client-1', delivered_at: '2026-08-10T11:00:00.000Z' },
      { artifact_id: 'decision-1', recipient_client_id: 'client-2', delivered_at: '2026-08-10T11:01:00.000Z' },
      { artifact_id: 'agreement-1', recipient_client_id: 'client-1', delivered_at: '2026-08-10T11:02:00.000Z' },
      { artifact_id: 'agreement-1', recipient_client_id: 'client-added-later', delivered_at: '2026-08-10T11:03:00.000Z' },
    ],
  })

  assert.equal(model.next_action.kind, 'deliver-agreement')
  assert.equal(model.mortgage_process.steps.agreement.detail, 'Przekazano 1/2')
})

test('routes a validated application that is ready for contract to final selection', () => {
  const model = build({
    processes: [{
      application_id: 'application-1',
      stage: 'ready_for_contract',
      revision: 9,
      application_submitted_at: '2026-07-01T10:00:00.000Z',
      completeness_confirmed_at: '2026-07-02T10:00:00.000Z',
      decision_due_at: '2026-08-12T21:59:59.000Z',
      decision_received_at: '2026-08-10T10:00:00.000Z',
      decision_outcome: 'positive',
    }],
    parties: [{ application_id: 'application-1', client_id: 'client-1' }],
    artifacts: [
      {
        id: 'decision-current',
        application_id: 'application-1',
        kind: 'credit_decision',
        version: 1,
        decision_outcome: 'positive',
        received_at: '2026-08-10T10:00:00.000Z',
        valid_until: '2026-08-28T21:59:59.000Z',
      },
      {
        id: 'agreement-current',
        application_id: 'application-1',
        kind: 'draft_credit_agreement',
        version: 1,
        received_at: '2026-08-10T10:00:00.000Z',
      },
    ],
    deliveries: [
      { artifact_id: 'decision-current', recipient_client_id: 'client-1', delivered_at: '2026-08-10T11:00:00.000Z' },
      { artifact_id: 'agreement-current', recipient_client_id: 'client-1', delivered_at: '2026-08-10T11:01:00.000Z' },
    ],
  })

  assert.equal(model.next_action.kind, 'review-agreement')
})

test('keeps a signed completed application terminal', () => {
  const model = build({
    processes: [{
      application_id: 'application-1',
      stage: 'completed',
      revision: 10,
      application_submitted_at: '2026-07-01T10:00:00.000Z',
      completeness_confirmed_at: '2026-07-02T10:00:00.000Z',
      decision_due_at: '2026-08-12T21:59:59.000Z',
      decision_received_at: '2026-08-10T10:00:00.000Z',
      decision_outcome: 'positive',
    }],
  })

  assert.equal(model.next_action.kind, 'wait-bank')
})

test('requires a renewed offer if it expires while waiting for final selection', () => {
  const model = build({
    processes: [{
      application_id: 'application-1',
      stage: 'ready_for_contract',
      revision: 9,
      application_submitted_at: '2026-07-01T10:00:00.000Z',
      completeness_confirmed_at: '2026-07-02T10:00:00.000Z',
      decision_due_at: '2026-08-12T21:59:59.000Z',
      decision_received_at: '2026-08-10T10:00:00.000Z',
      decision_outcome: 'positive',
    }],
    parties: [{ application_id: 'application-1', client_id: 'client-1' }],
    artifacts: [{
      id: 'decision-expired',
      application_id: 'application-1',
      kind: 'credit_decision',
      version: 2,
      decision_outcome: 'positive',
      received_at: '2026-07-20T10:00:00.000Z',
      valid_until: '2026-08-12T21:59:59.000Z',
    }],
    deliveries: [{
      artifact_id: 'decision-expired',
      recipient_client_id: 'client-1',
      delivered_at: '2026-07-20T11:00:00.000Z',
    }],
  })

  assert.equal(model.next_action.kind, 'upload-decision')
  assert.equal(model.next_action.severity, 'critical')
})
