import { defineDynamic, defineInstructions } from 'eve/instructions'
import {
  buildCrmInvocationInstructions,
  readCrmAgentInvocation,
} from '../lib/invocation'

export default defineDynamic({
  events: {
    'session.started': (_event, ctx) => {
      const invocation = readCrmAgentInvocation(ctx)
      if (!invocation) return null

      return defineInstructions({
        markdown: buildCrmInvocationInstructions(invocation),
      })
    },
  },
})
