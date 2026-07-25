import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canRespondToDelegation,
  canUpdateDelegatedTaskStatus,
  expectedDelegationStatus,
  parseDelegatedTaskInput,
  parseDelegatedTaskStatus,
  parseTaskDelegationResponse,
  taskDelegationFingerprint,
} from '../server/utils/task-delegation.ts'

const delegatorUserId = '11111111-1111-4111-8111-111111111111'
const assigneeUserId = '22222222-2222-4222-8222-222222222222'
const caseId = '33333333-3333-4333-8333-333333333333'
const organizationId = '44444444-4444-4444-8444-444444444444'
const idempotencyKey = '55555555-5555-4555-8555-555555555555'
const facilityId = '66666666-6666-4666-8666-666666666666'
const serviceId = '77777777-7777-4777-8777-777777777777'
const clientPersonId = '88888888-8888-4888-8888-888888888888'

describe('parseDelegatedTaskInput', () => {
  it('normalizes a retry-safe delegated task request', () => {
    assert.deepEqual(parseDelegatedTaskInput({
      title: '  Zweryfikuj dokumenty nieruchomości  ',
      description: '  Sprawdź księgę wieczystą. ',
      assignee_user_id: assigneeUserId,
      case_item_id: null,
      due_at: '2026-07-30T12:00:00+02:00',
      priority: 'high',
      data_access_scope: ['documents', 'case_summary', 'documents'],
      idempotency_key: idempotencyKey,
    }), {
      title: 'Zweryfikuj dokumenty nieruchomości',
      description: 'Sprawdź księgę wieczystą.',
      assigneeUserId,
      caseItemId: null,
      dueAt: '2026-07-30T10:00:00.000Z',
      priority: 'high',
      dataAccessScope: ['case_summary', 'documents'],
      idempotencyKey,
      appointment: null,
    })
  })

  it('uses a practical default access scope', () => {
    const input = parseDelegatedTaskInput({
      title: 'Skontaktuj się z klientem',
      assignee_user_id: assigneeUserId,
      due_at: '2026-07-30T10:00:00.000Z',
    })
    assert.deepEqual(input.dataAccessScope, ['case_summary', 'client_contact'])
    assert.equal(input.appointment, null)
    assert.match(input.idempotencyKey, /^[0-9a-f-]{36}$/)
  })

  it('rejects unknown input and access categories', () => {
    assert.throws(() => parseDelegatedTaskInput({
      title: 'Test',
      assignee_user_id: assigneeUserId,
      due_at: '2026-07-30T10:00:00.000Z',
      hidden_override: true,
    }), /Unsupported field/)

    assert.throws(() => parseDelegatedTaskInput({
      title: 'Test',
      assignee_user_id: assigneeUserId,
      due_at: '2026-07-30T10:00:00.000Z',
      data_access_scope: ['everything'],
    }), /unsupported value/)
  })

  it('normalizes an appointment and defaults due_at to its start', () => {
    const input = parseDelegatedTaskInput({
      title: 'Omów dokumenty',
      assignee_user_id: assigneeUserId,
      data_access_scope: ['case_summary', 'client_contact', 'client_identity'],
      appointment: {
        facility_id: facilityId,
        service_id: serviceId,
        starts_at: '2026-08-03T12:15:00+02:00',
        client_person_id: clientPersonId,
        meeting_mode: 'online',
        meeting_url: 'https://meet.example.local/pokoj',
        notes: '  Przygotuj księgę wieczystą. ',
      },
      idempotency_key: idempotencyKey,
    })

    assert.equal(input.dueAt, '2026-08-03T10:15:00.000Z')
    assert.deepEqual(input.appointment, {
      facilityId,
      serviceId,
      startsAt: '2026-08-03T10:15:00.000Z',
      clientPersonId,
      meetingMode: 'online',
      meetingUrl: 'https://meet.example.local/pokoj',
      notes: 'Przygotuj księgę wieczystą.',
    })
  })

  it('rejects invalid appointment URLs and timestamps without a timezone', () => {
    const baseAppointment = {
      facility_id: facilityId,
      service_id: serviceId,
      starts_at: '2026-08-03T12:15:00+02:00',
    }
    const base = {
      title: 'Omów dokumenty',
      assignee_user_id: assigneeUserId,
      data_access_scope: ['case_summary', 'client_contact', 'client_identity'],
    }

    assert.throws(() => parseDelegatedTaskInput({
      ...base,
      appointment: {
        ...baseAppointment,
        starts_at: '2026-08-03T12:15:00',
      },
    }), /timezone offset/)
    assert.throws(() => parseDelegatedTaskInput({
      ...base,
      appointment: {
        ...baseAppointment,
        meeting_mode: 'office',
        meeting_url: 'https://meet.example.local/pokoj',
      },
    }), /only available for online/)
    assert.throws(() => parseDelegatedTaskInput({
      ...base,
      appointment: {
        ...baseAppointment,
        meeting_mode: 'online',
        meeting_url: 'javascript:alert(1)',
      },
    }), /valid HTTP/)
  })

  it('requires contact and identity access for an appointment', () => {
    assert.throws(() => parseDelegatedTaskInput({
      title: 'Omów dokumenty',
      assignee_user_id: assigneeUserId,
      data_access_scope: ['case_summary', 'client_contact'],
      appointment: {
        facility_id: facilityId,
        service_id: serviceId,
        starts_at: '2026-08-03T12:15:00+02:00',
      },
    }), /client_contact and client_identity/)
  })
})

