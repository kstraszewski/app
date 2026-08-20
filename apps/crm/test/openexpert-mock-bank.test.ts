import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ERR_INVALID_PASSWORD,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from '@zip.js/zip.js'
import { PDFDocument } from 'pdf-lib'
import {
  addOpenExpertMockBankCalendarDays,
  createOpenExpertMockBankApplicationNumber,
  createOpenExpertMockBankCreditDecisionPdf,
  createOpenExpertMockBankEncryptedArchive,
  createOpenExpertMockBankEsisPdf,
  createOpenExpertMockBankRequestId,
  deriveOpenExpertMockBankChildRequestId,
  isValidOpenExpertMockBankPesel,
  OPENEXPERT_MOCK_BANK_NAME,
  openExpertMockBankCreditDecisionDocumentText,
  openExpertMockBankEsisDocumentText,
  resolveOpenExpertMockBankDocumentDates,
  verifyOpenExpertMockBankEncryptedArchive,
  type OpenExpertMockBankFinancialTerms,
} from '../server/utils/openexpert-mock-bank-documents.ts'
import {
  OPENEXPERT_MOCK_BANK_EMAIL_TEMPLATE_VERSION,
  openExpertMockBankEmailIdempotencyKey,
  openExpertMockBankEmailTemplate,
} from '../server/utils/openexpert-mock-bank-email.ts'

const fontPath = fileURLToPath(
  new URL('../public/fonts/DMSans-VariableFont_opsz,wght.ttf', import.meta.url),
)
const applicationId = '9427198c-bf6c-4b2d-8530-68a5117c5679'
const applicationNumber = createOpenExpertMockBankApplicationNumber(
  applicationId,
  '2026-08-19T08:30:00.000Z',
)
const applicantNames = ['Anna Ściśle Tajna', 'Jan Żółć-Kowalski'] as const
const financialTerms: OpenExpertMockBankFinancialTerms = {
  loanAmount: 500_000,
  currency: 'PLN',
  annualInterestRate: 5.89,
  aprc: 6.41,
  monthlyInstallment: 2_963.19,
  termMonths: 360,
}

async function documentFont(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fontPath))
}

