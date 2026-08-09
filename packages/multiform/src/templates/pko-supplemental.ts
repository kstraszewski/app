import type { DocumentTemplate } from '../types.ts'

function pages(pageCount: number, width: number, height: number) {
  return Array.from({ length: pageCount }, (_, index) => ({
    page: index + 1,
    mediaBox: { x: 0, y: 0, width, height },
    cropBox: { x: 0, y: 0, width, height },
    rotation: 0 as const,
    userUnit: 1,
  }))
}

function manualTemplate(input: {
  id: string
  label: string
  fileName: string
  sha256: string
  pageCount: number
  width: number
  height: number
  formKind: DocumentTemplate['source']['formKind']
  notes: readonly string[]
  manualUserActionCount: number
  excludedTargetCount?: number
  repeatFor?: DocumentTemplate['repeatFor']
  includeWhen?: DocumentTemplate['includeWhen']
}): DocumentTemplate {
  return {
    schemaVersion: 2,
    id: input.id,
    bank: 'pko-bp',
    label: input.label,
    version: 1,
    fillMethod: { kind: 'pdf_manual' },
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
      manualUserActionCount: input.manualUserActionCount,
      excludedTargetCount: input.excludedTargetCount ?? 0,
      notes: input.notes,
    },
    ...(input.repeatFor ? { repeatFor: input.repeatFor } : {}),
    ...(input.includeWhen ? { includeWhen: input.includeWhen } : {}),
    bindings: [],
  }
}

function readOnlyTemplate(input: {
  id: string
  label: string
  fileName: string
  sha256: string
  pageCount: number
  width?: number
  height?: number
  notes: readonly string[]
  includeWhen?: DocumentTemplate['includeWhen']
}): DocumentTemplate {
  const width = input.width ?? 595.32
  const height = input.height ?? 841.92
  return {
    schemaVersion: 2,
    id: input.id,
    bank: 'pko-bp',
    label: input.label,
    version: 1,
    fillMethod: { kind: 'pdf_readonly' },
    source: {
      fileName: input.fileName,
      sha256: input.sha256,
      pageCount: input.pageCount,
      formKind: 'overlay',
      pages: pages(input.pageCount, width, height),
    },
    coverage: {
      status: 'complete',
      inScopeTargetCount: 0,
      mappedTargetCount: 0,
      manualUserActionCount: 0,
      excludedTargetCount: 0,
      notes: input.notes,
    },
    ...(input.includeWhen ? { includeWhen: input.includeWhen } : {}),
    bindings: [],
  }
}

const PER_APPLICANT = {
  collection: 'applicants',
  templateIndex: 0,
  maxInstances: 4,
  itemLabel: 'Wnioskodawca',
} as const satisfies NonNullable<DocumentTemplate['repeatFor']>

export const PKO_APPLICANT_DATA_TEMPLATE = manualTemplate({
  id: 'pko-bp-applicant-data-2026-05-21',
  label: 'PKO BP / PKO BH - dane wnioskodawcy',
  fileName: 'pko-bp-dane-wnioskodawcy-2026-05-21.pdf',
  sha256: 'b5daf158bdedb93e3e21be1a77e513dd753ef45b9d9f7ce5d07d6fe98bfa6ac9',
  pageCount: 2,
  width: 595.32,
  height: 841.92,
  formKind: 'acroform',
  repeatFor: PER_APPLICANT,
  manualUserActionCount: 2,
  excludedTargetCount: 18,
  notes: [
    'Formularz obowiązuje od 21.05.2026 r. i każdy wnioskodawca wypełnia osobny egzemplarz.',
    'Oficjalny PDF ma 89 nietechnicznych kontrolek AcroForm oraz 18 przycisków technicznych; pełny snapshot pól znajduje się w pko-package-field-audit.json.',
    'Automatyczne mapowanie nie zostało jeszcze zatwierdzone, dlatego plik jest dołączany jako pdf_manual bez pozorowania uzupełnienia.',
    'Wnioskodawca musi wybrać zgody i podpisać formularz; potwierdzenie tożsamości, data wpływu i numer kontraktu należą do pracownika banku lub pośrednika.',
    'Upoważnienie do pozyskania informacji gospodarczych jest ważne 60 dni od dnia udzielenia.',
  ],
})

