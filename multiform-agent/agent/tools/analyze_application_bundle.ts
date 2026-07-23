import { prepareBundle } from '@openexpert/multiform'
import { defineTool } from 'eve/tools'
import { z } from 'zod'

const requiredKeys = new Set([
  'application.place',
  'application.date',
  'applicants.0.firstName',
  'applicants.0.lastName',
  'applicants.0.pesel',
  'loan.purpose',
  'loan.amount',
  'loan.termMonths',
  'property.address.street',
  'property.address.houseNumber',
  'property.address.postalCode',
  'property.address.city',
  'property.marketValue',
])

const scalarValue = z.union([z.string(), z.number(), z.boolean()])

const templateIds = {
  erste: 'erste-mortgage-2026',
  'pko-bp': 'pko-bp-mortgage-2022',
  pekao: 'pekao-mortgage-2025',
} as const

function isPresent(value: string | number | boolean | undefined) {
  return value !== undefined && (typeof value !== 'string' || value.trim().length > 0)
}

export default defineTool({
  description: 'Analyze approved mortgage PDF templates, merge their canonical fields, and report which values are present or missing.',
  inputSchema: z.object({
    documents: z.array(z.enum(['erste', 'pko-bp', 'pekao'])).min(1).max(3)
      .describe('Banks selected for the bundle. Use pko-bp for PKO Bank Polski and pekao for Bank Pekao SA.'),
    values: z.record(z.string(), scalarValue).default({}).describe('Already known values keyed by canonical field path.'),
  }),
  async execute({ documents, values }) {
    const bundle = prepareBundle(documents.map(document => templateIds[document]))
    const fields = bundle.fields.map(field => ({
      key: field.canonicalKey,
      label: field.label,
      section: field.group,
      type: field.type,
      required: requiredKeys.has(field.canonicalKey),
      present: isPresent(values[field.canonicalKey]),
      options: field.options,
    }))
    const provided = fields.filter(field => field.present)
    const missingRequired = fields.filter(field => field.required && !field.present)
    const missingOptional = fields.filter(field => !field.required && !field.present)
    const nextAction = bundle.warnings.length > 0
      ? 'Do not render yet. The selected PDF templates contain mappings that require human review in the template admin.'
      : missingRequired.length > 0
        ? 'Collect only the missing required values before PDF rendering.'
        : 'Required data and approved mappings are complete. Optional fields can be confirmed before deterministic PDF rendering.'

    return {
      documents: bundle.documents.map(document => ({
        templateId: document.id,
        bank: document.bank,
        label: document.label,
        sourceFile: document.source.fileName,
      })),
      provided,
      missingRequired,
      missingOptional,
      warnings: bundle.warnings,
      totals: {
        documents: bundle.documents.length,
        uniqueFields: fields.length,
        provided: provided.length,
        missingRequired: missingRequired.length,
      },
      nextAction,
    }
  },
})
