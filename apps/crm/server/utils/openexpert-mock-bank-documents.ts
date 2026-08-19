import fontkit from '@pdf-lib/fontkit'
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js'
import { createHash, randomUUID } from 'node:crypto'
import {
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'

export const OPENEXPERT_MOCK_BANK_NAME = 'OpenExpert Bank' as const
export const OPENEXPERT_MOCK_BANK_SLUG = 'openexpert-bank' as const
export const OPENEXPERT_MOCK_BANK_ARCHIVE_MEDIA_TYPE = 'application/zip' as const
export const OPENEXPERT_MOCK_BANK_PDF_MEDIA_TYPE = 'application/pdf' as const
// The durable private outbox accepts at most 5 MiB per object. Generated mock
// documents are intentionally small, so reject before attempting persistence.
export const MAX_OPENEXPERT_MOCK_BANK_ARCHIVE_BYTES = 5 * 1024 * 1024

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const APPLICATION_NUMBER_PATTERN = /^OEB-\d{8}-\d{6}$/u
const WARSAW_TIME_ZONE = 'Europe/Warsaw'
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const PAGE_MARGIN_X = 48
const PAGE_BOTTOM = 58
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN_X * 2
const MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES = 4 * 1024 * 1024

export type OpenExpertMockBankDocumentKind = 'esis' | 'credit_decision'
export type OpenExpertMockBankDecisionOutcome = 'positive' | 'negative'

export interface OpenExpertMockBankFinancialTerms {
  loanAmount: number
  currency: string
  annualInterestRate: number
  aprc: number
  monthlyInstallment: number
  termMonths: number
}

interface OpenExpertMockBankPdfBaseInput {
  applicationNumber: string
  applicantNames: readonly string[]
  issueDate: string
  financialTerms: OpenExpertMockBankFinancialTerms
  fontBytes: Uint8Array
}

export interface OpenExpertMockBankEsisPdfInput extends OpenExpertMockBankPdfBaseInput {
  validUntil: string
}

export interface OpenExpertMockBankCreditDecisionPdfInput extends OpenExpertMockBankPdfBaseInput {
  outcome: OpenExpertMockBankDecisionOutcome
  validUntil?: string | null
  reason?: string | null
}

export interface OpenExpertMockBankPdfDocument {
  bytes: Uint8Array
  fileName: string
  mediaType: typeof OPENEXPERT_MOCK_BANK_PDF_MEDIA_TYPE
  kind: OpenExpertMockBankDocumentKind
  applicationNumber: string
  issueDate: string
  validUntil: string | null
  decisionOutcome: OpenExpertMockBankDecisionOutcome | null
}

export interface OpenExpertMockBankEncryptedArchive {
  bytes: Uint8Array
  fileName: string
  entryName: string
  mediaType: typeof OPENEXPERT_MOCK_BANK_ARCHIVE_MEDIA_TYPE
  kind: OpenExpertMockBankDocumentKind
  applicationNumber: string
}

export interface OpenExpertMockBankDocumentDates {
  issueDate: string
  esisValidUntil: string
  decisionValidUntil: string
}

interface NormalizedDocumentInput {
  applicationNumber: string
  applicantNames: string[]
  issueDate: string
  financialTerms: OpenExpertMockBankFinancialTerms
  fontBytes: Uint8Array
}

interface DocumentSection {
  title: string
  paragraphs: string[]
}

export class OpenExpertMockBankDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenExpertMockBankDocumentError'
  }
}

function invalid(message: string): never {
  throw new OpenExpertMockBankDocumentError(message)
}

function normalizeLine(value: unknown, field: string, maximum = 240): string {
  if (typeof value !== 'string') invalid(`${field} jest wymagane.`)
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized || normalized.length > maximum) invalid(`${field} ma nieprawidłową wartość.`)
  return normalized
}

function assertFiniteRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(`${field} ma nieprawidłową wartość.`)
  }
  return value
}

function assertDateOnly(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) {
    invalid(`${field} musi być datą w formacie RRRR-MM-DD.`)
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    invalid(`${field} musi być poprawną datą.`)
  }
  return value
}

