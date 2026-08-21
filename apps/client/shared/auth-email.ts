export interface AuthAccessEmailProps {
  subject: string
  preheader: string
  productLabel: string
  title: string
  intro: string
  actionLabel: string
  url: string
  securityText: string
  messageReference: string
  notice?: {
    title: string
    text: string
  }
}