export const PKO_LIABILITIES_TO_REPAY_TEMPLATE = manualTemplate({
  id: 'pko-bp-liabilities-to-repay-2025-09-30',
  label: 'PKO BP - zobowiązania przewidziane do spłaty',
  fileName: 'pko-bp-zobowiazania-do-splaty-2025-09-30.pdf',
  sha256: 'f7404610c44ad0cafcf4a69977d957c11bdc30f25adc093f7703d3918bb8ed8a',
  pageCount: 1,
  width: 841.6,
  height: 595.2,
  formKind: 'acroform',
  repeatFor: PER_APPLICANT,
  includeWhen: { canonicalKey: 'application.hasLiabilitiesToRepay', equals: 'true' },
  manualUserActionCount: 2,
  excludedTargetCount: 9,
  notes: [
    'Formularz obowiązuje od 30.09.2025 r.; wypełnia go każdy wnioskodawca, którego zobowiązania mają zostać spłacone lub zamknięte.',
    'Załącznik nie dotyczy PKO Banku Hipotecznego, ale pozostaje potrzebny dla równoległego lub zapasowego rozpatrzenia przez PKO BP.',
    'Oficjalny PDF ma 59 nietechnicznych kontrolek AcroForm i 9 przycisków technicznych; do czasu audytu semantycznego działa jako pdf_manual.',
    'Przed zawarciem umowy bank wymaga zaświadczenia wierzyciela o saldzie i zgodzie na wykreślenie hipoteki; dla refinansowania zmiennego oprocentowania także informacji o rodzaju stopy.',
  ],
})

export const PKO_MORTGAGE_PLACE_TEMPLATE = manualTemplate({
  id: 'pko-bp-mortgage-place-2025-05-13',
  label: 'PKO BP - opróżnione miejsce hipoteczne i zabezpieczenie wielu wierzytelności',
  fileName: 'pko-bp-oproznione-miejsce-hipoteczne-2025-05-13.pdf',
  sha256: 'a5e58f1d3469661391da9d01d7d3eb8cd0f465efdbf45b899ccc51f673fecbd1',
  pageCount: 1,
  width: 595.2,
  height: 841.6,
  formKind: 'acroform',
  includeWhen: { canonicalKey: 'property.requiresMortgageDischargeAnnex', equals: 'true' },
  manualUserActionCount: 2,
  excludedTargetCount: 11,
  notes: [
    'Formularz obowiązuje od 13.05.2025 r. i nie dotyczy PKO Banku Hipotecznego.',
    'Stosuje się wyłącznie przy opróżnionym miejscu hipotecznym, zastąpieniu wierzytelności albo zabezpieczeniu wielu wierzytelności jednym wpisem.',
    'Oficjalny PDF ma 31 nietechnicznych kontrolek AcroForm i 11 przycisków technicznych; do czasu audytu semantycznego działa jako pdf_manual.',
    'Wnioskodawcy podpisują część kliencką; dane o aktualnym wpisie, wpływie i numerze kontraktu uzupełnia bank lub pośrednik.',
  ],
})

