import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { getTemplate, PKO_TEMPLATE } from '@openexpert/multiform'
import {
  AnnotationFlags,
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  type PDFWidgetAnnotation,
} from 'pdf-lib'
import { unzipSync } from 'fflate'

import {
  createPdfBundle,
  fillPdfTemplate,
  MultiformPdfValueError,
} from '../server/utils/multiform-pdf.ts'
import { MULTIFORM_COUPLE_FIXTURE } from './fixtures/multiform-scenarios.ts'

const sourceUrl = new URL(
  '../../../mock-files/pko-bp-wniosek-o-kredyt-hipoteczny.pdf',
  import.meta.url,
)
const fontUrl = new URL('../public/fonts/DMSans-VariableFont_opsz,wght.ttf', import.meta.url)

function assertInteractiveAppearance(pdf: PDFDocument, widget: PDFWidgetAnnotation) {
  assert.equal(widget.hasFlag(AnnotationFlags.Invisible), false)
  assert.equal(widget.hasFlag(AnnotationFlags.Hidden), false)
  assert.equal(widget.hasFlag(AnnotationFlags.NoView), false)
  assert.equal(widget.hasFlag(AnnotationFlags.ReadOnly), false)
  assert.equal(widget.hasFlag(AnnotationFlags.LockedContents), false)
  assert.equal(widget.hasFlag(AnnotationFlags.Print), true)

  const normal = widget.getAppearances()?.normal
  assert.ok(normal)
  const streams = normal instanceof PDFDict
    ? normal.keys().map(key => pdf.context.lookup(normal.get(key)))
    : [normal]
  for (const stream of streams) {
    assert.ok(stream instanceof PDFRawStream)
    const operators = new TextDecoder().decode(decodePDFRawStream(stream).decode())
    assert.ok(operators.trim().length > 0)
  }
}

function decodedNormalAppearanceStreams(pdf: PDFDocument, widget: PDFWidgetAnnotation) {
  const normal = widget.getAppearances()?.normal
  assert.ok(normal)
  const streams = normal instanceof PDFDict
    ? normal.keys().map(key => pdf.context.lookup(normal.get(key)))
    : [pdf.context.lookup(normal)]

  return streams.map((stream) => {
    assert.ok(stream instanceof PDFRawStream)
    return new TextDecoder().decode(decodePDFRawStream(stream).decode())
  })
}

function decodedPageContent(pdf: PDFDocument, pageIndex: number) {
  const contents = pdf.getPage(pageIndex).node.Contents()
  const objects = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
  return objects.map((object) => {
    const stream = pdf.context.lookup(object)
    if (!(stream instanceof PDFRawStream)) return ''
    return new TextDecoder().decode(decodePDFRawStream(stream).decode())
  }).join('\n')
}

