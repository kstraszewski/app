import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  createAuthenticatedDataApiClient,
  createDataApiTokenSigner,
} from '@openexpert/data-api'

async function readOptionalText(url) {
  try {
    return await readFile(url, 'utf8')
  }
  catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return ''
    throw error
  }
}

function parseEnvText(text) {
  const values = {}
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice(7) : line
    const separator = normalized.indexOf('=')
    if (separator < 1) continue

    const key = normalized.slice(0, separator).trim()
    let value = normalized.slice(separator + 1).trim()
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\'')))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

const [rootEnvText, stackEnvText] = await Promise.all([
  readOptionalText(new URL('../../../.env', import.meta.url)),
  readOptionalText(new URL('../../../.env.local-stack', import.meta.url)),
])
const localEnv = {
  ...parseEnvText(rootEnvText),
  ...parseEnvText(stackEnvText),
  ...process.env,
}

const crmBaseUrl = String(
  localEnv.MESSAGING_TEST_CRM_BASE_URL ?? 'http://127.0.0.1:3004',
).replace(/\/+$/u, '')
const clientBaseUrl = String(
  localEnv.MESSAGING_TEST_CLIENT_BASE_URL ?? 'http://127.0.0.1:3006',
).replace(/\/+$/u, '')
const expertEmail = String(
  localEnv.MESSAGING_TEST_EXPERT_EMAIL
    ?? localEnv.OPENEXPERT_DEV_EMAIL
    ?? 'admin@openexpert.local',
)
const expertPassword = String(
  localEnv.MESSAGING_TEST_EXPERT_PASSWORD
    ?? localEnv.OPENEXPERT_DEV_PASSWORD
    ?? '',
)
const clientEmail = String(
  localEnv.MESSAGING_TEST_CLIENT_EMAIL ?? 'jan.kowalski@example.local',
)
const clientPassword = String(
  localEnv.MESSAGING_TEST_CLIENT_PASSWORD ?? 'OpenExpert123!',
)

assert.ok(expertPassword, 'Missing local expert password')

function requiredEnv(key) {
  const value = String(localEnv[key] ?? '').trim()
  assert.ok(value, `Local environment is missing ${key}`)
  return value
}

function dataApiPrivateKey(value) {
  const normalized = String(value ?? '').trim()
  if (normalized.includes('-----BEGIN')) return normalized.replace(/\\n/gu, '\n')

  const decoded = Buffer.from(normalized, 'base64').toString('utf8').trim()
  assert.match(
    decoded,
    /-----BEGIN PRIVATE KEY-----/u,
    'NUXT_DATA_API_JWT_PRIVATE_KEY must contain base64-encoded PKCS8 PEM',
  )
  return decoded
}

const dataApiUrl = String(
  localEnv.MESSAGING_TEST_DATA_API_URL
    ?? localEnv.NUXT_PUBLIC_DATA_API_URL
    ?? '',
).replace(/\/+$/u, '')
assert.ok(dataApiUrl, 'Missing local Data API URL')
assert.ok(
  ['127.0.0.1', 'localhost', '::1'].includes(new URL(dataApiUrl).hostname),
  'Case messaging smoke requires a local Data API',
)
const dataApiSigner = createDataApiTokenSigner({
  audience: requiredEnv('NUXT_DATA_API_JWT_AUDIENCE'),
  issuer: requiredEnv('NUXT_DATA_API_JWT_ISSUER'),
  keyId: requiredEnv('NUXT_DATA_API_JWT_KEY_ID'),
  privateKey: dataApiPrivateKey(requiredEnv('NUXT_DATA_API_JWT_PRIVATE_KEY')),
  ttlSeconds: 60,
})
const backendClient = createAuthenticatedDataApiClient(
  dataApiUrl,
  () => dataApiSigner.signBackend({ source: 'case-messaging-api-smoke' }),
  {
    headers: { 'X-Client-Info': 'openexpert-case-messaging-smoke/1.0' },
    retry: false,
  },
)

async function conversationOutbox(conversationId) {
  const result = await backendClient
    .from('crm_message_outbox')
    .select('id, message_id, event_type, payload, status, processed_at, last_error')
    .eq('conversation_id', conversationId)
    .order('created_at')
  assert.ifError(result.error)
  return result.data ?? []
}

