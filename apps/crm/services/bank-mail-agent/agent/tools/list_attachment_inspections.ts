import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { requireBankMailAgentCaller } from '../lib/caller.ts'
import { hashPrefix, loadTrustedBankMailIntake } from '../lib/intake.ts'

export default defineTool({
  description: 'List safe server-side attachment inspection results for this intake. It returns only an opaque reference, ordinal, bounded size, MIME category, scan/encryption/extraction status, hash prefixes and the credential category used. It never returns bytes, filenames, storage keys, PESEL, NIP or password values and cannot decrypt anything.',
  inputSchema: z.object({}).strict(),
  async execute(_input, ctx) {
    const caller = requireBankMailAgentCaller(ctx)
    const intake = await loadTrustedBankMailIntake(caller.intakeId)

    return {
      attachmentCount: intake.attachments.length,
      attachments: intake.attachments.map(attachment => ({
        attachmentRef: attachment.attachmentId,
        ordinal: attachment.ordinal,
        sizeBytes: attachment.sizeBytes,
        mimeCategory: attachment.mimeCategory,
        encryptionStatus: attachment.encryptionStatus,
        scanStatus: attachment.scanStatus,
        extractionStatus: attachment.extractionStatus,
        credentialKindUsed: attachment.credentialKindUsed,
        sourceSha256Prefix: hashPrefix(attachment.sourceSha256),
        derivedSha256Prefix: hashPrefix(attachment.derivedSha256),
        updatedAt: attachment.updatedAt,
      })),
    }
  },
})
