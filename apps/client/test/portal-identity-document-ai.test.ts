import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  analyzePortalIdentityDocument,
  isPortalIdentityDocumentType,
  isValidPesel,
  isValidPolishIdentityCardNumber,
  peselDateOfBirth,
  portalIdentityDocumentAiGatewayModel,
  portalIdentityDocumentAiModel,
  resolvePortalIdentityDocumentExtraction,
  type PortalIdentityDocumentObservation,
} from '../server/utils/portal-identity-document-ai.ts'

function observation(
  overrides: Partial<PortalIdentityDocumentObservation> = {},
): PortalIdentityDocumentObservation {
  return {
    documentKind: 'polish_identity_card',
    contentQuality: 'readable',
    belongsToExpectedPerson: 'match',
    givenNames: ['Jan'],
    lastName: 'Kowalski',
    pesel: '44051401458',
    dateOfBirth: '1944-05-14',
    documentNumber: 'ABA300000',
    expiresOn: '2031-06-30',
    citizenship: 'polskie',
    confidence: 0.98,
    fieldConfidence: {
      names: 0.99,
      pesel: 0.99,
      dateOfBirth: 0.99,
      documentNumber: 0.99,
      expiresOn: 0.98,
      citizenship: 0.98,
    },
    anomalyCodes: [],
    ...overrides,
  }
}

describe('portal identity-document recognition boundary', () => {
  it('scans only explicit identity checklist document types', () => {
    assert.equal(isPortalIdentityDocumentType('identity.document'), true)
    assert.equal(isPortalIdentityDocumentType('IDENTITY_DOCUMENT'), true)
    assert.equal(isPortalIdentityDocumentType('bank_statement'), false)
    assert.equal(isPortalIdentityDocumentType('client_upload'), false)
  })

  it('validates PESEL and Polish identity-card checksums deterministically', () => {
    assert.equal(isValidPesel('44051401458'), true)
    assert.equal(peselDateOfBirth('44051401458'), '1944-05-14')
    assert.equal(isValidPesel('44051401459'), false)
    assert.equal(isValidPolishIdentityCardNumber('ABA300000'), true)
    assert.equal(isValidPolishIdentityCardNumber('ABA300001'), false)
  })
})

describe('portal identity-document profile update', () => {
  it('fills empty person fields and records bounded document provenance', () => {
    const result = resolvePortalIdentityDocumentExtraction(
      observation(),
      {
        displayName: 'Jan Kowalski',
        firstName: null,
        lastName: null,
        pesel: null,
        dateOfBirth: null,
        metadata: { retained: true },
      },
      {
        documentId: 'document-1',
        extractedAt: '2026-08-19T12:00:00.000Z',
      },
    )

    assert.equal(result.status, 'applied')
    assert.equal(result.personPatch.first_name, 'Jan')
    assert.equal(result.personPatch.last_name, 'Kowalski')
    assert.equal(result.personPatch.pesel, '44051401458')
    assert.equal(result.personPatch.date_of_birth, '1944-05-14')
    assert.deepEqual(result.filledFields, [
      'firstName',
      'lastName',
      'pesel',
      'dateOfBirth',
      'identityDocumentNumber',
      'identityDocumentExpiresOn',
      'citizenship',
    ])
    assert.equal(
      (result.personPatch.metadata as any).identityDocument.documentNumber,
      'ABA300000',
    )
    assert.equal((result.personPatch.metadata as any).retained, true)
  })

  it('does not write anything when the document belongs to another person', () => {
    const result = resolvePortalIdentityDocumentExtraction(
      observation({ belongsToExpectedPerson: 'mismatch' }),
      { displayName: 'Jan Kowalski', metadata: {} },
      { documentId: 'document-2', extractedAt: '2026-08-19T12:00:00.000Z' },
    )
    assert.equal(result.status, 'needs_review')
    assert.deepEqual(result.personPatch, {})
    assert.ok(result.reasonCodes.includes('person_mismatch'))
  })

  it('never overwrites a conflicting existing PESEL', () => {
    const result = resolvePortalIdentityDocumentExtraction(
      observation(),
      {
        displayName: 'Jan Kowalski',
        firstName: 'Jan',
        lastName: 'Kowalski',
        pesel: '02070803628',
        dateOfBirth: null,
        metadata: {},
      },
      { documentId: 'document-3', extractedAt: '2026-08-19T12:00:00.000Z' },
    )
    assert.equal(result.status, 'applied_with_review')
    assert.equal('pesel' in result.personPatch, false)
    assert.ok(result.reasonCodes.includes('pesel_conflict'))
  })
})

describe('portal identity-document Gemini request', () => {
  it('uses the current Flash-Lite model with EU zero-retention gateway policy', async () => {
    let captured: any
    const output = observation()
    const result = await analyzePortalIdentityDocument({
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      mediaType: 'image/jpeg',
      expectedPersonName: 'Jan Kowalski',
      generate: async (request) => {
        captured = request
        return { output }
      },
    })

    assert.deepEqual(result, output)
    assert.equal(portalIdentityDocumentAiModel, 'gemini-3.5-flash-lite')
    assert.equal(portalIdentityDocumentAiGatewayModel, 'google/gemini-3.5-flash-lite')
    assert.deepEqual(captured.providerOptions.gateway.only, ['vertex'])
    assert.equal(captured.providerOptions.gateway.inferenceRegion, 'eu')
    assert.equal(captured.providerOptions.gateway.zeroDataRetention, true)
    assert.equal(captured.providerOptions.gateway.disallowPromptTraining, true)
    assert.equal(captured.telemetry.isEnabled, false)
  })
})
