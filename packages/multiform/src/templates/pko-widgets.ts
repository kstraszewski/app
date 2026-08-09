import type {
  AcroFormTarget,
  PdfMarkAppearance,
  PdfTextAppearance,
} from '../types.ts'

type TextAlignment = 'left' | 'center' | 'right'
type TextWidgetTuple = readonly [
  field: string,
  page: number,
  x: number,
  y: number,
  width: number,
  height: number,
  alignment: TextAlignment,
  comb: boolean,
  maxLength?: number,
]

type CheckboxWidgetTuple = readonly [
  field: string,
  page: number,
  x: number,
  y: number,
  width: number,
  height: number,
  exportValue: string,
]

const TEXT_WIDGETS = [
  ['imie1', 1, 83.34, 551.34, 140.03, 16.72, 'left', false],
  ['nazwisko1', 1, 224.22, 551.34, 154.77, 16.72, 'left', false],
  ['pesel1', 1, 380.13, 551.34, 147.97, 16.72, 'left', true, 11],
  ['imie2', 1, 83.34, 533.76, 140.03, 16.44, 'left', false],
  ['nazwisko2', 1, 224.22, 533.76, 154.77, 16.44, 'left', false],
  ['pesel2', 1, 380.13, 533.76, 147.97, 16.44, 'left', true, 11],
  ['imie3', 1, 83.34, 516.19, 140.03, 16.44, 'left', false],
  ['nazwisko3', 1, 224.22, 516.19, 154.77, 16.44, 'left', false],
  ['pesel3', 1, 380.13, 516.19, 147.97, 16.44, 'left', true, 11],
  ['imie4', 1, 83.34, 499.18, 140.03, 16.16, 'left', false],
  ['nazwisko4', 1, 224.22, 499.18, 154.77, 16.16, 'left', false],
  ['pesel4', 1, 380.13, 499.18, 147.97, 16.16, 'left', true, 11],
  ['nabycie_koszt', 1, 362.55, 452.69, 89.57, 14.17, 'right', false],
  ['nabycie_kredyt', 1, 468.85, 452.69, 89.29, 14.17, 'right', false],
  ['wykonczenie_koszt', 1, 362.55, 436.25, 89.57, 14.17, 'right', false],
  ['wykonczenie_kredyt', 1, 468.85, 436.25, 89.29, 14.17, 'right', false],
  ['budowa_koszt', 1, 362.55, 419.24, 89.57, 14.17, 'right', false],
  ['budowa_kredyt', 1, 468.85, 419.24, 89.29, 14.17, 'right', false],
  ['przebudowa_koszt', 1, 362.55, 402.52, 89.57, 14.17, 'right', false],
  ['przebudowa_kredyt', 1, 468.85, 402.52, 89.29, 14.17, 'right', false],
  ['inny_cel_opis', 1, 121.89, 384.66, 233.29, 14.17, 'left', false],
  ['inny_cel_koszt', 1, 362.55, 384.66, 89.57, 14.17, 'right', false],
  ['inny_cel_kredyt', 1, 468.85, 384.66, 89.29, 14.17, 'right', false],
  ['razem_koszt', 1, 362.55, 360.85, 89.57, 14.17, 'right', false],
  ['razem_kredyt', 1, 468.85, 360.85, 89.29, 14.17, 'right', false],
  ['refinansowanie_kredyt', 1, 468.85, 341.57, 89.29, 14.17, 'right', false],
  ['splata_zobowiazan_kredyt', 1, 468.85, 324.28, 89.29, 14.17, 'right', false],
  ['pozyczka_kredyt', 1, 468.85, 307.28, 89.29, 14.17, 'right', false],
  ['pierwsza_transza_kredyt', 1, 477.64, 290.27, 80.5, 14.17, 'right', false],
  ['wnioskowany_kredyt', 1, 468.85, 273.54, 89.29, 14.17, 'right', false],
  ['wlasne_zaangazowane', 1, 202.39, 236.98, 60.94, 14.17, 'right', false],
  ['wartosci_dzialki', 1, 342.43, 236.98, 61.23, 14.17, 'right', false],
  ['wlasne_razem', 1, 468.85, 236.98, 89.29, 14.17, 'right', false],
  ['wlasne_do_wniesienia_razem', 1, 412.16, 206.36, 145.99, 14.17, 'right', false],
  ['wlasne_do_wniesienia_przed', 1, 412.16, 189.64, 145.99, 14.17, 'right', false],
  ['wlasne_do_wniesienia_po', 1, 412.16, 172.91, 145.99, 14.17, 'right', false],
  ['nadwyzki_finansowe_kwota', 1, 426.33, 155.91, 131.81, 14.17, 'right', false],
  ['okres_kredytowania', 2, 206.36, 736.16, 36, 18.99, 'right', true, 3],
  ['karencja', 2, 432, 736.16, 23.81, 18.99, 'right', true, 2],
  ['dzien_splaty', 2, 529.79, 736.16, 22.96, 18.99, 'right', true, 2],
  ['nr_rachunku', 2, 240.09, 677.76, 314.36, 17.29, 'left', true, 26],
  ['termin_wyplaty1', 2, 198.43, 639.21, 23.24, 19.28, 'left', true, 2],
  ['termin_wyplaty2', 2, 235.28, 639.21, 22.96, 19.28, 'left', true, 2],
  ['termin_wyplaty3', 2, 271.28, 639.21, 47.62, 19.28, 'left', true, 4],
  ['termin_zakonczenia_inwestycji1', 2, 450.71, 639.21, 22.68, 19.28, 'left', true, 2],
  ['termin_zakonczenia_inwestycji2', 2, 487.56, 639.21, 46.77, 19.28, 'left', true, 4],
  ['adres_inwestycji', 2, 140.88, 623.91, 426.33, 14.17, 'left', false],
  ['rodzaj_nieruchomosci_inny', 2, 316.91, 559.28, 246.05, 14.17, 'left', false],
  ['docelowa_wartosc', 2, 316.91, 542.84, 235.84, 11.62, 'right', false],
  ['dojazd_nieruchomosc_kw1', 2, 348.38, 424.91, 50.74, 18.99, 'left', true, 4],
  ['dojazd_nieruchomosc_kw2', 2, 413.01, 424.91, 102.9, 18.99, 'left', true, 8],
  ['dojazd_nieruchomosc_kw3', 2, 529.79, 424.91, 10.77, 18.99, 'left', false, 1],
  ['hipoteka_udzialy_wielkosc1', 2, 348.38, 399.4, 24.38, 18.71, 'left', true, 2],
  ['hipoteka_udzialy_wielkosc2', 2, 387.21, 399.4, 37.42, 18.71, 'left', true, 3],
  ['karta_kredytowa_limit', 2, 148.82, 341.57, 75.12, 14.17, 'right', false],
  ['karta_kredytowa_imie_nazwisko', 2, 374.46, 341.57, 189.35, 14.17, 'left', false],
  ['inne_deklaracje1', 2, 114.52, 218.67, 448.44, 14.17, 'left', false],
  ['inne_deklaracje2', 2, 114.52, 199.39, 448.44, 14.17, 'left', false],
  ['miejscowosc', 4, 329.1, 511.94, 132.66, 14.17, 'left', false],
  ['data', 4, 467.72, 511.94, 114.24, 14.17, 'left', false],
  ['inny_rzeczoznawca', 4, 345.26, 422.36, 236.69, 14.17, 'left', false],
  ['hipoteka_nieruchomosc1_kw2', 2, 339.02, 512.22, 102.61, 18.99, 'left', true, 8],
  ['hipoteka_nieruchomosc1_kw1', 2, 272.98, 512.22, 52.44, 18.99, 'left', true, 4],
  ['hipoteka_nieruchomosc1_kw3', 2, 456.09, 512.22, 11.06, 18.99, 'left', false, 1],
  ['hipoteka_nieruchomosc2_kw1', 2, 272.98, 488.98, 52.44, 18.71, 'left', true, 4],
  ['hipoteka_nieruchomosc2_kw2', 2, 339.02, 488.98, 102.61, 18.71, 'left', true, 8],
  ['hipoteka_nieruchomosc2_kw3', 2, 456.09, 488.98, 11.06, 18.71, 'left', false, 1],
  ['hipoteka_nieruchomosc3_kw1', 2, 272.98, 464.88, 52.44, 18.99, 'left', true, 4],
  ['hipoteka_nieruchomosc3_kw2', 2, 339.02, 464.88, 102.61, 18.99, 'left', true, 8],
  ['hipoteka_nieruchomosc3_kw3', 2, 456.09, 464.88, 11.06, 18.99, 'left', false, 1],
] as const satisfies readonly TextWidgetTuple[]

