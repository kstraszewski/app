import fontkit from '@pdf-lib/fontkit'
import {
  CANONICAL_COMPUTED_BINDINGS,
  CANONICAL_FIELDS,
  resolveTemplateFillMethod,
  type AcroFormTarget,
  type CanonicalFieldType,
  type DocumentTemplate,
  type LegacyOverlayTarget,
  type OverlayTarget,
  type PdfColor,
  type PdfCoordinateSpace,
  type PdfMarkAppearance,
  type PdfTextAppearance,
  type PreciseOverlayTarget,
  type TemplateBinding,
  type ValueFormat,
} from '@openexpert/multiform'
import { zipSync } from 'fflate'
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { fillXlsxTemplate } from './multiform-xlsx.ts'
import {
  AnnotationFlags,
  clip,
  cmyk,
  concatTransformationMatrix,
  degrees,
  endPath,
  grayscale,
  layoutMultilineText,
  layoutSinglelineText,
  PDFArray,
  PDFButton,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFStream,
  PDFString,
  PDFTextField,
  rgb,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  TextAlignment,
  type PDFFont,
  type Color,
  type PDFField,
  type PDFPage,
  type PDFWidgetAnnotation,
} from 'pdf-lib'

export type PdfScalar = string | number | boolean | Date | null | undefined

export type FlatPdfValues = Readonly<Record<string, PdfScalar>>

export class MultiformPdfValueError extends Error {
  readonly canonicalKey: string

  constructor(canonicalKey: string, message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'MultiformPdfValueError'
    this.canonicalKey = canonicalKey
  }
}

export class UnsupportedMultiformFillMethodError extends Error {
  readonly fillMethod: 'web_form' | 'api'

  constructor(fillMethod: 'web_form' | 'api') {
    super(`Metoda uzupełniania „${fillMethod}” nie jest obsługiwana przez renderer PDF.`)
    this.name = 'UnsupportedMultiformFillMethodError'
    this.fillMethod = fillMethod
  }
}

export interface PdfBundleDocument {
  fileName: string
  template: DocumentTemplate
  sourceBytes: Uint8Array
  outputName?: string
  directory?: string
}

export interface PdfBundleAttachment {
  fileName: string
  bytes: Uint8Array
  mimeType?: string
  directory?: string
}

interface PdfRect {
  x: number
  y: number
  width: number
  height: number
}

