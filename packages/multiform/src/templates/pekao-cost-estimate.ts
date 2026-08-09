import type {
  DocumentTemplate,
  TemplateBinding,
  XlsxCellTarget,
  XlsxCellValueType,
} from '../types.ts'

const SHEET = 'kosztorys'

function cell(
  cellAddress: string,
  styleIndex: number,
  valueType: XlsxCellValueType,
  options: {
    unlocked?: boolean
    valueMap?: Readonly<Record<string, string | number | boolean>>
  } = {},
): XlsxCellTarget {
  return {
    kind: 'xlsx_cell',
    sheet: SHEET,
    cell: cellAddress,
    valueType,
    ...(options.valueMap ? { valueMap: options.valueMap } : {}),
    expected: {
      styleIndex,
      unlocked: options.unlocked ?? true,
      formula: false,
    },
  }
}

const ready = (binding: Omit<TemplateBinding, 'reviewStatus'>): TemplateBinding => ({
  ...binding,
  reviewStatus: 'ready',
})

const PROPERTY_TYPE_MAP = {
  apartment: 'Lokal mieszkalny',
  house: 'Dom jednorodzinny',
  multi_family_building: 'Dom z częścią usługową',
  recreational_plot: 'Dom letniskowy całoroczny',
} as const

const PURPOSE_MAP = {
  finishing: 'Prace wykończeniowe',
  renovation: 'Remont',
  family_renovation: 'Remont',
  purchase_with_renovation: 'Remont',
  construction: 'Budowa',
  family_construction: 'Budowa',
  extension: 'Przebudowa/Rozbudowa/Nadbudowa',
  conversion_to_residential: 'Przebudowa/Rozbudowa/Nadbudowa',
  adaptation_to_residential: 'Przebudowa/Rozbudowa/Nadbudowa',
} as const

const VOIVODESHIP_MAP = {
  dolnośląskie: 'dolnośląskie',
  kujawsko_pomorskie: 'kujawsko-pomorskie',
  'kujawsko-pomorskie': 'kujawsko-pomorskie',
  lubelskie: 'lubelskie',
  lubuskie: 'lubuskie',
  łódzkie: 'łódzkie',
  małopolskie: 'małopolskie',
  mazowieckie: 'mazowieckie',
  opolskie: 'opolskie',
  podkarpackie: 'podkarpackie',
  podlaskie: 'podlaskie',
  pomorskie: 'pomorskie',
  śląskie: 'śląśkie',
  świętokrzyskie: 'świętokrzystkie',
  warmińsko_mazurskie: 'warmińsko-mazurskie',
  'warmińsko-mazurskie': 'warmińsko-mazurskie',
  wielkopolskie: 'wielkopolskie',
  zachodniopomorskie: 'zachodniopomorskie',
} as const

