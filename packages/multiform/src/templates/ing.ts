import type { DocumentTemplate, PdfFormKind } from '../types.ts'

interface IngPdfTemplateInput {
  id: string
  label: string
  fileName: string
  sha256: string
  pageCount: number
  width: number
  height: number
  formKind: PdfFormKind
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

function officialIngPdf(input: IngPdfTemplateInput): DocumentTemplate {
  return {
    schemaVersion: 2,
    id: input.id,
    bank: 'ing',
    label: input.label,
    version: 1,
    fillMethod: { kind: input.method },
    source: {
      fileName: input.fileName,
      sha256: input.sha256,
      pageCount: input.pageCount,
      formKind: input.formKind,
      pages: pages(input.pageCount, input.width, input.height),
    },
    coverage: {
      status: 'complete',
      inScopeTargetCount: 0,
      mappedTargetCount: 0,
      manualUserActionCount: input.manualUserActionCount ?? 0,
      excludedTargetCount: 0,
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

export const ING_INCOME_CERTIFICATE_TEMPLATE = officialIngPdf({
  id: 'ing-income-certificate-2026-03-08',
  label: 'ING - zaświadczenie o źródle i wysokości miesięcznych dochodów',
  fileName: 'ing-zaswiadczenie-o-dochodach-2026-03-08-sanitized.pdf',
  sha256: 'b1ddfcdbcc04cbc935f23595307e34e30a832e6001b504991c40db763bb1ff87',
  pageCount: 2,
  width: 595.32,
  height: 841.92,
  formKind: 'acroform',
  method: 'pdf_manual',
  manualUserActionCount: 1,
  repeatForApplicants: true,
  includeWhen: {
    canonicalKey: 'applicants.0.incomeSource',
    equals: ['employment', 'civil_contract'],
  },
  notes: [
    'Oficjalny formularz ING obowiązujący od 08.03.2026 r.; zgodnie z treścią jest ważny jeden miesiąc od wystawienia.',
    'Runtime korzysta z bezpiecznej pochodnej oficjalnego pliku: odszyfrowanej i znormalizowanej, bez JavaScript, akcji dokumentu i XFA. Zachowano wszystkie 42 pola AcroForm oraz pikselowo identyczny wygląd obu stron.',
    'Pola mają techniczne nazwy i nie zostały zmapowane do danych klienta. Formularz pozostaje pdf_manual; nie wolno udawać automatycznego uzupełnienia.',
    'Wypełnia i podpisuje go pracodawca, zleceniodawca albo inna osoba upoważniona; dokument ma osobne pole na stanowisko wystawcy i pieczęć firmy.',
    'ING dopuszcza oświadczenie zamiast zaświadczenia, jeżeli wynagrodzenie od tego samego płatnika wpływa na konto ING przez wymagany okres; dlatego checklistę oznaczono jako case_requested.',
  ],
})

export const ING_BUSINESS_FORM_TEMPLATE = officialIngPdf({
  id: 'ing-business-form-2015-11-09',
  label: 'ING - formularz dla osób prowadzących działalność gospodarczą',
  fileName: 'ing-formularz-dzialalnosc-gospodarcza-2015-11-09-sanitized.pdf',
  sha256: 'ea4f754c75adc7bd21cbb2ebc9abaf7f4180492c71c3c3d709cbd16f9c68494d',
  pageCount: 2,
  width: 595.32,
  height: 841.92,
  formKind: 'overlay',
  method: 'pdf_manual',
  manualUserActionCount: 1,
  repeatForApplicants: true,
  includeWhen: {
    canonicalKey: 'applicants.0.incomeSource',
    equals: 'business',
  },
  notes: [
    'Oficjalny plik ING wskazuje obowiązywanie od 09.11.2015 r.; bieżąca strona procesu nadal wymaga formularza działalności, choć nie podaje przy jego nazwie bezpośredniego linku.',
    'Runtime używa odszyfrowanej, statycznej pochodnej bez akcji i XFA; obie strony są pikselowo i tekstowo identyczne z oficjalnym źródłem.',
    'Dokument jest płaskim PDF-em do ręcznego uzupełnienia i podpisu każdego wnioskodawcy uzyskującego dochód z działalności.',
    'Formularz nie zastępuje zaświadczeń US i ZUS ani dokumentów finansowych zależnych od formy opodatkowania.',
  ],
})

export const ING_GENERAL_MORTGAGE_INFORMATION_TEMPLATE = officialIngPdf({
  id: 'ing-general-mortgage-information-2026-05-31',
  label: 'ING - informacje ogólne o kredycie hipotecznym i pożyczce hipotecznej',
  fileName: 'ing-informacje-ogolne-kredyt-hipoteczny-2026-05-31-sanitized.pdf',
  sha256: '2d6143b044dd73a896c7741794426088a7333aad0befebb7723ce43984166b0c',
  pageCount: 13,
  width: 594.96,
  height: 842.04,
  formKind: 'overlay',
  method: 'pdf_readonly',
  notes: [
    'Aktualny materiał informacyjny ING z oznaczeniem aktualizacji 31.05.2026 r.',
    'Runtime używa odszyfrowanej, statycznej pochodnej bez akcji i XFA; wszystkie 13 stron są pikselowo i tekstowo identyczne z oficjalnym źródłem.',
    'Nie zawiera pól ani podpisów i trafia do paczki wyłącznie jako pdf_readonly; nie jest wnioskiem ani formularzem automatycznie uzupełnianym.',
  ],
})

export const ING_APPRAISAL_GUIDELINES_TEMPLATE = officialIngPdf({
  id: 'ing-appraisal-guidelines-2026-08-09',
  label: 'ING - wytyczne do operatu szacunkowego',
  fileName: 'ing-wytyczne-do-operatu-2026-08-09-sanitized.pdf',
  sha256: 'a0afaea93e436c405a022c2370f3eaa57a1c698fb17fe9700ad403a36bf0b440',
  pageCount: 4,
  width: 595.32,
  height: 841.92,
  formKind: 'overlay',
  method: 'pdf_readonly',
  includeWhen: {
    canonicalKey: 'property.appraisalSource',
    equals: 'self_provided',
  },
  notes: [
    'Oficjalna wersja opublikowana przez ING i zaobserwowana jako bieżąca 09.08.2026 r.; sam PDF nie podaje daty obowiązywania.',
    'Runtime używa odszyfrowanej, statycznej pochodnej bez akcji i XFA; wszystkie 4 strony są pikselowo i tekstowo identyczne z oficjalnym źródłem.',
    'Materiał należy przekazać rzeczoznawcy, gdy klient dostarcza własny operat; nie wymaga uzupełnienia ani podpisu.',
    'Transakcje porównawcze w operacie nie mogą być starsze niż 24 miesiące przed datą wyceny.',
  ],
})

export const ING_APPRAISER_CONFLICT_STATEMENT_TEMPLATE = officialIngPdf({
  id: 'ing-appraiser-conflict-statement-2026-05-31',
  label: 'ING - oświadczenie rzeczoznawcy o braku konfliktu interesów',
  fileName: 'ing-oswiadczenie-rzeczoznawcy-brak-konfliktu-2026-05-31-sanitized.pdf',
  sha256: '493d4d4e83600261750b16d4415156e66dde98365aaf19bcbca2661ccddd3fa5',
  pageCount: 1,
  width: 595.32,
  height: 841.92,
  formKind: 'acroform',
  method: 'pdf_manual',
  manualUserActionCount: 1,
  includeWhen: {
    canonicalKey: 'property.appraisalSource',
    equals: 'self_provided',
  },
  notes: [
    'Oficjalny formularz ING obowiązujący od 31.05.2026 r.; jest załącznikiem do własnego operatu klienta.',
    'Runtime używa odszyfrowanej pochodnej bez JavaScript, akcji i XFA; zachowano 4 pola AcroForm oraz pikselowo i tekstowo identyczny wygląd strony.',
    'Ma trzy pola danych i nieaktywny po sanitizacji przycisk źródłowy; dane i podpis składa rzeczoznawca. Pozostaje pdf_manual i wymaga numeru uprawnień, podpisu oraz pieczęci rzeczoznawcy.',
  ],
})

export const ING_APPLICATION_SUPPLEMENT_TEMPLATE = officialIngPdf({
  id: 'ing-mortgage-application-supplement-2025-09-30',
  label: 'ING - uzupełnienie wniosku o produkt hipoteczny',
  fileName: 'ing-uzupelnienie-wniosku-produkt-hipoteczny-2025-09-30-sanitized.pdf',
  sha256: '32c754dd82eb7f65cf816c68f68608c00287444db49592276e8849d8ae2bdc21',
  pageCount: 1,
  width: 595.32,
  height: 841.92,
  formKind: 'acroform',
  method: 'pdf_manual',
  manualUserActionCount: 1,
  notes: [
    'Formularz obowiązuje od 30.09.2025 r. i służy wyłącznie do uzupełnienia braków wskazanych przez ING po złożeniu wniosku.',
    'Runtime używa bezpiecznej pochodnej bez JavaScript, akcji i XFA; zachowano 11 pól AcroForm oraz pikselowo i tekstowo identyczny wygląd strony.',
    'Nie należy go automatycznie dodawać do pierwszej kompletnej paczki. Każdy wskazany wnioskodawca składa czytelny podpis.',
    'Rozpoczęcie 21-dniowego terminu decyzji następuje po przyjęciu przez ING uzupełnienia i wskazanych brakujących dokumentów.',
  ],
})

export const ING_LATO_U_SIEBIE_RULES_TEMPLATE = officialIngPdf({
  id: 'ing-lato-u-siebie-rules-2026',
  label: 'ING - regulamin oferty specjalnej Lato u siebie',
  fileName: 'ing-regulamin-lato-u-siebie-2026-sanitized.pdf',
  sha256: 'e564a55b9cf8afbb8062124677985857af1f0e8953c75abdb75adc8d95d72eb9',
  pageCount: 6,
  width: 595.32,
  height: 841.92,
  formKind: 'overlay',
  method: 'pdf_readonly',
  notes: [
    'Regulamin obowiązuje od 20.07.2026 r. do 23.08.2026 r. i dotyczy wyłącznie wybranej oferty Lato u siebie.',
    'Runtime używa odszyfrowanej, statycznej pochodnej bez akcji i XFA; wszystkie 6 stron są pikselowo i tekstowo identyczne z oficjalnym źródłem.',
    'Nie zawiera pól; dołączaj jako pdf_readonly wyłącznie do spraw z tym wariantem oferty.',
  ],
})

export const ING_ENERGY_EFFICIENT_HOME_RULES_TEMPLATE = officialIngPdf({
  id: 'ing-energy-efficient-home-rules-2026',
  label: 'ING - regulamin kredytu hipotecznego na dom energooszczędny',
  fileName: 'ing-regulamin-kredyt-na-dom-energooszczedny-2026-sanitized.pdf',
  sha256: '2f108bc316f927ca4baa29818bfae0ff9b1b16f7087b2779d196aaeb3f2eb4e0',
  pageCount: 7,
  width: 595.32,
  height: 841.92,
  formKind: 'overlay',
  method: 'pdf_readonly',
  notes: [
    'Regulamin obowiązuje od 20.07.2026 r. do 23.08.2026 r. i dotyczy wyłącznie oferty na dom energooszczędny.',
    'Runtime używa odszyfrowanej, statycznej pochodnej bez akcji i XFA; wszystkie 7 stron są pikselowo i tekstowo identyczne z oficjalnym źródłem.',
    'Nie zawiera pól; dołączaj jako pdf_readonly tylko dla spraw spełniających warunki energetyczne oferty.',
  ],
})

/** PDFs that can belong to the initial standard ING application package. */
export const ING_INITIAL_PACKAGE_TEMPLATE_IDS = [
  ING_INCOME_CERTIFICATE_TEMPLATE.id,
  ING_BUSINESS_FORM_TEMPLATE.id,
  ING_GENERAL_MORTGAGE_INFORMATION_TEMPLATE.id,
  ING_APPRAISAL_GUIDELINES_TEMPLATE.id,
  ING_APPRAISER_CONFLICT_STATEMENT_TEMPLATE.id,
] as const

export const ING_TEMPLATES = [
  ING_INCOME_CERTIFICATE_TEMPLATE,
  ING_BUSINESS_FORM_TEMPLATE,
  ING_GENERAL_MORTGAGE_INFORMATION_TEMPLATE,
  ING_APPRAISAL_GUIDELINES_TEMPLATE,
  ING_APPRAISER_CONFLICT_STATEMENT_TEMPLATE,
  ING_APPLICATION_SUPPLEMENT_TEMPLATE,
  ING_LATO_U_SIEBIE_RULES_TEMPLATE,
  ING_ENERGY_EFFICIENT_HOME_RULES_TEMPLATE,
] as const satisfies readonly DocumentTemplate[]
