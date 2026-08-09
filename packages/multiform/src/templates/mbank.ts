import type { DocumentTemplate, PdfFormKind } from '../types.ts'

interface ManualTemplateInput {
  id: string
  label: string
  fileName: string
  sha256: string
  pageCount: number
  width: number
  height: number
  formKind?: PdfFormKind
  method: 'pdf_manual' | 'pdf_readonly'
  manualUserActionCount?: number
  repeatForApplicants?: boolean
  includeWhen?: DocumentTemplate['includeWhen']
  notes: readonly string[]
}

function pages(pageCount: number, width: number, height: number) {
  return Array.from({ length: pageCount }, (_, index) => ({
    page: index + 1,
    mediaBox: { x: 0, y: 0, width, height },
    cropBox: { x: 0, y: 0, width, height },
    rotation: 0 as const,
    userUnit: 1,
  }))
}

function officialPdf(input: ManualTemplateInput): DocumentTemplate {
  return {
    schemaVersion: 2,
    id: input.id,
    bank: 'mbank',
    label: input.label,
    version: 1,
    fillMethod: { kind: input.method },
    source: {
      fileName: input.fileName,
      sha256: input.sha256,
      pageCount: input.pageCount,
      formKind: input.formKind ?? 'overlay',
      pages: pages(input.pageCount, input.width, input.height),
    },
    coverage: {
      status: 'complete',
      inScopeTargetCount: 0,
      mappedTargetCount: 0,
      manualUserActionCount: input.manualUserActionCount ?? 0,
      notes: input.notes,
    },
    ...(input.repeatForApplicants
      ? {
          repeatFor: {
            collection: 'applicants' as const,
            templateIndex: 0,
            maxInstances: 5,
            itemLabel: 'Wnioskodawca',
          },
        }
      : {}),
    ...(input.includeWhen ? { includeWhen: input.includeWhen } : {}),
    bindings: [],
  }
}

export const MBANK_INFORMATION_REQUEST_TEMPLATE = officialPdf({
  id: 'mbank-information-request-2026',
  label: 'Wniosek o wydanie formularza informacyjnego',
  fileName: 'mbank-wniosek-o-formularz-informacyjny-2026-03-31.pdf',
  sha256: 'd389966ce5a23021def27e117bb92104d1895d201d82a368ea18dfa3d08d2d2d',
  pageCount: 11,
  width: 595.238,
  height: 841.836,
  method: 'pdf_manual',
  manualUserActionCount: 1,
  notes: [
    'Oficjalny pierwszy etap procesu mBanku, obowiązujący od 31.03.2026 r.',
    'Bank wymaga uzupełnienia drukowanymi literami, paraf wnioskodawców i eksperta oraz podpisów wskazanych w formularzu.',
  ],
})

export const MBANK_APPLICANT_DATA_TEMPLATE = officialPdf({
  id: 'mbank-applicant-data-2026',
  label: 'Załącznik nr 1 — dane wnioskodawcy',
  fileName: 'mbank-zalacznik-dane-wnioskodawcy-2026-01-01.pdf',
  sha256: '9e3a8ffae7f4f16f759b67c080dfc1f52f21ed7ecd00e04cd547ca15c3d8f5bb',
  pageCount: 9,
  width: 595.238,
  height: 841.836,
  method: 'pdf_manual',
  manualUserActionCount: 1,
  repeatForApplicants: true,
  notes: [
    'Osobny egzemplarz dla każdego wnioskodawcy.',
    'Formularz obejmuje dane osobowe, sytuację rodzinną, dochody, zobowiązania, oświadczenia i podpisy.',
  ],
})

export const MBANK_BUSINESS_DATA_TEMPLATE = officialPdf({
  id: 'mbank-business-data-2026',
  label: 'Załącznik nr 2 — dane o działalności gospodarczej',
  fileName: 'mbank-zalacznik-dzialalnosc-gospodarcza-2026-03-31.pdf',
  sha256: '00667ba1f8a2b7fb3a05d311cfeb57abe7b0a36dd839eecd24b3d8b185ecbc7c',
  pageCount: 3,
  width: 595.238,
  height: 841.836,
  method: 'pdf_manual',
  manualUserActionCount: 1,
  repeatForApplicants: true,
  includeWhen: { canonicalKey: 'applicants.0.incomeSource', equals: 'business' },
  notes: [
    'Osobny egzemplarz wyłącznie dla wnioskodawcy uzyskującego dochód z działalności gospodarczej.',
    'Obowiązuje od 31.03.2026 r.',
  ],
})