const CHECKBOX_WIDGETS = [
  ['nabycie', 1, 75.4, 453.54, 7.65, 7.65, 'tak'],
  ['wykonczenie', 1, 75.4, 437.1, 7.65, 7.65, 'tak'],
  ['remont', 1, 210.9, 437.1, 7.65, 7.65, 'tak'],
  ['budowa', 1, 75.4, 420.09, 7.65, 7.65, 'tak'],
  ['nadbudowa', 1, 212.6, 420.09, 7.94, 7.65, 'tak'],
  ['przebudowa', 1, 75.4, 403.37, 7.65, 7.65, 'tak'],
  ['inny_cel', 1, 75.4, 385.8, 7.65, 7.65, 'tak'],
  ['refinansowanie', 1, 75.4, 342.71, 7.65, 7.65, 'tak'],
  ['splata_zobowiazan', 1, 75.4, 325.13, 7.65, 7.65, 'tak'],
  ['pozyczka', 1, 75.4, 308.13, 7.65, 7.65, 'tak'],
  ['dowolny_cel', 1, 166.96, 308.13, 7.65, 7.65, 'tak'],
  ['pierwsza_transza', 1, 82.2, 291.69, 7.65, 7.65, 'tak'],
  ['nadwyzki_finansowe', 1, 102.05, 160.16, 7.94, 7.94, 'tak'],
  ['wnioskodawca_zamieszkujacy1', 2, 413.86, 610.58, 7.65, 7.65, 'tak'],
  ['wnioskodawca_zamieszkujacy2', 2, 447.59, 610.58, 7.94, 7.65, 'tak'],
  ['wnioskodawca_zamieszkujacy3', 2, 484.44, 610.02, 7.94, 7.65, 'tak'],
  ['wnioskodawca_zamieszkujacy4', 2, 517.32, 610.58, 7.94, 7.65, 'tak'],
  ['rodzaj_nieruchomosci_dom_jednorodzinny', 2, 68.31, 576.85, 7.65, 7.65, 'tak'],
  ['rodzaj_nieruchomosci_lokal', 2, 159.02, 576.85, 7.65, 7.65, 'tak'],
  ['rodzaj_nieruchomosci_garaz', 2, 249.45, 576.85, 7.65, 7.65, 'tak'],
  ['rodzaj_nieruchomosci_miejsce_postojowe', 2, 292.25, 576.85, 7.65, 7.65, 'tak'],
  ['rodzaj_nieruchomosci_grunty_rolne', 2, 382.68, 576.85, 7.65, 7.65, 'tak'],
  ['rodzaj_nieruchomosci_dom_wielomieszkaniowy', 2, 456.66, 576.85, 7.94, 7.65, 'tak'],
  ['rodzaj_nieruchomosci_dzialka_budowlana', 2, 68.31, 560.98, 7.65, 7.65, 'tak'],
  ['rodzaj_nieruchomosci_dzialka_rekreacyjna', 2, 159.02, 560.98, 7.65, 7.65, 'tak'],
  ['rodzaj_nieruchomosci_inna', 2, 251.72, 560.98, 7.94, 7.65, 'tak'],
  ['hipoteka_udzialy', 2, 68.6, 405.64, 7.65, 7.65, 'tak'],
  ['ubezpieczenie_na_zycie_wnioskodawca1', 2, 150.52, 276.68, 7.65, 7.94, 'tak'],
  ['ubezpieczenie_na_zycie_wnioskodawca2', 2, 278.36, 276.68, 7.65, 7.94, 'tak'],
  ['ubezpieczenie_na_zycie_wnioskodawca3', 2, 405.07, 276.68, 7.65, 7.94, 'tak'],
  ['ubezpieczenie_na_zycie_wnioskodawca4', 2, 531.21, 276.96, 7.65, 7.94, 'tak'],
  ['inne_deklaracje', 2, 68.31, 221.22, 7.65, 7.65, 'tak'],
  ['hipoteka_nieruchomosc1_brak_kw', 2, 472.82, 518.74, 7.65, 7.65, 'tak'],
  ['hipoteka_nieruchomosc2_brak_kw', 2, 472.82, 495.5, 7.65, 7.65, 'tak'],
  ['hipoteka_nieruchomosc3_brak_kw', 2, 472.82, 471.4, 7.65, 7.65, 'tak'],
  ['wniosek_0', 1, 77.1, 688.82, 7.65, 7.65, 'wlasny_kat'],
  ['wniosek_1', 1, 296.22, 688.82, 7.65, 7.65, 'mix'],
  ['wniosek_2', 1, 452.13, 688.82, 7.65, 7.65, 'pozyczka'],
  ['oprocentowanie_0', 2, 167.24, 766.49, 7.65, 7.94, 'zmienne'],
  ['oprocentowanie_1', 2, 336.47, 771.31, 7.65, 7.65, 'zmienne_ze_stala'],
  ['formula_splaty_0', 2, 138.9, 720, 7.94, 7.65, 'rowne'],
  ['formula_splaty_1', 2, 254.83, 720, 7.65, 7.65, 'malejace'],
  ['uruchomienie_0', 2, 395.72, 720, 7.65, 7.65, 'transze'],
  ['uruchomienie_1', 2, 473.95, 720, 7.94, 7.65, 'jednorazowe'],
  ['rachunek_splaty_2', 2, 238.96, 665.86, 7.94, 7.65, 'techniczny'],
  ['rachunek_splaty_1', 2, 77.1, 665.86, 7.65, 7.65, 'nowy_ror'],
  ['rachunek_splaty_0', 2, 77.1, 683.43, 7.65, 7.65, 'ror'],
  ['hipoteka_nieruchomosc1_0', 2, 144.85, 518.74, 7.65, 7.65, 'kredytowana'],
  ['hipoteka_nieruchomosc1_1', 2, 208.06, 518.74, 7.65, 7.65, 'inna'],
  ['hipoteka_nieruchomosc2_0', 2, 144.57, 495.5, 7.65, 7.65, 'kredytowana'],
  ['hipoteka_nieruchomosc2_1', 2, 208.35, 495.5, 7.65, 7.65, 'inna'],
  ['hipoteka_nieruchomosc3_0', 2, 144.85, 471.4, 7.65, 7.65, 'kredytowana'],
  ['hipoteka_nieruchomosc3_1', 2, 208.35, 471.4, 7.65, 7.65, 'inna'],
  ['droga_publiczna_2', 2, 337.61, 448.73, 7.65, 7.65, 'udzial'],
  ['droga_publiczna_1', 2, 224.22, 448.73, 7.65, 7.65, 'sluzebnosc'],
  ['droga_publiczna_0', 2, 166.96, 448.73, 7.65, 7.65, 'bezposrednio'],
  ['karta_kredytowa_1', 2, 289.42, 362.55, 7.65, 7.94, 'nie'],
  ['karta_kredytowa_0', 2, 250.87, 362.55, 7.65, 7.94, 'tak'],
  ['ror_0', 2, 318.33, 325.13, 7.94, 7.65, 'tak'],
  ['ror_1', 2, 355.75, 325.13, 7.94, 7.65, 'nie'],
  ['ubezpieczenie_na_zycie_0', 2, 318.33, 291.7, 7.94, 7.65, 'tak'],
  ['ubezpieczenie_na_zycie_1', 2, 357.17, 291.7, 7.65, 7.65, 'nie'],
  ['systematyczne_wplywy_1', 2, 499.46, 237.66, 7.94, 7.65, 'nie'],
  ['systematyczne_wplywy_0', 2, 462.05, 237.66, 7.65, 7.65, 'tak'],
  ['wklad_wlasny_z_kredytu_1', 3, 241.79, 752.6, 8.22, 8.22, 'nie'],
  ['wklad_wlasny_z_kredytu_0', 3, 193.04, 752.6, 8.22, 8.22, 'tak'],
  ['zgoda_wczesniejsza_decyzja_0', 3, 200.41, 686.27, 8.22, 8.22, 'tak'],
  ['zgoda_wczesniejsza_decyzja_1', 3, 230.46, 686.27, 8.22, 8.22, 'nie'],
  ['zgoda_przekazywanie_informacji_0', 3, 506.27, 663.31, 8.22, 8.22, 'tak'],
  ['zgoda_przekazywanie_informacji_1', 3, 538.02, 663.31, 8.22, 8.22, 'nie'],
  ['swiadomosc_ryzyk_0', 3, 236.98, 416.69, 8.22, 8.22, 'tak'],
  ['swiadomosc_ryzyk_1', 3, 282.05, 416.69, 8.22, 8.22, 'nie'],
  ['rzeczoznawca_1', 4, 326.55, 424.35, 8.22, 8.22, 'inny'],
  ['rzeczoznawca_0', 4, 68.31, 419.81, 8.22, 8.22, 'wspolpracujacy'],
] as const satisfies readonly CheckboxWidgetTuple[]

