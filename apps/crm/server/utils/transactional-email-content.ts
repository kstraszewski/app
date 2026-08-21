import type { TransactionalEmailProps } from '../../shared/transactional-email.ts'

type EmailRendererResult = string | { html: string, subject?: string }
export type TransactionalEmailRenderer = (
  component: string,
  props: Record<string, unknown>,
  options?: { plainText?: boolean, pretty?: boolean, htmlToTextOptions?: { tables?: string[], wordwrap?: number } },
) => Promise<EmailRendererResult>

function body(result: EmailRendererResult) { return typeof result === 'string' ? result : result.html }

async function defaultTransactionalEmailRenderer(
  component: string,
  props: Record<string, unknown>,
  options?: Parameters<TransactionalEmailRenderer>[2],
): Promise<EmailRendererResult> {
  // Nitro's auto-import transform does not reliably inject an identifier used
  // as a default parameter in a server utility. Resolve the generated Nuxt
  // import explicitly at call time so production and development use the same
  // renderer while plain Node tests can still inject a lightweight renderer.
  const { renderEmailComponent } = await import('#openexpert/email-renderer')
  return renderEmailComponent(component, props, options)
}

export async function renderTransactionalEmail(
  props: TransactionalEmailProps,
  renderer: TransactionalEmailRenderer = defaultTransactionalEmailRenderer,
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
