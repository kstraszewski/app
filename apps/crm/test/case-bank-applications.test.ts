import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isMortgageApplicationStatus,
  mortgageApplicationStatuses,
  mortgageSubmissionStatusPatch,
} from '../server/utils/case-bank-application-status.ts'

test('accepts exactly the CRM mortgage application status vocabulary', () => {
  for (const status of mortgageApplicationStatuses) {
    assert.equal(isMortgageApplicationStatus(status), true)
  }
  assert.equal(isMortgageApplicationStatus('submitted'), false)
  assert.equal(isMortgageApplicationStatus(' zaakceptowane '), false)
  assert.equal(isMortgageApplicationStatus(null), false)
})

test('marks the first outbound status as submitted and clears an old decision', () => {
  assert.deepEqual(
    mortgageSubmissionStatusPatch(
      { submitted_at: null, decision_at: '2026-07-20T10:00:00.000Z' },
      'w_analizie',
      '2026-07-21T10:00:00.000Z',
    ),
    {
      status_code: 'w_analizie',
      submitted_at: '2026-07-21T10:00:00.000Z',
      decision_at: null,
    },
  )
})

test('preserves the original submission time when recording a decision', () => {
  assert.deepEqual(
    mortgageSubmissionStatusPatch(
      { submitted_at: '2026-07-19T10:00:00.000Z', decision_at: null },
      'zaakceptowane',
      '2026-07-21T10:00:00.000Z',
    ),
    {
      status_code: 'zaakceptowane',
      submitted_at: '2026-07-19T10:00:00.000Z',
      decision_at: '2026-07-21T10:00:00.000Z',
    },
  )
})

test('returning to draft clears lifecycle timestamps', () => {
  assert.deepEqual(
    mortgageSubmissionStatusPatch(
      {
        submitted_at: '2026-07-19T10:00:00.000Z',
        decision_at: '2026-07-20T10:00:00.000Z',
      },
      'draft',
      '2026-07-21T10:00:00.000Z',
    ),
    {
      status_code: 'draft',
      submitted_at: null,
      decision_at: null,
    },
  )
})
