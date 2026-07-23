import { getTemplates } from '@openexpert/multiform'
import { summarizeTemplate } from '../../../utils/multiform-api'

export default defineEventHandler(() => ({
  templates: getTemplates().map(summarizeTemplate),
}))

