import assert from 'node:assert/strict'
import test from 'node:test'
import type { DataApiClient } from '../../data-api/src/index.ts'
import {
  BANK_MAIL_AGENT_MODEL,
  BANK_MAIL_AGENT_PROMPT_VERSION,
  BANK_MAIL_MATCH_POLICY_VERSION,
  CRM_AGENT_CAPABILITIES_TOOL_VERSION,
  deriveCapabilityScope,
  getCaseMatchContext,
  MAIN_CRM_AGENT_MODEL,
  redactSensitiveText,
  reduceBankMailProposal,
  searchCaseCandidates,
  SearchCaseCandidatesInputSchema,
  type DataApiClientLike,
  type DataApiQueryLike,
  type DataApiRelationLike,
  type DataApiResponseLike,
} from '../src/index.ts'

// Compile-time proof that the production Data API client satisfies the small,
// testable capability contract without coupling this package to its runtime.
function asCapabilityClient(client: DataApiClient): DataApiClientLike {
  return client
}

void asCapabilityClient

const ids = {
  application: 'aac41c22-3532-4555-ae6c-5ec6b9ee71d1',
  applicationForeign: '7eec333f-c44c-462f-9724-67fab44d52fe',
  bank: '0ed68ca3-89c9-456e-9722-2da44abb5e49',
  bankForeign: 'd1f6a7c6-09b5-4e9f-9cdb-3919c2f74d77',
  case: 'e9ad0e4d-ce1f-430e-90ad-f559a4536a4f',
  caseForeign: '0d447f49-1365-4b48-ad88-8489d2db82c0',
  client: '224850ce-ed60-4a8f-b925-ed45ae531a5c',
  clientForeign: 'f4994f51-c084-45b9-8e26-831572810b75',
  connection: 'd11d2be6-b758-48af-b540-56f16d4696fd',
  offer: 'db53a714-b7c4-4801-90e6-d6f7090ab9b0',
  offerForeign: '0f2df421-2086-4e88-b9e3-5dc953f977b7',
  organization: 'a7b9e8b0-2a85-40e6-a2f5-290ac47aaefe',
  owner: '6bf07bb0-0617-4901-a943-e117f8a93a0a',
  ownerForeign: 'eef73bc3-acd4-4379-9c12-9e45f36d2079',
}

type Row = Record<string, unknown>
type Operation =
  | { kind: 'eq', column: string, value: unknown }
  | { kind: 'in', column: string, values: readonly unknown[] }
  | { kind: 'limit', count: number }
  | { kind: 'order', column: string }
  | { kind: 'select', columns: string }

interface CapturedCall {
  kind: 'from' | 'rpc'
  name: string
  args?: Record<string, unknown>
  operations: Operation[]
}

class FakeQuery implements DataApiQueryLike {
  readonly call: CapturedCall
  readonly client: FakeDataApiClient
  single = false

  constructor(client: FakeDataApiClient, call: CapturedCall) {
    this.client = client
    this.call = call
  }

  eq(column: string, value: unknown): DataApiQueryLike {
    this.call.operations.push({ kind: 'eq', column, value })
    return this
  }

  in(column: string, values: readonly unknown[]): DataApiQueryLike {
    this.call.operations.push({ kind: 'in', column, values })
    return this
  }

  limit(count: number): DataApiQueryLike {
    this.call.operations.push({ kind: 'limit', count })
    return this
  }

  maybeSingle(): DataApiQueryLike {
    this.single = true
    return this
  }

  order(column: string): DataApiQueryLike {
    this.call.operations.push({ kind: 'order', column })
    return this
  }

  select(columns = '*'): DataApiQueryLike {
    this.call.operations.push({ kind: 'select', columns })
    return this
  }

  then<TResult1 = DataApiResponseLike, TResult2 = never>(
    onfulfilled?: ((value: DataApiResponseLike) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.client.resolve(this).then(onfulfilled, onrejected)
  }
}

class FakeDataApiClient implements DataApiClientLike {
  readonly calls: CapturedCall[] = []
  readonly rpcPayload: Row
  readonly tables: Record<string, Row[]>

