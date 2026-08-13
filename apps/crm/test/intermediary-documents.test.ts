import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'
import { createEmptyIntermediarySettings } from '../shared/intermediary-settings.ts'
import { buildIntermediaryDocumentContent } from '../server/utils/intermediary-document-content.ts'
import {
  generateIntermediaryDocumentPdf,
  OfiSinglePageOverflowError,
  RodoSinglePageOverflowError,
} from '../server/utils/intermediary-document-pdf.ts'

const fontPath = fileURLToPath(
  new URL('../public/fonts/DMSans-VariableFont_opsz,wght.ttf', import.meta.url),
)

async function documentFont(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fontPath))
}

function completeSettings() {
  const settings = createEmptyIntermediarySettings()
  settings.intermediary = {
    legalName: 'Bezpieczny Kredyt sp. z o.o.',
    registeredOffice: 'Warszawa',
    addressLine: 'ul. Prosta 1',
    postalCode: '00-001',
    city: 'Warszawa',
    country: 'Polska',
    email: 'kontakt@bezpieczny-kredyt.pl',
    phone: '+48 22 000 00 00',
    website: 'https://bezpieczny-kredyt.pl',
    mortgageRegisterNumber: 'RPH000001',
    mortgageRegisterUrl: 'https://rpkip.knf.gov.pl/',
  }
  settings.relationship.authorizationScope = 'Analiza potrzeb i pośrednictwo w zawarciu umowy kredytu hipotecznego.'
  settings.relationship.cooperatingLenderBankIds = ['bank-1', 'bank-2', 'bank-3', 'bank-4', 'bank-5']
  settings.relationship.cooperatingLenderNames = [
    'Bank Alfa Spółka Akcyjna',
    'Bank Beta Spółka Akcyjna',
    'Bank Gamma Spółka Akcyjna',
    'Bank Delta Spółka Akcyjna',
    'Bank Epsilon Spółka Akcyjna',
  ]
  settings.complaints.internalProcedure = 'Reklamację można złożyć e-mailem lub pisemnie. Odpowiedź zostanie udzielona w terminie ustawowym.'
  settings.complaints.externalProcedure = 'Konsument może skorzystać z postępowania przed Rzecznikiem Finansowym.'
  settings.remuneration.lenderRemunerationDescription = 'Prowizja wypłacana przez kredytodawcę po uruchomieniu kredytu.'
  settings.privacy.controllerName = settings.intermediary.legalName
  settings.privacy.controllerAddress = 'ul. Prosta 1, 00-001 Warszawa'
  settings.privacy.controllerEmail = 'rodo@bezpieczny-kredyt.pl'
  settings.privacy.purposesAndLegalBases = 'Obsługa procesu kredytowego — art. 6 ust. 1 lit. b RODO; realizacja obowiązków prawnych — art. 6 ust. 1 lit. c RODO.'
  settings.privacy.recipientCategories = 'Kredytodawcy, dostawcy IT, operatorzy korespondencji i uprawnione organy publiczne.'
  settings.privacy.retentionPolicy = 'Przez okres obsługi sprawy, a następnie do upływu terminów przedawnienia i okresów wymaganych prawem.'
  settings.privacy.dataSubjectRights = 'Prawo dostępu, sprostowania, usunięcia, ograniczenia, przenoszenia danych oraz wniesienia sprzeciwu — w przypadkach przewidzianych w RODO.'
  settings.privacy.dataProvisionRequirements = 'Podanie danych jest dobrowolne, ale niezbędne do analizy i obsługi procesu kredytowego.'
  return settings
}

const generatedAt = '2026-08-13T08:30:00.000Z'

test('builds complete OFI and RODO content from one organization revision', () => {
  const settings = completeSettings()
  const ofi = buildIntermediaryDocumentContent({
    kind: 'ofi',
    settings,
    organizationName: 'Bezpieczny Kredyt',
    revision: 7,
    generatedAt,
  })
  const rodo = buildIntermediaryDocumentContent({
    kind: 'rodo',
    settings,
    organizationName: 'Bezpieczny Kredyt',
    revision: 7,
    generatedAt,
  })

  assert.equal(ofi.draft, false)
  assert.equal(rodo.draft, false)
  assert.equal(ofi.revision, 7)
  assert.match(ofi.legalReference, /art\. 17/iu)
  assert.match(rodo.legalReference, /art\. 13/iu)
  assert.ok(ofi.sections.some(section => section.title.includes('Wynagrodzenie')))
  assert.ok(rodo.sections.some(section => section.title.includes('Prawa osoby')))
})

