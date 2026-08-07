import { defineAgent } from 'eve'

export default defineAgent({
  model: 'openai/gpt-5.6-luna',
  modelContextWindowTokens: 1_050_000,
  reasoning: 'low',
  limits: {
    maxInputTokensPerSession: 200_000,
    maxOutputTokensPerSession: 20_000,
  },
})
