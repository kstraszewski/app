import { task } from '@trigger.dev/sdk'

export interface PlatformHealthcheckPayload {
  source?: string
}

export const platformHealthcheck = task({
  id: 'openexpert-platform-healthcheck',
  run: async (payload: PlatformHealthcheckPayload) => ({
    checkedAt: new Date().toISOString(),
    ok: true,
    source: payload.source?.trim() || 'manual',
  }),
})