const dateFormatter = new Intl.DateTimeFormat('pl-PL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const currencyFormatter = new Intl.NumberFormat('pl-PL', {
  style: 'decimal',
  useGrouping: true,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const canonicalTypes = new Map<string, CanonicalFieldType>(
  [...CANONICAL_FIELDS, ...CANONICAL_COMPUTED_BINDINGS].map(field => [field.canonicalKey, field.type]),
)
const canonicalMaxLengths = new Map<string, number>(
  CANONICAL_FIELDS.flatMap(field => field.validation?.maxLength === undefined
    ? []
    : [[field.canonicalKey, field.validation.maxLength] as const]),
)

function mapKey(value: PdfScalar) {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function mapTargetValue(value: PdfScalar, valueMap?: AcroFormTarget['valueMap']) {
  if (!valueMap) return { matched: true, value }

  const exactKey = mapKey(value)
  if (Object.prototype.hasOwnProperty.call(valueMap, exactKey)) {
    return { matched: true, value: valueMap[exactKey] }
  }

  const normalizedKey = exactKey.trim().toLocaleLowerCase('pl-PL')
  const matchingEntry = Object.entries(valueMap).find(([key]) => (
    key.trim().toLocaleLowerCase('pl-PL') === normalizedKey
  ))

  return matchingEntry
    ? { matched: true, value: matchingEntry[1] }
    : { matched: false, value: undefined }
}

function rethrowPdfValueError(canonicalKey: string, error: unknown): never {
  if (error instanceof MultiformPdfValueError) throw error
  if (!(error instanceof Error)) throw error

  if (error.message.startsWith('Numer rachunku NRB')) {
    throw new MultiformPdfValueError(canonicalKey, error.message, error)
  }
  if (
    error.message.includes('Attempted to set text with length=')
    || error.message.includes('ma więcej znaków niż pole comb')
    || error.message.includes('nie mieści się w polu')
  ) {
    throw new MultiformPdfValueError(
      canonicalKey,
      'Wartość jest zbyt długa dla pola formularza bankowego.',
      error,
    )
  }

  throw error
}

function parseCurrencyNumber(value: string) {
  const normalized = value.trim().replace(/[\s\u00A0\u202F]/g, '')
  if (!/^-?\d+(?:[.,]\d+)?$/.test(normalized)) return undefined

  const parsed = Number(normalized.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatPolishDate(value: PdfScalar) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Nieprawidłowa wartość daty.')
    return dateFormatter.format(value)
  }

  if (typeof value !== 'string') return String(value)

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value.trim())
  if (!match) return value

  const [, year, month, day] = match
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  const isValid = parsed.getUTCFullYear() === Number(year)
    && parsed.getUTCMonth() === Number(month) - 1
    && parsed.getUTCDate() === Number(day)

  return isValid ? `${day}.${month}.${year}` : value
}

function conditionMatches(binding: TemplateBinding, values: FlatPdfValues) {
  if (!binding.condition) return true

  const conditionValue = values[binding.condition.canonicalKey]
  if (conditionValue === null || conditionValue === undefined) return false

  const expected = Array.isArray(binding.condition.equals)
    ? binding.condition.equals
    : [binding.condition.equals]
  return expected.includes(String(conditionValue))
}

function overlayBindingValue(binding: TemplateBinding, value: PdfScalar) {
  if (binding.target.kind !== 'overlay' || !binding.condition) return value

  const isMark = binding.target.rendererVersion === 2
    ? binding.target.appearance.kind === 'mark'
    : binding.target.format === 'mark'

  // A conditioned mark represents the selected option, not the truthiness of
  // its canonical value. This matters for paired Tak/Nie boolean targets: the
  // `equals: 'false'` target must draw a mark after its condition matched.
  // Unconditioned boolean checkboxes keep their ordinary true/false behavior.
  return isMark && binding.condition.canonicalKey === binding.canonicalKey
    ? true
    : value
}

function meaningfulParts(values: readonly PdfScalar[]) {
  return values
    .filter((value): value is Exclude<PdfScalar, null | undefined> => (
      value !== null && value !== undefined && String(value).trim() !== ''
    ))
    .map(value => String(value).trim())
}

function houseAndUnit(values: readonly PdfScalar[]) {
  const [houseNumber, unitNumber] = meaningfulParts(values)
  if (!houseNumber) return ''
  return unitNumber ? `${houseNumber}/${unitNumber}` : houseNumber
}

function fullAddress(values: FlatPdfValues) {
  const street = meaningfulParts([values['property.address.street']])[0]
  const building = houseAndUnit([
    values['property.address.houseNumber'],
    values['property.address.unitNumber'],
  ])
  const locality = meaningfulParts([
    values['property.address.postalCode'],
    values['property.address.city'],
  ]).join(' ')
  const administrative = meaningfulParts([
    values['property.address.county'],
    values['property.address.voivodeship'],
  ])

  return [
    meaningfulParts([street, building]).join(' '),
    locality,
    ...administrative,
  ].filter(Boolean).join(', ')
}

function sumCurrencyValues(values: readonly PdfScalar[]) {
  const numbers = values.flatMap((value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return [value]
    if (typeof value !== 'string' || value.trim() === '') return []
    const parsed = parseCurrencyNumber(value)
    if (parsed === undefined) throw new Error('Nieprawidłowa wartość składnika środków własnych.')
    return [parsed]
  })

  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : ''
}

function landRegisterParts(value: PdfScalar) {
  if (value === null || value === undefined) return ['', '', ''] as const

  const normalized = String(value).trim().replace(/\s+/g, '').toLocaleUpperCase('pl-PL')
  const slashParts = normalized.split('/')
  if (slashParts.length === 3 && slashParts.every(Boolean)) {
    return [slashParts[0], slashParts[1], slashParts[2]] as const
  }

  const compact = normalized.replaceAll('/', '')
  const match = /^(.{4})(\d{8})(\d)$/.exec(compact)
  if (match) return [match[1], match[2], match[3]] as const

  // Preserve the supplied value instead of manufacturing missing KW parts.
  return [normalized, '', ''] as const
}

function dateParts(value: PdfScalar) {
  const formatted = formatPolishDate(value)
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(formatted)
  return match
    ? [match[1], match[2], match[3]] as const
    : [formatted, '', ''] as const
}

function fractionParts(value: PdfScalar) {
  if (value === null || value === undefined) return ['', ''] as const
  const normalized = String(value).trim()
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(normalized)
  return match
    ? [match[1], match[2]] as const
    : [normalized, ''] as const
}

function compactPolishBankAccount(value: PdfScalar) {
  const compact = String(value ?? '').replace(/\s/gu, '')
  if (!/^\d{26}$/.test(compact)) {
    throw new Error('Numer rachunku NRB musi zawierać dokładnie 26 cyfr.')
  }
  return compact
}

function applyValueFormat(
  format: ValueFormat,
  sourceValues: readonly PdfScalar[],
  values: FlatPdfValues,
) {
  switch (format) {
    case 'fullName':
      return meaningfulParts(sourceValues).join(' ')
    case 'application.placeAndDate': {
      const place = meaningfulParts([sourceValues[0]])[0]
      const date = sourceValues[1] === null || sourceValues[1] === undefined || sourceValues[1] === ''
        ? undefined
        : formatPolishDate(sourceValues[1])
      return meaningfulParts([place, date]).join(', ')
    }
    case 'currency.sum':
      return sumCurrencyValues(sourceValues)
    case 'fullAddress':
      return fullAddress(values)
    case 'houseAndUnit':
      return houseAndUnit(sourceValues)
    case 'streetHouseAndUnit':
      return meaningfulParts([
        sourceValues[0],
        houseAndUnit(sourceValues.slice(1)),
      ]).join(' ')
    case 'date.ddMMyyyy':
      return formatPolishDate(sourceValues[0])
    case 'date.day':
      return dateParts(sourceValues[0])[0]
    case 'date.month':
      return dateParts(sourceValues[0])[1]
    case 'date.year':
      return dateParts(sourceValues[0])[2]
    case 'landRegister.part1':
      return landRegisterParts(sourceValues[0])[0]
    case 'landRegister.part2':
      return landRegisterParts(sourceValues[0])[1]
    case 'landRegister.part3':
      return landRegisterParts(sourceValues[0])[2]
    case 'fraction.numerator':
      return fractionParts(sourceValues[0])[0]
    case 'fraction.denominator':
      return fractionParts(sourceValues[0])[1]
    case 'bankAccount.nrb':
      return compactPolishBankAccount(sourceValues[0])
  }
}

function resolveBindingValue(binding: TemplateBinding, values: FlatPdfValues) {
  const sourceKeys = binding.valueFrom?.length
    ? binding.valueFrom
    : [binding.canonicalKey]
  const hasSource = sourceKeys.some(key => (
    Object.prototype.hasOwnProperty.call(values, key)
      && values[key] !== null
      && values[key] !== undefined
  ))

  if (!hasSource) return { present: false as const, value: undefined }

  const sourceValues = sourceKeys.map(key => values[key])
  const value = binding.valueFormat
    ? applyValueFormat(binding.valueFormat, sourceValues, values)
    : binding.computed
      ? meaningfulParts(sourceValues).join(' ')
      : values[binding.canonicalKey]

  if (binding.computed && value === '') {
    return { present: false as const, value: undefined }
  }

  return { present: true as const, value }
}

function bindingType(binding: TemplateBinding): CanonicalFieldType {
  const type = canonicalTypes.get(binding.canonicalKey)
  if (type) return type

  throw new Error(`Brak definicji canonical field dla „${binding.canonicalKey}”.`)
}

function formatFieldValue(value: PdfScalar, type: CanonicalFieldType) {
  if (value === null || value === undefined) return ''

  if (type === 'date') return formatPolishDate(value)

  if (type === 'currency') {
    const numericValue = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? parseCurrencyNumber(value)
        : undefined

    if (numericValue !== undefined) {
      if (!Number.isFinite(numericValue)) throw new Error('Nieprawidłowa wartość walutowa.')
      return currencyFormatter.format(numericValue)
    }
  }

  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie'
  return String(value)
}

function assertCanonicalMaxLength(
  canonicalKey: string,
  value: PdfScalar,
  type: CanonicalFieldType,
) {
  const maxLength = canonicalMaxLengths.get(canonicalKey)
  if (maxLength === undefined) return

  const renderedValue = formatFieldValue(value, type)
  if (Array.from(renderedValue).length <= maxLength) return

  const cause = new Error(
    `Wartość pola „${canonicalKey}” przekracza maksymalną długość ${maxLength} znaków.`,
  )
  throw new MultiformPdfValueError(
    canonicalKey,
    'Wartość jest zbyt długa dla pola formularza bankowego.',
    cause,
  )
}

function isMarked(value: PdfScalar) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (value === null || value === undefined) return false
  if (value instanceof Date) return !Number.isNaN(value.getTime())

  const normalized = value.trim().toLocaleLowerCase('pl-PL')
  if (['', '0', 'false', 'nie', 'no', 'off', 'unchecked'].includes(normalized)) return false
  if (['1', 'true', 'tak', 'yes', 'on', 'x', 'checked'].includes(normalized)) return true
  return true
}

function boundedRect(rect: PdfRect, padding = 1.5): PdfRect {
  const horizontalPadding = Math.min(padding, Math.max(0, rect.width / 8))
  const verticalPadding = Math.min(padding, Math.max(0, rect.height / 8))

  return {
    x: rect.x + horizontalPadding,
    y: rect.y + verticalPadding,
    width: Math.max(0.1, rect.width - horizontalPadding * 2),
    height: Math.max(0.1, rect.height - verticalPadding * 2),
  }
}

