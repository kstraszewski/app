import type {
  CrmAgentInvocationCredentialRequest,
  CrmAgentInvocationPreset,
} from '#shared/types/agent-invocation'

export interface AgentInvocationRequest {
  id: string
  preset: CrmAgentInvocationPreset
  prompt: string
  credential: CrmAgentInvocationCredentialRequest
  context: Record<string, unknown>
}

export type AgentInvocationResult =
  | { requestId: string, status: 'completed', text: string }
  | { requestId: string, status: 'error', message: string }

export interface SubmitAgentInvocationInput {
  preset: CrmAgentInvocationPreset
  prompt: string
  credential: Omit<CrmAgentInvocationCredentialRequest, 'preset'>
  context: Record<string, unknown>
}

function invocationId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `agent-invocation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function useAgentInvocation() {
  const request = useState<AgentInvocationRequest | null>(
    'agent-invocation-request',
    () => null,
  )
  const result = useState<AgentInvocationResult | null>(
    'agent-invocation-result',
    () => null,
  )

  function submit(input: SubmitAgentInvocationInput): string {
    const id = invocationId()
    result.value = null
    request.value = {
      id,
      preset: input.preset,
      prompt: input.prompt,
      credential: {
        ...input.credential,
        preset: input.preset,
      },
      context: input.context,
    }
    return id
  }

  function consume(requestId: string): void {
    if (request.value?.id === requestId) request.value = null
  }

  function complete(requestId: string, text: string): void {
    result.value = { requestId, status: 'completed', text }
  }

  function fail(requestId: string, message: string): void {
    result.value = { requestId, status: 'error', message }
  }

  function clearResult(requestId: string): void {
    if (result.value?.requestId === requestId) result.value = null
  }

  return {
    request,
    result,
    submit,
    consume,
    complete,
    fail,
    clearResult,
  }
}
