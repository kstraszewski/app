import {
  formatCurrencyWords,
  resolveCanonicalValues,
  resolveTemplateFillMethod,
  type DocumentTemplate,
  type TemplateBinding,
  type XlsxCellTarget,
} from '@openexpert/multiform'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

export type SpreadsheetScalar = string | number | boolean | Date | null | undefined
export type FlatSpreadsheetValues = Readonly<Record<string, SpreadsheetScalar>>

export class MultiformSpreadsheetValueError extends Error {
  readonly canonicalKey: string

  constructor(canonicalKey: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'MultiformSpreadsheetValueError'
    this.canonicalKey = canonicalKey
  }
}

const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const workbookPath = 'xl/workbook.xml'
const workbookRelsPath = 'xl/_rels/workbook.xml.rels'
const stylesPath = 'xl/styles.xml'
const contentTypesPath = '[Content_Types].xml'

function xmlEscape(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function xmlUnescape(value: string) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
}

function attribute(source: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\s)${escapedName}="([^"]*)"`, 'u').exec(source)
  return match ? xmlUnescape(match[1]!) : undefined
}

function meaningfulParts(values: readonly SpreadsheetScalar[]) {
  return values
    .filter((value): value is Exclude<SpreadsheetScalar, null | undefined> => (
      value !== null && value !== undefined && String(value).trim() !== ''
    ))
    .map(value => String(value).trim())
}

function houseAndUnit(values: readonly SpreadsheetScalar[]) {
  const [houseNumber, unitNumber] = meaningfulParts(values)
  if (!houseNumber) return ''
  return unitNumber ? `${houseNumber}/${unitNumber}` : houseNumber
}

function conditionMatches(binding: TemplateBinding, values: FlatSpreadsheetValues) {
  if (!binding.condition) return true
  const value = values[binding.condition.canonicalKey]
  if (value === null || value === undefined) return false
  const expected = Array.isArray(binding.condition.equals)
    ? binding.condition.equals
    : [binding.condition.equals]
  return expected.includes(String(value))
}

function resolveBindingValue(binding: TemplateBinding, values: FlatSpreadsheetValues) {
  const sourceKeys = binding.valueFrom?.length ? binding.valueFrom : [binding.canonicalKey]
  const present = sourceKeys.some(key => (
    Object.prototype.hasOwnProperty.call(values, key)
    && values[key] !== null
    && values[key] !== undefined
  ))
  if (!present) return { present: false as const, value: undefined }

  const sourceValues = sourceKeys.map(key => values[key])
  let value: SpreadsheetScalar
  switch (binding.valueFormat) {
    case 'fullName':
      value = meaningfulParts(sourceValues).join(' ')
      break
    case 'houseAndUnit':
      value = houseAndUnit(sourceValues)
      break
    case 'streetHouseAndUnit':
      value = meaningfulParts([sourceValues[0], houseAndUnit(sourceValues.slice(1))]).join(' ')
      break
    case 'currency.words':
      value = formatCurrencyWords(sourceValues[0], String(sourceValues[1] ?? 'PLN')) ?? ''
      break
    default:
      value = binding.computed
        ? meaningfulParts(sourceValues).join(' ')
        : values[binding.canonicalKey]
  }

  return binding.computed && value === ''
    ? { present: false as const, value: undefined }
    : { present: true as const, value }
}

function mapCellValue(value: SpreadsheetScalar, target: XlsxCellTarget) {
  if (!target.valueMap) return value
  const exactKey = value instanceof Date ? value.toISOString() : String(value)
  if (Object.prototype.hasOwnProperty.call(target.valueMap, exactKey)) {
    return target.valueMap[exactKey]
  }
  const normalized = exactKey.trim().toLocaleLowerCase('pl-PL')
  const match = Object.entries(target.valueMap).find(([key]) => (
    key.trim().toLocaleLowerCase('pl-PL') === normalized
  ))
  return match?.[1]
}

