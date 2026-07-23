import { defineAgent } from 'eve'

export default defineAgent({
  model: 'google/gemini-3.5-flash-lite',
  modelContextWindowTokens: 1_048_576,
  reasoning: 'minimal',
  limits: {
    maxInputTokensPerSession: 200_000,
    maxOutputTokensPerSession: 20_000,
  },
})
