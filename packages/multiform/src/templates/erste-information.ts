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

function informationalTemplate(input: {
  id: string
  label: string
  fileName: string
  sha256: string
  pageCount: number
  width: number
  height: number
  notes: readonly string[]
  includeWhen?: DocumentTemplate['includeWhen']
  manualUserActionCount?: number
}): DocumentTemplate {
  return {
    schemaVersion: 2,
    id: input.id,
    bank: 'erste',
    label: input.label,
    version: 1,
    fillMethod: { kind: 'pdf_overlay' },
    source: {
      fileName: input.fileName,
      sha256: input.sha256,
      pageCount: input.pageCount,
      formKind: 'overlay',
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
    ...(input.includeWhen ? { includeWhen: input.includeWhen } : {}),
    overlayOrigin: 'top-left',
    bindings: [],
  }
}

export const ERSTE_RISK_COST_INFORMATION_TEMPLATE = informationalTemplate({
  id: 'erste-risk-cost-information-2026',
  label: 'Erste — informacja o ryzykach i kosztach kredytu hipotecznego',
  fileName: 'erste-informacja-o-ryzykach-i-kosztach-kredytu-hipotecznego-2026-06-08.pdf',
  sha256: '689dd31ea190130d7ba88aa4965c84433b29137f4cc846fddc3db749e6701756',
  pageCount: 14,
  width: 596.664567,
  height: 840.472441,
  notes: [
    'Oficjalny dokument informacyjny obowiązujący od 08.06.2026 r.',
    'Plik nie zawiera aktywnych pól klienta; do paczki trafia w niezmienionej treści po sanitizacji PDF.',
    'Potwierdzenie przekazania dokumentu klientom jest śledzone osobno przez manifest gotowości.',
  ],
})

export const ERSTE_GENERAL_MORTGAGE_INFORMATION_TEMPLATE = informationalTemplate({
  id: 'erste-general-mortgage-information-2026',
  label: 'Erste — informacja ogólna o zasadach kredytów hipotecznych',
  fileName: 'erste-informacja-ogolna-kredyty-hipoteczne-2026-07-18.pdf',
  sha256: 'f974c17bdfe62b1e4639fcadfd06a5e07f3d82e2c65ed0986bf15ead9fb7ea90',
  pageCount: 20,
  width: 596.891339,
  height: 840.585827,
  notes: [
    'Oficjalny dokument informacyjny obowiązujący od 18.07.2026 r.',
    'Dokument nie ma pól do uzupełnienia i jest dołączany raz do kompletu sprawy.',
  ],
})

export const ERSTE_RKM_GUARANTEE_TEMPLATE = informationalTemplate({
  id: 'erste-rkm-guarantee-conditions-2026',
  label: 'Erste — RKM: warunki gwarancji spłaty BGK',
  fileName: 'erste-rkm-warunki-gwarancji-splaty-2026-07-06.pdf',
  sha256: 'a84216986d4cc957f44811de79cc72c7c15af2d65c5ac072b5b10f2e28091787',
  pageCount: 8,
  width: 595.32,
  height: 842.04,
  includeWhen: { canonicalKey: 'loan.rkmGuarantee', equals: 'true' },
  manualUserActionCount: 4,
  notes: [
    'Dokument jest dołączany wyłącznie, gdy RKM korzysta z gwarancji spłaty BGK.',
    'Podpisy wnioskodawców pozostają czynnościami ręcznymi śledzonymi przez manifest gotowości.',
  ],
})

export const ERSTE_RKM_FAMILY_CONDITIONS_TEMPLATE = informationalTemplate({
  id: 'erste-rkm-family-conditions-2026',
  label: 'Erste — RKM: warunki kredytu i spłaty rodzinnej',
  fileName: 'erste-rkm-warunki-kredytu-i-splaty-2026-07-06.pdf',
  sha256: '57ddb5687a037cdc9b6c97eff92b6ca2b7c431c383cfec3f8cdd40d3f4ee3dfe',
  pageCount: 13,
  width: 595.32,
  height: 842.04,
  includeWhen: { canonicalKey: 'loan.program', equals: 'rkm' },
  manualUserActionCount: 4,
  notes: [
    'Dokument jest dołączany wyłącznie dla Rodzinnego Kredytu Mieszkaniowego.',
    'Podpisy wnioskodawców pozostają czynnościami ręcznymi śledzonymi przez manifest gotowości.',
  ],
})

export const ERSTE_INFORMATION_TEMPLATES = [
  ERSTE_RISK_COST_INFORMATION_TEMPLATE,
  ERSTE_GENERAL_MORTGAGE_INFORMATION_TEMPLATE,
  ERSTE_RKM_GUARANTEE_TEMPLATE,
  ERSTE_RKM_FAMILY_CONDITIONS_TEMPLATE,
] as const satisfies readonly DocumentTemplate[]