function drawTextInRect(
  page: PDFPage,
  font: PDFFont,
  text: string,
  rect: PdfRect,
  options: { fontSize?: number, multiline?: boolean } = {},
) {
  if (!text) return

  const bounds = boundedRect(rect)
  const maximumFontSize = Math.max(3, Math.min(options.fontSize ?? 10, bounds.height))

  if (options.multiline || text.includes('\n')) {
    const automaticLayout = layoutMultilineText(text, {
      alignment: TextAlignment.Left,
      font,
      bounds,
    })
    const fontSize = Math.min(automaticLayout.fontSize, maximumFontSize)
    const layout = layoutMultilineText(text, {
      alignment: TextAlignment.Left,
      font,
      fontSize,
      bounds,
    })

    for (const line of layout.lines) {
      page.drawText(line.text, {
        x: line.x,
        y: line.y,
        size: layout.fontSize,
        font,
        color: rgb(0, 0, 0),
      })
    }
    return
  }

  const automaticLayout = layoutSinglelineText(text, {
    alignment: TextAlignment.Left,
    font,
    bounds,
  })
  const fontSize = Math.min(automaticLayout.fontSize, maximumFontSize)
  const layout = layoutSinglelineText(text, {
    alignment: TextAlignment.Left,
    font,
    fontSize,
    bounds,
  })

  page.drawText(layout.line.text, {
    x: layout.line.x,
    y: layout.line.y,
    size: layout.fontSize,
    font,
    color: rgb(0, 0, 0),
  })
}

function drawMarkInRect(page: PDFPage, rect: PdfRect) {
  const size = Math.max(2, Math.min(rect.width, rect.height))
  const inset = Math.max(1, size * 0.2)
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const half = size / 2 - inset

  page.drawLine({
    start: { x: centerX - half, y: centerY - half },
    end: { x: centerX + half, y: centerY + half },
    thickness: Math.max(0.8, size * 0.08),
    color: rgb(0, 0, 0),
  })
  page.drawLine({
    start: { x: centerX - half, y: centerY + half },
    end: { x: centerX + half, y: centerY - half },
    thickness: Math.max(0.8, size * 0.08),
    color: rgb(0, 0, 0),
  })
}

function drawCheckBoxOutline(page: PDFPage, rect: PdfRect) {
  page.drawRectangle({
    x: rect.x + 0.3,
    y: rect.y + 0.3,
    width: Math.max(0.1, rect.width - 0.6),
    height: Math.max(0.1, rect.height - 0.6),
    borderWidth: 0.6,
    borderColor: rgb(0, 0, 0),
  })
}

function drawRadioOutline(page: PDFPage, rect: PdfRect) {
  page.drawEllipse({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    xScale: Math.max(0.1, rect.width / 2 - 0.3),
    yScale: Math.max(0.1, rect.height / 2 - 0.3),
    borderWidth: 0.6,
    borderColor: rgb(0, 0, 0),
  })
}

function toPdfColor(color: PdfColor): Color {
  if (color.space === 'gray') return grayscale(color.value)
  if (color.space === 'rgb') return rgb(color.red, color.green, color.blue)
  return cmyk(color.cyan, color.magenta, color.yellow, color.black)
}

function insetRect(rect: PdfRect, appearance: PdfTextAppearance): PdfRect {
  const { paddingPt } = appearance
  return {
    x: rect.x + paddingPt.left,
    y: rect.y + paddingPt.bottom,
    width: Math.max(0, rect.width - paddingPt.left - paddingPt.right),
    height: Math.max(0, rect.height - paddingPt.top - paddingPt.bottom),
  }
}

function graphemes(text: string) {
  return Array.from(text)
}

function textWidth(font: PDFFont, text: string, size: number, letterSpacingPt: number) {
  const characters = graphemes(text)
  return font.widthOfTextAtSize(text, size)
    + Math.max(0, characters.length - 1) * letterSpacingPt
}

function splitLongToken(
  token: string,
  font: PDFFont,
  size: number,
  letterSpacingPt: number,
  maximumWidth: number,
) {
  const parts: string[] = []
  let current = ''

  for (const character of graphemes(token)) {
    const candidate = `${current}${character}`
    if (current && textWidth(font, candidate, size, letterSpacingPt) > maximumWidth) {
      parts.push(current)
      current = character
    }
    else {
      current = candidate
    }
  }

  if (current) parts.push(current)
  return parts
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  appearance: PdfTextAppearance,
  maximumWidth: number,
) {
  const sourceLines = text.replace(/\r\n?/g, '\n').split('\n')
  if (appearance.wrap === 'none') return sourceLines

  const lines: string[] = []
  for (const sourceLine of sourceLines) {
    if (!sourceLine) {
      lines.push('')
      continue
    }

    if (appearance.wrap === 'character') {
      lines.push(...splitLongToken(
        sourceLine,
        font,
        size,
        appearance.letterSpacingPt,
        maximumWidth,
      ))
      continue
    }

    const words = sourceLine.trim().split(/\s+/)
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (current && textWidth(font, candidate, size, appearance.letterSpacingPt) > maximumWidth) {
        lines.push(current)
        const wordParts = splitLongToken(
          word,
          font,
          size,
          appearance.letterSpacingPt,
          maximumWidth,
        )
        current = wordParts.pop() ?? ''
        lines.push(...wordParts)
      }
      else if (!current && textWidth(font, word, size, appearance.letterSpacingPt) > maximumWidth) {
        const wordParts = splitLongToken(
          word,
          font,
          size,
          appearance.letterSpacingPt,
          maximumWidth,
        )
        current = wordParts.pop() ?? ''
        lines.push(...wordParts)
      }
      else {
        current = candidate
      }
    }
    lines.push(current)
  }

  return lines
}

interface TextLayout {
  fontSize: number
  lineHeight: number
  lines: readonly string[]
  fits: boolean
}

function calculateTextLayout(
  text: string,
  font: PDFFont,
  bounds: PdfRect,
  appearance: PdfTextAppearance,
  size: number,
): TextLayout {
  if (appearance.distribution.kind === 'comb') {
    const characters = graphemes(text)
    const cellWidth = bounds.width / appearance.distribution.cells
    const fits = characters.length <= appearance.distribution.cells
      && font.heightAtSize(size) <= bounds.height
      && characters.every(character => font.widthOfTextAtSize(character, size) <= cellWidth)
    return {
      fontSize: size,
      lineHeight: appearance.lineHeightPt * (size / appearance.fontSizePt),
      lines: [text],
      fits,
    }
  }

  const lines = wrapText(text, font, size, appearance, bounds.width)
  const lineHeight = appearance.lineHeightPt * (size / appearance.fontSizePt)
  const fits = lines.length * lineHeight <= bounds.height
    && lines.every(line => textWidth(font, line, size, appearance.letterSpacingPt) <= bounds.width)

  return { fontSize: size, lineHeight, lines, fits }
}

function resolveTextLayout(
  text: string,
  font: PDFFont,
  bounds: PdfRect,
  appearance: PdfTextAppearance,
) {
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('Pole tekstowe po odjęciu paddingu nie ma dodatniej szerokości i wysokości.')
  }

  if (appearance.distribution.kind === 'comb'
    && graphemes(text).length > appearance.distribution.cells) {
    throw new Error(
      `Wartość „${text}” ma więcej znaków niż pole comb (${appearance.distribution.cells}).`,
    )
  }

  let layout = calculateTextLayout(text, font, bounds, appearance, appearance.fontSizePt)
  if (layout.fits || appearance.overflow === 'clip') return layout

  if (appearance.overflow === 'shrink') {
    for (
      let size = appearance.fontSizePt - 0.25;
      size >= appearance.minFontSizePt - 0.001;
      size -= 0.25
    ) {
      layout = calculateTextLayout(text, font, bounds, appearance, Math.max(size, appearance.minFontSizePt))
      if (layout.fits) return layout
    }
  }

  throw new Error(
    `Wartość „${text}” nie mieści się w polu ${bounds.width.toFixed(2)}×${bounds.height.toFixed(2)} pt.`,
  )
}

