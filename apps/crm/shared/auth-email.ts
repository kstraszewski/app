export interface AuthEmailDetail {
  label: string
  value: string
}

export interface AuthEmailNotice {
  title: string
  text: string
}

export interface AuthTransactionalEmailProps {
  subject: string
  preheader: string
  title: string
  intro: string
  actionLabel: string
  url: string
  messageReference: string
  details?: AuthEmailDetail[]
  notice?: AuthEmailNotice
  securityText: string
}
