import type { DocumentTemplate, FieldCondition, PdfFormKind } from '../types.ts'
import {
  PEKAO_COMPLETE_PACKAGE_DOCUMENTS,
  type PekaoOfficialPackageDocument,
} from './pekao-complete-package-catalog.ts'

interface CurrentPekaoTemplateInput {
  code: PekaoOfficialPackageDocument['code']
  id: string
  method: 'pdf_manual' | 'pdf_readonly'
  width?: number
  height?: number
  formKind?: PdfFormKind
  repeatForApplicants?: boolean
  includeWhen?: FieldCondition
}

type PekaoPdfPackageDocument = PekaoOfficialPackageDocument & {
  mimeType: 'application/pdf'
  pageCount: number
}

function packageDocument(code: string): PekaoPdfPackageDocument {
  const document = PEKAO_COMPLETE_PACKAGE_DOCUMENTS.find(item => item.code === code)
  if (!document) throw new Error(`Brak dokumentu Pekao w audycie: ${code}`)
  if (document.mimeType !== 'application/pdf' || document.pageCount === null) {
    throw new Error(`Dokument Pekao ${code} nie jest PDF-em.`)
  }
  return document as PekaoPdfPackageDocument
}

function pages(pageCount: number, width: number, height: number) {
  return Array.from({ length: pageCount }, (_, index) => ({
    page: index + 1,
    mediaBox: { x: 0, y: 0, width, height },
    cropBox: { x: 0, y: 0, width, height },
    rotation: 0 as const,
    userUnit: 1,
  }))
}

function currentPekaoPdf(input: CurrentPekaoTemplateInput): DocumentTemplate {
  const document = packageDocument(input.code)
  const width = input.width ?? 595.32
  const height = input.height ?? 841.92
  const notes = [
    `Zastosowanie: ${document.applicability}`,
    ...(document.validity ? [`Ważność: ${document.validity}`] : []),
    ...document.signatures.map(signature => `Podpis: ${signature}`),
    ...document.notes,
  ]

  return {
    schemaVersion: 2,
    id: input.id,
    bank: 'pekao',
    label: document.title,
    version: 1,
    fillMethod: { kind: input.method },
    source: {
      fileName: document.fileName,
      sha256: document.sha256,
      pageCount: document.pageCount,
      formKind: input.formKind ?? 'overlay',
      pages: pages(document.pageCount, width, height),
    },
    coverage: {
      status: 'complete',
      inScopeTargetCount: 0,
      mappedTargetCount: 0,
      manualUserActionCount: input.method === 'pdf_manual' ? 1 : 0,
      notes,
    },
    ...(input.repeatForApplicants
      ? {
          repeatFor: {
            collection: 'applicants' as const,
            templateIndex: 0,
            maxInstances: 5,
            itemLabel: 'Wnioskodawca',
          },
        }
      : {}),
    ...(input.includeWhen ? { includeWhen: input.includeWhen } : {}),
    bindings: [],
  }
}

/**
 * Aktualny publiczny wniosek ma inny zestaw i geometrie pól niż automatyczny
 * template z 2025 r. Do czasu osobnego audytu mapowania przechodzi przez
 * Multiwniosek uczciwie jako aktywny PDF do ręcznego uzupełnienia.
 */
export const PEKAO_CURRENT_MORTGAGE_APPLICATION_TEMPLATE = currentPekaoPdf({
  code: 'pekao_mortgage_application',
  id: 'pekao-mortgage-2026-manual',
  method: 'pdf_manual',
  width: 595.276,
  height: 841.89,
  formKind: 'acroform',
})

export const PEKAO_APPLICANT_INFORMATION_CARD_TEMPLATE = currentPekaoPdf({
  code: 'pekao_applicant_information_card',
  id: 'pekao-applicant-information-card-2026',
  method: 'pdf_manual',
  width: 607.1,
  height: 859.22,
  repeatForApplicants: true,
})

export const PEKAO_EMPLOYER_INCOME_CERTIFICATE_TEMPLATE = currentPekaoPdf({
  code: 'pekao_employer_income_certificate',
  id: 'pekao-employer-income-certificate-2026',
  method: 'pdf_manual',
  repeatForApplicants: true,
  includeWhen: {
    canonicalKey: 'applicants.0.incomeSource',
    equals: ['employment', 'civil_contract', 'foreign'],
  },
})

export const PEKAO_APPLICANT_EMPLOYMENT_STATEMENT_TEMPLATE = currentPekaoPdf({
  code: 'pekao_applicant_employment_statement',
  id: 'pekao-applicant-employment-statement-2026',
  method: 'pdf_manual',
  repeatForApplicants: true,
  includeWhen: {
    canonicalKey: 'applicants.0.incomeSource',
    equals: ['employment', 'civil_contract', 'foreign'],
  },
})