export const PKO_OWNED_PROPERTIES_TEMPLATE = manualTemplate({
  id: 'pko-bp-owned-properties-2025-05-13',
  label: 'PKO BP / PKO BH - informacja o posiadanych nieruchomościach',
  fileName: 'pko-bp-posiadane-nieruchomosci-2025-05-13.pdf',
  sha256: '4bc0ea6843b97e313fc3777b2ead7d52a6ce0f25d55192b1002e19bf23ee25c3',
  pageCount: 1,
  width: 595.2,
  height: 841.6,
  formKind: 'acroform',
  includeWhen: { canonicalKey: 'application.hasOtherResidentialProperties', equals: 'true' },
  manualUserActionCount: 2,
  excludedTargetCount: 8,
  notes: [
    'Formularz obowiązuje od 13.05.2025 r. i obejmuje do pięciu nieruchomości oraz do czterech wnioskodawców.',
    'Dołącza się go, gdy w załączniku osobowym co najmniej jeden wnioskodawca wskazał inną nieruchomość mieszkalną.',
    'Oficjalny PDF ma 37 nietechnicznych kontrolek AcroForm i 8 przycisków technicznych; do czasu audytu semantycznego działa jako pdf_manual.',
    'Podpisują go wnioskodawcy, których informacja dotyczy; data wpływu, osoba przyjmująca i numer kontraktu są bankowe.',
  ],
})

export const PKO_EMPLOYMENT_CERTIFICATE_TEMPLATE = manualTemplate({
  id: 'pko-bp-employment-certificate-current-2026-08-09',
  label: 'PKO BP / PKO BH - zaświadczenie o zatrudnieniu',
  fileName: 'pko-bp-zaswiadczenie-o-zatrudnieniu-current-2026-08-09.pdf',
  sha256: '3966fb8c94d17fe84eda7447046704b89494360bda3930ae691c19ae336e6674',
  pageCount: 1,
  width: 595.32,
  height: 841.92,
  formKind: 'overlay',
  repeatFor: PER_APPLICANT,
  includeWhen: { canonicalKey: 'applicants.0.employmentEvidenceType', equals: 'employer_certificate' },
  manualUserActionCount: 2,
  notes: [
    'Aktualny plik z oficjalnej strony PKO zweryfikowano 09.08.2026 r.; zaświadczenie jest ważne 30 dni od wystawienia.',
    'Formularz podpisuje pracodawca lub osoba upoważniona, z pieczęcią funkcyjną albo stanowiskiem i kwalifikowanym podpisem elektronicznym.',
    'Dokument jest płaskim PDF-em bez pól i pozostaje pdf_manual; nie należy udawać automatycznego uzupełnienia.',
  ],
})

export const PKO_EMPLOYMENT_DECLARATION_TEMPLATE = manualTemplate({
  id: 'pko-bp-employment-declaration-current-2026-08-09',
  label: 'PKO BP / PKO BH - oświadczenie o zatrudnieniu',
  fileName: 'pko-bp-oswiadczenie-o-zatrudnieniu-current-2026-08-09.pdf',
  sha256: '2a3cb8cdbdaf648c45df1cc53ea66d0d46ecb144946776ab165d80154f42e0f0',
  pageCount: 1,
  width: 595.32,
  height: 841.92,
  formKind: 'overlay',
  repeatFor: PER_APPLICANT,
  includeWhen: { canonicalKey: 'applicants.0.employmentEvidenceType', equals: 'self_declaration' },
  manualUserActionCount: 2,
  notes: [
    'Aktualny plik z oficjalnej strony PKO zweryfikowano 09.08.2026 r.; oświadczenie jest ważne 30 dni od wypełnienia.',
    'PKO podaje obecnie, że przy wnioskowaniu o kredyt hipoteczny oświadczenie może wystarczyć zamiast zaświadczenia pracodawcy.',
    'Wnioskodawca podpisuje dokument i upoważnia oba banki do weryfikacji danych u pracodawcy.',
    'Dokument jest płaskim PDF-em bez pól i pozostaje pdf_manual.',
  ],
})

