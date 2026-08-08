import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createTransactionalEmailSender,
  EmailDeliveryError,
  type EmailSenderRuntime,
  type EmailServiceConfig,
  type TransactionalEmailInput,
} from '../src/index.ts'

const defaultConfig: EmailServiceConfig = {
  apiKey: 're_offline_test_key',
  from: 'OpenExpert <security@auth.example.com>',
  replyTo: 'support@example.com',
  maxRetries: 0,
  requestTimeoutMs: 100,
}

const defaultEmail: TransactionalEmailInput = {
  to: 'User@example.com',
  subject: 'Potwierdź logowanie',
  html: '<p>Potwierdź logowanie.</p>',
  text: 'Potwierdź logowanie.',
  idempotencyKey: 'auth/magic-link/event-123',
  tags: [{ name: 'email_type', value: 'magic_link' }],
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

async function withFetch<T>(
  implementation: typeof globalThis.fetch,
  callback: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = implementation
  try {
    return await callback()
  } finally {
    globalThis.fetch = originalFetch
  }
}

function sender(
  config: Partial<EmailServiceConfig> = {},
  runtime: EmailSenderRuntime = {},
) {
  return createTransactionalEmailSender({ ...defaultConfig, ...config }, runtime)
}

test('sends a validated Resend payload with plain text and a stable idempotency key', async () => {
  const requests: Array<{ url: string, init?: RequestInit }> = []
  const fetchImplementation: typeof globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init })
    return jsonResponse(200, { id: 'email_123' })
  }

  const result = await withFetch(fetchImplementation, () => sender().send({
    ...defaultEmail,
    to: ['User@example.com', 'user@example.com'],
  }))

  assert.deepEqual(result, { status: 'sent', id: 'email_123' })
  assert.equal(requests.length, 1)
  assert.equal(requests[0]!.url, 'https://api.resend.com/emails')
  assert.equal(requests[0]!.init?.method, 'POST')
  assert.equal(
    new Headers(requests[0]!.init?.headers).get('idempotency-key'),
    defaultEmail.idempotencyKey,
  )
  assert.deepEqual(JSON.parse(String(requests[0]!.init?.body)), {
    from: 'OpenExpert <security@auth.example.com>',
    to: ['User@example.com'],
    subject: defaultEmail.subject,
    html: defaultEmail.html,
    text: defaultEmail.text,
    reply_to: 'support@example.com',
    tags: defaultEmail.tags,
  })
})

test('sends binary attachments through the single-email Resend endpoint', async () => {
  const requests: Array<{ url: string, init?: RequestInit }> = []
  const fetchImplementation: typeof globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init })
    return jsonResponse(200, { id: 'email_with_attachment' })
  }

  const result = await withFetch(fetchImplementation, () => sender().send({
    ...defaultEmail,
    attachments: [{
      filename: 'wnioski.zip',
      content: new Uint8Array([80, 75, 3, 4]),
      contentType: 'application/zip',
    }],
  }))

  assert.deepEqual(result, { status: 'sent', id: 'email_with_attachment' })
  assert.equal(requests.length, 1)
  assert.equal(requests[0]!.url, 'https://api.resend.com/emails')
  assert.deepEqual(JSON.parse(String(requests[0]!.init?.body)).attachments, [{
    filename: 'wnioski.zip',
    content: 'UEsDBA==',
    content_type: 'application/zip',
  }])
})

test('rejects unsafe or oversized email attachments before transport', async () => {
  await assert.rejects(
    sender().send({
      ...defaultEmail,
      attachments: [{
        filename: '../wnioski.zip',
        content: new Uint8Array([1]),
      }],
    }),
    /invalid filename/u,
  )

  await assert.rejects(
    sender().send({
      ...defaultEmail,
      attachments: [{
        filename: 'wnioski.zip',
        content: new Uint8Array(40 * 1024 * 1024 + 1),
      }],
    }),
    /40 MB/u,
  )
})

