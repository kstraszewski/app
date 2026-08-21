import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBankMailAgentPrompt,
  buildBankMailAgentPromptPayload,
  buildBankMailReanalysisPrompt,
  buildBankMailReanalysisPromptPayload,
  sanitizeBankMailAgentText,
} from '../server/utils/bank-mail-agent-prompt.ts'

test('redacts protected identifiers, addresses and links before model input', () => {
  const result = sanitizeBankMailAgentText(
    'PESEL: 90010112345, NIP 123-456-32-18, kontakt ekspert@bank.pl, https://bank.pl/a',
    2_000,
  )

  assert.doesNotMatch(result, /90010112345|123-456-32-18|ekspert@bank\.pl|https:\/\//u)
  assert.match(result, /PESEL \[identyfikator chroniony\]/u)
  assert.match(result, /NIP \[identyfikator chroniony\]/u)
  assert.match(result, /\[adres e-mail\]/u)
  assert.match(result, /\[link\]/u)
})

test('keeps useful non-sensitive application references and bounds attachments', () => {
  const payload = buildBankMailAgentPromptPayload({
    subject: 'Decyzja ABC/2026/1234',
    bodyText: 'Numer wniosku: ABC/2026/1234',
    bodyTruncated: false,
    attachments: Array.from({ length: 12 }, (_, index) => ({
      filename: index === 0 ? 'decyzja-90010112345.pdf' : `plik-${index}.pdf`,
      mimeType: 'APPLICATION/PDF',
      size: 1_024,
      encrypted: index === 0,
    })),
  })

  assert.equal(payload.contentTrust, 'untrusted')
  assert.equal(payload.message.subject, 'Decyzja ABC/2026/1234')
  assert.match(payload.message.bodyText, /ABC\/2026\/1234/u)
  assert.equal(payload.message.attachments.length, 10)
  assert.equal(payload.message.attachmentsTruncated, true)
  assert.doesNotMatch(payload.message.attachments[0]?.filename ?? '', /90010112345/u)
  assert.equal(payload.message.attachments[0]?.token, 'attachment-1')
})

test('serialized prompt carries no provider identifiers or protected values', () => {
  const prompt = buildBankMailAgentPrompt({
    subject: 'Decyzja',
    bodyText: 'PESEL 90010112345',
    bodyTruncated: false,
    attachments: [],
  })

  assert.doesNotMatch(prompt, /90010112345|providerMessageId|connectionId/u)
  assert.match(prompt, /"noAutomaticAttachment":true/u)
})

test('builds a separate advisory-only reanalysis surface without request identifiers', () => {
  const input = {
    subject: 'Ponowna ocena ABC/2026/1234',
    bodyText: 'PESEL 90010112345, wniosek ABC/2026/1234',
    bodyTruncated: false,
    attachments: [],
  }
  const payload = buildBankMailReanalysisPromptPayload(input)
  const prompt = buildBankMailReanalysisPrompt(input)

  assert.equal(payload.surface, 'bank-mail-reanalysis')
  assert.equal(payload.task, 'advisory-reassess-case-match')
  assert.deepEqual(payload.constraints, {
    advisoryOnly: true,
    noCanonicalMutations: true,
    noAutomaticAttachment: true,
    noProtectedIdentifiersIncluded: true,
    useTrustedToolsForScopeAndSenderIdentity: true,
    mustRecordReanalysisResult: true,
  })
  assert.match(prompt, /ABC\/2026\/1234/u)
  assert.doesNotMatch(prompt, /90010112345|reanalysisRequestId|analysisRunId|intakeId/u)
})
