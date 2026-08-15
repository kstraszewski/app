import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { requireCrmAgentCaller } from '../lib/caller'
import { createAgentActingUserDataApiClient } from '../lib/data-api'

type Row = Record<string, any>

function records(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Row[]
    : []
}

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Row
    : {}
}

function fixedCrmGroups(payload: Row, caseId: string, clientId: string): Row {
  return {
    cases: records(payload.cases).filter(row => String(row.id) === caseId),
    clients: records(payload.clients).filter(row => String(row.id) === clientId),
    appointments: records(payload.appointments).filter(row => String(row.client_id) === clientId),
    tasks: records(payload.tasks).filter(row => (
      String(row.case_id) === caseId || String(row.client_id) === clientId
    )),
    documents: records(payload.documents).filter(row => (
      String(row.case_id) === caseId || String(row.client_id) === clientId
    )),
  }
}

export default defineTool({
  description: 'Main read-only Omni Search for the CRM. Search it first when you need to locate CRM cases, clients, appointments, tasks, documents, expert-forum knowledge, official bank files, or the organization knowledge library. It uses the same ranked CRM Omni index as the command palette. Follow a promising forum or bank-file hit with the dedicated deep-search tool when exact source passages are needed.',
  inputSchema: z.object({
    query: z.string().trim().min(3).max(200),
    limit: z.number().int().min(1).max(8).default(5),
  }),
  async execute({ query, limit }, ctx) {
    const caller = requireCrmAgentCaller(ctx)
    if (!['expert', 'admin'].includes(caller.role)) {
      throw new Error('Dostęp do Omni Search wymaga członkostwa eksperta w organizacji CRM.')
    }

    const dataApi = createAgentActingUserDataApiClient(caller.userId)
    const crmPromise = dataApi.rpc('search_crm_omnisearch', {
      p_organization_id: caller.organizationId,
      p_query: query,
      p_limit: limit,
    })
    const forumPromise = dataApi
      .from('forum_search_documents')
      .select('thread_id, document_kind, title, content, updated_at')
      .eq('organization_id', caller.organizationId)
      .eq('is_searchable', true)
      .textSearch('search_vector', query, { config: 'simple', type: 'websearch' })
      .order('updated_at', { ascending: false })
      .limit(limit)
    const bankFilesPromise = dataApi.rpc('search_mortgage_bank_file_chunks', {
      query_text: query,
      query_embedding: null,
      filter_bank_id: null,
      filter_category_key: null,
      filter_mime_group: null,
      filter_product_id: null,
      filter_status: 'current',
      match_count: limit,
      full_text_weight: 1.35,
      semantic_weight: 0,
      rrf_k: 50,
    })
    const knowledgePromise = caller.canUseExperiments
      ? dataApi.rpc('search_experiment_knowledge', {
          p_organization_id: caller.organizationId,
          p_actor_user_id: caller.userId,
          p_query: query,
          p_query_embedding: null,
          p_kind: null,
          p_financial_institution_id: null,
          p_match_count: limit,
          p_full_text_weight: 1.35,
          p_semantic_weight: 0,
          p_rrf_k: 50,
        })
      : Promise.resolve({ data: [], error: null })

    const [crmResult, forumResult, bankFilesResult, knowledgeResult] = await Promise.all([
      crmPromise,
      forumPromise,
      bankFilesPromise,
      knowledgePromise,
    ])
    if (crmResult.error) throw new Error(`Omni Search CRM nie odpowiedział: ${crmResult.error.message}`)

    const rawCrm = record(crmResult.data)
    const invocation = caller.invocation
    const crm = invocation
      ? fixedCrmGroups(rawCrm, invocation.scope.caseId, invocation.scope.clientId)
      : rawCrm

    return {
      query,
      fixedScope: invocation
        ? {
            caseId: invocation.scope.caseId,
            clientId: invocation.scope.clientId,
          }
        : null,
      crm,
      forum: forumResult.error
        ? []
        : records(forumResult.data).map(row => ({
            threadId: String(row.thread_id),
            title: String(row.title),
            kind: String(row.document_kind),
            excerpt: String(row.content ?? '').trim().slice(0, 2_000),
            updatedAt: String(row.updated_at),
          })),
      bankFiles: bankFilesResult.error
        ? []
        : records(bankFilesResult.data).map(row => ({
            fileId: String(row.file_id),
            versionId: String(row.version_id),
            page: row.page_number ?? null,
            locator: row.locator ?? null,
            excerpt: String(row.snippet ?? '').trim().slice(0, 2_000),
          })),
      knowledge: knowledgeResult.error
        ? []
        : records(knowledgeResult.data).map(row => ({
            documentId: String(row.document_id),
            kind: String(row.kind),
            title: String(row.title),
            excerpt: String(row.snippet ?? '').trim().slice(0, 2_000),
            updatedAt: String(row.updated_at),
          })),
      partialFailures: [
        forumResult.error ? 'forum' : null,
        bankFilesResult.error ? 'bankFiles' : null,
        knowledgeResult.error ? 'knowledge' : null,
      ].filter(Boolean),
    }
  },
})
