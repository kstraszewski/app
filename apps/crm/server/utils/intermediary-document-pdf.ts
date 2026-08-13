import fontkit from '@pdf-lib/fontkit'
import {
  degrees,
  PDFDocument,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import {
  INTERMEDIARY_DOCUMENT_GENERATOR_VERSION,
  type IntermediaryDocumentContent,
} from './intermediary-document-content.ts'

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN_X = 52
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2
const CONTENT_BOTTOM = 58

export interface IntermediaryDocumentPdfOptions {
  fontBytes: Uint8Array
  primaryColor?: string
}

export class OfiSinglePageOverflowError extends Error {
  readonly code = 'OFI_SINGLE_PAGE_OVERFLOW' as const
  readonly requiredHeight: number
  readonly availableHeight: number

  constructor(
    requiredHeight: number,
    availableHeight: number,
  ) {
    super(
      `OFI_SINGLE_PAGE_OVERFLOW: dokument wymaga ${requiredHeight.toFixed(1)} pkt, dostępne ${availableHeight.toFixed(1)} pkt`,
    )
    this.name = 'OfiSinglePageOverflowError'
    this.requiredHeight = requiredHeight
    this.availableHeight = availableHeight
  }
}

export class RodoSinglePageOverflowError extends Error {
  readonly code = 'RODO_SINGLE_PAGE_OVERFLOW' as const
  readonly requiredHeight: number
  readonly availableHeight: number

  constructor(
    requiredHeight: number,
    availableHeight: number,
  ) {
    super(
      `RODO_SINGLE_PAGE_OVERFLOW: dokument wymaga ${requiredHeight.toFixed(1)} pkt, dostępne ${availableHeight.toFixed(1)} pkt`,
    )
    this.name = 'RodoSinglePageOverflowError'
    this.requiredHeight = requiredHeight
    this.availableHeight = availableHeight
  }
}

type PdfColor = ReturnType<typeof rgb>

interface OfiLayoutProfile {
  name: 'standard' | 'compact'
  marginX: number
  top: number
  bottom: number
  organizationSize: number
  titleSize: number
  titleLineHeight: number
  subtitleSize: number
  subtitleLineHeight: number
  legalSize: number
  legalLineHeight: number
  warningSize: number
  warningLineHeight: number
  sectionTitleSize: number
  sectionTitleLineHeight: number
  labelSize: number
  labelLineHeight: number
  valueSize: number
  valueLineHeight: number
  cardPaddingX: number
  cardPaddingY: number
  cardGap: number
  columnGap: number
  sectionGap: number
}

interface OfiCardLayout {
  kind: 'item'
  x: number
  width: number
  height: number
  labelLines: string[]
  valueLines: string[]
}

interface OfiLendersLayout {
  kind: 'lenders'
  x: number
  width: number
  height: number
  labelLines: string[]
  columns: string[][][]
}

type OfiCellLayout = OfiCardLayout | OfiLendersLayout

interface OfiRowLayout {
  height: number
  cells: OfiCellLayout[]
}

interface OfiSectionLayout {
  titleLines: string[]
  titleHeight: number
  paragraphLines: string[][]
  paragraphHeight: number
  rows: OfiRowLayout[]
  height: number
}

interface OfiPageLayout {
  profile: OfiLayoutProfile
  contentWidth: number
  organizationLines: string[]
  titleLines: string[]
  subtitleLines: string[]
  legalLines: string[]
  warningLines: string[]
  headerHeight: number
  sections: OfiSectionLayout[]
  sectionsHeight: number
  requiredHeight: number
}

const OFI_LAYOUT_PROFILES: OfiLayoutProfile[] = [
  {
    name: 'standard',
    marginX: 38,
    top: 34,
    bottom: 52,
    organizationSize: 8.8,
    titleSize: 17.5,
    titleLineHeight: 21,
    subtitleSize: 8.4,
    subtitleLineHeight: 10.5,
    legalSize: 6.9,
    legalLineHeight: 8.7,
    warningSize: 7,
    warningLineHeight: 8.8,
    sectionTitleSize: 9.2,
    sectionTitleLineHeight: 11,
    labelSize: 6,
    labelLineHeight: 7.2,
    valueSize: 8.2,
    valueLineHeight: 9.7,
    cardPaddingX: 7,
    cardPaddingY: 5.5,
    cardGap: 4.5,
    columnGap: 6,
    sectionGap: 6,
  },
  {
    name: 'compact',
    marginX: 34,
    top: 29,
    bottom: 48,
    organizationSize: 8.2,
    titleSize: 16,
    titleLineHeight: 18.5,
    subtitleSize: 7.8,
    subtitleLineHeight: 9.5,
    legalSize: 6.25,
    legalLineHeight: 7.7,
    warningSize: 6.35,
    warningLineHeight: 7.8,
    sectionTitleSize: 8.45,
    sectionTitleLineHeight: 10,
    labelSize: 5.5,
    labelLineHeight: 6.5,
    valueSize: 7.5,
    valueLineHeight: 8.8,
    cardPaddingX: 6,
    cardPaddingY: 4.5,
    cardGap: 3.5,
    columnGap: 5,
    sectionGap: 3.3,
  },
]

function colorFromHex(value: string | undefined) {
  const normalized = /^#[0-9a-f]{6}$/iu.test(value ?? '') ? value!.slice(1) : '111827'
  return rgb(
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
  )
}

function safePdfDate(value: string): Date {
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? new Date('2000-01-01T00:00:00.000Z') : parsed
}

function splitLongWord(word: string, font: PDFFont, size: number, width: number): string[] {
  if (font.widthOfTextAtSize(word, size) <= width) return [word]
  const parts: string[] = []
  let current = ''
  for (const character of word) {
    const candidate = `${current}${character}`
    if (current && font.widthOfTextAtSize(candidate, size) > width) {
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

export function wrapIntermediaryDocumentText(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const result: string[] = []
  for (const paragraph of String(text).replaceAll('\r\n', '\n').split('\n')) {
    if (!paragraph.trim()) {
      result.push('')
      continue
    }
    const words = paragraph.trim().split(/\s+/u)
      .flatMap(word => splitLongWord(word, font, size, width))
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (line && font.widthOfTextAtSize(candidate, size) > width) {
        result.push(line)
        line = word
      }
      else {
        line = candidate
      }
    }
    if (line) result.push(line)
  }
  return result.length ? result : ['']
}

function pdfDateLabel(value: string): string {
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'long',
    timeZone: 'Europe/Warsaw',
  }).format(safePdfDate(value))
}

function splitOfiLenderNames(value: string): string[] {
  const normalized = value.trim()
  if (!normalized || normalized === 'Nie uzupełniono') return [normalized || 'Nie uzupełniono']
  return normalized.split(/,\s+/u).map(name => name.trim()).filter(Boolean)
}

function measureOfiCard(
  label: string,
  value: string,
  x: number,
  width: number,
  font: PDFFont,
  profile: OfiLayoutProfile,
): OfiCardLayout {
  const innerWidth = width - profile.cardPaddingX * 2
  const labelLines = wrapIntermediaryDocumentText(
    label.toLocaleUpperCase('pl-PL'),
    font,
    profile.labelSize,
    innerWidth,
  )
  const valueLines = wrapIntermediaryDocumentText(value, font, profile.valueSize, innerWidth)
  return {
    kind: 'item',
    x,
    width,
    labelLines,
    valueLines,
    height: profile.cardPaddingY * 2
      + labelLines.length * profile.labelLineHeight
      + 1.5
      + valueLines.length * profile.valueLineHeight,
  }
}

function measureOfiLenders(
  label: string,
  value: string,
  values: readonly string[] | undefined,
  width: number,
  font: PDFFont,
  profile: OfiLayoutProfile,
): OfiLendersLayout {
  const innerWidth = width - profile.cardPaddingX * 2
  const labelLines = wrapIntermediaryDocumentText(
    label.toLocaleUpperCase('pl-PL'),
    font,
    profile.labelSize,
    innerWidth,
  )
  const lenderNames = values?.length
    ? values.map(name => name.trim()).filter(Boolean)
    : splitOfiLenderNames(value)
  const columnCount = lenderNames.length > 1 ? 2 : 1
  const lenderColumnGap = columnCount === 2 ? profile.columnGap : 0
  const lenderColumnWidth = (innerWidth - lenderColumnGap) / columnCount
  const splitAt = Math.ceil(lenderNames.length / columnCount)
  const lenderColumns = columnCount === 2
    ? [lenderNames.slice(0, splitAt), lenderNames.slice(splitAt)]
    : [lenderNames]
  const columns = lenderColumns.map(names => names.map((name) => {
    const isStatusMessage = /^(lista jest|nie wskazano|nie uzupełniono)/iu.test(name)
    return wrapIntermediaryDocumentText(
      isStatusMessage ? name : `- ${name}`,
      font,
      profile.valueSize,
      lenderColumnWidth,
    )
  }))
  const columnHeights = columns.map(column => column.reduce(
    (height, lines, index) => height
      + lines.length * profile.valueLineHeight
      + (index === column.length - 1 ? 0 : 1.5),
    0,
  ))
  return {
    kind: 'lenders',
    x: 0,
    width,
    labelLines,
    columns,
    height: profile.cardPaddingY * 2
      + labelLines.length * profile.labelLineHeight
      + 2
      + Math.max(...columnHeights),
  }
}

function measureOfiSection(
  contentWidth: number,
  section: IntermediaryDocumentContent['sections'][number],
  font: PDFFont,
  profile: OfiLayoutProfile,
): OfiSectionLayout {
  const titleLines = wrapIntermediaryDocumentText(
    section.title,
    font,
    profile.sectionTitleSize,
    contentWidth - 16,
  )
  const titleHeight = Math.max(15, titleLines.length * profile.sectionTitleLineHeight + 5)
  const paragraphLines = (section.paragraphs ?? []).map(paragraph => (
    wrapIntermediaryDocumentText(
      paragraph,
      font,
      profile.valueSize,
      contentWidth - profile.cardPaddingX * 2,
    )
  ))
  const paragraphHeight = paragraphLines.reduce(
    (height, lines, index) => height
      + lines.length * profile.valueLineHeight
      + (index === paragraphLines.length - 1 ? 0 : 2),
    0,
  ) + (paragraphLines.length ? profile.cardPaddingY * 2 : 0)

  const rows: OfiRowLayout[] = []
  const halfWidth = (contentWidth - profile.columnGap) / 2
  let pendingHalfCard: OfiCardLayout | undefined

  function flushPendingHalfCard() {
    if (!pendingHalfCard) return
    rows.push({ height: pendingHalfCard.height, cells: [pendingHalfCard] })
    pendingHalfCard = undefined
  }

  for (const item of section.items ?? []) {
    if (item.presentation === 'lender-list') {
      flushPendingHalfCard()
      const lenders = measureOfiLenders(
        item.label,
        item.value,
        item.values,
        contentWidth,
        font,
        profile,
      )
      rows.push({ height: lenders.height, cells: [lenders] })
      continue
    }

    const halfCard = measureOfiCard(item.label, item.value, 0, halfWidth, font, profile)
    const shouldSpanFullWidth = halfCard.labelLines.length >= 3
      || halfCard.valueLines.length >= 3

    if (shouldSpanFullWidth) {
      flushPendingHalfCard()
      const fullCard = measureOfiCard(item.label, item.value, 0, contentWidth, font, profile)
      rows.push({ height: fullCard.height, cells: [fullCard] })
      continue
    }

    if (!pendingHalfCard) {
      pendingHalfCard = halfCard
      continue
    }

    halfCard.x = halfWidth + profile.columnGap
    rows.push({
      height: Math.max(pendingHalfCard.height, halfCard.height),
      cells: [pendingHalfCard, halfCard],
    })
    pendingHalfCard = undefined
  }
  flushPendingHalfCard()

  const rowsHeight = rows.reduce((height, row, index) => (
    height + row.height + (index === rows.length - 1 ? 0 : profile.cardGap)
  ), 0)
  const contentGap = paragraphLines.length && rows.length ? profile.cardGap : 0
  return {
    titleLines,
    titleHeight,
    paragraphLines,
    paragraphHeight,
    rows,
    height: titleHeight + paragraphHeight + contentGap + rowsHeight,
  }
}

function measureOfiPage(
  content: IntermediaryDocumentContent,
  font: PDFFont,
  profile: OfiLayoutProfile,
): OfiPageLayout {
  const contentWidth = PAGE_WIDTH - profile.marginX * 2
  const organizationLines = wrapIntermediaryDocumentText(
    content.organizationName,
    font,
    profile.organizationSize,
    contentWidth - 74,
  )
  const titleLines = wrapIntermediaryDocumentText(
    content.title,
    font,
    profile.titleSize,
    contentWidth,
  )
  const subtitleLines = wrapIntermediaryDocumentText(
    content.subtitle,
    font,
    profile.subtitleSize,
    contentWidth,
  )
  const legalLines = wrapIntermediaryDocumentText(
    content.legalReference,
    font,
    profile.legalSize,
    contentWidth - 18,
  )
  const warningLines = content.draft
    ? wrapIntermediaryDocumentText(
        `WERSJA ROBOCZA. Przed wysłaniem uzupełnij: ${content.missing.join(', ')}.`,
        font,
        profile.warningSize,
        contentWidth - 18,
      )
    : []
  const organizationLineHeight = profile.organizationSize + 2
  const legalBoxHeight = legalLines.length * profile.legalLineHeight + 10
  const warningBoxHeight = warningLines.length
    ? warningLines.length * profile.warningLineHeight + 10
    : 0
  const headerHeight = 9
    + organizationLines.length * organizationLineHeight
    + 4
    + titleLines.length * profile.titleLineHeight
    + 2
    + subtitleLines.length * profile.subtitleLineHeight
    + 6
    + legalBoxHeight
    + (warningBoxHeight ? 5 + warningBoxHeight : 0)
    + 7
  const sections = content.sections.map(section => (
    measureOfiSection(contentWidth, section, font, profile)
  ))
  const sectionsHeight = sections.reduce((height, section, index) => (
    height + section.height + (index === sections.length - 1 ? 0 : profile.sectionGap)
  ), 0)

  return {
    profile,
    contentWidth,
    organizationLines,
    titleLines,
    subtitleLines,
    legalLines,
    warningLines,
    headerHeight,
    sections,
    sectionsHeight,
    requiredHeight: headerHeight + sectionsHeight,
  }
}

function drawOfiLines(
  page: PDFPage,
  lines: string[],
  input: {
    x: number
    top: number
    size: number
    lineHeight: number
    font: PDFFont
    color: PdfColor
    maxWidth: number
  },
): number {
  let y = input.top
  for (const line of lines) {
    page.drawText(line, {
      x: input.x,
      y: y - input.size,
      size: input.size,
      font: input.font,
      color: input.color,
      maxWidth: input.maxWidth,
    })
    y -= input.lineHeight
  }
  return y
}

function drawOfiSinglePage(input: {
  content: IntermediaryDocumentContent
  page: PDFPage
  font: PDFFont
  primary: PdfColor
  ink: PdfColor
  muted: PdfColor
  subtle: PdfColor
  border: PdfColor
  warning: PdfColor
  warningBackground: PdfColor
}): void {
  const {
    content,
    page,
    font,
    primary,
    ink,
    muted,
    subtle,
    border,
    warning,
    warningBackground,
  } = input
  const measured = OFI_LAYOUT_PROFILES.map(profile => measureOfiPage(content, font, profile))
  const layout = measured.find(candidate => (
    candidate.requiredHeight <= PAGE_HEIGHT - candidate.profile.top - candidate.profile.bottom
  ))
  if (!layout) {
    const compact = measured.at(-1)!
    const requiredHeight = compact.requiredHeight
    const availableHeight = PAGE_HEIGHT - compact.profile.top - compact.profile.bottom
    if (content.kind === 'rodo') {
      throw new RodoSinglePageOverflowError(requiredHeight, availableHeight)
    }
    throw new OfiSinglePageOverflowError(requiredHeight, availableHeight)
  }

  const profile = layout.profile
  const x = profile.marginX
  let cursorY = PAGE_HEIGHT - profile.top
  const organizationLineHeight = profile.organizationSize + 2

  page.drawRectangle({ x, y: cursorY - 3, width: 30, height: 3, color: primary })
  cursorY -= 9
  cursorY = drawOfiLines(page, layout.organizationLines, {
    x,
    top: cursorY,
    size: profile.organizationSize,
    lineHeight: organizationLineHeight,
    font,
    color: primary,
    maxWidth: layout.contentWidth - 74,
  })
  const documentLabel = content.kind === 'ofi'
    ? 'OFI · ART. 17'
    : content.legalReference.includes('art. 14')
      ? 'RODO · ART. 13/14'
      : 'RODO · ART. 13'
  page.drawText(documentLabel, {
    x: PAGE_WIDTH - x - font.widthOfTextAtSize(documentLabel, profile.organizationSize),
    y: PAGE_HEIGHT - profile.top - 9 - profile.organizationSize,
    size: profile.organizationSize,
    font,
    color: muted,
  })
  cursorY -= 4
  cursorY = drawOfiLines(page, layout.titleLines, {
    x,
    top: cursorY,
    size: profile.titleSize,
    lineHeight: profile.titleLineHeight,
    font,
    color: ink,
    maxWidth: layout.contentWidth,
  })
  cursorY -= 2
  cursorY = drawOfiLines(page, layout.subtitleLines, {
    x,
    top: cursorY,
    size: profile.subtitleSize,
    lineHeight: profile.subtitleLineHeight,
    font,
    color: muted,
    maxWidth: layout.contentWidth,
  })
  cursorY -= 6

  const legalHeight = layout.legalLines.length * profile.legalLineHeight + 10
  page.drawRectangle({
    x,
    y: cursorY - legalHeight,
    width: layout.contentWidth,
    height: legalHeight,
    color: subtle,
    borderColor: border,
    borderWidth: 0.5,
  })
  drawOfiLines(page, layout.legalLines, {
    x: x + 9,
    top: cursorY - 5,
    size: profile.legalSize,
    lineHeight: profile.legalLineHeight,
    font,
    color: muted,
    maxWidth: layout.contentWidth - 18,
  })
  cursorY -= legalHeight

  if (layout.warningLines.length) {
    cursorY -= 5
    const warningHeight = layout.warningLines.length * profile.warningLineHeight + 10
    page.drawRectangle({
      x,
      y: cursorY - warningHeight,
      width: layout.contentWidth,
      height: warningHeight,
      color: warningBackground,
      borderColor: warning,
      borderWidth: 0.55,
    })
    drawOfiLines(page, layout.warningLines, {
      x: x + 9,
      top: cursorY - 5,
      size: profile.warningSize,
      lineHeight: profile.warningLineHeight,
      font,
      color: warning,
      maxWidth: layout.contentWidth - 18,
    })
    cursorY -= warningHeight
  }
  cursorY -= 7

  for (const [sectionIndex, section] of layout.sections.entries()) {
    page.drawRectangle({
      x,
      y: cursorY - section.titleHeight,
      width: layout.contentWidth,
      height: section.titleHeight,
      color: subtle,
    })
    page.drawRectangle({
      x,
      y: cursorY - section.titleHeight,
      width: 2.5,
      height: section.titleHeight,
      color: primary,
    })
    drawOfiLines(page, section.titleLines, {
      x: x + 9,
      top: cursorY - 2.5,
      size: profile.sectionTitleSize,
      lineHeight: profile.sectionTitleLineHeight,
      font,
      color: ink,
      maxWidth: layout.contentWidth - 16,
    })
    cursorY -= section.titleHeight

    if (section.paragraphLines.length) {
      page.drawRectangle({
        x,
        y: cursorY - section.paragraphHeight,
        width: layout.contentWidth,
        height: section.paragraphHeight,
        borderColor: border,
        borderWidth: 0.45,
      })
      let paragraphY = cursorY - profile.cardPaddingY
      for (const [paragraphIndex, lines] of section.paragraphLines.entries()) {
        paragraphY = drawOfiLines(page, lines, {
          x: x + profile.cardPaddingX,
          top: paragraphY,
          size: profile.valueSize,
          lineHeight: profile.valueLineHeight,
          font,
          color: ink,
          maxWidth: layout.contentWidth - profile.cardPaddingX * 2,
        })
        if (paragraphIndex < section.paragraphLines.length - 1) paragraphY -= 2
      }
      cursorY -= section.paragraphHeight
      if (section.rows.length) cursorY -= profile.cardGap
    }

    for (const [rowIndex, row] of section.rows.entries()) {
      for (const cell of row.cells) {
        const cardX = x + cell.x
        page.drawRectangle({
          x: cardX,
          y: cursorY - row.height,
          width: cell.width,
          height: row.height,
          color: cell.kind === 'lenders' ? rgb(0.965, 0.975, 0.99) : rgb(0.985, 0.987, 0.989),
          borderColor: cell.kind === 'lenders' ? primary : border,
          borderWidth: cell.kind === 'lenders' ? 0.65 : 0.4,
        })
        let cardY = cursorY - profile.cardPaddingY
        cardY = drawOfiLines(page, cell.labelLines, {
          x: cardX + profile.cardPaddingX,
          top: cardY,
          size: profile.labelSize,
          lineHeight: profile.labelLineHeight,
          font,
          color: cell.kind === 'lenders' ? primary : muted,
          maxWidth: cell.width - profile.cardPaddingX * 2,
        })
        cardY -= cell.kind === 'lenders' ? 2 : 1.5

        if (cell.kind === 'item') {
          drawOfiLines(page, cell.valueLines, {
            x: cardX + profile.cardPaddingX,
            top: cardY,
            size: profile.valueSize,
            lineHeight: profile.valueLineHeight,
            font,
            color: ink,
            maxWidth: cell.width - profile.cardPaddingX * 2,
          })
        }
        else {
          const innerWidth = cell.width - profile.cardPaddingX * 2
          const lenderColumnWidth = (innerWidth - (cell.columns.length === 2 ? profile.columnGap : 0)) / cell.columns.length
          for (const [columnIndex, column] of cell.columns.entries()) {
            let lenderY = cardY
            const lenderX = cardX
              + profile.cardPaddingX
              + columnIndex * (lenderColumnWidth + profile.columnGap)
            for (const [lenderIndex, lenderLines] of column.entries()) {
              lenderY = drawOfiLines(page, lenderLines, {
                x: lenderX,
                top: lenderY,
                size: profile.valueSize,
                lineHeight: profile.valueLineHeight,
                font,
                color: ink,
                maxWidth: lenderColumnWidth,
              })
              if (lenderIndex < column.length - 1) lenderY -= 1.5
            }
          }
        }
      }
      cursorY -= row.height
      if (rowIndex < section.rows.length - 1) cursorY -= profile.cardGap
    }
    if (sectionIndex < layout.sections.length - 1) cursorY -= profile.sectionGap
  }

  if (content.draft) {
    const watermark = 'WERSJA ROBOCZA'
    page.drawText(watermark, {
      x: 107,
      y: 330,
      size: 44,
      font,
      color: warning,
      rotate: degrees(34),
      opacity: 0.045,
    })
  }
  page.drawLine({
    start: { x, y: 41 },
    end: { x: PAGE_WIDTH - x, y: 41 },
    thickness: 0.5,
    color: border,
  })
  const footer = `Rewizja ${content.revision} · generator v${INTERMEDIARY_DOCUMENT_GENERATOR_VERSION} · ${pdfDateLabel(content.generatedAt)} · układ ${profile.name}`
  page.drawText(footer, {
    x,
    y: 27,
    size: 6.4,
    font,
    color: muted,
  })
  const pageLabel = 'Strona 1 / 1'
  page.drawText(pageLabel, {
    x: PAGE_WIDTH - x - font.widthOfTextAtSize(pageLabel, 6.4),
    y: 27,
    size: 6.4,
    font,
    color: muted,
  })
}

export async function generateIntermediaryDocumentPdf(
  content: IntermediaryDocumentContent,
  options: IntermediaryDocumentPdfOptions,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(options.fontBytes, { subset: true })
  const generatedAt = safePdfDate(content.generatedAt)
  const primary = colorFromHex(options.primaryColor)
  const ink = rgb(0.07, 0.09, 0.13)
  const muted = rgb(0.35, 0.39, 0.45)
  const subtle = rgb(0.94, 0.95, 0.96)
  const border = rgb(0.86, 0.88, 0.9)
  const warning = rgb(0.7, 0.15, 0.12)
  const warningBackground = rgb(1, 0.95, 0.94)
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const pages: PDFPage[] = [page]
  let currentPage = page
  let cursorY = PAGE_HEIGHT - MARGIN_X

  pdf.setTitle(content.title)
  pdf.setSubject(content.legalReference)
  pdf.setAuthor(content.organizationName)
  pdf.setCreator(`OpenExpert generator dokumentów prawnych v${INTERMEDIARY_DOCUMENT_GENERATOR_VERSION}`)
  pdf.setProducer('OpenExpert CRM')
  pdf.setCreationDate(generatedAt)
  pdf.setModificationDate(generatedAt)
  pdf.setKeywords(['OFI', 'RODO', 'pośrednik kredytu hipotecznego', content.kind])

  if (content.kind === 'ofi' || content.kind === 'rodo') {
    drawOfiSinglePage({
      content,
      page,
      font,
      primary,
      ink,
      muted,
      subtle,
      border,
      warning,
      warningBackground,
    })
    return pdf.save({ useObjectStreams: false })
  }

  function drawContinuationHeader(target: PDFPage) {
    target.drawText(content.organizationName, {
      x: MARGIN_X,
      y: PAGE_HEIGHT - 38,
      size: 8.5,
      font,
      color: muted,
    })
    const label = content.kind.toLocaleUpperCase('pl-PL')
    target.drawText(label, {
      x: PAGE_WIDTH - MARGIN_X - font.widthOfTextAtSize(label, 8.5),
      y: PAGE_HEIGHT - 38,
      size: 8.5,
      font,
      color: primary,
    })
    target.drawLine({
      start: { x: MARGIN_X, y: PAGE_HEIGHT - 47 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: PAGE_HEIGHT - 47 },
      thickness: 0.65,
      color: border,
    })
  }

  function addPage(): PDFPage {
    const next = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    pages.push(next)
    drawContinuationHeader(next)
    cursorY = PAGE_HEIGHT - 67
    currentPage = next
    return next
  }

  function ensureSpace(height: number) {
    if (cursorY - height >= CONTENT_BOTTOM) return
    addPage()
  }

  function drawLines(
    lines: string[],
    input: {
      size: number
      lineHeight: number
      color?: ReturnType<typeof rgb>
      x?: number
      width?: number
      gapAfter?: number
    },
  ) {
    const x = input.x ?? MARGIN_X
    for (const line of lines) {
      ensureSpace(input.lineHeight)
      currentPage.drawText(line, {
        x,
        y: cursorY - input.size,
        size: input.size,
        font,
        color: input.color ?? ink,
        maxWidth: input.width ?? CONTENT_WIDTH,
      })
      cursorY -= input.lineHeight
    }
    cursorY -= input.gapAfter ?? 0
  }

  function drawWrapped(
    text: string,
    input: {
      size: number
      lineHeight: number
      color?: ReturnType<typeof rgb>
      x?: number
      width?: number
      gapAfter?: number
    },
  ) {
    drawLines(
      wrapIntermediaryDocumentText(text, font, input.size, input.width ?? CONTENT_WIDTH),
      input,
    )
  }

  currentPage.drawRectangle({ x: MARGIN_X, y: cursorY - 7, width: 34, height: 4, color: primary })
  cursorY -= 30
  drawWrapped(content.organizationName, {
    size: 10.5,
    lineHeight: 14,
    color: primary,
    gapAfter: 12,
  })
  drawWrapped(content.title, { size: 24, lineHeight: 29, color: ink, gapAfter: 8 })
  drawWrapped(content.subtitle, { size: 11, lineHeight: 16, color: muted, gapAfter: 18 })

  const legalLines = wrapIntermediaryDocumentText(content.legalReference, font, 8.5, CONTENT_WIDTH - 28)
  const legalHeight = legalLines.length * 12 + 22
  ensureSpace(legalHeight)
  currentPage.drawRectangle({
    x: MARGIN_X,
    y: cursorY - legalHeight,
    width: CONTENT_WIDTH,
    height: legalHeight,
    color: subtle,
    borderColor: border,
    borderWidth: 0.6,
  })
  cursorY -= 11
  drawLines(legalLines, {
    x: MARGIN_X + 14,
    width: CONTENT_WIDTH - 28,
    size: 8.5,
    lineHeight: 12,
    color: muted,
  })
  cursorY -= 11

  if (content.draft) {
    const warningText = `WERSJA ROBOCZA. Przed wysłaniem uzupełnij: ${content.missing.join(', ')}.`
    const warningLines = wrapIntermediaryDocumentText(warningText, font, 8.8, CONTENT_WIDTH - 28)
    const warningHeight = warningLines.length * 12.5 + 22
    ensureSpace(warningHeight)
    currentPage.drawRectangle({
      x: MARGIN_X,
      y: cursorY - warningHeight,
      width: CONTENT_WIDTH,
      height: warningHeight,
      color: warningBackground,
      borderColor: warning,
      borderWidth: 0.7,
    })
    cursorY -= 11
    drawLines(warningLines, {
      x: MARGIN_X + 14,
      width: CONTENT_WIDTH - 28,
      size: 8.8,
      lineHeight: 12.5,
      color: warning,
    })
    cursorY -= 11
  }

  for (const section of content.sections) {
    ensureSpace(72)
    cursorY -= 8
    currentPage.drawLine({
      start: { x: MARGIN_X, y: cursorY },
      end: { x: MARGIN_X + 24, y: cursorY },
      thickness: 2,
      color: primary,
    })
    cursorY -= 13
    drawWrapped(section.title, {
      size: 12.5,
      lineHeight: 16,
      color: ink,
      gapAfter: 10,
    })

    for (const paragraph of section.paragraphs ?? []) {
      drawWrapped(paragraph, {
        size: 9.8,
        lineHeight: 14.5,
        color: ink,
        gapAfter: 8,
      })
    }

    for (const item of section.items ?? []) {
      ensureSpace(42)
      drawWrapped(item.label.toLocaleUpperCase('pl-PL'), {
        size: 7.2,
        lineHeight: 10.5,
        color: muted,
        gapAfter: 2,
      })
      drawWrapped(item.value, {
        size: 9.8,
        lineHeight: 14.5,
        color: ink,
        gapAfter: 8,
      })
    }
    cursorY -= 3
  }

  for (const [index, target] of pages.entries()) {
    if (content.draft) {
      const watermark = 'WERSJA ROBOCZA'
      target.drawText(watermark, {
        x: 105,
        y: 315,
        size: 48,
        font,
        color: warning,
        rotate: degrees(34),
        opacity: 0.055,
      })
    }
    target.drawLine({
      start: { x: MARGIN_X, y: 42 },
      end: { x: PAGE_WIDTH - MARGIN_X, y: 42 },
      thickness: 0.55,
      color: border,
    })
    const footer = `Rewizja ${content.revision} · generator v${INTERMEDIARY_DOCUMENT_GENERATOR_VERSION} · ${pdfDateLabel(content.generatedAt)}`
    target.drawText(footer, {
      x: MARGIN_X,
      y: 27,
      size: 7.1,
      font,
      color: muted,
    })
    const pageLabel = `Strona ${index + 1} / ${pages.length}`
    target.drawText(pageLabel, {
      x: PAGE_WIDTH - MARGIN_X - font.widthOfTextAtSize(pageLabel, 7.1),
      y: 27,
      size: 7.1,
      font,
      color: muted,
    })
  }

  return pdf.save({ useObjectStreams: false })
}