  constructor(tables: Record<string, Row[]>, rpcPayload: Row) {
    this.tables = tables
    this.rpcPayload = rpcPayload
  }

  from(relation: string): DataApiRelationLike {
    const call: CapturedCall = { kind: 'from', name: relation, operations: [] }
    this.calls.push(call)
    return new FakeQuery(this, call)
  }

  rpc(functionName: string, args?: Record<string, unknown>): DataApiQueryLike {
    const call: CapturedCall = {
      kind: 'rpc',
      name: functionName,
      args,
      operations: [],
    }
    this.calls.push(call)
    return new FakeQuery(this, call)
  }

  async resolve(query: FakeQuery): Promise<DataApiResponseLike> {
    if (query.call.kind === 'rpc') return { data: this.rpcPayload, error: null }
    let rows = [...(this.tables[query.call.name] ?? [])]
    for (const operation of query.call.operations) {
      if (operation.kind === 'eq') {
        rows = rows.filter(row => row[operation.column] === operation.value)
      }
      else if (operation.kind === 'in') {
        rows = rows.filter(row => operation.values.includes(row[operation.column]))
      }
      else if (operation.kind === 'limit') {
        rows = rows.slice(0, operation.count)
      }
    }
    return { data: query.single ? rows[0] ?? null : rows, error: null }
  }
}

function fixtures(): FakeDataApiClient {
  return new FakeDataApiClient({
    crm_cases: [
      {
        id: ids.case,
        organization_id: ids.organization,
        owner_user_id: ids.owner,
        title: 'Kredyt mieszkaniowy Kowalskich',
        status_code: 'active',
        updated_at: '2026-08-20T10:00:00Z',
        description: 'must never leave the capability',
      },
      {
        id: ids.caseForeign,
        organization_id: ids.organization,
        owner_user_id: ids.ownerForeign,
        title: 'Foreign case',
        status_code: 'active',
        updated_at: '2026-08-20T09:00:00Z',
      },
    ],
    crm_case_clients: [
      {
        organization_id: ids.organization,
        case_id: ids.case,
        client_id: ids.client,
        is_primary: true,
      },
      {
        organization_id: ids.organization,
        case_id: ids.caseForeign,
        client_id: ids.clientForeign,
        is_primary: true,
      },
    ],
    crm_clients: [
      {
        id: ids.client,
        organization_id: ids.organization,
        owner_user_id: ids.owner,
        display_name: 'Anna Kowalska',
        primary_email: 'secret@example.test',
        primary_phone: '+48123456789',
        pesel: '90010112345',
        notes: 'secret note',
      },
      {
        id: ids.clientForeign,
        organization_id: ids.organization,
        owner_user_id: ids.ownerForeign,
        display_name: 'Foreign Client',
      },
    ],
    crm_case_bank_applications: [
      {
        organization_id: ids.organization,
        case_id: ids.case,
        submission_id: ids.application,
        offer_id: ids.offer,
        bank_id: ids.bank,
        slot: 1,
        calculation_snapshot: { sensitive: true },
      },
      {
        organization_id: ids.organization,
        case_id: ids.caseForeign,
        submission_id: ids.applicationForeign,
        offer_id: ids.offerForeign,
        bank_id: ids.bankForeign,
        slot: 1,
      },
    ],
    crm_item_submissions: [
      {
        id: ids.application,
        organization_id: ids.organization,
        status_code: 'w_analizie',
        external_reference: 'BANK-REF-2026-001',
        submitted_at: '2026-08-18T08:00:00Z',
        decision_at: null,
        updated_at: '2026-08-20T08:00:00Z',
        notes: 'never expose me',
        metadata: { body: 'never expose me either' },
      },
      {
        id: ids.applicationForeign,
        organization_id: ids.organization,
        status_code: 'w_analizie',
        external_reference: 'FOREIGN-REF',
        submitted_at: null,
        decision_at: null,
        updated_at: '2026-08-20T07:00:00Z',
      },
    ],
    crm_case_offer_snapshots: [
      {
        id: ids.offer,
        organization_id: ids.organization,
        case_id: ids.case,
        bank_id: ids.bank,
        bank_name: 'Bank Testowy',
        product_name: 'Hipoteka 2026',
      },
      {
        id: ids.offerForeign,
        organization_id: ids.organization,
        case_id: ids.caseForeign,
        bank_id: ids.bankForeign,
        bank_name: 'Foreign Bank',
        product_name: 'Foreign Product',
      },
    ],
  }, {
    cases: [
      { id: ids.case, title: 'Owned' },
      { id: ids.caseForeign, title: 'Foreign' },
    ],
    clients: [{ id: ids.client }, { id: ids.clientForeign }],
    documents: [
      { record_type: 'application', id: ids.application, case_id: ids.case },
      { record_type: 'application', id: ids.applicationForeign, case_id: ids.caseForeign },
      { record_type: 'document', id: ids.offer, case_id: ids.case },
    ],
  })
}

const bankPrincipal = {
  kind: 'bank-mail' as const,
  organizationId: ids.organization,
  organizationSlug: 'demo',
  ownerUserId: ids.owner,
  connectionId: ids.connection,
}

test('derives visibility from principal kind instead of accepting it as input', () => {
  assert.deepEqual(deriveCapabilityScope(bankPrincipal), {
    organizationId: ids.organization,
    ownerUserId: ids.owner,
    visibility: 'owned-by-actor',
  })
  assert.deepEqual(deriveCapabilityScope({
    kind: 'user',
    organizationId: ids.organization,
    userId: ids.owner,
    role: 'expert',
  }), {
    organizationId: ids.organization,
    ownerUserId: null,
    visibility: 'organization',
  })
  assert.throws(() => deriveCapabilityScope({
    ...bankPrincipal,
    visibility: 'organization',
  } as typeof bankPrincipal))
})

test('bank-mail search re-scopes all raw hits and returns only allowlisted fields', async () => {
  const dataApi = fixtures()
  const candidates = await searchCaseCandidates({
    dataApi,
    principal: bankPrincipal,
    query: 'BANK-REF-2026-001',
    limit: 5,
  })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.caseId, ids.case)
  assert.deepEqual(candidates[0]?.applicantDisplayNames, ['Anna Kowalska'])
  assert.deepEqual(candidates[0]?.applications[0], {
    applicationId: ids.application,
    bankId: ids.bank,
    bankName: 'Bank Testowy',
    productName: 'Hipoteka 2026',
    statusCode: 'w_analizie',
    externalReference: 'BANK-REF-2026-001',
    submittedAt: '2026-08-18T08:00:00Z',
    decisionAt: null,
    updatedAt: '2026-08-20T08:00:00Z',
  })

  const serialized = JSON.stringify(candidates)
  for (const forbidden of [
    'secret@example.test',
    '+48123456789',
    '90010112345',
    'secret note',
    'never expose me',
    'must never leave',
  ]) assert.equal(serialized.includes(forbidden), false)

  const fromCalls = dataApi.calls.filter(call => call.kind === 'from')
  assert.ok(fromCalls.length > 0)
  assert.ok(fromCalls.every(call => call.operations.some(operation => (
    operation.kind === 'eq'
      && operation.column === 'organization_id'
      && operation.value === ids.organization
  ))))
  for (const call of fromCalls.filter(call => ['crm_cases', 'crm_clients'].includes(call.name))) {
    assert.ok(call.operations.some(operation => (
      operation.kind === 'eq'
        && operation.column === 'owner_user_id'
        && operation.value === ids.owner
    )), `${call.name} should be owner scoped`)
  }
  const selectedColumns = fromCalls.flatMap(call => call.operations.flatMap(operation => (
    operation.kind === 'select' ? [operation.columns] : []
  ))).join(',')
  assert.doesNotMatch(selectedColumns, /email|phone|pesel|nip|notes|body|description/iu)
  assert.deepEqual(dataApi.calls[0]?.args, {
    p_organization_id: ids.organization,
    p_query: 'BANK-REF-2026-001',
    p_limit: 5,
  })
})

