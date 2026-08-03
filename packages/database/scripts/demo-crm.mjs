import { createHash } from 'node:crypto'
import { calculateMortgageCatalogVersion } from '../../mortgage/src/index.ts'

const dayMs = 24 * 60 * 60 * 1000
export const demoNamespace = 'openexpert-local-demo'

const clientSeeds = [
  {
    key: 'client-jan-kowalski',
    displayName: 'Jan Kowalski',
    statusCode: 'active',
    leadSource: 'referral',
    email: 'jan.kowalski@example.local',
    phone: '+48 501 210 101',
    tags: ['hipoteka', 'rodzina', 'polecenie', 'demo'],
    notes: 'Wspólny zakup mieszkania z Anną Kowalską. Preferowany kontakt po 16:00.',
    metadata: { client_type: 'person', household: 'kowalscy' },
    people: [
      {
        key: 'primary',
        role: 'primary',
        firstName: 'Jan',
        lastName: 'Kowalski',
        displayName: 'Jan Kowalski',
        email: 'jan.kowalski@example.local',
        phone: '+48 501 210 101',
        pesel: '85010112345',
        dateOfBirth: '1985-01-01',
      },
    ],
    consents: {
      marketing_email: true,
      marketing_sms: true,
      marketing_phone: false,
    },
  },
  {
    key: 'client-anna-kowalska',
    displayName: 'Anna Kowalska',
    statusCode: 'active',
    leadSource: 'referral',
    email: 'anna.kowalska@example.local',
    phone: '+48 501 210 102',
    tags: ['hipoteka', 'rodzina', 'polecenie', 'demo'],
    notes: 'Współwnioskodawczyni w sprawie zakupu mieszkania na Warszewie.',
    metadata: { client_type: 'person', household: 'kowalscy' },
    people: [
      {
        key: 'primary',
        role: 'primary',
        firstName: 'Anna',
        lastName: 'Kowalska',
        displayName: 'Anna Kowalska',
        email: 'anna.kowalska@example.local',
        phone: '+48 501 210 102',
        pesel: '87020223456',
        dateOfBirth: '1987-02-02',
      },
    ],
    consents: {
      marketing_email: true,
      marketing_sms: true,
      marketing_phone: true,
    },
  },
  {
    key: 'client-marta-wisniewska',
    displayName: 'Marta Wiśniewska',
    statusCode: 'lead',
    leadSource: 'booking_widget',
    email: 'marta.wisniewska@example.local',
    phone: '+48 502 320 203',
    tags: ['pierwsze-mieszkanie', 'widget', 'demo'],
    notes: 'Pierwszy zakup nieruchomości. Potrzebuje wyjaśnienia wkładu własnego.',
    metadata: { client_type: 'person', preferred_channel: 'email' },
    people: [
      {
        key: 'primary',
        role: 'primary',
        firstName: 'Marta',
        lastName: 'Wiśniewska',
        displayName: 'Marta Wiśniewska',
        email: 'marta.wisniewska@example.local',
        phone: '+48 502 320 203',
        pesel: '93030334567',
        dateOfBirth: '1993-03-03',
      },
    ],
    consents: {
      marketing_email: true,
      marketing_sms: false,
      marketing_phone: false,
    },
  },
  {
    key: 'client-michal-lewandowski',
    displayName: 'Michał Lewandowski',
    statusCode: 'active',
    leadSource: 'partner',
    email: 'michal.lewandowski@example.local',
    phone: '+48 503 430 304',
    tags: ['kredyt-gotowkowy', 'remont', 'partner', 'demo'],
    notes: 'Finansowanie remontu kuchni i łazienki.',
    metadata: { client_type: 'person', preferred_channel: 'phone' },
    people: [
      {
        key: 'primary',
        role: 'primary',
        firstName: 'Michał',
        lastName: 'Lewandowski',
        displayName: 'Michał Lewandowski',
        email: 'michal.lewandowski@example.local',
        phone: '+48 503 430 304',
        pesel: '89040445678',
        dateOfBirth: '1989-04-04',
      },
    ],
    consents: {
      marketing_email: false,
      marketing_sms: true,
      marketing_phone: true,
    },
  },
  {
    key: 'client-alicja-mazur',
    displayName: 'Alicja Mazur',
    statusCode: 'inactive',
    leadSource: 'import',
    email: 'alicja.mazur@example.local',
    phone: '+48 504 540 405',
    tags: ['ubezpieczenie', 'odnowienie', 'import', 'demo'],
    notes: 'Klientka historyczna. Kontakt wyłącznie w sprawie trwającej polisy.',
    metadata: { client_type: 'person', do_not_market: true },
    people: [
      {
        key: 'primary',
        role: 'primary',
        firstName: 'Alicja',
        lastName: 'Mazur',
        displayName: 'Alicja Mazur',
        email: 'alicja.mazur@example.local',
        phone: '+48 504 540 405',
        pesel: '78050556789',
        dateOfBirth: '1978-05-05',
      },
    ],
    consents: {
      marketing_email: false,
      marketing_sms: false,
      marketing_phone: false,
    },
  },
  {
    key: 'client-joanna-krawczyk',
    displayName: 'Joanna Krawczyk',
    statusCode: 'active',
    leadSource: 'website',
    email: 'joanna.krawczyk@example.local',
    phone: '+48 505 650 506',
    tags: ['nieruchomosci', 'sprzedaz', 'hipoteka', 'demo'],
    notes: 'Sprzedaż obecnego domu i równoległy zakup większej nieruchomości.',
    metadata: { client_type: 'household', preferred_channel: 'email' },
    people: [
      {
        key: 'primary',
        role: 'primary',
        firstName: 'Joanna',
        lastName: 'Krawczyk',
        displayName: 'Joanna Krawczyk',
        email: 'joanna.krawczyk@example.local',
        phone: '+48 505 650 506',
        pesel: '82060667890',
        dateOfBirth: '1982-06-06',
      },
      {
        key: 'co-applicant',
        role: 'co_applicant',
        firstName: 'Tomasz',
        lastName: 'Krawczyk',
        displayName: 'Tomasz Krawczyk',
        email: 'tomasz.krawczyk@example.local',
        phone: '+48 505 650 507',
        pesel: '80070778901',
        dateOfBirth: '1980-07-07',
      },
    ],
    consents: {
      marketing_email: true,
      marketing_sms: true,
      marketing_phone: true,
    },
  },
  {
    key: 'client-adam-nowak',
    displayName: 'Adam Nowak',
    statusCode: 'active',
    leadSource: 'referral',
    email: 'adam.nowak@example.local',
    phone: '+48 506 760 607',
    tags: ['hipoteka', 'klient-powracajacy', 'zakonczona', 'demo'],
    notes: 'Kredyt uruchomiony. Potencjał na ubezpieczenie i polecenia.',
    metadata: { client_type: 'person', customer_since: '2025' },
    people: [
      {
        key: 'primary',
        role: 'primary',
        firstName: 'Adam',
        lastName: 'Nowak',
        displayName: 'Adam Nowak',
        email: 'adam.nowak@example.local',
        phone: '+48 506 760 607',
        pesel: '86080889012',
        dateOfBirth: '1986-08-08',
      },
    ],
    consents: {
      marketing_email: true,
      marketing_sms: false,
      marketing_phone: true,
    },
  },
  {
    key: 'client-katarzyna-wojcik',
    displayName: 'Katarzyna Wójcik',
    statusCode: 'blocked',
    leadSource: 'website',
    email: 'katarzyna.wojcik@example.local',
    phone: '+48 507 870 708',
    tags: ['refinansowanie', 'utracona', 'żądanie-anonimizacji', 'demo'],
    notes: 'Sprawa zamknięta po wyborze oferty konkurencyjnego pośrednika.',
    metadata: { client_type: 'person', contact_block_reason: 'client_request' },
    people: [
      {
        key: 'primary',
        role: 'primary',
        firstName: 'Katarzyna',
        lastName: 'Wójcik',
        displayName: 'Katarzyna Wójcik',
        email: 'katarzyna.wojcik@example.local',
        phone: '+48 507 870 708',
        pesel: '91090990123',
        dateOfBirth: '1991-09-09',
      },
    ],
    consents: {
      marketing_email: false,
      marketing_sms: false,
      marketing_phone: false,
    },
  },
  {
    key: 'client-baltic-homes',
    displayName: 'Baltic Homes sp. z o.o.',
    statusCode: 'active',
    leadSource: 'partner',
    email: 'finanse@baltichomes.example.local',
    phone: '+48 508 980 809',
    tags: ['firma', 'deweloper', 'kredyt-firmowy', 'demo'],
    notes: 'Finansowanie bieżącego etapu inwestycji mieszkaniowej.',
    metadata: {
      client_type: 'company',
      tax_id: '8510000000',
      registry_number: '0000123456',
    },
    people: [
      {
        key: 'primary',
        role: 'primary',
        firstName: 'Paweł',
        lastName: 'Król',
        displayName: 'Paweł Król',
        email: 'pawel.krol@baltichomes.example.local',
        phone: '+48 508 980 809',
        pesel: '79010101234',
        dateOfBirth: '1979-01-01',
      },
      {
        key: 'finance-contact',
        role: 'finance_contact',
        firstName: 'Magdalena',
        lastName: 'Lis',
        displayName: 'Magdalena Lis',
        email: 'magdalena.lis@baltichomes.example.local',
        phone: '+48 508 980 810',
        pesel: null,
        dateOfBirth: null,
      },
    ],
    consents: {
      marketing_email: true,
      marketing_sms: true,
      marketing_phone: true,
    },
  },
]