const BINDINGS: TemplateBinding[] = [
  ready({
    canonicalKey: 'applicants.0.fullName',
    computed: true,
    valueFrom: ['applicants.0.firstName', 'applicants.0.lastName'],
    valueFormat: 'fullName',
    target: cell('F3', 245, 'string'),
  }),
  ready({
    canonicalKey: 'property.type',
    target: cell('J3', 65, 'string', { valueMap: PROPERTY_TYPE_MAP }),
  }),
  ready({ canonicalKey: 'property.usableArea', target: cell('F4', 119, 'number') }),
  ready({
    canonicalKey: 'loan.purpose',
    target: cell('H4', 250, 'string', { valueMap: PURPOSE_MAP }),
  }),
  ready({ canonicalKey: 'property.address.postalCode', target: cell('E5', 66, 'string') }),
  ready({
    canonicalKey: 'property.address.voivodeship',
    target: cell('G5', 67, 'string', { valueMap: VOIVODESHIP_MAP }),
  }),
  ready({ canonicalKey: 'property.address.city', target: cell('I5', 167, 'string') }),
  ready({
    canonicalKey: 'property.address.streetHouseAndUnit',
    computed: true,
    valueFrom: [
      'property.address.street',
      'property.address.houseNumber',
      'property.address.unitNumber',
    ],
    valueFormat: 'streetHouseAndUnit',
    target: cell('J5', 168, 'string'),
  }),
  ready({
    canonicalKey: 'property.hasBasement',
    condition: { canonicalKey: 'property.type', equals: ['house', 'multi_family_building'] },
    target: cell('F6', 68, 'string', { valueMap: { true: 'TAK', false: 'NIE' } }),
  }),
  ready({
    canonicalKey: 'property.buildingFootprintArea',
    condition: { canonicalKey: 'property.type', equals: ['house', 'multi_family_building'] },
    target: cell('H6', 68, 'number'),
  }),
  ready({
    canonicalKey: 'property.totalArea',
    condition: { canonicalKey: 'property.type', equals: ['house', 'multi_family_building'] },
    target: cell('J6', 68, 'number'),
  }),
  ready({
    canonicalKey: 'property.targetFinishStandard',
    condition: { canonicalKey: 'property.type', equals: 'apartment' },
    target: cell('F7', 68, 'string', {
      valueMap: {
        developer: 'Deweloperski',
        standard: 'Średni',
        enhanced: 'Podwyższony',
        high: 'Wysoki',
      },
    }),
  }),
  ready({
    canonicalKey: 'property.aboveGroundFloors',
    condition: { canonicalKey: 'property.type', equals: ['house', 'multi_family_building'] },
    target: cell('H7', 68, 'number'),
  }),
  ready({
    canonicalKey: 'property.buildingForm',
    condition: { canonicalKey: 'property.type', equals: ['house', 'multi_family_building'] },
    target: cell('J7', 67, 'string', {
      valueMap: {
        detached: 'wolnostojąca',
        semi_detached: 'bliźniacza',
        terraced: 'szeregowa',
      },
    }),
  }),
  ready({ canonicalKey: 'loan.amount', target: cell('J10', 69, 'number') }),
  ready({ canonicalKey: 'property.preWorksValue', target: cell('H70', 118, 'number') }),
  ready({ canonicalKey: 'investment.completionDate', target: cell('H74', 127, 'date') }),
  ...Array.from({ length: 6 }, (_, index) => {
    const row = 77 + index
    const condition = { canonicalKey: 'loan.disbursementType', equals: 'tranches' } as const
    return [
      ready({
        canonicalKey: `tranches.${index}.ownFundsBeforeDisbursement`,
        condition,
        target: cell(`G${row}`, 12, 'number', { unlocked: true }),
      }),
      ready({
        canonicalKey: `tranches.${index}.date`,
        condition,
        target: cell(`H${row}`, 13, 'date', { unlocked: true }),
      }),
      ready({
        canonicalKey: `tranches.${index}.amount`,
        condition,
        target: cell(`I${row}`, 14, 'number', { unlocked: true }),
      }),
    ]
  }).flat(),
]

export const PEKAO_CONSTRUCTION_COST_ESTIMATE_TEMPLATE: DocumentTemplate = {
  schemaVersion: 2,
  id: 'pekao-construction-cost-estimate-2026',
  bank: 'pekao',
  label: 'Kosztorys budowlano-remontowy Pekao',
  version: 1,
  fillMethod: { kind: 'xlsx_native' },
  source: {
    fileName: 'pekao-kosztorys-budowlano-remontowy-2026-03-05.xlsx',
    sha256: '0ace4ee3caada4b266e5babb0bdf7959a6af7d662dbe68ca95aeb20716ca6dfb',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pageCount: 0,
    formKind: 'overlay',
    pages: [],
    workbook: {
      sheets: [
        { name: 'kosztorys', state: 'visible' },
        { name: 'Zasady wypełniania formularza', state: 'visible' },
        { name: 'Wyliczenia', state: 'hidden' },
      ],
      formulaCellCount: 455,
      structureProtected: true,
    },
  },
  includeWhen: {
    canonicalKey: 'loan.purpose',
    equals: [
      'construction',
      'family_construction',
      'renovation',
      'family_renovation',
      'finishing',
      'extension',
      'conversion_to_residential',
      'adaptation_to_residential',
      'purchase_with_renovation',
    ],
  },
  requiredCanonicalKeys: [
    'applicants.0.firstName',
    'applicants.0.lastName',
    'property.type',
    'property.usableArea',
    'loan.purpose',
    'property.address.postalCode',
    'property.address.voivodeship',
    'property.address.city',
    'property.address.street',
    'loan.amount',
    'property.preWorksValue',
    'investment.completionDate',
  ],
  coverage: {
    status: 'complete',
    inScopeTargetCount: BINDINGS.length,
    mappedTargetCount: BINDINGS.length,
    manualUserActionCount: 1,
    excludedTargetCount: 455,
    notes: [
      'Silnik wpisuje dane wspólne i harmonogram transz do zatwierdzonych komórek oficjalnego XLSX.',
      'Formuły, walidacje, style, ukryty arkusz obliczeniowy i ochrona skoroszytu pozostają zachowane.',
      'Ekspert uzupełnia ręcznie szczegółowe pozycje robót i kosztów zależne od inwestycji.',
    ],
  },
  bindings: BINDINGS,
}
