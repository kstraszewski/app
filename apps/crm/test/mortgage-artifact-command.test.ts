import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mortgageArtifactReplayFingerprint,
  normalizeMortgageDeliveries,
  parseMortgageArtifactAttachmentCommand,
  parsePublicMortgageApplicationCommand,
} from '../server/utils/mortgage-artifact-command.ts'

const commandId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const documentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const recipientA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const recipientB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const sha256 = '1'.repeat(64)

function attachmentCommand(overrides: Record<string, unknown> = {}) {
  return {
    type: 'attach_artifact',
    kind: 'credit_decision',
    documentId,
    receivedAt: '2026-08-13T12:00:00+02:00',
    validUntil: '2026-09-15T10:00:00.000Z',
    decisionOutcome: 'positive',
    metadata: { source: 'bank', nested: { b: 2, a: 1 } },
    deliveries: [
      {
        recipientClientId: recipientB,
        deliveredAt: '2026-08-14T12:00:00+02:00',
        channel: 'email_attachment',
        evidenceReference: ' mail-b ',
        metadata: { second: true, first: true },
      },
      {
        recipientClientId: recipientA,
        deliveredAt: '2026-08-14T10:00:00.000Z',
        channel: 'client_portal_download',
      },
    ],
    ...overrides,
  }
}

test('artifact replay fingerprint is canonical and ignores a replacement documentId', () => {
  const first = mortgageArtifactReplayFingerprint({
    kind: 'credit_decision',
    sha256,
    command: attachmentCommand(),
  })
  const second = mortgageArtifactReplayFingerprint({
    kind: 'credit_decision',
    sha256: sha256.toUpperCase(),
    command: attachmentCommand({
      documentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      receivedAt: '2026-08-13T10:00:00.000Z',
      metadata: { nested: { a: 1, b: 2 }, source: 'bank' },
      deliveries: [...(attachmentCommand().deliveries as unknown[])].reverse(),
    }),
  })

  assert.equal(first, second)
})

test('artifact replay fingerprint covers metadata, outcome, dates and deliveries', () => {
  const original = mortgageArtifactReplayFingerprint({
    kind: 'credit_decision',
    sha256,
    command: attachmentCommand(),
  })
  for (const command of [
    attachmentCommand({ metadata: { source: 'another-bank' } }),
    attachmentCommand({ decisionOutcome: 'negative' }),
    attachmentCommand({ validUntil: '2026-09-16T10:00:00.000Z' }),
    attachmentCommand({ deliveries: [] }),
  ]) {
    assert.notEqual(
      mortgageArtifactReplayFingerprint({ kind: 'credit_decision', sha256, command }),
      original,
    )
  }
  assert.notEqual(
    mortgageArtifactReplayFingerprint({
      kind: 'credit_decision',
      sha256: '2'.repeat(64),
      command: attachmentCommand(),
    }),
    original,
  )
})

test('public command parser refuses attach_artifact while the dedicated parser accepts it', () => {
  const envelope = {
    commandId,
    expectedRevision: 3,
    command: attachmentCommand(),
  }
  assert.throws(
    () => parsePublicMortgageApplicationCommand(envelope),
    /Unsupported mortgage application command/,
  )
  const parsed = parseMortgageArtifactAttachmentCommand(envelope)
  assert.equal((parsed.command as Record<string, unknown>).type, 'attach_artifact')
})

test('delivery validation applies limits and rejects duplicate recipients', () => {
  const delivery = {
    recipientClientId: recipientA,
    deliveredAt: '2026-08-14T10:00:00.000Z',
    channel: 'client_portal_download',
  }
  assert.throws(
    () => normalizeMortgageDeliveries([delivery, delivery]),
    /duplicate recipientClientId/,
  )
  assert.throws(
    () => normalizeMortgageDeliveries(Array.from({ length: 33 }, () => delivery)),
    /at most 32 entries/,
  )
})
