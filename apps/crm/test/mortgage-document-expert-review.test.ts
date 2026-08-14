import assert from 'node:assert/strict'
import test from 'node:test'
import { mortgageArtifactReplayFingerprint } from '../server/utils/mortgage-artifact-command.ts'
import {
  mortgageDocumentExpertReviewMetadataKey,
  mortgageDocumentExpertOverrideReasonSha256,
  normalizeMortgageDocumentExpertOverrideReason,
  withoutMortgageDocumentExpertReviewMetadata,
  withMortgageDocumentExpertReviewMetadata,
} from '../server/utils/mortgage-document-expert-review.ts'

const sha256 = 'a'.repeat(64)

test('normalizes an auditable expert override reason', () => {
  assert.equal(
    normalizeMortgageDocumentExpertOverrideReason(
      '  Sprawdziłem ręcznie wszystkie strony.\r\nDane są kompletne.  ',
      true,
    ),
    'Sprawdziłem ręcznie wszystkie strony.\nDane są kompletne.',
  )
})

test('rejects short, unsupported and client-forged expert overrides', () => {
  assert.throws(
    () => normalizeMortgageDocumentExpertOverrideReason('Za krótko', true),
    (error: any) => error?.statusCode === 400,
  )
  assert.throws(
    () => normalizeMortgageDocumentExpertOverrideReason('To jest wystarczająco długie uzasadnienie.', false),
    (error: any) => error?.statusCode === 400,
  )
  assert.throws(
    () => withMortgageDocumentExpertReviewMetadata({
      metadata: { [mortgageDocumentExpertReviewMetadataKey]: { overrideReasonSha256: sha256 } },
    }, null),
    (error: any) => error?.statusCode === 400,
  )
})

test('expert override reason is represented by a server-owned digest in the replay fingerprint', () => {
  const artifactFor = (reason: string) => withMortgageDocumentExpertReviewMetadata(
    { receivedAt: '2026-08-14T10:00:00.000Z', metadata: {} },
    reason,
  )
  const fingerprintFor = (reason: string) => mortgageArtifactReplayFingerprint({
    kind: 'esis',
    sha256,
    command: {
      type: 'attach_artifact',
      kind: 'esis',
      ...artifactFor(reason),
      deliveries: [],
    },
  })

  assert.notEqual(
    fingerprintFor('Zweryfikowałem ręcznie strony i potwierdzam dokument.'),
    fingerprintFor('Zweryfikowałem ręcznie kompletność i potwierdzam dokument.'),
  )
  assert.equal(
    fingerprintFor('Zweryfikowałem ręcznie strony i potwierdzam dokument.'),
    fingerprintFor('Zweryfikowałem ręcznie strony i potwierdzam dokument.'),
  )
})

test('accepted payload stays review-free while needs_review payload can be matched to its base command', () => {
  const baseArtifact = {
    receivedAt: '2026-08-14T10:00:00.000Z',
    metadata: { source: 'bank' },
  }
  const reason = 'Zweryfikowałem wszystkie strony i potwierdzam ich kompletność.'
  const acceptedArtifact = withMortgageDocumentExpertReviewMetadata(baseArtifact, null)
  assert.deepEqual(acceptedArtifact, baseArtifact)
  assert.equal(
    Object.hasOwn(acceptedArtifact.metadata as object, mortgageDocumentExpertReviewMetadataKey),
    false,
  )

  const reviewedArtifact = withMortgageDocumentExpertReviewMetadata(baseArtifact, reason)
  const stripped = withoutMortgageDocumentExpertReviewMetadata(reviewedArtifact)
  assert.deepEqual(stripped.artifact, baseArtifact)
  assert.equal(
    stripped.overrideReasonSha256,
    mortgageDocumentExpertOverrideReasonSha256(reason),
  )
})

test('rejects malformed expert-review metadata while resolving a prior replay', () => {
  assert.throws(
    () => withoutMortgageDocumentExpertReviewMetadata({
      metadata: {
        [mortgageDocumentExpertReviewMetadataKey]: {
          overrideReasonSha256: sha256,
          clientControlledActor: 'forged',
        },
      },
    }),
    (error: any) => error?.statusCode === 409,
  )
})