function parseNumber(value: SpreadsheetScalar) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replace(/[\s\u00A0\u202F]/gu, '').replace(',', '.')
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

function excelDateSerial(value: SpreadsheetScalar) {
  let year: number
  let month: number
  let day: number
  if (value instanceof Date) {
    year = value.getUTCFullYear()
    month = value.getUTCMonth() + 1
    day = value.getUTCDate()
  }
  else {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/u.exec(String(value ?? '').trim())
    if (!match) return undefined
    year = Number(match[1])
    month = Number(match[2])
    day = Number(match[3])
  }
  const date = Date.UTC(year, month - 1, day)
  if (!Number.isFinite(date)) return undefined
  const check = new Date(date)
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) return undefined
  return date / 86_400_000 + 25_569
}

function cellPayload(target: XlsxCellTarget, value: SpreadsheetScalar) {
  if (target.valueType === 'string') {
    return { type: 'inlineStr', body: `<is><t xml:space="preserve">${xmlEscape(String(value ?? ''))}</t></is>` }
  }
  if (target.valueType === 'number') {
    const number = parseNumber(value)
    if (number === undefined) throw new Error('Wartość nie jest poprawną liczbą.')
    return { type: undefined, body: `<v>${number}</v>` }
  }
  if (target.valueType === 'date') {
    const serial = excelDateSerial(value)
    if (serial === undefined) throw new Error('Wartość nie jest poprawną datą.')
    return { type: undefined, body: `<v>${serial}</v>` }
  }
  if (typeof value !== 'boolean') throw new Error('Wartość nie jest poprawną wartością Tak/Nie.')
  return { type: 'b', body: `<v>${value ? 1 : 0}</v>` }
}

function worksheetRelationships(xml: string) {
  return new Map([...xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/gu)].flatMap((match) => {
    const id = attribute(match[1]!, 'Id')
    const type = attribute(match[1]!, 'Type')
    const target = attribute(match[1]!, 'Target')
    return id && target && type?.endsWith('/worksheet') ? [[id, target] as const] : []
  }))
}