export const PKO_HOUSE_COST_ESTIMATE_TEMPLATE = manualTemplate({
  id: 'pko-bp-house-cost-estimate-2025-07-31',
  label: 'PKO BP / PKO BH - kosztorys budowy domu jednorodzinnego',
  fileName: 'pko-bp-kosztorys-dom-2025-07-31.pdf',
  sha256: '4a33f74684a4c6ff43337d9718e3db8955bc853af97241658565ecfae6e34b3c',
  pageCount: 2,
  width: 595.32,
  height: 841.92,
  formKind: 'acroform',
  includeWhen: { canonicalKey: 'property.costEstimateType', equals: 'house' },
  manualUserActionCount: 2,
  excludedTargetCount: 14,
  notes: [
    'Formularz obowiązuje od 31.07.2025 r. i obejmuje etapy budowy, koszty poniesione, zaawansowanie, technologie oraz źródła energii i ciepła.',
    'Oficjalny PDF ma 127 nietechnicznych kontrolek AcroForm i 14 przycisków technicznych; do czasu audytu semantycznego działa jako pdf_manual.',
    'Podpisy wnioskodawców są wymagane na wersji papierowej; przy dodaniu kosztorysu w iPKO bank wskazuje, że podpis nie jest konieczny.',
  ],
})

export const PKO_APARTMENT_COST_ESTIMATE_TEMPLATE = manualTemplate({
  id: 'pko-bp-apartment-cost-estimate-2024-04-15',
  label: 'PKO BP / PKO BH - kosztorys lokalu mieszkalnego',
  fileName: 'pko-bp-kosztorys-lokal-2024-04-15.pdf',
  sha256: '35ca51628d55bb1b385e1e210e3150aca6683863c568fe0bc294349d80678a7e',
  pageCount: 1,
  width: 595.32,
  height: 841.92,
  formKind: 'acroform',
  includeWhen: { canonicalKey: 'property.costEstimateType', equals: 'apartment' },
  manualUserActionCount: 2,
  excludedTargetCount: 12,
  notes: [
    'Formularz obowiązuje od 15.04.2024 r. i obejmuje zakres oraz koszt prac wykończeniowych, źródła energii i ciepła.',
    'Oficjalny PDF ma 51 nietechnicznych kontrolek AcroForm i 12 przycisków technicznych; do czasu audytu semantycznego działa jako pdf_manual.',
    'Podpisy wnioskodawców są wymagane na wersji papierowej; przy dodaniu kosztorysu w iPKO bank wskazuje, że podpis nie jest konieczny.',
  ],
})

export const PKO_RISK_INFORMATION_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-risk-information-current-2026-08-09',
  label: 'PKO BP / PKO BH - informacja o ryzyku stopy procentowej i cen nieruchomości',
  fileName: 'pko-bp-informacja-o-ryzyku-current-2026-08-09.pdf',
  sha256: '27ad72da6380e7c1177c0696c1a415ab55a1f0e7c48699ddf7dadc672000b3a5',
  pageCount: 6,
  notes: [
    'Aktualny dokument wspólny dla PKO BP i PKO BH zweryfikowano na oficjalnej stronie 09.08.2026 r.',
    'Nie zawiera pól do uzupełnienia; jest materiałem do doręczenia klientowi i trafia do paczki jako pdf_readonly.',
  ],
})

export const PKO_BP_GENERAL_INFORMATION_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-general-mortgage-information-current-2026-08-09',
  label: 'PKO BP - informacje ogólne o kredycie lub pożyczce hipotecznej',
  fileName: 'pko-bp-informacje-ogolne-current-2026-08-09.pdf',
  sha256: '82654df4021c207f5179ec5c01c5721fb0671a348c406ba09c1be2d31dce1383',
  pageCount: 7,
  notes: [
    'Aktualny dokument PKO BP zweryfikowano na oficjalnej stronie 09.08.2026 r.',
    'Nie zawiera pól do uzupełnienia i trafia do paczki jako pdf_readonly.',
    'Opisuje między innymi zasady bankowej oceny wartości: klient nie musi dostarczać operatu, a bank zleca go na własny koszt w przypadkach progowych.',
  ],
})