interface BaseWidgetMetadata {
  page: number
  rect: { x: number, y: number, width: number, height: number }
}

interface TextWidgetMetadata extends BaseWidgetMetadata {
  fieldType: 'text'
  text: {
    alignment: TextAlignment
    multiline: false
    comb: boolean
    maxLength?: number
  }
}

interface CheckboxWidgetMetadata extends BaseWidgetMetadata {
  fieldType: 'checkbox'
  exportValue: string
}

export type PkoWidgetMetadata = TextWidgetMetadata | CheckboxWidgetMetadata

const widgetMetadata: Record<string, PkoWidgetMetadata> = {}

for (const [field, page, x, y, width, height, alignment, comb, maxLength] of TEXT_WIDGETS) {
  if (widgetMetadata[field]) throw new Error(`Duplicate reviewed PKO AcroForm snapshot: ${field}`)
  widgetMetadata[field] = {
    fieldType: 'text',
    page,
    rect: { x, y, width, height },
    text: {
      alignment,
      multiline: false,
      comb,
      ...(maxLength !== undefined ? { maxLength } : {}),
    },
  }
}

for (const [field, page, x, y, width, height, exportValue] of CHECKBOX_WIDGETS) {
  if (widgetMetadata[field]) throw new Error(`Duplicate reviewed PKO AcroForm snapshot: ${field}`)
  widgetMetadata[field] = {
    fieldType: 'checkbox',
    page,
    rect: { x, y, width, height },
    exportValue,
  }
}

