import { defineInstrumentation } from 'eve/instrumentation'

const syntheticContentCapture = (
  process.env.BANK_MAIL_AGENT_SYNTHETIC_DATA_ONLY === '1'
  && process.env.BANK_MAIL_AGENT_SYNTHETIC_TRACES === '1'
  && process.env.VERCEL_ENV !== 'production'
)

export default defineInstrumentation({
  // Production defaults are deliberately content-free. Enabling content
  // requires two explicit flags and is still disabled on Vercel production.
  recordInputs: syntheticContentCapture,
  recordOutputs: syntheticContentCapture,
  traceChannelRequests: true,
  events: {
    'step.started': () => ({
      runtimeContext: {
        'openexpert.agent_kind': 'bank_mail_intake',
        'openexpert.synthetic_content_capture': syntheticContentCapture,
      },
    }),
  },
})
