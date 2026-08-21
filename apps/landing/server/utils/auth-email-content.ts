import { createHash } from 'node:crypto'
import type { AuthAccessEmailProps } from '../../shared/auth-email.ts'

type AuthEmailKind = 'email-verification' | 'magic-link' | 'password-reset'
type EmailRendererResult = string | { html: string, subject?: string }
type EmailRenderer = (component: string, props: Record<string, unknown>, options?: { plainText?: boolean, pretty?: boolean, htmlToTextOptions?: { wordwrap?: number } }) => Promise<EmailRendererResult>

function renderedBody(result: EmailRendererResult) { return typeof result === 'string' ? result : result.html }

export function landingAuthEmailDefinition(kind: AuthEmailKind, url: string): AuthAccessEmailProps {
  const messageReference = `OE-${createHash('sha256').update(url).digest('hex').slice(0, 8).toUpperCase()}`
  const base = { url, messageReference }
  if (kind === 'password-reset') return {
    ...base,
    subject: 'Ustaw nowe hasło w OpenExpert',
    preheader: 'Ustaw nowe hasło, korzystając z bezpiecznego linku.',
    title: 'Ustaw nowe hasło',
    intro: 'Otrzymaliśmy prośbę o zmianę hasła do Twojego konta OpenExpert.',
    actionLabel: 'Ustaw nowe hasło',
    notice: { title: 'Link jest ważny przez 1 godzinę.', text: 'Możesz go wykorzystać tylko raz.' },
    securityText: 'Jeśli to nie Ty poprosiłeś o zmianę hasła, zignoruj tę wiadomość.',
  }
  if (kind === 'magic-link') return {
    ...base,
    subject: 'Twój link logowania do OpenExpert',
    preheader: 'Zaloguj się bez hasła, korzystając z jednorazowego linku.',
    title: 'Zaloguj się do OpenExpert',
    intro: 'Kliknij przycisk poniżej, aby bezpiecznie zalogować się bez podawania hasła.',
    actionLabel: 'Zaloguj się',
    notice: { title: 'Link jest ważny przez 1 godzinę.', text: 'Nie przekazuj go dalej.' },
    securityText: 'Jeśli nie próbujesz się zalogować, zignoruj tę wiadomość.',
  }
  return {
    ...base,
    subject: 'Potwierdź adres e-mail w OpenExpert',
    preheader: 'Potwierdź adres e-mail, aby dokończyć konfigurację konta.',
    title: 'Potwierdź adres e-mail',
    intro: 'Potwierdź, że ten adres e-mail należy do Ciebie, aby dokończyć konfigurację konta OpenExpert.',
    actionLabel: 'Potwierdź adres e-mail',
    securityText: 'Jeśli nie zakładasz konta w OpenExpert, zignoruj tę wiadomość.',
  }
}

export async function renderLandingAuthEmail(kind: AuthEmailKind, url: string, renderer: EmailRenderer = renderEmailComponent as EmailRenderer) {
  const props = landingAuthEmailDefinition(kind, url)
  const [html, text] = await Promise.all([
    renderer('AuthAccessEmail', props as unknown as Record<string, unknown>, { pretty: false }),
    renderer('AuthAccessEmail', props as unknown as Record<string, unknown>, { plainText: true, htmlToTextOptions: { wordwrap: 100 } }),
  ])
  return { subject: props.subject, html: renderedBody(html), text: renderedBody(text) }
}
