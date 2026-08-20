import { z } from 'zod'

const organizationFields = {
  organizationId: z.string().uuid(),
  organizationSlug: z.string().trim().min(1).max(100).optional(),
} as const

export const UserAgentPrincipalSchema = z.object({
  kind: z.literal('user'),
  ...organizationFields,
  userId: z.string().uuid(),
  role: z.enum(['expert', 'admin']),
}).strict()

export const BankMailAgentPrincipalSchema = z.object({
  kind: z.literal('bank-mail'),
  ...organizationFields,
  ownerUserId: z.string().uuid(),
  connectionId: z.string().uuid().optional(),
  intakeId: z.string().uuid().optional(),
}).strict()

export const AgentPrincipalSchema = z.discriminatedUnion('kind', [
  UserAgentPrincipalSchema,
  BankMailAgentPrincipalSchema,
])

export type UserAgentPrincipal = z.infer<typeof UserAgentPrincipalSchema>
export type BankMailAgentPrincipal = z.infer<typeof BankMailAgentPrincipalSchema>
export type AgentPrincipal = z.infer<typeof AgentPrincipalSchema>

export type CapabilityScope = Readonly<{
  organizationId: string
  ownerUserId: string | null
  visibility: 'organization' | 'owned-by-actor'
}>

/**
 * Visibility is deliberately derived from the authenticated principal. It is
 * never accepted as model/tool input, so a bank-mail session cannot widen it.
 */
export function deriveCapabilityScope(principal: AgentPrincipal): CapabilityScope {
  const authenticated = AgentPrincipalSchema.parse(principal)
  return authenticated.kind === 'bank-mail'
    ? Object.freeze({
        organizationId: authenticated.organizationId,
        ownerUserId: authenticated.ownerUserId,
        visibility: 'owned-by-actor' as const,
      })
    : Object.freeze({
        organizationId: authenticated.organizationId,
        ownerUserId: null,
        visibility: 'organization' as const,
      })
}