test('creates stable public references and deterministic UUID command children', () => {
  const secondReference = createOpenExpertMockBankApplicationNumber(
    applicationId.toUpperCase(),
    '2026-08-19T20:00:00.000Z',
  )
  const requestId = createOpenExpertMockBankRequestId()
  const acknowledgementId = deriveOpenExpertMockBankChildRequestId(requestId, 'acknowledgement')
  const retriedAcknowledgementId = deriveOpenExpertMockBankChildRequestId(
    requestId,
    'acknowledgement',
  )
  const completenessId = deriveOpenExpertMockBankChildRequestId(requestId, 'completeness')

  assert.match(applicationNumber, /^OEB-20260819-\d{6}$/u)
  assert.equal(secondReference, applicationNumber)
  assert.match(requestId, /^[0-9a-f-]{36}$/u)
  assert.match(acknowledgementId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  assert.equal(retriedAcknowledgementId, acknowledgementId)
  assert.notEqual(completenessId, acknowledgementId)
  assert.equal(
    openExpertMockBankEmailIdempotencyKey('esis', requestId),
    `openexpert-mock-bank/esis/${requestId}/generation-1`,
  )
  assert.equal(
    openExpertMockBankEmailIdempotencyKey('esis', requestId, 2),
    `openexpert-mock-bank/esis/${requestId}/generation-2`,
  )
})

test('uses Warsaw issue dates and keeps a positive decision valid after its due date', () => {
  const dates = resolveOpenExpertMockBankDocumentDates({
    now: new Date('2026-08-18T22:30:00.000Z'),
    decisionDueAt: '2026-09-10',
  })

  assert.deepEqual(dates, {
    issueDate: '2026-08-19',
    esisValidUntil: '2026-09-18',
    decisionValidUntil: '2026-10-10',
  })
  assert.equal(addOpenExpertMockBankCalendarDays('2028-02-28', 1), '2028-02-29')
})

test('builds a personalized ESIS body with every document-validation signal', () => {
  const text = openExpertMockBankEsisDocumentText({
    applicationNumber,
    applicantNames,
    issueDate: '2026-08-19',
    validUntil: '2026-09-18',
    financialTerms,
  })

  assert.match(text, /EUROPEJSKI ZNORMALIZOWANY ARKUSZ INFORMACYJNY \(ESIS\)/u)
  assert.match(text, new RegExp(OPENEXPERT_MOCK_BANK_NAME, 'u'))
  assert.match(text, new RegExp(applicationNumber, 'u'))
  for (const applicantName of applicantNames) assert.match(text, new RegExp(applicantName, 'u'))
  assert.match(text, /500[\s\u00a0]000,00[\s\u00a0]zł/u)
  assert.match(text, /Waluta kredytu i spłaty: PLN/u)
  assert.match(text, /Oprocentowanie nominalne: 5,89%/u)
  assert.match(text, /Rzeczywista Roczna Stopa Oprocentowania \(RRSO\): 6,41%/u)
  assert.match(text, /2(?:[\s\u00a0]?963),19[\s\u00a0]zł/u)
  assert.match(text, /360 równych ratach miesięcznych/u)
  assert.match(text, /2026-09-18/u)
})

test('makes both credit-decision outcomes unambiguous and dates positive validity', () => {
  const common = {
    applicationNumber,
    applicantNames,
    issueDate: '2026-08-19',
    financialTerms,
  }
  const positive = openExpertMockBankCreditDecisionDocumentText({
    ...common,
    outcome: 'positive',
    validUntil: '2026-10-10',
  })
  const negative = openExpertMockBankCreditDecisionDocumentText({
    ...common,
    outcome: 'negative',
    reason: 'Niespełnienie demonstracyjnego kryterium zdolności kredytowej.',
  })

  assert.match(positive, /DECYZJA KREDYTOWA - POZYTYWNA/u)
  assert.match(positive, /akceptuje wniosek o udzielenie kredytu/u)
  assert.match(positive, /500[\s\u00a0]000,00[\s\u00a0]zł/u)
  assert.match(positive, /Data wydania decyzji:.*2026-08-19/u)
  assert.match(positive, /ważna do.*2026-10-10/u)
  assert.match(negative, /DECYZJA KREDYTOWA - NEGATYWNA/u)
  assert.match(negative, /odmawia udzielenia kredytu/u)
  assert.match(negative, /Niespełnienie demonstracyjnego kryterium/u)
  for (const applicantName of applicantNames) {
    assert.match(positive, new RegExp(applicantName, 'u'))
    assert.match(negative, new RegExp(applicantName, 'u'))
  }
})

test('renders non-empty textual PDFs for ESIS and both credit decisions', async () => {
  const fontBytes = await documentFont()
  const common = {
    applicationNumber,
    applicantNames,
    issueDate: '2026-08-19',
    financialTerms,
    fontBytes,
  }
  const [esis, positive, negative] = await Promise.all([
    createOpenExpertMockBankEsisPdf({ ...common, validUntil: '2026-09-18' }),
    createOpenExpertMockBankCreditDecisionPdf({
      ...common,
      outcome: 'positive',
      validUntil: '2026-10-10',
    }),
    createOpenExpertMockBankCreditDecisionPdf({
      ...common,
      outcome: 'negative',
      reason: 'Niespełnienie demonstracyjnego kryterium zdolności kredytowej.',
    }),
  ])

  for (const document of [esis, positive, negative]) {
    assert.equal(new TextDecoder().decode(document.bytes.slice(0, 5)), '%PDF-')
    assert.ok(document.bytes.byteLength > 10_000)
    assert.match(document.fileName, new RegExp(`^${applicationNumber}-.+\\.pdf$`, 'u'))
    const parsed = await PDFDocument.load(document.bytes)
    assert.ok(parsed.getPageCount() >= 1)
    assert.equal(parsed.getAuthor(), OPENEXPERT_MOCK_BANK_NAME)
    assert.match(parsed.getTitle() ?? '', /ESIS|DECYZJA KREDYTOWA/u)
  }
})

test('encrypts the PDF in an AES-256 ZIP readable only with the PESEL password', async () => {
  const pesel = '85010112345'
  const document = await createOpenExpertMockBankEsisPdf({
    applicationNumber,
    applicantNames,
    issueDate: '2026-08-19',
    validUntil: '2026-09-18',
    financialTerms,
    fontBytes: await documentFont(),
  })
  const archive = await createOpenExpertMockBankEncryptedArchive({ document, pesel })

  await verifyOpenExpertMockBankEncryptedArchive({
    bytes: archive.bytes,
    kind: 'esis',
    applicationNumber,
    pesel,
  })

  assert.ok(archive.bytes.byteLength > 0)
  assert.equal(archive.fileName, `${applicationNumber}-formularz-ESIS.zip`)
  assert.deepEqual(
    Object.keys(archive).sort(),
    ['applicationNumber', 'bytes', 'entryName', 'fileName', 'kind', 'mediaType'].sort(),
  )

  const reader = new ZipReader(new Uint8ArrayReader(archive.bytes))
  try {
    const entries = await reader.getEntries()
    assert.equal(entries.length, 1)
    const entry = entries[0]
    assert.ok(entry && !entry.directory)
    assert.equal(entry.filename, document.fileName)
    assert.equal(entry.encrypted, true)
    assert.equal(entry.zipCrypto, false)
    assert.equal(entry.extraFieldAES?.strength, 3)
    const extracted = await entry.getData(new Uint8ArrayWriter(), { password: pesel })
    assert.deepEqual(extracted, document.bytes)
  } finally {
    await reader.close()
  }

  const wrongPasswordReader = new ZipReader(new Uint8ArrayReader(archive.bytes))
  try {
    const entries = await wrongPasswordReader.getEntries()
    const entry = entries[0]
    assert.ok(entry && !entry.directory)
    await assert.rejects(
      entry.getData(new Uint8ArrayWriter(), { password: '85010112346' }),
      new RegExp(ERR_INVALID_PASSWORD, 'u'),
    )
  } finally {
    await wrongPasswordReader.close()
  }

  assert.equal(isValidOpenExpertMockBankPesel('850 101 123 45'), true)
  assert.equal(isValidOpenExpertMockBankPesel('8501011234'), false)
  await assert.rejects(
    createOpenExpertMockBankEncryptedArchive({ document, pesel: '8501011234' }),
    /11-cyfrowym numerem PESEL/u,
  )
})

test('builds accessible Polish mail without exposing the PESEL value', () => {
  const pesel = '85010112345'
  const template = openExpertMockBankEmailTemplate({
    kind: 'credit_decision',
    applicationNumber,
    applicantNames: ['Anna <Ściśle> & Tajna', 'Jan Żółć-Kowalski'],
    issueDate: '2026-08-19',
    validUntil: '2026-10-10',
    decisionOutcome: 'positive',
  })

  assert.equal(OPENEXPERT_MOCK_BANK_EMAIL_TEMPLATE_VERSION, 2)
  assert.equal(template.subject, `[DEMO] OpenExpert Bank — decyzja pozytywna — ${applicationNumber}`)
  assert.match(template.html, /<html lang="pl" dir="ltr">/u)
  assert.match(template.html, /<body lang="pl" dir="ltr"/u)
  assert.equal(template.html.match(/<h1\b/gu)?.length, 1)
  assert.ok((template.html.match(/role="presentation"/gu)?.length ?? 0) >= 5)
  assert.match(template.html, /ŚRODOWISKO DEMO/u)
  assert.match(template.html, /DECYZJA POZYTYWNA/u)
  assert.match(template.html, /10 października 2026/u)
  assert.match(template.html, /Co dalej\?/u)
  assert.match(template.html, /Anna &lt;Ściśle&gt; &amp; Tajna/u)
  assert.match(template.text, /Jan Żółć-Kowalski/u)
  assert.match(template.text, new RegExp(applicationNumber, 'u'))
  assert.match(template.text, /Status: DECYZJA POZYTYWNA/u)
  assert.match(template.text, /Ważny do: 10 października 2026/u)
  assert.match(template.text, /Hasłem do archiwum ZIP jest 11-cyfrowy numer PESEL/u)
  assert.ok(!template.html.includes(pesel))
  assert.ok(!template.text.includes(pesel))
  assert.doesNotMatch(template.html, /<a\b|https?:\/\/|unsubscribe|wypisz/iu)
  assert.doesNotMatch(template.text, /https?:\/\/|unsubscribe|wypisz/iu)
})

test('renders a distinct ESIS notification with document validity and safe instructions', () => {
  const template = openExpertMockBankEmailTemplate({
    kind: 'esis',
    applicationNumber,
    applicantNames,
    issueDate: '2026-08-19',
    validUntil: '2026-09-18',
  })

  assert.equal(template.subject, `[DEMO] OpenExpert Bank — formularz ESIS — ${applicationNumber}`)
  assert.match(template.html, /Formularz informacyjny ESIS jest gotowy/u)
  assert.match(template.html, /ESIS GOTOWY/u)
  assert.match(template.html, /18 września 2026/u)
  assert.match(template.text, /Zapisz załączone archiwum ZIP/u)
  assert.match(template.text, /dodaj go do właściwego wniosku w OpenExpert/u)
})
