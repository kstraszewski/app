import { defineTool } from 'eve/tools'
import { z } from 'zod'

const candidates = {
  strong: [{
    caseId: '11111111-1111-4111-8111-111111111111',
    caseDisplayId: 'SP-0042',
    applicationId: '22222222-2222-4222-8222-222222222222',
    bankName: 'Bank Syntetyczny',
    externalReference: 'ABC-2026-0042',
  }],
  ambiguous: [
    {
      caseId: '44444444-4444-4444-8444-444444444444',
      caseDisplayId: 'SP-0101',
      applicationId: '55555555-5555-4555-8555-555555555555',
      bankName: 'Bank Syntetyczny',
      externalReference: null,
    },
    {
      caseId: '66666666-6666-4666-8666-666666666666',
      caseDisplayId: 'SP-0102',
      applicationId: '77777777-7777-4777-8777-777777777777',
      bankName: 'Bank Syntetyczny',
      externalReference: null,
    },
  ],
} as const

export default defineTool({
  description: 'Search a synthetic, PII-free set of CRM candidates.',
  inputSchema: z.object({
    query: z.string().min(2).max(120),
    limit: z.number().int().min(1).max(10).default(5),
  }).strict(),
  async execute({ query }) {
    const result = query === 'Nowak' ? candidates.ambiguous : candidates.strong
    return { candidateCount: result.length, candidates: result }
  },
})
