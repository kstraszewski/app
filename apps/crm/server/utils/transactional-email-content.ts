import type { TransactionalEmailProps } from '../../shared/transactional-email.ts'

type EmailRendererResult = string | { html: string, subject?: string }
export type TransactionalEmailRenderer = (
  component: string,
  props: Record<string, unknown>,
  options?: { plainText?: boolean, pretty?: boolean, htmlToTextOptions?: { tables?: string[], wordwrap?: number } },
) => Promise<EmailRendererResult>

function body(result: EmailRendererResult) { return typeof result === 'string' ? result : result.html }

export async function renderTransactionalEmail(
  props: TransactionalEmailProps,
  renderer: TransactionalEmailRenderer = renderEmailComponent as TransactionalEmailRenderer,
) {
  const input = props as unknown as Record<string, unknown>
  const [html, text] = await Promise.all([
    renderer('TransactionalEmail', input, { pretty: false }),
    renderer('TransactionalEmail', input, {
      plainText: true,
      htmlToTextOptions: { tables: ['.oe-details'], wordwrap: 100 },
    }),
  ])
  return { subject: props.subject, html: body(html), text: body(text) }
}
