import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

const adapter = source('../server/utils/bank-mail-pdf-attachment.ts')
const core = source('../server/utils/bank-mail-pdf-attachment-core.ts')
const outbox = source('../server/api/internal/notifications/outbox.post.ts')
const trigger = source('../../../packages/tasks/src/trigger/notification-outbox.ts')
const boundedPdfText = source('../server/utils/bounded-pdf-text.ts')
const crmPackage = JSON.parse(source('../package.json')) as {
  dependencies?: Record<string, string>
}

test('deploys the automatic PDF worker through the durable notification drainer', () => {
  assert.match(outbox, /drainBankMailPdfAttachmentJobs/u)
  assert.match(outbox, /crm-bank-mail-pdf:\$\{runId\}/u)
  assert.match(adapter, /claim_bank_mail_agent_pdf_attachment_jobs/u)
  assert.match(adapter, /const boundedLimit = 1/u)
  assert.match(adapter, /prove_bank_mail_agent_pdf_attachment_source/u)
  assert.match(adapter, /begin_bank_mail_agent_pdf_attachment_import/u)
  assert.match(adapter, /publish_bank_mail_agent_pdf_attachment/u)
  assert.match(adapter, /fail_bank_mail_agent_pdf_attachment/u)
  assert.match(trigger, /AbortSignal\.timeout\(180_000\)/u)
})

test('keeps text-only PDF.js extraction independent of native canvas', () => {
  assert.equal(crmPackage.dependencies?.['@napi-rs/canvas'], undefined)
  assert.doesNotMatch(boundedPdfText, /import\('@napi-rs\/canvas'\)/u)
  assert.match(boundedPdfText, /globals\.DOMMatrix \|\|= class DOMMatrix/u)
  assert.match(boundedPdfText, /globals\.Path2D \|\|= class Path2D/u)
  assert.match(boundedPdfText, /globals\.ImageData \|\|= class ImageData/u)
  assert.match(boundedPdfText, /only uses getTextContent\(\)/u)
})

test('keeps models, PDFs and unlock credentials outside Eve and Trigger payloads', () => {
  assert.doesNotMatch(adapter, /analyzeMortgageDocumentPdf|runOrReplayMortgageDocumentAiAttempt|AI_GATEWAY|gemini/iu)
  assert.doesNotMatch(core, /eve\/|eve\/client|defineTool|sessions\.create/iu)
  assert.doesNotMatch(trigger, /pdfBytes|archiveBytes|credential|pesel/iu)
  assert.match(adapter, /pesel: credential/u)
  assert.match(core, /credential = null/u)
  assert.doesNotMatch(adapter, /console\.(?:log|info|warn|error)/u)
})

test('signs each database phase with its exact dedicated source', () => {
  for (const sourceName of [
    'crm-bank-mail-pdf-claim-v1',
    'crm-bank-mail-pdf-proof-v1',
    'crm-bank-mail-pdf-import-v1',
    'crm-bank-mail-pdf-publish-v1',
    'crm-bank-mail-pdf-failure-v1',
  ]) {
    assert.match(core, new RegExp(sourceName, 'u'))
  }
  assert.match(adapter, /const proofClaims = \{\s*intakeSourceSha256: job\.intakeSourceSha256,\s*attachmentOrdinal: source\.attachmentOrdinal,\s*attachmentTokenSha256: source\.attachmentTokenSha256,\s*archiveSha256,\s*archiveSizeBytes,\s*generationContextSha256: job\.generationContextSha256,\s*manifestSha256: job\.manifestSha256,\s*manifestSizeBytes: job\.manifestSizeBytes,\s*payloadSha256: job\.payloadSha256,\s*\}/u)
  assert.match(adapter, /p_intake_source_sha256: proofClaims\.intakeSourceSha256,\s*p_attachment_ordinal: proofClaims\.attachmentOrdinal,\s*p_attachment_token_sha256: proofClaims\.attachmentTokenSha256,\s*p_archive_sha256: proofClaims\.archiveSha256,\s*p_archive_size_bytes: proofClaims\.archiveSizeBytes/gu)
  assert.match(adapter, /pdfSha256,\s*pdfSizeBytes,\s*validUntil: job\.validUntil/gu)
  assert.match(adapter, /const failureClaims = \{\s*failureCode: input\.code,\s*retryable: input\.retryable,\s*retryAfterSeconds,\s*\}/u)
  assert.match(adapter, /p_failure_code: failureClaims\.failureCode,\s*p_retryable: failureClaims\.retryable,\s*p_retry_after_seconds: failureClaims\.retryAfterSeconds/gu)
  assert.match(adapter, /attachmentId: source\.attachment\.attachmentId,\s*inlineData: source\.attachment\.inlineData/gu)
  assert.match(adapter, /loadOpenExpertMockBankObject/u)
  assert.match(core, /openExpertMockBankFullPayloadSha256\(\{\s*manifestBytes,\s*archiveBytes,\s*\}\) !== job\.payloadSha256/u)
  assert.ok(core.indexOf('openExpertMockBankFullPayloadSha256({') < core.indexOf('dependencies.proveSource({'))
  assert.doesNotMatch(adapter, /extraClaims:\s*\{[^}]*pesel|extraClaims:\s*\{[^}]*credential/gu)
})