const caseSeeds = [
  {
    key: 'case-mortgage-warszewo',
    title: 'Zakup mieszkania — Warszewo',
    clientKeys: ['client-jan-kowalski', 'client-anna-kowalska'],
    statusCode: 'analiza',
    priority: 'high',
    progressPercent: 48,
    description: 'Wspólny zakup mieszkania z rynku wtórnego. Trwa kompletowanie dokumentów i porównanie finansowania.',
    openedDaysAgo: 24,
    items: [
      { key: 'mortgage', productCode: 'credit_mortgage', title: 'Kredyt hipoteczny', statusCode: 'dokumenty', amount: 640000, closeDays: 52 },
      { key: 'renovation', productCode: 'credit_cash', title: 'Finansowanie remontu', statusCode: 'kwalifikacja', amount: 65000, closeDays: 68, metadata: { purpose: 'renovation' } },
      { key: 'life-insurance', productCode: 'insurance_life', title: 'Ubezpieczenie życia kredytobiorców', statusCode: 'analiza_potrzeb', amount: null, closeDays: 75 },
      { key: 'property-insurance', productCode: 'insurance_property', title: 'Ubezpieczenie mieszkania', statusCode: 'analiza_potrzeb', amount: null, closeDays: 75 },
    ],
    properties: [
      {
        key: 'warszewo-primary',
        itemKey: 'mortgage',
        address: 'ul. Maciejkowa 18/7',
        city: 'Szczecin',
        postalCode: '71-784',
        propertyType: 'apartment',
        marketType: 'secondary',
        price: 800000,
        appraisal: 815000,
        area: 67.4,
        rooms: 3,
        title: '3 pokoje z balkonem na Warszewie',
        selected: true,
      },
      {
        key: 'pogodno-alternative',
        itemKey: 'mortgage',
        address: 'ul. Mickiewicza 112/4',
        city: 'Szczecin',
        postalCode: '71-141',
        propertyType: 'apartment',
        marketType: 'secondary',
        price: 845000,
        appraisal: null,
        area: 72.1,
        rooms: 4,
        title: 'Alternatywne mieszkanie na Pogodnie',
      },
    ],
    offers: [
      {
        key: 'pko-wlasny-kat',
        bankSlug: 'pko-bp',
        productSlug: 'wlasny-kat-fixed-5y',
        savedDaysAgo: 3,
        startApplication: true,
      },
      {
        // Keep the fixture key stable so an existing local seed is updated
        // instead of leaving the former ING shortlist row behind.
        key: 'ing-latwy-start',
        bankSlug: 'pekao',
        productSlug: 'housing-fixed-5y',
        savedDaysAgo: 2,
        startApplication: true,
      },
    ],
    tasks: [
      { key: 'income-documents', itemKey: 'mortgage', title: 'Uzupełnij dokumenty dochodowe', description: 'Brakuje zaświadczenia Anny i wyciągów z ostatnich 3 miesięcy.', statusCode: 'open', priority: 'urgent', dueDays: -2 },
      {
        key: 'property-register',
        itemKey: 'mortgage',
        title: 'Zweryfikuj księgę wieczystą',
        description: 'Sprawdź działy II–IV księgi i dopisz wynik w historii sprawy.',
        statusCode: 'in_progress',
        priority: 'high',
        dueDays: 1,
        delegateKey: 'anna-nowak',
        delegationStatus: 'accepted',
        delegatedDaysAgo: 6,
        respondedDaysAgo: 5,
        dataAccessScope: [
          'case_summary',
          'client_contact',
          'client_identity',
          'documents',
        ],
      },
      {
        key: 'insurance-call',
        itemKey: 'life-insurance',
        title: 'Omów zakres ochrony życia',
        description: 'Skontaktuj się z klientami i potwierdź oczekiwany zakres oraz sumę ochrony.',
        statusCode: 'open',
        priority: 'normal',
        dueDays: 5,
        delegateKey: 'piotr-zielinski',
        delegationStatus: 'pending',
        delegatedDaysAgo: 1,
        dataAccessScope: ['case_summary', 'client_contact', 'financial_data'],
      },
    ],
    documents: [
      { key: 'jan-id', clientKey: 'client-jan-kowalski', itemKey: 'mortgage', type: 'identity_document', name: 'Dowód osobisty — Jan Kowalski', statusCode: 'verified', receivedDays: -18, verifiedDays: -17 },
      { key: 'anna-id', clientKey: 'client-anna-kowalska', itemKey: 'mortgage', type: 'identity_document', name: 'Dowód osobisty — Anna Kowalska', statusCode: 'received', receivedDays: -16 },
      { key: 'income-evidence', itemKey: 'mortgage', type: 'income_evidence', name: 'Dokumenty dochodowe wnioskodawców', statusCode: 'missing' },
      { key: 'property-legal', itemKey: 'mortgage', type: 'property_legal_documents', name: 'Dokumenty prawne nieruchomości', statusCode: 'received', receivedDays: -5 },
    ],
    history: [
      { key: 'opened', daysAgo: 24, type: 'case_created', title: 'Utworzono sprawę', body: 'Rozpoczęto proces zakupu mieszkania na Warszewie.' },
      { key: 'clients', daysAgo: 23, type: 'clients_linked', title: 'Dodano współwnioskodawczynię', body: 'Do sprawy dołączono Annę Kowalską.' },
      { key: 'documents', daysAgo: 16, type: 'documents_received', title: 'Odebrano pierwsze dokumenty', body: 'Zarejestrowano dokumenty tożsamości wnioskodawców.', itemKey: 'mortgage' },
      { key: 'status', daysAgo: 8, type: 'status_changed', title: 'Sprawa przeszła do analizy', body: 'Rozpoczęto analizę dokumentów i nieruchomości.', payload: { status_code: 'analiza' } },
      { key: 'note', daysAgo: 2, type: 'note', title: 'Kontakt z klientami', body: 'Klienci potwierdzili planowany termin podpisania umowy przedwstępnej.' },
    ],
  },
  {
    key: 'case-first-apartment',
    title: 'Pierwsze mieszkanie — Centrum',
    clientKeys: ['client-marta-wisniewska'],
    statusCode: 'nowa',
    priority: 'normal',
    progressPercent: 15,
    description: 'Wstępna analiza budżetu i przygotowanie klientki do poszukiwania mieszkania.',
    openedDaysAgo: 6,
    items: [
      { key: 'mortgage', productCode: 'credit_mortgage', title: 'Kredyt hipoteczny', statusCode: 'kwalifikacja', amount: 420000, closeDays: 90 },
      { key: 'property-search', productCode: 'real_estate_purchase', title: 'Poszukiwanie mieszkania', statusCode: 'poszukiwanie_lub_listing', amount: 520000, closeDays: 80 },
    ],
    properties: [
      {
        key: 'centrum-candidate',
        itemKey: 'property-search',
        address: 'ul. Śląska 41/12',
        city: 'Szczecin',
        postalCode: '70-431',
        propertyType: 'apartment',
        marketType: 'secondary',
        price: 519000,
        appraisal: null,
        area: 43.2,
        rooms: 2,
        title: 'Dwupokojowe mieszkanie blisko Jasnych Błoni',
        selected: true,
      },
    ],
    tasks: [
      {
        key: 'capacity-interview',
        itemKey: 'mortgage',
        title: 'Przeprowadź wywiad zdolnościowy',
        description: 'Umów 30-minutową rozmowę i uzupełnij źródła dochodu oraz zobowiązania.',
        statusCode: 'open',
        priority: 'normal',
        dueDays: 2,
        delegateKey: 'marta-wojcik',
        delegationStatus: 'accepted',
        delegatedDaysAgo: 3,
        respondedDaysAgo: 2,
        dataAccessScope: ['case_summary', 'client_contact', 'financial_data'],
      },
      { key: 'own-contribution', itemKey: 'mortgage', title: 'Potwierdź źródło wkładu własnego', statusCode: 'open', priority: 'normal', dueDays: 6 },
    ],
    documents: [
      { key: 'employment-contract', itemKey: 'mortgage', type: 'income_evidence', name: 'Umowa o pracę', statusCode: 'missing' },
      { key: 'bank-statements', itemKey: 'mortgage', type: 'bank_account_statements', name: 'Wyciągi z rachunku', statusCode: 'missing' },
    ],
    history: [
      { key: 'opened', daysAgo: 6, type: 'case_created', title: 'Utworzono sprawę', body: 'Klientka przesłała formularz z kalkulatora zdolności.' },
      { key: 'property', daysAgo: 3, type: 'property_selected', title: 'Dodano pierwszą nieruchomość', body: 'Zapisano mieszkanie przy ul. Śląskiej.' },
    ],
  },
  {
    key: 'case-kitchen-renovation',
    title: 'Remont kuchni i łazienki',
    clientKeys: ['client-michal-lewandowski'],
    statusCode: 'aktywna',
    priority: 'normal',
    progressPercent: 65,
    description: 'Kredyt gotówkowy na kompleksowy remont mieszkania.',
    openedDaysAgo: 18,
    items: [
      { key: 'cash-loan', productCode: 'credit_cash', title: 'Kredyt na remont', statusCode: 'oferty', amount: 85000, closeDays: 18, metadata: { purpose: 'renovation' } },
    ],
    properties: [],
    tasks: [
      { key: 'compare-offers', itemKey: 'cash-loan', title: 'Porównaj trzy warianty kredytu', statusCode: 'in_progress', priority: 'normal', dueDays: 0 },
      { key: 'client-decision', itemKey: 'cash-loan', title: 'Zadzwoń po decyzję klienta', statusCode: 'open', priority: 'high', dueDays: 3 },
    ],
    documents: [
      { key: 'income', itemKey: 'cash-loan', type: 'income_evidence', name: 'Zaświadczenie o dochodach', statusCode: 'verified', receivedDays: -12, verifiedDays: -10 },
    ],
    history: [
      { key: 'opened', daysAgo: 18, type: 'case_created', title: 'Utworzono sprawę', body: 'Partner remontowy przekazał kontakt do klienta.' },
      { key: 'offers', daysAgo: 4, type: 'status_changed', title: 'Przygotowano warianty finansowania', body: 'Sprawa przeszła do porównania ofert.', itemKey: 'cash-loan', payload: { status_code: 'oferty' } },
    ],
  },
  {
    key: 'case-home-policy-renewal',
    title: 'Odnowienie polisy domu',
    clientKeys: ['client-alicja-mazur'],
    statusCode: 'czeka_na_klienta',
    priority: 'high',
    progressPercent: 35,
    description: 'Odnowienie polisy nieruchomości przed końcem obecnego okresu ochrony.',
    openedDaysAgo: 12,
    items: [
      { key: 'property-insurance', productCode: 'insurance_property', title: 'Ubezpieczenie domu', statusCode: 'oferty', amount: null, closeDays: 14 },
    ],
    properties: [],
    tasks: [
      { key: 'confirm-sum', itemKey: 'property-insurance', title: 'Potwierdź sumę ubezpieczenia', statusCode: 'open', priority: 'high', dueDays: -1 },
      {
        key: 'send-comparison',
        itemKey: 'property-insurance',
        title: 'Wyślij porównanie wariantów',
        description: 'Przygotuj krótkie porównanie trzech wariantów i wskaż rekomendację.',
        statusCode: 'cancelled',
        priority: 'normal',
        dueDays: 2,
        delegateKey: 'piotr-zielinski',
        delegationStatus: 'rejected',
        delegatedDaysAgo: 4,
        respondedDaysAgo: 3,
        rejectionReason: 'Nie zdążę przed terminem odnowienia — potrzebne przejęcie przez inną osobę.',
        dataAccessScope: ['case_summary', 'client_contact', 'documents', 'offers'],
      },
    ],
    documents: [
      { key: 'current-policy', itemKey: 'property-insurance', type: 'insurance_policy', name: 'Obecna polisa nieruchomości', statusCode: 'received', receivedDays: -9 },
    ],
    history: [
      { key: 'opened', daysAgo: 12, type: 'case_created', title: 'Rozpoczęto odnowienie', body: 'System przypomniał o zbliżającym się końcu ochrony.' },
      { key: 'waiting', daysAgo: 3, type: 'status_changed', title: 'Oczekiwanie na klientkę', body: 'Brakuje potwierdzenia aktualnej wartości nieruchomości.', payload: { status_code: 'czeka_na_klienta' } },
    ],
  },
  {
    key: 'case-sale-and-purchase',
    title: 'Sprzedaż domu i zakup nowego',
    clientKeys: ['client-joanna-krawczyk'],
    statusCode: 'aktywna',
    priority: 'urgent',
    progressPercent: 70,
    description: 'Połączony proces sprzedaży obecnego domu, zakupu nowego i finansowania różnicy.',
    openedDaysAgo: 41,
    items: [
      { key: 'property-sale', productCode: 'real_estate_sale', title: 'Sprzedaż domu w Mierzynie', statusCode: 'negocjacje', amount: 1280000, closeDays: 22 },
      { key: 'mortgage', productCode: 'credit_mortgage', title: 'Kredyt na nowy dom', statusCode: 'oferty', amount: 720000, closeDays: 45 },
    ],
    properties: [
      {
        key: 'mierzyn-sale',
        itemKey: 'property-sale',
        address: 'ul. Nasienna 14',
        city: 'Mierzyn',
        postalCode: '72-006',
        propertyType: 'house',
        marketType: 'secondary',
        price: 1280000,
        appraisal: 1250000,
        area: 168.5,
        rooms: 6,
        title: 'Dom rodzinny na sprzedaż',
      },
      {
        key: 'bezrzecze-purchase',
        itemKey: 'mortgage',
        address: 'ul. Koralowa 8',
        city: 'Bezrzecze',
        postalCode: '71-218',
        propertyType: 'house',
        marketType: 'primary',
        price: 1490000,
        appraisal: 1510000,
        area: 181.2,
        rooms: 6,
        title: 'Nowy dom w zabudowie bliźniaczej',
        selected: true,
      },
    ],
    tasks: [
      { key: 'buyer-negotiation', itemKey: 'property-sale', title: 'Uzgodnij warunki z kupującym', statusCode: 'in_progress', priority: 'urgent', dueDays: 1 },
      { key: 'mortgage-documents', itemKey: 'mortgage', title: 'Skompletuj dokumenty nowego domu', statusCode: 'open', priority: 'high', dueDays: 4 },
    ],
    documents: [
      { key: 'sale-register', itemKey: 'property-sale', type: 'property_legal_documents', name: 'Księga wieczysta sprzedawanego domu', statusCode: 'verified', receivedDays: -30, verifiedDays: -28 },
      { key: 'developer-agreement', itemKey: 'mortgage', type: 'property_legal_documents', name: 'Umowa deweloperska nowego domu', statusCode: 'received', receivedDays: -6 },
    ],
    history: [
      { key: 'opened', daysAgo: 41, type: 'case_created', title: 'Utworzono sprawę łączoną', body: 'Rozpoczęto przygotowanie sprzedaży i nowego finansowania.' },
      { key: 'listing', daysAgo: 33, type: 'property_listed', title: 'Opublikowano ofertę domu', body: 'Dom w Mierzynie trafił do sprzedaży.', itemKey: 'property-sale' },
      { key: 'negotiation', daysAgo: 5, type: 'status_changed', title: 'Rozpoczęto negocjacje', body: 'Otrzymano pierwszą wiążącą propozycję kupującego.', itemKey: 'property-sale', payload: { status_code: 'negocjacje' } },
    ],
  },
  {
    key: 'case-mortgage-completed',
    title: 'Kredyt mieszkaniowy 2025',
    clientKeys: ['client-adam-nowak'],
    statusCode: 'zakonczona',
    priority: 'normal',
    progressPercent: 100,
    description: 'Historyczna, zakończona sprawa kredytu mieszkaniowego.',
    openedDaysAgo: 190,
    closedDaysAgo: 45,
    items: [
      { key: 'mortgage', productCode: 'credit_mortgage', title: 'Kredyt hipoteczny', statusCode: 'uruchomiony', amount: 510000, wonDaysAgo: 45 },
    ],
    properties: [
      {
        key: 'completed-property',
        itemKey: 'mortgage',
        address: 'ul. Duńska 72/9',
        city: 'Szczecin',
        postalCode: '71-795',
        propertyType: 'apartment',
        marketType: 'secondary',
        price: 650000,
        appraisal: 660000,
        area: 58.9,
        rooms: 3,
        title: 'Kupione mieszkanie klienta',
        selected: true,
      },
    ],
    tasks: [
      {
        key: 'archive',
        itemKey: 'mortgage',
        title: 'Zarchiwizuj komplet dokumentów',
        description: 'Zweryfikuj kompletność teczki i oznacz dokumenty zgodnie z retencją.',
        statusCode: 'done',
        priority: 'low',
        dueDays: -40,
        completedDays: -41,
        delegateKey: 'marta-wojcik',
        delegationStatus: 'accepted',
        delegatedDaysAgo: 48,
        respondedDaysAgo: 47,
        dataAccessScope: ['case_summary', 'documents', 'activities'],
      },
    ],
    documents: [
      { key: 'credit-agreement', itemKey: 'mortgage', type: 'credit_agreement', name: 'Umowa kredytowa', statusCode: 'verified', receivedDays: -52, verifiedDays: -50 },
    ],
    history: [
      { key: 'opened', daysAgo: 190, type: 'case_created', title: 'Utworzono sprawę', body: 'Rozpoczęto proces kredytowy.' },
      { key: 'completed', daysAgo: 45, type: 'status_changed', title: 'Kredyt został uruchomiony', body: 'Bank wypłacił środki, a sprawę zakończono.', itemKey: 'mortgage', payload: { status_code: 'zakonczona' } },
    ],
  },
  {
    key: 'case-refinance-lost',
    title: 'Refinansowanie kredytu — utracone',
    clientKeys: ['client-katarzyna-wojcik'],
    statusCode: 'utracona',
    priority: 'low',
    progressPercent: 100,
    description: 'Klientka zrezygnowała po otrzymaniu kontroferty z obecnego banku.',
    openedDaysAgo: 54,
    closedDaysAgo: 15,
    items: [
      { key: 'mortgage', productCode: 'credit_mortgage', title: 'Refinansowanie hipoteki', statusCode: 'utracony', amount: 390000, lostDaysAgo: 15 },
    ],
    properties: [],
    tasks: [
      { key: 'close-followup', itemKey: 'mortgage', title: 'Zapisz powód utraty sprawy', statusCode: 'done', priority: 'low', dueDays: -14, completedDays: -15 },
    ],
    documents: [],
    history: [
      { key: 'opened', daysAgo: 54, type: 'case_created', title: 'Utworzono sprawę refinansowania', body: 'Klientka chciała obniżyć miesięczną ratę.' },
      { key: 'lost', daysAgo: 15, type: 'status_changed', title: 'Sprawa została utracona', body: 'Klientka przyjęła kontrofertę obecnego banku.', itemKey: 'mortgage', payload: { status_code: 'utracona', reason: 'retention_offer' } },
    ],
  },
  {
    key: 'case-business-financing',
    title: 'Finansowanie etapu inwestycji Baltic Homes',
    clientKeys: ['client-baltic-homes'],
    statusCode: 'analiza',
    priority: 'high',
    progressPercent: 30,
    description: 'Analiza finansowania kolejnego etapu inwestycji mieszkaniowej.',
    openedDaysAgo: 10,
    items: [
      { key: 'business-credit', productCode: 'credit_business', title: 'Kredyt firmowy', statusCode: 'dokumenty', amount: 2500000, closeDays: 75 },
    ],
    properties: [],
    tasks: [
      { key: 'financial-statements', itemKey: 'business-credit', title: 'Odbierz sprawozdania finansowe', statusCode: 'open', priority: 'high', dueDays: 2 },
      { key: 'investment-budget', itemKey: 'business-credit', title: 'Zweryfikuj budżet inwestycji', statusCode: 'open', priority: 'normal', dueDays: 7 },
    ],
    documents: [
      { key: 'financial-report', itemKey: 'business-credit', type: 'financial_statements', name: 'Sprawozdanie finansowe za poprzedni rok', statusCode: 'received', receivedDays: -2 },
      { key: 'investment-budget', itemKey: 'business-credit', type: 'investment_budget', name: 'Budżet etapu inwestycji', statusCode: 'missing' },
    ],
    history: [
      { key: 'opened', daysAgo: 10, type: 'case_created', title: 'Utworzono sprawę firmową', body: 'Partner przekazał zapytanie o finansowanie inwestycji.' },
      { key: 'documents', daysAgo: 2, type: 'documents_received', title: 'Odebrano pierwsze dane finansowe', body: 'Sprawozdanie przekazano do analizy.', itemKey: 'business-credit' },
    ],
  },
]

