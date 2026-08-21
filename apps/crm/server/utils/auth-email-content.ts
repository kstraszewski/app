import { createHash } from 'node:crypto'
import type { AuthTransactionalEmailProps } from '../../shared/auth-email.ts'

export type AuthEmailKind = 'email-verification' | 'magic-link' | 'password-reset'

interface AuthEmailDefinition {
  subject: string
  props: AuthTransactionalEmailProps
}

interface AuthEmailRendererOptions {
  pretty?: boolean
  plainText?: boolean
  htmlToTextOptions?: {
    tables?: string[]
    wordwrap?: number
  }
}

type AuthEmailRendererResult = string | {
  html: string
  subject?: string
}

export type AuthEmailRenderer = (
  componentName: string,
  props: Record<string, unknown>,
  options?: AuthEmailRendererOptions,
) => Promise<AuthEmailRendererResult>

async function defaultAuthEmailRenderer(
  componentName: string,
  props: Record<string, unknown>,
  options?: AuthEmailRendererOptions,
): Promise<AuthEmailRendererResult> {
  // Nitro does not reliably inject a nuxt-email-renderer auto-import into a
  // server utility. Resolve the generated server module explicitly so the
  // production bundle cannot reference an undefined global identifier.
  const { renderEmailComponent } = await import('#openexpert/email-renderer')
  return renderEmailComponent(componentName, props, options)
}

function template(
  url: string,
  messageReference: string,
  input: Omit<AuthTransactionalEmailProps, 'url' | 'messageReference'>,
): AuthEmailDefinition {
  return {
    subject: input.subject,
    props: {
      ...input,
      url,
      messageReference,
    },
  }
}