export const PEKAO_BUSINESS_STATEMENT_TEMPLATE = currentPekaoPdf({
  code: 'pekao_business_statement_unchanged_taxation',
  id: 'pekao-business-statement-2026',
  method: 'pdf_manual',
  repeatForApplicants: true,
  includeWhen: { canonicalKey: 'applicants.0.incomeSource', equals: 'business' },
})

export const PEKAO_BUSINESS_CHANGED_TAXATION_TEMPLATE = currentPekaoPdf({
  code: 'pekao_business_statement_changed_taxation',
  id: 'pekao-business-changed-taxation-2026',
  method: 'pdf_manual',
  repeatForApplicants: true,
  includeWhen: { canonicalKey: 'applicants.0.incomeSource', equals: 'business' },
})

export const PEKAO_RELATED_COMPANY_OR_FARM_TEMPLATE = currentPekaoPdf({
  code: 'pekao_related_company_or_farm_statement',
  id: 'pekao-related-company-or-farm-2026',
  method: 'pdf_manual',
  repeatForApplicants: true,
})

export const PEKAO_IAD_INFORMATION_TEMPLATE = currentPekaoPdf({
  code: 'pekao_personal_data_information_iad',
  id: 'pekao-iad-information-2026',
  method: 'pdf_manual',
  repeatForApplicants: true,
})

export const PEKAO_AGRICULTURAL_LAND_STATEMENT_TEMPLATE = currentPekaoPdf({
  code: 'pekao_agricultural_land_statement',
  id: 'pekao-agricultural-land-statement-2025',
  method: 'pdf_manual',
})

export const PEKAO_DISBURSEMENT_REQUEST_TEMPLATE = currentPekaoPdf({
  code: 'pekao_disbursement_or_tranche_request',
  id: 'pekao-disbursement-request-2026',
  method: 'pdf_manual',
})

export const PEKAO_GENERAL_MORTGAGE_INFORMATION_TEMPLATE = currentPekaoPdf({
  code: 'pekao_general_mortgage_information',
  id: 'pekao-general-mortgage-information-2026',
  method: 'pdf_readonly',
})

export const PEKAO_GENERAL_CONSTRUCTION_INFORMATION_TEMPLATE = currentPekaoPdf({
  code: 'pekao_general_construction_mortgage_information',
  id: 'pekao-general-construction-information-2026',
  method: 'pdf_readonly',
})

export const PEKAO_GENERAL_FAMILY_INFORMATION_TEMPLATE = currentPekaoPdf({
  code: 'pekao_general_family_mortgage_information',
  id: 'pekao-general-family-information-2026',
  method: 'pdf_readonly',
})

export const PEKAO_APPRAISER_GUIDELINES_TEMPLATE = currentPekaoPdf({
  code: 'pekao_appraiser_guidelines',
  id: 'pekao-appraiser-guidelines-2024',
  method: 'pdf_readonly',
})

export const PEKAO_ACCEPTED_INSURERS_TEMPLATE = currentPekaoPdf({
  code: 'pekao_accepted_insurers',
  id: 'pekao-accepted-insurers-2023',
  method: 'pdf_readonly',
  width: 804,
  height: 1137.96,
})

export const PEKAO_CURRENT_TEMPLATES = [
  PEKAO_CURRENT_MORTGAGE_APPLICATION_TEMPLATE,
  PEKAO_APPLICANT_INFORMATION_CARD_TEMPLATE,
  PEKAO_EMPLOYER_INCOME_CERTIFICATE_TEMPLATE,
  PEKAO_APPLICANT_EMPLOYMENT_STATEMENT_TEMPLATE,
  PEKAO_BUSINESS_STATEMENT_TEMPLATE,
  PEKAO_BUSINESS_CHANGED_TAXATION_TEMPLATE,
  PEKAO_RELATED_COMPANY_OR_FARM_TEMPLATE,
  PEKAO_IAD_INFORMATION_TEMPLATE,
  PEKAO_AGRICULTURAL_LAND_STATEMENT_TEMPLATE,
  PEKAO_DISBURSEMENT_REQUEST_TEMPLATE,
  PEKAO_GENERAL_MORTGAGE_INFORMATION_TEMPLATE,
  PEKAO_GENERAL_CONSTRUCTION_INFORMATION_TEMPLATE,
  PEKAO_GENERAL_FAMILY_INFORMATION_TEMPLATE,
  PEKAO_APPRAISER_GUIDELINES_TEMPLATE,
  PEKAO_ACCEPTED_INSURERS_TEMPLATE,
] as const satisfies readonly DocumentTemplate[]
