export const MAX_MULTIFORM_EMAIL_ARCHIVE_BYTES = 40 * 1024 * 1024
export const MULTIFORM_EMAIL_ARCHIVE_NAME = 'wnioski-bankowe.zip'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

export function normalizeMultiformPeselPassword(value: unknown) {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/\s+/gu, '')
  return /^\d{11}$/u.test(normalized) ? normalized : ''
}

export function normalizeMultiformDeliveryRequestId(value: unknown) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  return uuidPattern.test(normalized) ? normalized.toLowerCase() : ''
}

export function assertMultiformEmailArchiveSize(bytes: Uint8Array) {
  if (!bytes.byteLength) throw new Error('Wygenerowana paczka ZIP jest pusta.')
  if (bytes.byteLength > MAX_MULTIFORM_EMAIL_ARCHIVE_BYTES) {
    throw new Error('Paczka ZIP przekracza limit 40 MB dla załącznika e-mail.')
  }
}

export function multiformPackageEmailTemplate(input: { recipientName: string }) {
  const recipientName = input.recipientName.trim() || 'Kliencie'
  const safeRecipientName = escapeHtml(recipientName)
  const subject = 'Dokumenty do wniosków bankowych'
  const text = [
    `Dzień dobry, ${recipientName}!`,
    '',
    'W załączniku przesyłamy przygotowaną paczkę dokumentów do wniosków bankowych.',
    '',
    'Paczka ZIP jest zabezpieczona. Hasłem jest Twój numer PESEL: 11 cyfr, bez spacji.',
    'Ze względów bezpieczeństwa numer PESEL nie jest podany w tej wiadomości.',
    '',
    'Jeżeli nie oczekujesz tych dokumentów, skontaktuj się ze swoim ekspertem i usuń wiadomość.',
    '',
    'OpenExpert',
  ].join('\n')
  const html = `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${subject}</title>
  </head>
  <body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif">
    <main style="max-width:600px;margin:0 auto;padding:32px 20px">
      <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:28px">
        <p style="margin:0 0 12px">Dzień dobry, ${safeRecipientName}!</p>
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25">Dokumenty do wniosków bankowych</h1>
        <p style="margin:0 0 16px;line-height:1.6">W załączniku przesyłamy przygotowaną paczkę dokumentów do wniosków bankowych.</p>
        <div style="margin:20px 0;padding:16px;border-radius:12px;background:#f4f4f5">
          <strong>Paczka ZIP jest zabezpieczona.</strong>
          <p style="margin:8px 0 0;line-height:1.6">Hasłem jest Twój numer PESEL: 11 cyfr, bez spacji. Ze względów bezpieczeństwa nie podajemy go w wiadomości.</p>
        </div>
        <p style="margin:0;line-height:1.6;color:#52525b">Jeżeli nie oczekujesz tych dokumentów, skontaktuj się ze swoim ekspertem i usuń wiadomość.</p>
      </div>
      <p style="margin:16px 0 0;text-align:center;color:#71717a;font-size:13px">OpenExpert</p>
    </main>
  </body>
</html>`

  return { subject, text, html }
}
