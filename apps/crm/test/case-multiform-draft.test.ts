import assert from 'node:assert/strict'
import test from 'node:test'
import {
  caseMultiformSelectionFingerprint,
  parseCaseMultiformDraftPutInput,
} from '../server/utils/case-multiform-draft-validation.ts'

const documentId = '11111111-1111-4111-8111-111111111111'
const selectionFingerprint = 'a'.repeat(64)

function validInput() {
  return {
    selectionFingerprint,
    revision: 0,
    activeStep: 1,
    intakeAnswers: { incomeSource: 'employment' },
    formValues: { firstName: 'Jan' },
    collectionCounts: { applicants: 2 },
    selectedDocumentIds: [documentId],
  }
}

test('parses a bounded Multiwniosek stepper draft', () => {
  assert.deepEqual(parseCaseMultiformDraftPutInput(validInput()), validInput())
})

test('restricts the stepper to steps 1 through 5', () => {
  assert.throws(
    () => parseCaseMultiformDraftPutInput({ ...validInput(), activeStep: 0 }),
    error => error instanceof Error && error.message.includes('activeStep'),
  )
  assert.throws(
    () => parseCaseMultiformDraftPutInput({ ...validInput(), activeStep: 6 }),
    error => error instanceof Error && error.message.includes('activeStep'),
  )
})

test('rejects duplicate or malformed selected document ids', () => {
  assert.throws(
    () => parseCaseMultiformDraftPutInput({
      ...validInput(),
      selectedDocumentIds: [documentId, documentId],
    }),
    error => error instanceof Error && error.message.includes('duplicates'),
  )
  assert.throws(
    () => parseCaseMultiformDraftPutInput({
      ...validInput(),
      selectedDocumentIds: ['not-a-uuid'],
    }),
    error => error instanceof Error && error.message.includes('UUID'),
  )
})

test('rejects oversized form values before persistence', () => {
  assert.throws(
    () => parseCaseMultiformDraftPutInput({
      ...validInput(),
      formValues: { notes: 'x'.repeat(1024 * 1024) },
    }),
    error => error instanceof Error && error.message.includes('too large'),
  )
})

test('selection fingerprint is deterministic for the selected sets', () => {
  const first = caseMultiformSelectionFingerprint({
    applicationIds: ['application-b', 'application-a'],
    offerIds: ['offer-b', 'offer-a'],
    templateIds: ['template-b', 'template-a'],
  })
  const second = caseMultiformSelectionFingerprint({
    applicationIds: ['application-a', 'application-b'],
    offerIds: ['offer-a', 'offer-b'],
    templateIds: ['template-a', 'template-b'],
  })
  assert.match(first, /^[0-9a-f]{64}$/)
  assert.equal(first, second)
})
