import fontkit from '@pdf-lib/fontkit'
import {
  CANONICAL_FIELDS,
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

export interface PdfBundleDocument {
  fileName: string
  template: DocumentTemplate
  sourceBytes: Uint8Array
  outputName?: string
}

export interface PdfBundleAttachment {
  fileName: string
  bytes: Uint8Array
  mimeType?: string
}

interface PdfRect {
  x: number
  y: number
  width: number
  height: number
}

type StaticAcroValue
  = | { kind: 'text', text: string, multiline: boolean }
    | { kind: 'check', marked: boolean }
    | { kind: 'radio', selected: string | null }

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
  CANONICAL_FIELDS.map(field => [field.canonicalKey, field.type]),
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
    case 'date.ddMMyyyy':
      return formatPolishDate(sourceValues[0])
    case 'landRegister.part1':
      return landRegisterParts(sourceValues[0])[0]
    case 'landRegister.part2':
      return landRegisterParts(sourceValues[0])[1]
    case 'landRegister.part3':
      return landRegisterParts(sourceValues[0])[2]
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
  if (binding.computed) return 'text'

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

function defaultTextAppearance(
  type: CanonicalFieldType,
  field?: PDFTextField,
): PdfTextAppearance {
  const alignment = field?.getAlignment()
  const maxLength = field?.getMaxLength()
  const isComb = Boolean(field?.isCombed() && maxLength)

  return {
    kind: 'text',
    fontId: 'dm-sans-regular',
    fontSizePt: 10,
    minFontSizePt: 5,
    letterSpacingPt: 0,
    lineHeightPt: 11,
    wrap: type === 'textarea' || field?.isMultiline() ? 'word' : 'none',
    overflow: 'shrink',
    horizontalAlign: alignment === TextAlignment.Center
      ? 'center'
      : alignment === TextAlignment.Right
        ? 'right'
        : 'left',
    verticalAlign: 'middle',
    distribution: isComb
      ? { kind: 'comb', cells: maxLength! }
      : { kind: 'flow' },
    color: { space: 'gray', value: 0 },
    opacity: 1,
    paddingPt: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 },
  }
}

function defaultMarkAppearance(role: 'checkbox' | 'radio'): PdfMarkAppearance {
  const black = { space: 'gray', value: 0 } as const
  return {
    kind: 'mark',
    role,
    glyph: role === 'radio' ? 'dot' : 'x',
    color: black,
    opacity: 1,
    insetPt: role === 'radio' ? 2.5 : 1.5,
    strokeWidthPt: 1,
    outline: {
      shape: role === 'radio' ? 'circle' : 'square',
      color: black,
      strokeWidthPt: 0.6,
    },
  }
}

function writeAcroFormValue(
  field: PDFField,
  value: PdfScalar,
  type: CanonicalFieldType,
): StaticAcroValue | null {
  // PDFButton is a push button. It must never be treated as a value field.
  if (field instanceof PDFButton || field instanceof PDFSignature) return null
  if (field.isReadOnly()) field.disableReadOnly()

  if (field instanceof PDFTextField) {
    const text = formatFieldValue(value, type)
    field.setText(text)
    return { kind: 'text', text, multiline: type === 'textarea' }
  }

  if (field instanceof PDFCheckBox) {
    const marked = isMarked(value)
    if (marked) field.check()
    else field.uncheck()
    return { kind: 'check', marked }
  }

  if (field instanceof PDFRadioGroup) {
    if (value === null || value === undefined || value === '' || value === false) {
      field.clear()
      return { kind: 'radio', selected: null }
    }

    const selected = formatFieldValue(value, type)
    field.select(selected)
    return { kind: 'radio', selected }
  }

  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    if (value === null || value === undefined || value === '') {
      field.clear()
      return { kind: 'text', text: '', multiline: false }
    }

    const selected = formatFieldValue(value, type)
    field.select(selected)
    return { kind: 'text', text: selected, multiline: false }
  }

  return null
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

