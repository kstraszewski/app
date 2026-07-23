import type { DocumentTemplate } from '../types.ts'
import { ERSTE_TEMPLATE } from './erste.ts'
import { PEKAO_TEMPLATE } from './pekao.ts'
import { PKO_TEMPLATE } from './pko.ts'

export const TEMPLATES = [
  ERSTE_TEMPLATE,
  PKO_TEMPLATE,
  PEKAO_TEMPLATE,
] as const satisfies readonly DocumentTemplate[]

export { ERSTE_TEMPLATE, PEKAO_TEMPLATE, PKO_TEMPLATE }
