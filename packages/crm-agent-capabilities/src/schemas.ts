import { z } from 'zod'

const shortText = z.string().trim().min(1).max(300)
const optionalDate = z.string().nullable()

export const SearchCaseCandidatesInputSchema = z.object({
  query: z.string().trim().min(3).max(200),
  limit: z.number().int().min(1).max(8).default(5),
}).strict()

export const GetCaseMatchContextInputSchema = z.object({
  caseId: z.string().uuid(),
  applicationId: z.string().uuid().optional(),
}).strict()

export const ApplicationCandidateSchema = z.object({
  applicationId: z.string().uuid(),
  bankId: z.string().uuid(),
  bankName: shortText.nullable(),
  productName: shortText.nullable(),
  statusCode: z.string().trim().min(1).max(80),
  externalReference: z.string().trim().min(1).max(200).nullable(),
  submittedAt: optionalDate,
  decisionAt: optionalDate,
  updatedAt: z.string(),
}).strict()

export const CaseCandidateSchema = z.object({
  caseId: z.string().uuid(),
  caseTitle: shortText,
  caseStatusCode: z.string().trim().min(1).max(80),
  updatedAt: z.string(),
  applicantDisplayNames: z.array(shortText).max(20),
  applications: z.array(ApplicationCandidateSchema).max(24),
}).strict()

export type SearchCaseCandidatesInput = z.input<typeof SearchCaseCandidatesInputSchema>
export type GetCaseMatchContextInput = z.input<typeof GetCaseMatchContextInputSchema>
export type ApplicationCandidate = z.infer<typeof ApplicationCandidateSchema>
export type CaseCandidate = z.infer<typeof CaseCandidateSchema>