export function authEmailDefinition(
  kind: AuthEmailKind,
  url: string,
  metadata?: Record<string, unknown>,
): AuthEmailDefinition {
  const messageReference = `OE-${createHash('sha256').update(url).digest('hex').slice(0, 8).toUpperCase()}`

  if (kind === 'password-reset') {
    const subject = 'Ustaw nowe hasło w OpenExpert'
    return template(url, messageReference, {
      subject,
      preheader: 'Ustaw nowe hasło, korzystając z bezpiecznego linku.',
      title: 'Ustaw nowe hasło',
      intro: 'Otrzymaliśmy prośbę o zmianę hasła do Twojego konta OpenExpert.',
      actionLabel: 'Ustaw nowe hasło',
      securityText: 'Jeśli to nie Ty, zignoruj tę wiadomość. Twoje hasło pozostanie bez zmian.',
    })
  }

  if (kind === 'magic-link') {
    if (metadata?.organizationMemberInvitation === true) {
      const organizationName = String(metadata.organizationName || '').trim().slice(0, 160)
      const role = metadata.role === 'admin' ? 'administratora' : 'użytkownika'
      const subject = `Zaproszenie ${role} do OpenExpert`
      return template(url, messageReference, {
        subject,
        preheader: 'Potwierdź adres e-mail i dołącz do organizacji.',
        title: organizationName ? `Dołącz do ${organizationName}` : 'Dołącz do organizacji',
        intro: 'Masz zaproszenie do współpracy w OpenExpert. Potwierdź adres e-mail, aby uzyskać dostęp.',
        actionLabel: 'Dołącz do organizacji',
        details: [
          ...(organizationName ? [{ label: 'Organizacja', value: organizationName }] : []),
          { label: 'Rola', value: role === 'administratora' ? 'Administrator' : 'Użytkownik' },
          { label: 'Płatność', value: 'Miejsce jest już opłacone' },
        ],
        securityText: 'Link jest jednorazowy, ważny przez 1 godzinę i przeznaczony tylko dla Ciebie. Jeśli nie oczekujesz tej wiadomości, możesz ją zignorować.',
      })
    }

    if (metadata?.organizationInvitation === true) {
      const organizationName = String(metadata.organizationName || '').trim().slice(0, 160)
      const billingDiscountLabel = String(metadata.billingDiscountLabel || '').trim().slice(0, 160)

      if (metadata.onboardingSource === 'self_service') {
        const initialSeatCount = Number(metadata.initialSeatCount)
        const seatCount = Number.isSafeInteger(initialSeatCount)
          && initialSeatCount >= 1
          && initialSeatCount <= 100
          ? initialSeatCount
          : 1
        const billingPlan = metadata.billingPlan === 'team' ? 'Zespół' : 'Indywidualny'
        const seatDisplayLabel = seatCount === 1 ? '1 użytkownik' : `${seatCount} użytkowników`
        const subject = 'Dokończ rejestrację organizacji w OpenExpert'
        return template(url, messageReference, {
          subject,
          preheader: 'Potwierdź adres e-mail i dokończ rejestrację organizacji.',
          title: 'Dokończ rejestrację',
          intro: 'Jeszcze jeden krok: potwierdź adres e-mail, a następnie przejdź do bezpiecznej płatności.',
          actionLabel: 'Potwierdź e-mail i kontynuuj',
          details: [
            ...(organizationName ? [{ label: 'Organizacja', value: organizationName }] : []),
            { label: 'Plan', value: billingPlan },
            { label: 'Dostęp', value: seatDisplayLabel },
          ],
          notice: {
            title: 'Co stanie się dalej?',
            text: 'Po potwierdzeniu adresu zobaczysz podsumowanie i płatność w Stripe Checkout.',
          },
          securityText: 'Link jest jednorazowy, ważny przez 1 godzinę i przeznaczony tylko dla Ciebie. Jeśli nie rozpoczynałeś rejestracji, zignoruj tę wiadomość.',
        })
      }

      const subject = 'Aktywuj organizację w OpenExpert'
      return template(url, messageReference, {
        subject,
        preheader: 'Potwierdź adres e-mail i aktywuj organizację w OpenExpert.',
        title: 'Aktywuj organizację',
        intro: 'Masz zaproszenie do utworzenia konta administratora w OpenExpert.',
        actionLabel: 'Aktywuj organizację',
        details: [
          ...(organizationName ? [{ label: 'Organizacja', value: organizationName }] : []),
          { label: 'Rola', value: 'Administrator' },
          ...(billingDiscountLabel ? [{ label: 'Oferta', value: billingDiscountLabel }] : []),
        ],
        notice: billingDiscountLabel
          ? {
              title: 'Przypisana oferta',
              text: 'Rabat zostanie zastosowany automatycznie w Stripe Checkout.',
            }
          : undefined,
        securityText: 'Link jest jednorazowy, ważny przez 1 godzinę i przeznaczony tylko dla Ciebie. Jeśli nie oczekujesz tej wiadomości, możesz ją zignorować.',
      })
    }

    if (metadata?.clientPortalInvitation === true) {
      const subject = 'Aktywuj bezpieczny panel klienta OpenExpert'
      return template(url, messageReference, {
        subject,
        preheader: 'Aktywuj bezpieczny panel i uzyskaj dostęp do swoich spraw.',
        title: 'Twój panel klienta jest gotowy',
        intro: 'Twój ekspert udostępnił Ci bezpieczny panel klienta OpenExpert.',
        actionLabel: 'Aktywuj panel klienta',
        notice: {
          title: 'W panelu klienta',
          text: 'Znajdziesz dokumenty, wiadomości i bieżące informacje dotyczące Twojej sprawy.',
        },
        securityText: 'Link jest jednorazowy i ważny przez 1 godzinę. Nie przekazuj go dalej. Jeśli nie oczekujesz tej wiadomości, możesz ją zignorować.',
      })
    }

    if (metadata?.clientPortalBookingActivation === true) {
      const subject = 'Aktywuj panel po rezerwacji w OpenExpert'
      return template(url, messageReference, {
        subject,
        preheader: 'Konsultacja jest zapisana — aktywuj panel, aby zobaczyć termin.',
        title: 'Konsultacja zapisana',
        intro: 'Aktywuj panel klienta, aby zobaczyć termin konsultacji i dalsze informacje.',
        actionLabel: 'Aktywuj panel klienta',
        securityText: 'Link jest jednorazowy, ważny przez 1 godzinę i przeznaczony tylko dla Ciebie.',
      })
    }

    const subject = 'Twój link logowania do OpenExpert'
    return template(url, messageReference, {
      subject,
      preheader: 'Skorzystaj z jednorazowego linku, aby zalogować się do OpenExpert.',
      title: 'Zaloguj się do OpenExpert',
      intro: 'Kliknij przycisk poniżej, aby bezpiecznie zalogować się bez podawania hasła.',
      actionLabel: 'Zaloguj się',
      securityText: 'Link jest jednorazowy i przeznaczony tylko dla Ciebie. Jeśli nie próbujesz się zalogować, zignoruj tę wiadomość.',
    })
  }

  const subject = 'Potwierdź adres e-mail w OpenExpert'
  return template(url, messageReference, {
    subject,
    preheader: 'Potwierdź adres e-mail, aby dokończyć konfigurację konta.',
    title: 'Potwierdź adres e-mail',
    intro: 'Potwierdź, że ten adres e-mail należy do Ciebie, aby dokończyć konfigurację konta OpenExpert.',
    actionLabel: 'Potwierdź adres e-mail',
    securityText: 'Jeśli nie zakładasz konta w OpenExpert, zignoruj tę wiadomość.',
  })
}

function renderedBody(result: AuthEmailRendererResult): string {
  return typeof result === 'string' ? result : result.html
}

function renderedSubject(result: AuthEmailRendererResult): string | undefined {
  return typeof result === 'string' ? undefined : result.subject
}

export async function emailContent(
  kind: AuthEmailKind,
  url: string,
  metadata?: Record<string, unknown>,
  renderer?: AuthEmailRenderer,
) {
  const definition = authEmailDefinition(kind, url, metadata)
  const render = renderer ?? defaultAuthEmailRenderer
  const props = definition.props as unknown as Record<string, unknown>
  const [htmlResult, textResult] = await Promise.all([
    render('AuthTransactionalEmail', props, { pretty: false }),
    render('AuthTransactionalEmail', props, {
      plainText: true,
      htmlToTextOptions: {
        tables: ['.oe-details'],
        wordwrap: 100,
      },
    }),
  ])
  const subjects = [renderedSubject(htmlResult), renderedSubject(textResult)].filter(Boolean)
  if (subjects.some(subject => subject !== definition.subject)) {
    throw new Error('Rendered authentication email subject does not match its definition')
  }

  return {
    subject: definition.subject,
    html: renderedBody(htmlResult),
    text: renderedBody(textResult),
  }
}