function renderStaticAcroValue(
  field: PDFField,
  staticValue: StaticAcroValue,
  type: CanonicalFieldType,
  target: AcroFormTarget,
  pagesByRef: ReadonlyMap<string, PDFPage>,
  pagesByAnnotationRef: ReadonlyMap<string, PDFPage>,
  pdf: PDFDocument,
  font: PDFFont,
) {
  const widgets = field.acroField.getWidgets()

  for (const [widgetIndex, widget] of widgets.entries()) {
    const placementOverride = target.placementOverrides?.find(item => item.widgetIndex === widgetIndex)
    const page = placementOverride
      ? pdf.getPages()[placementOverride.page - 1]
      : widgetPage(widget, pagesByRef, pagesByAnnotationRef, pdf)
    if (!page) continue

    const widgetRect = widget.getRectangle()
    const mediaBox = page.getMediaBox()
    const userUnit = pageUserUnit(page)
    const coordinateSpace = placementOverride?.coordinateSpace ?? {
      units: 'pt' as const,
      referenceBox: 'media' as const,
      origin: 'bottom-left' as const,
      orientation: 'unrotated' as const,
    }
    const sourceRect = placementOverride?.box ?? {
      x: (widgetRect.x - mediaBox.x) * userUnit,
      y: (widgetRect.y - mediaBox.y) * userUnit,
      width: widgetRect.width * userUnit,
      height: widgetRect.height * userUnit,
    }

    withCoordinateSpace(page, coordinateSpace, ({ height }) => {
      const rect = coordinateSpace.origin === 'top-left'
        ? { ...sourceRect, y: height - sourceRect.y - sourceRect.height }
        : sourceRect
      if (staticValue.kind === 'text') {
        const appearance = target.appearance?.kind === 'text'
          ? target.appearance
          : defaultTextAppearance(type, field instanceof PDFTextField ? field : undefined)
        drawPreciseTextInRect(page, font, staticValue.text, rect, appearance)
      }
      else if (staticValue.kind === 'check') {
        const appearance = target.appearance?.kind === 'mark'
          ? target.appearance
          : defaultMarkAppearance('checkbox')
        drawPreciseMarkInRect(page, rect, appearance, staticValue.marked)
      }
      else if (staticValue.kind === 'radio') {
        const appearance = target.appearance?.kind === 'mark'
          ? target.appearance
          : defaultMarkAppearance('radio')
        const onValue = widget.getOnValue()
        const selectedValue = field instanceof PDFRadioGroup
          ? field.acroField.getValue()
          : undefined
        const marked = Boolean(
          staticValue.selected
          && onValue
          && selectedValue
          && onValue.toString() === selectedValue.toString(),
        )
        drawPreciseMarkInRect(page, rect, appearance, marked)
      }
    })

    // The value remains in /V, while the targeted widget cannot cover or
    // duplicate the deterministic page content in PDF viewers.
    widget.setFlag(AnnotationFlags.Hidden)
  }
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

export async function fillPdfTemplate(
  template: DocumentTemplate,
  sourceBytes: Uint8Array,
  fontBytes: Uint8Array,
  values: FlatPdfValues,
) {
  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(fontBytes, { subset: true })
  const form = pdf.getForm()
  form.deleteXFA()

  const pages = pdf.getPages()
  const pagesByRef = new Map(pages.map(page => [page.ref.toString(), page]))
  const pagesByAnnotationRef = new Map<string, PDFPage>()
  for (const page of pages) {
    for (const annotation of page.node.Annots()?.asArray() ?? []) {
      pagesByAnnotationRef.set(annotation.toString(), page)
    }
  }
  let changedAcroForm = false

  for (const binding of template.bindings) {
    if (!conditionMatches(binding, values)) continue

    const resolved = resolveBindingValue(binding, values)
    if (!resolved.present) continue

    const rawValue = resolved.value
    const type = bindingType(binding)

    if (binding.target.kind === 'unmapped') continue

    if (binding.target.kind === 'overlay') {
      renderOverlay(binding.target, type, rawValue, pages, font, template.overlayOrigin)
      continue
    }

    const target = binding.target
    const field = form.getFieldMaybe(target.field)
    if (!field) {
      throw new Error(`Pole AcroForm „${target.field}” nie istnieje w dokumencie.`)
    }

    const mapped = mapTargetValue(rawValue, target.valueMap)
    if (!mapped.matched && !(field instanceof PDFCheckBox)) continue

    const mappedValue = mapped.matched ? mapped.value : false
    const staticValue = writeAcroFormValue(field, mappedValue, type)
    if (!staticValue) continue

    renderStaticAcroValue(
      field,
      staticValue,
      type,
      target,
      pagesByRef,
      pagesByAnnotationRef,
      pdf,
      font,
    )
    changedAcroForm = true
  }

  if (changedAcroForm) form.updateFieldAppearances(font)
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

function safePdfName(fileName: string) {
  const safeName = safeArchiveBaseName(fileName, 'dokument.pdf')
  return safeName.toLocaleLowerCase('pl-PL').endsWith('.pdf')
    ? safeName
    : truncateArchiveBaseName(`${safeName}.pdf`)
}

function archiveNameKey(value: string) {
  return value.normalize('NFC').toLocaleLowerCase('pl-PL')
}

export function uniqueArchiveEntryName(
  directory: '01-wnioski' | '02-zalaczniki',
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

export async function createPdfBundle(
  documents: readonly PdfBundleDocument[],
  fontBytes: Uint8Array,
  values: FlatPdfValues,
  attachments: readonly PdfBundleAttachment[] = [],
) {
  const files: Record<string, Uint8Array> = {}
  const usedNames = new Set<string>()

  for (const document of documents) {
    const filled = await fillPdfTemplate(
      document.template,
      document.sourceBytes,
      fontBytes,
      values,
    )
    const requestedName = document.outputName
      ? safePdfName(document.outputName)
      : `uzupelniony-${safePdfName(document.fileName)}`
    const preferredName = safePdfName(requestedName)
    files[uniqueArchiveEntryName('01-wnioski', preferredName, usedNames)] = filled
  }

  for (const [index, attachment] of attachments.entries()) {
    const preferredName = safeArchiveBaseName(
      attachment.fileName,
      `zalacznik-${index + 1}`,
    )
    files[uniqueArchiveEntryName('02-zalaczniki', preferredName, usedNames)] = attachment.bytes
  }

  return zipSync(files, { level: 6 })
}
