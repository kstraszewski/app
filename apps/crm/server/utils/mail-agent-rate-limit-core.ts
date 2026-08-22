export type CrmAgentMailRateLimitOperation = 'search' | 'thread' | 'attachment'

export interface CrmAgentMailRateLimitWindowPolicy {
  windowMs: number
  pairMax: number
  identifierMax: number
  ipMax: number
}

export interface CrmAgentMailRateLimitPolicy {
  minute: CrmAgentMailRateLimitWindowPolicy
  hour: CrmAgentMailRateLimitWindowPolicy
}

const maxima: Record<CrmAgentMailRateLimitOperation, {
  minute: number
  hour: number
}> = {
  search: { minute: 6, hour: 60 },
  thread: { minute: 10, hour: 100 },
  attachment: { minute: 15, hour: 150 },
}

export function crmAgentMailRateLimitPolicy(
  operation: CrmAgentMailRateLimitOperation,
): CrmAgentMailRateLimitPolicy {
  const policy = maxima[operation]
  return {
    minute: {
      windowMs: 60_000,
      pairMax: policy.minute,
      identifierMax: policy.minute,
      ipMax: 10_000,
    },
    hour: {
      windowMs: 60 * 60_000,
      pairMax: policy.hour,
      identifierMax: policy.hour,
      ipMax: 10_000,
    },
  }
}