test('marks an incomplete preview as a draft and lists missing fields', () => {
  const content = buildIntermediaryDocumentContent({
    kind: 'ofi',
    settings: createEmptyIntermediarySettings(),
    organizationName: 'Organizacja testowa',
    revision: 0,
    generatedAt,
  })

  assert.equal(content.draft, true)
  assert.ok(content.missing.includes('firma pośrednika'))
  assert.ok(content.missing.includes('numer RPH pośrednika'))
})

test('uses the lender-name snapshot from the saved revision for tied intermediaries', () => {
  const settings = completeSettings()
  settings.relationship.isTiedMortgageIntermediary = true
  settings.relationship.lenderBankIds = ['bank-a', 'bank-b']
  settings.relationship.lenderNames = [
    'Bank Alfa Spółka Akcyjna',
    'Bank Beta Spółka Akcyjna',
  ]

  const content = buildIntermediaryDocumentContent({
    kind: 'ofi',
    settings,
    organizationName: 'Bezpieczny Kredyt',
    revision: 8,
    generatedAt,
  })
  const status = content.sections.find(section => section.title.includes('Status, doradztwo'))
  const lenders = status?.items?.find(item => item.label.includes('w imieniu i na rzecz'))

  assert.equal(content.draft, false)
  assert.equal(
    lenders?.value,
    'Bank Alfa Spółka Akcyjna, Bank Beta Spółka Akcyjna',
  )
  assert.deepEqual(lenders?.values, settings.relationship.lenderNames)
  assert.equal(lenders?.presentation, 'lender-list')
})

test('renders OFI and RODO on exactly one A4 page', async () => {
  const fontBytes = await documentFont()
  const settings = completeSettings()

  for (const kind of ['ofi', 'rodo'] as const) {
    const content = buildIntermediaryDocumentContent({
      kind,
      settings,
      organizationName: 'Bezpieczny Kredyt',
      revision: 7,
      generatedAt,
    })
    const bytes = await generateIntermediaryDocumentPdf(content, {
      fontBytes,
      primaryColor: '#2563eb',
    })
    const parsed = await PDFDocument.load(bytes)

    const outputDirectory = process.env.INTERMEDIARY_PDF_OUTPUT_DIR?.trim()
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true })
      await writeFile(`${outputDirectory}/${kind.toUpperCase()}-sample.pdf`, bytes)
    }

    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-')
    assert.ok(bytes.byteLength > 10_000)
    assert.equal(parsed.getPageCount(), 1)
    assert.equal(parsed.getTitle(), content.title)
    assert.equal(parsed.getAuthor(), 'Bezpieczny Kredyt')
  }
})

test('renders an incomplete RODO preview on one page with a draft warning', async () => {
  const content = buildIntermediaryDocumentContent({
    kind: 'rodo',
    settings: createEmptyIntermediarySettings(),
    organizationName: 'Organizacja testowa',
    revision: 0,
    generatedAt,
  })
  const bytes = await generateIntermediaryDocumentPdf(content, {
    fontBytes: await documentFont(),
    primaryColor: '#2563eb',
  })
  const parsed = await PDFDocument.load(bytes)

  assert.equal(content.draft, true)
  assert.equal(parsed.getPageCount(), 1)
})

test('renders a complete agent OFI with separate represented and cooperating lender lists on one page', async () => {
  const settings = completeSettings()
  const cooperatingNames = Array.from(
    { length: 12 },
    (_, index) => `Bank Partner ${index + 1}, Spółka Akcyjna`,
  )
  settings.providerRole = 'agent'
  settings.agent.legalName = 'Agent Finansowy sp. z o.o.'
  settings.agent.roleDescription = 'Agent pośrednika kredytu hipotecznego obsługujący konsumenta'
  settings.agent.registerNumber = 'RHA000001'
  settings.relationship.isTiedMortgageIntermediary = true
  settings.relationship.lenderBankIds = ['represented-1', 'represented-2', 'represented-3']
  settings.relationship.lenderNames = [
    'Kredytodawca Pierwszy Spółka Akcyjna',
    'Kredytodawca Drugi Spółka Akcyjna',
    'Kredytodawca Trzeci Spółka Akcyjna',
  ]
  settings.relationship.cooperatingLenderBankIds = cooperatingNames.map((_, index) => `partner-${index + 1}`)
  settings.relationship.cooperatingLenderNames = cooperatingNames
  settings.remuneration.lenderRemunerationAmountKnown = true
  settings.remuneration.lenderRemunerationAmountDescription = 'Do 2% uruchomionej kwoty kredytu, zależnie od kredytodawcy i produktu.'
  settings.remuneration.chargesClientFees = true
  settings.remuneration.clientFeeDescription = '1 000 zł, płatne po wykonaniu usługi.'

  const content = buildIntermediaryDocumentContent({
    kind: 'ofi',
    settings,
    organizationName: 'Bezpieczny Kredyt',
    revision: 9,
    generatedAt,
  })
  const status = content.sections.find(section => section.title.includes('Status, doradztwo'))
  const lenderLists = status?.items?.filter(item => item.presentation === 'lender-list') ?? []
  const agent = content.sections.find(section => section.title.includes('Agent obsługujący'))
  const representedIntermediary = agent?.items?.find(item => item.label === 'Reprezentowany pośrednik')

  assert.deepEqual(lenderLists[0]?.values, settings.relationship.lenderNames)
  assert.deepEqual(lenderLists[1]?.values, cooperatingNames)
  assert.equal(representedIntermediary?.value, settings.intermediary.legalName)

  const bytes = await generateIntermediaryDocumentPdf(content, {
    fontBytes: await documentFont(),
    primaryColor: '#2563eb',
  })
  const parsed = await PDFDocument.load(bytes)
  assert.equal(parsed.getPageCount(), 1)

  const outputDirectory = process.env.INTERMEDIARY_PDF_OUTPUT_DIR?.trim()
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: true })
    await writeFile(`${outputDirectory}/OFI-agent-12-bankow.pdf`, bytes)
  }
})

