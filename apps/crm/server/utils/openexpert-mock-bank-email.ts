import {
  assertOpenExpertMockBankApplicationNumber,
  assertOpenExpertMockBankRequestId,
  OPENEXPERT_MOCK_BANK_NAME,
  openExpertMockBankArchiveFileName,
  type OpenExpertMockBankDecisionOutcome,
  type OpenExpertMockBankDocumentKind,
} from './openexpert-mock-bank-documents.ts'

export const OPENEXPERT_MOCK_BANK_EMAIL_TEMPLATE_VERSION = 1 as const

export interface OpenExpertMockBankEmailTemplateInput {
  kind: OpenExpertMockBankDocumentKind
  applicationNumber: string
  applicantNames: readonly string[]
  decisionOutcome?: OpenExpertMockBankDecisionOutcome | null
}

export interface OpenExpertMockBankEmailTemplate {
  subject: string
  html: string
  text: string
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

function resolveDocumentDetails(input: OpenExpertMockBankEmailTemplateInput) {
  if (input.kind === 'esis') {
    if (input.decisionOutcome) {
      throw new RangeError('Wynik decyzji nie może być podany dla wiadomości z ESIS.')
    }
    return {
      heading: 'Formularz informacyjny ESIS',
      documentDescription: 'spersonalizowany formularz informacyjny ESIS',
      subjectPrefix: 'Formularz informacyjny ESIS',
      outcomeText: null,
    }
  }
  if (input.kind !== 'credit_decision') {
    throw new RangeError('Nieobsługiwany rodzaj dokumentu mockowego banku.')
  }
  if (input.decisionOutcome !== 'positive' && input.decisionOutcome !== 'negative') {
    throw new RangeError('Wiadomość z decyzją musi określać wynik pozytywny albo negatywny.')
  }
  const outcomeLabel = input.decisionOutcome === 'positive' ? 'pozytywna' : 'negatywna'
  return {
    heading: `Decyzja kredytowa — ${outcomeLabel}`,
    documentDescription: `${outcomeLabel} decyzja kredytowa`,
    subjectPrefix: `${outcomeLabel.charAt(0).toUpperCase()}${outcomeLabel.slice(1)} decyzja kredytowa`,
    outcomeText: `Wynik decyzji: ${outcomeLabel.toLocaleUpperCase('pl-PL')}.`,
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
  const details = resolveDocumentDetails(input)
  const archiveName = openExpertMockBankArchiveFileName(input.kind, applicationNumber)
  const applicantLabel = applicantNames.length === 1 ? 'Wnioskodawca' : 'Wnioskodawcy'
  const applicantText = applicantNames.map(name => `- ${name}`).join('\n')
  const passwordInstruction = 'Hasłem do archiwum ZIP jest 11-cyfrowy numer PESEL głównego wnioskodawcy, wpisany bez spacji i myślników.'
  const subject = `${details.subjectPrefix} – ${applicationNumber}`
  const text = [
    'Dzień dobry,',
    '',
    `W załączniku przesyłamy ${details.documentDescription} przygotowany przez ${OPENEXPERT_MOCK_BANK_NAME}.`,
    '',
    `Numer wniosku: ${applicationNumber}`,
    `${applicantLabel}:`,
    applicantText,
    ...(details.outcomeText ? [details.outcomeText] : []),
    `Załącznik: ${archiveName}`,
    '',
    passwordInstruction,
    'Ze względów bezpieczeństwa numer PESEL nie jest podany w tej wiadomości.',
    '',
    'To automatyczna wiadomość z demonstracyjnej instytucji finansowej. Dokument służy wyłącznie do testowania obiegu w OpenExpert.',
    '',
    OPENEXPERT_MOCK_BANK_NAME,
  ].join('\n')
  const applicantItems = applicantNames
    .map(name => `              <li>${escapeHtml(name)}</li>`)
    .join('\n')
  const outcomeHtml = details.outcomeText
    ? `\n            <p style="margin:12px 0 0;line-height:1.6"><strong>${escapeHtml(details.outcomeText)}</strong></p>`
    : ''
  const html = `<!doctype html>
<html lang="pl" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body lang="pl" dir="ltr" style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif">
    <main style="max-width:600px;margin:0 auto;padding:32px 20px">
      <section aria-labelledby="message-heading" style="background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:28px">
        <p style="margin:0 0 12px;line-height:1.6">Dzień dobry,</p>
        <h1 id="message-heading" style="margin:0 0 16px;font-size:24px;line-height:1.25">${escapeHtml(details.heading)}</h1>
        <p style="margin:0 0 20px;line-height:1.6">W załączniku przesyłamy ${escapeHtml(details.documentDescription)} przygotowany przez <strong>${OPENEXPERT_MOCK_BANK_NAME}</strong>.</p>
        <section aria-label="Dane wniosku" style="margin:0 0 20px;padding:16px;border:1px solid #e4e4e7;border-radius:12px">
          <p style="margin:0 0 10px;line-height:1.6"><strong>Numer wniosku:</strong> ${applicationNumber}</p>
          <div>
            <strong>${applicantLabel}:</strong>
            <ul style="margin:8px 0 0;padding-left:24px;line-height:1.7">
${applicantItems}
            </ul>
          </div>${outcomeHtml}
        </section>
        <div role="note" aria-label="Hasło do załącznika" style="margin:0 0 20px;padding:16px;border-radius:12px;background:#ecfdf5;color:#064e3b">
          <p style="margin:0 0 8px;line-height:1.6"><strong>Załącznik: ${escapeHtml(archiveName)}</strong></p>
          <p style="margin:0 0 8px;line-height:1.6">${passwordInstruction}</p>
          <p style="margin:0;line-height:1.6">Ze względów bezpieczeństwa numer PESEL nie jest podany w tej wiadomości.</p>
        </div>
        <p style="margin:0;line-height:1.6;color:#52525b">To automatyczna wiadomość z demonstracyjnej instytucji finansowej. Dokument służy wyłącznie do testowania obiegu w OpenExpert.</p>
      </section>
      <p style="margin:16px 0 0;text-align:center;color:#71717a;font-size:13px">${OPENEXPERT_MOCK_BANK_NAME}</p>
    </main>
  </body>
</html>`

  return { subject, html, text }
}