export const PKO_BH_GENERAL_INFORMATION_TEMPLATE = readOnlyTemplate({
  id: 'pko-bh-general-mortgage-information-current-2026-08-09',
  label: 'PKO Bank Hipoteczny - informacje ogólne o kredycie hipotecznym',
  fileName: 'pko-bh-informacje-ogolne-current-2026-08-09.pdf',
  sha256: '26e0da5b05a378e11d7c78265334e8ad1616cf3ddea6a0706b32f35f5f4b1a86',
  pageCount: 6,
  includeWhen: { canonicalKey: 'loan.pkoRoute', equals: 'dual_pko_bh_first' },
  notes: [
    'PKO BP przekazuje standardowy wniosek Własny Kąt najpierw do PKO Banku Hipotecznego; dla tej ścieżki dołączany jest również dokument informacyjny PKO BH.',
    'PKO BH nie wymaga od klienta operatu: wycena opiera się na ekspertyzie bankowo-hipotecznej wykonywanej przez bank.',
    'Dokument nie zawiera pól do uzupełnienia i trafia do paczki jako pdf_readonly.',
  ],
})

export const PKO_BENCHMARK_FALLBACK_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-benchmark-fallback-current-2026-08-09',
  label: 'PKO BP - plan awaryjny wskaźnika referencyjnego',
  fileName: 'pko-bp-plan-awaryjny-wskaznika-current-2026-08-09.pdf',
  sha256: '5a611397f635503511129610ed42fda2df363ac6d83ed521e4b12d5fc420bc36',
  pageCount: 2,
  notes: [
    'Aktualny dokument PKO BP zweryfikowano na oficjalnej stronie 09.08.2026 r.',
    'Dotyczy zarówno oprocentowania zmiennego, jak i okresowo stałego po przejściu na stopę opartą o wskaźnik; jest pdf_readonly.',
  ],
})

export const PKO_BH_BENCHMARK_FALLBACK_TEMPLATE = readOnlyTemplate({
  id: 'pko-bh-benchmark-fallback-current-2026-08-09',
  label: 'PKO Bank Hipoteczny - plan awaryjny wskaźnika referencyjnego',
  fileName: 'pko-bh-plan-awaryjny-wskaznika-current-2026-08-09.pdf',
  sha256: '458493c0d23732f9a4ca241f614e44e809cfd438309c981ee8518345cab4066f',
  pageCount: 2,
  includeWhen: { canonicalKey: 'loan.pkoRoute', equals: 'dual_pko_bh_first' },
  notes: [
    'Aktualny dokument PKO Banku Hipotecznego zweryfikowano na oficjalnej stronie 09.08.2026 r.',
    'To odrębna treść prawna od planu PKO BP: wskazuje działania i kanały informacyjne PKO Banku Hipotecznego.',
    'Nie zawiera pól i trafia do paczki jako pdf_readonly tylko w ścieżce Własnego Kąta rozpatrywanej najpierw przez PKO BH.',
  ],
})

export const PKO_INTEREST_TYPES_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-interest-types-current-2026-08-09',
  label: 'PKO BP / PKO BH - uproszczona informacja o rodzajach oprocentowania',
  fileName: 'pko-bp-uproszczona-informacja-oprocentowanie-current-2026-08-09.pdf',
  sha256: '81b46852ed838bf51e5c20cf73be0a590943e39aeaa395e5827f863038109f2f',
  pageCount: 1,
  notes: [
    'Aktualny dokument zweryfikowano na oficjalnej stronie 09.08.2026 r.',
    'Nie zawiera pól i służy do porównania oprocentowania zmiennego z okresowo stałym; jest pdf_readonly.',
  ],
})

export const PKO_FIXED_RATE_INFORMATION_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-fixed-rate-information-current-2026-08-09',
  label: 'PKO BP / PKO BH - informacja o stałej stopie procentowej',
  fileName: 'pko-bp-informacja-stala-stopa-current-2026-08-09.pdf',
  sha256: '183a737b24cbd2b7ef233225bdf29811fb6e767311e895dce8303e1bd543731e',
  pageCount: 2,
  includeWhen: { canonicalKey: 'loan.interestType', equals: 'periodically_fixed' },
  notes: [
    'Aktualny dokument zweryfikowano na oficjalnej stronie 09.08.2026 r.',
    'Dołącza się go przy wyborze stałej stopy w początkowym pięcioletnim okresie; jest pdf_readonly.',
  ],
})

