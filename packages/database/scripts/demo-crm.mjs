import { createHash } from 'node:crypto'

const dayMs = 24 * 60 * 60 * 1000
const demoNamespace = 'openexpert-local-demo'

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
      { key: 'jan-id', itemKey: 'mortgage', type: 'identity_document', name: 'Dowód osobisty — Jan Kowalski', statusCode: 'verified', receivedDays: -18, verifiedDays: -17 },
      { key: 'anna-id', itemKey: 'mortgage', type: 'identity_document', name: 'Dowód osobisty — Anna Kowalska', statusCode: 'received', receivedDays: -16 },
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

function isoOffset(seedNow, days) {
  return new Date(seedNow.getTime() + days * dayMs).toISOString()
}

function dateOffset(seedNow, days) {
  return isoOffset(seedNow, days).slice(0, 10)
}

function stableUuid(key) {
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

function metadataFor(key, extra = {}) {
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
        client_id: primaryClient.id,
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
  const activityByKey = await ensureActivities({
    adminClient,
    organizationId,
    ownerUserId,
    seedNow: referenceNow,
    clientByKey: clientResult.clientByKey,
    caseByKey,
    itemByKey,
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
      tasks: taskByKey.size,
      documents: documentByKey.size,
      activities: activityByKey.size,
    },
  }
}
