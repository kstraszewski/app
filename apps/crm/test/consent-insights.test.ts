import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aggregateConsentInsightStatistics,
  buildConsentInsightAuditEvents,
  buildConsentSubjectInsights,
  consentInsightCounts,
  filterConsentSubjectInsights,
  maskConsentInsightPhone,
  type ConsentInsightCaptureEventRow,
  type ConsentInsightCaptureRequestRow,
  type ConsentInsightClientRow,
  type ConsentInsightDecisionRow,
  type ConsentInsightPersonRow,
  type ConsentInsightVersionRow,
} from '../server/utils/consent-insights.ts'

const versionOne: ConsentInsightVersionRow = {
  id: 'version-1',
  definition_id: 'definition-1',
  version: 1,
  display_title: 'Marketing SMS',
  channel: 'sms',
}

const versionTwo: ConsentInsightVersionRow = {
  ...versionOne,
  id: 'version-2',
  version: 2,
}

const clients: ConsentInsightClientRow[] = [
  {
    id: 'client-1',
    display_name: 'Żuraw i Wspólnicy',
    status_code: 'active',
    primary_phone: '+48500100200',
    primary_email: 'biuro@example.test',
  },
  {
    id: 'client-2',
    display_name: 'Drugi klient',
    status_code: 'lead',
    primary_phone: null,
    primary_email: null,
  },
]

const people: ConsentInsightPersonRow[] = [
  {
    id: 'person-a',
    client_id: 'client-1',
    display_name: 'Anna Żuraw',
    role: 'primary',
    phone: '+48500100101',
    email: 'anna@example.test',
  },
  {
    id: 'person-b',
    client_id: 'client-1',
    display_name: 'Jan Kowalski',
    role: 'contact',
    phone: '+48500100202',
    email: 'jan@example.test',
  },
  {
    id: 'person-c',
    client_id: 'client-2',
    display_name: 'Ola Nowak',
    role: 'primary',
    phone: null,
    email: null,
  },
]

const decisions: ConsentInsightDecisionRow[] = [
  {
    id: 'decision-old',
    client_id: 'client-1',
    subject_person_id: 'person-a',
    definition_version_id: 'version-1',
    decision: 'granted',
    source: 'client_card',
    contact_value: '+48500100101',
    evidence_reference: null,
    metadata: { method: 'staff_recorded' },
    recorded_by_user_id: 'user-1',
    occurred_at: '2026-07-01T10:00:00.000Z',
  },
  {
    id: 'decision-new',
    client_id: 'client-1',
    subject_person_id: 'person-a',
    definition_version_id: 'version-2',
    decision: 'withdrawn',
    source: 'sms_verification',
    contact_value: '+48500100101',
    evidence_reference: 'evidence://decision-new',
    metadata: { method: 'sms_otp', otp_hash: 'must-never-leak' },
    recorded_by_user_id: null,
    occurred_at: '2026-07-03T10:00:00.000Z',
  },
]

const requests: ConsentInsightCaptureRequestRow[] = [
  {
    id: 'request-a',
    client_id: 'client-1',
    subject_person_id: 'person-a',
    definition_version_id: 'version-2',
    requested_by_user_id: 'user-1',
    phone_e164: '+48500100101',
    intent: 'withdraw',
    status: 'withdrawn',
    provider: 'test-provider',
    delivery_status: 'delivered',
    sent_at: '2026-07-02T09:01:00.000Z',
    delivered_at: '2026-07-02T09:02:00.000Z',
    opened_at: '2026-07-02T09:03:00.000Z',
    verified_at: '2026-07-03T09:59:00.000Z',
    decided_at: '2026-07-03T10:00:00.000Z',
    cancelled_at: null,
    decision: 'withdrawn',
    evidence_reference: 'evidence://request-a',
    metadata: { otp_hash: 'must-never-leak' },
    expires_at: '2099-07-03T10:10:00.000Z',
    created_at: '2026-07-02T09:00:00.000Z',
    updated_at: '2026-07-03T10:00:00.000Z',
  },
  {
    id: 'request-b',
    client_id: 'client-1',
    subject_person_id: 'person-b',
    definition_version_id: 'version-2',
    requested_by_user_id: 'user-1',
    phone_e164: '+48500100202',
    intent: 'collect',
    status: 'delivered',
    provider: 'test-provider',
    delivery_status: 'delivered',
    sent_at: '2026-07-04T11:01:00.000Z',
    delivered_at: '2026-07-04T11:02:00.000Z',
    opened_at: null,
    verified_at: null,
    decided_at: null,
    cancelled_at: null,
    decision: null,
    evidence_reference: null,
    metadata: {},
    expires_at: '2099-07-04T11:10:00.000Z',
    created_at: '2026-07-04T11:00:00.000Z',
    updated_at: '2026-07-04T11:02:00.000Z',
  },
]