function dateOnlyFromParts(date: Date, timeZone: string): string {
  if (!Number.isFinite(date.valueOf())) invalid('Data ma nieprawidłową wartość.')
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find(item => item.type === type)?.value ?? ''
  )
  return assertDateOnly(`${part('year')}-${part('month')}-${part('day')}`, 'Data')
}

export function openExpertMockBankDateOnly(
  value: Date | string,
  timeZone = WARSAW_TIME_ZONE,
): string {
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value)) {
    return assertDateOnly(value, 'Data')
  }
  const date = value instanceof Date ? value : new Date(value)
  return dateOnlyFromParts(date, timeZone)
}

export function addOpenExpertMockBankCalendarDays(value: Date | string, days: number): string {
  const dateOnly = openExpertMockBankDateOnly(value)
  if (!Number.isInteger(days) || Math.abs(days) > 3_650) {
    invalid('Liczba dni musi być liczbą całkowitą z bezpiecznego zakresu.')
  }
  const date = new Date(`${dateOnly}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function resolveOpenExpertMockBankDocumentDates(input: {
  now?: Date
  decisionDueAt?: Date | string | null
  esisValidityDays?: number
  decisionValidityDays?: number
} = {}): OpenExpertMockBankDocumentDates {
  const issueDate = openExpertMockBankDateOnly(input.now ?? new Date())
  const esisValidityDays = input.esisValidityDays ?? 30
  const decisionValidityDays = input.decisionValidityDays ?? 30
  const decisionDueDate = input.decisionDueAt
    ? openExpertMockBankDateOnly(input.decisionDueAt)
    : issueDate
  const decisionValidityBase = decisionDueDate > issueDate ? decisionDueDate : issueDate

  return {
    issueDate,
    esisValidUntil: addOpenExpertMockBankCalendarDays(issueDate, esisValidityDays),
    decisionValidUntil: addOpenExpertMockBankCalendarDays(
      decisionValidityBase,
      decisionValidityDays,
    ),
  }
}

export function createOpenExpertMockBankRequestId(): string {
  return randomUUID()
}

export function assertOpenExpertMockBankRequestId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    invalid('Identyfikator żądania musi być UUID.')
  }
  return value.trim().toLowerCase()
}

export function deriveOpenExpertMockBankChildRequestId(
  parentRequestId: string,
  purpose: string,
): string {
  const parent = assertOpenExpertMockBankRequestId(parentRequestId)
  const safePurpose = normalizeLine(purpose, 'Cel identyfikatora', 80)
  const digest = createHash('sha256')
    .update(`openexpert-mock-bank/v1\0${parent}\0${safePurpose}`, 'utf8')
    .digest()
  const bytes = new Uint8Array(digest.subarray(0, 16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

export function createOpenExpertMockBankApplicationNumber(
  applicationId: string,
  createdAt: Date | string,
): string {
  const normalizedId = assertOpenExpertMockBankRequestId(applicationId)
  const date = openExpertMockBankDateOnly(createdAt).replaceAll('-', '')
  const digest = createHash('sha256')
    .update(normalizedId, 'utf8')
    .digest()
  const randomLookingNumber = digest.readUInt32BE(0) % 1_000_000
  return `OEB-${date}-${String(randomLookingNumber).padStart(6, '0')}`
}

export function assertOpenExpertMockBankApplicationNumber(value: unknown): string {
  if (typeof value !== 'string' || !APPLICATION_NUMBER_PATTERN.test(value.trim())) {
    invalid('Numer wniosku OpenExpert Bank ma nieprawidłowy format.')
  }
  return value.trim()
}

export function isValidOpenExpertMockBankPesel(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return /^\d{11}$/u.test(value.replace(/\s+/gu, ''))
}

function normalizePeselPassword(value: unknown): string {
  if (!isValidOpenExpertMockBankPesel(value)) {
    invalid('Hasło archiwum musi być 11-cyfrowym numerem PESEL.')
  }
  return String(value).replace(/\s+/gu, '')
}

function normalizeFinancialTerms(value: OpenExpertMockBankFinancialTerms): OpenExpertMockBankFinancialTerms {
  if (!value || typeof value !== 'object') invalid('Parametry finansowe są wymagane.')
  const currency = normalizeLine(value.currency, 'Waluta', 3).toUpperCase()
  if (!/^[A-Z]{3}$/u.test(currency)) invalid('Waluta musi być trzyznakowym kodem ISO.')
  const termMonths = assertFiniteRange(value.termMonths, 'Okres kredytowania', 1, 600)
  if (!Number.isInteger(termMonths)) invalid('Okres kredytowania musi być liczbą pełnych miesięcy.')

  return {
    loanAmount: assertFiniteRange(value.loanAmount, 'Kwota kredytu', 1, 1_000_000_000),
    currency,
    annualInterestRate: assertFiniteRange(
      value.annualInterestRate,
      'Oprocentowanie nominalne',
      0,
      100,
    ),
    aprc: assertFiniteRange(value.aprc, 'RRSO', 0, 100),
    monthlyInstallment: assertFiniteRange(
      value.monthlyInstallment,
      'Miesięczna rata',
      0.01,
      100_000_000,
    ),
    termMonths,
  }
}

function normalizeBaseInput(input: OpenExpertMockBankPdfBaseInput): NormalizedDocumentInput {
  if (!input || typeof input !== 'object') invalid('Dane dokumentu są wymagane.')
  if (!(input.fontBytes instanceof Uint8Array) || input.fontBytes.byteLength < 1_000) {
    invalid('Do wygenerowania PDF jest wymagany poprawny plik fontu.')
  }
  if (!Array.isArray(input.applicantNames)
    || input.applicantNames.length < 1
    || input.applicantNames.length > 20) {
    invalid('Dokument musi zawierać od 1 do 20 wnioskodawców.')
  }

  return {
    applicationNumber: assertOpenExpertMockBankApplicationNumber(input.applicationNumber),
    applicantNames: input.applicantNames.map((name, index) => (
      normalizeLine(name, `Wnioskodawca ${index + 1}`, 200)
    )),
    issueDate: assertDateOnly(input.issueDate, 'Data wydania'),
    financialTerms: normalizeFinancialTerms(input.financialTerms),
    fontBytes: input.fontBytes,
  }
}

function formatPolishDate(value: string): string {
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00.000Z`))
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}%`
}

function financialTermLines(terms: OpenExpertMockBankFinancialTerms): string[] {
  const years = terms.termMonths / 12
  const yearsLabel = Number.isInteger(years) ? ` (${years} lat)` : ''
  return [
    `Kwota kredytu: ${formatMoney(terms.loanAmount, terms.currency)}.`,
    `Waluta kredytu i spłaty: ${terms.currency}.`,
    `Okres kredytowania: ${terms.termMonths} miesięcy${yearsLabel}.`,
    `Oprocentowanie nominalne: ${formatPercent(terms.annualInterestRate)} w skali roku.`,
    `Rzeczywista Roczna Stopa Oprocentowania (RRSO): ${formatPercent(terms.aprc)}.`,
    `Szacowana rata miesięczna: ${formatMoney(terms.monthlyInstallment, terms.currency)}.`,
  ]
}

function applicantLines(applicantNames: readonly string[]): string[] {
  return applicantNames.map((name, index) => `Wnioskodawca ${index + 1}: ${name}.`)
}

function buildEsisSections(
  base: NormalizedDocumentInput,
  validUntil: string,
): DocumentSection[] {
  return [
    {
      title: '1. Kredytodawca',
      paragraphs: [
        `Kredytodawca: ${OPENEXPERT_MOCK_BANK_NAME}.`,
        'Instytucja demonstracyjna działająca wyłącznie na potrzeby testowania procesu OpenExpert.',
        'Adres korespondencyjny: ul. Ekspercka 1, 00-001 Warszawa.',
      ],
    },
    {
      title: '2. Dane wnioskodawców',
      paragraphs: applicantLines(base.applicantNames),
    },
    {
      title: '3. Główne cechy kredytu i warunki finansowe',
      paragraphs: financialTermLines(base.financialTerms),
    },
    {
      title: '4. Oprocentowanie i inne koszty',
      paragraphs: [
        `Oprocentowanie nominalne kredytu wynosi ${formatPercent(base.financialTerms.annualInterestRate)} w skali roku.`,
        `RRSO dla przedstawionego przykładu wynosi ${formatPercent(base.financialTerms.aprc)}.`,
        'Wartości mają charakter demonstracyjny i służą do sprawdzenia obiegu dokumentów.',
      ],
    },
    {
      title: '5. Częstotliwość i liczba płatności',
      paragraphs: [
        `Spłata następuje w ${base.financialTerms.termMonths} równych ratach miesięcznych.`,
        `Szacowana wysokość każdej raty: ${formatMoney(base.financialTerms.monthlyInstallment, base.financialTerms.currency)}.`,
        'Raty płatne raz w miesiącu, zgodnie z harmonogramem przekazanym z umową.',
      ],
    },
    {
      title: '6. Okres ważności informacji',
      paragraphs: [
        `Informacje w tym spersonalizowanym formularzu ESIS są ważne do ${formatPolishDate(validUntil)} (${validUntil}) włącznie.`,
        `Data sporządzenia formularza: ${formatPolishDate(base.issueDate)} (${base.issueDate}).`,
      ],
    },
  ]
}

function buildDecisionSections(
  base: NormalizedDocumentInput,
  outcome: OpenExpertMockBankDecisionOutcome,
  validUntil: string | null,
  reason: string | null,
): DocumentSection[] {
  const amount = formatMoney(base.financialTerms.loanAmount, base.financialTerms.currency)
  const explicitDecision = outcome === 'positive'
    ? `${OPENEXPERT_MOCK_BANK_NAME} podjął jednoznaczną POZYTYWNĄ DECYZJĘ KREDYTOWĄ i akceptuje wniosek o udzielenie kredytu w kwocie ${amount}.`
    : `${OPENEXPERT_MOCK_BANK_NAME} podjął jednoznaczną NEGATYWNĄ DECYZJĘ KREDYTOWĄ i odmawia udzielenia kredytu objętego tym wnioskiem.`
  const outcomeDetails = outcome === 'positive'
    ? [
        `Decyzja jest ważna do ${formatPolishDate(validUntil!)} (${validUntil}) włącznie.`,
        'Warunki uruchomienia: pozytywna weryfikacja dokumentów nieruchomości oraz podpisanie umowy kredytowej.',
      ]
    : [
        `Powód odmowy: ${reason ?? 'wniosek nie spełnił demonstracyjnych kryteriów oceny ryzyka kredytowego'}.`,
        'Decyzja negatywna kończy ocenę tego mockowego wniosku.',
      ]

  return [
    {
      title: '1. Kredytodawca i identyfikacja decyzji',
      paragraphs: [
        `Kredytodawca: ${OPENEXPERT_MOCK_BANK_NAME}.`,
        `Numer wniosku: ${base.applicationNumber}.`,
        `Data wydania decyzji: ${formatPolishDate(base.issueDate)} (${base.issueDate}).`,
      ],
    },
    {
      title: '2. Wnioskodawcy',
      paragraphs: applicantLines(base.applicantNames),
    },
    {
      title: '3. Jednoznaczna decyzja kredytowa',
      paragraphs: [explicitDecision, ...outcomeDetails],
    },
    {
      title: outcome === 'positive'
        ? '4. Zatwierdzone warunki finansowe'
        : '4. Parametry ocenionego wniosku',
      paragraphs: financialTermLines(base.financialTerms),
    },
  ]
}

function sectionsAsText(title: string, introduction: string[], sections: readonly DocumentSection[]) {
  return [
    title,
    ...introduction,
    ...sections.flatMap(section => [section.title, ...section.paragraphs]),
  ].join('\n')
}

export function openExpertMockBankEsisDocumentText(
  input: Omit<OpenExpertMockBankEsisPdfInput, 'fontBytes'>,
): string {
  const base = normalizeBaseInput({
    ...input,
    fontBytes: new Uint8Array(1_000),
  })
  const validUntil = assertDateOnly(input.validUntil, 'Data ważności ESIS')
  if (validUntil < base.issueDate) invalid('Data ważności ESIS nie może poprzedzać daty wydania.')
  return sectionsAsText(
    'EUROPEJSKI ZNORMALIZOWANY ARKUSZ INFORMACYJNY (ESIS)',
    [
      'Spersonalizowany formularz informacyjny dotyczący kredytu hipotecznego.',
      `Numer wniosku: ${base.applicationNumber}.`,
    ],
    buildEsisSections(base, validUntil),
  )
}

export function openExpertMockBankCreditDecisionDocumentText(
  input: Omit<OpenExpertMockBankCreditDecisionPdfInput, 'fontBytes'>,
): string {
  const base = normalizeBaseInput({
    ...input,
    fontBytes: new Uint8Array(1_000),
  })
  const outcome = input.outcome
  if (outcome !== 'positive' && outcome !== 'negative') {
    invalid('Wynik decyzji musi być pozytywny albo negatywny.')
  }
  const validUntil = input.validUntil
    ? assertDateOnly(input.validUntil, 'Data ważności decyzji')
    : null
  if (outcome === 'positive' && !validUntil) {
    invalid('Pozytywna decyzja kredytowa musi mieć datę ważności.')
  }
  if (validUntil && validUntil < base.issueDate) {
    invalid('Data ważności decyzji nie może poprzedzać daty wydania.')
  }
  const reason = input.reason ? normalizeLine(input.reason, 'Powód decyzji', 1_000) : null
  return sectionsAsText(
    `DECYZJA KREDYTOWA - ${outcome === 'positive' ? 'POZYTYWNA' : 'NEGATYWNA'}`,
    [`Numer wniosku: ${base.applicationNumber}.`],
    buildDecisionSections(base, outcome, validUntil, reason),
  )
}

function splitLongWord(word: string, font: PDFFont, size: number, width: number): string[] {
  if (font.widthOfTextAtSize(word, size) <= width) return [word]
  const parts: string[] = []
  let current = ''
  for (const character of word) {
    const candidate = `${current}${character}`
    if (current && font.widthOfTextAtSize(candidate, size) > width) {
      parts.push(current)
      current = character
    }
    else {
      current = candidate
    }
  }
  if (current) parts.push(current)
  return parts
}

function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.trim().split(/\s+/u).flatMap(word => splitLongWord(word, font, size, width))
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (line && font.widthOfTextAtSize(candidate, size) > width) {
      lines.push(line)
      line = word
    }
    else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

class MockBankPdfRenderer {
  readonly pages: PDFPage[] = []
  private readonly pdf: PDFDocument
  private readonly font: PDFFont
  private readonly title: string
  private readonly subtitle: string
  private page!: PDFPage
  private y = 0

  constructor(
    pdf: PDFDocument,
    font: PDFFont,
    title: string,
    subtitle: string,
  ) {
    this.pdf = pdf
    this.font = font
    this.title = title
    this.subtitle = subtitle
    this.addPage()
  }

  private addPage() {
    const page = this.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.pages.push(page)
    this.page = page
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 104,
      width: PAGE_WIDTH,
      height: 104,
      color: rgb(0.05, 0.10, 0.20),
    })
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 108,
      width: PAGE_WIDTH,
      height: 4,
      color: rgb(0.13, 0.77, 0.52),
    })
    page.drawText(OPENEXPERT_MOCK_BANK_NAME, {
      x: PAGE_MARGIN_X,
      y: PAGE_HEIGHT - 35,
      size: 10,
      font: this.font,
      color: rgb(0.60, 0.94, 0.78),
    })
    const titleLines = wrapText(this.title, this.font, 16, CONTENT_WIDTH)
    titleLines.slice(0, 2).forEach((line, index) => {
      page.drawText(line, {
        x: PAGE_MARGIN_X,
        y: PAGE_HEIGHT - 61 - index * 18,
        size: 16,
        font: this.font,
        color: rgb(1, 1, 1),
      })
    })
    page.drawText(this.subtitle, {
      x: PAGE_MARGIN_X,
      y: PAGE_HEIGHT - 96,
      size: 8.5,
      font: this.font,
      color: rgb(0.82, 0.86, 0.93),
    })
    this.y = PAGE_HEIGHT - 132
  }

  private ensureSpace(height: number) {
    if (this.y - height < PAGE_BOTTOM) this.addPage()
  }

  paragraph(
    text: string,
    options: { size?: number, lineHeight?: number, color?: ReturnType<typeof rgb>, gap?: number } = {},
  ) {
    const size = options.size ?? 9.5
    const lineHeight = options.lineHeight ?? 13.2
    const lines = wrapText(text, this.font, size, CONTENT_WIDTH)
    const gap = options.gap ?? 5
    this.ensureSpace(lines.length * lineHeight + gap)
    for (const line of lines) {
      this.page.drawText(line, {
        x: PAGE_MARGIN_X,
        y: this.y,
        size,
        font: this.font,
        color: options.color ?? rgb(0.12, 0.16, 0.23),
      })
      this.y -= lineHeight
    }
    this.y -= gap
  }

  section(section: DocumentSection) {
    const titleLines = wrapText(section.title, this.font, 11.5, CONTENT_WIDTH - 18)
    const titleHeight = titleLines.length * 15 + 10
    this.ensureSpace(titleHeight + 22)
    this.page.drawRectangle({
      x: PAGE_MARGIN_X,
      y: this.y - titleHeight + 8,
      width: CONTENT_WIDTH,
      height: titleHeight,
      color: rgb(0.93, 0.96, 0.99),
    })
    this.page.drawRectangle({
      x: PAGE_MARGIN_X,
      y: this.y - titleHeight + 8,
      width: 4,
      height: titleHeight,
      color: rgb(0.10, 0.64, 0.44),
    })
    for (const line of titleLines) {
      this.page.drawText(line, {
        x: PAGE_MARGIN_X + 12,
        y: this.y,
        size: 11.5,
        font: this.font,
        color: rgb(0.04, 0.20, 0.16),
      })
      this.y -= 15
    }
    this.y -= 9
    for (const paragraph of section.paragraphs) this.paragraph(paragraph)
    this.y -= 4
  }

  finish(applicationNumber: string) {
    this.pages.forEach((page, index) => {
      page.drawLine({
        start: { x: PAGE_MARGIN_X, y: 40 },
        end: { x: PAGE_WIDTH - PAGE_MARGIN_X, y: 40 },
        thickness: 0.6,
        color: rgb(0.82, 0.85, 0.89),
      })
      page.drawText(`TRYB MOCKOWY • ${applicationNumber}`, {
        x: PAGE_MARGIN_X,
        y: 24,
        size: 7.5,
        font: this.font,
        color: rgb(0.43, 0.47, 0.54),
      })
      const pageLabel = `Strona ${index + 1} z ${this.pages.length}`
      page.drawText(pageLabel, {
        x: PAGE_WIDTH - PAGE_MARGIN_X - this.font.widthOfTextAtSize(pageLabel, 7.5),
        y: 24,
        size: 7.5,
        font: this.font,
        color: rgb(0.43, 0.47, 0.54),
      })
    })
  }
}

async function renderDocument(input: {
  base: NormalizedDocumentInput
  title: string
  subtitle: string
  sections: readonly DocumentSection[]
  subject: string
  keywords: string[]
}) {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(input.base.fontBytes, { subset: true })
  const issueTimestamp = new Date(`${input.base.issueDate}T12:00:00.000Z`)
  pdf.setTitle(input.title)
  pdf.setAuthor(OPENEXPERT_MOCK_BANK_NAME)
  pdf.setCreator(OPENEXPERT_MOCK_BANK_NAME)
  pdf.setProducer('OpenExpert mock bank document generator')
  pdf.setSubject(input.subject)
  pdf.setKeywords(input.keywords)
  pdf.setLanguage('pl-PL')
  pdf.setCreationDate(issueTimestamp)
  pdf.setModificationDate(issueTimestamp)

  const renderer = new MockBankPdfRenderer(pdf, font, input.title, input.subtitle)
  renderer.paragraph(`Numer wniosku: ${input.base.applicationNumber}`, {
    size: 10.5,
    lineHeight: 14,
    color: rgb(0.04, 0.35, 0.25),
    gap: 12,
  })
  for (const section of input.sections) renderer.section(section)
  renderer.paragraph(
    'Dokument demonstracyjny wygenerowany automatycznie. Nie jest ofertą ani decyzją rzeczywistej instytucji finansowej.',
    { size: 8, lineHeight: 11, color: rgb(0.43, 0.47, 0.54), gap: 0 },
  )
  renderer.finish(input.base.applicationNumber)
  return pdf.save({ useObjectStreams: false })
}

export function openExpertMockBankPdfFileName(
  kind: OpenExpertMockBankDocumentKind,
  applicationNumber: string,
): string {
  const number = assertOpenExpertMockBankApplicationNumber(applicationNumber)
  return kind === 'esis'
    ? `${number}-formularz-ESIS.pdf`
    : `${number}-decyzja-kredytowa.pdf`
}

export function openExpertMockBankArchiveFileName(
  kind: OpenExpertMockBankDocumentKind,
  applicationNumber: string,
): string {
  return openExpertMockBankPdfFileName(kind, applicationNumber).replace(/\.pdf$/u, '.zip')
}

export async function createOpenExpertMockBankEsisPdf(
  input: OpenExpertMockBankEsisPdfInput,
): Promise<OpenExpertMockBankPdfDocument> {
  const base = normalizeBaseInput(input)
  const validUntil = assertDateOnly(input.validUntil, 'Data ważności ESIS')
  if (validUntil < base.issueDate) invalid('Data ważności ESIS nie może poprzedzać daty wydania.')
  const title = 'EUROPEJSKI ZNORMALIZOWANY ARKUSZ INFORMACYJNY (ESIS)'
  const bytes = await renderDocument({
    base,
    title,
    subtitle: 'Spersonalizowany formularz informacyjny dotyczący kredytu hipotecznego',
    sections: buildEsisSections(base, validUntil),
    subject: `Spersonalizowany ESIS dla wniosku ${base.applicationNumber}`,
    keywords: [
      'ESIS',
      'creditorIdentity',
      'applicantIdentity',
      'financialTerms',
      'validityPeriod',
      'aprc',
      'repaymentTerms',
    ],
  })
  return {
    bytes,
    fileName: openExpertMockBankPdfFileName('esis', base.applicationNumber),
    mediaType: OPENEXPERT_MOCK_BANK_PDF_MEDIA_TYPE,
    kind: 'esis',
    applicationNumber: base.applicationNumber,
    issueDate: base.issueDate,
    validUntil,
    decisionOutcome: null,
  }
}

export async function createOpenExpertMockBankCreditDecisionPdf(
  input: OpenExpertMockBankCreditDecisionPdfInput,
): Promise<OpenExpertMockBankPdfDocument> {
  const base = normalizeBaseInput(input)
  if (input.outcome !== 'positive' && input.outcome !== 'negative') {
    invalid('Wynik decyzji musi być pozytywny albo negatywny.')
  }
  const validUntil = input.validUntil
    ? assertDateOnly(input.validUntil, 'Data ważności decyzji')
    : null
  if (input.outcome === 'positive' && !validUntil) {
    invalid('Pozytywna decyzja kredytowa musi mieć datę ważności.')
  }
  if (validUntil && validUntil < base.issueDate) {
    invalid('Data ważności decyzji nie może poprzedzać daty wydania.')
  }
  const reason = input.reason ? normalizeLine(input.reason, 'Powód decyzji', 1_000) : null
  const outcomeLabel = input.outcome === 'positive' ? 'POZYTYWNA' : 'NEGATYWNA'
  const bytes = await renderDocument({
    base,
    title: `DECYZJA KREDYTOWA - ${outcomeLabel}`,
    subtitle: `Jednoznaczna decyzja ${OPENEXPERT_MOCK_BANK_NAME}`,
    sections: buildDecisionSections(base, input.outcome, validUntil, reason),
    subject: `${outcomeLabel} decyzja kredytowa dla wniosku ${base.applicationNumber}`,
    keywords: [
      'credit_decision',
      'creditorIdentity',
      'applicantIdentity',
      'issueDate',
      'explicitDecision',
      'decisionOutcome',
      'conditionsOrRefusal',
      ...(input.outcome === 'positive' ? ['financialTerms', 'validityPeriod'] : []),
    ],
  })
  return {
    bytes,
    fileName: openExpertMockBankPdfFileName('credit_decision', base.applicationNumber),
    mediaType: OPENEXPERT_MOCK_BANK_PDF_MEDIA_TYPE,
    kind: 'credit_decision',
    applicationNumber: base.applicationNumber,
    issueDate: base.issueDate,
    validUntil: input.outcome === 'positive' ? validUntil : null,
    decisionOutcome: input.outcome,
  }
}

export async function createOpenExpertMockBankEncryptedArchive(input: {
  document: OpenExpertMockBankPdfDocument
  pesel: unknown
}): Promise<OpenExpertMockBankEncryptedArchive> {
  if (!input?.document || !(input.document.bytes instanceof Uint8Array)) {
    invalid('Dokument PDF jest wymagany.')
  }
  const applicationNumber = assertOpenExpertMockBankApplicationNumber(
    input.document.applicationNumber,
  )
  const expectedEntryName = openExpertMockBankPdfFileName(
    input.document.kind,
    applicationNumber,
  )
  if (input.document.fileName !== expectedEntryName
    || input.document.mediaType !== OPENEXPERT_MOCK_BANK_PDF_MEDIA_TYPE
    || input.document.bytes.byteLength === 0) {
    invalid('Dokument PDF ma niespójne metadane lub jest pusty.')
  }

  const password = normalizePeselPassword(input.pesel)
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    password,
    encryptionStrength: 3,
    zipCrypto: false,
    level: 6,
  })
  await writer.add(expectedEntryName, new Uint8ArrayReader(input.document.bytes), {
    lastModDate: new Date(`${input.document.issueDate}T12:00:00.000Z`),
  })
  const bytes = await writer.close()
  if (!bytes.byteLength) invalid('Wygenerowane archiwum ZIP jest puste.')
  if (bytes.byteLength > MAX_OPENEXPERT_MOCK_BANK_ARCHIVE_BYTES) {
    invalid('Archiwum ZIP przekracza limit 5 MB dla mockowego dokumentu.')
  }

  return {
    bytes,
    fileName: openExpertMockBankArchiveFileName(input.document.kind, applicationNumber),
    entryName: expectedEntryName,
    mediaType: OPENEXPERT_MOCK_BANK_ARCHIVE_MEDIA_TYPE,
    kind: input.document.kind,
    applicationNumber,
  }
}

export async function verifyOpenExpertMockBankEncryptedArchive(input: {
  bytes: Uint8Array
  kind: OpenExpertMockBankDocumentKind
  applicationNumber: string
  pesel: unknown
}): Promise<void> {
  if (!(input.bytes instanceof Uint8Array)
    || input.bytes.byteLength === 0
    || input.bytes.byteLength > MAX_OPENEXPERT_MOCK_BANK_ARCHIVE_BYTES) {
    invalid('Utrwalone archiwum ZIP ma nieprawidłowy rozmiar.')
  }
  const password = normalizePeselPassword(input.pesel)
  const expectedEntryName = openExpertMockBankPdfFileName(
    input.kind,
    assertOpenExpertMockBankApplicationNumber(input.applicationNumber),
  )
  const reader = new ZipReader(new Uint8ArrayReader(input.bytes))
  try {
    const entries = await reader.getEntries()
    const entry = entries[0]
    if (entries.length !== 1
      || !entry
      || entry.directory
      || entry.filename !== expectedEntryName
      || entry.filename.includes('/')
      || entry.filename.includes('\\')
      || entry.encrypted !== true
      || entry.zipCrypto !== false
      || entry.extraFieldAES?.strength !== 3
      || !Number.isSafeInteger(entry.uncompressedSize)
      || entry.uncompressedSize < 5
      || entry.uncompressedSize > MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES) {
      invalid('Utrwalone archiwum nie zawiera oczekiwanego pojedynczego pliku AES-256.')
    }
    const pdf = await entry.getData(new Uint8ArrayWriter(), { password })
    if (!pdf
      || pdf.byteLength < 5
      || pdf.byteLength > MAX_OPENEXPERT_MOCK_BANK_PDF_BYTES
      || new TextDecoder().decode(pdf.slice(0, 5)) !== '%PDF-') {
      invalid('Utrwalone archiwum nie zawiera poprawnego dokumentu PDF.')
    }
  }
  catch (error) {
    if (error instanceof OpenExpertMockBankDocumentError) throw error
    invalid('Utrwalone archiwum ZIP jest uszkodzone albo ma inne hasło.')
  }
  finally {
    await reader.close()
  }
}
