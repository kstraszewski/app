import type { H3Event } from 'h3'
import type { CrmSession } from './crm.ts'
import {
  sealMailAgentSearchCursor,
  unsealMailAgentSearchCursor,
  type MailAgentSearchCursorSource,
} from './mail-agent-search-cursor-core.ts'
import { deriveMailReferenceSecret } from './mail-crypto.ts'

const cursorConnectionContext = 'agent-mail-search-cursor-v1'

function cursorSecret(event: H3Event, session: Pick<CrmSession, 'organizationId' | 'userId'>): string {
  return deriveMailReferenceSecret(event, {
    organizationId: session.organizationId,
    ownerUserId: session.userId,
    connectionId: cursorConnectionContext,
  })
}

export function createMailAgentSearchCursor(
  event: H3Event,
  session: Pick<CrmSession, 'organizationId' | 'userId'>,
  binding: string,
  sources: MailAgentSearchCursorSource[],
  now = Date.now(),
): string | null {
  return sealMailAgentSearchCursor(binding, sources, cursorSecret(event, session), now)
}

export function openMailAgentSearchCursor(
  event: H3Event,
  session: Pick<CrmSession, 'organizationId' | 'userId'>,
  cursor: string,
  binding: string,
  now = Date.now(),
): MailAgentSearchCursorSource[] {
  return unsealMailAgentSearchCursor(cursor, binding, cursorSecret(event, session), now)
}
