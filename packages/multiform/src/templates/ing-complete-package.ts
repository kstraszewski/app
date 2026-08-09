/**
 * ING mortgage package audit as observed on 2026-08-09.
 *
 * This file is intentionally not registered as an active PDF template. ING does
 * not publish a current mortgage-application PDF. The application is completed
 * in a bank-owned flow (Moje ING for the eligible online path or with an ING
 * expert for the remaining paths). Keeping that distinction here prevents the
 * product from presenting an invented PDF as an official bank form.
 */

export type IngPackageMethod =
  | 'web_form'
  | 'manual_action'
  | 'pdf_manual'
  | 'pdf_readonly'
  | 'customer_upload'

export interface IngOfficialAsset {
  readonly fileName: string
  readonly sha256: string
  readonly pageCount: number
  readonly downloadUrl: `https://${string}.ing.pl/${string}`
  readonly effectiveFrom: string | null
  readonly observedCurrentAt: '2026-08-09'
}

export interface IngPackageDocument {
  readonly id: string
  readonly title: string
  readonly category:
    | 'application'
    | 'income'
    | 'business'
    | 'valuation'
    | 'information'
    | 'supplement'
    | 'promotion'
  readonly method: IngPackageMethod
  readonly requiredFor: readonly string[]
  readonly repeatForApplicants?: boolean
  readonly asset?: IngOfficialAsset
  readonly sourcePageUrl: `https://${string}.ing.pl/${string}`
  readonly signature: string
  readonly validity: string
  readonly canonicalKeys: readonly string[]
  readonly notes: readonly string[]
}

const PROCESS_PAGE = 'https://www.ing.pl/indywidualni/kredyty-i-pozyczki/kredyt-hipoteczny/proces-i-dokumenty' as const
const ONLINE_PAGE = 'https://www.ing.pl/indywidualni/kredyty-i-pozyczki/kredyt-hipoteczny-online' as const
const GENERAL_INFO_PAGE = 'https://www.ing.pl/indywidualni/kredyty-i-pozyczki/kredyt-hipoteczny/informacje-ogolne-o-kredycie-hipotecznym' as const
const OFFERS_PAGE = 'https://www.ing.pl/indywidualni/kredyty-i-pozyczki/kredyt-hipoteczny/oferty-i-oprocentowanie-stale' as const
const REFINANCE_PAGE = 'https://www.ing.pl/indywidualni/kredyty-i-pozyczki/przenosze-kredyt' as const
const ENERGY_EFFICIENT_HOME_PAGE = 'https://www.ing.pl/indywidualni/kredyty-i-pozyczki/kredyt-hipoteczny-na-dom-energooszczedny' as const

const ING_APPLICANT_DATA_CANONICAL_KEYS = [
  'applicants.*.firstName',
  'applicants.*.lastName',
  'applicants.*.pesel',
  'applicants.*.birthDate',
  'applicants.*.identityDocumentType',
  'applicants.*.identityDocumentNumber',
  'applicants.*.phone',
  'applicants.*.email',
  'applicants.*.residentialAddress',
  'applicants.*.correspondenceAddress',
  'applicants.*.maritalStatus',
  'applicants.*.maritalPropertyCommunity',
  'applicants.*.householdSize',
  'applicants.*.incomeSource',
  'applicants.*.employerName',
  'applicants.*.employmentStartDate',
  'applicants.*.averageNetIncome',
  'applicants.*.liabilities.*',
  'households.*.householdExpenses',
  'households.*.otherFixedExpenses',
] as const

const ING_APPLICATION_CANONICAL_KEYS = [
  'application.place',
  'application.date',
  'loan.purpose',
  'loan.amount',
  'loan.termMonths',
  'loan.installmentType',
  'loan.interestType',
  'loan.disbursementType',
  'investment.totalCost',
  'investment.ownFunds',
  'property.type',
  'property.address.*',
  'property.landRegisterNumber',
  'property.marketValue',
  'property.appraisalSource',
] as const

