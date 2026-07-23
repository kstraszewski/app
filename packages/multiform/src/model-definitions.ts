export const MULTIFORM_MODEL_DEFINITIONS = {
  agent: {
    gatewayId: 'google/gemini-3.6-flash',
    providerId: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    contextWindowTokens: 1_048_576,
  },
  templateGenerator: {
    gatewayId: 'google/gemini-3.5-flash-lite',
    providerId: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    contextWindowTokens: 1_048_576,
  },
} as const