const settlementSeeds = [
  {
    caseKey: 'case-mortgage-warszewo',
    itemKey: 'mortgage',
    statusCode: 'oczekiwane',
    expectedAmount: 12800,
    dueAmount: 0,
    paidAmount: 0,
    dueDays: 66,
    notes: 'Szacowana prowizja za uruchomienie kredytu hipotecznego.',
    metadata: { commission_basis: '2% kwoty finansowania' },
  },
  {
    caseKey: 'case-mortgage-warszewo',
    itemKey: 'renovation',
    statusCode: 'szacowane',
    expectedAmount: 1950,
    dueAmount: 0,
    paidAmount: 0,
    dueDays: 82,
    notes: 'Szacowana prowizja za finansowanie remontu.',
    metadata: { commission_basis: '3% kwoty finansowania' },
  },
  {
    caseKey: 'case-mortgage-warszewo',
    itemKey: 'life-insurance',
    statusCode: 'szacowane',
    expectedAmount: 1600,
    dueAmount: 0,
    paidAmount: 0,
    dueDays: 89,
    notes: 'Szacowana prowizja za polisę życia kredytobiorców.',
    metadata: { commission_basis: 'prowizja produktowa' },
  },
  {
    caseKey: 'case-mortgage-warszewo',
    itemKey: 'property-insurance',
    statusCode: 'szacowane',
    expectedAmount: 650,
    dueAmount: 0,
    paidAmount: 0,
    dueDays: 89,
    notes: 'Szacowana prowizja za ubezpieczenie nieruchomości.',
    metadata: { commission_basis: 'prowizja produktowa' },
  },
  {
    caseKey: 'case-first-apartment',
    itemKey: 'mortgage',
    statusCode: 'szacowane',
    expectedAmount: 8400,
    dueAmount: 0,
    paidAmount: 0,
    dueDays: 104,
    notes: 'Szacowana prowizja za kredyt na pierwsze mieszkanie.',
    metadata: { commission_basis: '2% kwoty finansowania' },
  },
  {
    caseKey: 'case-first-apartment',
    itemKey: 'property-search',
    statusCode: 'szacowane',
    expectedAmount: 15600,
    dueAmount: 0,
    paidAmount: 0,
    dueDays: 94,
    notes: 'Szacowana prowizja za usługę pośrednictwa w zakupie.',
    metadata: { commission_basis: '3% ceny nieruchomości' },
  },
  {
    caseKey: 'case-kitchen-renovation',
    itemKey: 'cash-loan',
    statusCode: 'oczekiwane',
    expectedAmount: 2550,
    dueAmount: 0,
    paidAmount: 0,
    dueDays: 32,
    notes: 'Oczekiwana prowizja za kredyt gotówkowy.',
    metadata: { commission_basis: '3% kwoty finansowania' },
  },
  {
    caseKey: 'case-home-policy-renewal',
    itemKey: 'property-insurance',
    statusCode: 'oczekiwane',
    expectedAmount: 520,
    dueAmount: 0,
    paidAmount: 0,
    dueDays: 28,
    notes: 'Oczekiwana prowizja za odnowienie polisy domu.',
    metadata: { commission_basis: 'prowizja produktowa' },
  },
  {
    caseKey: 'case-sale-and-purchase',
    itemKey: 'property-sale',
    statusCode: 'oczekiwane',
    expectedAmount: 38400,
    dueAmount: 0,
    paidAmount: 0,
    dueDays: 36,
    notes: 'Oczekiwana prowizja za pośrednictwo w sprzedaży domu.',
    metadata: { commission_basis: '3% ceny nieruchomości' },
  },
  {
    caseKey: 'case-sale-and-purchase',
    itemKey: 'mortgage',
    statusCode: 'szacowane',
    expectedAmount: 14400,
    dueAmount: 0,
    paidAmount: 0,
    dueDays: 59,
    notes: 'Szacowana prowizja za finansowanie zakupu nowego domu.',
    metadata: { commission_basis: '2% kwoty finansowania' },
  },
  {
    caseKey: 'case-mortgage-completed',
    itemKey: 'mortgage',
    statusCode: 'nalezne',
    expectedAmount: 12750,
    dueAmount: 4250,
    paidAmount: 8500,
    dueDays: -18,
    paidDays: -9,
    notes: 'Rozliczenie częściowe: pierwsza transza wypłacona, pozostała kwota jest należna.',
    metadata: { commission_basis: '2,5% kwoty uruchomionego kredytu' },
  },
  {
    caseKey: 'case-business-financing',
    itemKey: 'business-credit',
    statusCode: 'szacowane',
    expectedAmount: 37500,
    dueAmount: 0,
    paidAmount: 0,
    dueDays: 96,
    notes: 'Szacowana prowizja za finansowanie firmowe.',
    metadata: { commission_basis: '1,5% kwoty finansowania' },
  },
]

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function demoKey(value, container = 'metadata') {
  return String(objectValue(value?.[container]).demo_seed_key ?? '')
}

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('seedNow must be a valid date')
  return date
}

export function isoOffset(seedNow, days) {
  return new Date(seedNow.getTime() + days * dayMs).toISOString()
}

function dateOffset(seedNow, days) {
  return isoOffset(seedNow, days).slice(0, 10)
}

export function stableUuid(key) {
  const bytes = Buffer.from(createHash('sha256').update(`${demoNamespace}:${key}`).digest().subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function taskDelegationFingerprint({
  organizationId,
  caseId,
  caseItemId,
  delegatorUserId,
  assigneeUserId,
  title,
  description,
  dueAt,
  priority,
  dataAccessScope,
}) {
  return createHash('sha256').update(JSON.stringify({
    organization_id: organizationId,
    case_id: caseId,
    case_item_id: caseItemId,
    delegator_user_id: delegatorUserId,
    assignee_user_id: assigneeUserId,
    title,
    description,
    due_at: dueAt,
    priority,
    data_access_scope: [...dataAccessScope].sort(),
  })).digest('hex')
}

function operationError(operation, error) {
  const message = error?.message ?? error?.details ?? String(error)
  return new Error(`${operation}: ${message}`)
}

function assertResult(result, operation) {
  if (result.error) throw operationError(operation, result.error)
  return result.data
}

export function metadataFor(key, extra = {}) {
  return {
    ...objectValue(extra),
    demo_seed_namespace: demoNamespace,
    demo_seed_key: key,
  }
}

function primaryPersonSeedKey(clientKey) {
  return `${clientKey}:person:primary`
}

async function loadActiveConsentCatalogue(adminClient, organizationId) {
  const definitions = assertResult(
    await adminClient
      .from('crm_consent_definitions')
      .select('id, code, current_version_id')
      .eq('organization_id', organizationId)
      .eq('context', 'client_creation')
      .order('code'),
    'Reading CRM consent definitions',
  ) ?? []

  const versionIds = definitions.map(definition => definition.current_version_id).filter(Boolean)
  const versions = versionIds.length
    ? assertResult(
        await adminClient
          .from('crm_consent_definition_versions')
          .select('id, definition_id, channel, status, effective_from, effective_to')
          .in('id', versionIds),
        'Reading current CRM consent versions',
      ) ?? []
    : []
  const versionById = new Map(versions.map(version => [String(version.id), version]))
  const now = Date.now()
  const catalogue = definitions.flatMap((definition) => {
    const version = versionById.get(String(definition.current_version_id))
    if (
      !version
      || version.status !== 'published'
      || new Date(version.effective_from).getTime() > now
      || (version.effective_to && new Date(version.effective_to).getTime() <= now)
    ) {
      return []
    }
    return [{
      definitionId: String(definition.id),
      versionId: String(version.id),
      code: String(definition.code),
      channel: String(version.channel),
    }]
  })

  const expectedCodes = ['marketing_email', 'marketing_phone', 'marketing_sms']
  for (const code of expectedCodes) {
    if (!catalogue.some(entry => entry.code === code)) {
      throw new Error(`The active CRM consent catalogue is missing ${code}`)
    }
  }
  return catalogue
}

async function ensureClientRecords({
  adminClient,
  userClient,
  organizationId,
  ownerUserId,
  seedNow,
  consentCatalogue,
}) {
  const existingRows = assertResult(
    await adminClient
      .from('crm_clients')
      .select('id, display_name, primary_email, primary_phone, status_code, lead_source, tags, notes, metadata')
      .eq('organization_id', organizationId),
    'Reading existing CRM clients',
  ) ?? []
  const clientByKey = new Map(
    existingRows
      .map(row => [demoKey(row), row])
      .filter(([key]) => key),
  )

  for (const seed of clientSeeds) {
    const existing = clientByKey.get(seed.key)
    const metadata = metadataFor(seed.key, {
      ...objectValue(existing?.metadata),
      ...seed.metadata,
    })

    if (!existing) {
      const primary = seed.people[0]
      const result = assertResult(
        await userClient.rpc('create_crm_client_with_consents', {
          p_organization_id: organizationId,
          p_owner_user_id: ownerUserId,
          p_display_name: seed.displayName,
          p_status_code: seed.statusCode,
          p_lead_source: seed.leadSource,
          p_primary_email: seed.email,
          p_primary_phone: seed.phone,
          p_tags: seed.tags,
          p_notes: seed.notes,
          p_metadata: metadata,
          p_primary_person: {
            role: primary.role,
            first_name: primary.firstName,
            last_name: primary.lastName,
            display_name: primary.displayName,
            email: primary.email,
            phone: primary.phone,
            pesel: primary.pesel,
            date_of_birth: primary.dateOfBirth,
            metadata: metadataFor(primaryPersonSeedKey(seed.key)),
          },
          p_consent_decisions: consentCatalogue.map(consent => ({
            definition_id: consent.definitionId,
            version_id: consent.versionId,
            granted: seed.consents[consent.code] === true,
          })),
        }),
        `Creating demo CRM client ${seed.displayName}`,
      )
      const inserted = objectValue(result?.data)
      if (!inserted.id) throw new Error(`Creating demo CRM client ${seed.displayName} returned no client id`)
      clientByKey.set(seed.key, inserted)
      continue
    }

    const updated = assertResult(
      await adminClient
        .from('crm_clients')
        .update({
          owner_user_id: ownerUserId,
          display_name: seed.displayName,
          status_code: seed.statusCode,
          lead_source: seed.leadSource,
          primary_email: seed.email,
          primary_phone: seed.phone,
          tags: seed.tags,
          notes: seed.notes,
          metadata,
        })
        .eq('organization_id', organizationId)
        .eq('id', existing.id)
        .select('id, display_name, primary_email, primary_phone, status_code, lead_source, tags, notes, metadata')
        .single(),
      `Updating demo CRM client ${seed.displayName}`,
    )
    clientByKey.set(seed.key, updated)
  }

  const clientIds = clientSeeds.map(seed => String(clientByKey.get(seed.key).id))
  const existingPeople = assertResult(
    await adminClient
      .from('crm_client_people')
      .select('id, client_id, role, first_name, last_name, display_name, email, phone, pesel, date_of_birth, metadata')
      .in('client_id', clientIds),
    'Reading people for demo CRM clients',
  ) ?? []
  const personByKey = new Map(
    existingPeople
      .map(person => [demoKey(person), person])
      .filter(([key]) => key),
  )

  for (const clientSeed of clientSeeds) {
    const client = clientByKey.get(clientSeed.key)
    for (const personSeed of clientSeed.people) {
      const key = `${clientSeed.key}:person:${personSeed.key}`
      const existing = personByKey.get(key)
      const metadata = metadataFor(key, existing?.metadata)
      const values = {
        organization_id: organizationId,
        client_id: client.id,
        role: personSeed.role,
        first_name: personSeed.firstName,
        last_name: personSeed.lastName,
        display_name: personSeed.displayName,
        email: personSeed.email,
        phone: personSeed.phone,
        pesel: personSeed.pesel,
        date_of_birth: personSeed.dateOfBirth,
        metadata,
      }

      if (existing) {
        const updated = assertResult(
          await adminClient
            .from('crm_client_people')
            .update(values)
            .eq('organization_id', organizationId)
            .eq('id', existing.id)
            .select('id, client_id, role, display_name, email, phone, pesel, metadata')
            .single(),
          `Updating demo person ${personSeed.displayName}`,
        )
        personByKey.set(key, updated)
      }
      else {
        const inserted = assertResult(
          await adminClient
            .from('crm_client_people')
            .insert(values)
            .select('id, client_id, role, display_name, email, phone, pesel, metadata')
            .single(),
          `Creating demo person ${personSeed.displayName}`,
        )
        personByKey.set(key, inserted)
      }
    }
  }

  const consentEvents = assertResult(
    await adminClient
      .from('crm_client_consent_events')
      .select('id, client_id, definition_id, definition_version_id, decision, occurred_at, metadata')
      .eq('organization_id', organizationId)
      .in('client_id', clientIds)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false }),
    'Reading demo client consent history',
  ) ?? []
  const latestConsent = new Map()
  for (const event of consentEvents) {
    const key = `${event.client_id}:${event.definition_id}`
    if (!latestConsent.has(key)) latestConsent.set(key, event)
  }

  for (const clientSeed of clientSeeds) {
    const client = clientByKey.get(clientSeed.key)
    const primaryPerson = personByKey.get(primaryPersonSeedKey(clientSeed.key))
    if (!primaryPerson) throw new Error(`Demo client ${clientSeed.displayName} has no primary person`)

    for (const consent of consentCatalogue) {
      const shouldGrant = clientSeed.consents[consent.code] === true
      const desiredDecision = shouldGrant ? 'granted' : 'declined'
      const latest = latestConsent.get(`${client.id}:${consent.definitionId}`)
      if (
        latest?.decision === desiredDecision
        && latest.definition_version_id === consent.versionId
      ) continue

      const latestTime = latest?.occurred_at ? new Date(latest.occurred_at).getTime() + 1000 : 0
      const occurredAt = new Date(Math.max(seedNow.getTime(), latestTime)).toISOString()
      const contactValue = shouldGrant
        ? consent.channel === 'email'
          ? primaryPerson.email
          : primaryPerson.phone
        : null
      if (shouldGrant && !contactValue) {
        throw new Error(`Demo consent ${consent.code} for ${clientSeed.displayName} requires contact data`)
      }

      const inserted = assertResult(
        await adminClient
          .from('crm_client_consent_events')
          .insert({
            organization_id: organizationId,
            client_id: client.id,
            subject_person_id: primaryPerson.id,
            definition_id: consent.definitionId,
            definition_version_id: consent.versionId,
            decision: desiredDecision,
            contact_value: contactValue,
            source: 'api',
            occurred_at: occurredAt,
            recorded_by_user_id: ownerUserId,
            evidence_reference: `demo-seed:${clientSeed.key}`,
            metadata: metadataFor(`${clientSeed.key}:consent:${consent.code}`),
          })
          .select('id, client_id, definition_id, definition_version_id, decision, occurred_at, metadata')
          .single(),
        `Reconciling ${consent.code} for ${clientSeed.displayName}`,
      )
      latestConsent.set(`${client.id}:${consent.definitionId}`, inserted)
    }
  }

  return {
    clientByKey,
    personByKey,
    clients: clientSeeds.map((seed) => {
      const client = clientByKey.get(seed.key)
      const primaryPerson = personByKey.get(primaryPersonSeedKey(seed.key))
      return {
        ...client,
        id: String(client.id),
        display_name: seed.displayName,
        primary_email: seed.email,
        primary_phone: seed.phone,
        primaryPerson: { id: String(primaryPerson.id) },
      }
    }),
    peopleCount: clientSeeds.reduce((total, seed) => total + seed.people.length, 0),
  }
}

