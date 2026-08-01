interface WaitlistConfirmationTemplateOptions {
  siteUrl?: string
}

function safeHttpUrl(value?: string) {
  if (!value) return null

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : null
  } catch {
    return null
  }
}

export function waitlistConfirmationTemplate(
  options: WaitlistConfirmationTemplateOptions = {},
) {
  const siteUrl = safeHttpUrl(options.siteUrl)
  const link = siteUrl
    ? `<p style="margin:24px 0 0"><a href="${siteUrl}" style="display:inline-block;border-radius:8px;background:#111827;color:#ffffff;padding:12px 18px;text-decoration:none;font-weight:600">Zobacz OpenExpert</a></p>`
    : ''
  const textLink = siteUrl ? `\n\nOpenExpert: ${siteUrl}` : ''

  return {
    subject: 'Twój start z OpenExpert',
    html: `<!doctype html>
<html lang="pl">
  <body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden">Dziękujemy za zainteresowanie programem wczesnego dostępu OpenExpert.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7">
            <tr>
              <td style="padding:36px">
                <p style="margin:0 0 24px;font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">OpenExpert</p>
                <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2">Twój kontakt jest zapisany</h1>
                <p style="margin:0;color:#52525b;font-size:16px;line-height:1.6">Damy Ci znać o dostępie i kolejnych krokach dla osób oraz firm, które chcą uruchomić lub rozwinąć własne pośrednictwo.</p>
                ${link}
                <p style="margin:32px 0 0;color:#71717a;font-size:12px;line-height:1.5">Otrzymujesz tę wiadomość, ponieważ zapisano ten adres do programu wczesnego dostępu OpenExpert.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `Twój kontakt jest zapisany w programie wczesnego dostępu OpenExpert.\n\nDamy Ci znać o dostępie i kolejnych krokach dla osób oraz firm, które chcą uruchomić lub rozwinąć własne pośrednictwo.${textLink}\n\nOtrzymujesz tę wiadomość, ponieważ zapisano ten adres do programu wczesnego dostępu OpenExpert.`,
  }
}
