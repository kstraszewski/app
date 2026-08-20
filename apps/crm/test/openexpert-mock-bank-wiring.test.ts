import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveMortgageBankLogoUrl } from '../server/utils/openexpert-mock-bank-brand.ts'

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const config = source('../nuxt.config.ts')
const catalog = source('../server/utils/mortgage-catalog.ts')
const productsRoute = source('../server/api/org/[organizationSlug]/mortgages/products.get.ts')
const banksRoute = source('../server/api/org/[organizationSlug]/mortgages/banks.get.ts')
const bankDetailRoute = source('../server/api/org/[organizationSlug]/mortgages/banks/[bankId].get.ts')
const backofficeBanksRoute = source('../server/api/backoffice/mortgages/banks.get.ts')
const backofficeOfferRoute = source('../server/api/backoffice/mortgages/offers/[offerId].get.ts')
const saveOfferRoute = source('../server/api/org/[organizationSlug]/crm/cases/[id]/offers/index.post.ts')
const createApplicationRoute = source('../server/api/org/[organizationSlug]/crm/cases/[id]/applications/index.post.ts')
const bankFilesRoute = source('../server/api/org/[organizationSlug]/mortgages/files/index.get.ts')
const experimentKnowledge = source('../server/utils/experiment-knowledge.ts')
const intermediaryLenders = source('../server/utils/intermediary-lenders.ts')
const mockBrand = source('../server/utils/openexpert-mock-bank-brand.ts')
const mockService = source('../server/utils/openexpert-mock-bank-service.ts')
const mockSimulator = source('../server/utils/openexpert-mock-bank-simulator.ts')
const mockActions = source('../server/utils/openexpert-mock-bank-actions.ts')
const mockDelivery = source('../server/utils/openexpert-mock-bank-delivery.ts')
const mockDispatch = source('../server/utils/openexpert-mock-bank-dispatch.ts')
const mockPayload = source('../server/utils/openexpert-mock-bank-payload.ts')
const mockCleanup = source('../server/utils/openexpert-mock-bank-cleanup.ts')
const esisRoute = source('../server/api/org/[organizationSlug]/crm/cases/[id]/applications/[applicationId]/mock-bank/esis.post.ts')
const submitRoute = source('../server/api/org/[organizationSlug]/crm/cases/[id]/applications/[applicationId]/mock-bank/submit.post.ts')
const decisionRoute = source('../server/api/org/[organizationSlug]/crm/cases/[id]/applications/[applicationId]/mock-bank/decision.post.ts')
const caseRoute = source('../server/api/org/[organizationSlug]/crm/cases/[id].get.ts')
const applicationsUi = source('../app/components/CaseBankApplications.vue')
const mortgageActionUi = source('../app/components/CaseMortgageActionSlideover.vue')
const notificationOutboxRoute = source('../server/api/internal/notifications/outbox.post.ts')
const notificationOutboxWorker = source('../../../packages/tasks/src/trigger/notification-outbox.ts')
const migration = source('../../../packages/database/postgres/migrations/0058_openexpert_mock_bank.sql')
const logoRepairMigration = source('../../../packages/database/postgres/migrations/0059_openexpert_mock_bank_logo_url.sql')
const bankLogo = source('../public/assets/openexpert-bank.svg')
const envExample = source('../../../.env.example')
const productionMigrator = source('../../../packages/database/scripts/migrate-production-knowledge-release.mjs')
const readme = source('../../../README.md')

test('mock-bank logo resolves on the current CRM origin in every environment', () => {
  assert.equal(
    resolveMortgageBankLogoUrl('openexpert-bank', 'https://openexpert-crm.vercel.app/assets/openexpert-bank.svg'),
    '/assets/openexpert-bank.svg',
  )
  assert.equal(
    resolveMortgageBankLogoUrl('ing', 'https://www.ing.pl/logo.svg'),
    'https://www.ing.pl/logo.svg',
  )
})