function normalizeWorksheetPath(target: string) {
  if (target.startsWith('/')) return target.slice(1)
  return `xl/${target.replace(/^\.\//u, '')}`.replace(/\/\.\//gu, '/')
}

function workbookSheets(xml: string, relsXml: string) {
  const rels = worksheetRelationships(relsXml)
  return [...xml.matchAll(/<sheet\b([^>]*)\/?\s*>/gu)].flatMap((match) => {
    const name = attribute(match[1]!, 'name')
    const relationshipId = attribute(match[1]!, 'r:id')
    const target = relationshipId ? rels.get(relationshipId) : undefined
    if (!name || !target) return []
    const sourceState = attribute(match[1]!, 'state')
    const state = sourceState === 'hidden' || sourceState === 'veryHidden' ? sourceState : 'visible'
    return [{ name, state, path: normalizeWorksheetPath(target) }]
  })
}

function cellXfs(stylesXml: string) {
  const start = stylesXml.indexOf('<cellXfs')
  const openEnd = start >= 0 ? stylesXml.indexOf('>', start) : -1
  const end = openEnd >= 0 ? stylesXml.indexOf('</cellXfs>', openEnd) : -1
  if (start < 0 || openEnd < 0 || end < 0) throw new Error('Brak tabeli stylów komórek XLSX.')
  const source = stylesXml.slice(openEnd + 1, end)
  const result: string[] = []
  let cursor = 0
  while (cursor < source.length) {
    const xfStart = source.indexOf('<xf', cursor)
    if (xfStart < 0) break
    const tagEnd = source.indexOf('>', xfStart)
    if (tagEnd < 0) throw new Error('Uszkodzona tabela stylów XLSX.')
    if (source[tagEnd - 1] === '/') {
      result.push(source.slice(xfStart, tagEnd + 1))
      cursor = tagEnd + 1
      continue
    }
    const xfEnd = source.indexOf('</xf>', tagEnd)
    if (xfEnd < 0) throw new Error('Uszkodzona tabela stylów XLSX.')
    result.push(source.slice(xfStart, xfEnd + 5))
    cursor = xfEnd + 5
  }
  return result
}

function styleIsUnlocked(styles: readonly string[], styleIndex: number) {
  const style = styles[styleIndex]
  if (!style) throw new Error(`Brak stylu XLSX o indeksie ${styleIndex}.`)
  const protection = /<protection\b([^>]*)\/?\s*>/u.exec(style)
  return protection ? ['0', 'false'].includes(attribute(protection[1]!, 'locked') ?? '') : false
}

function replaceCell(
  worksheetXml: string,
  target: XlsxCellTarget,
  value: SpreadsheetScalar,
  styles: readonly string[],
) {
  const pattern = new RegExp(`<c\\b([^>]*\\br="${target.cell}"[^>]*?)(?:\\s*/>|>([\\s\\S]*?)</c>)`, 'u')
  const match = pattern.exec(worksheetXml)
  if (!match) throw new Error(`Komórka ${target.sheet}!${target.cell} nie istnieje w źródle.`)
  const attributes = match[1]!
  const contents = match[2] ?? ''
  const styleIndex = Number(attribute(attributes, 's') ?? 0)
  if (styleIndex !== target.expected.styleIndex) {
    throw new Error(`Zmienił się styl komórki ${target.sheet}!${target.cell}.`)
  }
  if (styleIsUnlocked(styles, styleIndex) !== target.expected.unlocked) {
    throw new Error(`Zmieniła się ochrona komórki ${target.sheet}!${target.cell}.`)
  }
  if (/<f(?:\s|>)/u.test(contents) !== target.expected.formula) {
    throw new Error(`Zmieniła się formuła komórki ${target.sheet}!${target.cell}.`)
  }

  const payload = cellPayload(target, value)
  const withoutType = attributes.replace(/\s+t="[^"]*"/gu, '')
  const nextAttributes = payload.type ? `${withoutType} t="${payload.type}"` : withoutType
  const replacement = `<c${nextAttributes}>${payload.body}</c>`
  return worksheetXml.slice(0, match.index) + replacement + worksheetXml.slice(match.index + match[0].length)
}

function setFullCalculation(workbookXml: string) {
  if (/<calcPr\b/u.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b([^>]*?)(?:\s*\/?>)/u, (_match, rawAttributes: string) => {
      const cleaned = rawAttributes
        .replace(/\s+(?:calcMode|fullCalcOnLoad|forceFullCalc)="[^"]*"/gu, '')
      return `<calcPr${cleaned} calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>`
    })
  }
  return workbookXml.replace('</workbook>', '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>')
}

function removeCalcChain(files: Record<string, Uint8Array>) {
  delete files['xl/calcChain.xml']
  const rels = strFromU8(files[workbookRelsPath]!)
  files[workbookRelsPath] = strToU8(rels.replace(
    /<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/?\s*>/gu,
    '',
  ))
  const contentTypes = strFromU8(files[contentTypesPath]!)
  files[contentTypesPath] = strToU8(contentTypes.replace(
    /<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/?\s*>/gu,
    '',
  ))
}

