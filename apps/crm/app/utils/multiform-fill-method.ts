import type {
  MultiformFillMethod,
  MultiformFillMethodKind,
} from '../types/multiform'

export type MultiformFillMethodAvailability = 'supported' | 'not_supported'

export interface MultiformFillMethodPresentation {
  label: string
  availability: MultiformFillMethodAvailability
}

const presentations = {
  pdf_acroform: {
    label: 'Interaktywny PDF',
    availability: 'supported',
  },
  pdf_overlay: {
    label: 'Statyczny PDF',
    availability: 'supported',
  },
  pdf_hybrid: {
    label: 'Hybrydowy PDF',
    availability: 'supported',
  },
  pdf_manual: {
    label: 'PDF do uzupełnienia ręcznie',
    availability: 'supported',
  },
  pdf_readonly: {
    label: 'Dokument informacyjny PDF',
    availability: 'supported',
  },
  xlsx_native: {
    label: 'Edytowalny arkusz XLSX',
    availability: 'supported',
  },
  xlsx_manual: {
    label: 'Arkusz XLSX do uzupełnienia ręcznie',
    availability: 'supported',
  },
  web_form: {
    label: 'Formularz internetowy',
    availability: 'not_supported',
  },
  api: {
    label: 'Integracja API',
    availability: 'not_supported',
  },
} as const satisfies Record<MultiformFillMethodKind, MultiformFillMethodPresentation>

const unknownPresentation: MultiformFillMethodPresentation = {
  label: 'Nieznana metoda',
  availability: 'not_supported',
}

export function multiformFillMethodPresentation(
  method: MultiformFillMethod | null | undefined,
): MultiformFillMethodPresentation {
  return method ? presentations[method.kind] : unknownPresentation
}

export function multiformFillMethodIsSupported(
  method: MultiformFillMethod | null | undefined,
) {
  return multiformFillMethodPresentation(method).availability === 'supported'
}
