import { MAIN_CRM_AGENT_MODEL } from '@openexpert/crm-agent-capabilities'

export const CRM_AGENT_MODELS = {
  default: {
    gatewayId: MAIN_CRM_AGENT_MODEL.id,
    contextWindowTokens: 1_000_000,
    reasoningEffort: MAIN_CRM_AGENT_MODEL.reasoningEffort,
  },
  flashLite: {
    gatewayId: 'google/gemini-3.5-flash-lite',
    contextWindowTokens: 1_000_000,
  },
} as const

export const CRM_AGENT_INVOCATION_CLAIMS = {
  preset: 'oe_agent_preset',
  modelProfile: 'oe_agent_model_profile',
  scopeType: 'oe_agent_scope_type',
  caseId: 'oe_agent_case_id',
  caseTitle: 'oe_agent_case_title',
  clientId: 'oe_agent_client_id',
  clientName: 'oe_agent_client_name',
  clientEmail: 'oe_agent_client_email',
  clientPhone: 'oe_agent_client_phone',
} as const

export type CrmAgentInvocationPreset = 'mail-reply'
export type CrmAgentModelProfile = 'flash-lite'

export type CrmAgentInvocationScopeRequest =
  | { type: 'case', id: string }
  | { type: 'client', id: string }
  | { type: 'mailbox' }

export interface CrmAgentInvocationCredentialRequest {
  preset: CrmAgentInvocationPreset
  scope: CrmAgentInvocationScopeRequest
  participantEmails?: string[]
  accountEmail?: string
}

export interface CrmAgentInvocationCaseScope {
  type: 'case'
  caseId: string
  caseTitle: string
  clientId: string
  clientName: string
  clientEmail: string | null
  clientPhone: string | null
}

export interface CrmAgentInvocationMailboxScope {
  type: 'mailbox'
}

export type CrmAgentInvocationScope =
  | CrmAgentInvocationCaseScope
  | CrmAgentInvocationMailboxScope

export interface CrmAgentInvocationCredentialResponse {
  accessToken: string
  expiresIn: number
  tokenType: 'Bearer'
  invocation: {
    preset: CrmAgentInvocationPreset
    modelProfile: CrmAgentModelProfile
    model: string
    scope: CrmAgentInvocationScope
  }
}