test('renders a complete RODO with all conditional disclosures on one page', async () => {
  const settings = completeSettings()
  settings.privacy.dpoAppointed = true
  settings.privacy.dpoName = 'Inspektor ochrony danych'
  settings.privacy.dpoEmail = 'iod@bezpieczny-kredyt.pl'
  settings.privacy.dpoPhone = '+48 22 000 00 01'
  settings.privacy.usesLegitimateInterests = true
  settings.privacy.legitimateInterestsDescription = 'Ustalenie, dochodzenie i obrona roszczeń oraz zapewnienie bezpieczeństwa usług.'
  settings.privacy.transfersOutsideEea = true
  settings.privacy.transferSafeguardsDescription = 'Dane mogą być przekazywane na podstawie standardowych klauzul umownych zatwierdzonych przez Komisję Europejską.'
  settings.privacy.usesAutomatedDecisionMaking = true
  settings.privacy.automatedDecisionMakingDescription = 'Profilowanie wspiera dopasowanie oferty, lecz nie wywołuje samodzielnie skutków prawnych wobec klienta.'
  settings.privacy.obtainsDataIndirectly = true
  settings.privacy.indirectDataCategories = 'Dane identyfikacyjne, kontaktowe oraz informacje o zobowiązaniach.'
  settings.privacy.indirectDataSources = 'Kredytodawcy, biura informacji gospodarczej oraz publiczne rejestry.'
  settings.privacy.privacyNoticeUrl = 'https://bezpieczny-kredyt.pl/rodo'

  const content = buildIntermediaryDocumentContent({
    kind: 'rodo',
    settings,
    organizationName: 'Bezpieczny Kredyt',
    revision: 10,
    generatedAt,
  })
  const bytes = await generateIntermediaryDocumentPdf(content, {
    fontBytes: await documentFont(),
    primaryColor: '#2563eb',
  })
  const parsed = await PDFDocument.load(bytes)

  assert.equal(content.draft, false)
  assert.match(content.legalReference, /art\. 14/iu)
  assert.equal(parsed.getPageCount(), 1)
})

test('fails explicitly instead of clipping an OFI that cannot remain readable on one page', async () => {
  const settings = completeSettings()
  settings.complaints.internalProcedure = 'Rozbudowana procedura reklamacyjna. '.repeat(220)
  const content = buildIntermediaryDocumentContent({
    kind: 'ofi',
    settings,
    organizationName: 'Bezpieczny Kredyt',
    revision: 10,
    generatedAt,
  })

  await assert.rejects(
    generateIntermediaryDocumentPdf(content, {
      fontBytes: await documentFont(),
      primaryColor: '#2563eb',
    }),
    (error: unknown) => (
      error instanceof OfiSinglePageOverflowError
      && error.code === 'OFI_SINGLE_PAGE_OVERFLOW'
      && error.requiredHeight > error.availableHeight
    ),
  )
})

test('fails explicitly instead of clipping RODO that cannot remain readable on one page', async () => {
  const settings = completeSettings()
  settings.privacy.purposesAndLegalBases = 'Rozbudowany opis celu i podstawy prawnej. '.repeat(220)
  const content = buildIntermediaryDocumentContent({
    kind: 'rodo',
    settings,
    organizationName: 'Bezpieczny Kredyt',
    revision: 11,
    generatedAt,
  })

  await assert.rejects(
    generateIntermediaryDocumentPdf(content, {
      fontBytes: await documentFont(),
      primaryColor: '#2563eb',
    }),
    (error: unknown) => (
      error instanceof RodoSinglePageOverflowError
      && error.code === 'RODO_SINGLE_PAGE_OVERFLOW'
      && error.requiredHeight > error.availableHeight
    ),
  )
})
