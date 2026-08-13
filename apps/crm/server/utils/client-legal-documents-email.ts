export interface ClientLegalDocumentsEmailTemplateInput {
  organizationName: string
}

export const CLIENT_LEGAL_DOCUMENTS_EMAIL_TEMPLATE_VERSION = 1 as const

export interface ClientLegalDocumentsEmailTemplate {
  subject: string
  html: string
  text: string
}

function normalizeOrganizationName(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

export function clientLegalDocumentsEmailTemplate(
  input: ClientLegalDocumentsEmailTemplateInput,
): ClientLegalDocumentsEmailTemplate {
  const organizationName = normalizeOrganizationName(input.organizationName)
  const organizationAttribution = organizationName || 'Twojego pośrednika kredytowego'
  const safeOrganizationAttribution = escapeHtml(organizationAttribution)
  const contactSentence = organizationName
    ? `W razie pytań skontaktuj się bezpośrednio z ${organizationName}.`
    : 'W razie pytań skontaktuj się bezpośrednio ze swoim pośrednikiem kredytowym.'
  const safeContactSentence = escapeHtml(contactSentence)
  const subject = organizationName
    ? `Dokumenty OFI i RODO – ${organizationName}`
    : 'Dokumenty OFI i RODO'
  const text = [
    'Dzień dobry,',
    '',
    `w załącznikach przesyłamy dokumenty od ${organizationAttribution}:`,
    '',
    '- Informacja dla konsumenta (OFI.pdf)',
    '- Klauzula informacyjna RODO (RODO.pdf)',
    '',
    'Przekazanie tych dokumentów służy spełnieniu obowiązków informacyjnych związanych z obsługą Twojej sprawy. Ta wiadomość nie jest prośbą o wyrażenie zgody.',
    '',
    contactSentence,
    '',
    organizationName || 'Twój pośrednik kredytowy',
  ].join('\n')
  const html = `<!doctype html>
<html lang="pl" dir="ltr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif">
    <main style="max-width:600px;margin:0 auto;padding:32px 20px">
      <section aria-labelledby="message-heading" style="background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:28px">
        <p style="margin:0 0 12px;line-height:1.6">Dzień dobry,</p>
        <h1 id="message-heading" style="margin:0 0 16px;font-size:24px;line-height:1.25">Dokumenty OFI i RODO</h1>
        <p style="margin:0 0 16px;line-height:1.6">W załącznikach przesyłamy dokumenty od ${safeOrganizationAttribution}:</p>
        <ul style="margin:0 0 20px;padding-left:24px;line-height:1.7">
          <li><strong>Informacja dla konsumenta</strong> (OFI.pdf)</li>
          <li><strong>Klauzula informacyjna RODO</strong> (RODO.pdf)</li>
        </ul>
        <div style="margin:0 0 20px;padding:16px;border-radius:12px;background:#f4f4f5">
          <p style="margin:0;line-height:1.6">Przekazanie tych dokumentów służy spełnieniu obowiązków informacyjnych związanych z obsługą Twojej sprawy. Ta wiadomość <strong>nie jest prośbą o wyrażenie zgody</strong>.</p>
        </div>
        <p style="margin:0;line-height:1.6">${safeContactSentence}</p>
      </section>
      <p style="margin:16px 0 0;text-align:center;color:#71717a;font-size:13px">${escapeHtml(organizationName || 'Twój pośrednik kredytowy')}</p>
    </main>
  </body>
</html>`

  return { subject, html, text }
}
