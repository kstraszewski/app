export interface TransactionalEmailDetail {
  label: string
  value: string
}

export interface TransactionalEmailNotice {
  title: string
  text: string
  tone?: 'neutral' | 'info' | 'success' | 'danger'
}

export interface TransactionalEmailStatus {
  label: string
  tone: 'neutral' | 'info' | 'success' | 'danger'
}

export interface TransactionalEmailProps {
  subject: string
  preheader: string
  brand: string
  brandNote?: string
  eyebrow: string
  title: string
  greeting?: string
  intro: string
  details?: TransactionalEmailDetail[]
  status?: TransactionalEmailStatus
  notice?: TransactionalEmailNotice
  listTitle?: string
  listItems?: string[]
  securityText?: string
  footer: string
}