function responseCookies(response) {
  const values = response.headers.getSetCookie?.() ?? []
  assert.ok(values.length, 'Better Auth did not return a session cookie')
  return values.map(value => value.split(';', 1)[0]).join('; ')
}

async function loginCookie(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      origin: new URL(baseUrl).origin,
    },
    body: JSON.stringify({ email, password }),
    redirect: 'error',
  })
  const detail = await response.text()
  assert.equal(
    response.ok,
    true,
    `Better Auth login failed: HTTP ${response.status} ${detail}`,
  )
  return responseCookies(response)
}

async function logoutCookie(baseUrl, cookie) {
  const response = await fetch(`${baseUrl}/api/auth/sign-out`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      cookie,
      origin: new URL(baseUrl).origin,
    },
    body: '{}',
    redirect: 'error',
  })
  if (!response.ok) {
    throw new Error(
      `Better Auth logout failed: HTTP ${response.status} ${await response.text()}`,
    )
  }
}

async function api(baseUrl, path, cookie = '', init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    redirect: 'error',
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  }
  catch {
    body = text
  }
  return { response, body }
}

function assertNoStore(response) {
  assert.match(
    response.headers.get('cache-control') ?? '',
    /(?:^|,)\s*private(?:,|$)/u,
  )
  assert.match(
    response.headers.get('cache-control') ?? '',
    /(?:^|,)\s*no-store(?:,|$)/u,
  )
}

function assertOk(result, context) {
  assert.equal(
    result.response.ok,
    true,
    `${context}: HTTP ${result.response.status} ${JSON.stringify(result.body)}`,
  )
  assertNoStore(result.response)
  return result.body
}

function postJson(body) {
  return { method: 'POST', body: JSON.stringify(body) }
}

const authenticatedSessions = []