export const PKO_RKM_ELIGIBILITY_DECLARATION_TEMPLATE = manualTemplate({
  id: 'pko-bp-rkm-eligibility-declaration-2026-07-10',
  label: 'PKO BP - RKM: oświadczenie o spełnieniu warunków ustawy',
  fileName: 'pko-bp-rkm-oswiadczenie-warunki-2026-07-10.pdf',
  sha256: 'de170d199f629085251c32af1ee5740fffc45cf278c8c088b5c8a843265d763e',
  pageCount: 7,
  width: 595.32,
  height: 841.92,
  formKind: 'overlay',
  repeatFor: PER_APPLICANT,
  includeWhen: { canonicalKey: 'loan.program', equals: 'rkm' },
  manualUserActionCount: 2,
  notes: [
    'Aktualną rewizję oficjalnego dokumentu zweryfikowano 09.08.2026 r.; metadane PDF wskazują 10.07.2026 r.',
    'Każda osoba ubiegająca się o RKM składa własne oświadczenie i podpisuje je pod rygorem odpowiedzialności za fałszywe dane.',
    'Dokument jest płaskim PDF-em bez pól, obejmuje warunki ustawowe, zgody BGK i klauzule informacyjne; pozostaje pdf_manual.',
  ],
})

export const PKO_RKM_FAMILY_REPAYMENT_CONDITIONS_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-rkm-family-repayment-conditions-2026-07-10',
  label: 'PKO BP - RKM: warunki kredytu i spłaty rodzinnej',
  fileName: 'pko-bp-rkm-warunki-splaty-rodzinnej-2026-07-10.pdf',
  sha256: 'e949d89c84f4741f12447c4c2641a2b736b4466459a60eb7e5d9ded1f78bcccc',
  pageCount: 13,
  height: 842.04,
  includeWhen: { canonicalKey: 'loan.program', equals: 'rkm' },
  notes: [
    'Oficjalne warunki RKM i spłaty rodzinnej, rewizja PDF z 10.07.2026 r.',
    'Dokument jest załącznikiem do oświadczenia ustawowego, nie ma pól i trafia do paczki jako pdf_readonly.',
  ],
})

export const PKO_RKM_GUARANTEE_CONDITIONS_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-rkm-guarantee-conditions-2026-07-10',
  label: 'PKO BP - RKM: warunki gwarancji spłaty BGK',
  fileName: 'pko-bp-rkm-warunki-gwarancji-bgk-2026-07-10.pdf',
  sha256: 'f3d19b0ec95e7dc5825c01f1ce440beae96da7352704005bac03a2b92c5ed4a3',
  pageCount: 8,
  height: 842.04,
  includeWhen: { canonicalKey: 'loan.rkmGuarantee', equals: 'true' },
  notes: [
    'Oficjalne warunki gwarancji spłaty RKM, rewizja PDF z 10.07.2026 r.',
    'Dokument nie ma pól i trafia do paczki jako pdf_readonly wyłącznie, gdy klient korzysta z gwarancji BGK.',
  ],
})

export const PKO_RKM_GUARANTEE_APPLICATION_TEMPLATE = manualTemplate({
  id: 'pko-bp-rkm-guarantee-application-current-2026-08-09',
  label: 'PKO BP - RKM: wniosek o gwarancję spłaty BGK',
  fileName: 'pko-bp-rkm-wniosek-gwarancja-bgk-current-2026-08-09.pdf',
  sha256: 'df0b01606b5c5badf387610acd31e40e071fd2d43239076c761e42f0d1adad6a',
  pageCount: 3,
  width: 595.32,
  height: 841.92,
  formKind: 'overlay',
  includeWhen: { canonicalKey: 'loan.rkmGuarantee', equals: 'true' },
  manualUserActionCount: 2,
  notes: [
    'Aktualny oficjalny wniosek BGK zweryfikowano 09.08.2026 r.',
    'Wniosek obejmuje wszystkich kredytobiorców, parametry kredytu, wkład własny, kwotę i okres gwarancji oraz podpisy wnioskodawców.',
    'Dokument jest płaskim PDF-em bez pól i pozostaje pdf_manual; warunki końcowe może zmienić decyzja kredytowa banku.',
  ],
})

