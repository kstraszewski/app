import {
  assertOpenExpertMockBankApplicationNumber,
  assertOpenExpertMockBankRequestId,
  OPENEXPERT_MOCK_BANK_NAME,
  openExpertMockBankArchiveFileName,
  type OpenExpertMockBankDecisionOutcome,
  type OpenExpertMockBankDocumentKind,
} from './openexpert-mock-bank-documents.ts'

export const OPENEXPERT_MOCK_BANK_EMAIL_TEMPLATE_VERSION = 2 as const

export interface OpenExpertMockBankEmailTemplateInput {
  kind: OpenExpertMockBankDocumentKind
  applicationNumber: string
  applicantNames: readonly string[]
  issueDate: string
  validUntil: string | null
  decisionOutcome?: OpenExpertMockBankDecisionOutcome | null
}

export interface OpenExpertMockBankEmailTemplate {
  subject: string
  html: string
  text: string
}

interface DocumentDetails {
  heading: string
  documentDescription: string
  subjectLabel: string
  statusLabel: string
  statusBackground: string
  statusColor: string
  preheader: string
}

function normalizeLine(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') throw new TypeError(`${field} jest wymagane.`)
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized || normalized.length > maximum) {
    throw new RangeError(`${field} ma nieprawidłową wartość.`)
  }
  return normalized
}

