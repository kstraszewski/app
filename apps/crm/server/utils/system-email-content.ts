import type { TransactionalEmailProps } from '../../shared/transactional-email.ts'
import { renderTransactionalEmail, type TransactionalEmailRenderer } from './transactional-email-content.ts'

function compact(value: string) { return value.replace(/\s+/gu, ' ').trim() }

export async function renderClientLegalDocumentsEmail(
  input: { organizationName: string },
  renderer?: TransactionalEmailRenderer,
) {
  const organizationName = compact(input.organizationName)
  const organization = organizationName || 'Twój pośrednik kredytowy'
  const props: TransactionalEmailProps = {
    subject: organizationName ? `Dokumenty OFI i RODO – ${organizationName}` : 'Dokumenty OFI i RODO',
    preheader: 'W załącznikach znajdziesz dokumenty informacyjne dotyczące obsługi Twojej sprawy.',
    brand: organization,
    eyebrow: 'Dokumenty obowiązkowe',
    title: 'Dokumenty OFI i RODO',
    greeting: 'Dzień dobry,',
    intro: `W załącznikach przesyłamy dokumenty od ${organization}.`,
    details: [
      { label: 'Załącznik', value: 'OFI.pdf — Informacja dla konsumenta' },
      { label: 'Załącznik', value: 'RODO.pdf — Klauzula informacyjna' },
    ],
    notice: { title: 'Informacja ustawowa', text: 'Ta wiadomość służy spełnieniu obowiązków informacyjnych. Nie jest prośbą o wyrażenie zgody.', tone: 'info' },
    securityText: organizationName ? `W razie pytań skontaktuj się bezpośrednio z ${organizationName}.` : 'W razie pytań skontaktuj się ze swoim pośrednikiem kredytowym.',
    footer: `${organization} · wiadomość transakcyjna`,
  }
  return renderTransactionalEmail(props, renderer)
}

export async function renderMultiformPackageEmail(
  input: { recipientName: string },
  renderer?: TransactionalEmailRenderer,
) {
  const recipientName = compact(input.recipientName) || 'Kliencie'
  const props: TransactionalEmailProps = {
    subject: 'Dokumenty do wniosków bankowych',
    preheader: 'Zabezpieczona paczka dokumentów jest w załączniku ZIP.',
    brand: 'OpenExpert',
    eyebrow: 'Dokumenty do wniosków',
    title: 'Paczka dokumentów jest gotowa',
    greeting: `Dzień dobry, ${recipientName}!`,
    intro: 'W załączniku przesyłamy przygotowaną paczkę dokumentów do wniosków bankowych.',
    details: [{ label: 'Załącznik', value: 'wnioski-bankowe.zip' }],
    notice: { title: 'Zabezpieczona paczka ZIP', text: 'Hasłem jest Twój numer PESEL: 11 cyfr, bez spacji. Numer nie jest podany w tej wiadomości.', tone: 'info' },
    securityText: 'Jeśli nie oczekujesz tych dokumentów, skontaktuj się ze swoim ekspertem i usuń wiadomość.',
    footer: 'OpenExpert · wiadomość transakcyjna',
  }
  return renderTransactionalEmail(props, renderer)
}

export async function renderOpenExpertMockBankEmail(
  input: {
    kind: 'esis' | 'credit_decision'
    applicationNumber: string
    applicantNames: readonly string[]
    issueDate: string
    validUntil: string | null
    decisionOutcome?: 'positive' | 'negative' | null
    archiveName: string
  },
  renderer?: TransactionalEmailRenderer,
) {
  const date = (value: string) => new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`))
  const decision = input.kind === 'credit_decision'
  const positive = input.decisionOutcome === 'positive'
  const title = decision ? (positive ? 'Pozytywna decyzja kredytowa' : 'Negatywna decyzja kredytowa') : 'Formularz informacyjny ESIS jest gotowy'
  const documentDescription = decision ? (positive ? 'pozytywną decyzję kredytową' : 'negatywną decyzję kredytową') : 'spersonalizowany formularz informacyjny ESIS'
  const status = decision ? (positive ? 'DECYZJA POZYTYWNA' : 'DECYZJA NEGATYWNA') : 'ESIS GOTOWY'
  const props: TransactionalEmailProps = {
    subject: `[DEMO] OpenExpert Bank — ${decision ? (positive ? 'decyzja pozytywna' : 'decyzja negatywna') : 'formularz ESIS'} — ${input.applicationNumber}`,
    preheader: `${title}. Zaszyfrowany dokument jest w załączniku ZIP.`,
    brand: 'OpenExpert Bank',
    brandNote: 'ŚRODOWISKO DEMO',
    eyebrow: 'OpenExpert Bank',
    status: { label: status, tone: decision ? (positive ? 'success' : 'danger') : 'info' },
    title,
    greeting: 'Dzień dobry,',
    intro: `W załączniku przesyłamy ${documentDescription}.`,
    details: [
      { label: 'Numer wniosku', value: input.applicationNumber },
      { label: 'Data dokumentu', value: date(input.issueDate) },
      ...(input.validUntil ? [{ label: 'Ważny do', value: date(input.validUntil) }] : []),
      { label: input.applicantNames.length === 1 ? 'Wnioskodawca' : 'Wnioskodawcy', value: input.applicantNames.join(', ') },
      { label: 'Załącznik', value: input.archiveName },
    ],
    notice: { title: 'Bezpieczny załącznik', text: 'Hasłem do archiwum ZIP jest 11-cyfrowy numer PESEL głównego wnioskodawcy. Numer PESEL nie jest podany w tej wiadomości.', tone: 'info' },
    listTitle: 'Co dalej?',
    listItems: ['Zapisz załączone archiwum ZIP.', 'Rozpakuj je przy użyciu numeru PESEL głównego wnioskodawcy.', 'Zweryfikuj PDF i dodaj go do właściwego wniosku w OpenExpert.'],
    securityText: 'To automatyczna wiadomość z demonstracyjnej instytucji finansowej. Dokument służy wyłącznie do testowania obiegu w OpenExpert.',
    footer: 'OpenExpert Bank · wiadomość testowa',
  }
  return renderTransactionalEmail(props, renderer)
}
