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
    subject: 'Jesteś na liście OpenExpert',
    html: `<!doctype html>
<html lang="pl">
  <body style="margin:0;background:#f4f4f5;color:#18181b;font-family:Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden">Dziękujemy za dołączenie do listy OpenExpert.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:32px 16px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7">
            <tr>
              <td style="padding:36px">
                <p style="margin:0 0 24px;font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">OpenExpert</p>
                <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2">Dzięki za dołączenie</h1>
                <p style="margin:0;color:#52525b;font-size:16px;line-height:1.6">Twój adres jest już na liście. Damy Ci znać, gdy pojawią się najważniejsze aktualizacje i możliwość wcześniejszego dostępu.</p>
                ${link}
                <p style="margin:32px 0 0;color:#71717a;font-size:12px;line-height:1.5">Otrzymujesz tę wiadomość, ponieważ zapisano ten adres na listę OpenExpert.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `Dzięki za dołączenie do listy OpenExpert.\n\nTwój adres jest już zapisany. Damy Ci znać, gdy pojawią się najważniejsze aktualizacje i możliwość wcześniejszego dostępu.${textLink}\n\nOtrzymujesz tę wiadomość, ponieważ zapisano ten adres na listę OpenExpert.`,
  }
}