test('retries only transient Resend responses with backoff, jitter and the same key', async () => {
  const statuses = [429, 503, 200]
  const idempotencyKeys: Array<string | null> = []
  const delays: number[] = []
  const fetchImplementation: typeof globalThis.fetch = async (_input, init) => {
    const status = statuses.shift()!
    idempotencyKeys.push(new Headers(init?.headers).get('idempotency-key'))
    if (status === 200) return jsonResponse(200, { id: 'email_after_retry' })
    return jsonResponse(status, {
      message: `Temporary error ${status}`,
      name: status === 429 ? 'rate_limit_exceeded' : 'api_error',
      statusCode: status,
    })
  }

  const result = await withFetch(fetchImplementation, () => sender(
    { maxRetries: 2, retryBaseDelayMs: 10 },
    {
      random: () => 0.5,
      sleep: async delayMs => {
        delays.push(delayMs)
      },
    },
  ).send(defaultEmail))

  assert.deepEqual(result, { status: 'sent', id: 'email_after_retry' })
  assert.deepEqual(idempotencyKeys, [
    defaultEmail.idempotencyKey,
    defaultEmail.idempotencyKey,
    defaultEmail.idempotencyKey,
  ])
  assert.deepEqual(delays, [8, 15])
})

test('does not retry non-transient Resend errors', async () => {
  let requests = 0
  const fetchImplementation: typeof globalThis.fetch = async () => {
    requests += 1
    return jsonResponse(422, {
      message: 'Invalid recipient',
      name: 'validation_error',
      statusCode: 422,
    })
  }

  await withFetch(fetchImplementation, async () => {
    await assert.rejects(
      sender({ maxRetries: 4 }).send(defaultEmail),
      (error: unknown) => {
        assert.ok(error instanceof EmailDeliveryError)
        assert.equal(error.provider, 'resend')
        assert.equal(error.retryable, false)
        assert.equal(error.statusCode, 422)
        return true
      },
    )
  })
  assert.equal(requests, 1)
})

test('retries timed-out Resend requests with the same idempotency key', async () => {
  let requests = 0
  const idempotencyKeys: Array<string | null> = []
  const fetchImplementation: typeof globalThis.fetch = async (_input, init) => {
    requests += 1
    idempotencyKeys.push(new Headers(init?.headers).get('idempotency-key'))
    return new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return reject(new Error('Missing abort signal'))
      signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })
  }

  await withFetch(fetchImplementation, async () => {
    await assert.rejects(
      sender(
        { maxRetries: 2, requestTimeoutMs: 5, retryBaseDelayMs: 1 },
        { random: () => 0, sleep: async () => {} },
      ).send(defaultEmail),
      (error: unknown) => {
        assert.ok(error instanceof EmailDeliveryError)
        assert.equal(error.retryable, true)
        assert.match(error.message, /timed out after 5 ms/u)
        return true
      },
    )
  })
  assert.equal(requests, 3)
  assert.deepEqual(idempotencyKeys, Array(3).fill(defaultEmail.idempotencyKey))
})

test('rejects header injection and malformed sender, recipient and idempotency values', async () => {
  assert.throws(
    () => sender({ from: 'OpenExpert <security@auth.example.com>\r\nBcc: victim@example.com' }),
    /Sender must be a valid mailbox/u,
  )
  assert.throws(
    () => sender({ replyTo: 'support@example.com, attacker@example.com' }),
    /Reply-To must be a valid email address/u,
  )
  await assert.rejects(
    sender().send({ ...defaultEmail, to: 'not-an-email' }),
    /Recipient 1 must be a valid email address/u,
  )
  await assert.rejects(
    sender().send({ ...defaultEmail, idempotencyKey: 'auth/event\r\nX-Test: injected' }),
    /idempotency key must contain 1-256 safe ASCII characters/u,
  )
  await assert.rejects(
    sender().send({ ...defaultEmail, subject: 'Hello\r\nBcc: victim@example.com' }),
    /subject must contain/u,
  )
})

test('skips delivery without requiring a secret when no transport is configured', async () => {
  const unconfigured = createTransactionalEmailSender({})
  assert.equal(unconfigured.isConfigured, false)
  assert.equal(unconfigured.provider, null)
  assert.deepEqual(
    await unconfigured.send(defaultEmail),
    { status: 'skipped', reason: 'missing_from_address' },
  )
})