if (Object.keys(widgetMetadata).length !== 144) {
  throw new Error(`Expected 144 reviewed PKO AcroForm snapshots, got ${Object.keys(widgetMetadata).length}`)
}

export const PKO_WIDGET_METADATA: Readonly<Record<string, PkoWidgetMetadata>> = Object.freeze(widgetMetadata)

const BLACK = { space: 'rgb', red: 0, green: 0, blue: 0 } as const

function textAppearance(metadata: TextWidgetMetadata): PdfTextAppearance {
  const { alignment, comb, maxLength } = metadata.text
  return {
    kind: 'text',
    fontId: 'dm-sans-regular',
    fontSizePt: 8,
    minFontSizePt: 5,
    letterSpacingPt: 0,
    lineHeightPt: 9.6,
    wrap: 'none',
    overflow: 'shrink',
    horizontalAlign: alignment,
    verticalAlign: 'middle',
    distribution: comb && maxLength !== undefined
      ? { kind: 'comb', cells: maxLength }
      : { kind: 'flow' },
    color: BLACK,
    opacity: 1,
    paddingPt: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 },
  }
}

const MARK_APPEARANCE: PdfMarkAppearance = {
  kind: 'mark',
  role: 'checkbox',
  glyph: 'x',
  color: BLACK,
  opacity: 1,
  insetPt: 1.5,
  strokeWidthPt: 0.9,
  outline: {
    shape: 'square',
    color: BLACK,
    strokeWidthPt: 0.6,
  },
}

export function pkoAcroTarget(
  field: string,
  valueMap?: Readonly<Record<string, string>>,
): AcroFormTarget {
  const metadata = PKO_WIDGET_METADATA[field]
  if (!metadata) throw new Error(`Missing reviewed PKO AcroForm snapshot: ${field}`)

  return {
    kind: 'acroform',
    field,
    fieldType: metadata.fieldType,
    expectedWidgets: [{
      index: 0,
      page: metadata.page,
      rect: metadata.rect,
      ...(metadata.fieldType === 'checkbox' ? { exportValue: metadata.exportValue } : {}),
    }],
    ...(metadata.fieldType === 'text'
      ? {
          text: metadata.text,
          appearance: textAppearance(metadata),
        }
      : { appearance: MARK_APPEARANCE }),
    ...(valueMap ? { valueMap } : {}),
  }
}