async function ensureAnonymizationRequests({
  adminClient,
  organizationId,
  ownerUserId,
  seedNow,
  clientByKey,
  personByKey,
}) {
  const requestKey = 'anonymization-request:client-katarzyna-wojcik'
  const client = clientByKey.get('client-katarzyna-wojcik')
  const subjectPerson = personByKey.get(primaryPersonSeedKey('client-katarzyna-wojcik'))
  if (!client?.id) {
    throw new Error('Demo anonymization request requires the Katarzyna Wójcik client')
  }
  if (!subjectPerson?.id) {
    throw new Error('Demo anonymization request requires the Katarzyna Wójcik primary person')
  }

  const requestId = stableUuid(requestKey)
  const requestMetadata = metadataFor(requestKey, {
    demo_seed_kind: 'crm_client_anonymization_request',
  })
  const existingRequests = assertResult(
    await adminClient
      .from('crm_client_anonymization_requests')
      .select('id')
      .eq('id', requestId)
      .limit(1),
    'Reading the demo client anonymization request',
  ) ?? []

  const requestQuery = existingRequests.length
    ? adminClient
        .from('crm_client_anonymization_requests')
        .update({
          status: 'approved',
          request_channel: 'email',
          legal_basis: 'RODO art. 17',
          justification: 'Klientka zażądała usunięcia danych po zakończeniu obsługi.',
          review_note: 'Tożsamość i zakres żądania zweryfikowane. Wykonanie wymaga osobnego, czasowego grantu.',
          completed_at: null,
          completed_by_user_id: null,
          metadata: requestMetadata,
        })
        .eq('id', requestId)
    : adminClient
        .from('crm_client_anonymization_requests')
        .insert({
          id: requestId,
          organization_id: organizationId,
          client_id: client.id,
          subject_person_id: subjectPerson.id,
          idempotency_key: stableUuid(`${requestKey}:idempotency`),
          request_number: 'ANO-2026-0042',
          status: 'approved',
          request_channel: 'email',
          legal_basis: 'RODO art. 17',
          requested_at: isoOffset(seedNow, -5),
          identity_verified_at: isoOffset(seedNow, -4),
          identity_verified_by_user_id: ownerUserId,
          approved_at: isoOffset(seedNow, -3),
          approved_by_user_id: ownerUserId,
          due_at: isoOffset(seedNow, 25),
          justification: 'Klientka zażądała usunięcia danych po zakończeniu obsługi.',
          review_note: 'Tożsamość i zakres żądania zweryfikowane. Wykonanie wymaga osobnego, czasowego grantu.',
          completed_at: null,
          completed_by_user_id: null,
          created_by_user_id: ownerUserId,
          metadata: requestMetadata,
        })

  const request = assertResult(
    await requestQuery
      .select('id, client_id, request_number, status, due_at')
      .single(),
    'Seeding the demo client anonymization request',
  )

  const eventSeeds = [
    {
      key: `${requestKey}:event:received`,
      event_type: 'request_received',
      from_status: null,
      to_status: 'received',
      reason_code: 'client_request_received',
      created_at: isoOffset(seedNow, -5),
    },
    {
      key: `${requestKey}:event:identity-verified`,
      event_type: 'identity_verified',
      from_status: 'received',
      to_status: 'legal_review',
      reason_code: 'identity_confirmed',
      created_at: isoOffset(seedNow, -4),
    },
    {
      key: `${requestKey}:event:approved`,
      event_type: 'approved',
      from_status: 'legal_review',
      to_status: 'approved',
      reason_code: 'erasure_scope_approved',
      created_at: isoOffset(seedNow, -3),
    },
  ]
  const eventIds = eventSeeds.map(event => stableUuid(event.key))
  const existingEvents = assertResult(
    await adminClient
      .from('crm_client_anonymization_request_events')
      .select('id')
      .in('id', eventIds),
    'Reading demo client anonymization request events',
  ) ?? []
  const existingEventIds = new Set(existingEvents.map(event => String(event.id)))
  const missingEvents = eventSeeds
    .filter(event => !existingEventIds.has(stableUuid(event.key)))
    .map(event => ({
      id: stableUuid(event.key),
      organization_id: organizationId,
      request_id: request.id,
      event_type: event.event_type,
      from_status: event.from_status,
      to_status: event.to_status,
      actor_user_id: ownerUserId,
      reason_code: event.reason_code,
      evidence_reference: `demo-seed:${event.key}`,
      created_at: event.created_at,
    }))
  if (missingEvents.length) {
    assertResult(
      await adminClient
        .from('crm_client_anonymization_request_events')
        .insert(missingEvents),
      'Seeding demo client anonymization request events',
    )
  }

  return {
    ...request,
    event_count: eventSeeds.length,
  }
}

async function ensureCases({
  adminClient,
  userClient,
  organizationId,
  ownerUserId,
  seedNow,
  clientByKey,
}) {
  const existingRows = assertResult(
    await adminClient
      .from('crm_cases')
      .select('id, client_id, owner_user_id, title, description, status_code, priority, progress_percent, opened_at, closed_at, metadata')
      .eq('organization_id', organizationId),
    'Reading existing CRM cases',
  ) ?? []
  const caseByKey = new Map(
    existingRows
      .map(row => [demoKey(row), row])
      .filter(([key]) => key),
  )

  for (const seed of caseSeeds) {
    const clientIds = seed.clientKeys.map((key) => {
      const client = clientByKey.get(key)
      if (!client) throw new Error(`Demo CRM case ${seed.title} references missing client ${key}`)
      return String(client.id)
    })
    let existing = caseByKey.get(seed.key)

    if (!existing) {
      const created = assertResult(
        await adminClient
          .from('crm_cases')
          .insert({
            id: stableUuid(seed.key),
            organization_id: organizationId,
            client_id: clientIds[0],
            owner_user_id: ownerUserId,
            title: seed.title,
            metadata: metadataFor(seed.key, {
              demo_seed_kind: 'crm_case',
            }),
          })
          .select('id, client_id, owner_user_id, title, description, status_code, priority, progress_percent, opened_at, closed_at, metadata')
          .single(),
        `Creating demo CRM case ${seed.title}`,
      )
      if (!created?.id) throw new Error(`Creating demo CRM case ${seed.title} returned no case id`)
      existing = created
    }

    assertResult(
      await userClient.rpc('set_crm_case_clients', {
        p_organization_id: organizationId,
        p_case_id: existing.id,
        p_client_ids: clientIds,
      }),
      `Reconciling clients for demo CRM case ${seed.title}`,
    )

    const metadata = metadataFor(seed.key, {
      ...objectValue(existing.metadata),
      demo_seed_kind: 'crm_case',
    })
    const updated = assertResult(
      await adminClient
        .from('crm_cases')
        .update({
          client_id: clientIds[0],
          owner_user_id: ownerUserId,
          title: seed.title,
          description: seed.description,
          status_code: seed.statusCode,
          priority: seed.priority,
          progress_percent: seed.progressPercent,
          opened_at: isoOffset(seedNow, -seed.openedDaysAgo),
          closed_at: seed.closedDaysAgo == null ? null : isoOffset(seedNow, -seed.closedDaysAgo),
          metadata,
        })
        .eq('organization_id', organizationId)
        .eq('id', existing.id)
        .select('id, client_id, owner_user_id, title, description, status_code, priority, progress_percent, opened_at, closed_at, metadata')
        .single(),
      `Updating demo CRM case ${seed.title}`,
    )
    caseByKey.set(seed.key, updated)
  }

  return caseByKey
}

async function loadProductTypes(adminClient, organizationId) {
  const requiredCodes = [...new Set(caseSeeds.flatMap(seed => seed.items.map(item => item.productCode)))]
  const rows = assertResult(
    await adminClient
      .from('crm_product_types')
      .select('id, organization_id, code, is_active')
      .in('code', requiredCodes)
      .eq('is_active', true),
    'Reading CRM product types for demo cases',
  ) ?? []
  const byCode = new Map()
  for (const code of requiredCodes) {
    const match = rows.find(row => row.code === code && row.organization_id === organizationId)
      ?? rows.find(row => row.code === code && row.organization_id == null)
    if (!match) throw new Error(`CRM product type ${code} is not configured`)
    byCode.set(code, match)
  }
  return byCode
}

async function ensureCaseItems({
  adminClient,
  organizationId,
  ownerUserId,
  seedNow,
  caseByKey,
  productTypes,
}) {
  const caseIds = [...caseByKey.values()].map(crmCase => String(crmCase.id))
  const existingRows = assertResult(
    await adminClient
      .from('crm_case_items')
      .select('id, case_id, product_type_id, owner_user_id, title, status_code, amount_value, currency, expected_close_date, won_at, lost_at, metadata')
      .eq('organization_id', organizationId)
      .in('case_id', caseIds),
    'Reading existing demo CRM case items',
  ) ?? []
  const itemByKey = new Map(
    existingRows
      .map(row => [demoKey(row), row])
      .filter(([key]) => key),
  )

  for (const caseSeed of caseSeeds) {
    const crmCase = caseByKey.get(caseSeed.key)
    for (const itemSeed of caseSeed.items) {
      const key = `${caseSeed.key}:item:${itemSeed.key}`
      const existing = itemByKey.get(key)
      const productType = productTypes.get(itemSeed.productCode)
      const metadata = metadataFor(key, {
        ...objectValue(existing?.metadata),
        ...objectValue(itemSeed.metadata),
        product_code: itemSeed.productCode,
      })
      const values = {
        organization_id: organizationId,
        case_id: crmCase.id,
        product_type_id: productType.id,
        owner_user_id: ownerUserId,
        title: itemSeed.title,
        status_code: itemSeed.statusCode,
        amount_value: itemSeed.amount,
        currency: 'PLN',
        expected_close_date: itemSeed.closeDays == null ? null : dateOffset(seedNow, itemSeed.closeDays),
        won_at: itemSeed.wonDaysAgo == null ? null : isoOffset(seedNow, -itemSeed.wonDaysAgo),
        lost_at: itemSeed.lostDaysAgo == null ? null : isoOffset(seedNow, -itemSeed.lostDaysAgo),
        metadata,
      }

      if (existing) {
        const updated = assertResult(
          await adminClient
            .from('crm_case_items')
            .update(values)
            .eq('organization_id', organizationId)
            .eq('id', existing.id)
            .select('id, case_id, product_type_id, title, status_code, amount_value, currency, metadata')
            .single(),
          `Updating demo CRM case item ${itemSeed.title}`,
        )
        itemByKey.set(key, updated)
      }
      else {
        const inserted = assertResult(
          await adminClient
            .from('crm_case_items')
            .insert({ id: stableUuid(key), ...values })
            .select('id, case_id, product_type_id, title, status_code, amount_value, currency, metadata')
            .single(),
          `Creating demo CRM case item ${itemSeed.title}`,
        )
        itemByKey.set(key, inserted)
      }
    }
  }

  return itemByKey
}

async function ensureSettlements({
  adminClient,
  organizationId,
  seedNow,
  itemByKey,
}) {
  const settlementItemIds = settlementSeeds.map((seed) => {
    const item = itemByKey.get(`${seed.caseKey}:item:${seed.itemKey}`)
    if (!item) {
      throw new Error(`Demo settlement references missing case item ${seed.caseKey}:${seed.itemKey}`)
    }
    return String(item.id)
  })
  const existingRows = assertResult(
    await adminClient
      .from('crm_case_item_settlements')
      .select('id, case_item_id, status_code, expected_amount, due_amount, paid_amount, currency, due_date, paid_at, notes, metadata')
      .eq('organization_id', organizationId)
      .in('case_item_id', settlementItemIds),
    'Reading existing demo CRM settlements',
  ) ?? []
  const settlementByItemId = new Map(
    existingRows.map(settlement => [String(settlement.case_item_id), settlement]),
  )

  for (const seed of settlementSeeds) {
    const key = `${seed.caseKey}:item:${seed.itemKey}:settlement`
    const item = itemByKey.get(`${seed.caseKey}:item:${seed.itemKey}`)
    const existing = settlementByItemId.get(String(item.id))
    const metadata = metadataFor(key, {
      ...objectValue(existing?.metadata),
      ...objectValue(seed.metadata),
      demo_seed_kind: 'crm_case_item_settlement',
    })
    const values = {
      organization_id: organizationId,
      case_item_id: item.id,
      payer_provider_id: null,
      status_code: seed.statusCode,
      expected_amount: seed.expectedAmount,
      due_amount: seed.dueAmount,
      paid_amount: seed.paidAmount,
      currency: 'PLN',
      due_date: seed.dueDays == null ? null : dateOffset(seedNow, seed.dueDays),
      paid_at: seed.paidDays == null ? null : isoOffset(seedNow, seed.paidDays),
      notes: seed.notes,
      metadata,
    }

    const settlement = existing
      ? assertResult(
          await adminClient
            .from('crm_case_item_settlements')
            .update(values)
            .eq('organization_id', organizationId)
            .eq('id', existing.id)
            .select('id, case_item_id, status_code, expected_amount, due_amount, paid_amount, currency, due_date, paid_at, notes, metadata')
            .single(),
          `Updating demo CRM settlement for ${seed.caseKey}:${seed.itemKey}`,
        )
      : assertResult(
          await adminClient
            .from('crm_case_item_settlements')
            .insert({ id: stableUuid(key), ...values })
            .select('id, case_item_id, status_code, expected_amount, due_amount, paid_amount, currency, due_date, paid_at, notes, metadata')
            .single(),
          `Creating demo CRM settlement for ${seed.caseKey}:${seed.itemKey}`,
        )
    settlementByItemId.set(String(item.id), settlement)
  }

  return settlementByItemId
}

