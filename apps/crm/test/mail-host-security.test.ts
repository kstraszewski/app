import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isPublicMailAddress,
  MailHostSecurityError,
  normalizeMailEndpoint,
  normalizeMailHostname,
  resolveSecureMailEndpoint,
} from '../server/utils/mail-host-security.ts'

test('accepts only the supported encrypted IMAP and SMTP transport pairs', () => {
  assert.deepEqual(normalizeMailEndpoint('imap', {
    host: 'IMAP.Example.com.',
    port: 993,
    security: 'tls',
  }), {
    host: 'imap.example.com',
    port: 993,
    security: 'tls',
  })
  assert.deepEqual(normalizeMailEndpoint('smtp', {
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
  }), {
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
  })

  for (const endpoint of [
    ['imap', 143, 'tls'],
    ['imap', 993, 'starttls'],
    ['smtp', 25, 'starttls'],
    ['smtp', 465, 'starttls'],
    ['smtp', 587, 'tls'],
  ] as const) {
    assert.throws(
      () => normalizeMailEndpoint(endpoint[0], {
        host: 'mail.example.com',
        port: endpoint[1],
        security: endpoint[2],
      }),
      MailHostSecurityError,
    )
  }
})

test('normalizes IDN DNS identities and rejects URLs, literals, and local names', () => {
  assert.equal(normalizeMailHostname('Poczta.żółw.pl.'), 'poczta.xn--w-uga1v8h.pl')
  for (const hostname of [
    'localhost',
    'mail',
    '127.0.0.1',
    '[::1]',
    'https://mail.example.com',
    'user@mail.example.com',
    'mail.example.com/path',
    'mail..example.com',
    '-mail.example.com',
  ]) {
    assert.throws(() => normalizeMailHostname(hostname), MailHostSecurityError)
  }
})

test('classifies public and non-public IPv4 and IPv6 address ranges', () => {
  for (const address of [
    '8.8.8.8',
    '1.1.1.1',
    '2001:4860:4860::8888',
    '2001:1::1',
    '2001:3::1',
    '2001:4:112::1',
    '2606:4700:4700::1111',
  ]) {
    assert.equal(isPublicMailAddress(address), true, address)
  }
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '::',
    '::1',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '100:0:0:1::1',
    '2001::1',
    '2001:2::1',
    '2001:10::1',
    '2001:db8::1',
    '3fff::1',
    '5f00::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
  ]) {
    assert.equal(isPublicMailAddress(address), false, address)
  }
})

test('pins a validated DNS answer while retaining the DNS name for TLS', async () => {
  const endpoint = await resolveSecureMailEndpoint('imap', {
    host: 'imap.example.com',
    port: 993,
    security: 'tls',
  }, {
    lookup: (async (hostname: string, options: unknown) => {
      assert.equal(hostname, 'imap.example.com')
      assert.deepEqual(options, { all: true, verbatim: true })
      return [
        { address: '8.8.8.8', family: 4 },
        { address: '2001:4860:4860::8888', family: 6 },
      ]
    }) as any,
  })

  assert.equal(endpoint.address, '8.8.8.8')
  assert.equal(endpoint.servername, 'imap.example.com')
  assert.deepEqual(endpoint.addresses, [{
    address: '8.8.8.8',
    family: 4,
  }, {
    address: '2001:4860:4860:0000:0000:0000:0000:8888',
    family: 6,
  }])
})

test('rejects the entire hostname if any DNS answer is non-public', async () => {
  await assert.rejects(
    resolveSecureMailEndpoint('smtp', {
      host: 'smtp.example.com',
      port: 465,
      security: 'tls',
    }, {
      lookup: (async () => [
        { address: '1.1.1.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]) as any,
    }),
    (error: unknown) => (
      error instanceof MailHostSecurityError
      && error.code === 'NON_PUBLIC_ADDRESS'
    ),
  )
})

test('bounds DNS resolution time and does not accept an empty result', async () => {
  await assert.rejects(
    resolveSecureMailEndpoint('imap', {
      host: 'imap.example.com',
      port: 143,
      security: 'starttls',
    }, {
      lookup: (() => new Promise(() => {})) as any,
      timeoutMs: 5,
    }),
    (error: unknown) => (
      error instanceof MailHostSecurityError
      && error.code === 'DNS_TIMEOUT'
    ),
  )
  await assert.rejects(
    resolveSecureMailEndpoint('imap', {
      host: 'imap.example.com',
      port: 993,
      security: 'tls',
    }, {
      lookup: (async () => []) as any,
    }),
    (error: unknown) => (
      error instanceof MailHostSecurityError
      && error.code === 'DNS_EMPTY'
    ),
  )
})
