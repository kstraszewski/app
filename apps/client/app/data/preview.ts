import type {
  PortalCase,
  PortalMultiformAnswers,
  PortalMultiformPayload,
  PortalPayload,
} from '~/types/portal'

export const previewCase: PortalCase = {
  id: 'case-preview-warszewo',
  title: 'Zakup mieszkania — Warszewo',
  subtitle: 'Klienci, nieruchomości, oferty, kredyt hipoteczny i formalności.',
  statusCode: 'documents',
  caseNumber: 'OE/2026/07/0247',
  location: 'Warszewo, Szczecin',
  openedAt: '2026-07-24T08:30:00.000Z',
  updatedAt: '2026-08-01T09:20:00.000Z',
  organization: {
    id: 'org-openexpert-local',
    name: 'OpenExpert Szczecin',
    slug: 'openexpert-local',
  },
  expert: {
    id: 'expert-marta-nowak',
    name: 'Marta Nowak',
    initials: 'MN',
  },
  clientPerson: {
    id: 'person-jan-kowalski',
    displayName: 'Jan Kowalski',
  },
  grant: {
    portalEnabled: true,
    multiformEnabled: true,
    portalEnabledAt: '2026-07-29T08:15:00.000Z',
    multiformEnabledAt: '2026-08-01T09:20:00.000Z',
  },
  progressPercent: 46,
  steps: [
    { id: 'scope', label: 'Zakres sprawy', status: 'completed' },
    { id: 'intake', label: 'Pytania wstępne', status: 'completed' },
    { id: 'documents', label: 'Dokumenty', status: 'current' },
    { id: 'forms', label: 'Formularze bankowe', status: 'waiting' },
    { id: 'package', label: 'Paczka ZIP', status: 'waiting' },
  ],
  documents: { total: 6, uploaded: 2, pending: 4 },
  action: {
    kind: 'upload_document',
    title: 'Potrzebujemy wyciągu z rachunku za ostatnie 3 miesiące',
    description: 'Wyciąg pomoże nam potwierdzić Twoją zdolność kredytową i przyspieszy decyzję banku. Pobierz plik PDF lub JPG z bankowości internetowej.',
    deadlineAt: '2026-08-05T21:59:59.000Z',
    label: 'Dodaj dokument',
  },
  timeline: [
    {
      id: 'update-documents-received',
      kind: 'document',
      title: 'Dziękujemy za przesłane dokumenty',
      body: 'Otrzymaliśmy zaświadczenie o zarobkach i umowę przedwstępną. Wszystko wygląda dobrze, przechodzimy dalej.',
      createdAt: '2026-07-30T13:42:00.000Z',
      author: { name: 'Marta Nowak', role: 'expert' },
    },
    {
      id: 'update-case-started',
      kind: 'message',
      title: 'Rozpoczęliśmy Twoją sprawę',
      body: 'Przeanalizowaliśmy wstępne informacje. Przygotowujemy listę dokumentów i przechodzimy do kolejnego etapu.',
      createdAt: '2026-07-29T08:15:00.000Z',
      author: { name: 'Marta Nowak', role: 'expert' },
    },
  ],
}

export const previewWaitingCase: PortalCase = {
  id: 'case-preview-refinance',
  title: 'Refinansowanie kredytu hipotecznego',
  subtitle: 'Analiza ofert i przygotowanie do przeniesienia obecnego kredytu.',
  statusCode: 'analysis',
  caseNumber: 'OE/2026/05/0188',
  location: 'Szczecin',
  openedAt: '2026-05-12T09:00:00.000Z',
  updatedAt: '2026-07-31T14:10:00.000Z',
  organization: previewCase.organization,
  expert: previewCase.expert,
  clientPerson: previewCase.clientPerson,
  grant: {
    portalEnabled: true,
    multiformEnabled: false,
    portalEnabledAt: '2026-05-12T09:00:00.000Z',
  },
  progressPercent: 78,
  steps: [
    { id: 'scope', label: 'Zakres sprawy', status: 'completed' },
    { id: 'documents', label: 'Dokumenty', status: 'completed' },
    { id: 'offers', label: 'Porównanie ofert', status: 'current' },
    { id: 'decision', label: 'Decyzja i formalności', status: 'waiting' },
  ],
  documents: { total: 4, uploaded: 4, pending: 0 },
  action: {
    kind: 'wait',
    title: 'Teraz porównujemy dla Ciebie finalne oferty',
    description: 'Nie musisz nic robić. Marta wróci z rekomendacją, gdy banki potwierdzą warunki.',
  },
  timeline: [],
}

export const previewPortal: PortalPayload = {
  user: {
    id: 'user-jan-kowalski',
    name: 'Jan Kowalski',
    email: 'jan.kowalski@example.pl',
  },
  linked: true,
  cases: [previewCase, previewWaitingCase],
  activeCaseId: previewCase.id,
  appointments: [{
    id: 'appointment-preview-credit-review',
    status: 'confirmed',
    startsAt: '2026-08-04T12:30:00.000Z',
    endsAt: '2026-08-04T13:15:00.000Z',
    timezone: 'Europe/Warsaw',
    meetingMode: 'online',
    service: { id: 'service-mortgage-review', name: 'Omówienie dokumentów i kolejnych kroków' },
    expert: { id: previewCase.expert.id, name: previewCase.expert.name },
  }],
  nextAppointment: {
    id: 'appointment-preview-credit-review',
    status: 'confirmed',
    startsAt: '2026-08-04T12:30:00.000Z',
    endsAt: '2026-08-04T13:15:00.000Z',
    timezone: 'Europe/Warsaw',
    meetingMode: 'online',
    service: { id: 'service-mortgage-review', name: 'Omówienie dokumentów i kolejnych kroków' },
    expert: { id: previewCase.expert.id, name: previewCase.expert.name },
  },
  nextStep: {
    kind: 'upload_document',
    responsibility: 'client',
    title: 'Załącz wyciąg z rachunku za ostatnie 3 miesiące',
    description: previewCase.action?.description,
    caseId: previewCase.id,
    label: 'Przejdź do dokumentów',
    to: `/preview/cases/${previewCase.id}`,
  },
}

export const emptyPreviewAnswers: PortalMultiformAnswers = {
  applicant: {
    incomeSource: 'employment',
    employmentType: 'indefinite',
    incomePaidToAccount: true,
    additionalIncome: null,
    liabilities: null,
  },
  case: {
    loanPurpose: 'purchase_secondary',
    preliminaryAgreement: true,
    landRegister: true,
    appraisalAvailable: null,
    trancheDisbursement: null,
  },
}

export const previewMultiform: PortalMultiformPayload = {
  access: 'unlocked',
  grant: previewCase.grant,
  draft: {
    answers: emptyPreviewAnswers,
    activeStep: 1,
    revision: 3,
    updatedAt: '2026-08-01T09:20:00.000Z',
  },
}
