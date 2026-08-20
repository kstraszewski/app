import { defineAgent } from 'eve'
import { BANK_MAIL_AGENT_MODEL } from '@openexpert/crm-agent-capabilities'

export default defineAgent({
  model: BANK_MAIL_AGENT_MODEL.id,
  modelContextWindowTokens: 1_000_000,
  reasoning: BANK_MAIL_AGENT_MODEL.reasoningEffort,
  limits: {
    maxInputTokensPerSession: 120_000,
    maxOutputTokensPerSession: 12_000,
    sessionTimeoutMs: 24 * 60 * 60 * 1_000,
  },
})
