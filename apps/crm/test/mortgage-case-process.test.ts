import assert from 'node:assert/strict'
import test from 'node:test'
import type { CaseBankApplication, CaseDetail, SavedCaseOffer } from '../app/types/cases.ts'
import {
  resolveCaseMortgageNextAction,
  resolveMortgageApplicationNextAction,
  resolveMortgageProcessSteps,
} from '../app/utils/mortgage-case-process.ts'

function application(overrides: Partial<CaseBankApplication> = {}): CaseBankApplication {
  return {
    id: 'application-1',
    submission_id: 'submission-1',
    case_id: 'case-1',
    case_item_id: 'item-1',
    offer_id: 'offer-1',
    bank_id: 'bank-1',
    property_id: null,
    slot: 1,
    status_code: 'draft',
    external_reference: null,
    submitted_at: null,
    decision_at: null,
    notes: null,
    metadata: {},
    snapshot_status: 'complete',
    snapshot_schema_version: '1',
    calculator_version: '1',
    comparison_baseline_offer_id: null,
    scenario_snapshot: {},
    calculation_snapshot: {},
    purchase_price_amount: null,
    appraisal_value_amount: null,
    net_loan_amount: null,
    gross_loan_amount: null,
    financed_costs: null,
    ltv_debt_basis: null,
    collateral_value_basis: null,
    ltv_debt_amount: null,
    collateral_value_amount: null,
    ltv_pct: null,
    first_installment: null,
    first_monthly_outflow: null,
    cost_first_five_years: null,
    total_cost: null,
    calculated_at: null,
    created_by_user_id: null,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

function offer(id = 'offer-1', bankName = 'Bank Testowy'): SavedCaseOffer {
  return {
    id,
    case_id: 'case-1',
    bank_id: `bank-${id}`,
    mortgage_product_id: null,
    mortgage_product_version_id: null,
    offer_type: 'mortgage',
    bank_name: bankName,
    product_name: 'Kredyt hipoteczny',
    version_key: null,
    calculator_version: '1',
    currency: 'PLN',
    loan_amount: 500_000,
    first_installment: null,
    first_monthly_outflow: null,
    cost_first_five_years: null,
    total_cost: null,
    representative_apr_pct: null,
    scenario_snapshot: {},
    catalog_snapshot: {},
    saved_at: '2026-08-01T10:00:00.000Z',
  }
}

function caseDetail(applications: CaseBankApplication[]): CaseDetail {
  return {
    id: 'case-1',
    organization_id: 'organization-1',
    owner_user_id: null,
    title: 'Zakup mieszkania',
    description: null,
    status_code: 'aktywna',
    priority: 'normal',
    progress_percent: 40,
    opened_at: '2026-08-01T10:00:00.000Z',
    closed_at: null,
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    owner: null,
    selected_offer_id: null,
    selected_property_id: null,
    bank_applications: applications,
    contract_application_id: null,
    contract_signed_at: null,
    clients: [{ id: 'client-1', display_name: 'Anna Kowalska' }],
    offers: [offer('offer-1', 'Bank A'), offer('offer-2', 'Bank B')],
    documents: [],
    items: [],
    properties: [],
    open_tasks: [],
    recent_activities: [],
  }
}

test('legacy draft safely requires ESIS instead of assuming compliance', () => {
  const action = resolveMortgageApplicationNextAction(application(), [offer()])
  assert.equal(action.kind, 'upload-esis')
  assert.equal(action.blocking, true)
  assert.equal(action.responsibility, 'expert')
})

test('legacy submitted application never renders ESIS as confirmed', () => {
  const steps = resolveMortgageProcessSteps(application({
    status_code: 'w_analizie',
    submitted_at: '2026-08-03T10:00:00.000Z',
  }))
  assert.equal(steps.find(step => step.key === 'esis')?.status, 'unknown')
  assert.equal(steps.find(step => step.key === 'application')?.status, 'complete')
})

test('does not reopen compliance work for a withdrawn legacy application', () => {
  const action = resolveMortgageApplicationNextAction(application({ status_code: 'wycofane' }), [offer()])
  assert.equal(action.kind, 'wait-bank')
  assert.equal(action.severity, 'waiting')
})

test('uses explicit artifact state and process timestamps for the bank path', () => {
  const steps = resolveMortgageProcessSteps(application({
    status_code: 'w_analizie',
    mortgage_process: {
      stage: 'under_review',
      application_submitted_at: '2026-08-01T10:00:00.000Z',
      completeness_confirmed_at: '2026-08-02T10:00:00.000Z',
      decision_due_at: '2026-08-23T10:00:00.000Z',
      steps: { esis: { status: 'complete', completed_at: '2026-07-31T10:00:00.000Z' } },
    },
  }))
  assert.deepEqual(
    steps.map(step => [step.key, step.status]),
    [
      ['esis', 'complete'],
      ['application', 'complete'],
      ['completeness', 'complete'],
      ['decision', 'current'],
      ['agreement', 'pending'],
    ],
  )
})

test('prioritizes a critical undelivered decision over normal ESIS work', () => {
  const esisApplication = application()
  const decisionApplication = application({
    id: 'application-2',
    offer_id: 'offer-2',
    slot: 2,
    status_code: 'zaakceptowane',
    mortgage_process: {
      stage: 'decision_received',
      decision_received_at: '2026-08-12T10:00:00.000Z',
      decision_delivered_at: null,
    },
  })
  const action = resolveCaseMortgageNextAction(
    caseDetail([esisApplication, decisionApplication]),
    new Date('2026-08-13T10:00:00.000Z'),
  )
  assert.equal(action.application_id, 'application-2')
  assert.equal(action.kind, 'deliver-decision')
  assert.equal(action.severity, 'critical')
})

test('keeps an undelivered decision as the current step', () => {
  const steps = resolveMortgageProcessSteps(application({
    status_code: 'zaakceptowane',
    decision_at: '2026-08-12T10:00:00.000Z',
    mortgage_process: {
      stage: 'decision_received',
      decision_received_at: '2026-08-12T10:00:00.000Z',
      decision_delivered_at: null,
      steps: {
        decision: {
          status: 'pending',
          action_kind: 'deliver-decision',
          artifact_id: 'decision-1',
        },
      },
    },
  }))

  assert.equal(steps.find(step => step.key === 'decision')?.status, 'current')
  assert.equal(steps.find(step => step.key === 'agreement')?.status, 'pending')
})

test('preserves an explicit action and derives its overdue state', () => {
  const action = resolveMortgageApplicationNextAction(application({
    next_action: {
      id: 'action-1',
      kind: 'upload-decision',
      title: 'Załącz decyzję',
      responsibility: 'expert',
      severity: 'warning',
      due_at: '2026-08-12T10:00:00.000Z',
    },
  }), [offer()], new Date('2026-08-13T10:00:00.000Z'))
  assert.equal(action.id, 'action-1')
  assert.equal(action.application_id, 'application-1')
  assert.equal(action.bank_name, 'Bank Testowy')
  assert.equal(action.overdue, true)
})

test('routes a validated positive application to final contract selection', () => {
  const ready = application({
    status_code: 'zaakceptowane',
    mortgage_process: {
      stage: 'ready_for_contract',
      decision_received_at: '2026-08-12T10:00:00.000Z',
      decision_delivered_at: '2026-08-12T11:00:00.000Z',
      decision_outcome: 'positive',
      steps: {
        agreement: { status: 'complete' },
      },
    },
  })

  const action = resolveMortgageApplicationNextAction(ready, [offer()])
  const agreement = resolveMortgageProcessSteps(ready).find(step => step.key === 'agreement')

  assert.equal(action.kind, 'review-agreement')
  assert.equal(action.title, 'Wybierz umowę Bank Testowy')
  assert.equal(agreement?.status, 'current')
  assert.equal(agreement?.detail, 'Gotowa do wyboru')
})

test('keeps a terminal process terminal even when a stale explicit action is present', () => {
  const action = resolveMortgageApplicationNextAction(application({
    status_code: 'zaakceptowane',
    mortgage_process: { stage: 'completed' },
    next_action: {
      kind: 'review-agreement',
      title: 'Nieaktualna akcja',
      responsibility: 'expert',
      severity: 'normal',
    },
  }), [offer()])

  assert.equal(action.kind, 'wait-bank')
  assert.equal(action.severity, 'waiting')
})