export const ING_OFFICIAL_PACKAGE_DOCUMENTS = [
  {
    id: 'ing-mortgage-online-flow-2026',
    title: 'Wniosek o kredyt hipoteczny i dane klienta w Moje ING',
    category: 'application',
    method: 'web_form',
    requiredFor: [
      'self-service route: exactly one borrower',
      'secondary-market house/apartment',
      'financed property is the collateral',
      'permitted online income source and no business activity',
    ],
    sourcePageUrl: ONLINE_PAGE,
    signature: 'The borrower approves the application with the PIN in Moje ING.',
    validity: 'A draft in Moje ING may be saved for up to 30 days. Evidence must remain current when the application is submitted.',
    canonicalKeys: [
      ...ING_APPLICATION_CANONICAL_KEYS,
      ...ING_APPLICANT_DATA_CANONICAL_KEYS,
    ],
    notes: [
      'There is no downloadable PDF for this path; the official bank-hosted flow collects the data and uploads, records approval and produces the bank documents.',
      'The published FAQ lists employment, management-contract, pension, disability-pension and 800+ income. The bank-owned eligibility check remains authoritative.',
    ],
  },
  {
    id: 'ing-mortgage-application-expert-flow-2026',
    title: 'Wniosek o kredyt hipoteczny',
    category: 'application',
    method: 'manual_action',
    requiredFor: ['all applications outside the eligible Moje ING self-service route', 'customer chooses an ING expert'],
    sourcePageUrl: PROCESS_PAGE,
    signature: 'Complete with an ING expert; sign the bank-generated application in the places indicated by ING.',
    validity: 'Case-specific bank-generated document. ING may request updated evidence before issuing the decision.',
    canonicalKeys: ING_APPLICATION_CANONICAL_KEYS,
    notes: [
      'The current public document list names this document but does not link a reusable application PDF.',
      'Do not create a synthetic PDF. Route the case to an ING expert by video, branch or sales partner.',
    ],
  },
  {
    id: 'ing-applicant-data-expert-flow-2026',
    title: 'Dane Wnioskodawcow',
    category: 'application',
    method: 'manual_action',
    requiredFor: ['all applications outside the eligible Moje ING self-service route'],
    sourcePageUrl: PROCESS_PAGE,
    signature: 'Complete with an ING expert; every applicant signs or approves the bank-generated declarations as instructed by ING.',
    validity: 'Case-specific. Identity, household, income and liabilities must be current on submission.',
    canonicalKeys: ING_APPLICANT_DATA_CANONICAL_KEYS,
    notes: [
      'The current public document list names applicant data separately but does not publish a reusable blank PDF.',
      'Consent and declaration capture belongs to the bank-owned application flow; it is not a local overlay template.',
    ],
  },
  {
    id: 'ing-income-certificate-2026-03-08',
    title: 'Zaswiadczenie o zrodle i wysokosci miesiecznych dochodow',
    category: 'income',
    method: 'pdf_manual',
    requiredFor: [
      'employment/appointment/service/management-contract/commission income when the qualifying salary history is not visible in an ING account',
      'fixed-term employment unless salary from the same payer has reached an ING account for 12 months',
      'indefinite employment unless salary from the same payer has reached an ING account for 6 months',
      'commission contract unless income from the same payer has reached an ING account for 12 months',
    ],
    repeatForApplicants: true,
    asset: {
      fileName: 'ing-zaswiadczenie-o-dochodach-2026-03-08.pdf',
      sha256: '175a6d3563103d0b34986f5fecb44558f1ec96c08e7f894242169d0a40e37329',
      pageCount: 2,
      downloadUrl: 'https://www.ing.pl/_fileserver/item/mjver9u',
      effectiveFrom: '2026-03-08',
      observedCurrentAt: '2026-08-09',
    },
    sourcePageUrl: PROCESS_PAGE,
    signature: 'Employer/client principal or an authorised issuer: position and legible signature. Company stamp has a dedicated field.',
    validity: 'One month from issue date (stated in the official form).',
    canonicalKeys: [
      'applicants.*.firstName',
      'applicants.*.lastName',
      'applicants.*.pesel',
      'applicants.*.employerName',
      'applicants.*.employerNip',
      'applicants.*.employerRegon',
      'applicants.*.employerAddress',
      'applicants.*.employmentBenefitType',
      'applicants.*.employmentStartDate',
      'applicants.*.employmentContractDuration',
      'applicants.*.employmentEndDate',
      'applicants.*.jobTitle',
      'applicants.*.averageNetIncome',
      'applicants.*.incomeCurrency',
      'applicants.*.averageNetIncomeInWords',
      'applicants.*.salaryPaymentMethod',
      'applicants.*.salaryGarnished',
      'applicants.*.salaryGarnishmentAmount',
      'applicants.*.adverseEmploymentCircumstances',
    ],
    notes: [
      'The PDF is an encrypted, JavaScript-enabled AcroForm with obfuscated field names; it must not be treated as a stable semantic AcroForm mapping without a separate audited field map.',
      'When maternity, parental or sickness benefit is received, ING additionally requires a ZUS certificate stating the benefit amount.',
      'For the online secondary-market path, confirmation of incoming salary is also required when salary is not credited to ING.',
    ],
  },
  {
    id: 'ing-business-form-2015-11-09',
    title: 'Formularz dla osob prowadzacych dzialalnosc gospodarcza',
    category: 'business',
    method: 'pdf_manual',
    requiredFor: ['each applicant whose business income is analysed', 'applicant with employment income who additionally operates a business when ING asks for the additional form'],
    repeatForApplicants: true,
    asset: {
      fileName: 'ing-formularz-dzialalnosc-gospodarcza-2015-11-09.pdf',
      sha256: 'eb97264f95158fb9fccbbbf86c7350055cbfac6f677fbcd581f50f90ce47718e',
      pageCount: 2,
      downloadUrl: 'https://www.ing.pl/_fileserver/item/1004694',
      effectiveFrom: '2015-11-09',
      observedCurrentAt: '2026-08-09',
    },
    sourcePageUrl: PROCESS_PAGE,
    signature: 'The applicant confirms the declarations with date, printed name and legible signature.',
    validity: 'No expiry is stated in the form. Financial figures and public-authority certificates must be current for the application date.',
    canonicalKeys: [
      'applicants.*.firstName',
      'applicants.*.lastName',
      'applicants.*.businessLegalForm',
      'applicants.*.pkdCode',
      'applicants.*.businessActiveOrRecentlySuspended',
    ],
    notes: [
      'The current ING process page still requires a business form but does not expose a direct link next to the label. This exact official ING file remains available and states that it has applied since 2015-11-09.',
      'External business liabilities trigger a separate bank form plus agreements/repayment schedules; that separate form is not publicly linked, so it is a manual bank action rather than a synthetic PDF.',
    ],
  },
  {
    id: 'ing-general-mortgage-information-2026-05-31',
    title: 'Informacje ogolne o kredycie hipotecznym i pozyczce hipotecznej',
    category: 'information',
    method: 'pdf_readonly',
    requiredFor: ['all mortgage packages as information delivered to the client'],
    asset: {
      fileName: 'ing-informacje-ogolne-kredyt-hipoteczny-2026-05-31.pdf',
      sha256: 'db5269a6e426fceb8d2f42ead1b4e25cc6d03a23207a3c7a167e01a19f24a8df',
      pageCount: 13,
      downloadUrl: 'https://www.ing.pl/_fileserver/item/1120047',
      effectiveFrom: '2026-05-31',
      observedCurrentAt: '2026-08-09',
    },
    sourcePageUrl: GENERAL_INFO_PAGE,
    signature: 'No client fields or signature required; deliver as read-only information.',
    validity: 'Use the current published revision; this copy states update 2026-05-31.',
    canonicalKeys: [],
    notes: ['This is not an application form and must not be counted as an automatically completed form.'],
  },
  {
    id: 'ing-standardised-information-form-case-generated-2026',
    title: 'Spersonalizowany formularz informacyjny kredytu hipotecznego',
    category: 'information',
    method: 'manual_action',
    requiredFor: ['the personalised pre-contract information stage for every mortgage case'],
    sourcePageUrl: GENERAL_INFO_PAGE,
    signature: 'ING generates and delivers the case-specific standardised form; acknowledgement/acceptance follows the bank process.',
    validity: 'Case- and offer-specific. Regenerate it when the product parameters or assumptions change.',
    canonicalKeys: [
      'loan.amount',
      'loan.termMonths',
      'loan.installmentType',
      'loan.interestType',
      'loan.productVariant',
      'property.marketValue',
    ],
    notes: [
      'ING states that it provides this form; no reusable public blank is published.',
      'It is a bank-generated document, not a PDF template to auto-fill locally.',
    ],
  },
  {
    id: 'ing-appraisal-guidelines-2026-08-09',
    title: 'Wytyczne ING dla operatu szacunkowego',
    category: 'valuation',
    method: 'pdf_readonly',
    requiredFor: ['customer supplies an appraisal prepared by an external appraiser'],
    asset: {
      fileName: 'ing-wytyczne-do-operatu-2026-08-09.pdf',
      sha256: '191d7774f4531d7c227199acedb630b94fdf5111844fd1bc424e372b31f2dd7b',
      pageCount: 4,
      downloadUrl: 'https://www.ing.pl/_fileserver/item/1127093',
      effectiveFrom: null,
      observedCurrentAt: '2026-08-09',
    },
    sourcePageUrl: PROCESS_PAGE,
    signature: 'No signature on the guidelines; give them to the appraiser.',
    validity: 'Current revision observed 2026-08-09. ING does not state an expiry date on the PDF.',
    canonicalKeys: ['property.type', 'property.landRegisterNumber', 'property.address.*', 'property.marketValue'],
    notes: [
      'Comparable transactions must be no older than 24 months before the appraisal date.',
      'The risk form is a mandatory appendix to the appraisal.',
      'The appraiser must also attach the documents selected by property type in the guidelines.',
    ],
  },
  {
    id: 'ing-valuation-risk-form-2026',
    title: 'Formularz ryzyk zwiazanych z wyceniana nieruchomoscia',
    category: 'valuation',
    method: 'web_form',
    requiredFor: ['every external appraisal supplied by the customer'],
    sourcePageUrl: 'https://www.ing.pl/procesy/aktywne-pdf/ni',
    signature: 'Complete the official ING active form and attach its bank-generated output to the appraisal.',
    validity: 'Complete against the property state and legal data current at the appraisal date.',
    canonicalKeys: ['property.type', 'property.address.*', 'property.landRegisterNumber'],
    notes: [
      'ING redirects this step to the bank-hosted active-form service at forms.ing.pl.',
      'There is no stable public blank PDF to package; do not substitute a locally generated PDF.',
    ],
  },
  {
    id: 'ing-appraiser-conflict-statement-2026-05-31',
    title: 'Oswiadczenie rzeczoznawcy majatkowego o braku konfliktu interesow',
    category: 'valuation',
    method: 'pdf_manual',
    requiredFor: ['every external appraisal supplied by the customer'],
    asset: {
      fileName: 'ing-oswiadczenie-rzeczoznawcy-brak-konfliktu-2026-05-31.pdf',
      sha256: '3defe96d2c8817dc6b5c812a2944d98e6c5cfbd1fb30377b899deec49c4dbb98',
      pageCount: 1,
      downloadUrl: 'https://www.ing.pl/_fileserver/item/1128543',
      effectiveFrom: '2026-05-31',
      observedCurrentAt: '2026-08-09',
    },
    sourcePageUrl: PROCESS_PAGE,
    signature: 'Appraiser signature and stamp; appraiser licence number is required.',
    validity: 'Per appraisal/property; no independent expiry stated.',
    canonicalKeys: ['property.address.*'],
    notes: ['The bank application number remains a bank/expert field.'],
  },
  {
    id: 'ing-mortgage-application-supplement-2025-09-30',
    title: 'Uzupelnienie wniosku o produkt hipoteczny',
    category: 'supplement',
    method: 'pdf_manual',
    requiredFor: ['only when ING declares the submitted application incomplete and specifies missing items'],
    asset: {
      fileName: 'ing-uzupelnienie-wniosku-produkt-hipoteczny-2025-09-30.pdf',
      sha256: '55e1b0491a36876e01eda0bf548a810a0c96fc4ef6c98e8020f36d836a4d736f',
      pageCount: 1,
      downloadUrl: 'https://www.ing.pl/_fileserver/item/niucuw8',
      effectiveFrom: '2025-09-30',
      observedCurrentAt: '2026-08-09',
    },
    sourcePageUrl: PROCESS_PAGE,
    signature: 'Date and legible signature of each listed applicant.',
    validity: 'Case-specific; submit with the exact missing items identified by ING.',
    canonicalKeys: [
      'applicants.0.firstName',
      'applicants.0.lastName',
      'applicants.0.pesel',
      'applicants.1.firstName',
      'applicants.1.lastName',
      'applicants.1.pesel',
      'application.date',
    ],
    notes: [
      'This is not part of a complete first submission. It starts the statutory decision period only after ING accepts the supplement and the listed missing items.',
    ],
  },
  {
    id: 'ing-lato-u-siebie-rules-2026',
    title: 'Regulamin oferty specjalnej Lato u siebie',
    category: 'promotion',
    method: 'pdf_readonly',
    requiredFor: ['only when the selected offer is Lato u siebie'],
    asset: {
      fileName: 'ing-regulamin-lato-u-siebie-2026.pdf',
      sha256: 'eecbacc7590b5a116fef2ca100093b4f9154184b0c912e30726cdef9423d6cb4',
      pageCount: 6,
      downloadUrl: 'https://www.ing.pl/_fileserver/item/cdvc2pz',
      effectiveFrom: '2026-07-20',
      observedCurrentAt: '2026-08-09',
    },
    sourcePageUrl: OFFERS_PAGE,
    signature: 'Acceptance occurs in the ING application flow; this copy is read-only information.',
    validity: 'Offer published for applications through 2026-08-23.',
    canonicalKeys: ['loan.productVariant'],
    notes: ['For a secondary-market property the complete application definition includes a valid energy performance certificate.'],
  },
  {
    id: 'ing-energy-efficient-home-rules-2026',
    title: 'Regulamin Kredytu hipotecznego na dom energooszczedny',
    category: 'promotion',
    method: 'pdf_readonly',
    requiredFor: ['only when the selected offer is the energy-efficient-home offer'],
    asset: {
      fileName: 'ing-regulamin-kredyt-na-dom-energooszczedny-2026.pdf',
      sha256: '149e449d49ddafd3607092c8ec92578fca9e177cac532b19dd22add917f70345',
      pageCount: 7,
      downloadUrl: 'https://www.ing.pl/_fileserver/item/lgvkv8o',
      effectiveFrom: '2026-07-20',
      observedCurrentAt: '2026-08-09',
    },
    sourcePageUrl: OFFERS_PAGE,
    signature: 'Acceptance occurs in the ING application flow; this copy is read-only information.',
    validity: 'Offer published for applications through 2026-08-23.',
    canonicalKeys: ['loan.productVariant'],
    notes: ['Energy-demand evidence and the offer-specific conditions must accompany the ordinary application package.'],
  },
] as const satisfies readonly IngPackageDocument[]