function validateWorkbookSnapshot(template: DocumentTemplate, files: Record<string, Uint8Array>) {
  const workbook = template.source.workbook
  if (!workbook) throw new Error('Template XLSX nie zawiera snapshotu skoroszytu.')
  const workbookXml = strFromU8(files[workbookPath]!)
  const relsXml = strFromU8(files[workbookRelsPath]!)
  const sheets = workbookSheets(workbookXml, relsXml)
  const actualSheets = sheets.map(({ name, state }) => ({ name, state }))
  if (JSON.stringify(actualSheets) !== JSON.stringify(workbook.sheets)) {
    throw new Error('Zmieniła się lista lub widoczność arkuszy źródłowego XLSX.')
  }
  const formulaCount = sheets.reduce((count, sheet) => {
    const bytes = files[sheet.path]
    if (!bytes) throw new Error(`Brak arkusza „${sheet.name}” w źródłowym XLSX.`)
    return count + [...strFromU8(bytes).matchAll(/<f(?:\s|>)/gu)].length
  }, 0)
  if (formulaCount !== workbook.formulaCellCount) {
    throw new Error('Zmieniła się liczba formuł źródłowego XLSX.')
  }
  const structureProtected = /<workbookProtection\b[^>]*\blockStructure="(?:1|true)"/u.test(workbookXml)
  if (structureProtected !== workbook.structureProtected) {
    throw new Error('Zmienił się stan ochrony struktury źródłowego XLSX.')
  }
  return { workbookXml, sheets }
}

export function fillXlsxTemplate(
  template: DocumentTemplate,
  sourceBytes: Uint8Array,
  inputValues: FlatSpreadsheetValues,
) {
  const fillMethod = resolveTemplateFillMethod(template)
  if (fillMethod.kind !== 'xlsx_native' && fillMethod.kind !== 'xlsx_manual') {
    throw new Error(`Metoda „${fillMethod.kind}” nie jest metodą XLSX.`)
  }
  if (template.source.mimeType !== xlsxMimeType) {
    throw new Error('Template XLSX ma nieprawidłowy typ MIME źródła.')
  }
  const files = unzipSync(sourceBytes)
  for (const requiredPath of [workbookPath, workbookRelsPath, stylesPath, contentTypesPath]) {
    if (!files[requiredPath]) throw new Error(`Źródłowy XLSX nie zawiera ${requiredPath}.`)
  }
  const { workbookXml, sheets } = validateWorkbookSnapshot(template, files)
  if (fillMethod.kind === 'xlsx_manual') return sourceBytes.slice()
  const resolution = resolveCanonicalValues(inputValues)
  const resolutionError = resolution.issues.find(issue => issue.severity === 'error')
  if (resolutionError) {
    throw new MultiformSpreadsheetValueError(resolutionError.key, resolutionError.message)
  }
  const values: FlatSpreadsheetValues = resolution.values
  const styles = cellXfs(strFromU8(files[stylesPath]!))
  const sheetPathByName = new Map(sheets.map(sheet => [sheet.name, sheet.path]))

  for (const binding of template.bindings) {
    if (binding.target.kind !== 'xlsx_cell') {
      throw new Error(`Metoda xlsx_native nie obsługuje targetu „${binding.target.kind}”.`)
    }
    if (!conditionMatches(binding, values)) continue
    const resolved = resolveBindingValue(binding, values)
    if (!resolved.present) continue
    const mappedValue = mapCellValue(resolved.value, binding.target)
    if (mappedValue === undefined) continue
    const sheetPath = sheetPathByName.get(binding.target.sheet)
    if (!sheetPath || !files[sheetPath]) {
      throw new Error(`Arkusz „${binding.target.sheet}” nie istnieje w źródłowym XLSX.`)
    }
    try {
      const worksheetXml = strFromU8(files[sheetPath])
      files[sheetPath] = strToU8(replaceCell(worksheetXml, binding.target, mappedValue, styles))
    }
    catch (error) {
      if (error instanceof MultiformSpreadsheetValueError) throw error
      throw new MultiformSpreadsheetValueError(
        binding.canonicalKey,
        error instanceof Error ? error.message : 'Nie udało się wpisać wartości do arkusza bankowego.',
        error,
      )
    }
  }

  files[workbookPath] = strToU8(setFullCalculation(workbookXml))
  removeCalcChain(files)
  return zipSync(files, { level: 6 })
}