test('PKO renders a complete two-applicant mortgage scenario into the audited AcroForm', async () => {
  const sourceBytes = await readFile(sourceUrl)
  const outputBytes = await fillPdfTemplate(
    PKO_TEMPLATE,
    sourceBytes,
    await readFile(fontUrl),
    {
      'application.place': 'Kraków',
      'application.date': '2026-08-09',
      'applicants.0.firstName': 'Alicja',
      'applicants.0.lastName': 'Testowa',
      'applicants.0.pesel': '90010100009',
      'applicants.0.willOccupyFinancedProperty': true,
      'applicants.1.firstName': 'Bartosz',
      'applicants.1.lastName': 'Testowy',
      'applicants.1.pesel': '92020200001',
      'applicants.1.willOccupyFinancedProperty': true,
      'loan.productType': 'mortgage',
      'loan.productVariant': 'own_home_mortgage',
      'loan.purpose': 'purchase_secondary',
      'loan.amount': 560_000,
      'loan.interestType': 'periodically_fixed',
      'loan.termMonths': 300,
      'loan.gracePeriodMonths': 6,
      'loan.repaymentDay': 15,
      'loan.installmentType': 'equal',
      'loan.disbursementType': 'tranches',
      'loan.repaymentAccountType': 'existing_personal_account',
      'loan.repaymentAccountNumber': '10 1050 0099 7603 1234 5678 9123',
      'loan.totalDisbursementDate': '2026-10-15',
      'investment.totalCost': 720_000,
      'investment.ownFundsPaid': 100_000,
      'investment.landValue': 0,
      'investment.ownFundsBeforeDisbursement': 40_000,
      'investment.ownFundsDuringInvestment': 20_000,
      'investment.financialSurplusEnabled': true,
      'investment.financialSurplusAmount': 15_000,
      'investment.completionDate': '2027-06-30',
      'property.address.street': 'ul. Testowa',
      'property.address.houseNumber': '12',
      'property.address.unitNumber': '7',
      'property.address.postalCode': '30-001',
      'property.address.city': 'Kraków',
      'property.address.county': 'krakowski',
      'property.address.voivodeship': 'małopolskie',
      'collateralProperty.type': 'apartment',
      'collateralProperty.marketValue': 720_000,
      'collateralProperties.0.relationshipToFinancedProperty': 'financed',
      'collateralProperties.0.landRegisterNumber': 'KR1P/00012345/6',
      'collateralProperties.0.hasLandRegister': true,
      'collateralProperties.2.relationshipToFinancedProperty': 'other',
      'collateralProperties.2.hasLandRegister': false,
      'property.publicRoadAccessType': 'direct',
      'additionalProducts.creditCard': true,
      'additionalProducts.creditCardLimit': 15_000,
      'additionalProducts.creditCardApplicant': 'Alicja Testowa',
      'additionalProducts.personalAccount': true,
      'additionalProducts.lifeInsurance': true,
      'additionalProducts.lifeInsuranceApplicant.0': true,
      'additionalProducts.lifeInsuranceApplicant.1': true,
      'additionalProducts.systematicAccountInflows': false,
      'declarations.ownContributionFromCredit': false,
      'declarations.riskAwareness': true,
      'consents.earlyCreditDecision': true,
      'consents.interbankInformationSharing': false,
      'property.appraiserChoice': 'other',
      'property.appraiserDetails': 'Anna Audyt, upr. 1234',
    },
  )

  assert.ok(outputBytes.length > sourceBytes.length)
  const pdf = await PDFDocument.load(outputBytes, { updateMetadata: false })
  const sourcePdf = await PDFDocument.load(sourceBytes, { updateMetadata: false })
  const form = pdf.getForm()
  assert.equal(pdf.getPageCount(), 4)
  assert.equal(form.getFields().length, 182)
  assert.equal(form.getTextField('imie1').getText(), 'Alicja')
  assert.equal(form.getTextField('nazwisko2').getText(), 'Testowy')
  assert.equal(form.getTextField('pesel1').getText(), '90010100009')
  assert.equal(form.getTextField('nabycie_koszt').getText(), '720 000,00')
  assert.equal(form.getTextField('nabycie_kredyt').getText(), '560 000,00')
  assert.equal(form.getTextField('razem_koszt').getText(), '720 000,00')
  assert.equal(form.getTextField('wlasne_razem').getText(), '100 000,00')
  assert.equal(form.getTextField('wlasne_do_wniesienia_razem').getText(), '60 000,00')
  assert.equal(
    form.getTextField('adres_inwestycji').getText(),
    'ul. Testowa 12/7, 30-001 Kraków, krakowski, małopolskie',
  )
  assert.equal(form.getTextField('termin_wyplaty1').getText(), '15')
  assert.equal(form.getTextField('termin_wyplaty2').getText(), '10')
  assert.equal(form.getTextField('termin_wyplaty3').getText(), '2026')
  assert.equal(form.getTextField('miejscowosc').getText(), 'Kraków')
  assert.equal(form.getTextField('data').getText(), '09.08.2026')
  assert.equal(form.getTextField('nr_rachunku').getText(), '10105000997603123456789123')

  const checkboxState = (fieldName: string) => {
    const field = form.getCheckBox(fieldName)
    const widget = field.acroField.getWidgets()[0]!
    return {
      value: field.acroField.dict.get(PDFName.of('V'))?.toString(),
      appearanceState: widget.dict.get(PDFName.of('AS'))?.toString(),
      hidden: widget.hasFlag(AnnotationFlags.Hidden),
    }
  }

  assert.deepEqual(checkboxState('wniosek_0'), {
    value: '/wlasny_kat',
    appearanceState: '/wlasny_kat',
    hidden: false,
  })
  assert.deepEqual(checkboxState('nabycie'), {
    value: '/tak',
    appearanceState: '/tak',
    hidden: false,
  })
  assert.deepEqual(checkboxState('oprocentowanie_1'), {
    value: '/zmienne_ze_stala',
    appearanceState: '/zmienne_ze_stala',
    hidden: false,
  })
  assert.deepEqual(checkboxState('hipoteka_nieruchomosc3_brak_kw'), {
    value: '/tak',
    appearanceState: '/tak',
    hidden: false,
  })
  assert.deepEqual(checkboxState('wklad_wlasny_z_kredytu_1'), {
    value: '/nie',
    appearanceState: '/nie',
    hidden: false,
  })

  assert.equal(form.getTextField('imie3').getText(), undefined)
  for (const widget of form.getTextField('imie3').acroField.getWidgets()) {
    assertInteractiveAppearance(pdf, widget)
  }

  for (const fieldName of [
    'imie1',
    'nazwisko1',
    'pesel1',
    'nabycie_koszt',
    'nabycie_kredyt',
  ]) {
    for (const widget of form.getTextField(fieldName).acroField.getWidgets()) {
      assertInteractiveAppearance(pdf, widget)
    }
  }
  for (const widget of form.getCheckBox('nabycie').acroField.getWidgets()) {
    assertInteractiveAppearance(pdf, widget)
  }
  for (const binding of PKO_TEMPLATE.bindings) {
    if (binding.target.kind !== 'acroform') continue
    for (const widget of form.getField(binding.target.field).acroField.getWidgets()) {
      assertInteractiveAppearance(pdf, widget)
    }
  }

  for (let pageIndex = 0; pageIndex < pdf.getPageCount(); pageIndex += 1) {
    assert.equal(
      decodedPageContent(pdf, pageIndex),
      decodedPageContent(sourcePdf, pageIndex),
      `page ${pageIndex + 1} must not contain a static duplicate of an AcroForm value`,
    )
  }

  const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  const acroForm = pdf.catalog.lookup(PDFName.of('AcroForm'), PDFDict)
  assert.equal(pdf.catalog.has(PDFName.of('OpenAction')), false)
  assert.equal(pdf.catalog.has(PDFName.of('AA')), false)
  assert.equal(names?.has(PDFName.of('JavaScript')) ?? false, false)
  assert.equal(acroForm.has(PDFName.of('CO')), false)
  assert.equal(acroForm.has(PDFName.of('NeedAppearances')), false)
  for (const [acroField] of form.acroForm.getAllFields()) {
    assert.equal(acroField.dict.has(PDFName.of('A')), false)
    assert.equal(acroField.dict.has(PDFName.of('AA')), false)
  }
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      assert.equal(widget.dict.has(PDFName.of('A')), false)
      assert.equal(widget.dict.has(PDFName.of('AA')), false)
    }
  }
})