export interface IngEvidenceRequirement {
  readonly id: string
  readonly label: string
  readonly category: 'identity' | 'income' | 'property' | 'valuation' | 'offer' | 'post-decision'
  readonly method: 'customer_upload' | 'manual_action'
  readonly requiredWhen: readonly string[]
  readonly timing: 'application' | 'before-final-decision' | 'before-disbursement' | 'after-disbursement'
  readonly notes?: readonly string[]
}

/** Files/actions that complete the package but are not reusable bank PDF templates. */
export const ING_EVIDENCE_REQUIREMENTS = [
  {
    id: 'identity-photo-document',
    label: 'Dokument ze zdjeciem potwierdzajacy tozsamosc',
    category: 'identity',
    method: 'customer_upload',
    requiredWhen: ['each applicant'],
    timing: 'application',
  },
  {
    id: 'zus-benefit-certificate',
    label: 'Zaswiadczenie ZUS o wysokosci zasilku',
    category: 'income',
    method: 'customer_upload',
    requiredWhen: ['maternity, parental or sickness benefit supplements employment income'],
    timing: 'application',
  },
  {
    id: 'business-tax-no-arrears',
    label: 'Zaswiadczenie US o niezaleganiu wraz z informacja o postepowaniach',
    category: 'income',
    method: 'customer_upload',
    requiredWhen: ['business income'],
    timing: 'application',
  },
  {
    id: 'business-zus-no-arrears',
    label: 'Zaswiadczenie o niezaleganiu ze skladkami ZUS',
    category: 'income',
    method: 'customer_upload',
    requiredWhen: ['business income'],
    timing: 'application',
  },
  {
    id: 'business-financial-statements',
    label: 'Dokumenty podatkowe i ksiegowe dzialalnosci',
    category: 'income',
    method: 'customer_upload',
    requiredWhen: [
      'full accounting: PIT-36/36L+B, profit and loss statements and fixed-assets schedules for the periods listed by ING',
      'KPiR: PIT-36/36L+B, KPiR and fixed-assets schedules for the periods listed by ING',
      'lump sum: PIT-28 and revenue registers for the periods listed by ING',
      'tax card: current tax assessment decision',
    ],
    timing: 'application',
    notes: ['For applications from 1 May through 31 December, ING additionally requires current-year data through the last settled month.'],
  },
  {
    id: 'business-external-liabilities',
    label: 'Informacja o zobowiazaniach firmowych oraz umowy i harmonogramy',
    category: 'income',
    method: 'manual_action',
    requiredWhen: ['the business form declares liabilities outside ING'],
    timing: 'application',
    notes: ['The separate bank form is not publicly linked. Obtain it from ING instead of generating a local substitute.'],
  },
  {
    id: 'pension-entitlement-and-payment',
    label: 'Decyzja o swiadczeniu oraz dowod ostatniej wyplaty',
    category: 'income',
    method: 'customer_upload',
    requiredWhen: ['pension/disability/pre-retirement income not visible in an ING account'],
    timing: 'application',
    notes: ['For a disability pension also include the period for which it was awarded.'],
  },
  {
    id: 'primary-market-transaction-documents',
    label: 'Dokument okreslajacy warunki transakcji na rynku pierwotnym',
    category: 'property',
    method: 'customer_upload',
    requiredWhen: ['primary-market purchase'],
    timing: 'application',
    notes: [
      'Provide one signed document: development agreement with annexes, preliminary notarial/civil agreement, or preliminary cooperative agreement.',
      'Also provide the land-register number, gift deed if applicable, release promise if the developer/cooperative property is mortgaged, and proof of payments.',
      'For an apartment add the occupancy permit/accepted occupancy notice; for a house add accepted completion notice.',
      'When the developer construction progress is at least 90%, the developer agreement must state the ownership-transfer date after occupancy; the developer file must set delivery of the notarial deed no later than six months after signing the loan agreement.',
    ],
  },
  {
    id: 'secondary-market-property-documents',
    label: 'Dokumenty nieruchomosci z rynku wtornego',
    category: 'property',
    method: 'customer_upload',
    requiredWhen: ['secondary-market house or apartment purchase'],
    timing: 'application',
    notes: [
      'Land-register number; for cooperative title without a register, cooperative certificate plus the building land-register number.',
      'Gift deed if it was the acquisition basis.',
      'If mortgaged, creditor-bank information stating the balance to repay.',
    ],
  },
  {
    id: 'construction-property-documents',
    label: 'Dokumenty budowy domu',
    category: 'property',
    method: 'customer_upload',
    requiredWhen: ['house construction'],
    timing: 'application',
    notes: ['Land-register number, gift deed if applicable, valid final building permit, cost estimate and building utility schedule from the design.'],
  },
  {
    id: 'renovation-property-documents',
    label: 'Dokumenty remontu, rozbudowy lub modernizacji',
    category: 'property',
    method: 'customer_upload',
    requiredWhen: ['renovation/extension/modernisation/reconstruction'],
    timing: 'application',
    notes: [
      'House: land-register number, utility schedule, gift deed if applicable, cost estimate and permit/works notification if required.',
      'Apartment: land-register number or cooperative certificate, gift deed if applicable, and cost estimate.',
    ],
  },
  {
    id: 'building-plot-documents',
    label: 'Dokumenty zakupu dzialki budowlanej',
    category: 'property',
    method: 'customer_upload',
    requiredWhen: ['building-plot purchase'],
    timing: 'application',
    notes: [
      'Plot land-register number or parent-property register plus final subdivision decision when subdivision is not recorded.',
      'Gift/agricultural-holding transfer deed if applicable and creditor-bank balance information if mortgaged.',
    ],
  },
  {
    id: 'external-appraisal',
    label: 'Operat szacunkowy z kompletem zalacznikow ING',
    category: 'valuation',
    method: 'customer_upload',
    requiredWhen: ['customer chooses an external appraiser'],
    timing: 'application',
    notes: [
      'Include the ING risk form and conflict statement.',
      'Attach the land-register excerpt, photos and property-type documents selected in the ING guidelines; house/plot also require land-register extract and cadastral map.',
      'Attach appraiser professional-liability insurance and other source documents material to the valuation.',
    ],
  },
  {
    id: 'bank-appraisal-order',
    label: 'Zlecenie i oplata wyceny przez ING',
    category: 'valuation',
    method: 'manual_action',
    requiredWhen: ['customer does not supply an external appraisal'],
    timing: 'before-final-decision',
    notes: ['ING asks for payment before issuing its final decision.'],
  },
  {
    id: 'energy-performance-certificate',
    label: 'Wazne swiadectwo charakterystyki energetycznej',
    category: 'offer',
    method: 'customer_upload',
    requiredWhen: ['secondary-market application under a current offer whose regulations include it, including Lato u siebie'],
    timing: 'application',
  },
  {
    id: 'energy-efficient-house-evidence',
    label: 'Dokumentacja zapotrzebowania na energie domu',
    category: 'offer',
    method: 'customer_upload',
    requiredWhen: ['energy-efficient-home offer'],
    timing: 'application',
  },
  {
    id: 'refinance-balance-information',
    label: 'Informacja o saldzie refinansowanego kredytu',
    category: 'post-decision',
    method: 'customer_upload',
    requiredWhen: ['mortgage refinancing'],
    timing: 'application',
  },
  {
    id: 'refinance-closure-confirmation',
    label: 'Potwierdzenie zamkniecia refinansowanych zobowiazan',
    category: 'post-decision',
    method: 'customer_upload',
    requiredWhen: ['mortgage refinancing after ING disburses the funds'],
    timing: 'after-disbursement',
  },
] as const satisfies readonly IngEvidenceRequirement[]