function horizontalTextX(
  lineWidth: number,
  bounds: PdfRect,
  alignment: PdfTextAppearance['horizontalAlign'],
) {
  if (alignment === 'center') return bounds.x + (bounds.width - lineWidth) / 2
  if (alignment === 'right') return bounds.x + bounds.width - lineWidth
  return bounds.x
}

function verticalBlockBottom(
  blockHeight: number,
  bounds: PdfRect,
  alignment: PdfTextAppearance['verticalAlign'],
) {
  if (alignment === 'top') return bounds.y + bounds.height - blockHeight
  if (alignment === 'middle') return bounds.y + (bounds.height - blockHeight) / 2
  return bounds.y
}

function drawSpacedText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  appearance: PdfTextAppearance,
  fontSize: number,
) {
  const options = {
    y,
    size: fontSize,
    font,
    color: toPdfColor(appearance.color),
    opacity: appearance.opacity,
    rotate: degrees(-(appearance.rotationDegreesClockwise ?? 0)),
  }

  if (appearance.letterSpacingPt === 0) {
    page.drawText(text, { ...options, x })
    return
  }

  let cursor = x
  for (const character of graphemes(text)) {
    page.drawText(character, { ...options, x: cursor })
    cursor += font.widthOfTextAtSize(character, fontSize) + appearance.letterSpacingPt
  }
}

function drawCombText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  bounds: PdfRect,
  appearance: PdfTextAppearance,
  fontSize: number,
  cells: number,
) {
  const characters = graphemes(text)
  const cellWidth = bounds.width / cells
  const startCell = appearance.horizontalAlign === 'right'
    ? cells - characters.length
    : appearance.horizontalAlign === 'center'
      ? Math.floor((cells - characters.length) / 2)
      : 0
  const fontHeight = font.heightAtSize(fontSize)
  const baseline = bounds.y + (bounds.height - fontHeight) / 2

  characters.forEach((character, characterIndex) => {
    const characterWidth = font.widthOfTextAtSize(character, fontSize)
    const cellIndex = startCell + characterIndex
    drawSpacedText(
      page,
      font,
      character,
      bounds.x + cellIndex * cellWidth + (cellWidth - characterWidth) / 2,
      baseline,
      appearance,
      fontSize,
    )
  })
}

function drawPreciseTextInRect(
  page: PDFPage,
  font: PDFFont,
  text: string,
  rect: PdfRect,
  appearance: PdfTextAppearance,
) {
  if (!text) return
  const bounds = insetRect(rect, appearance)
  const layout = resolveTextLayout(text, font, bounds, appearance)
  const shouldClip = appearance.overflow === 'clip' && !layout.fits

  if (shouldClip) {
    page.pushOperators(
      pushGraphicsState(),
      rectangle(bounds.x, bounds.y, bounds.width, bounds.height),
      clip(),
      endPath(),
    )
  }

  try {
    if (appearance.distribution.kind === 'comb') {
      drawCombText(
        page,
        font,
        text,
        bounds,
        appearance,
        layout.fontSize,
        appearance.distribution.cells,
      )
      return
    }

    const blockHeight = layout.lines.length * layout.lineHeight
    const blockBottom = verticalBlockBottom(blockHeight, bounds, appearance.verticalAlign)
    const fontHeight = font.heightAtSize(layout.fontSize)
    layout.lines.forEach((line, lineIndex) => {
      const lineWidth = textWidth(font, line, layout.fontSize, appearance.letterSpacingPt)
      const cellBottom = blockBottom + blockHeight - (lineIndex + 1) * layout.lineHeight
      drawSpacedText(
        page,
        font,
        line,
        horizontalTextX(lineWidth, bounds, appearance.horizontalAlign),
        cellBottom + (layout.lineHeight - fontHeight) / 2,
        appearance,
        layout.fontSize,
      )
    })
  }
  finally {
    if (shouldClip) page.pushOperators(popGraphicsState())
  }
}

function drawPreciseMarkInRect(
  page: PDFPage,
  rect: PdfRect,
  appearance: PdfMarkAppearance,
  marked: boolean,
) {
  const color = toPdfColor(appearance.color)
  const outline = appearance.outline
  if (outline?.shape === 'circle') {
    page.drawEllipse({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      xScale: Math.max(0.1, rect.width / 2),
      yScale: Math.max(0.1, rect.height / 2),
      borderWidth: outline.strokeWidthPt,
      borderColor: toPdfColor(outline.color),
      borderOpacity: appearance.opacity,
    })
  }
  else if (outline?.shape === 'square') {
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      borderWidth: outline.strokeWidthPt,
      borderColor: toPdfColor(outline.color),
      borderOpacity: appearance.opacity,
    })
  }

  if (!marked) return

  const inset = Math.min(
    appearance.insetPt,
    Math.max(0, Math.min(rect.width, rect.height) / 2 - 0.1),
  )
  const inner = {
    x: rect.x + inset,
    y: rect.y + inset,
    width: Math.max(0.1, rect.width - inset * 2),
    height: Math.max(0.1, rect.height - inset * 2),
  }

  if (appearance.glyph === 'fill') {
    page.drawRectangle({ ...inner, color, opacity: appearance.opacity })
    return
  }
  if (appearance.glyph === 'dot') {
    page.drawEllipse({
      x: inner.x + inner.width / 2,
      y: inner.y + inner.height / 2,
      xScale: inner.width / 2,
      yScale: inner.height / 2,
      color,
      opacity: appearance.opacity,
    })
    return
  }
  if (appearance.glyph === 'check') {
    page.drawLine({
      start: { x: inner.x, y: inner.y + inner.height * 0.48 },
      end: { x: inner.x + inner.width * 0.38, y: inner.y },
      thickness: appearance.strokeWidthPt,
      color,
      opacity: appearance.opacity,
    })
    page.drawLine({
      start: { x: inner.x + inner.width * 0.38, y: inner.y },
      end: { x: inner.x + inner.width, y: inner.y + inner.height },
      thickness: appearance.strokeWidthPt,
      color,
      opacity: appearance.opacity,
    })
    return
  }

  page.drawLine({
    start: { x: inner.x, y: inner.y },
    end: { x: inner.x + inner.width, y: inner.y + inner.height },
    thickness: appearance.strokeWidthPt,
    color,
    opacity: appearance.opacity,
  })
  page.drawLine({
    start: { x: inner.x, y: inner.y + inner.height },
    end: { x: inner.x + inner.width, y: inner.y },
    thickness: appearance.strokeWidthPt,
    color,
    opacity: appearance.opacity,
  })
}

function pageUserUnit(page: PDFPage) {
  const inherited = page.node.getInheritableAttribute(PDFName.of('UserUnit'))
  if (!inherited) return 1
  return page.doc.context.lookupMaybe(inherited, PDFNumber)?.asNumber() ?? 1
}

function normalizeRightAngle(angle: number) {
  const normalized = ((angle % 360) + 360) % 360
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized
  }
  throw new Error(`Nieobsługiwany obrót strony PDF: ${angle}°.`)
}