test('PKO + Pekao full bundle renders the unchanged couple fixture with formatted NRB', async () => {
  const documents = await Promise.all(MULTIFORM_COUPLE_FIXTURE.templateIds.map(async (
    templateId,
    index,
  ) => {
    const template = getTemplate(templateId)
    assert.ok(template, templateId)
    return {
      fileName: template.source.fileName,
      template,
      sourceBytes: await readFile(new URL(
        `../../../mock-files/${template.source.fileName}`,
        import.meta.url,
      )),
      directory: index === 0 ? 'PKO BP' : 'Pekao',
    }
  }))

  const archive = await createPdfBundle(
    documents,
    await readFile(fontUrl),
    MULTIFORM_COUPLE_FIXTURE.values,
  )
  const files = unzipSync(archive)
  const names = Object.keys(files).sort((left, right) => left.localeCompare(right, 'pl'))
  assert.deepEqual(names, [
    'Pekao/01-wnioski/uzupelniony-pekao-wniosek-o-kredyt-mieszkaniowy.pdf',
    'PKO BP/01-wnioski/uzupelniony-pko-bp-wniosek-o-kredyt-hipoteczny.pdf',
  ])

  const pkoBytes = files['PKO BP/01-wnioski/uzupelniony-pko-bp-wniosek-o-kredyt-hipoteczny.pdf']
  const pekaoBytes = files['Pekao/01-wnioski/uzupelniony-pekao-wniosek-o-kredyt-mieszkaniowy.pdf']
  assert.ok(pkoBytes)
  assert.ok(pekaoBytes)

  const pko = await PDFDocument.load(pkoBytes, { updateMetadata: false })
  const pekao = await PDFDocument.load(pekaoBytes, { updateMetadata: false })
  assert.equal(pko.getForm().getTextField('nr_rachunku').getText(), '12345678901234567890123456')
  assert.equal(
    pekao.getForm().getTextField('Text Field 64').getText(),
    'przed wypłatą; 30.11.2026',
  )
  const scheduleWidget = pekao.getForm().getTextField('Text Field 64').acroField.getWidgets()[0]
  assert.match(
    scheduleWidget?.getDefaultAppearance() ?? '',
    /\/[^\s]+\s+0\s+Tf/,
    'editable field must keep viewer auto-fit enabled in /DA',
  )
  const scheduleAppearance = decodedNormalAppearanceStreams(pekao, scheduleWidget!).join('\n')
  const scheduleFontSize = Number(/\/[^\s]+\s+([\d.]+)\s+Tf/.exec(scheduleAppearance)?.[1])
  assert.ok(scheduleFontSize >= 5 && scheduleFontSize < 10, 'current /AP must contain the fitted font size')
})

test('renderer reports an overlong bank text value as a field validation error', async () => {
  const pekao = getTemplate('pekao-mortgage-2025')
  assert.ok(pekao)
  const sourceBytes = await readFile(new URL(
    `../../../mock-files/${pekao.source.fileName}`,
    import.meta.url,
  ))

  await assert.rejects(
    fillPdfTemplate(
      pekao,
      sourceBytes,
      await readFile(fontUrl),
      {
        ...MULTIFORM_COUPLE_FIXTURE.values,
        'investment.ownFundsContributionDates': '60 000 zł przed pierwszą transzą; 20 000 zł do 2026-11-30',
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof MultiformPdfValueError)
      assert.equal(error.canonicalKey, 'investment.ownFundsContributionDates')
      assert.equal(error.message, 'Wartość jest zbyt długa dla pola formularza bankowego.')
      return true
    },
  )
})