try {
  const [expertCookie, clientCookie] = await Promise.all([
    loginCookie(crmBaseUrl, expertEmail, expertPassword),
    loginCookie(clientBaseUrl, clientEmail, clientPassword),
  ])
  authenticatedSessions.push(
    { baseUrl: crmBaseUrl, cookie: expertCookie },
    { baseUrl: clientBaseUrl, cookie: clientCookie },
  )

  const anonymousPortal = await api(clientBaseUrl, '/api/client/portal')
  assert.equal(anonymousPortal.response.status, 401)
  const anonymousContexts = await api(crmBaseUrl, '/api/me/contexts')
  assert.equal(anonymousContexts.response.status, 401)

  const portalResult = await api(clientBaseUrl, '/api/client/portal', clientCookie)
  const portal = assertOk(portalResult, 'Loading the client portal').data
  assert.equal(portal.linked, true)
  assert.ok(portal.cases.length > 0, 'The client has no granted case')
  const caseId = portal.activeCaseId ?? portal.cases[0].id
  assert.match(caseId, /^[0-9a-f-]{36}$/u)

  const contextsResult = await api(crmBaseUrl, '/api/me/contexts', expertCookie)
  const contexts = assertOk(contextsResult, 'Loading expert contexts')
  assert.ok(contexts.staffOrganizations.length > 0)
  const organizationSlug = contexts.staffOrganizations[0].slug

  const clientConversationPath = `/api/client/cases/${caseId}/conversation`
  const initialResult = await api(
    clientBaseUrl,
    clientConversationPath,
    clientCookie,
  )
  const initial = assertOk(initialResult, 'Opening the client conversation').data
  assert.equal(initial.realtime.mode, 'polling')
  assert.equal(initial.realtime.pollIntervalMs, 5_000)
  const conversationId = initial.conversation.id
  const clientPersonId = initial.conversation.clientPersonId
  const baselineSequence = initial.conversation.lastMessageSequence
  const baselineOutboxIds = new Set(
    (await conversationOutbox(conversationId)).map(row => row.id),
  )

  const conversationsPath = `/api/org/${encodeURIComponent(organizationSlug)}`
    + `/crm/cases/${caseId}/conversations`
  const messagesPath = `${conversationsPath}/${conversationId}/messages`
  const expertReceiptPath = `${conversationsPath}/${conversationId}/receipt`

  const clientOnCrm = await api(
    crmBaseUrl,
    conversationsPath,
    clientCookie,
  )
  assert.equal(clientOnCrm.response.status, 401)
  const expertOnPortal = await api(
    clientBaseUrl,
    clientConversationPath,
    expertCookie,
  )
  assert.equal(expertOnPortal.response.status, 401)

  const conversationListResult = await api(
    crmBaseUrl,
    conversationsPath,
    expertCookie,
  )
  const conversationList = assertOk(
    conversationListResult,
    'Listing expert conversations',
  ).data
  assert.equal(conversationList.realtime.mode, 'polling')
  assert.equal(conversationList.realtime.pollIntervalMs, 5_000)
  assert.ok(conversationList.conversations.some(
    conversation => conversation.id === conversationId,
  ))
  assert.ok(conversationList.recipients.some(
    recipient => recipient.clientPersonId === clientPersonId
      && recipient.conversationId === conversationId,
  ))

  const runId = randomUUID().slice(0, 8)
  const clientMessageId = randomUUID()
  const clientMessageBody = `Test E2E klient → ekspert ${runId}`
  const clientSendInput = {
    body: `  ${clientMessageBody}  `,
    clientMessageId,
  }
  const clientSendResult = await api(
    clientBaseUrl,
    clientConversationPath,
    clientCookie,
    postJson(clientSendInput),
  )
  const clientSend = assertOk(
    clientSendResult,
    'Sending the client message',
  ).data
  assert.equal(clientSend.created, true)
  assert.equal(clientSend.replayed, false)
  assert.equal(clientSend.realtime.mode, 'polling')
  assert.equal(clientSend.message.body, clientMessageBody)
  assert.equal(clientSend.message.senderKind, 'client')
  assert.equal(clientSend.message.senderUserId, null)
  assert.equal(clientSend.message.senderClientPersonId, clientPersonId)
  assert.equal(clientSend.message.clientMessageId, clientMessageId)
  assert.equal(clientSend.message.sequence, baselineSequence + 1)
  const clientSequence = clientSend.message.sequence

  const clientReplayResult = await api(
    clientBaseUrl,
    clientConversationPath,
    clientCookie,
    postJson(clientSendInput),
  )
  const clientReplay = assertOk(
    clientReplayResult,
    'Replaying the client message',
  ).data
  assert.equal(clientReplay.created, false)
  assert.equal(clientReplay.replayed, true)
  assert.equal(clientReplay.message.id, clientSend.message.id)
  assert.equal(clientReplay.message.sequence, clientSequence)

  const conflictingReplay = await api(
    clientBaseUrl,
    clientConversationPath,
    clientCookie,
    postJson({
      body: `${clientMessageBody} — zmieniona treść`,
      clientMessageId,
    }),
  )
  assert.equal(conflictingReplay.response.ok, false)

  const expertSyncResult = await api(
    crmBaseUrl,
    `${messagesPath}?afterSequence=${baselineSequence}`,
    expertCookie,
  )
  const expertSync = assertOk(
    expertSyncResult,
    'Synchronizing the client message for the expert',
  ).data
  assert.deepEqual(expertSync.messages.map(message => message.id), [
    clientSend.message.id,
  ])
  assert.equal(expertSync.messages[0].body, clientMessageBody)
  assert.equal(expertSync.pageInfo.lastSequence, clientSequence)
  const expertPreviousReadSequence =
    expertSync.receipt?.readThroughSequence ?? 0

  const expertDeliveredResult = await api(
    crmBaseUrl,
    expertReceiptPath,
    expertCookie,
    postJson({ deliveredThroughSequence: clientSequence }),
  )
  const expertDelivered = assertOk(
    expertDeliveredResult,
    'Marking the client message as delivered',
  ).data
  assert.equal(expertDelivered.changed, true)
  assert.equal(expertDelivered.receipt.deliveredThroughSequence, clientSequence)
  assert.equal(
    expertDelivered.receipt.readThroughSequence,
    expertPreviousReadSequence,
  )

  const expertReadResult = await api(
    crmBaseUrl,
    expertReceiptPath,
    expertCookie,
    postJson({ readThroughSequence: clientSequence }),
  )
  const expertRead = assertOk(
    expertReadResult,
    'Marking the client message as read',
  ).data
  assert.equal(expertRead.changed, true)
  assert.equal(expertRead.receipt.deliveredThroughSequence, clientSequence)
  assert.equal(expertRead.receipt.readThroughSequence, clientSequence)

  const regressedReceiptResult = await api(
    crmBaseUrl,
    expertReceiptPath,
    expertCookie,
    postJson({ deliveredThroughSequence: 0, readThroughSequence: 0 }),
  )
  const regressedReceipt = assertOk(
    regressedReceiptResult,
    'Replaying a lower expert receipt',
  ).data
  assert.equal(regressedReceipt.changed, false)
  assert.equal(regressedReceipt.receipt.readThroughSequence, clientSequence)

  const futureReceipt = await api(
    crmBaseUrl,
    expertReceiptPath,
    expertCookie,
    postJson({ readThroughSequence: clientSequence + 100 }),
  )
  assert.equal(futureReceipt.response.ok, false)

  const clientReceiptViewResult = await api(
    clientBaseUrl,
    `${clientConversationPath}?afterSequence=${clientSequence}`,
    clientCookie,
  )
  const clientReceiptView = assertOk(
    clientReceiptViewResult,
    'Loading the expert read receipt for the client',
  ).data
  assert.equal(clientReceiptView.messages.length, 0)
  assert.equal(
    clientReceiptView.peerReceipt.readThroughSequence,
    clientSequence,
  )

  const expertMessageId = randomUUID()
  const expertMessageBody = `Test E2E ekspert → klient ${runId}`
  const expertSendInput = {
    body: expertMessageBody,
    clientMessageId: expertMessageId,
  }
  const expertSendResult = await api(
    crmBaseUrl,
    messagesPath,
    expertCookie,
    postJson(expertSendInput),
  )
  const expertSend = assertOk(
    expertSendResult,
    'Sending the expert response',
  ).data
  assert.equal(expertSend.created, true)
  assert.equal(expertSend.replayed, false)
  assert.equal(expertSend.realtime.mode, 'polling')
  assert.equal(expertSend.message.senderKind, 'staff')
  assert.equal(expertSend.message.senderClientPersonId, null)
  assert.equal(expertSend.message.clientMessageId, expertMessageId)
  assert.equal(expertSend.message.sequence, clientSequence + 1)
  const expertSequence = expertSend.message.sequence

  const expertReplayResult = await api(
    crmBaseUrl,
    messagesPath,
    expertCookie,
    postJson(expertSendInput),
  )
  const expertReplay = assertOk(
    expertReplayResult,
    'Replaying the expert response',
  ).data
  assert.equal(expertReplay.created, false)
  assert.equal(expertReplay.replayed, true)
  assert.equal(expertReplay.message.id, expertSend.message.id)
  assert.equal(expertReplay.message.sequence, expertSequence)

  const clientSyncResult = await api(
    clientBaseUrl,
    `${clientConversationPath}?afterSequence=${clientSequence}`,
    clientCookie,
  )
  const clientSync = assertOk(
    clientSyncResult,
    'Synchronizing the expert response for the client',
  ).data
  assert.deepEqual(clientSync.messages.map(message => message.id), [
    expertSend.message.id,
  ])
  assert.equal(clientSync.messages[0].body, expertMessageBody)
  assert.equal(clientSync.pageInfo.lastSequence, expertSequence)

  const clientReadResult = await api(
    clientBaseUrl,
    `${clientConversationPath}/receipt`,
    clientCookie,
    postJson({ readThroughSequence: expertSequence }),
  )
  const clientRead = assertOk(
    clientReadResult,
    'Marking the expert response as read',
  ).data
  assert.equal(clientRead.changed, true)
  assert.equal(clientRead.receipt.deliveredThroughSequence, expertSequence)
  assert.equal(clientRead.receipt.readThroughSequence, expertSequence)

  const expertReceiptViewResult = await api(
    crmBaseUrl,
    `${messagesPath}?afterSequence=${expertSequence}`,
    expertCookie,
  )
  const expertReceiptView = assertOk(
    expertReceiptViewResult,
    'Loading the client read receipt for the expert',
  ).data
  assert.equal(expertReceiptView.messages.length, 0)
  assert.equal(
    expertReceiptView.peerReceipt.readThroughSequence,
    expertSequence,
  )

  const clientReloadResult = await api(
    clientBaseUrl,
    clientConversationPath,
    clientCookie,
  )
  const clientReload = assertOk(
    clientReloadResult,
    'Reloading the durable client history',
  ).data
  const clientReloadedIds = clientReload.messages.map(message => message.id)
  assert.ok(clientReloadedIds.includes(clientSend.message.id))
  assert.ok(clientReloadedIds.includes(expertSend.message.id))
  assert.ok(
    clientReloadedIds.indexOf(clientSend.message.id)
      < clientReloadedIds.indexOf(expertSend.message.id),
  )

  const expertReloadResult = await api(
    crmBaseUrl,
    messagesPath,
    expertCookie,
  )
  const expertReload = assertOk(
    expertReloadResult,
    'Reloading the durable expert history',
  ).data
  assert.deepEqual(
    expertReload.messages.map(message => message.id),
    clientReload.messages.map(message => message.id),
  )

  const clientToken = await api(
    clientBaseUrl,
    `${clientConversationPath}/token`,
    clientCookie,
  )
  assert.equal(clientToken.response.status, 503)
  const expertToken = await api(
    crmBaseUrl,
    `${conversationsPath}/${conversationId}/token`,
    expertCookie,
  )
  assert.equal(expertToken.response.status, 503)

  const messageRowsResult = await backendClient
    .from('crm_case_messages')
    .select('id, client_message_id, sequence')
    .eq('conversation_id', conversationId)
    .in('id', [clientSend.message.id, expertSend.message.id])
    .order('sequence')
  assert.ifError(messageRowsResult.error)
  assert.deepEqual(
    (messageRowsResult.data ?? []).map(row => row.id),
    [clientSend.message.id, expertSend.message.id],
  )

  const immutableMessageUpdate = await backendClient
    .from('crm_case_messages')
    .update({ body: clientMessageBody })
    .eq('id', clientSend.message.id)
    .select('id')
  assert.ok(
    immutableMessageUpdate.error,
    'The backend service must not update durable message rows directly',
  )
  assert.equal(immutableMessageUpdate.error.code, '42501')

  const newOutboxRows = (await conversationOutbox(conversationId))
    .filter(row => !baselineOutboxIds.has(row.id))
  assert.equal(newOutboxRows.length, 5)
  assert.equal(
    newOutboxRows.filter(row => row.event_type === 'message.created').length,
    2,
  )
  assert.equal(
    newOutboxRows.filter(row => row.event_type === 'receipt.updated').length,
    3,
  )
  assert.deepEqual(
    newOutboxRows
      .filter(row => row.message_id)
      .map(row => row.message_id)
      .sort(),
    [clientSend.message.id, expertSend.message.id].sort(),
  )
  for (const outbox of newOutboxRows) {
    assert.equal(outbox.status, 'completed')
    assert.ok(outbox.processed_at)
    assert.equal(outbox.last_error, null)
    const serializedPayload = JSON.stringify(outbox.payload)
    assert.equal(serializedPayload.includes(clientMessageBody), false)
    assert.equal(serializedPayload.includes(expertMessageBody), false)
    assert.equal(Object.hasOwn(outbox.payload, 'body'), false)
  }

  console.log('case-messaging-api-smoke: ok')
  console.log(JSON.stringify({
    caseId,
    conversationId,
    clientMessageId: clientSend.message.id,
    clientSequence,
    expertMessageId: expertSend.message.id,
    expertSequence,
    realtimeMode: initial.realtime.mode,
  }, null, 2))
}
finally {
  await Promise.allSettled(authenticatedSessions.map(session => (
    logoutCookie(session.baseUrl, session.cookie)
  )))
}