test('case read model fails closed while the managed Data API schema cache is stale', () => {
  assert.match(caseRoute, /String\(error\?\.code \?\? ''\) !== 'PGRST205'/u)
  assert.match(caseRoute, /message\.includes\('crm_mock_bank_dispatches'\) && message\.includes\('schema cache'\)/u)
  assert.match(caseRoute, /mock_bank_enabled: mockBankReadModelEnabled/u)
  assert.match(caseRoute, /enabled: mockBankReadModelEnabled/u)
  assert.match(productionMigrator, /pg_notify\('pgrst', 'reload schema'\)/u)
  assert.match(readme, /neonctl@latest data-api refresh-schema/u)
  assert.match(readme, /Samo postgresowe `NOTIFY pgrst` nie odświeża zarządzanego cache'u Neon/u)
})

test('feature flag controls mock-bank discovery and offer persistence', () => {
  assert.match(
    config,
    /const mockBankEnabled = process\.env\.NUXT_MOCK_BANK_ENABLED[\s\S]*?: !isProduction/u,
  )
  assert.match(config, /mockBank:\s*\{\s*enabled: mockBankEnabled,/u)

  assert.match(catalog, /includeMock\?: boolean/u)
  assert.match(catalog, /mortgage_banks!inner\([^)]*is_mock\)/u)
  assert.match(catalog, /if \(rawBank\?\.is_mock === true && !options\.includeMock\) return \[\]/u)

  for (const route of [productsRoute, saveOfferRoute]) {
    assert.match(route, /isOpenExpertMockBankEnabled\(event, session\.organizationId\)/u)
    assert.match(route, /includeMock: mockBankEnabled/u)
  }
  assert.match(banksRoute, /isOpenExpertMockBankEnabled\(event, session\.organizationId\)/u)
  assert.match(banksRoute, /if \(!mockBankEnabled\) banksQuery = banksQuery\.eq\('is_mock', false\)/u)

  assert.match(mockService, /config\?\.enabled === true \|\| config\?\.enabled === 'true'/u)
  assert.match(mockService, /if \(config\.allowAllOrganizations === true\) return true/u)
  assert.match(mockService, /config\.organizationIds\?\.includes\(normalizedOrganizationId\)/u)
  assert.match(mockService, /requireOpenExpertMockBankEnabled\(event, session\.organizationId\)/u)
  assert.match(
    mockService,
    /bank\.is_mock !== true \|\| String\(bank\.slug\) !== OPENEXPERT_MOCK_BANK_SLUG/u,
  )
  assert.match(migration, /'openexpert-bank',\s*'OpenExpert Bank'/u)
  assert.match(migration, /'https:\/\/openexpert-crm\.vercel\.app\/assets\/openexpert-bank\.svg'/u)
  assert.match(logoRepairMigration, /UPDATE public\.mortgage_banks/u)
  assert.match(logoRepairMigration, /slug = 'openexpert-bank'/u)
  assert.match(logoRepairMigration, /is_mock = true/u)
  assert.match(logoRepairMigration, /https:\/\/openexpert-crm\.vercel\.app\/assets\/openexpert-bank\.svg/u)
  assert.match(migration, /is_mock = true/u)

  assert.match(mockBrand, /OPENEXPERT_MOCK_BANK_LOGO_PATH = '\/assets\/openexpert-bank\.svg'/u)
  assert.match(mockBrand, /bankSlug === 'openexpert-bank'/u)
  for (const consumer of [banksRoute, bankDetailRoute, catalog, caseRoute, backofficeBanksRoute, backofficeOfferRoute]) {
    assert.match(consumer, /resolveMortgageBankLogoUrl/u)
  }

  assert.match(bankLogo, /<title>OpenExpert Bank<\/title>/u)
  assert.match(bankLogo, /fill="#111827"/u)
  assert.match(bankLogo, /fill="#2563EB"/u)
  assert.match(bankLogo, /fill="#16A34A"/u)
})

test('all CRM email services share one Resend key while the simulator keeps its own identity', () => {
  const authConfigStart = config.indexOf('    authEmail: {')
  const mockConfigStart = config.indexOf('    mockBank: {')
  const authConfigEnd = mockConfigStart
  const mockConfigEnd = config.indexOf('    authSms: {', mockConfigStart)
  assert.ok(authConfigStart >= 0)
  assert.ok(authConfigEnd > authConfigStart)
  assert.ok(mockConfigStart >= 0)
  assert.ok(mockConfigEnd > mockConfigStart)
  const authConfig = config.slice(authConfigStart, authConfigEnd)
  const mockConfig = config.slice(mockConfigStart, mockConfigEnd)

  assert.match(config, /const resendApiKey = process\.env\.NUXT_RESEND_API_KEY \|\| ''/u)
  assert.match(authConfig, /apiKey: resendApiKey/u)
  assert.match(mockConfig, /apiKey: resendApiKey/u)
  assert.doesNotMatch(config, /NUXT_(?:AUTH|MOCK_BANK)_RESEND_API_KEY/u)
  assert.match(mockConfig, /host: process\.env\.NUXT_SMTP_HOST \|\| \(isProduction \? '' : '127\.0\.0\.1'\)/u)
  assert.match(mockConfig, /port: Number\(process\.env\.NUXT_SMTP_PORT \|\| 55325\)/u)
  assert.match(mockConfig, /allowAllOrganizations: !isProduction/u)
  assert.match(mockConfig, /organizationIds: mockBankOrganizationIds/u)
  assert.match(config, /process\.env\.NUXT_MOCK_BANK_ORGANIZATION_IDS/u)
  assert.match(config, /mockBankOrganizationIds\.some\(value => !mockBankOrganizationIdPattern\.test\(value\)\)/u)

  assert.match(envExample, /^NUXT_RESEND_API_KEY=re_your_api_key$/mu)
  assert.doesNotMatch(envExample, /NUXT_(?:AUTH|MOCK_BANK)_RESEND_API_KEY/u)
  assert.match(envExample, /^# NUXT_MOCK_BANK_ORGANIZATION_IDS=[0-9a-f-]+$/mu)
  assert.doesNotMatch(envExample, /^NUXT_MOCK_BANK_ORGANIZATION_IDS=/mu)
  assert.match(envExample, /^NUXT_SMTP_PORT=55325$/mu)
})

test('organization gate also protects saved offers and non-demo bank directories', () => {
  assert.match(createApplicationRoute, /\.from\('crm_case_offer_snapshots'\)/u)
  assert.match(createApplicationRoute, /\.from\('mortgage_banks'\)[\s\S]*?\.select\('is_mock'\)/u)
  assert.match(
    createApplicationRoute,
    /bankScopeResult\.data\?\.is_mock === true[\s\S]*?!isOpenExpertMockBankEnabled\(event, session\.organizationId\)/u,
  )

  assert.match(
    applicationsUi,
    /offer\.bank_is_mock !== true \|\| props\.caseData\.mock_bank_enabled/u,
  )
  assert.match(
    applicationsUi,
    /isMockBankOffer\(application\) && application\.mock_bank\?\.enabled === true/u,
  )

  assert.match(experimentKnowledge, /\.from\('mortgage_banks'\)[\s\S]*?\.eq\('is_mock', false\)/u)
  assert.match(intermediaryLenders, /\.from\('mortgage_banks'\)[\s\S]*?\.eq\('is_mock', false\)/u)
  assert.match(bankFilesRoute, /\.from\('mortgage_banks'\)[\s\S]*?\.eq\('is_mock', false\)/u)
  assert.match(bankFilesRoute, /\.eq\('mortgage_banks\.is_mock', false\)/u)
})

test('ESIS and decision endpoints emit typed events into the bank simulator service', () => {
  for (const route of [esisRoute, decisionRoute]) {
    assert.match(route, /await requireCrmSession\(event\)/u)
    assert.match(route, /await requireCrmCase\(session, caseId\)/u)
    assert.match(route, /const unsupported = Object\.keys\(body\)/u)
    assert.match(route, /\['requestId', 'forceResend'\]\.includes\(key\)/u)
    assert.match(route, /if \(typeof value !== 'boolean'\)/u)
    assert.match(route, /const forceResend = forceResendValue\(body\.forceResend\)/u)
    assert.match(route, /return emitOpenExpertMockBankEvent\(\{/u)
    assert.match(route, /bankEvent:/u)
    assert.match(route, /forceResend/u)
  }

  assert.match(esisRoute, /type: 'esis_requested'/u)
  assert.match(decisionRoute, /type: 'credit_decision_requested'/u)
  assert.match(mockSimulator, /export type OpenExpertMockBankEvent/u)
  assert.match(mockSimulator, /context\.process\.stage !== 'pre_application'/u)
  assert.match(mockSimulator, /context\.process\.stage !== 'under_review'/u)
  assert.match(mockSimulator, /requireOpenExpertMockBankDeliveryConfigured\(input\.event, input\.session\.organizationId\)/u)
  assert.match(mockSimulator, /return requireOpenExpertMockBankRecipient\(input\.event, input\.session\)/u)
  assert.match(mockSimulator, /kind: 'esis'/u)
  assert.match(mockSimulator, /kind: 'credit_decision'/u)
})

test('mock submit follows submit, acknowledgement, completeness and decision order', () => {
  assert.match(submitRoute, /type: 'application_submitted'/u)
  assert.match(submitRoute, /return emitOpenExpertMockBankEvent\(\{/u)
  assert.match(
    mockSimulator,
    /\['pre_application', 'submitted', 'awaiting_completeness', 'under_review'\][\s\S]*?\.includes\(context\.process\.stage\)/u,
  )

  const configuredAt = mockSimulator.indexOf('requireOpenExpertMockBankDeliveryConfigured(input.event, input.session.organizationId)')
  const recipientAt = mockSimulator.indexOf('return requireOpenExpertMockBankRecipient(input.event, input.session)')
  const submitAt = mockSimulator.indexOf("command: { type: 'submit_application'")
  const acknowledgeAt = mockSimulator.indexOf("command: { type: 'acknowledge_application'")
  const completenessAt = mockSimulator.indexOf("command: { type: 'confirm_completeness'")
  const contextReloadAt = mockSimulator.indexOf('\n  context = await requireOpenExpertMockBankContext', completenessAt)
  const decisionAt = mockSimulator.indexOf('const delivery = await dispatchOpenExpertMockBankDocument', contextReloadAt)

  assert.ok(configuredAt >= 0)
  assert.ok(recipientAt > configuredAt)
  assert.ok(submitAt > recipientAt)
  assert.ok(acknowledgeAt > submitAt)
  assert.ok(completenessAt > acknowledgeAt)
  assert.ok(contextReloadAt > completenessAt)
  assert.ok(decisionAt > contextReloadAt)

  assert.match(mockSimulator, /'acknowledge-application'/u)
  assert.match(mockSimulator, /'confirm-completeness'/u)
  assert.match(mockSimulator, /'credit-decision-email'/u)
  assert.match(mockSimulator, /if \(stage !== 'under_review'\)/u)
  assert.match(mockSimulator, /kind: 'credit_decision'/u)
})

test('sent replay, explicit resend and active leases have distinct semantics', () => {
  const reserveStart = migration.indexOf('CREATE FUNCTION public.reserve_crm_mock_bank_dispatch(')
  const reserveEnd = migration.indexOf('\n$$;', reserveStart)
  assert.ok(reserveStart >= 0)
  assert.ok(reserveEnd > reserveStart)
  const reserveSql = migration.slice(reserveStart, reserveEnd)

  assert.match(reserveSql, /p_force_resend boolean DEFAULT false/u)
  const replayAt = reserveSql.indexOf("IF FOUND AND dispatch_row.status = 'sent' AND NOT p_force_resend THEN")
  const activeLeaseAt = reserveSql.indexOf("AND dispatch_row.status = 'pending'", replayAt)
  const forceAt = reserveSql.indexOf("IF dispatch_row.status = 'sent' THEN", activeLeaseAt)
  assert.ok(replayAt >= 0)
  assert.ok(activeLeaseAt > replayAt)
  assert.ok(forceAt > activeLeaseAt)
  assert.match(reserveSql.slice(replayAt, activeLeaseAt), /'sent',\s*false/u)
  assert.match(reserveSql.slice(activeLeaseAt, forceAt), /'in_progress',\s*false/u)

  const forceEnd = reserveSql.indexOf('\n  ELSE', forceAt)
  assert.ok(forceEnd > forceAt)
  const forceGeneration = reserveSql.slice(forceAt, forceEnd)
  assert.match(forceGeneration, /sent_at > lease_now - interval '60 seconds'/u)
  assert.match(forceGeneration, /crm_mock_bank_force_resend_cooldown/u)
  assert.match(forceGeneration, /next_generation := dispatch_row\.generation \+ 1/u)
  assert.match(forceGeneration, /next_payload_id := gen_random_uuid\(\)/u)
  assert.match(forceGeneration, /generation_started_at = lease_now/u)
  assert.match(forceGeneration, /attempts = 1/u)
  assert.match(forceGeneration, /payload_id = next_payload_id/u)
  assert.match(forceGeneration, /manifest_sha256 = NULL/u)
  assert.match(forceGeneration, /archive_sha256 = NULL/u)
  assert.match(forceGeneration, /payload_sha256 = NULL/u)

  assert.match(mockDispatch, /p_force_resend: input\.forceResend === true/u)
  assert.match(mockActions, /forceResend: input\.forceResend/u)
  assert.match(applicationsUi, /setInterval\([\s\S]*?5_000/u)
  assert.match(applicationsUi, /dispatch\.status === 'pending'[\s\S]*?lease_expires_at[\s\S]*?> clockMs\.value/u)
  assert.match(applicationsUi, /timestamp \+ 60_000 > clockMs\.value/u)
  assert.match(applicationsUi, /const forceResend = application\.mock_bank\?\.esis\?\.status === 'sent'/u)
  assert.match(applicationsUi, /const forceResend = application\.mock_bank\?\.credit_decision\?\.status === 'sent'/u)
  assert.equal(applicationsUi.match(/body: \{ requestId: newRequestId\(\), forceResend \}/gu)?.length, 2)
  assert.match(applicationsUi, /Wyślij ponownie ESIS/u)
  assert.match(applicationsUi, /Wyślij ponownie decyzję/u)
  assert.match(applicationsUi, /Dostawca poczty przyjął ESIS do wysyłki/u)
  assert.match(applicationsUi, /Dostawca poczty przyjął decyzję do wysyłki/u)
  assert.match(migration, /CREATE TRIGGER crm_case_bank_applications_guard_mock_delivery_delete/u)
  assert.match(migration, /CREATE TRIGGER crm_mortgage_processes_guard_mock_delivery_transition/u)
  assert.match(migration, /crm_mock_bank_delivery_lease_active/u)
  assert.match(
    reserveSql,
    /dispatch_row\.error_code = 'payload_retention_expired'[\s\S]*?IF p_force_resend THEN[\s\S]*?crm_mock_bank_force_resend_requires_sent_generation/u,
  )
})

test('same-generation retry reuses committed private payload and hashes', () => {
  assert.match(migration, /UNIQUE \(application_id, kind\)/u)
  assert.match(migration, /UNIQUE \(request_id\)/u)
  assert.match(migration, /generation_started_at timestamptz NOT NULL/u)
  assert.match(migration, /payload_id uuid NOT NULL/u)
  assert.match(migration, /manifest_storage_path text NOT NULL/u)
  assert.match(migration, /archive_storage_path text NOT NULL/u)
  assert.match(migration, /manifest_sha256 text/u)
  assert.match(migration, /archive_sha256 text/u)
  assert.match(migration, /payload_sha256 text/u)
  assert.match(migration, /payload_ready_at timestamptz/u)

  const retryStart = migration.indexOf('-- Retry the same generation.')
  const retryEnd = migration.indexOf('RETURNING * INTO dispatch_row;', retryStart)
  assert.ok(retryStart >= 0)
  assert.ok(retryEnd > retryStart)
  const retrySql = migration.slice(retryStart, retryEnd)
  assert.match(retrySql, /attempts = dispatch\.attempts \+ 1/u)
  assert.match(retrySql, /request_id = p_request_id/u)
  assert.doesNotMatch(
    retrySql,
    /\b(?:generation|generation_started_at|payload_id|manifest_storage_path|archive_storage_path|recipient_connection_id)\s*=/u,
  )
  assert.match(migration, /crm_mock_bank_dispatch_recipient_binding_mismatch/u)
  assert.match(migration, /CREATE FUNCTION public\.commit_crm_mock_bank_dispatch_payload\(/u)
  assert.match(migration, /dispatch_row\.generation IS DISTINCT FROM p_generation/u)
  assert.match(migration, /crm_mock_bank_payload_commit_mismatch/u)
  assert.match(migration, /p_status = 'sent' AND dispatch_row\.payload_ready_at IS NULL/u)
  const commitStart = migration.indexOf('CREATE FUNCTION public.commit_crm_mock_bank_dispatch_payload(')
  const commitEnd = migration.indexOf('CREATE FUNCTION public.renew_crm_mock_bank_dispatch_send_lease(', commitStart)
  const commitSql = migration.slice(commitStart, commitEnd)
  assert.ok(commitStart >= 0)
  assert.ok(commitEnd > commitStart)
  assert.ok(commitSql.indexOf("dispatch_row.status <> 'pending'") < commitSql.indexOf('dispatch_row.payload_ready_at IS NOT NULL'))

  assert.match(migration, /CREATE FUNCTION public\.renew_crm_mock_bank_dispatch_send_lease\(/u)
  assert.match(migration, /FOR UPDATE OF application, process/u)
  assert.match(migration, /dispatch_row\.payload_ready_at IS NULL/u)
  assert.match(migration, /lease_expires_at = renewal_now \+ interval '5 minutes'/u)
  assert.match(mockDispatch, /backendData\.rpc\('renew_crm_mock_bank_dispatch_send_lease'/u)
  const renewAt = mockDelivery.indexOf('renewOpenExpertMockBankDispatchSendLease({')
  const providerSendAt = mockDelivery.indexOf('await sender.send({')
  assert.ok(renewAt >= 0)
  assert.ok(providerSendAt > renewAt)

  assert.match(mockPayload, /OPENEXPERT_MOCK_BANK_OUTBOX_NAMESPACE = 'crm-mock-bank-outbox'/u)
  assert.match(mockPayload, /overwrite: false/u)
  assert.match(mockPayload, /stored\.sha256 !== assertSha256\(input\.expectedSha256/u)
  assert.match(mockPayload, /openExpertMockBankFullPayloadSha256/u)
  assert.match(mockDispatch, /backendData\.rpc\('commit_crm_mock_bank_dispatch_payload'/u)
  assert.match(mockDelivery, /input\.reservation\.payloadReadyAt\s*\? loadCommittedPayload\(input\)\s*: createOrRecoverPayload\(input\)/u)
  const persistedPayloadStart = mockDelivery.indexOf('async function persistedPayload(')
  const deliverStart = mockDelivery.indexOf('export async function deliverOpenExpertMockBankDocument(', persistedPayloadStart)
  const persistedPayloadSource = mockDelivery.slice(persistedPayloadStart, deliverStart)
  assert.ok(persistedPayloadStart >= 0)
  assert.ok(deliverStart > persistedPayloadStart)
  assert.doesNotMatch(persistedPayloadSource, /verifyOpenExpertMockBankEncryptedArchive/u)
  assert.match(
    mockDelivery.slice(
      mockDelivery.indexOf('async function createOrRecoverPayload('),
      persistedPayloadStart,
    ),
    /verifyOpenExpertMockBankEncryptedArchive/u,
  )
  assert.match(mockDelivery, /expectedSha256: input\.reservation\.manifestSha256/u)
  assert.match(mockDelivery, /expectedSha256: input\.reservation\.archiveSha256/u)
  assert.match(mockDelivery, /payloadSha256 !== input\.reservation\.payloadSha256/u)
  assert.match(
    mockDelivery,
    /openExpertMockBankEmailIdempotencyKey\([\s\S]*?input\.reservation\.dispatchId,[\s\S]*?input\.reservation\.generation/u,
  )
  assert.match(mockDelivery, /to: payload\.manifest\.message\.to/u)
  assert.match(mockDelivery, /content: payload\.archiveObject\.bytes/u)
  assert.match(mockActions, /reservation\.recipientConnectionId !== input\.recipient\.connectionId/u)
  assert.match(mockActions, /status: 'failed',[\s\S]*?throw error/u)
  assert.match(mockCleanup, /namespace: OPENEXPERT_MOCK_BANK_OUTBOX_NAMESPACE/u)
  assert.match(migration, /CREATE TRIGGER crm_mock_bank_dispatches_enqueue_sent_payload_cleanup/u)

  assert.match(
    mortgageActionUi,
    /if \(props\.actionKind === 'submit-application' && isMockBank\.value\)[\s\S]*?processCommandId\.value = newCommandId\(\)[\s\S]*?emit\('refresh'\)/u,
  )
})

test('durable payload cleanup is drained opportunistically and by the scheduled outbox worker', () => {
  assert.equal(
    mockActions.match(
      /await cleanupOpenExpertMockBankPayloads\(input\.event, \{ suppressClaimErrors: true \}\)/gu,
    )?.length,
    2,
  )

  assert.match(migration, /CREATE TABLE public\.crm_mock_bank_payload_cleanup_jobs \(/u)
  assert.match(migration, /CREATE FUNCTION public\.claim_crm_mock_bank_payload_cleanup_jobs\(/u)
  assert.match(migration, /CREATE FUNCTION public\.finalize_crm_mock_bank_payload_cleanup_job\(/u)
  assert.match(migration, /CREATE FUNCTION private\.expire_crm_mock_bank_payloads\(/u)
  assert.match(migration, /last_attempt_at <= sweep_now - interval '7 days'/u)
  assert.match(migration, /error_code = 'payload_retention_expired'/u)
  assert.match(migration, /PERFORM private\.expire_crm_mock_bank_payloads\(p_limit\)/u)
  assert.match(migration, /dispatch_row\.error_code = 'payload_retention_expired'[\s\S]*?next_generation := dispatch_row\.generation \+ 1/u)
  assert.match(migration, /CREATE TRIGGER crm_mock_bank_dispatches_enqueue_sent_payload_cleanup/u)
  assert.match(migration, /CREATE TRIGGER crm_mock_bank_dispatches_enqueue_deleted_payload_cleanup/u)
  assert.match(mockCleanup, /claimOpenExpertMockBankPayloadCleanupJobs\(/u)
  assert.match(mockCleanup, /finalizeOpenExpertMockBankPayloadCleanupJob\(/u)

  assert.match(
    notificationOutboxRoute,
    /import \{ cleanupOpenExpertMockBankPayloads \} from '~~\/server\/utils\/openexpert-mock-bank-cleanup'/u,
  )
  assert.match(
    notificationOutboxRoute,
    /Promise\.all\(\[[\s\S]*?cleanupOpenExpertMockBankPayloads\(event, \{ limit: Math\.min\(limit, 20\) \}\)[\s\S]*?\]\)/u,
  )
  for (const metric of ['claimed', 'completed', 'failed']) {
    assert.match(notificationOutboxRoute, new RegExp(`mockBankPayloadResult\\.${metric}`, 'u'))
  }
  assert.match(notificationOutboxRoute, /mockBankPayloads: mockBankPayloadResult/u)

  assert.match(notificationOutboxWorker, /id: 'openexpert-notification-outbox'/u)
  assert.match(notificationOutboxWorker, /cron: '\* \* \* \* \*'/u)
  assert.match(notificationOutboxWorker, /method: 'POST'/u)
  assert.match(notificationOutboxWorker, /body: JSON\.stringify\(\{ limit: 50 \}\)/u)
})

test('ledger, persisted manifest, logs and CRM activity never persist a PESEL value', () => {
  const tableMatch = migration.match(
    /CREATE TABLE public\.crm_mock_bank_dispatches \(([\s\S]*?)\n\);/u,
  )
  assert.ok(tableMatch?.[1])
  const ledgerDefinition = tableMatch[1]
  assert.doesNotMatch(
    ledgerDefinition,
    /^\s*(?:pesel|recipient_email|subject|body|html|text|attachment|archive_file_name|pdf_file_name)\b/mu,
  )
  assert.match(
    migration,
    /the PESEL password is never persisted/u,
  )

  assert.match(
    caseRoute,
    /\.select\('application_id, kind, status, attempts, last_attempt_at, lease_expires_at, sent_at'\)/u,
  )

  const manifestStart = mockPayload.indexOf('export interface OpenExpertMockBankPersistedPayloadManifest')
  const manifestEnd = mockPayload.indexOf('export interface OpenExpertMockBankStoredObject', manifestStart)
  assert.ok(manifestStart >= 0)
  assert.ok(manifestEnd > manifestStart)
  assert.doesNotMatch(mockPayload.slice(manifestStart, manifestEnd), /\bpesel\b/iu)

  const buildManifestStart = mockDelivery.indexOf('function buildManifest(')
  const buildManifestEnd = mockDelivery.indexOf('function assertManifestDeliveryIdentity(', buildManifestStart)
  assert.ok(buildManifestStart >= 0)
  assert.ok(buildManifestEnd > buildManifestStart)
  assert.doesNotMatch(mockDelivery.slice(buildManifestStart, buildManifestEnd), /context\.pesel/u)
  assert.match(mockDelivery, /buildArchive\(manifest, input\.context\.pesel\)/u)

  const activityStart = migration.indexOf('CREATE FUNCTION private.record_crm_mock_bank_dispatch_activity()')
  const activityEnd = migration.indexOf('\n$$;', activityStart)
  assert.ok(activityStart >= 0)
  assert.ok(activityEnd > activityStart)
  const activity = migration.slice(activityStart, activityEnd)
  assert.doesNotMatch(activity, /NEW\.(?:manifest|archive|payload_sha256|recipient_connection_id)/u)
  assert.doesNotMatch(activity, /\bpesel\s*:/iu)
  assert.match(activity, /'applicationNumber', application_reference/u)
  assert.match(activity, /'generation', NEW\.generation/u)
  assert.match(migration, /crm_activities_mock_bank_dispatch_generation_key/u)
  assert.match(migration, /CREATE TRIGGER crm_mock_bank_dispatches_record_sent_activity/u)
  assert.match(
    migration,
    /CREATE POLICY "organization members can create crm activities"[\s\S]*?mock_bank_dispatch_id IS NULL[\s\S]*?mock_bank_esis_email_accepted[\s\S]*?mock_bank_credit_decision_email_accepted/u,
  )
  for (const operation of ['update', 'delete']) {
    assert.match(
      migration,
      new RegExp(`CREATE POLICY "organization members can ${operation} non audit activities"[\\s\\S]*?mock_bank_dispatch_id IS NULL`, 'u'),
    )
  }

  const errorLogs = [mockActions, mockDelivery]
    .flatMap(file => file.match(/console\.error\([\s\S]*?\n\s*\}\)/gu) ?? [])
  assert.ok(errorLogs.length >= 2)
  for (const log of errorLogs) {
    assert.doesNotMatch(log, /input\.context\.pesel|input\.recipient\.email|recipientEmail/u)
    assert.doesNotMatch(log, /\bpesel\s*:/iu)
  }
})