async function ensureProperties({
  adminClient,
  organizationId,
  ownerUserId,
  caseByKey,
  itemByKey,
}) {
  const caseIds = [...caseByKey.values()].map(crmCase => String(crmCase.id))
  const existingRows = assertResult(
    await adminClient
      .from('crm_properties')
      .select('id, case_id, case_item_id, address, city, postal_code, property_type, market_type, price_amount, appraisal_value_amount, currency, area_m2, rooms, listing_title, description, metadata')
      .eq('organization_id', organizationId)
      .in('case_id', caseIds),
    'Reading existing demo CRM properties',
  ) ?? []
  const propertyByKey = new Map(
    existingRows
      .map(row => [demoKey(row), row])
      .filter(([key]) => key),
  )

  for (const caseSeed of caseSeeds) {
    const crmCase = caseByKey.get(caseSeed.key)
    for (const propertySeed of caseSeed.properties) {
      const key = `${caseSeed.key}:property:${propertySeed.key}`
      const existing = propertyByKey.get(key)
      const caseItem = propertySeed.itemKey
        ? itemByKey.get(`${caseSeed.key}:item:${propertySeed.itemKey}`)
        : null
      const metadata = metadataFor(key, {
        ...objectValue(existing?.metadata),
        selected_in_demo: propertySeed.selected === true,
      })
      const values = {
        organization_id: organizationId,
        case_id: crmCase.id,
        case_item_id: caseItem?.id ?? null,
        address: propertySeed.address,
        city: propertySeed.city,
        postal_code: propertySeed.postalCode,
        property_type: propertySeed.propertyType,
        market_type: propertySeed.marketType,
        price_amount: propertySeed.price,
        appraisal_value_amount: propertySeed.appraisal,
        currency: 'PLN',
        area_m2: propertySeed.area,
        rooms: propertySeed.rooms,
        listing_title: propertySeed.title,
        description: `Fikcyjna nieruchomość demonstracyjna powiązana ze sprawą „${caseSeed.title}”.`,
        source_url: null,
        source_published_at: null,
        imported_at: null,
        metadata,
      }

      let property
      if (existing) {
        property = assertResult(
          await adminClient
            .from('crm_properties')
            .update(values)
            .eq('organization_id', organizationId)
            .eq('id', existing.id)
            .select('id, case_id, case_item_id, address, city, price_amount, appraisal_value_amount, metadata')
            .single(),
          `Updating demo CRM property ${propertySeed.address}`,
        )
      }
      else {
        property = assertResult(
          await adminClient
            .from('crm_properties')
            .insert({ id: stableUuid(key), ...values })
            .select('id, case_id, case_item_id, address, city, price_amount, appraisal_value_amount, metadata')
            .single(),
          `Creating demo CRM property ${propertySeed.address}`,
        )
      }
      propertyByKey.set(key, property)

      if (propertySeed.selected) {
        assertResult(
          await adminClient
            .from('crm_case_property_selections')
            .upsert({
              organization_id: organizationId,
              case_id: crmCase.id,
              property_id: property.id,
              selected_by_user_id: ownerUserId,
            }, { onConflict: 'organization_id,case_id' }),
          `Selecting demo CRM property ${propertySeed.address}`,
        )
      }
    }
  }

  return propertyByKey
}

function singleRelation(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function calculationSnapshot(calculation) {
  return {
    ...objectValue(calculation.raw),
    status: calculation.status,
    issues: calculation.issues,
  }
}

function defaultMortgageSelections(version) {
  const definition = objectValue(version.offer_definition)
  if (definition.schemaVersion !== 'openexpert.mortgage-offer/2.0') {
    return { selections: {} }
  }

  const presets = Array.isArray(definition.presets) ? definition.presets : []
  const features = Array.isArray(definition.features) ? definition.features : []
  const preset = presets.find(item => item?.isDefault === true)
  const selections = { ...objectValue(preset?.selections) }
  for (const feature of features) {
    if (typeof feature?.id !== 'string' || feature.id in selections) continue
    if (typeof feature.defaultOptionId === 'string') {
      selections[feature.id] = feature.defaultOptionId
    }
  }
  return {
    ...(typeof preset?.id === 'string' ? { presetId: preset.id } : {}),
    selections,
  }
}

function mortgageProductSeedKey(bankSlug, productSlug) {
  return `${bankSlug}:${productSlug}`
}

async function loadDemoMortgageProducts({
  adminClient,
  organizationId,
  productReferences,
}) {
  const references = [...new Map(productReferences.map(reference => [
    mortgageProductSeedKey(reference.bankSlug, reference.productSlug),
    reference,
  ])).values()]
  const productSlugs = [...new Set(references.map(reference => reference.productSlug))]
  const products = assertResult(
    await adminClient
      .from('mortgage_products')
      .select('id, slug, name, category, bank_id, current_published_version_id, mortgage_banks!inner(id, slug, name, website_url, logo_url, logo_background_color)')
      .in('slug', productSlugs)
      .eq('is_active', true)
      .is('archived_at', null),
    'Reading mortgage products for demo CRM offers',
  ) ?? []
  const productBySeedKey = new Map(products.map((product) => {
    const bank = singleRelation(product.mortgage_banks)
    return [mortgageProductSeedKey(String(bank.slug), String(product.slug)), product]
  }))
  for (const reference of references) {
    const seedKey = mortgageProductSeedKey(reference.bankSlug, reference.productSlug)
    if (!productBySeedKey.has(seedKey)) {
      throw new Error(`Demo CRM offer references missing mortgage product ${seedKey}`)
    }
  }

  const versionIds = products.map(product => product.current_published_version_id).filter(Boolean)
  const versions = assertResult(
    await adminClient
      .from('mortgage_product_versions')
      .select('*')
      .in('id', versionIds)
      .eq('lifecycle_status', 'published'),
    'Reading mortgage product versions for demo CRM offers',
  ) ?? []
  const versionById = new Map(versions.map(version => [String(version.id), version]))
  for (const product of products) {
    if (!versionById.has(String(product.current_published_version_id))) {
      throw new Error(`Mortgage product ${product.slug} has no current published version`)
    }
  }

  const sourceIds = [...new Set(versions.map(version => version.source_document_id).filter(Boolean))]
  const sources = sourceIds.length
    ? assertResult(
        await adminClient
          .from('mortgage_source_documents')
          .select('id, title, source_url, source_kind, sha256, storage_path, retrieved_at, published_at, retrieval_status, extraction_status')
          .in('id', sourceIds),
        'Reading mortgage sources for demo CRM offers',
      ) ?? []
    : []
  const variants = assertResult(
    await adminClient
      .from('mortgage_product_version_variants')
      .select('id, product_version_id, code, name, is_default, calculation_readiness, pricing_config, eligibility_config, sort_order')
      .in('product_version_id', versionIds)
      .order('sort_order'),
    'Reading mortgage variants for demo CRM offers',
  ) ?? []
  const overrides = assertResult(
    await adminClient
      .from('mortgage_product_overrides')
      .select('id, product_id, is_enabled, custom_name, parameters, notes, revision, created_at, updated_at, created_by, updated_by')
      .eq('organization_id', organizationId)
      .in('product_id', products.map(product => product.id)),
    'Reading mortgage product overrides for demo CRM offers',
  ) ?? []
  const bankOverrides = assertResult(
    await adminClient
      .from('mortgage_bank_overrides')
      .select('id, bank_id, is_enabled, custom_name, custom_website_url, logo_path, revision, created_at, updated_at')
      .eq('organization_id', organizationId)
      .in('bank_id', products.map(product => product.bank_id)),
    'Reading mortgage bank overrides for demo CRM offers',
  ) ?? []

  const sourceById = new Map(sources.map(source => [String(source.id), source]))
  const overrideByProductId = new Map(overrides.map(override => [String(override.product_id), override]))
  const overrideByBankId = new Map(bankOverrides.map(override => [String(override.bank_id), override]))
  const defaultVariantByVersionId = new Map()
  for (const variant of variants) {
    const versionId = String(variant.product_version_id)
    if (variant.is_default || !defaultVariantByVersionId.has(versionId)) {
      defaultVariantByVersionId.set(versionId, variant)
    }
  }

  return new Map(products.map((product) => {
    const version = versionById.get(String(product.current_published_version_id))
    const source = sourceById.get(String(version.source_document_id)) ?? null
    const variant = defaultVariantByVersionId.get(String(version.id)) ?? null
    const override = overrideByProductId.get(String(product.id)) ?? null
    const bank = singleRelation(product.mortgage_banks)
    const bankOverride = overrideByBankId.get(String(product.bank_id)) ?? null
    const baseVersion = {
      ...version,
      source,
      variant,
      offer_definition: variant?.pricing_config ?? null,
      calculation_readiness: variant?.calculation_readiness ?? 'partial',
    }
    const resolvedVersion = Number(version.calculator_schema_version ?? 1) >= 2
      ? baseVersion
      : { ...baseVersion, ...objectValue(override?.parameters) }

    return [mortgageProductSeedKey(String(bank.slug), String(product.slug)), {
      id: product.id,
      slug: product.slug,
      name: override?.custom_name ?? product.name,
      baseName: product.name,
      category: product.category,
      bank: {
        ...bank,
        name: bankOverride?.custom_name ?? bank.name,
        website_url: bankOverride?.custom_website_url ?? bank.website_url,
        baseName: bank.name,
        baseWebsiteUrl: bank.website_url,
        isEnabled: bankOverride?.is_enabled ?? true,
        logoUrl: bank.logo_url,
        logoBackground: bank.logo_background_color,
        override: bankOverride,
      },
      isEnabled: override?.is_enabled ?? true,
      version: resolvedVersion,
      baseVersion,
      override,
    }]
  }))
}

async function ensureCaseOffers({
  adminClient,
  organizationId,
  ownerUserId,
  seedNow,
  caseByKey,
}) {
  const offerSeeds = caseSeeds.flatMap(caseSeed => (caseSeed.offers ?? []).map(offer => ({
    ...offer,
    caseSeed,
    id: stableUuid(`${caseSeed.key}:offer:${offer.key}`),
  })))
  if (!offerSeeds.length) return []

  const productBySeedKey = await loadDemoMortgageProducts({
    adminClient,
    organizationId,
    productReferences: offerSeeds.map(seed => ({
      bankSlug: seed.bankSlug,
      productSlug: seed.productSlug,
    })),
  })
  const offerById = new Map()

  for (const seed of offerSeeds) {
    const crmCase = caseByKey.get(seed.caseSeed.key)
    const product = productBySeedKey.get(mortgageProductSeedKey(seed.bankSlug, seed.productSlug))
    const propertySeed = seed.caseSeed.properties.find(property => property.selected)
    const mortgageItem = seed.caseSeed.items.find(item => item.productCode === 'credit_mortgage')
    if (!crmCase || !product || !propertySeed || !mortgageItem?.amount) {
      throw new Error(`Demo CRM offer ${seed.key} requires a mortgage case, amount and selected property`)
    }

    const scenario = {
      propertyValue: Number(propertySeed.price),
      appraisalValue: propertySeed.appraisal == null ? null : Number(propertySeed.appraisal),
      loanAmount: Number(mortgageItem.amount),
      years: 25,
      installmentType: 'equal',
      referenceDelta: 0,
      monthlyOverpayment: 0,
      overpaymentStrategy: 'shorten_term',
      mortgageRegistrationMonth: 6,
      financeCommission: true,
      ...defaultMortgageSelections(product.version),
      selectionEvents: [],
    }
    const calculation = calculateMortgageCatalogVersion(product.version, scenario)
    const stress = calculateMortgageCatalogVersion(product.version, scenario, 2)
    if (!['complete', 'partial'].includes(calculation.status)) {
      throw new Error(`Demo CRM offer ${seed.productSlug} is not shortlistable (${calculation.status})`)
    }

    const created = assertResult(
      await adminClient
        .from('crm_case_offer_snapshots')
        .upsert({
          id: seed.id,
          organization_id: organizationId,
          case_id: crmCase.id,
          bank_id: product.bank.id,
          mortgage_product_id: product.id,
          mortgage_product_version_id: product.baseVersion.id,
          saved_by_user_id: ownerUserId,
          offer_type: 'mortgage',
          bank_name: product.bank.name,
          product_name: product.name,
          version_key: product.version.version_key,
          calculator_version: calculation.engineVersion,
          currency: 'PLN',
          loan_amount: scenario.loanAmount,
          first_installment: calculation.firstInstallment,
          first_monthly_outflow: calculation.firstTotalOutflow,
          cost_first_five_years: calculation.costFirstFiveYears,
          total_cost: calculation.totalCost,
          representative_apr_pct: product.version.representative_apr_pct,
          scenario_snapshot: scenario,
          catalog_snapshot: product,
          calculation_snapshot: calculationSnapshot(calculation),
          stress_snapshot: calculationSnapshot(stress),
          saved_at: isoOffset(seedNow, -seed.savedDaysAgo),
        }, { onConflict: 'id' })
        .select('id, case_id, bank_id, mortgage_product_id, mortgage_product_version_id, bank_name, product_name, currency, scenario_snapshot, catalog_snapshot, calculation_snapshot')
        .single(),
      `Seeding demo CRM offer ${product.bank.name} · ${product.name}`,
    )
    offerById.set(seed.id, created)
  }

  const seededOffers = offerSeeds.map(seed => offerById.get(seed.id)).filter(Boolean)
  if (seededOffers.length !== offerSeeds.length) {
    throw new Error(`Expected ${offerSeeds.length} demo CRM offers, received ${seededOffers.length}`)
  }
  return seededOffers
}

function requiredDemoNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new Error(`Demo mortgage application is missing ${label}`)
  }
  return Math.round((number + Number.EPSILON) * 100) / 100
}

