import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { requireReanalysisBankMailAgentCaller } from '../lib/caller.ts'
import { createBankMailSessionBindDataApiClient } from '../lib/data-api.ts'
import { callBankMailServiceRpc, rpcRecord } from '../lib/rpc.ts'
import {
  bankMailReanalysisResultRequest,
  type BankMailReanalysisClassification,
} from '../lib/session-bind.ts'

const controlledCode = z.string().trim().min(1).max(100).regex(/^[a-z0-9_:-]+$/u)
const controlledCodes = z.array(controlledCode).max(24).default([])

const inputSchema = z.object({
  resultCode: z.enum([
    'review_required',
    'no_match',
    'not_bank_mail',
    'needs_human_selection',
    'security_rejected',
  ]),
  classification: z.enum([
    'strong_candidate',
    'ambiguous_candidate',
  ]).nullable().default(null),
  caseId: z.string().uuid().nullable().default(null),
  applicationId: z.string().uuid().nullable().default(null),
  evidenceCodes: controlledCodes,
  contradictionCodes: controlledCodes,
  reasonCodes: controlledCodes,
}).strict().superRefine((value, ctx) => {
  const hasCandidate = value.classification !== null
    || value.caseId !== null
    || value.applicationId !== null
  if (value.resultCode === 'review_required') {
    if (!value.classification || !value.caseId || !value.applicationId) {
      ctx.addIssue({
        code: 'custom',
        message: 'review_required needs one classified case and application candidate.',
      })
    }
  }
  else if (hasCandidate) {
    ctx.addIssue({
      code: 'custom',
      message: 'Non-candidate reanalysis results cannot identify a case or application.',
    })
  }
})

function canonicalCodes(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

export default defineTool({
  description: 'Record exactly one advisory-only reanalysis result. This tool is available only to a signed bank-mail reanalysis session. It cannot modify the canonical intake, proposal, case, application, attachment, or mailbox-thread link.',
  inputSchema,
  async execute(input, ctx) {
    const caller = requireReanalysisBankMailAgentCaller(ctx)
    const result = {
      resultCode: input.resultCode,
      classification: input.classification as BankMailReanalysisClassification,
      caseId: input.caseId,
      applicationId: input.applicationId,
      evidenceCodes: canonicalCodes(input.evidenceCodes),
      contradictionCodes: canonicalCodes(input.contradictionCodes),
      reasonCodes: canonicalCodes(input.reasonCodes),
    }
    const request = bankMailReanalysisResultRequest(caller, ctx.session.id, result)
    const recorded = rpcRecord(await callBankMailServiceRpc(
      createBankMailSessionBindDataApiClient(request.claims),
      request.rpcName,
      request.args,
    ))
    if (recorded.reanalysisRequestId !== caller.reanalysisRequestId) {
      throw new Error('Bank-mail reanalysis result scope mismatch.')
    }

    return {
      recorded: true,
      state: recorded.state,
      resultCode: input.resultCode,
      advisoryOnly: true,
      canonicalMutation: false,
    }
  },
})
