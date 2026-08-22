import assert from 'node:assert/strict'
import test from 'node:test'
import type { MailMessageDetail } from '../shared/types/mail.ts'
import { mailAgentMessageMatchesSearch } from '../server/utils/mail-agent-search-core.ts'

function message(input: {
  id: string
  from: string
  to: string[]
  attachment: string
}): MailMessageDetail {
  const address = (email: string) => ({ name: '', email, label: email })
  return {
    id: input.id,
    from: address(input.from),
    replyTo: [],
    to: input.to.map(address),
    cc: [],
    subject: 'Dokumenty',
    sentAt: '2026-08-22T10:00:00.000Z',
    unread: false,
    bodyText: '',
    bodyHtml: null,
    bodyHtmlTruncated: false,
    hasRemoteImages: false,
    bodyTruncated: false,
    attachments: [{
      id: input.attachment,
      filename: `${input.attachment}.pdf`,
      mimeType: 'application/pdf',
      size: 100,
    }],
    security: { authentication: 'unknown', replyToMismatch: false },
  }
}

const accountEmail = 'ekspert@openexpert.pl'
const clientEmail = 'klient@example.com'
const inbound = message({
  id: 'inbound',
  from: clientEmail,
  to: [accountEmail],
  attachment: 'from-client',
})
const outbound = message({
  id: 'outbound',
  from: accountEmail,
  to: [clientEmail],
  attachment: 'from-expert',
})

test('keeps only inbound attachments from the exact requested participant', () => {
  const input = { accountEmail, folder: 'inbox' as const, participantEmail: clientEmail }
  assert.equal(mailAgentMessageMatchesSearch(inbound, input), true)
  assert.equal(mailAgentMessageMatchesSearch(outbound, input), false)
  assert.equal(mailAgentMessageMatchesSearch(
    message({ id: 'other', from: 'other@example.com', to: [accountEmail], attachment: 'other' }),
    input,
  ), false)
})

test('keeps only outbound attachments addressed to the exact participant', () => {
  const input = { accountEmail, folder: 'sent' as const, participantEmail: clientEmail }
  assert.equal(mailAgentMessageMatchesSearch(outbound, input), true)
  assert.equal(mailAgentMessageMatchesSearch(inbound, input), false)
  assert.equal(mailAgentMessageMatchesSearch(
    message({ id: 'other', from: accountEmail, to: ['other@example.com'], attachment: 'other' }),
    input,
  ), false)
})