function demoMortgageApplicationSnapshots({
  offer,
  property,
  baselineOfferId,
}) {
  const offerScenario = objectValue(offer.scenario_snapshot)
  const version = objectValue(objectValue(offer.catalog_snapshot).version)
  const calculation = calculateMortgageCatalogVersion(version, offerScenario)
  if (!['complete', 'partial'].includes(calculation.status)) {
    throw new Error(`Demo mortgage application cannot freeze a ${calculation.status} calculation`)
  }

  const purchasePrice = requiredDemoNumber(property.price_amount, 'purchase price')
  const appraisalValue = property.appraisal_value_amount == null
    ? null
    : requiredDemoNumber(property.appraisal_value_amount, 'appraisal value')
  const netLoanAmount = requiredDemoNumber(calculation.netLoanAmount, 'net loan amount')
  const grossLoanAmount = requiredDemoNumber(calculation.grossLoanAmount, 'gross loan amount')
  const financedCosts = requiredDemoNumber(calculation.financedCosts, 'financed costs')
  const contributionAmount = requiredDemoNumber(
    purchasePrice - netLoanAmount,
    'contribution amount',
  )
  const ltvDebtAmount = netLoanAmount
  const collateralValueAmount = purchasePrice
  const ltvPct = requiredDemoNumber(
    ltvDebtAmount / collateralValueAmount * 100,
    'LTV',
  )
  const years = requiredDemoNumber(offerScenario.years, 'term')
  const termMonths = years * 12
  const installmentType = offerScenario.installmentType === 'decreasing'
    ? 'decreasing'
    : 'equal'
  const selections = objectValue(offerScenario.selections)
  const selectionEvents = Array.isArray(offerScenario.selectionEvents)
    ? offerScenario.selectionEvents
    : []

  const scenarioSnapshot = {
    schemaVersion: 'openexpert.mortgage-application-scenario/1.0',
    sourceOfferId: offer.id,
    comparisonBaselineOfferId: baselineOfferId,
    property: {
      propertyId: property.id,
      purchasePrice,
      appraisalValue,
      propertyUpdatedAt: property.updated_at,
    },
    financing: {
      amountMode: 'target_net_proceeds',
      targetNetProceeds: netLoanAmount,
      grossLoanAmount,
      financedCosts,
      contributionAmount,
      termMonths,
      installmentType,
    },
    pricing: {
      referenceDelta: Number(offerScenario.referenceDelta ?? 0),
      monthlyOverpayment: Number(offerScenario.monthlyOverpayment ?? 0),
      overpaymentStrategy: offerScenario.overpaymentStrategy ?? 'shorten_term',
      mortgageRegistrationMonth: offerScenario.mortgageRegistrationMonth ?? null,
      financeCommission: offerScenario.financeCommission !== false,
      presetId: offerScenario.presetId ?? null,
      selections,
      selectionEvents,
    },
    propertyValue: purchasePrice,
    appraisalValue,
    loanAmount: netLoanAmount,
    grossLoanAmount,
    years,
    installmentType,
    referenceDelta: Number(offerScenario.referenceDelta ?? 0),
    monthlyOverpayment: Number(offerScenario.monthlyOverpayment ?? 0),
    overpaymentStrategy: offerScenario.overpaymentStrategy ?? 'shorten_term',
    mortgageRegistrationMonth: offerScenario.mortgageRegistrationMonth ?? null,
    financeCommission: offerScenario.financeCommission !== false,
    presetId: offerScenario.presetId ?? null,
    selections,
    selectionEvents,
  }

  return {
    scenarioSnapshot,
    calculationSnapshot: {
      schemaVersion: 'openexpert.mortgage-application-calculation/1.0',
      engineVersion: calculation.engineVersion,
      // The catalogue intentionally remains marked partial when source fields
      // need expert confirmation. This demo fixture freezes the fully numeric
      // scenario so the document-completion workflow can be exercised.
      status: 'complete',
      summary: {
        netLoanAmount,
        grossLoanAmount,
        financedCosts,
        ltvDebtBasis: 'net_loan',
        collateralValueBasis: 'purchase_price',
        ltvDebtAmount,
        collateralValueAmount,
        ltvPct,
        firstInstallment: requiredDemoNumber(calculation.firstInstallment, 'first installment'),
        firstMonthlyOutflow: requiredDemoNumber(calculation.firstTotalOutflow, 'first monthly outflow'),
        costFirstFiveYears: requiredDemoNumber(calculation.costFirstFiveYears, 'five-year cost'),
        totalCost: requiredDemoNumber(calculation.totalCost, 'total cost'),
      },
      raw: calculation.raw,
    },
  }
}

async function ensureCaseBankApplications({
  adminClient,
  organizationId,
  ownerUserId,
  caseByKey,
  propertyByKey,
  offers,
}) {
  const applicationSeeds = caseSeeds.flatMap(caseSeed => (caseSeed.offers ?? [])
    .filter(offer => offer.startApplication)
    .map(offer => ({
      ...offer,
      caseSeed,
      offerId: stableUuid(`${caseSeed.key}:offer:${offer.key}`),
    })))
  if (!applicationSeeds.length) return []

  const offerById = new Map(offers.map(offer => [String(offer.id), offer]))
  const selectedPropertyByCaseKey = new Map(caseSeeds.flatMap((caseSeed) => {
    const selectedProperty = caseSeed.properties.find(property => property.selected)
    if (!selectedProperty) return []
    const property = propertyByKey.get(`${caseSeed.key}:property:${selectedProperty.key}`)
    return property ? [[caseSeed.key, property]] : []
  }))
  const propertyIds = [...new Set(
    [...selectedPropertyByCaseKey.values()].map(property => String(property.id)),
  )]
  const propertyRows = assertResult(
    await adminClient
      .from('crm_properties')
      .select('id, price_amount, appraisal_value_amount, updated_at')
      .eq('organization_id', organizationId)
      .in('id', propertyIds),
    'Reading demo CRM properties for bank applications',
  ) ?? []
  const propertyById = new Map(propertyRows.map(property => [String(property.id), property]))

  const existingRows = assertResult(
    await adminClient
      .from('crm_case_bank_applications')
      .select('submission_id, case_id, offer_id, bank_id, property_id, slot, snapshot_status')
      .eq('organization_id', organizationId)
      .in('offer_id', applicationSeeds.map(seed => seed.offerId)),
    'Reading existing demo CRM bank applications',
  ) ?? []
  const applicationByOfferId = new Map(
    existingRows.map(application => [String(application.offer_id), application]),
  )
  const baselineOfferByCaseKey = new Map()
  for (const seed of applicationSeeds) {
    if (!baselineOfferByCaseKey.has(seed.caseSeed.key)) {
      baselineOfferByCaseKey.set(seed.caseSeed.key, seed.offerId)
    }
  }

  for (const seed of applicationSeeds) {
    const existing = applicationByOfferId.get(seed.offerId)
    if (existing) {
      if (existing.snapshot_status !== 'complete') {
        throw new Error(`Existing demo bank application ${existing.submission_id} is not complete`)
      }
      continue
    }

    const offer = offerById.get(seed.offerId)
    const seededProperty = selectedPropertyByCaseKey.get(seed.caseSeed.key)
    const property = seededProperty
      ? propertyById.get(String(seededProperty.id))
      : null
    const baselineOfferId = baselineOfferByCaseKey.get(seed.caseSeed.key)
    if (!offer || !property || !baselineOfferId || !caseByKey.get(seed.caseSeed.key)) {
      throw new Error(`Demo bank application ${seed.key} is missing its case, offer or property`)
    }

    const snapshots = demoMortgageApplicationSnapshots({
      offer,
      property,
      baselineOfferId,
    })
    const created = assertResult(
      await adminClient.rpc('create_crm_case_bank_application_snapshot', {
        target_organization_id: organizationId,
        target_case_id: offer.case_id,
        target_offer_id: offer.id,
        target_property_id: property.id,
        target_actor_user_id: ownerUserId,
        expected_property_updated_at: property.updated_at,
        target_scenario_snapshot: snapshots.scenarioSnapshot,
        target_calculation_snapshot: snapshots.calculationSnapshot,
      }),
      `Creating demo bank application for ${offer.bank_name}`,
    )
    const application = Array.isArray(created) ? created[0] : created
    if (!application?.submission_id || application.snapshot_status !== 'complete') {
      throw new Error(`Demo bank application for ${offer.bank_name} was not created as complete`)
    }
    applicationByOfferId.set(seed.offerId, application)
  }

  return applicationSeeds.map(seed => applicationByOfferId.get(seed.offerId)).filter(Boolean)
}

async function ensureCaseMultiformDraft({
  adminClient,
  organizationId,
  ownerUserId,
  caseByKey,
  clientByKey,
  offers,
  bankApplications,
}) {
  const targetCase = caseByKey.get('case-mortgage-warszewo')
  const jan = clientByKey.get('client-jan-kowalski')
  const anna = clientByKey.get('client-anna-kowalska')
  if (!targetCase || !jan || !anna) {
    throw new Error('Multiwniosek demo draft is missing its case or applicants')
  }

  const caseApplications = bankApplications
    .filter(application => String(application.case_id) === String(targetCase.id))
  const offerIds = caseApplications.map(application => String(application.offer_id)).sort()
  const offerById = new Map(offers.map(offer => [String(offer.id), offer]))
  const templateIds = [...new Set(offerIds.flatMap((offerId) => {
    const configured = offerById.get(offerId)?.catalog_snapshot?.version?.multiform_template_ids
    return Array.isArray(configured)
      ? configured.filter(templateId => typeof templateId === 'string' && templateId)
      : []
  }))].sort()
  const applicationIds = caseApplications
    .map(application => String(application.submission_id))
    .sort()

  if (applicationIds.length !== 2 || offerIds.length !== 2 || templateIds.length < 2) {
    throw new Error('Multiwniosek demo draft requires two applications, offers and templates')
  }

  const selectionFingerprint = createHash('sha256')
    .update(JSON.stringify({ applicationIds, offerIds, templateIds }))
    .digest('hex')
  const intakeAnswers = {
    applicants: {
      [String(jan.id)]: {
        incomeSource: 'employment',
        employmentType: 'indefinite',
        incomePaidToAccount: true,
        additionalIncome: false,
        liabilities: null,
      },
      [String(anna.id)]: {
        incomeSource: 'employment',
        employmentType: 'indefinite',
        incomePaidToAccount: true,
        additionalIncome: null,
        liabilities: null,
      },
    },
    case: {
      loanPurpose: 'purchase_secondary',
      preliminaryAgreement: null,
      landRegister: null,
      appraisalAvailable: true,
      trancheDisbursement: false,
    },
  }

  return assertResult(
    await adminClient
      .from('crm_case_multiform_drafts')
      .upsert({
        organization_id: organizationId,
        case_id: targetCase.id,
        selection_fingerprint: selectionFingerprint,
        revision: 1,
        active_step: 2,
        intake_answers: intakeAnswers,
        form_values: {},
        collection_counts: {},
        selected_document_ids: [],
        updated_by_user_id: ownerUserId,
      }, { onConflict: 'organization_id,case_id' })
      .select('organization_id, case_id, selection_fingerprint, revision, active_step')
      .single(),
    'Seeding the Multiwniosek workflow draft',
  )
}

async function ensureTasks({
  adminClient,
  organizationId,
  ownerUserId,
  seedNow,
  delegateByKey,
  clientByKey,
  caseByKey,
  itemByKey,
}) {
  const caseIds = [...caseByKey.values()].map(crmCase => String(crmCase.id))
  const existingRows = assertResult(
    await adminClient
      .from('crm_tasks')
      .select('id, delegator_user_id, assignee_user_id, client_id, case_id, case_item_id, title, description, status_code, delegation_status, priority, due_at, completed_at, data_access_scope, delegated_at, responded_at, accepted_at, rejected_at, rejection_reason, cancelled_at, idempotency_key, idempotency_fingerprint, metadata')
      .eq('organization_id', organizationId)
      .in('case_id', caseIds),
    'Reading existing demo CRM tasks',
  ) ?? []
  const taskByKey = new Map(
    existingRows
      .map(row => [demoKey(row), row])
      .filter(([key]) => key),
  )

  for (const caseSeed of caseSeeds) {
    const crmCase = caseByKey.get(caseSeed.key)
    const primaryClient = clientByKey.get(caseSeed.clientKeys[0])
    for (const taskSeed of caseSeed.tasks) {
      const key = `${caseSeed.key}:task:${taskSeed.key}`
      let existing = taskByKey.get(key)
      const caseItem = taskSeed.itemKey
        ? itemByKey.get(`${caseSeed.key}:item:${taskSeed.itemKey}`)
        : null
      const metadata = metadataFor(key, existing?.metadata)
      const delegate = taskSeed.delegateKey
        ? delegateByKey?.get(taskSeed.delegateKey)
        : null
      if (taskSeed.delegateKey && !delegate) {
        throw new Error(
          `Demo CRM task ${taskSeed.title} references missing delegate ${taskSeed.delegateKey}`,
        )
      }
      const dueAt = isoOffset(seedNow, taskSeed.dueDays)
      const description = taskSeed.description ?? null
      const dataAccessScope = delegate
        ? [...taskSeed.dataAccessScope].sort()
        : ['case_summary']
      const delegationStatus = delegate
        ? taskSeed.delegationStatus
        : 'not_delegated'
      const delegatedAt = delegate
        ? existing?.delegated_at
          ?? isoOffset(seedNow, -taskSeed.delegatedDaysAgo)
        : null
      const respondedAt = delegate && delegationStatus !== 'pending'
        ? existing?.responded_at
          ?? isoOffset(seedNow, -taskSeed.respondedDaysAgo)
        : null
      const idempotencyKey = delegate
        ? stableUuid(`${key}:delegation-request`)
        : null
      const idempotencyFingerprint = delegate
        ? existing?.idempotency_fingerprint
          ?? taskDelegationFingerprint({
            organizationId,
            caseId: String(crmCase.id),
            caseItemId: caseItem?.id ?? null,
            delegatorUserId: ownerUserId,
            assigneeUserId: delegate.id,
            title: taskSeed.title,
            description,
            dueAt,
            priority: taskSeed.priority,
            dataAccessScope,
          })
        : null
      const values = {
        organization_id: organizationId,
        delegator_user_id: delegate ? ownerUserId : null,
        assignee_user_id: delegate?.id ?? ownerUserId,
        client_id: primaryClient.id,
        case_id: crmCase.id,
        case_item_id: caseItem?.id ?? null,
        title: taskSeed.title,
        description,
        status_code: taskSeed.statusCode,
        delegation_status: delegationStatus,
        priority: taskSeed.priority,
        due_at: dueAt,
        completed_at: taskSeed.completedDays == null ? null : isoOffset(seedNow, taskSeed.completedDays),
        data_access_scope: dataAccessScope,
        delegated_at: delegatedAt,
        responded_at: respondedAt,
        accepted_at: delegationStatus === 'accepted' ? respondedAt : null,
        rejected_at: delegationStatus === 'rejected' ? respondedAt : null,
        rejection_reason: delegationStatus === 'rejected'
          ? taskSeed.rejectionReason
          : null,
        cancelled_at: delegationStatus === 'cancelled' ? respondedAt : null,
        idempotency_key: idempotencyKey,
        idempotency_fingerprint: idempotencyFingerprint,
        metadata,
      }

      if (existing) {
        if (
          existing.delegation_status === 'not_delegated'
          && delegate
          && delegationStatus !== 'pending'
        ) {
          existing = assertResult(
            await adminClient
              .from('crm_tasks')
              .update({
                ...values,
                status_code: 'open',
                delegation_status: 'pending',
                completed_at: null,
                responded_at: null,
                accepted_at: null,
                rejected_at: null,
                rejection_reason: null,
                cancelled_at: null,
              })
              .eq('organization_id', organizationId)
              .eq('id', existing.id)
              .select('id, delegator_user_id, assignee_user_id, client_id, case_id, title, status_code, delegation_status, priority, due_at, completed_at, data_access_scope, delegated_at, responded_at, accepted_at, rejected_at, rejection_reason, cancelled_at, idempotency_key, idempotency_fingerprint, metadata')
              .single(),
            `Preparing delegated demo CRM task ${taskSeed.title}`,
          )
        }
        const updated = assertResult(
          await adminClient
            .from('crm_tasks')
            .update(values)
            .eq('organization_id', organizationId)
            .eq('id', existing.id)
            .select('id, delegator_user_id, assignee_user_id, client_id, case_id, title, status_code, delegation_status, priority, due_at, completed_at, data_access_scope, delegated_at, responded_at, accepted_at, rejected_at, rejection_reason, cancelled_at, idempotency_key, idempotency_fingerprint, metadata')
            .single(),
          `Updating demo CRM task ${taskSeed.title}`,
        )
        taskByKey.set(key, updated)
      }
      else {
        const inserted = assertResult(
          await adminClient
            .from('crm_tasks')
            .insert({ id: stableUuid(key), ...values })
            .select('id, delegator_user_id, assignee_user_id, client_id, case_id, title, status_code, delegation_status, priority, due_at, completed_at, data_access_scope, delegated_at, responded_at, accepted_at, rejected_at, rejection_reason, cancelled_at, idempotency_key, idempotency_fingerprint, metadata')
            .single(),
          `Creating demo CRM task ${taskSeed.title}`,
        )
        taskByKey.set(key, inserted)
      }
    }
  }

  return taskByKey
}

