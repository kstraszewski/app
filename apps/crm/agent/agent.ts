import { defineAgent, defineDynamic } from 'eve'
import { CRM_AGENT_MODELS } from '../shared/types/agent-invocation'
import { readCrmAgentInvocation } from './lib/invocation'

export default defineAgent({
  model: defineDynamic({
    fallback: CRM_AGENT_MODELS.default.gatewayId,
    events: {
      'session.started': (_event, ctx) => {
        const invocation = readCrmAgentInvocation(ctx)
        if (invocation?.modelProfile !== 'flash-lite') return null
        return {
          model: CRM_AGENT_MODELS.flashLite.gatewayId,
          modelContextWindowTokens: CRM_AGENT_MODELS.flashLite.contextWindowTokens,
        }
      },
    },
  }),
  modelContextWindowTokens: CRM_AGENT_MODELS.default.contextWindowTokens,
  reasoning: 'low',
  limits: {
    maxInputTokensPerSession: 200_000,
    maxOutputTokensPerSession: 20_000,
  },
})