/** Canonical data that ING requires but the shared catalogue did not expose on the audit date. */
export const ING_CANONICAL_FIELD_GAPS = [
  'application.channel',
  'property.market',
  'property.financedPropertyIsCollateral',
  'applicants.*.incomePaidToIngAccount',
  'applicants.*.incomeCreditedToIngMonths',
  'applicants.*.incomePayerUnchanged',
  'applicants.*.receivesZusBenefit',
  'applicants.*.employerPhone',
  'applicants.*.incomeAveragingMonths',
  'applicants.*.averageBaseNetIncome',
  'applicants.*.averageBonusNetIncome',
  'applicants.*.annualBonusNetIncome',
  'applicants.*.annualBonusPaymentDate',
  'applicants.*.salaryPaymentBankName',
  'applicants.*.employeeLoanOutstandingAmount',
  'applicants.*.employeeLoanMonthlyPayment',
  'applicants.*.employerInsolventOrLiquidated',
  'applicants.*.businessName',
  'applicants.*.businessAddress',
  'applicants.*.businessPhone',
  'applicants.*.businessStartDate',
  'applicants.*.businessSuspensionStartDate',
  'applicants.*.businessSuspensionEndDate',
  'applicants.*.businessClosureDate',
  'applicants.*.businessOwnershipSharePercent',
  'applicants.*.businessNip',
  'applicants.*.businessRegon',
  'applicants.*.businessKrs',
  'applicants.*.businessDescription',
  'applicants.*.businessAccountingMethodCurrent',
  'applicants.*.businessAccountingMethodPrevious',
  'applicants.*.businessIncomeIncludedInAssessment',
  'applicants.*.businessHasExternalLiabilities',
  'applicants.*.businessRevenueCurrentYear',
  'applicants.*.businessRevenuePreviousYear',
  'applicants.*.businessCostsCurrentYear',
  'applicants.*.businessCostsPreviousYear',
  'applicants.*.businessGeneratedLoss',
  'applicants.*.businessZusSettlementStatus',
  'applicants.*.businessTaxSettlementStatus',
] as const