async function ensureDocuments({
  adminClient,
  organizationId,
  seedNow,
  clientByKey,
  caseByKey,
  itemByKey,
}) {
  const caseIds = [...caseByKey.values()].map(crmCase => String(crmCase.id))
  const existingRows = assertResult(
    await adminClient
      .from('crm_documents')
      .select('id, client_id, case_id, case_item_id, document_type, name, status_code, storage_bucket, storage_path, received_at, verified_at, metadata')
      .eq('organization_id', organizationId)
      .in('case_id', caseIds),
    'Reading existing demo CRM documents',
  ) ?? []
  const documentByKey = new Map(
    existingRows
      .map(row => [demoKey(row), row])
      .filter(([key]) => key),
  )

  for (const caseSeed of caseSeeds) {
    const crmCase = caseByKey.get(caseSeed.key)
    const primaryClient = clientByKey.get(caseSeed.clientKeys[0])
    for (const documentSeed of caseSeed.documents) {
      const documentClient = documentSeed.clientKey
        ? clientByKey.get(documentSeed.clientKey)
        : primaryClient
      if (!documentClient) {
        throw new Error(`Demo CRM document ${documentSeed.key} references a missing client`)
      }
      const key = `${caseSeed.key}:document:${documentSeed.key}`
      const existing = documentByKey.get(key)
      const caseItem = documentSeed.itemKey
        ? itemByKey.get(`${caseSeed.key}:item:${documentSeed.itemKey}`)
        : null
      const metadata = metadataFor(key, {
        ...objectValue(existing?.metadata),
        fixture_without_storage: true,
      })
      const values = {
        organization_id: organizationId,
        client_id: documentClient.id,
        case_id: crmCase.id,
        case_item_id: caseItem?.id ?? null,
        submission_id: null,
        document_type: documentSeed.type,
        name: documentSeed.name,
        status_code: documentSeed.statusCode,
        storage_bucket: null,
        storage_path: null,
        uploaded_by_user_id: null,
        mime_type: null,
        size_bytes: null,
        sha256: null,
        received_at: documentSeed.receivedDays == null ? null : isoOffset(seedNow, documentSeed.receivedDays),
        verified_at: documentSeed.verifiedDays == null ? null : isoOffset(seedNow, documentSeed.verifiedDays),
        metadata,
      }

      if (existing) {
        const updated = assertResult(
          await adminClient
            .from('crm_documents')
            .update(values)
            .eq('organization_id', organizationId)
            .eq('id', existing.id)
            .select('id, case_id, case_item_id, document_type, name, status_code, received_at, verified_at, metadata')
            .single(),
          `Updating demo CRM document ${documentSeed.name}`,
        )
        documentByKey.set(key, updated)
      }
      else {
        const inserted = assertResult(
          await adminClient
            .from('crm_documents')
            .insert({ id: stableUuid(key), ...values })
            .select('id, case_id, case_item_id, document_type, name, status_code, received_at, verified_at, metadata')
            .single(),
          `Creating demo CRM document ${documentSeed.name}`,
        )
        documentByKey.set(key, inserted)
      }
    }
  }

  return documentByKey
}

async function ensureActivities({
  adminClient,
  organizationId,
  ownerUserId,
  seedNow,
  clientByKey,
  caseByKey,
  itemByKey,
}) {
  const caseIds = [...caseByKey.values()].map(crmCase => String(crmCase.id))
  const existingRows = assertResult(
    await adminClient
      .from('crm_activities')
      .select('id, client_id, case_id, case_item_id, activity_type, title, body, payload, created_at')
      .eq('organization_id', organizationId)
      .in('case_id', caseIds),
    'Reading existing demo CRM activity history',
  ) ?? []
  const activityByKey = new Map(
    existingRows
      .map(row => [demoKey(row, 'payload'), row])
      .filter(([key]) => key),
  )

  for (const caseSeed of caseSeeds) {
    const crmCase = caseByKey.get(caseSeed.key)
    const primaryClient = clientByKey.get(caseSeed.clientKeys[0])
    for (const activitySeed of caseSeed.history) {
      const key = `${caseSeed.key}:activity:${activitySeed.key}`
      const existing = activityByKey.get(key)
      const caseItem = activitySeed.itemKey
        ? itemByKey.get(`${caseSeed.key}:item:${activitySeed.itemKey}`)
        : null
      const payload = metadataFor(key, {
        ...objectValue(existing?.payload),
        ...objectValue(activitySeed.payload),
      })
      const values = {
        organization_id: organizationId,
        actor_user_id: ownerUserId,
        client_id: primaryClient.id,
        case_id: crmCase.id,
        case_item_id: caseItem?.id ?? null,
        submission_id: null,
        activity_type: activitySeed.type,
        title: activitySeed.title,
        body: activitySeed.body ?? null,
        payload,
      }

      if (existing) {
        const updated = assertResult(
          await adminClient
            .from('crm_activities')
            .update(values)
            .eq('organization_id', organizationId)
            .eq('id', existing.id)
            .select('id, case_id, activity_type, title, body, payload, created_at')
            .single(),
          `Updating demo CRM activity ${activitySeed.title}`,
        )
        activityByKey.set(key, updated)
      }
      else {
        const inserted = assertResult(
          await adminClient
            .from('crm_activities')
            .insert({
              id: stableUuid(key),
              ...values,
              created_at: isoOffset(seedNow, -activitySeed.daysAgo),
            })
            .select('id, case_id, activity_type, title, body, payload, created_at')
            .single(),
          `Creating demo CRM activity ${activitySeed.title}`,
        )
        activityByKey.set(key, inserted)
      }
    }
  }

  return activityByKey
}

export const forumCategorySeeds = [
  {
    slug: 'kredyty-hipoteczne',
    name: 'Kredyty hipoteczne',
    description: 'Analiza zdolności, dokumenty bankowe i scenariusze finansowania.',
    icon: 'i-lucide-landmark',
    color: 'blue',
  },
  {
    slug: 'nieruchomosci',
    name: 'Nieruchomości',
    description: 'Zakup, sprzedaż, wyceny i bezpieczeństwo transakcji.',
    icon: 'i-lucide-house',
    color: 'emerald',
  },
  {
    slug: 'ubezpieczenia',
    name: 'Ubezpieczenia',
    description: 'Ochrona klienta, zakres polis i obsługa odnowień.',
    icon: 'i-lucide-shield-check',
    color: 'violet',
  },
  {
    slug: 'obsluga-klienta',
    name: 'Obsługa klienta',
    description: 'Komunikacja, standardy odpowiedzi i trudne sytuacje.',
    icon: 'i-lucide-messages-square',
    color: 'amber',
  },
  {
    slug: 'procesy-i-narzedzia',
    name: 'Procesy i narzędzia',
    description: 'Współpraca zespołów, automatyzacje i dobre praktyki operacyjne.',
    icon: 'i-lucide-workflow',
    color: 'slate',
  },
]

export const forumThreadSeeds = [
  {
    key: 'forum-income-documentation',
    categorySlug: 'kredyty-hipoteczne',
    authorKey: 'anna-nowak',
    type: 'question',
    title: 'Jak dokumentować dochód z kontraktu B2B przy hipotece?',
    body: 'Klient prowadzi działalność od 18 miesięcy i rozlicza się liniowo. Jakie dokumenty warto zebrać przed wysłaniem zapytań do banków, żeby ograniczyć liczbę uzupełnień?',
    languageCode: 'pl',
    status: 'resolved',
    daysAgo: 16,
    replies: [
      {
        key: 'expert-checklist',
        authorKey: 'piotr-zielinski',
        body: 'Zaczynam od KPiR lub ewidencji przychodów za bieżący i poprzedni rok, PIT-u, zaświadczeń z ZUS i US oraz wyciągów z rachunku firmowego. Sprawdzam też sezonowość i zobowiązania leasingowe.',
        verified: true,
        accepted: true,
        daysAfter: 1,
      },
      {
        key: 'admin-process',
        authorKey: 'admin',
        body: 'Administracyjnie rekomendujemy dołączyć wspólną checklistę „B2B — hipoteka” i oznaczyć datę ważności każdego dokumentu. Dzięki temu zespół operacyjny nie prosi klienta drugi raz o to samo.',
        official: true,
        daysAfter: 2,
      },
      {
        key: 'expert-bank-differences',
        authorKey: 'marta-wojcik',
        body: 'Warto przed analizą zapytać o kody PKD i udział jednego kontrahenta w przychodzie. To często zmienia listę banków, nawet gdy sam poziom dochodu wygląda dobrze.',
        verified: true,
        daysAfter: 3,
      },
    ],
  },
  {
    key: 'forum-gifted-down-payment',
    categorySlug: 'kredyty-hipoteczne',
    authorKey: 'marta-wojcik',
    type: 'question',
    title: 'Darowizna od rodziny jako wkład własny — kiedy ją udokumentować?',
    body: 'Rodzice klientki chcą przekazać środki na wkład własny. Czy lepiej wykonać darowiznę przed decyzją kredytową, czy dopiero przed aktem notarialnym?',
    languageCode: 'pl',
    status: 'answered',
    daysAgo: 10,
    replies: [
      {
        key: 'admin-compliance',
        authorKey: 'admin',
        body: 'Oficjalnie: środki i ich pochodzenie muszą być udokumentowane zgodnie z wymaganiem konkretnego banku. Zachowujemy potwierdzenie przelewu, umowę darowizny i potwierdzenie zgłoszenia podatkowego, jeśli jest wymagane.',
        official: true,
        daysAfter: 1,
      },
      {
        key: 'expert-timing',
        authorKey: 'anna-nowak',
        body: 'Najpierw sprawdziłabym instrukcję banku. Część instytucji chce już widzieć środki na rachunku przy analizie, inne akceptują udokumentowany przelew przed uruchomieniem kredytu.',
        verified: true,
        daysAfter: 2,
      },
    ],
  },
  {
    key: 'forum-client-handoff',
    categorySlug: 'procesy-i-narzedzia',
    authorKey: 'admin',
    type: 'discussion',
    title: 'Standard przekazania klienta między ekspertem a administracją',
    body: 'Ustalmy minimalny zestaw informacji przy przekazaniu sprawy, tak aby administracja mogła działać bez odtwarzania całej historii z wiadomości.',
    languageCode: 'pl',
    status: 'open',
    daysAgo: 8,
    replies: [
      {
        key: 'expert-handoff-fields',
        authorKey: 'anna-nowak',
        body: 'Potrzebuję w jednym miejscu: celu klienta, wybranego scenariusza, terminów krytycznych, brakujących dokumentów i ustalonego kanału kontaktu. Przydatna jest też krótka notatka o ryzykach.',
        verified: true,
        daysAfter: 1,
      },
      {
        key: 'admin-handoff-template',
        authorKey: 'admin',
        body: 'Dodamy oficjalny szablon przekazania z właścicielem kolejnego kroku. Każde pole będzie krótkie, ale obowiązkowe przed zmianą osoby prowadzącej.',
        official: true,
        daysAfter: 2,
      },
    ],
  },
  {
    key: 'forum-bridge-insurance',
    categorySlug: 'ubezpieczenia',
    authorKey: 'piotr-zielinski',
    type: 'question',
    title: 'Jak wyjaśnić klientowi koszt ubezpieczenia pomostowego?',
    body: 'Klient porównuje oferty tylko po racie startowej i uważa podwyższenie marży do wpisu hipoteki za ukrytą opłatę. Jak tłumaczycie ten etap jasno i bez straszenia?',
    languageCode: 'pl',
    status: 'resolved',
    daysAgo: 6,
    replies: [
      {
        key: 'expert-explanation',
        authorKey: 'marta-wojcik',
        body: 'Pokazuję dwa okresy osobno: ratę do prawomocnego wpisu hipoteki i ratę docelową. Dodaję szacowany koszt dla trzech wariantów czasu oczekiwania, zamiast obiecywać konkretną datę sądu.',
        verified: true,
        accepted: true,
        daysAfter: 1,
      },
      {
        key: 'admin-materials',
        authorKey: 'admin',
        body: 'W materiałach dla klienta używamy określenia „koszt okresu przejściowego” i zawsze wskazujemy warunek jego zakończenia. Nie przedstawiamy szacunku jako gwarantowanego terminu.',
        official: true,
        daysAfter: 2,
      },
    ],
  },
  {
    key: 'forum-property-viewing-notes',
    categorySlug: 'nieruchomosci',
    authorKey: 'anna-nowak',
    type: 'discussion',
    title: 'Notatki po oględzinach nieruchomości — wspólny standard',
    body: 'Podzielcie się elementami, które zapisujecie po oględzinach. Chcemy ujednolicić notatkę przekazywaną ekspertowi finansowemu i klientowi.',
    languageCode: 'pl',
    status: 'closed',
    daysAgo: 4,
    replies: [
      {
        key: 'expert-property-checklist',
        authorKey: 'piotr-zielinski',
        body: 'Poza stanem technicznym zapisuję status prawny, planowane nakłady, elementy wyposażenia w cenie i wszystkie deklaracje sprzedającego, które wymagają potwierdzenia dokumentem.',
        verified: true,
        daysAfter: 1,
      },
    ],
  },
  {
    key: 'forum-difficult-client-response',
    categorySlug: 'obsluga-klienta',
    authorKey: 'marta-wojcik',
    type: 'question',
    title: 'Jak odpowiedzieć klientowi, gdy analiza banku się przedłuża?',
    body: 'Klient oczekuje codziennej aktualizacji, ale bank od kilku dni nie przekazał nowych informacji. Szukam krótkiej odpowiedzi, która jest konkretna i nie składa obietnic bez pokrycia.',
    languageCode: 'pl',
    status: 'open',
    daysAgo: 1,
    replies: [],
  },
]