describe('task delegation idempotency', () => {
  it('produces the same fingerprint regardless of access-scope order', () => {
    const task = parseDelegatedTaskInput({
      title: 'Przygotuj analizę',
      assignee_user_id: assigneeUserId,
      due_at: '2026-08-01T10:00:00.000Z',
      data_access_scope: ['documents', 'case_summary'],
      idempotency_key: idempotencyKey,
    })
    const reversed = {
      ...task,
      dataAccessScope: [...task.dataAccessScope].reverse(),
    }
    const base = {
      organizationId,
      caseId,
      delegatorUserId,
    }
    assert.equal(
      taskDelegationFingerprint({ ...base, task }),
      taskDelegationFingerprint({ ...base, task: reversed }),
    )
    assert.match(
      taskDelegationFingerprint({ ...base, task }),
      /^[0-9a-f]{64}$/,
    )
  })

  it('changes the fingerprint when the selected slot changes', () => {
    const task = parseDelegatedTaskInput({
      title: 'Przygotuj analizę',
      assignee_user_id: assigneeUserId,
      data_access_scope: ['case_summary', 'client_contact', 'client_identity'],
      appointment: {
        facility_id: facilityId,
        service_id: serviceId,
        starts_at: '2026-08-03T12:15:00+02:00',
      },
      idempotency_key: idempotencyKey,
    })
    const base = { organizationId, caseId, delegatorUserId }
    const original = taskDelegationFingerprint({ ...base, task })
    const changed = taskDelegationFingerprint({
      ...base,
      task: {
        ...task,
        appointment: {
          ...task.appointment!,
          startsAt: '2026-08-03T11:15:00.000Z',
        },
      },
    })
    assert.notEqual(original, changed)
  })
})

describe('delegation lifecycle input', () => {
  it('requires a reason only for rejection', () => {
    assert.deepEqual(
      parseTaskDelegationResponse({ action: 'reject', reason: 'Brak kompetencji.' }),
      { action: 'reject', reason: 'Brak kompetencji.' },
    )
    assert.throws(
      () => parseTaskDelegationResponse({ action: 'reject' }),
      /reason is required/,
    )
    assert.throws(
      () => parseTaskDelegationResponse({ action: 'accept', reason: 'unused' }),
      /only supported/,
    )
  })

  it('maps actions and accepts only executable task statuses', () => {
    assert.equal(expectedDelegationStatus('accept'), 'accepted')
    assert.equal(expectedDelegationStatus('reject'), 'rejected')
    assert.equal(expectedDelegationStatus('cancel'), 'cancelled')
    assert.equal(parseDelegatedTaskStatus({ status_code: 'done' }), 'done')
    assert.throws(
      () => parseDelegatedTaskStatus({ status_code: 'cancelled' }),
      /unsupported value/,
    )
  })

  it('separates permissions of delegator and assignee', () => {
    const task = {
      delegator_user_id: delegatorUserId,
      assignee_user_id: assigneeUserId,
    }
    assert.equal(
      canRespondToDelegation(
        { userId: assigneeUserId, role: 'expert' },
        task,
        'accept',
      ),
      true,
    )
    assert.equal(
      canRespondToDelegation(
        { userId: delegatorUserId, role: 'expert' },
        task,
        'accept',
      ),
      false,
    )
    assert.equal(
      canRespondToDelegation(
        { userId: delegatorUserId, role: 'expert' },
        task,
        'cancel',
      ),
      true,
    )
    assert.equal(
      canUpdateDelegatedTaskStatus(
        { userId: assigneeUserId, role: 'expert' },
        task,
      ),
      true,
    )
    assert.equal(
      canUpdateDelegatedTaskStatus(
        { userId: delegatorUserId, role: 'expert' },
        task,
      ),
      false,
    )
  })
})