function normalizeDateOnly(value: unknown, field: string): string {
  const normalized = normalizeLine(value, field, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)
    || new Date(`${normalized}T00:00:00.000Z`).toISOString().slice(0, 10) !== normalized) {
    throw new RangeError(`${field} ma nieprawidłową wartość.`)
  }
  return normalized
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`))
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function normalizeApplicants(value: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new RangeError('Wiadomość musi wskazywać od 1 do 20 wnioskodawców.')
  }
  return value.map((name, index) => normalizeLine(name, `Wnioskodawca ${index + 1}`, 200))
}

function resolveDocumentDetails(input: OpenExpertMockBankEmailTemplateInput): DocumentDetails {
  if (input.kind === 'esis') {
    if (input.decisionOutcome) {
      throw new RangeError('Wynik decyzji nie może być podany dla wiadomości z ESIS.')
    }
    return {
      heading: 'Formularz informacyjny ESIS jest gotowy',
      documentDescription: 'spersonalizowany formularz informacyjny ESIS',
      subjectLabel: 'formularz ESIS',
      statusLabel: 'ESIS GOTOWY',
      statusBackground: '#dbeafe',
      statusColor: '#1e40af',
      preheader: 'Zaszyfrowany formularz ESIS jest dostępny w załączniku ZIP.',
    }
  }
  if (input.kind !== 'credit_decision') {
    throw new RangeError('Nieobsługiwany rodzaj dokumentu mockowego banku.')
  }
  if (input.decisionOutcome !== 'positive' && input.decisionOutcome !== 'negative') {
    throw new RangeError('Wiadomość z decyzją musi określać wynik pozytywny albo negatywny.')
  }
  const positive = input.decisionOutcome === 'positive'
  return {
    heading: positive ? 'Pozytywna decyzja kredytowa' : 'Negatywna decyzja kredytowa',
    documentDescription: positive ? 'pozytywną decyzję kredytową' : 'negatywną decyzję kredytową',
    subjectLabel: positive ? 'decyzja pozytywna' : 'decyzja negatywna',
    statusLabel: positive ? 'DECYZJA POZYTYWNA' : 'DECYZJA NEGATYWNA',
    statusBackground: positive ? '#d1fae5' : '#fee2e2',
    statusColor: positive ? '#065f46' : '#991b1b',
    preheader: positive
      ? 'OpenExpert Bank wydał pozytywną decyzję kredytową. Dokument jest w załączniku ZIP.'
      : 'OpenExpert Bank wydał negatywną decyzję kredytową. Dokument jest w załączniku ZIP.',
  }
}

export function openExpertMockBankEmailIdempotencyKey(
  kind: OpenExpertMockBankDocumentKind,
  dispatchId: string,
  generation = 1,
): string {
  const normalizedDispatchId = assertOpenExpertMockBankRequestId(dispatchId)
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new RangeError('Generacja wiadomości musi być dodatnią liczbą całkowitą.')
  }
  const documentKey = kind === 'esis'
    ? 'esis'
    : kind === 'credit_decision'
      ? 'credit-decision'
      : null
  if (!documentKey) throw new RangeError('Nieobsługiwany rodzaj dokumentu mockowego banku.')
  return `openexpert-mock-bank/${documentKey}/${normalizedDispatchId}/generation-${generation}`
}

export function openExpertMockBankEmailTemplate(
  input: OpenExpertMockBankEmailTemplateInput,
): OpenExpertMockBankEmailTemplate {
  if (!input || typeof input !== 'object') throw new TypeError('Dane wiadomości są wymagane.')
  const applicationNumber = assertOpenExpertMockBankApplicationNumber(input.applicationNumber)
  const applicantNames = normalizeApplicants(input.applicantNames)
  const issueDate = normalizeDateOnly(input.issueDate, 'Data wystawienia')
  const validUntil = input.validUntil === null
    ? null
    : normalizeDateOnly(input.validUntil, 'Data ważności')
  const details = resolveDocumentDetails(input)
  const archiveName = openExpertMockBankArchiveFileName(input.kind, applicationNumber)
  const applicantLabel = applicantNames.length === 1 ? 'Wnioskodawca' : 'Wnioskodawcy'
  const applicantText = applicantNames.map(name => `- ${name}`).join('\n')
  const applicantHtml = applicantNames.map(escapeHtml).join('<br>')
  const passwordInstruction = 'Hasłem do archiwum ZIP jest 11-cyfrowy numer PESEL głównego wnioskodawcy, wpisany bez spacji i myślników.'
  const subject = `[DEMO] OpenExpert Bank — ${details.subjectLabel} — ${applicationNumber}`
  const validityText = validUntil ? `Ważny do: ${formatDate(validUntil)}` : null
  const text = [
    '[DEMO] OPENEXPERT BANK',
    '',
    details.heading,
    '',
    'Dzień dobry,',
    '',
    `W załączniku przesyłamy ${details.documentDescription}.`,
    '',
    `Status: ${details.statusLabel}`,
    `Numer wniosku: ${applicationNumber}`,
    `Data dokumentu: ${formatDate(issueDate)}`,
    ...(validityText ? [validityText] : []),
    `${applicantLabel}:`,
    applicantText,
    `Załącznik: ${archiveName}`,
    '',
    'BEZPIECZNY ZAŁĄCZNIK',
    passwordInstruction,
    'Numer PESEL nie jest podany w tej wiadomości.',
    '',
    'Co dalej:',
    '1. Zapisz załączone archiwum ZIP.',
    '2. Rozpakuj je przy użyciu numeru PESEL głównego wnioskodawcy.',
    '3. Zweryfikuj PDF i dodaj go do właściwego wniosku w OpenExpert.',
    '',
    'To automatyczna wiadomość z demonstracyjnej instytucji finansowej. Dokument służy wyłącznie do testowania obiegu w OpenExpert.',
    '',
    OPENEXPERT_MOCK_BANK_NAME,
  ].join('\n')

  const validityRow = validUntil
    ? `
                    <tr>
                      <td style="padding:8px 0;color:#64748b;font-size:14px;vertical-align:top">Ważny do</td>
                      <td style="padding:8px 0 8px 18px;color:#0f172a;font-size:14px;font-weight:600;text-align:right;vertical-align:top">${escapeHtml(formatDate(validUntil))}</td>
                    </tr>`
    : ''

  const html = `<!doctype html>