test('case context cannot cross bank-mail owner scope or select another application', async () => {
  const owned = await getCaseMatchContext({
    dataApi: fixtures(),
    principal: bankPrincipal,
    caseId: ids.case,
    applicationId: ids.application,
  })
  assert.equal(owned?.applications[0]?.applicationId, ids.application)

  const foreign = await getCaseMatchContext({
    dataApi: fixtures(),
    principal: bankPrincipal,
    caseId: ids.caseForeign,
    applicationId: ids.applicationForeign,
  })
  assert.equal(foreign, null)

  const wrongApplication = await getCaseMatchContext({
    dataApi: fixtures(),
    principal: bankPrincipal,
    caseId: ids.case,
    applicationId: ids.applicationForeign,
  })
  assert.equal(wrongApplication, null)
})

test('candidate search input is bounded', () => {
  assert.deepEqual(SearchCaseCandidatesInputSchema.parse({ query: '  Kowalski  ' }), {
    query: 'Kowalski',
    limit: 5,
  })
  assert.throws(() => SearchCaseCandidatesInputSchema.parse({ query: 'ab' }))
  assert.throws(() => SearchCaseCandidatesInputSchema.parse({ query: 'Kowalski', limit: 9 }))
  assert.throws(() => SearchCaseCandidatesInputSchema.parse({
    query: 'Kowalski',
    organizationId: ids.organization,
  }))
})

