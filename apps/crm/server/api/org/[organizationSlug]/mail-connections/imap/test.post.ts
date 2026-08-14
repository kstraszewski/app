import { requireCrmSession } from '~~/server/utils/crm'
import { assertMailConnectionSetupRateLimit } from '~~/server/utils/mail-connection-rate-limit'
import { setPrivateMailResponseHeaders } from '~~/server/utils/mail-http'
import { safeImapSmtpError } from '~~/server/utils/mail-imap-errors'
import { readImapSmtpConnectionInput } from '~~/server/utils/mail-imap-setup'

export default defineEventHandler(async (event) => {
  setPrivateMailResponseHeaders(event)
  const session = await requireCrmSession(event)
  await assertMailConnectionSetupRateLimit(event, session.userId)
  const input = await readImapSmtpConnectionInput(event)
  try {
    const module = await import('~~/server/utils/mail-imap-smtp')
    await module.verifyImapSmtpConnection(input)
  }
  catch (error) {
    throw safeImapSmtpError(error, 'setup')
  }
  return { ok: true }
})