describe('consent subject insights', () => {
  it('keeps a separate latest state for every subject, even on the same client', () => {
    const records = buildConsentSubjectInsights({
      people,
      clients,
      decisions,
      requests,
      versions: [versionOne, versionTwo],
    })
    const bySubject = new Map(records.map(record => [record.item.subject.id, record.item]))

    assert.equal(records.length, 3)
    assert.equal(bySubject.get('person-a')?.status, 'withdrawn')
    assert.equal(bySubject.get('person-a')?.version?.number, 2)
    assert.equal(bySubject.get('person-a')?.source, 'sms_verification')
    assert.equal(bySubject.get('person-a')?.method, 'sms_otp')
    assert.equal(bySubject.get('person-a')?.evidencePresent, true)
    assert.equal(bySubject.get('person-b')?.status, 'pending')
    assert.equal(bySubject.get('person-b')?.lastRequest?.status, 'delivered')
    assert.equal(bySubject.get('person-c')?.status, 'no_decision')
    assert.deepEqual(consentInsightCounts(records), {
      total: 3,
      granted: 0,
      declined: 0,
      withdrawn: 1,
      pending: 1,
      noDecision: 1,
    })
  })

  it('masks phone numbers and searches without depending on Polish diacritics', () => {
    assert.equal(maskConsentInsightPhone('+48 500 100 202'), '••• ••• 202')
    assert.equal(maskConsentInsightPhone(null), null)

    const records = buildConsentSubjectInsights({
      people,
      clients,
      decisions,
      requests,
      versions: [versionOne, versionTwo],
    })
    const filtered = filterConsentSubjectInsights(records, {
      search: 'zuraw',
      status: 'withdrawn',
      dateFrom: null,
      dateTo: null,
    })
    assert.deepEqual(filtered.map(record => record.item.subject.id), ['person-a'])
  })

  it('does not keep an unopened request pending after its expiry time', () => {
    const records = buildConsentSubjectInsights({
      people: [people[1]!],
      clients: [clients[0]!],
      decisions: [],
      requests: [{
        ...requests[1]!,
        status: 'sent',
        expires_at: '2026-07-04T11:10:00.000Z',
      }],
      versions: [versionTwo],
      now: new Date('2026-07-04T11:11:00.000Z'),
    })

    assert.equal(records[0]?.item.status, 'no_decision')
    assert.equal(records[0]?.item.lastRequest?.status, 'expired')
    assert.equal(records[0]?.item.lastRequest?.expiresAt, '2026-07-04T11:10:00.000Z')
  })
})

describe('consent statistics and audit events', () => {
  it('aggregates current state, daily decisions and the SMS funnel', () => {
    const records = buildConsentSubjectInsights({
      people,
      clients,
      decisions,
      requests,
      versions: [versionOne, versionTwo],
    })
    const statistics = aggregateConsentInsightStatistics({
      records,
      decisions,
      requests,
      range: { dateFrom: null, dateTo: null },
    })

    assert.equal(statistics.totals.uniqueSubjects, 3)
    assert.equal(statistics.totals.decided, 1)
    assert.equal(statistics.totals.grantRate, 0)
    assert.deepEqual(statistics.smsFunnel, {
      requested: 2,
      sent: 2,
      delivered: 2,
      verified: 1,
      decided: 1,
    })
    assert.deepEqual(statistics.sources, [
      { source: 'client_card', count: 1 },
      { source: 'sms_verification', count: 1 },
    ])
    assert.deepEqual(statistics.dailyTrend, [
      { date: '2026-07-01', granted: 1, declined: 0, withdrawn: 0, requests: 0 },
      { date: '2026-07-02', granted: 0, declined: 0, withdrawn: 0, requests: 1 },
      { date: '2026-07-03', granted: 0, declined: 0, withdrawn: 1, requests: 0 },
      { date: '2026-07-04', granted: 0, declined: 0, withdrawn: 0, requests: 1 },
    ])
  })

  it('merges the audit timeline without returning OTP hashes or evidence references', () => {
    const captureEvents: ConsentInsightCaptureEventRow[] = [
      {
        id: 'capture-event-b',
        request_id: 'request-b',
        event_type: 'sms_delivered',
        actor_user_id: null,
        metadata: { otp_hash: 'must-never-leak', provider_payload: { secret: true } },
        occurred_at: '2026-07-04T11:02:00.000Z',
      },
      {
        id: 'capture-event-a-sent',
        request_id: 'request-a',
        event_type: 'sms_sent',
        actor_user_id: 'user-1',
        metadata: null,
        occurred_at: '2026-07-02T09:01:00.000Z',
      },
      {
        id: 'capture-event-a-decision',
        request_id: 'request-a',
        event_type: 'decision_recorded',
        actor_user_id: null,
        metadata: null,
        occurred_at: '2026-07-03T10:00:00.000Z',
      },
    ]
    const events = buildConsentInsightAuditEvents({
      clients,
      people,
      versions: [versionOne, versionTwo],
      decisions,
      requests,
      captureEvents,
      filters: { search: null, status: null, dateFrom: null, dateTo: null },
    })

    assert.equal(events[0]?.id, 'capture:capture-event-b')
    assert.equal(events[0]?.subject?.id, 'person-b')
    assert.equal(events[0]?.status, 'delivered')
    assert.equal(
      events.find(item => item.id === 'capture:capture-event-a-sent')?.evidencePresent,
      false,
    )
    assert.equal(
      events.find(item => item.id === 'capture:capture-event-a-decision')?.evidencePresent,
      true,
    )
    assert.equal(events.at(-1)?.id, 'decision:decision-old')
    const serialized = JSON.stringify(events)
    assert.doesNotMatch(serialized, /must-never-leak|evidence:\/\//)
    assert.doesNotMatch(serialized, /phone_e164|provider_message_id|metadata/)

    const captureOnly = buildConsentInsightAuditEvents({
      clients,
      people,
      versions: [versionOne, versionTwo],
      decisions,
      requests,
      captureEvents,
      filters: { search: null, status: 'capture', dateFrom: null, dateTo: null },
    })
    assert.equal(captureOnly.length, 3)
    assert.equal(captureOnly.every(item => item.kind === 'capture'), true)
  })
})