function withCoordinateSpace(
  page: PDFPage,
  coordinateSpace: PdfCoordinateSpace,
  draw: (dimensions: { width: number, height: number }) => void,
) {
  const referenceBox = coordinateSpace.referenceBox === 'crop'
    ? page.getCropBox()
    : page.getMediaBox()
  const userUnit = pageUserUnit(page)
  if (!(userUnit > 0)) throw new Error(`Nieprawidłowy /UserUnit strony: ${userUnit}.`)

  const scale = 1 / userUnit
  const rotation = coordinateSpace.orientation === 'visual'
    ? normalizeRightAngle(page.getRotation().angle)
    : 0
  const widthPt = referenceBox.width * userUnit
  const heightPt = referenceBox.height * userUnit
  const visualDimensions = rotation === 90 || rotation === 270
    ? { width: heightPt, height: widthPt }
    : { width: widthPt, height: heightPt }

  const matrix = rotation === 0
    ? [scale, 0, 0, scale, referenceBox.x, referenceBox.y]
    : rotation === 90
      ? [0, scale, -scale, 0, referenceBox.x + referenceBox.width, referenceBox.y]
      : rotation === 180
        ? [-scale, 0, 0, -scale, referenceBox.x + referenceBox.width, referenceBox.y + referenceBox.height]
        : [0, -scale, scale, 0, referenceBox.x, referenceBox.y + referenceBox.height]

  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(...matrix as [number, number, number, number, number, number]),
  )
  try {
    draw(visualDimensions)
  }
  finally {
    page.pushOperators(popGraphicsState())
  }
}

function writeAcroFormValue(
  field: PDFField,
  value: PdfScalar,
  type: CanonicalFieldType,
): boolean {
  // PDFButton is a push button. It must never be treated as a value field.
  if (field instanceof PDFButton || field instanceof PDFSignature) return false
  if (field.isReadOnly()) field.disableReadOnly()

  if (field instanceof PDFTextField) {
    field.setText(formatFieldValue(value, type))
    return true
  }

  if (field instanceof PDFCheckBox) {
    if (isMarked(value)) field.check()
    else field.uncheck()
    return true
  }

  if (field instanceof PDFRadioGroup) {
    if (value === null || value === undefined || value === '' || value === false) {
      field.clear()
      return true
    }

    field.select(formatFieldValue(value, type))
    return true
  }

  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    if (value === null || value === undefined || value === '') {
      field.clear()
      return true
    }

    field.select(formatFieldValue(value, type))
    return true
  }

  return false
}

function widgetPage(
  widget: PDFWidgetAnnotation,
  pagesByRef: ReadonlyMap<string, PDFPage>,
  pagesByAnnotationRef: ReadonlyMap<string, PDFPage>,
  pdf: PDFDocument,
) {
  const pageRef = widget.P()
  if (pageRef) {
    const page = pagesByRef.get(pageRef.toString())
    if (page) return page
  }

  const widgetRef = pdf.context.getObjectRef(widget.dict)
  if (widgetRef) return pagesByAnnotationRef.get(widgetRef.toString())
  return undefined
}

function placementOverrideWidgetRect(
  page: PDFPage,
  override: NonNullable<AcroFormTarget['placementOverrides']>[number],
) {
  const referenceBox = override.coordinateSpace.referenceBox === 'crop'
    ? page.getCropBox()
    : page.getMediaBox()
  const userUnit = pageUserUnit(page)
  if (!(userUnit > 0)) throw new Error(`Nieprawidłowy /UserUnit strony: ${userUnit}.`)

  const rotation = override.coordinateSpace.orientation === 'visual'
    ? normalizeRightAngle(page.getRotation().angle)
    : 0
  const referenceWidthPt = referenceBox.width * userUnit
  const referenceHeightPt = referenceBox.height * userUnit
  const visualHeightPt = rotation === 90 || rotation === 270
    ? referenceWidthPt
    : referenceHeightPt
  const box = override.coordinateSpace.origin === 'top-left'
    ? {
        ...override.box,
        y: visualHeightPt - override.box.y - override.box.height,
      }
    : override.box
  const x = box.x / userUnit
  const y = box.y / userUnit
  const width = box.width / userUnit
  const height = box.height / userUnit

  if (rotation === 90) {
    return {
      x: referenceBox.x + referenceBox.width - y - height,
      y: referenceBox.y + x,
      width: height,
      height: width,
    }
  }
  if (rotation === 180) {
    return {
      x: referenceBox.x + referenceBox.width - x - width,
      y: referenceBox.y + referenceBox.height - y - height,
      width,
      height,
    }
  }
  if (rotation === 270) {
    return {
      x: referenceBox.x + y,
      y: referenceBox.y + referenceBox.height - x - width,
      width: height,
      height: width,
    }
  }
  return {
    x: referenceBox.x + x,
    y: referenceBox.y + y,
    width,
    height,
  }
}

function prepareNativeAcroFormWidgets(
  field: PDFField,
  target: AcroFormTarget,
  pagesByRef: ReadonlyMap<string, PDFPage>,
  pagesByAnnotationRef: ReadonlyMap<string, PDFPage>,
  pdf: PDFDocument,
) {
  const widgets = field.acroField.getWidgets()

  for (const override of target.placementOverrides ?? []) {
    const widget = widgets[override.widgetIndex]
    if (!widget) {
      throw new Error(
        `Override pola AcroForm „${target.field}” wskazuje nieistniejący widget ${override.widgetIndex}.`,
      )
    }
    const currentPage = widgetPage(widget, pagesByRef, pagesByAnnotationRef, pdf)
    const overridePage = pdf.getPages()[override.page - 1]
    if (!currentPage) {
      throw new Error(`Nie można ustalić strony widgetu ${override.widgetIndex} pola „${target.field}”.`)
    }
    if (!overridePage) {
      throw new Error(`Nie istnieje strona ${override.page} wskazana przez override pola „${target.field}”.`)
    }
    if (!samePdfObject(currentPage.ref, overridePage.ref)) {
      throw new Error(
        `Przenoszenie widgetu pola AcroForm „${target.field}” pomiędzy stronami nie jest obsługiwane.`,
      )
    }
    widget.setRectangle(placementOverrideWidgetRect(overridePage, override))
  }

  if (field.isReadOnly()) field.disableReadOnly()
  for (const widget of widgets) {
    widget.clearFlag(AnnotationFlags.Invisible)
    widget.clearFlag(AnnotationFlags.Hidden)
    widget.clearFlag(AnnotationFlags.NoView)
    widget.clearFlag(AnnotationFlags.ToggleNoView)
    widget.clearFlag(AnnotationFlags.ReadOnly)
    widget.clearFlag(AnnotationFlags.LockedContents)
    widget.setFlag(AnnotationFlags.Print)
  }
}

function assertNativeAcroFormAppearances(
  pdf: PDFDocument,
  fields: ReadonlySet<PDFField>,
) {
  for (const field of fields) {
    for (const widget of field.acroField.getWidgets()) {
      const normal = widget.getAppearances()?.normal
      const appearances = normal instanceof PDFDict ? normal.values() : normal ? [normal] : []
      if (appearances.length === 0 || appearances.some((appearance) => {
        const stream = pdf.context.lookupMaybe(appearance, PDFStream)
        return !stream || stream.getContentsSize() === 0
      })) {
        throw new Error(`Pole AcroForm „${field.getName()}” nie ma poprawnego wyglądu /AP /N.`)
      }
    }
  }
}

function nativeDefaultAppearanceColor(color: PdfColor) {
  if (color.space === 'gray') return `${color.value} g`
  if (color.space === 'rgb') return `${color.red} ${color.green} ${color.blue} rg`
  return `${color.cyan} ${color.magenta} ${color.yellow} ${color.black} k`
}

