declare module '#openexpert/email-renderer' {
  export function renderEmailComponent(
    componentName: string,
    props: Record<string, unknown>,
    options?: {
      plainText?: boolean
      pretty?: boolean
      htmlToTextOptions?: { tables?: string[], wordwrap?: number }
    },
  ): Promise<string | { html: string, subject?: string }>
}
