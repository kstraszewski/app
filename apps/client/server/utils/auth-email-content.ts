import { createHash } from 'node:crypto'
import type { AuthAccessEmailProps } from '../../shared/auth-email.ts'

export type ClientAuthEmailKind = 'email-verification' | 'magic-link' | 'password-reset'

interface RenderedEmail {
  html: string
  subject?: string
}

type EmailRenderer = (
  componentName: string,
  props: Record<string, unknown>,
  options?: { plainText?: boolean, pretty?: boolean, htmlToTextOptions?: { wordwrap?: number } },
) => Promise<string | RenderedEmail>

function messageReference(url: string) {
  return `OE-${createHash('sha256').update(url).digest('hex').slice(0, 8).toUpperCase()}`
}

export function clientAuthEmailDefinition(
  kind: ClientAuthEmailKind,
  url: string,
  metadata?: Record<string, unknown>,
): AuthAccessEmailProps {
  const base = {
    productLabel: 'Panel klienta',
    url,
    messageReference: messageReference(url),
  }
  if (kind === 'password-reset') {
    return {
      ...base,
      subject: 'Ustaw nowe hasło w panelu OpenExpert',
      preheader: 'Ustaw nowe hasło, korzystając z bezpiecznego linku.',
      title: 'Ustaw nowe hasło',
      intro: 'Otrzymaliśmy prośbę o zmianę hasła do Twojego panelu klienta.',
      actionLabel: 'Ustaw nowe hasło',
      notice: { title: 'Link jest ważny przez 1 godzinę.', text: 'Możesz go wykorzystać tylko raz.' },
      securityText: 'Jeśli to nie Ty poprosiłeś o zmianę hasła, zignoruj tę wiadomość. Hasło pozostanie bez zmian.',
    }
  }
  if (kind === 'magic-link' && metadata?.clientPortalBooking === true) {
    return {
      ...base,
      subject: 'Potwierdź konto i dokończ rezerwację w OpenExpert',
      preheader: 'Potwierdź konto klienta i wróć bezpiecznie do rezerwacji.',
      title: 'Dokończ rezerwację',
      intro: 'Potwierdź adres e-mail, aby wrócić do rezerwacji spotkania.',
      actionLabel: 'Potwierdź konto i kontynuuj',
      notice: { title: 'Link jest ważny przez 1 godzinę.', text: 'Możesz go wykorzystać tylko raz.' },
      securityText: 'Jeśli nie rozpoczynałeś rezerwacji, zignoruj tę wiadomość.',
    }
  }
  if (kind === 'magic-link') {
    return {
      ...base,
      subject: 'Twój link logowania do panelu OpenExpert',
      preheader: 'Zaloguj się bez hasła, korzystając z jednorazowego linku.',
      title: 'Zaloguj się do panelu',
      intro: 'Kliknij przycisk poniżej, aby bezpiecznie zalogować się do panelu klienta.',
      actionLabel: 'Zaloguj się',
      notice: { title: 'Link jest ważny przez 1 godzinę.', text: 'Nie przekazuj go dalej.' },
      securityText: 'Jeśli nie próbujesz się zalogować, zignoruj tę wiadomość.',
    }
  }
  return {
    ...base,
    subject: 'Potwierdź adres e-mail w panelu OpenExpert',
    preheader: 'Potwierdź adres e-mail, aby dokończyć konfigurację konta.',
    title: 'Potwierdź adres e-mail',
    intro: 'Potwierdź, że ten adres e-mail należy do Ciebie, aby dokończyć konfigurację panelu.',
    actionLabel: 'Potwierdź adres e-mail',
    securityText: 'Jeśli nie zakładasz konta w OpenExpert, zignoruj tę wiadomość.',
  }
}

function body(result: string | RenderedEmail) {
  return typeof result === 'string' ? result : result.html
}

export async function renderClientAuthEmail(
  kind: ClientAuthEmailKind,
  url: string,
  metadata?: Record<string, unknown>,
  renderer: EmailRenderer = renderEmailComponent as EmailRenderer,
) {
  const props = clientAuthEmailDefinition(kind, url, metadata)
  const [html, text] = await Promise.all([
    renderer('AuthAccessEmail', props as unknown as Record<string, unknown>, { pretty: false }),
    renderer('AuthAccessEmail', props as unknown as Record<string, unknown>, {
      plainText: true,
      htmlToTextOptions: { wordwrap: 100 },
    }),
  ])
  return { subject: props.subject, html: body(html), text: body(text) }
}