export const PKO_RKM_POST_CONTRACT_REPAYMENT_TEMPLATE = manualTemplate({
  id: 'pko-bp-rkm-post-contract-family-repayment-2026-07-10',
  label: 'PKO BP - RKM: zlecenie spłaty rodzinnej po uruchomieniu kredytu',
  fileName: 'pko-bp-rkm-zlecenie-splaty-rodzinnej-2026-07-10.pdf',
  sha256: 'b85deb6fd61d69def2f0919c991bfea9e40b72aa29656d361607b56a666d47c9',
  pageCount: 2,
  width: 595.32,
  height: 841.92,
  formKind: 'overlay',
  includeWhen: { canonicalKey: 'postContract.familyRepaymentRequested', equals: 'true' },
  manualUserActionCount: 2,
  notes: [
    'Dokument z rewizji 10.07.2026 r. nie jest częścią kompletu składanego z pierwotnym wnioskiem kredytowym.',
    'Jest dostępny dopiero po uruchomieniu RKM, gdy wystąpi zdarzenie uprawniające do spłaty rodzinnej; pozostaje pdf_manual.',
  ],
})

/**
 * The digital mortgage is a separate, bank-owned application route. These
 * information documents are intentionally exported separately from the
 * adviser/paper package so that a case never receives both document sets.
 * The application itself remains a web_form/manual bank action rather than a
 * synthetic local PDF.
 */
export const PKO_DIGITAL_RISK_INFORMATION_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-digital-risk-information-current-2026-08-09',
  label: 'PKO BP - Cyfrowy Kredyt Hipoteczny: informacja o ryzyku',
  fileName: 'pko-bp-cyfrowy-informacja-o-ryzyku-current-2026-08-09.pdf',
  sha256: 'f592fb6113ea435bfc7e0928df70ebc27607ea517095f8bf0b727fdd3e8297b5',
  pageCount: 6,
  notes: [
    'Dokument opublikowany wyłącznie dla bankowego procesu Cyfrowego Kredytu Hipotecznego; zweryfikowany 09.08.2026 r.',
    'Nie zawiera pól i trafia do cyfrowej paczki informacyjnej jako pdf_readonly.',
  ],
})

export const PKO_DIGITAL_FIXED_RATE_INFORMATION_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-digital-fixed-rate-information-current-2026-08-09',
  label: 'PKO BP - Cyfrowy Kredyt Hipoteczny: informacja o stałej stopie',
  fileName: 'pko-bp-cyfrowy-informacja-stala-stopa-current-2026-08-09.pdf',
  sha256: 'e57a87263a47dabfd2c145c8c0a82b5e0b8ad78df1ce59e5f3b7156417d3421d',
  pageCount: 1,
  includeWhen: { canonicalKey: 'loan.interestType', equals: 'periodically_fixed' },
  notes: [
    'Dokument opublikowany wyłącznie dla bankowego procesu Cyfrowego Kredytu Hipotecznego; zweryfikowany 09.08.2026 r.',
    'Nie zawiera pól i jest pdf_readonly.',
  ],
})

export const PKO_DIGITAL_INTEREST_TYPES_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-digital-interest-types-current-2026-08-09',
  label: 'PKO BP - Cyfrowy Kredyt Hipoteczny: uproszczona informacja o oprocentowaniu',
  fileName: 'pko-bp-cyfrowy-uproszczona-informacja-oprocentowanie-current-2026-08-09.pdf',
  sha256: '685a7498c5be908dbf81e6be03640d765e9c22acc8edd3869621eb945f76e614',
  pageCount: 1,
  notes: [
    'Dokument opublikowany wyłącznie dla bankowego procesu Cyfrowego Kredytu Hipotecznego; zweryfikowany 09.08.2026 r.',
    'Nie zawiera pól i jest pdf_readonly.',
  ],
})