export const MBANK_EMPLOYMENT_INCOME_TEMPLATE = officialPdf({
  id: 'mbank-employment-income-2026',
  label: 'Zaświadczenie o zatrudnieniu i wynagrodzeniu',
  fileName: 'mbank-zaswiadczenie-o-zatrudnieniu-umowa-o-prace-2026-01-16-sanitized.pdf',
  sha256: '7698b9380e649a08ab7863c0ac7a4dfe580dd2796f900e362260eae654b07991',
  pageCount: 2,
  width: 595.32,
  height: 841.92,
  method: 'pdf_manual',
  manualUserActionCount: 1,
  repeatForApplicants: true,
  includeWhen: { canonicalKey: 'applicants.0.incomeSource', equals: 'employment' },
  notes: [
    'Wizualnie wierna, statyczna i pozbawiona JavaScriptu kopia oficjalnego formularza mBanku utworzona z pliku opublikowanego 16.01.2026 r.',
    'Zaświadczenie wypełnia i podpisuje pracodawca; zgodnie z treścią jest ważne 30 dni.',
  ],
})

export const MBANK_CIVIL_CONTRACT_INCOME_TEMPLATE = officialPdf({
  id: 'mbank-civil-contract-income-2026',
  label: 'Zaświadczenie o dochodzie z umowy cywilnoprawnej',
  fileName: 'mbank-zaswiadczenie-umowa-cywilnoprawna-2026-08-09.pdf',
  sha256: '69a360a41bd71503c69d9ab3fff60ed8a606b73d7ce39b3b494da7878278e505',
  pageCount: 2,
  width: 595.32,
  height: 841.92,
  formKind: 'acroform',
  method: 'pdf_manual',
  manualUserActionCount: 1,
  repeatForApplicants: true,
  includeWhen: { canonicalKey: 'applicants.0.incomeSource', equals: 'civil_contract' },
  notes: [
    'Oficjalny edytowalny formularz dla umowy zlecenia, o dzieło lub kontraktu menedżerskiego.',
    'Pozostaje aktywnym PDF-em do ręcznego uzupełnienia i podpisu wystawcy.',
  ],
})

export const MBANK_GENERAL_INFORMATION_TEMPLATE = officialPdf({
  id: 'mbank-general-mortgage-information-2026',
  label: 'Ogólne informacje dotyczące umowy o kredyt hipoteczny',
  fileName: 'mbank-ogolne-informacje-kredyt-hipoteczny.pdf',
  sha256: '40be30b4f930e44e34d7b164071fd9c551b0ed518d166ce9bc90b441271f50f6',
  pageCount: 5,
  width: 595.32,
  height: 841.92,
  method: 'pdf_readonly',
  notes: ['Aktualny materiał informacyjny mBanku do przekazania klientom przed zawarciem umowy.'],
})

export const MBANK_RISK_INFORMATION_TEMPLATE = officialPdf({
  id: 'mbank-risk-information-2026',
  label: 'Informacja o ryzykach dla kredytobiorców hipotecznych',
  fileName: 'mbank-informacja-o-ryzykach-2026-03-04.pdf',
  sha256: '4189fcade7f90736814283ec3461c441cd0670010b71c227934122c38655926d',
  pageCount: 29,
  width: 595.56,
  height: 842.04,
  method: 'pdf_readonly',
  notes: ['Materiał obowiązujący od 04.03.2026 r.; wymaga potwierdzenia doręczenia klientom.'],
})

export const MBANK_INSURANCE_ASSIGNMENT_TEMPLATE = officialPdf({
  id: 'mbank-insurance-assignment-2025',
  label: 'Umowa ramowa cesji praw z polisy nieruchomości',
  fileName: 'mbank-umowa-ramowa-cesji-2025-05-26.pdf',
  sha256: '9f067bebac33daf849096e979040dde80180fff773f840bf92cdeeff918a5988',
  pageCount: 3,
  width: 595.32,
  height: 842.04,
  method: 'pdf_manual',
  manualUserActionCount: 1,
  notes: [
    'Dokument etapu uruchomienia kredytu, używany gdy zabezpieczeniem jest cesja praw z indywidualnej polisy nieruchomości.',
    'Wymaga ręcznego uzupełnienia i podpisów zgodnie z formularzem.',
  ],
})

export const MBANK_TEMPLATES = [
  MBANK_INFORMATION_REQUEST_TEMPLATE,
  MBANK_APPLICANT_DATA_TEMPLATE,
  MBANK_BUSINESS_DATA_TEMPLATE,
  MBANK_EMPLOYMENT_INCOME_TEMPLATE,
  MBANK_CIVIL_CONTRACT_INCOME_TEMPLATE,
  MBANK_GENERAL_INFORMATION_TEMPLATE,
  MBANK_RISK_INFORMATION_TEMPLATE,
  MBANK_INSURANCE_ASSIGNMENT_TEMPLATE,
] as const satisfies readonly DocumentTemplate[]
