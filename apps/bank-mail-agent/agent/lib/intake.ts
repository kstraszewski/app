import { z } from 'zod'
import { createBankMailServiceDataApiClient } from './data-api.ts'
import { callBankMailServiceRpc, rpcRecord } from './rpc.ts'

const code = z.string().trim().min(1).max(100).regex(/^[a-z0-9_:-]+$/u)
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u)

const attachmentInspectionSchema = z.object({
  attachmentId: z.string().uuid(),
  ordinal: z.number().int().min(0).max(100),
  sourceSha256: sha256,
  sizeBytes: z.number().int().min(0).max(100 * 1024 * 1024),
  mimeCategory: code,
  encryptionStatus: code,
  scanStatus: code,
  extractionStatus: code,
  credentialKindUsed: z.enum([
    'primary_pesel',
    'applicant_pesel',
    'company_nip',
  ]).nullable(),
  derivedSha256: sha256.nullable(),
  updatedAt: z.string().min(1).max(100),
})

const trustedIntakeSchema = z.object({
  intakeId: z.string().uuid(),
  status: code,
  provider: code,
  bankId: z.string().uuid().nullable(),
  bankEmailIdentityId: z.string().uuid().nullable(),
  identityVerdict: code,
  authenticationStatus: z.enum(['passed', 'failed', 'indeterminate']),
  dmarcAligned: z.boolean(),
  replyToMismatch: z.boolean(),
  sourceSha256: sha256,
  reasonCodes: z.array(code).max(24),
  claimedAt: z.string().min(1).max(100),
  finalizedAt: z.string().min(1).max(100).nullable(),
  attachments: z.array(attachmentInspectionSchema).max(20),
})

export type TrustedBankMailIntake = z.infer<typeof trustedIntakeSchema>

export async function loadTrustedBankMailIntake(
  expectedIntakeId: string,
): Promise<TrustedBankMailIntake> {
  const value = await callBankMailServiceRpc(
    createBankMailServiceDataApiClient(),
    'get_bank_mail_agent_intake',
    { p_intake_id: expectedIntakeId },
  )
  const intake = trustedIntakeSchema.parse(rpcRecord(value))
  if (intake.intakeId !== expectedIntakeId) {
    throw new Error('Trusted intake scope mismatch.')
  }
  return intake
}

export function hashPrefix(value: string | null): string | null {
  return value ? value.slice(0, 12) : null
}