function withAutoFitFontSize(defaultAppearance: string | undefined, font: PDFFont) {
  const fontName = font.name.startsWith('/') ? font.name.slice(1) : font.name
  if (!defaultAppearance) return `/${fontName} 0 Tf 0 g`

  const matches = [...defaultAppearance.matchAll(/\/([^\s/]+)\s+[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s+Tf/g)]
  const last = matches.at(-1)
  if (last?.index === undefined) return `${defaultAppearance}\n/${fontName} 0 Tf`

  const replacement = `/${last[1]} 0 Tf`
  return `${defaultAppearance.slice(0, last.index)}${replacement}${defaultAppearance.slice(last.index + last[0].length)}`
}

function enableNativeTextAutoFit(field: PDFTextField, font: PDFFont) {
  const fieldAppearance = field.acroField.getDefaultAppearance()
  field.acroField.setDefaultAppearance(withAutoFitFontSize(fieldAppearance, font))

  for (const widget of field.acroField.getWidgets()) {
    const widgetAppearance = widget.getDefaultAppearance()
    if (widgetAppearance) {
      widget.setDefaultAppearance(withAutoFitFontSize(widgetAppearance, font))
    }
  }
}

function updateNativeTextFieldAppearance(
  field: PDFTextField,
  target: AcroFormTarget,
  font: PDFFont,
) {
  const appearance = target.appearance
  if (appearance?.kind !== 'text') {
    field.defaultUpdateAppearances(font)
    enableNativeTextAutoFit(field, font)
    return
  }
  if (appearance.letterSpacingPt !== 0) {
    throw new Error('Natywny wygląd AcroForm nie obsługuje niestandardowego odstępu między literami.')
  }

  field.setAlignment(
    appearance.horizontalAlign === 'center'
      ? TextAlignment.Center
      : appearance.horizontalAlign === 'right'
        ? TextAlignment.Right
        : TextAlignment.Left,
  )

  const text = field.getText() ?? ''
  const fontName = font.name.startsWith('/') ? font.name.slice(1) : font.name
  for (const widget of field.acroField.getWidgets()) {
    const rect = widget.getRectangle()
    const borderWidth = widget.getBorderStyle()?.getWidth() ?? 0
    const rotation = normalizeRightAngle(
      widget.getAppearanceCharacteristics()?.getRotation() ?? 0,
    )
    const dimensions = rotation === 90 || rotation === 270
      ? { width: rect.height, height: rect.width }
      : rect
    const bounds = {
      x: borderWidth + appearance.paddingPt.left,
      y: borderWidth + appearance.paddingPt.bottom,
      width: dimensions.width
        - borderWidth * 2
        - appearance.paddingPt.left
        - appearance.paddingPt.right,
      height: dimensions.height
        - borderWidth * 2
        - appearance.paddingPt.top
        - appearance.paddingPt.bottom,
    }
    const layout = resolveTextLayout(text, font, bounds, appearance)
    const defaultAppearance = `/${fontName} ${layout.fontSize} Tf ${nativeDefaultAppearanceColor(appearance.color)}`
    widget.setDefaultAppearance(defaultAppearance)
    field.acroField.setDefaultAppearance(defaultAppearance)
  }

  // Generate a native /AP /N using the fitted font size recorded in each
  // widget's /DA. Afterwards restore font-size 0 in the effective /DA: the
  // generated /AP stays deterministic, while a PDF viewer can auto-fit a
  // value that an expert edits later.
  field.defaultUpdateAppearances(font)
  enableNativeTextAutoFit(field, font)
}

function renderLegacyOverlay(
  target: LegacyOverlayTarget,
  type: CanonicalFieldType,
  value: PdfScalar,
  pages: readonly PDFPage[],
  font: PDFFont,
  origin: DocumentTemplate['overlayOrigin'],
) {
  const page = pages[target.page - 1]
  if (!page) {
    throw new Error(`Nie istnieje strona ${target.page} wskazana przez target overlay.`)
  }

  const width = target.width ?? Math.max(10, page.getWidth() - target.x)
  const height = target.height ?? Math.max(10, (target.fontSize ?? 10) * 1.4)
  const y = origin === 'top-left'
    ? page.getHeight() - target.y - height
    : target.y
  const rect = { x: target.x, y, width, height }

  if (target.format === 'mark') {
    if (isMarked(value)) drawMarkInRect(page, rect)
    return
  }

  drawTextInRect(page, font, formatFieldValue(value, type), rect, {
    fontSize: target.fontSize,
    multiline: type === 'textarea',
  })
}

function renderPreciseOverlay(
  target: PreciseOverlayTarget,
  type: CanonicalFieldType,
  value: PdfScalar,
  pages: readonly PDFPage[],
  font: PDFFont,
) {
  const page = pages[target.page - 1]
  if (!page) {
    throw new Error(`Nie istnieje strona ${target.page} wskazana przez target overlay.`)
  }

  withCoordinateSpace(page, target.coordinateSpace, ({ height }) => {
    const rect = target.coordinateSpace.origin === 'top-left'
      ? {
          ...target.box,
          y: height - target.box.y - target.box.height,
        }
      : target.box

    if (target.appearance.kind === 'mark') {
      drawPreciseMarkInRect(page, rect, target.appearance, isMarked(value))
      return
    }

    drawPreciseTextInRect(
      page,
      font,
      formatFieldValue(value, type),
      rect,
      target.appearance,
    )
  })
}

function renderOverlay(
  target: OverlayTarget,
  type: CanonicalFieldType,
  value: PdfScalar,
  pages: readonly PDFPage[],
  font: PDFFont,
  origin: DocumentTemplate['overlayOrigin'],
) {
  if (target.rendererVersion === 2) {
    renderPreciseOverlay(target, type, value, pages, font)
    return
  }

  renderLegacyOverlay(target, type, value, pages, font, origin)
}

function templateIsPko(template: DocumentTemplate) {
  if (template.bank === 'pko-bp') return true

  const candidates = [template.label, template.source.fileName]

  return candidates.some((value) => {
    const normalized = value.toLocaleLowerCase('pl-PL')
    return /(^|\W)pko(\W|$)/i.test(normalized)
      || normalized.includes('powszechna kasa oszczędności')
  })
}

function samePdfObject(left: { toString(): string }, right: { toString(): string }) {
  return left === right || left.toString() === right.toString()
}

function removeFromArray(array: PDFArray | undefined, object: { toString(): string }) {
  if (!array) return

  for (let index = array.size() - 1; index >= 0; index -= 1) {
    if (samePdfObject(array.get(index), object)) array.remove(index)
  }
}

function disablePkoErrorLayer(pdf: PDFDocument) {
  const ocProperties = pdf.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict)
  const ocgs = ocProperties?.lookupMaybe(PDFName.of('OCGs'), PDFArray)
  if (!ocProperties || !ocgs) return

  let defaultConfig = ocProperties.lookupMaybe(PDFName.of('D'), PDFDict)
  if (!defaultConfig) {
    defaultConfig = PDFDict.withContext(pdf.context)
    ocProperties.set(PDFName.of('D'), defaultConfig)
  }

  let off = defaultConfig.lookupMaybe(PDFName.of('OFF'), PDFArray)
  if (!off) {
    off = PDFArray.withContext(pdf.context)
    defaultConfig.set(PDFName.of('OFF'), off)
  }
  const on = defaultConfig.lookupMaybe(PDFName.of('ON'), PDFArray)

  for (const ocg of ocgs.asArray()) {
    const dictionary = pdf.context.lookupMaybe(ocg, PDFDict)
    const name = dictionary?.lookupMaybe(
      PDFName.of('Name'),
      PDFString,
      PDFHexString,
    )?.decodeText()

    if (name?.trim().toLocaleLowerCase('pl-PL') !== 'error') continue

    removeFromArray(on, ocg)
    if (!off.asArray().some(item => samePdfObject(item, ocg))) off.push(ocg)
  }
}