export const PKO_DIGITAL_GENERAL_INFORMATION_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-digital-general-information-2026-07-23',
  label: 'PKO BP - informacje ogólne o Cyfrowym Kredycie Hipotecznym',
  fileName: 'pko-bp-cyfrowy-informacje-ogolne-current-2026-08-09.pdf',
  sha256: 'dbc22871141de92b32eca8ad3767d88e85848f92452cd743be15b16773429b55',
  pageCount: 5,
  notes: [
    'Oficjalny PDF ma datę modyfikacji 23.07.2026 r. i dotyczy wyłącznie Cyfrowego Kredytu Hipotecznego.',
    'Nie zawiera pól i jest pdf_readonly.',
  ],
})

export const PKO_DIGITAL_BENCHMARK_FALLBACK_TEMPLATE = readOnlyTemplate({
  id: 'pko-bp-digital-benchmark-fallback-current-2026-08-09',
  label: 'PKO BP - Cyfrowy Kredyt Hipoteczny: plan awaryjny wskaźnika',
  fileName: 'pko-bp-cyfrowy-plan-awaryjny-wskaznika-current-2026-08-09.pdf',
  sha256: '64bb31541ced22f6c0cf136e926ce492ddb8f421d8ad9ae353ec109c934fe23e',
  pageCount: 2,
  notes: [
    'Dokument opublikowany wyłącznie dla bankowego procesu Cyfrowego Kredytu Hipotecznego; zweryfikowany 09.08.2026 r.',
    'Nie zawiera pól i jest pdf_readonly.',
  ],
})

export const PKO_SUPPLEMENTAL_APPLICATION_TEMPLATES = [
  PKO_APPLICANT_DATA_TEMPLATE,
  PKO_LIABILITIES_TO_REPAY_TEMPLATE,
  PKO_MORTGAGE_PLACE_TEMPLATE,
  PKO_OWNED_PROPERTIES_TEMPLATE,
  PKO_EMPLOYMENT_CERTIFICATE_TEMPLATE,
  PKO_EMPLOYMENT_DECLARATION_TEMPLATE,
  PKO_HOUSE_COST_ESTIMATE_TEMPLATE,
  PKO_APARTMENT_COST_ESTIMATE_TEMPLATE,
  PKO_RISK_INFORMATION_TEMPLATE,
  PKO_BP_GENERAL_INFORMATION_TEMPLATE,
  PKO_BH_GENERAL_INFORMATION_TEMPLATE,
  PKO_BENCHMARK_FALLBACK_TEMPLATE,
  PKO_BH_BENCHMARK_FALLBACK_TEMPLATE,
  PKO_INTEREST_TYPES_TEMPLATE,
  PKO_FIXED_RATE_INFORMATION_TEMPLATE,
  PKO_RKM_ELIGIBILITY_DECLARATION_TEMPLATE,
  PKO_RKM_FAMILY_REPAYMENT_CONDITIONS_TEMPLATE,
  PKO_RKM_GUARANTEE_CONDITIONS_TEMPLATE,
  PKO_RKM_GUARANTEE_APPLICATION_TEMPLATE,
] as const satisfies readonly DocumentTemplate[]

export const PKO_POST_CONTRACT_TEMPLATES = [
  PKO_RKM_POST_CONTRACT_REPAYMENT_TEMPLATE,
] as const satisfies readonly DocumentTemplate[]

export const PKO_DIGITAL_INFORMATION_TEMPLATES = [
  PKO_DIGITAL_RISK_INFORMATION_TEMPLATE,
  PKO_DIGITAL_FIXED_RATE_INFORMATION_TEMPLATE,
  PKO_DIGITAL_INTEREST_TYPES_TEMPLATE,
  PKO_DIGITAL_GENERAL_INFORMATION_TEMPLATE,
  PKO_DIGITAL_BENCHMARK_FALLBACK_TEMPLATE,
] as const satisfies readonly DocumentTemplate[]
