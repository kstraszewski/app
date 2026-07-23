import { readFile, writeFile } from 'node:fs/promises'
import { getTemplates } from '../../packages/multiform/src/index.ts'
import { fillPdfTemplate } from '../../apps/landing/server/utils/multiform-pdf.ts'

const values = {
  'application.place': 'Warszawa',
  'application.date': '2026-07-17',
  'applicants.0.firstName': 'Anna',
  'applicants.0.lastName': 'Nowak',
  'applicants.0.pesel': '90010112345',
  'applicants.1.firstName': 'Jan',
  'applicants.1.lastName': 'Kowalski',
  'applicants.1.pesel': '88020254321',
  'loan.purpose': 'purchase_primary',
  'loan.amount': 450000,
  'loan.termMonths': 300,
  'loan.repaymentDay': 10,
  'loan.installmentType': 'equal',
  'loan.interestType': 'variable',
  'loan.disbursementType': 'tranches',
  'investment.totalCost': 650000,
  'investment.ownFundsPaid': 100000,
  'investment.ownFundsBeforeDisbursement': 50000,
  'investment.ownFundsDuringInvestment': 50000,
  'property.type': 'apartment',
  'property.address.street': 'Prosta',
  'property.address.houseNumber': '12',
  'property.address.unitNumber': '7',
  'property.address.postalCode': '00-001',
  'property.address.city': 'Warszawa',
  'property.address.county': 'Warszawa',
  'property.address.voivodeship': 'mazowieckie',
  'property.landRegisterNumber': 'WA1M/00012345/6',
  'property.marketValue': 700000,
}

const fontBytes = await readFile('apps/landing/public/fonts/DMSans-VariableFont_opsz,wght.ttf')
for (const template of getTemplates()) {
  const sourceBytes = await readFile(`mock-files/${template.source.fileName}`)
  const output = await fillPdfTemplate(template, sourceBytes, fontBytes, values)
  await writeFile(`tmp/pdfs/v2-${template.bank}.pdf`, output)
}