function sanitizeInteractiveFormActions(
  pdf: PDFDocument,
  form: ReturnType<PDFDocument['getForm']>,
) {
  const action = PDFName.of('A')
  const additionalActions = PDFName.of('AA')

  // Bank sources may ship document and field scripts that recalculate or
  // reset values on open/focus (PKO does). The generated PDF already contains
  // authoritative values and appearances, so executable hooks must not survive.
  pdf.catalog.delete(PDFName.of('OpenAction'))
  pdf.catalog.delete(additionalActions)
  const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  names?.delete(PDFName.of('JavaScript'))

  form.acroForm.dict.delete(PDFName.of('CO'))
  form.acroForm.dict.delete(PDFName.of('NeedAppearances'))
  form.acroForm.dict.delete(additionalActions)

  for (const [acroField] of form.acroForm.getAllFields()) {
    acroField.dict.delete(action)
    acroField.dict.delete(additionalActions)
  }
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      widget.dict.delete(action)
      widget.dict.delete(additionalActions)
    }
  }

  for (const page of pdf.getPages()) {
    page.node.delete(additionalActions)
    for (const annotation of page.node.Annots()?.asArray() ?? []) {
      const dictionary = pdf.context.lookupMaybe(annotation, PDFDict)
      dictionary?.delete(action)
      dictionary?.delete(additionalActions)
    }
  }
}

export async function fillPdfTemplate(
  template: DocumentTemplate,
  sourceBytes: Uint8Array,
  fontBytes: Uint8Array,
  values: FlatPdfValues,
) {
  const fillMethod = resolveTemplateFillMethod(template)
  if (fillMethod.kind === 'web_form' || fillMethod.kind === 'api') {
    throw new UnsupportedMultiformFillMethodError(fillMethod.kind)
  }
  if (fillMethod.kind === 'xlsx_native' || fillMethod.kind === 'xlsx_manual') {
    throw new Error(`Metoda „${fillMethod.kind}” wymaga renderera XLSX.`)
  }
  if (
    (fillMethod.kind === 'pdf_manual' || fillMethod.kind === 'pdf_readonly')
    && template.bindings.length > 0
  ) {
    throw new Error(`Metoda „${fillMethod.kind}” nie może zawierać automatycznych mapowań pól.`)
  }
  const acceptsAcroForm = fillMethod.kind === 'pdf_acroform' || fillMethod.kind === 'pdf_hybrid'
  const acceptsOverlay = fillMethod.kind === 'pdf_overlay' || fillMethod.kind === 'pdf_hybrid'

  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  const form = pdf.getForm()
  form.deleteXFA()
  sanitizeInteractiveFormActions(pdf, form)

  if (fillMethod.kind === 'pdf_manual' || fillMethod.kind === 'pdf_readonly') {
    return pdf.save({ updateFieldAppearances: false })
  }

  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(fontBytes, { subset: true })

  const pages = pdf.getPages()
  const pagesByRef = new Map(pages.map(page => [page.ref.toString(), page]))
  const pagesByAnnotationRef = new Map<string, PDFPage>()
  for (const page of pages) {
    for (const annotation of page.node.Annots()?.asArray() ?? []) {
      pagesByAnnotationRef.set(annotation.toString(), page)
    }
  }
  const nativeAcroFormFields = new Set<PDFField>()
  const nativeAcroFormFieldsByName = new Map<string, PDFField>()
  const nativeAcroFormBindingsByName = new Map<string, {
    canonicalKey: string
    target: AcroFormTarget
  }>()

  for (const binding of template.bindings) {
    if (binding.target.kind === 'overlay' && !acceptsOverlay) {
      throw new Error(
        `Metoda „${fillMethod.kind}” nie obsługuje targetu overlay „${binding.canonicalKey}”.`,
      )
    }
    if (binding.target.kind === 'acroform' && !acceptsAcroForm) {
      throw new Error(
        `Metoda „${fillMethod.kind}” nie obsługuje targetu AcroForm „${binding.canonicalKey}”.`,
      )
    }
  }

  // Visibility and editability belong to the template mapping, not to whether
  // this particular request happened to contain a value. This is especially
  // important for PKO, whose optional source widgets start as Hidden+Print.
  if (acceptsAcroForm) {
    for (const binding of template.bindings) {
      if (binding.target.kind !== 'acroform') continue
      const field = form.getFieldMaybe(binding.target.field)
      if (!field) {
        throw new Error(`Pole AcroForm „${binding.target.field}” nie istnieje w dokumencie.`)
      }
      prepareNativeAcroFormWidgets(
        field,
        binding.target,
        pagesByRef,
        pagesByAnnotationRef,
        pdf,
      )
      nativeAcroFormFields.add(field)
      nativeAcroFormFieldsByName.set(binding.target.field, field)
      nativeAcroFormBindingsByName.set(binding.target.field, {
        canonicalKey: binding.canonicalKey,
        target: binding.target,
      })
    }
  }

  for (const binding of template.bindings) {
    if (!conditionMatches(binding, values)) continue

    let resolved: ReturnType<typeof resolveBindingValue>
    try {
      resolved = resolveBindingValue(binding, values)
    }
    catch (error) {
      rethrowPdfValueError(binding.canonicalKey, error)
    }
    if (!resolved.present) continue

    const rawValue = resolved.value
    const type = bindingType(binding)
    assertCanonicalMaxLength(binding.canonicalKey, rawValue, type)

    if (binding.target.kind === 'unmapped') continue

    if (binding.target.kind === 'overlay') {
      try {
        renderOverlay(
          binding.target,
          type,
          overlayBindingValue(binding, rawValue),
          pages,
          font,
          template.overlayOrigin,
        )
      }
      catch (error) {
        rethrowPdfValueError(binding.canonicalKey, error)
      }
      continue
    }

    if (binding.target.kind === 'xlsx_cell') {
      throw new Error(`Metoda „${fillMethod.kind}” nie obsługuje targetu XLSX „${binding.canonicalKey}”.`)
    }

    const target = binding.target
    const field = nativeAcroFormFieldsByName.get(target.field) ?? form.getFieldMaybe(target.field)
    if (!field) {
      throw new Error(`Pole AcroForm „${target.field}” nie istnieje w dokumencie.`)
    }

    const mapped = mapTargetValue(rawValue, target.valueMap)
    if (!mapped.matched && !(field instanceof PDFCheckBox)) continue

    // For an individual checkbox valueMap is a selection predicate: when the
    // canonical value matches this target, the target must be checked even if
    // the PDF's own export value is a falsy-looking string such as `nie`.
    // PDFCheckBox.check() writes the widget's real on-value into /V.
    const mappedValue = field instanceof PDFCheckBox && target.valueMap
      ? mapped.matched
      : mapped.matched
        ? mapped.value
        : false
    try {
      if (!writeAcroFormValue(field, mappedValue, type)) continue
    }
    catch (error) {
      rethrowPdfValueError(binding.canonicalKey, error)
    }
  }

  if (nativeAcroFormFields.size > 0) {
    for (const [fieldName, binding] of nativeAcroFormBindingsByName) {
      const field = nativeAcroFormFieldsByName.get(fieldName)
      if (!(field instanceof PDFTextField)) continue
      try {
        updateNativeTextFieldAppearance(field, binding.target, font)
      }
      catch (error) {
        rethrowPdfValueError(binding.canonicalKey, error)
      }
    }
    form.updateFieldAppearances(font)
    assertNativeAcroFormAppearances(pdf, nativeAcroFormFields)
  }
  if (templateIsPko(template)) disablePkoErrorLayer(pdf)

  return pdf.save({ updateFieldAppearances: false })
}

