import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeCrmAgentMailServiceUrl,
  validateCrmAgentMailApiResponse,
} from '../agent/lib/mail-api.ts'

test('accepts HTTPS and loopback CRM mail service origins', () => {
  assert.equal(normalizeCrmAgentMailServiceUrl('https://crm.openexpert.app/'), 'https://crm.openexpert.app')
  assert.equal(normalizeCrmAgentMailServiceUrl('http://127.0.0.1:3004'), 'http://127.0.0.1:3004')
})

test('rejects unsafe CRM mail service targets', () => {
  assert.throws(() => normalizeCrmAgentMailServiceUrl('http://crm.example.com'), /HTTPS/u)
  assert.throws(() => normalizeCrmAgentMailServiceUrl('https://crm.example.com/api'), /główny origin/u)
  assert.throws(() => normalizeCrmAgentMailServiceUrl('https://user:pass@crm.example.com'), /główny origin/u)
})

test('validates bounded, version-compatible mail service responses', () => {
  const searchPath = '/api/internal/crm-agent-mail/search' as const
  const thread = {
    reference: 'A'.repeat(80),
    mailbox: 'ekspert@openexpert.pl',
    provider: 'google',
    folders: ['inbox'],
    matchReason: 'participant_email',
    matchedEmails: ['klient@example.com'],
    participants: [{ name: 'Klient', email: 'klient@example.com', label: 'Klient' }],
    summaryLimitedToMatchedMessages: true,
    subject: null,
    latestAt: null,
    listedMessageCount: null,
    snippet: null,
    hasAttachments: null,
    url: '/org/test/mail',
  }
  const response = {
    data: {
      folder: 'all',
      attachmentFilter: 'any',
      query: null,
      participantEmail: 'klient@example.com',
      context: null,
      searchedAccountCount: 1,
      partialFailureCount: 0,
      coverage: {
        complete: false,
        nextCursor: `v2.${'A'.repeat(16)}.${'B'.repeat(22)}.${'C'.repeat(32)}`,
        omittedLinkedThreadCount: 0,
        omittedResultCount: 0,
        limitations: [],
        reason: 'more_available',
      },
      threads: [thread],
    },
  }
  assert.equal(validateCrmAgentMailApiResponse(searchPath, response), response)
  const providerLimitedResponse = {
    data: {
      ...response.data,
      coverage: {
        ...response.data.coverage,
        nextCursor: null,
        limitations: ['microsoft_search_result_limit'],
        reason: 'provider_limit',
      },
    },
  }
  assert.equal(
    validateCrmAgentMailApiResponse(searchPath, providerLimitedResponse),
    providerLimitedResponse,
  )
  assert.throws(
    () => validateCrmAgentMailApiResponse(searchPath, {
      data: { ...response.data, threads: [{}] },
    }),
    /niezgodną odpowiedź/u,
  )
  assert.throws(
    () => validateCrmAgentMailApiResponse(searchPath, {
      data: { ...response.data, threads: Array(25).fill(thread) },
    }),
    /niezgodną odpowiedź/u,
  )
  assert.throws(
    () => validateCrmAgentMailApiResponse(searchPath, {
      data: {
        ...response.data,
        coverage: {
          ...response.data.coverage,
          complete: true,
          nextCursor: null,
          limitations: ['imap_search_window'],
          reason: 'complete',
        },
      },
    }),
    /niezgodną odpowiedź/u,
  )
})

test('validates dense bounded thread reads', () => {
  const path = '/api/internal/crm-agent-mail/threads' as const
  const message = {
    ordinal: 3,
    direction: 'received',
    from: { name: 'Klient', email: 'klient@example.com', label: 'Klient' },
    to: [{ name: 'Ekspert', email: 'ekspert@openexpert.pl', label: 'Ekspert' }],
    cc: [],
    subject: 'Dokumenty',
    sentAt: '2026-08-22T10:00:00.000Z',
    bodyExcerpt: 'Treść wiadomości.',
    bodyExcerptStart: 0,
    bodyTruncated: false,
    authentication: 'pass',
    replyToMismatch: false,
    attachments: [{
      reference: 'A'.repeat(80),
      fileName: 'decyzja.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 123,
    }],
    omittedAttachmentCount: 0,
  }
  const response = {
    data: {
      requestedThreadCount: 1,
      readThreadCount: 1,
      failureCount: 0,
      failedRanks: [],
      threads: [{
        rank: 1,
        mailbox: 'ekspert@openexpert.pl',
        provider: 'google',
        subject: 'Dokumenty',
        providerMessageCount: 3,
        newerMessageCount: 0,
        matchedMessageCountInWindow: 1,
        filteredMessageCount: 0,
        returnedMessageCount: 1,
        omittedMessageCount: 2,
        nextReference: null,
        messages: [message],
        url: '/org/test/mail',
      }],
    },
  }
  assert.equal(validateCrmAgentMailApiResponse(path, response), response)
  assert.throws(
    () => validateCrmAgentMailApiResponse(path, {
      data: {
        ...response.data,
        threads: [{ ...response.data.threads[0], messages: [{ ...message, bodyExcerpt: 'x'.repeat(2_401) }] }],
      },
    }),
    /niezgodną odpowiedź/u,
  )
})

test('rejects malformed attachment extraction responses', () => {
  const path = '/api/internal/crm-agent-mail/attachment' as const
  const response = {
    data: {
      fileName: 'decyzja.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 123,
      source: {
        mailbox: 'ekspert@openexpert.pl',
        sender: 'Klient <klient@example.com>',
        subject: 'Dokumenty',
        sentAt: '2026-08-22T10:00:00.000Z',
      },
      extraction: {
        status: 'extracted',
        kind: 'pdf',
        pageCount: 1,
        truncated: false,
        reason: null,
        excerpts: [{ locator: 'znaki 1-20', text: 'Decyzja pozytywna.' }],
      },
    },
  }
  assert.equal(validateCrmAgentMailApiResponse(path, response), response)
  assert.throws(
    () => validateCrmAgentMailApiResponse(path, {
      data: {
        ...response.data,
        extraction: { ...response.data.extraction, excerpts: [{ locator: null, text: 'x'.repeat(1_601) }] },
      },
    }),
    /niezgodną odpowiedź/u,
  )
})