export const ING_OFFICIAL_EVIDENCE = [
  {
    claim: 'Current public mortgage document list, income rules, property documents, valuation files, PDF completion and wet-signature instructions.',
    url: PROCESS_PAGE,
    publishedRevision: '2026-06-03',
    observedCurrentAt: '2026-08-09',
  },
  {
    claim: 'Moje ING eligibility, online completion, PIN approval, uploads, draft retention and remote contract path.',
    url: ONLINE_PAGE,
    observedCurrentAt: '2026-08-09',
  },
  {
    claim: 'Current general mortgage information and delivery of an additional standardised information form by ING.',
    url: GENERAL_INFO_PAGE,
    observedCurrentAt: '2026-08-09',
  },
  {
    claim: 'Current offer conditions and promotion regulations.',
    url: OFFERS_PAGE,
    observedCurrentAt: '2026-08-09',
  },
  {
    claim: 'Refinancing route, valuation choice and post-disbursement confirmation that refinanced liabilities were closed.',
    url: REFINANCE_PAGE,
    observedCurrentAt: '2026-08-09',
  },
  {
    claim: 'Energy-efficient-home application route and the need to document qualifying energy demand.',
    url: ENERGY_EFFICIENT_HOME_PAGE,
    observedCurrentAt: '2026-08-09',
  },
] as const
