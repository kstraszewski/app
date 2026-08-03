import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mapCrmOmnisearchResponse,
  parseCrmOmnisearchInput,
} from '../server/utils/omnisearch.ts'
import { canAccessCrmOmnisearch } from '../shared/types/omnisearch.ts'

const caseId = '00000000-0000-4000-8000-000000000001'
const clientId = '00000000-0000-4000-8000-000000000002'
const appointmentId = '00000000-0000-4000-8000-000000000003'
const expertId = '00000000-0000-4000-8000-000000000004'
const taskId = '00000000-0000-4000-8000-000000000005'
const documentId = '00000000-0000-4000-8000-000000000006'
const submissionId = '00000000-0000-4000-8000-000000000007'
const forumThreadId = '00000000-0000-4000-8000-000000000008'
const bankFileId = '00000000-0000-4000-8000-000000000009'

test('allows omnisearch only for supported CRM organization roles', () => {
  assert.equal(canAccessCrmOmnisearch('expert'), true)
  assert.equal(canAccessCrmOmnisearch('admin'), true)
  assert.equal(canAccessCrmOmnisearch('member'), false)
  assert.equal(canAccessCrmOmnisearch(undefined), false)
})

test('parses and bounds an omnisearch request without rewriting natural input', () => {
  assert.deepEqual(parseCrmOmnisearchInput('  Kredyt   12/07/2026  ', '6'), {
    query: 'Kredyt 12/07/2026',
    limit: 6,
  })
  assert.deepEqual(parseCrmOmnisearchInput('+48 501 210-101', undefined), {
    query: '+48 501 210-101',
    limit: 5,
  })
  assert.throws(() => parseCrmOmnisearchInput('xy', 5), /between 3 and 200/)
  assert.throws(() => parseCrmOmnisearchInput('klient', 9), /between 1 and 8/)
})

test('maps a minimal grouped response to safe deep links', () => {
  const response = mapCrmOmnisearchResponse({
    forum: [{
      thread_id: forumThreadId,
      title: 'Jak policzyć dochód z B2B?',
      type: 'question',
      status: 'resolved',
      category_name: 'Kredyty hipoteczne',
      matched_in: 'zweryfikowana odpowiedź',
      excerpt: 'Bank bierze pod uwagę dochód po odliczeniu kosztów.',
      body: 'full private post body must not leak',
    }],
    bankFiles: [{
      file_id: bankFileId,
      title: 'Instrukcja oceny dochodu przedsiębiorcy',
      bank_name: 'ING Bank Śląski',
      category_label: 'Informacje ogólne',
      original_file_name: 'instrukcja-dochodu.pdf',
      snippet: 'Dochód przedsiębiorcy jest liczony na podstawie dokumentów podatkowych.',
      locator: 's. 4',
      page_number: 4,
      storage_path: 'private/bank-files/secret.pdf',
      extracted_text: 'full extracted bank document must not leak',
      download_url: 'https://private.example.test/secret.pdf',
    }],
    cases: [{
      id: caseId,
      title: 'Kredyt hipoteczny',
      status_code: 'in_progress',
      client_names: 'Jan Kowalski',
      notes: 'must not leak',
      metadata: { secret: true },
    }],
    clients: [{
      id: clientId,
      display_name: 'Jan Kowalski',
      status_code: 'active',
      primary_email: 'jan@example.test',
    }],
    appointments: [{
      id: appointmentId,
      client_id: clientId,
      customer_name: 'Jan Kowalski',
      starts_at: '2026-07-27T10:00:00.000Z',
      timezone: 'Europe/Warsaw',
      expert_user_id: expertId,
      service_name: 'Konsultacja',
      meeting_mode: 'online',
      meeting_url: 'https://secret.example.test',
    }],
    tasks: [{
      id: taskId,
      title: 'Uzupełnij dokumenty',
      case_id: caseId,
      case_title: 'Kredyt hipoteczny',
      status_code: 'open',
      delegation_status: 'not_delegated',
    }],
    documents: [{
      id: documentId,
      record_type: 'document',
      label: 'Zaświadczenie.pdf',
      case_id: caseId,
      case_title: 'Kredyt hipoteczny',
      status_code: 'verified',
      storage_path: 'private/secret.pdf',
    }],
  }, 'moja-organizacja', 'Kowalski')

  assert.deepEqual(response.groups.forum[0]?.to, {
    path: `/org/moja-organizacja/forum/threads/${forumThreadId}`,
  })
  assert.deepEqual(response.groups.bankFiles[0], {
    id: bankFileId,
    kind: 'bank_file',
    label: 'Instrukcja oceny dochodu przedsiębiorcy',
    description: 'ING Bank Śląski · Informacje ogólne · Dochód przedsiębiorcy jest liczony na podstawie dokumentów podatkowych.',
    suffix: 's. 4',
    icon: 'i-lucide-file-search-2',
    to: {
      path: '/org/moja-organizacja/settings/institution-files',
      query: { file: bankFileId, page: 4 },
    },
  })
  assert.equal(response.groups.cases[0]?.to, `/org/moja-organizacja/cases/${caseId}`)
  assert.deepEqual(response.groups.appointments[0]?.to, {
    path: '/org/moja-organizacja/calendar',
    query: {
      date: '2026-07-27',
      appointment: appointmentId,
      appointmentAt: '2026-07-27T10:00:00.000Z',
      expert: expertId,
    },
  })
  assert.deepEqual(response.groups.tasks[0]?.to, {
    path: `/org/moja-organizacja/cases/${caseId}`,
    query: { view: 'history', task: taskId },
  })
  assert.deepEqual(response.groups.documents[0]?.to, {
    path: `/org/moja-organizacja/cases/${caseId}`,
    query: { view: 'documents', document: documentId },
  })

  const serialized = JSON.stringify(response)
  assert.equal(serialized.includes('must not leak'), false)
  assert.equal(serialized.includes('secret.example.test'), false)
  assert.equal(serialized.includes('private/secret.pdf'), false)
  assert.equal(serialized.includes('full private post body must not leak'), false)
  assert.equal(serialized.includes('full extracted bank document must not leak'), false)
  assert.equal(serialized.includes('private/bank-files'), false)
  assert.equal(serialized.includes('private.example.test'), false)
  assert.equal(serialized.includes('"metadata"'), false)
})

test('routes delegated tasks and applications to their exact case records', () => {
  const response = mapCrmOmnisearchResponse({
    tasks: [{
      id: taskId,
      title: 'Zadzwoń do klienta',
      case_id: caseId,
      delegation_status: 'accepted',
    }],
    documents: [{
      id: submissionId,
      record_type: 'application',
      label: 'Wniosek · Bank',
      case_id: caseId,
    }],
  }, 'moja-organizacja', 'Bank')

  assert.deepEqual(response.groups.tasks[0]?.to, {
    path: `/org/moja-organizacja/cases/${caseId}`,
    query: { view: 'delegations', task: taskId },
  })
  assert.deepEqual(response.groups.documents[0]?.to, {
    path: `/org/moja-organizacja/cases/${caseId}`,
    query: { view: 'documents', application: submissionId },
  })
})