const archiveNameEncoder = new TextEncoder()
const windowsReservedNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function truncateUtf8(value: string, maxBytes: number) {
  if (archiveNameEncoder.encode(value).byteLength <= maxBytes) return value
  let truncated = ''
  for (const character of value) {
    if (archiveNameEncoder.encode(`${truncated}${character}`).byteLength > maxBytes) break
    truncated += character
  }
  return truncated
}

function truncateArchiveBaseName(fileName: string, maxBytes = 120) {
  if (archiveNameEncoder.encode(fileName).byteLength <= maxBytes) return fileName

  const extensionIndex = fileName.lastIndexOf('.')
  const extension = extensionIndex > 0 && fileName.length - extensionIndex <= 13
    ? fileName.slice(extensionIndex)
    : ''
  const stem = extension ? fileName.slice(0, extensionIndex) : fileName
  const allowedStemBytes = Math.max(1, maxBytes - archiveNameEncoder.encode(extension).byteLength)
  const truncatedStem = truncateUtf8(stem, allowedStemBytes)
  return `${truncatedStem || 'plik'}${extension}`
}

export function safeArchiveBaseName(fileName: string, fallback = 'dokument') {
  const normalized = fileName
    .normalize('NFC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replaceAll('\\', '/')
  const basename = normalized.split('/').pop() ?? ''
  let safeName = basename
    .replace(/[\u0000-\u001F\u007F]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/g, '')
    .replace(/[. ]+$/g, '')

  if (!safeName || safeName === '.' || safeName === '..') safeName = fallback
  if (windowsReservedNamePattern.test(safeName)) safeName = `_${safeName}`
  return truncateArchiveBaseName(safeName)
}

export function safeArchiveDirectoryName(directoryName: string, fallback = 'Bank') {
  return safeArchiveBaseName(directoryName, fallback).replaceAll('/', '-')
}

function safePdfName(fileName: string) {
  const safeName = safeArchiveBaseName(fileName, 'dokument.pdf')
  return safeName.toLocaleLowerCase('pl-PL').endsWith('.pdf')
    ? safeName
    : truncateArchiveBaseName(`${safeName}.pdf`)
}

function safeTemplateDocumentName(fileName: string, template: DocumentTemplate) {
  const method = resolveTemplateFillMethod(template)
  if (method.kind === 'xlsx_native' || method.kind === 'xlsx_manual') {
    const safeName = safeArchiveBaseName(fileName, 'dokument.xlsx')
    return safeName.toLocaleLowerCase('pl-PL').endsWith('.xlsx')
      ? safeName
      : truncateArchiveBaseName(`${safeName}.xlsx`)
  }
  return safePdfName(fileName)
}

function archiveNameKey(value: string) {
  return value.normalize('NFC').toLocaleLowerCase('pl-PL')
}

export function uniqueArchiveEntryName(
  directory: string,
  preferredName: string,
  usedNames: Set<string>,
) {
  const extensionIndex = preferredName.lastIndexOf('.')
  const stem = extensionIndex > 0 ? preferredName.slice(0, extensionIndex) : preferredName
  const extension = extensionIndex > 0 ? preferredName.slice(extensionIndex) : ''
  let index = 1
  let candidate = preferredName
  let entryName = `${directory}/${candidate}`

  while (usedNames.has(archiveNameKey(entryName))) {
    index += 1
    const suffix = `-${index}`
    const reservedBytes = archiveNameEncoder.encode(`${suffix}${extension}`).byteLength
    candidate = `${truncateUtf8(stem, Math.max(1, 120 - reservedBytes)) || 'plik'}${suffix}${extension}`
    entryName = `${directory}/${candidate}`
  }

  usedNames.add(archiveNameKey(entryName))
  return entryName
}

export async function fillDocumentTemplate(
  template: DocumentTemplate,
  sourceBytes: Uint8Array,
  fontBytes: Uint8Array,
  values: FlatPdfValues,
) {
  const method = resolveTemplateFillMethod(template)
  if (method.kind === 'xlsx_native' || method.kind === 'xlsx_manual') {
    return fillXlsxTemplate(template, sourceBytes, values)
  }
  return fillPdfTemplate(template, sourceBytes, fontBytes, values)
}

export async function createDocumentBundle(
  documents: readonly PdfBundleDocument[],
  fontBytes: Uint8Array,
  values: FlatPdfValues,
  attachments: readonly PdfBundleAttachment[] = [],
  options: { password?: string } = {},
) {
  const files: Record<string, Uint8Array> = {}
  const usedNames = new Set<string>()

  for (const document of documents) {
    const filled = await fillDocumentTemplate(
      document.template,
      document.sourceBytes,
      fontBytes,
      values,
    )
    const fillMethod = resolveTemplateFillMethod(document.template)
    const requestedName = document.outputName
      ? safeTemplateDocumentName(document.outputName, document.template)
      : ['pdf_manual', 'pdf_readonly'].includes(resolveTemplateFillMethod(document.template).kind)
        || fillMethod.kind === 'xlsx_manual'
        ? safeTemplateDocumentName(document.fileName, document.template)
        : `uzupelniony-${safeTemplateDocumentName(document.fileName, document.template)}`
    const preferredName = safeTemplateDocumentName(requestedName, document.template)
    const directory = document.directory
      ? `${safeArchiveDirectoryName(document.directory)}/01-wnioski`
      : '01-wnioski'
    files[uniqueArchiveEntryName(directory, preferredName, usedNames)] = filled
  }

  for (const [index, attachment] of attachments.entries()) {
    const preferredName = safeArchiveBaseName(
      attachment.fileName,
      `zalacznik-${index + 1}`,
    )
    const directory = attachment.directory
      ? `${safeArchiveDirectoryName(attachment.directory)}/02-dokumenty`
      : '02-zalaczniki'
    files[uniqueArchiveEntryName(directory, preferredName, usedNames)] = attachment.bytes
  }

  if (options.password) {
    const writer = new ZipWriter(new Uint8ArrayWriter(), {
      password: options.password,
      encryptionStrength: 3,
      level: 6,
    })
    for (const [fileName, bytes] of Object.entries(files)) {
      await writer.add(fileName, new Uint8ArrayReader(bytes))
    }
    return writer.close()
  }

  return zipSync(files, { level: 6 })
}

/** @deprecated Use createDocumentBundle; retained for existing callers and tests. */
export const createPdfBundle = createDocumentBundle