<html lang="pl" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body lang="pl" dir="ltr" style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(details.preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f1f5f9">
      <tr>
        <td align="center" style="padding:28px 12px">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
            <tr>
              <td style="padding:22px 28px;background:#0f172a;color:#ffffff">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="font-size:19px;font-weight:700;letter-spacing:-0.2px">OpenExpert Bank</td>
                    <td align="right"><span style="display:inline-block;padding:6px 10px;border:1px solid #60a5fa;border-radius:999px;color:#bfdbfe;font-size:11px;font-weight:700;letter-spacing:0.8px">ŚRODOWISKO DEMO</span></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px 12px">
                <span style="display:inline-block;padding:7px 11px;border-radius:999px;background:${details.statusBackground};color:${details.statusColor};font-size:12px;font-weight:700;letter-spacing:0.4px">${details.statusLabel}</span>
                <h1 style="margin:18px 0 12px;color:#0f172a;font-size:27px;line-height:1.25;letter-spacing:-0.5px">${escapeHtml(details.heading)}</h1>
                <p style="margin:0;color:#475569;font-size:16px;line-height:1.65">Dzień dobry, w załączniku przesyłamy ${escapeHtml(details.documentDescription)}.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 0">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px">
                  <tr>
                    <td style="padding:16px 18px">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="padding:8px 0;color:#64748b;font-size:14px;vertical-align:top">Numer wniosku</td>
                          <td style="padding:8px 0 8px 18px;color:#0f172a;font-size:14px;font-weight:700;text-align:right;vertical-align:top">${applicationNumber}</td>
                        </tr>
                        <tr>
                          <td style="padding:8px 0;color:#64748b;font-size:14px;vertical-align:top">Data dokumentu</td>
                          <td style="padding:8px 0 8px 18px;color:#0f172a;font-size:14px;font-weight:600;text-align:right;vertical-align:top">${escapeHtml(formatDate(issueDate))}</td>
                        </tr>${validityRow}
                        <tr>
                          <td style="padding:8px 0;color:#64748b;font-size:14px;vertical-align:top">${applicantLabel}</td>
                          <td style="padding:8px 0 8px 18px;color:#0f172a;font-size:14px;font-weight:600;text-align:right;line-height:1.55;vertical-align:top">${applicantHtml}</td>
                        </tr>
                        <tr>
                          <td style="padding:8px 0;color:#64748b;font-size:14px;vertical-align:top">Załącznik</td>
                          <td style="padding:8px 0 8px 18px;color:#0f172a;font-size:14px;font-weight:600;text-align:right;word-break:break-word;vertical-align:top">${escapeHtml(archiveName)}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 0">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#eff6ff;border-left:4px solid #2563eb;border-radius:10px">
                  <tr>
                    <td style="padding:17px 18px">
                      <p style="margin:0 0 7px;color:#1e3a8a;font-size:14px;font-weight:700">Bezpieczny załącznik</p>
                      <p style="margin:0;color:#1e3a8a;font-size:14px;line-height:1.6">${escapeHtml(passwordInstruction)}</p>
                      <p style="margin:7px 0 0;color:#1e3a8a;font-size:13px;line-height:1.55">Numer PESEL nie jest podany w tej wiadomości.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px 32px">
                <h2 style="margin:0 0 10px;color:#0f172a;font-size:17px;line-height:1.4">Co dalej?</h2>
                <ol style="margin:0;padding-left:22px;color:#475569;font-size:14px;line-height:1.7">
                  <li>Zapisz załączone archiwum ZIP.</li>
                  <li>Rozpakuj je przy użyciu numeru PESEL głównego wnioskodawcy.</li>
                  <li>Zweryfikuj PDF i dodaj go do właściwego wniosku w OpenExpert.</li>
                </ol>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;background:#f8fafc;border-top:1px solid #e2e8f0">
                <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6">To automatyczna wiadomość z demonstracyjnej instytucji finansowej. Dokument służy wyłącznie do testowania obiegu w OpenExpert.</p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;line-height:1.5">${OPENEXPERT_MOCK_BANK_NAME} · wiadomość testowa</p>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, html, text }
}
