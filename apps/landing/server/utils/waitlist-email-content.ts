type EmailRendererResult = string | { html: string, subject?: string }
type EmailRenderer = (component: string, props: Record<string, unknown>, options?: { plainText?: boolean, pretty?: boolean, htmlToTextOptions?: { wordwrap?: number } }) => Promise<EmailRendererResult>

function body(result: EmailRendererResult) { return typeof result === 'string' ? result : result.html }

export async function renderWaitlistConfirmationEmail(
  siteUrl: string,
  renderer: EmailRenderer = renderEmailComponent as EmailRenderer,
) {
  const props = {
    subject: 'Twój start z OpenExpert',
    preheader: 'Dziękujemy za zainteresowanie programem wczesnego dostępu OpenExpert.',
    siteUrl: /^https?:\/\//u.test(siteUrl) ? siteUrl : undefined,
  }
  const [html, text] = await Promise.all([
    renderer('WaitlistConfirmationEmail', props, { pretty: false }),
    renderer('WaitlistConfirmationEmail', props, { plainText: true, htmlToTextOptions: { wordwrap: 100 } }),
  ])
  return { subject: props.subject, html: body(html), text: body(text) }
}
