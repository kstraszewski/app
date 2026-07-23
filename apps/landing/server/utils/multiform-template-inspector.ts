import { createHash } from 'node:crypto'
import {
  type AcroFormTarget,
  type DocumentTemplate,
  type PdfMarkAppearance,
  type PdfTextAppearance,
} from '@openexpert/multiform'
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  TextAlignment,
  type PDFField,
} from 'pdf-lib'
import { readMultiformAsset } from './multiform-api'

const inspectedTemplateCache = new Map<string, Promise<DocumentTemplate>>()
const black = { space: 'rgb', red: 0, green: 0, blue: 0 } as const

function rounded(value: number) {
  return Number(value.toFixed(2))
}

function normalizedRightAngle(angle: number) {
  const normalized = ((angle % 360) + 360) % 360
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized
  }
  throw new Error(`Unsupported PDF page rotation: ${angle}`)
}

function fieldType(field: PDFField): AcroFormTarget['fieldType'] | undefined {
  if (field instanceof PDFTextField) return 'text'
  if (field instanceof PDFCheckBox) return 'checkbox'
  if (field instanceof PDFRadioGroup) return 'radio'
  if (field instanceof PDFDropdown) return 'dropdown'
  if (field instanceof PDFOptionList) return 'option-list'
  return undefined
}

function textAlignment(field: PDFTextField) {
  if (field.getAlignment() === TextAlignment.Center) return 'center' as const
  if (field.getAlignment() === TextAlignment.Right) return 'right' as const
  return 'left' as const
}

function textAppearance(
  template: DocumentTemplate,
  field?: PDFTextField,
): PdfTextAppearance {
  const fontSizePt = template.bank === 'pekao' ? 10 : template.bank === 'pko-bp' ? 8 : 9
  const maxLength = field?.getMaxLength()
  const comb = field?.isCombed() && maxLength !== undefined

  return {
    kind: 'text',
    fontId: 'dm-sans-regular',
    fontSizePt,
    minFontSizePt: 5,
    letterSpacingPt: 0,
    lineHeightPt: Number((fontSizePt * 1.2).toFixed(2)),
    wrap: field?.isMultiline() ? 'word' : 'none',
    overflow: 'shrink',
    horizontalAlign: field ? textAlignment(field) : 'left',
    verticalAlign: 'middle',
    distribution: comb ? { kind: 'comb', cells: maxLength } : { kind: 'flow' },
    color: black,
    opacity: 1,
    paddingPt: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 },
  }
}

function markAppearance(field: PDFCheckBox | PDFRadioGroup): PdfMarkAppearance {
  const radio = field instanceof PDFRadioGroup
  return {
    kind: 'mark',
    role: radio ? 'radio' : 'checkbox',
    glyph: radio ? 'dot' : 'x',
    color: black,
    opacity: 1,
    insetPt: 1.5,
    strokeWidthPt: 0.9,
    outline: {
      shape: radio ? 'circle' : 'square',
      color: black,
      strokeWidthPt: 0.6,
    },
  }
}

async function inspectTemplate(template: DocumentTemplate) {
  const sourceBytes = await readMultiformAsset(
    'assets:multiform-mocks',
    template.source.fileName,
  )
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex')
  if (sourceHash !== template.source.sha256) {
    throw new Error(`PDF source checksum mismatch for ${template.id}`)
  }

  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  const pages = pdf.getPages()
  const pagesByRef = new Map(pages.map((page, index) => [page.ref.toString(), index + 1]))
  const pagesByAnnotationRef = new Map<string, number>()
  for (const [pageIndex, page] of pages.entries()) {
    for (const annotation of page.node.Annots()?.asArray() ?? []) {
      pagesByAnnotationRef.set(annotation.toString(), pageIndex + 1)
    }
  }

  const fields = new Map(pdf.getForm().getFields().map(field => [field.getName(), field]))
  const bindings = template.bindings.map((binding) => {
    if (binding.target.kind !== 'acroform') return binding
    const field = fields.get(binding.target.field)
    if (!field) {
      throw new Error(`AcroForm field not found: ${binding.target.field}`)
    }
    const detectedFieldType = fieldType(field)
    if (!detectedFieldType) {
      throw new Error(`Unsupported AcroForm field type: ${binding.target.field}`)
    }
    if (binding.target.fieldType && binding.target.fieldType !== detectedFieldType) {
      throw new Error(`AcroForm field type drift: ${binding.target.field}`)
    }

    const radioExportValues = field instanceof PDFRadioGroup
      ? field.acroField.getExportValues()
      : undefined

    const expectedWidgets = field.acroField.getWidgets().flatMap((widget, index) => {
      const annotationRef = pdf.context.getObjectRef(widget.dict)
      const page = widget.P()
        ? pagesByRef.get(widget.P()!.toString())
        : annotationRef
          ? pagesByAnnotationRef.get(annotationRef.toString())
          : undefined
      if (!page) return []

      const rect = widget.getRectangle()
      return [{
        index,
        page,
        rect: {
          x: rounded(rect.x),
          y: rounded(rect.y),
          width: rounded(rect.width),
          height: rounded(rect.height),
        },
        ...(radioExportValues?.[index]
          ? { exportValue: radioExportValues[index]!.decodeText() }
          : widget.getOnValue()
            ? { exportValue: widget.getOnValue()!.decodeText() }
            : {}),
      }]
    })
    if (expectedWidgets.length === 0) {
      throw new Error(`AcroForm field has no page-resolved widgets: ${binding.target.field}`)
    }

    const target: AcroFormTarget = {
      ...binding.target,
      fieldType: detectedFieldType,
      expectedWidgets,
      ...(field instanceof PDFTextField
        ? {
            text: {
              alignment: textAlignment(field),
              multiline: field.isMultiline(),
              comb: field.isCombed(),
              ...(field.getMaxLength() !== undefined ? { maxLength: field.getMaxLength() } : {}),
            },
            appearance: textAppearance(template, field),
          }
        : field instanceof PDFCheckBox || field instanceof PDFRadioGroup
          ? { appearance: markAppearance(field) }
          : { appearance: textAppearance(template) }),
    }

    return { ...binding, target }
  })

  return {
    ...template,
    source: {
      ...template.source,
      pages: pages.map((page, index) => {
        const mediaBox = page.getMediaBox()
        const cropBox = page.getCropBox()
        const userUnitObject = page.node.getInheritableAttribute(PDFName.of('UserUnit'))
        const userUnit = pdf.context.lookupMaybe(userUnitObject, PDFNumber)?.asNumber() ?? 1
        return {
          page: index + 1,
          mediaBox: {
            x: rounded(mediaBox.x),
            y: rounded(mediaBox.y),
            width: rounded(mediaBox.width),
            height: rounded(mediaBox.height),
          },
          cropBox: {
            x: rounded(cropBox.x),
            y: rounded(cropBox.y),
            width: rounded(cropBox.width),
            height: rounded(cropBox.height),
          },
          rotation: normalizedRightAngle(page.getRotation().angle),
          userUnit,
        }
      }),
    },
    bindings,
  } satisfies DocumentTemplate
}

export function inspectRegisteredTemplate(template: DocumentTemplate) {
  const cacheKey = `${template.id}@${template.version}:${template.source.sha256}`
  const existing = inspectedTemplateCache.get(cacheKey)
  if (existing) return existing

  const pending = inspectTemplate(template).catch((error) => {
    inspectedTemplateCache.delete(cacheKey)
    throw error
  })
  inspectedTemplateCache.set(cacheKey, pending)
  return pending
}