test('redacts identifiers and contact data pasted into otherwise allowed labels', () => {
  assert.equal(
    redactSensitiveText('Jan 90010112345 jan@example.test +48 123 456 789'),
    'Jan [REDACTED_IDENTIFIER] [REDACTED_EMAIL] [REDACTED_PHONE]',
  )
  assert.equal(
    redactSensitiveText('NIP 123-456-78-90'),
    'NIP [REDACTED_IDENTIFIER]',
  )
})

test('proposal policy recognizes strong evidence but never permits automatic attachment', () => {
  const result = reduceBankMailProposal({
    candidateCount: 1,
    senderIdentity: 'verified',
    externalReferenceMatch: 'exact_unique',
    bankMatch: 'match',
    applicantNameMatch: 'full',
  })
  assert.deepEqual(result, {
    policyVersion: BANK_MAIL_MATCH_POLICY_VERSION,
    decision: 'review_required',
    evidenceStrength: 'strong',
    eligibleForAutomaticAttach: false,
    reasonCodes: [
      'exact_unique_external_reference',
      'matching_bank',
      'full_applicant_name_match',
    ],
  })
})

test('name-only evidence requires review and never becomes strong or automatic', () => {
  const result = reduceBankMailProposal({
    candidateCount: 1,
    senderIdentity: 'verified',
    externalReferenceMatch: 'none',
    bankMatch: 'none',
    applicantNameMatch: 'full',
  })
  assert.equal(result.decision, 'review_required')
  assert.equal(result.evidenceStrength, 'weak')
  assert.equal(result.eligibleForAutomaticAttach, false)
  assert.ok(result.reasonCodes.includes('name_signal_requires_human_review'))
})

test('contradictions reduce a proposal to no match regardless of model signals', () => {
  const result = reduceBankMailProposal({
    candidateCount: 1,
    senderIdentity: 'verified',
    externalReferenceMatch: 'exact_unique',
    bankMatch: 'mismatch',
    applicantNameMatch: 'full',
  })
  assert.equal(result.decision, 'no_match')
  assert.equal(result.evidenceStrength, 'none')
  assert.equal(result.eligibleForAutomaticAttach, false)
  assert.deepEqual(result.reasonCodes, ['bank_mismatch'])
})

test('pins dated model profiles and prompt/tool/policy versions', () => {
  assert.deepEqual(BANK_MAIL_AGENT_MODEL, {
    id: 'deepseek/deepseek-v4-flash-0731',
    reasoningEffort: 'low',
  })
  assert.deepEqual(MAIN_CRM_AGENT_MODEL, {
    id: 'deepseek/deepseek-v4-pro-0813',
    reasoningEffort: 'low',
  })
  assert.equal(BANK_MAIL_AGENT_PROMPT_VERSION, 'bank-mail-agent.prompt.v1')
  assert.equal(CRM_AGENT_CAPABILITIES_TOOL_VERSION, 'crm-agent-capabilities.tools.v1')
  assert.equal(BANK_MAIL_MATCH_POLICY_VERSION, 'bank-mail-match-policy.v1')
})
