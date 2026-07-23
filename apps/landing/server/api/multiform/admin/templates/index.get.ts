import { getTemplates, validateTemplateJson } from '@openexpert/multiform'
import { bankLabel, summarizeTemplate } from '../../../../utils/multiform-api'
import { inspectRegisteredTemplate } from '../../../../utils/multiform-template-inspector'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')

  const templates = await Promise.all(getTemplates().map(inspectRegisteredTemplate))

  return {
    schemaVersion: 1 as const,
    templates: templates.map(template => ({
      key: `registered:${template.id}`,
      kind: 'registered' as const,
      id: template.id,
      label: template.label,
      bank: bankLabel(template.bank),
      template,
      summary: summarizeTemplate(template),
      validation: validateTemplateJson(template),
    })),
  }
})