async function ensureForumSeed({
  adminClient,
  organizationId,
  ownerUserId,
  delegateByKey,
  seedNow,
}) {
  const authorByKey = new Map([
    ['admin', { id: ownerUserId, role: 'admin' }],
    ...[...delegateByKey.entries()].map(([key, author]) => [
      key,
      { id: String(author.id), role: 'expert' },
    ]),
  ])

  for (const threadSeed of forumThreadSeeds) {
    if (!authorByKey.has(threadSeed.authorKey)) {
      throw new Error(`Forum seed is missing author ${threadSeed.authorKey}`)
    }
    for (const replySeed of threadSeed.replies) {
      if (!authorByKey.has(replySeed.authorKey)) {
        throw new Error(`Forum seed is missing reply author ${replySeed.authorKey}`)
      }
    }
  }

  const existingCategories = assertResult(
    await adminClient
      .from('forum_categories')
      .select('id, slug')
      .eq('organization_id', organizationId),
    'Reading forum categories',
  ) ?? []
  const categoryBySlug = new Map(existingCategories.map(category => [category.slug, category]))

  for (const [index, categorySeed] of forumCategorySeeds.entries()) {
    const existing = categoryBySlug.get(categorySeed.slug)
    const values = {
      organization_id: organizationId,
      slug: categorySeed.slug,
      name: categorySeed.name,
      description: categorySeed.description,
      icon: categorySeed.icon,
      color: categorySeed.color,
      sort_order: (index + 1) * 10,
      is_active: true,
      created_by_user_id: ownerUserId,
    }
    const category = existing
      ? assertResult(
          await adminClient
            .from('forum_categories')
            .update(values)
            .eq('organization_id', organizationId)
            .eq('id', existing.id)
            .select('id, slug')
            .single(),
          `Updating forum category ${categorySeed.name}`,
        )
      : assertResult(
          await adminClient
            .from('forum_categories')
            .insert({
              id: stableUuid(`forum:category:${categorySeed.slug}`),
              ...values,
            })
            .select('id, slug')
            .single(),
          `Creating forum category ${categorySeed.name}`,
        )
    categoryBySlug.set(categorySeed.slug, category)
  }

  const existingThreads = assertResult(
    await adminClient
      .from('forum_threads')
      .select('id, metadata')
      .eq('organization_id', organizationId),
    'Reading seeded forum threads',
  ) ?? []
  const threadByKey = new Map(existingThreads
    .filter(thread => objectValue(thread.metadata).demo_seed_namespace === demoNamespace)
    .map(thread => [demoKey(thread), thread]))

  let replyCount = 0
  for (const threadSeed of forumThreadSeeds) {
    const category = categoryBySlug.get(threadSeed.categorySlug)
    const author = authorByKey.get(threadSeed.authorKey)
    const existingThread = threadByKey.get(threadSeed.key)
    if (!category || !author) throw new Error(`Forum thread ${threadSeed.key} has invalid references`)

    const threadValues = {
      organization_id: organizationId,
      category_id: category.id,
      author_user_id: author.id,
      thread_type: threadSeed.type,
      title: threadSeed.title,
      language_code: threadSeed.languageCode,
      visibility: 'organization',
      metadata: metadataFor(threadSeed.key, { demo_seed_kind: 'forum_thread' }),
      is_hidden: false,
      hidden_at: null,
      hidden_by_user_id: null,
      hidden_reason: null,
    }
    const thread = existingThread
      ? assertResult(
          await adminClient
            .from('forum_threads')
            .update(threadValues)
            .eq('organization_id', organizationId)
            .eq('id', existingThread.id)
            .select('id')
            .single(),
          `Updating forum thread ${threadSeed.title}`,
        )
      : assertResult(
          await adminClient
            .from('forum_threads')
            .insert({
              id: stableUuid(`forum:thread:${threadSeed.key}`),
              ...threadValues,
              status: 'open',
              created_at: isoOffset(seedNow, -threadSeed.daysAgo),
              last_activity_at: isoOffset(seedNow, -threadSeed.daysAgo),
            })
            .select('id')
            .single(),
          `Creating forum thread ${threadSeed.title}`,
        )

    const postSeeds = [
      {
        key: `${threadSeed.key}:question`,
        author,
        kind: 'question',
        body: threadSeed.body,
        verified: false,
        official: false,
        accepted: false,
        createdAt: isoOffset(seedNow, -threadSeed.daysAgo),
      },
      ...threadSeed.replies.map((replySeed) => {
        const replyAuthor = authorByKey.get(replySeed.authorKey)
        return {
          key: `${threadSeed.key}:reply:${replySeed.key}`,
          author: replyAuthor,
          kind: 'reply',
          body: replySeed.body,
          verified: replySeed.verified === true,
          official: replySeed.official === true,
          accepted: replySeed.accepted === true,
          createdAt: isoOffset(seedNow, -threadSeed.daysAgo + replySeed.daysAfter),
        }
      }),
    ]

    const postIds = postSeeds.map(postSeed => stableUuid(`forum:post:${postSeed.key}`))
    const existingPosts = assertResult(
      await adminClient
        .from('forum_posts')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('thread_id', thread.id)
        .in('id', postIds),
      `Reading posts for forum thread ${threadSeed.title}`,
    ) ?? []
    const existingPostIds = new Set(existingPosts.map(post => String(post.id)))

    assertResult(
      await adminClient
        .from('forum_posts')
        .update({ is_accepted_answer: false })
        .eq('organization_id', organizationId)
        .eq('thread_id', thread.id)
        .eq('is_accepted_answer', true),
      `Resetting accepted answer for forum thread ${threadSeed.title}`,
    )

    for (const postSeed of postSeeds) {
      const postId = stableUuid(`forum:post:${postSeed.key}`)
      const values = {
        organization_id: organizationId,
        thread_id: thread.id,
        author_user_id: postSeed.author.id,
        kind: postSeed.kind,
        content: postSeed.body,
        is_verified_expert_answer: postSeed.verified,
        is_official_admin_answer: postSeed.official,
        is_accepted_answer: postSeed.accepted,
        metadata: metadataFor(postSeed.key, { demo_seed_kind: 'forum_post' }),
        is_hidden: false,
        hidden_at: null,
        hidden_by_user_id: null,
        hidden_reason: null,
      }
      if (existingPostIds.has(postId)) {
        assertResult(
          await adminClient
            .from('forum_posts')
            .update(values)
            .eq('organization_id', organizationId)
            .eq('id', postId),
          `Updating seeded forum post ${postSeed.key}`,
        )
      }
      else {
        assertResult(
          await adminClient
            .from('forum_posts')
            .insert({ id: postId, ...values, created_at: postSeed.createdAt }),
          `Creating seeded forum post ${postSeed.key}`,
        )
      }
      if (postSeed.kind === 'reply') replyCount += 1
    }

    assertResult(
      await adminClient
        .from('forum_threads')
        .update({ status: threadSeed.status })
        .eq('organization_id', organizationId)
        .eq('id', thread.id),
      `Finalizing forum thread ${threadSeed.title}`,
    )
    threadByKey.set(threadSeed.key, thread)
  }

  return {
    categories: forumCategorySeeds.length,
    threads: forumThreadSeeds.length,
    replies: replyCount,
  }
}

export async function seedDemoCrm({
  adminClient,
  userClient,
  profile,
  delegateByKey = new Map(),
  seedNow,
}) {
  if (!adminClient || !userClient) throw new Error('seedDemoCrm requires adminClient and userClient')
  const organizationId = String(profile?.organization_id ?? '')
  const ownerUserId = String(profile?.id ?? '')
  if (!organizationId || !ownerUserId) {
    throw new Error('seedDemoCrm requires a profile with id and organization_id')
  }
  const referenceNow = asDate(seedNow)
  assertResult(
    await adminClient
      .from('expert_brand_profiles')
      .upsert({
        organization_id: organizationId,
        user_id: ownerUserId,
        expert_name: String(profile.full_name ?? 'Anna Nowak'),
        professional_title: 'Ekspertka kredytowa',
        tagline: 'Spokojnie przeprowadzę Cię przez finansowanie domu.',
        contact_email: String(profile.email ?? 'kontakt@dobryplan.example.local'),
        contact_phone: '+48 501 234 567',
        website_url: 'https://dobryplan.example.local',
        location: 'Szczecin i online',
        bio: 'Pomagam porównać realne scenariusze finansowania, uporządkować dokumenty i bezpiecznie przejść przez cały proces kredytowy.',
        specializations: [
          'Kredyty hipoteczne',
          'Pierwsze mieszkanie',
          'Refinansowanie',
        ],
        visual_style: 'editorial',
      }, { onConflict: 'organization_id,user_id' })
      .select('organization_id, user_id')
      .single(),
    'Seeding the expert Design profile',
  )

  const demoForumAdministrator = delegateByKey.get('anna-nowak')
  if (demoForumAdministrator?.id) {
    assertResult(
      await adminClient
        .from('organization_user_admin_roles')
        .upsert({
          organization_id: organizationId,
          user_id: String(demoForumAdministrator.id),
          role_key: 'forum_admin',
          assigned_by_user_id: ownerUserId,
          reason: 'Demo: moderacja forum ekspertów i zarządzanie kategoriami.',
        }, { onConflict: 'organization_id,user_id,role_key' }),
      'Assigning the demo forum administrator role',
    )
  }

  const consentCatalogue = await loadActiveConsentCatalogue(adminClient, organizationId)
  const clientResult = await ensureClientRecords({
    adminClient,
    userClient,
    organizationId,
    ownerUserId,
    seedNow: referenceNow,
    consentCatalogue,
  })
  const anonymizationRequest = await ensureAnonymizationRequests({
    adminClient,
    organizationId,
    ownerUserId,
    seedNow: referenceNow,
    clientByKey: clientResult.clientByKey,
    personByKey: clientResult.personByKey,
  })
  const caseByKey = await ensureCases({
    adminClient,
    userClient,
    organizationId,
    ownerUserId,
    seedNow: referenceNow,
    clientByKey: clientResult.clientByKey,
  })
  const productTypes = await loadProductTypes(adminClient, organizationId)
  const itemByKey = await ensureCaseItems({
    adminClient,
    organizationId,
    ownerUserId,
    seedNow: referenceNow,
    caseByKey,
    productTypes,
  })
  const settlementByItemId = await ensureSettlements({
    adminClient,
    organizationId,
    seedNow: referenceNow,
    itemByKey,
  })
  const propertyByKey = await ensureProperties({
    adminClient,
    organizationId,
    ownerUserId,
    caseByKey,
    itemByKey,
  })
  const offers = await ensureCaseOffers({
    adminClient,
    organizationId,
    ownerUserId,
    seedNow: referenceNow,
    caseByKey,
  })
  const bankApplications = await ensureCaseBankApplications({
    adminClient,
    organizationId,
    ownerUserId,
    caseByKey,
    propertyByKey,
    offers,
  })
  const taskByKey = await ensureTasks({
    adminClient,
    organizationId,
    ownerUserId,
    seedNow: referenceNow,
    delegateByKey,
    clientByKey: clientResult.clientByKey,
    caseByKey,
    itemByKey,
  })
  const documentByKey = await ensureDocuments({
    adminClient,
    organizationId,
    seedNow: referenceNow,
    clientByKey: clientResult.clientByKey,
    caseByKey,
    itemByKey,
  })
  const multiformDraft = await ensureCaseMultiformDraft({
    adminClient,
    organizationId,
    ownerUserId,
    caseByKey,
    clientByKey: clientResult.clientByKey,
    offers,
    bankApplications,
  })
  const activityByKey = await ensureActivities({
    adminClient,
    organizationId,
    ownerUserId,
    seedNow: referenceNow,
    clientByKey: clientResult.clientByKey,
    caseByKey,
    itemByKey,
  })
  const forum = await ensureForumSeed({
    adminClient,
    organizationId,
    ownerUserId,
    delegateByKey,
    seedNow: referenceNow,
  })

  const consentCountResult = await adminClient
    .from('crm_client_consent_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .in('client_id', clientResult.clients.map(client => client.id))
  if (consentCountResult.error) {
    throw operationError('Counting demo CRM consent events', consentCountResult.error)
  }

  return {
    clients: clientResult.clients,
    anonymizationRequests: [{
      ...anonymizationRequest,
      id: String(anonymizationRequest.id),
      client_id: String(anonymizationRequest.client_id),
    }],
    tasks: [...taskByKey.entries()].map(([seedKey, task]) => ({
      ...task,
      id: String(task.id),
      seed_key: seedKey,
    })),
    forum,
    cases: caseSeeds.map((seed) => {
      const crmCase = caseByKey.get(seed.key)
      return {
        ...crmCase,
        id: String(crmCase.id),
        title: seed.title,
        status_code: seed.statusCode,
        client_ids: seed.clientKeys.map(key => String(clientResult.clientByKey.get(key).id)),
      }
    }),
    counts: {
      clients: clientResult.clients.length,
      people: clientResult.peopleCount,
      consentEvents: consentCountResult.count ?? 0,
      anonymizationRequests: 1,
      anonymizationRequestEvents: anonymizationRequest.event_count,
      cases: caseByKey.size,
      caseItems: itemByKey.size,
      settlements: settlementByItemId.size,
      properties: propertyByKey.size,
      offers: offers.length,
      bankApplications: bankApplications.length,
      multiformDrafts: multiformDraft ? 1 : 0,
      tasks: taskByKey.size,
      documents: documentByKey.size,
      activities: activityByKey.size,
      forumCategories: forum.categories,
      forumThreads: forum.threads,
      forumReplies: forum.replies,
    },
  }
}
