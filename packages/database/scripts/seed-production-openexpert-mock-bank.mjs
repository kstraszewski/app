#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { calculateMortgageCatalogVersion } from '../../mortgage/src/index.ts'

const CONFIRMATION = 'SEED_OPENEXPERT_PRODUCTION_MOCK_BANK'
const VERCEL_PROJECT = 'openexpert-crm'
const SEED_LOCK = 'openexpert.seed.production-openexpert-mock-bank.v1'
const FIXTURE_KEY = 'openexpert-production-mock-bank-v1'

export const openExpertMockBankProductionFixture = Object.freeze({
  organizationSlug: 'openexpert-local',
  ownerEmail: 'koonradstraszewski@gmail.com',
  bankSlug: 'openexpert-bank',
  productSlug: 'hipoteka-demo-stala-5-lat',
  caseTitle: 'OpenExpert Bank — Konrad i Michał',
  clients: [
    {
      key: 'konrad-straszewski',
      firstName: 'Konrad',
      lastName: 'Straszewski',
      displayName: 'Konrad Straszewski',
      email: 'koonradstraszewski@gmail.com',
      pesel: '44051401458',
      dateOfBirth: '1944-05-14',
      isPrimary: true,
    },
    {
      key: 'michal-drozdzynski',
      firstName: 'Michał',
      lastName: 'Drożdżyński',
      displayName: 'Michał Drożdżyński',
      email: 'michal@drozdzynski.pkl',
      pesel: '02270803631',
      dateOfBirth: '2002-07-08',
      isPrimary: false,
    },
  ],
  property: {
    address: 'ul. Demonstracyjna 19/8',
    city: 'Szczecin',
    postalCode: '70-001',
    propertyType: 'apartment',
    marketType: 'secondary',
    listingTitle: 'Mieszkanie demonstracyjne OpenExpert Bank',
    priceAmount: 500000,
    appraisalValueAmount: 500000,
    areaM2: 58.4,
    rooms: 3,
  },
  financing: {
    loanAmount: 400000,
    years: 25,
    installmentType: 'equal',
    referenceDelta: 0,
    monthlyOverpayment: 0,
    overpaymentStrategy: 'shorten_term',
    mortgageRegistrationMonth: 3,
    financeCommission: true,
  },
})

export function stableOpenExpertMockBankFixtureUuid(value) {
  const bytes = createHash('sha256')
    .update(`openexpert:production-mock-bank:v1:${value}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

export const openExpertMockBankProductionFixtureIds = Object.freeze({
  caseId: stableOpenExpertMockBankFixtureUuid('case'),
  caseItemId: stableOpenExpertMockBankFixtureUuid('case-item:mortgage'),
  propertyId: stableOpenExpertMockBankFixtureUuid('property'),
  offerId: stableOpenExpertMockBankFixtureUuid('offer'),
  clients: Object.fromEntries(openExpertMockBankProductionFixture.clients.map(client => [
    client.key,
    {
      clientId: stableOpenExpertMockBankFixtureUuid(`client:${client.key}`),
      personId: stableOpenExpertMockBankFixtureUuid(`person:${client.key}`),
      caseClientId: stableOpenExpertMockBankFixtureUuid(`case-client:${client.key}`),
    },
  ])),
})

function usage() {
  return `Usage:
  node packages/database/scripts/seed-production-openexpert-mock-bank.mjs
  node packages/database/scripts/seed-production-openexpert-mock-bank.mjs --apply --confirm ${CONFIRMATION}

Without --apply the command validates and summarizes the synthetic fixture.
Apply mode only works in a production-scoped Vercel build for ${VERCEL_PROJECT}.`
}

function parseArguments(argv) {
  const parsed = { apply: false, confirm: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--apply') parsed.apply = true
    else if (argument === '--help' || argument === '-h') parsed.help = true
    else if (argument === '--confirm') {
      parsed.confirm = argv[index + 1]
      index += 1
    }
    else if (argument.startsWith('--confirm=')) parsed.confirm = argument.slice(10)
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!parsed.apply && parsed.confirm) throw new Error('--confirm requires --apply')
  if (parsed.apply && parsed.confirm !== CONFIRMATION) {
    throw new Error(`Applying requires --confirm ${CONFIRMATION}`)
  }
  return parsed
}

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function decodeJwtPayload(value) {
  const parts = value.split('.')
  if (parts.length !== 3) throw new Error('VERCEL_OIDC_TOKEN is not a JWT')
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  }
  catch {
    throw new Error('VERCEL_OIDC_TOKEN has an invalid JWT payload')
  }
}

function productionConfiguration() {
  if (process.env.VERCEL !== '1' || process.env.VERCEL_ENV !== 'production') {
    throw new Error('Apply mode requires VERCEL=1 and VERCEL_ENV=production')
  }
  const databaseUrl = String(process.env.DATABASE_URL_UNPOOLED ?? '').trim()
    || requiredEnvironment('DATABASE_URL')
  const host = new URL(databaseUrl).hostname.toLowerCase()
  if (['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('Apply mode refuses a local DATABASE_URL')
  }

  const oidc = decodeJwtPayload(requiredEnvironment('VERCEL_OIDC_TOKEN'))
  const nowSeconds = Math.floor(Date.now() / 1_000)
  if (oidc.environment !== 'production' || oidc.project !== VERCEL_PROJECT) {
    throw new Error(`VERCEL_OIDC_TOKEN must target ${VERCEL_PROJECT} production`)
  }
  if (typeof oidc.sub !== 'string' || !oidc.sub.endsWith(':environment:production')) {
    throw new Error('VERCEL_OIDC_TOKEN subject is not production-scoped')
  }
  if (typeof oidc.iss !== 'string' || !oidc.iss.startsWith('https://oidc.vercel.com')) {
    throw new Error('VERCEL_OIDC_TOKEN has an unexpected issuer')
  }
  if (typeof oidc.exp !== 'number' || oidc.exp <= nowSeconds + 300) {
    throw new Error('VERCEL_OIDC_TOKEN expires too soon')
  }
  return { databaseUrl }
}

function validatePesel(value) {
  if (!/^\d{11}$/u.test(value)) return false
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0)
  return (10 - sum % 10) % 10 === Number(value[10])
}

function dateOfBirthFromPesel(value) {
  const encodedMonth = Number(value.slice(2, 4))
  const day = Number(value.slice(4, 6))
  const century = encodedMonth >= 80 ? 1800 : encodedMonth >= 60 ? 2200 : encodedMonth >= 40 ? 2100 : encodedMonth >= 20 ? 2000 : 1900
  const month = encodedMonth % 20
  const year = century + Number(value.slice(0, 2))
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function validateOpenExpertMockBankProductionFixture() {
  const fixture = openExpertMockBankProductionFixture
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(fixture.organizationSlug)) {
    throw new Error('The production mock-bank organization slug is invalid')
  }
  if (fixture.clients.length !== 2 || fixture.clients.filter(client => client.isPrimary).length !== 1) {
    throw new Error('The production mock-bank fixture requires exactly two clients and one primary')
  }
  for (const client of fixture.clients) {
    if (!client.email.includes('@')
      || !validatePesel(client.pesel)
      || dateOfBirthFromPesel(client.pesel) !== client.dateOfBirth
      || Number(client.pesel[9]) % 2 !== 1) {
      throw new Error(`Invalid synthetic client fixture: ${client.key}`)
    }
  }
  if (fixture.property.priceAmount <= 0
    || fixture.financing.loanAmount <= 0
    || fixture.financing.loanAmount >= fixture.property.priceAmount) {
    throw new Error('The production mock-bank financing fixture is invalid')
  }
  return {
    organizationSlug: fixture.organizationSlug,
    ownerEmail: fixture.ownerEmail,
    clientEmails: fixture.clients.map(client => client.email),
    caseId: openExpertMockBankProductionFixtureIds.caseId,
    bankSlug: fixture.bankSlug,
    productSlug: fixture.productSlug,
  }
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function roundedNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`Mortgage calculation is missing ${label}`)
  return Math.round((number + Number.EPSILON) * 100) / 100
}

function calculationSnapshot(calculation) {
  return {
    ...objectValue(calculation.raw),
    status: calculation.status,
    issues: calculation.issues,
  }
}

function defaultMortgageSelections(version) {
  const definition = objectValue(version.offer_definition)
  if (definition.schemaVersion !== 'openexpert.mortgage-offer/2.0') {
    return { selections: {} }
  }
  const presets = Array.isArray(definition.presets) ? definition.presets : []
  const features = Array.isArray(definition.features) ? definition.features : []
  const preset = presets.find(item => item?.isDefault === true)
  const selections = { ...objectValue(preset?.selections) }
  for (const feature of features) {
    if (typeof feature?.id !== 'string' || feature.id in selections) continue
    if (typeof feature.defaultOptionId === 'string') selections[feature.id] = feature.defaultOptionId
  }
  return {
    ...(typeof preset?.id === 'string' ? { presetId: preset.id } : {}),
    selections,
  }
}

async function requireFixtureOwner(client, table, id, organizationId) {
  const allowedTables = new Set([
    'crm_clients',
    'crm_client_people',
    'crm_cases',
    'crm_case_items',
    'crm_properties',
  ])
  if (!allowedTables.has(table)) throw new Error(`Unsupported fixture table: ${table}`)
  const result = await client.query(
    `SELECT organization_id, metadata FROM public.${table} WHERE id = $1`,
    [id],
  )
  if (result.rowCount !== 1
    || String(result.rows[0].organization_id) !== organizationId
    || result.rows[0].metadata?.fixtureKey !== FIXTURE_KEY
    || result.rows[0].metadata?.syntheticDemo !== true) {
    throw new Error(`Stable fixture id is owned by another row: ${table}/${id}`)
  }
  return result.rows[0]
}

async function loadMockCatalog(client, organizationId) {
  const result = await client.query(`
    SELECT
      to_jsonb(bank) AS bank,
      to_jsonb(product) AS product,
      to_jsonb(version) AS version,
      to_jsonb(variant) AS variant,
      to_jsonb(source) AS source,
      to_jsonb(product_override) AS product_override,
      to_jsonb(bank_override) AS bank_override
    FROM public.mortgage_banks AS bank
    JOIN public.mortgage_products AS product
      ON product.bank_id = bank.id
    JOIN public.mortgage_product_versions AS version
      ON version.id = product.current_published_version_id
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM public.mortgage_product_version_variants AS candidate
      WHERE candidate.product_version_id = version.id
      ORDER BY candidate.is_default DESC, candidate.sort_order, candidate.id
      LIMIT 1
    ) AS variant ON true
    LEFT JOIN public.mortgage_source_documents AS source
      ON source.id = version.source_document_id
    LEFT JOIN public.mortgage_product_overrides AS product_override
      ON product_override.organization_id = $1
     AND product_override.product_id = product.id
    LEFT JOIN public.mortgage_bank_overrides AS bank_override
      ON bank_override.organization_id = $1
     AND bank_override.bank_id = bank.id
    WHERE bank.slug = $2
      AND bank.is_mock
      AND product.slug = $3
      AND product.is_active
      AND product.archived_at IS NULL
      AND version.lifecycle_status = 'published'
  `, [organizationId, openExpertMockBankProductionFixture.bankSlug, openExpertMockBankProductionFixture.productSlug])
  if (result.rowCount !== 1) {
    throw new Error('Expected exactly one current published OpenExpert Bank product')
  }
  const row = result.rows[0]
  const bank = objectValue(row.bank)
  const product = objectValue(row.product)
  const version = objectValue(row.version)
  const variant = Object.keys(objectValue(row.variant)).length ? objectValue(row.variant) : null
  const source = Object.keys(objectValue(row.source)).length ? objectValue(row.source) : null
  const productOverride = Object.keys(objectValue(row.product_override)).length
    ? objectValue(row.product_override)
    : null
  const bankOverride = Object.keys(objectValue(row.bank_override)).length
    ? objectValue(row.bank_override)
    : null
  const baseVersion = {
    ...version,
    source,
    variant,
    offer_definition: variant?.pricing_config ?? null,
    calculation_readiness: variant?.calculation_readiness ?? 'partial',
  }
  const resolvedVersion = Number(version.calculator_schema_version ?? 1) >= 2
    ? baseVersion
    : { ...baseVersion, ...objectValue(productOverride?.parameters) }
  return {
    id: product.id,
    slug: product.slug,
    name: productOverride?.custom_name ?? product.name,
    baseName: product.name,
    category: product.category,
    bank: {
      ...bank,
      name: bankOverride?.custom_name ?? bank.name,
      website_url: bankOverride?.custom_website_url ?? bank.website_url,
      baseName: bank.name,
      baseWebsiteUrl: bank.website_url,
      isEnabled: bankOverride?.is_enabled ?? true,
      logoUrl: bank.logo_url,
      logoBackground: bank.logo_background_color,
      override: bankOverride,
    },
    isEnabled: productOverride?.is_enabled ?? true,
    version: resolvedVersion,
    baseVersion,
    override: productOverride,
  }
}

function calculateFixtureOffer(catalog) {
  const fixture = openExpertMockBankProductionFixture
  const scenario = {
    propertyValue: fixture.property.priceAmount,
    appraisalValue: fixture.property.appraisalValueAmount,
    loanAmount: fixture.financing.loanAmount,
    years: fixture.financing.years,
    installmentType: fixture.financing.installmentType,
    referenceDelta: fixture.financing.referenceDelta,
    monthlyOverpayment: fixture.financing.monthlyOverpayment,
    overpaymentStrategy: fixture.financing.overpaymentStrategy,
    mortgageRegistrationMonth: fixture.financing.mortgageRegistrationMonth,
    financeCommission: fixture.financing.financeCommission,
    ...defaultMortgageSelections(catalog.version),
    selectionEvents: [],
  }
  const calculation = calculateMortgageCatalogVersion(catalog.version, scenario)
  const stress = calculateMortgageCatalogVersion(catalog.version, scenario, 2)
  if (calculation.status !== 'complete' || !['complete', 'partial'].includes(stress.status)) {
    throw new Error(`OpenExpert Bank fixture is not calculable (${calculation.status}/${stress.status})`)
  }
  return { scenario, calculation, stress }
}

function applicationSnapshots({ offerId, property, scenario, calculation }) {
  const purchasePrice = roundedNumber(property.price_amount, 'purchase price')
  const appraisalValue = property.appraisal_value_amount == null
    ? null
    : roundedNumber(property.appraisal_value_amount, 'appraisal value')
  const netLoanAmount = roundedNumber(calculation.netLoanAmount, 'net loan amount')
  const grossLoanAmount = roundedNumber(calculation.grossLoanAmount, 'gross loan amount')
  const financedCosts = roundedNumber(calculation.financedCosts, 'financed costs')
  const contributionAmount = roundedNumber(purchasePrice - netLoanAmount, 'contribution amount')
  const ltvDebtAmount = netLoanAmount
  const collateralValueAmount = purchasePrice
  const ltvPct = roundedNumber(ltvDebtAmount / collateralValueAmount * 100, 'LTV')
  const termMonths = roundedNumber(scenario.years, 'term') * 12
  const selections = objectValue(scenario.selections)
  const selectionEvents = Array.isArray(scenario.selectionEvents) ? scenario.selectionEvents : []
  return {
    scenarioSnapshot: {
      schemaVersion: 'openexpert.mortgage-application-scenario/1.0',
      sourceOfferId: offerId,
      comparisonBaselineOfferId: offerId,
      currency: 'PLN',
      property: {
        propertyId: property.id,
        purchasePrice,
        appraisalValue,
        currency: 'PLN',
        propertyUpdatedAt: property.updated_at,
      },
      financing: {
        amountMode: 'target_net_proceeds',
        targetNetProceeds: netLoanAmount,
        grossLoanAmount,
        financedCosts,
        contributionAmount,
        termMonths,
        installmentType: scenario.installmentType,
      },
      pricing: {
        referenceDelta: Number(scenario.referenceDelta ?? 0),
        monthlyOverpayment: Number(scenario.monthlyOverpayment ?? 0),
        overpaymentStrategy: scenario.overpaymentStrategy ?? 'shorten_term',
        mortgageRegistrationMonth: scenario.mortgageRegistrationMonth ?? null,
        financeCommission: scenario.financeCommission !== false,
        presetId: scenario.presetId ?? null,
        selections,
        selectionEvents,
      },
      propertyValue: purchasePrice,
      appraisalValue,
      loanAmount: netLoanAmount,
      grossLoanAmount,
      years: scenario.years,
      installmentType: scenario.installmentType,
      referenceDelta: Number(scenario.referenceDelta ?? 0),
      monthlyOverpayment: Number(scenario.monthlyOverpayment ?? 0),
      overpaymentStrategy: scenario.overpaymentStrategy ?? 'shorten_term',
      mortgageRegistrationMonth: scenario.mortgageRegistrationMonth ?? null,
      financeCommission: scenario.financeCommission !== false,
      presetId: scenario.presetId ?? null,
      selections,
      selectionEvents,
    },
    calculationSnapshot: {
      schemaVersion: 'openexpert.mortgage-application-calculation/1.0',
      engineVersion: calculation.engineVersion,
      status: 'complete',
      currency: 'PLN',
      summary: {
        netLoanAmount,
        grossLoanAmount,
        financedCosts,
        ltvDebtBasis: 'net_loan',
        collateralValueBasis: 'purchase_price',
        ltvDebtAmount,
        collateralValueAmount,
        ltvPct,
        firstInstallment: roundedNumber(calculation.firstInstallment, 'first installment'),
        firstMonthlyOutflow: roundedNumber(calculation.firstTotalOutflow, 'first monthly outflow'),
        costFirstFiveYears: roundedNumber(calculation.costFirstFiveYears, 'five-year cost'),
        totalCost: roundedNumber(calculation.totalCost, 'total cost'),
      },
      raw: calculation.raw,
    },
  }
}

async function seedClient(client, organizationId, ownerUserId, fixtureClient) {
  const ids = openExpertMockBankProductionFixtureIds.clients[fixtureClient.key]
  const metadata = {
    fixtureKey: FIXTURE_KEY,
    syntheticDemo: true,
    clientType: 'person',
  }
  const peselCollision = await client.query(`
    SELECT id
    FROM public.crm_client_people
    WHERE organization_id = $1
      AND pesel = $2
      AND id <> $3
    LIMIT 1
  `, [organizationId, fixtureClient.pesel, ids.personId])
  if (peselCollision.rowCount) {
    throw new Error(`Synthetic PESEL collides with another client fixture: ${fixtureClient.key}`)
  }
  const inserted = await client.query(`
    INSERT INTO public.crm_clients (
      id, organization_id, owner_user_id, display_name, status_code,
      lead_source, primary_email, tags, notes, metadata
    ) VALUES (
      $1, $2, $3, $4, 'active', 'production_demo_seed', NULL,
      ARRAY['demo', 'synthetic', 'mock-bank']::text[],
      'Syntetyczny klient demonstracyjny OpenExpert Banku. Dane nie opisują realnej osoby.',
      $5::jsonb
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `, [ids.clientId, organizationId, ownerUserId, fixtureClient.displayName, metadata])
  await requireFixtureOwner(client, 'crm_clients', ids.clientId, organizationId)

  await client.query(`
    INSERT INTO public.crm_client_people (
      id, organization_id, client_id, role, first_name, last_name,
      display_name, email, pesel, date_of_birth, metadata
    ) VALUES ($1, $2, $3, 'primary', $4, $5, $6, $7, $8, $9, $10::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [
    ids.personId,
    organizationId,
    ids.clientId,
    fixtureClient.firstName,
    fixtureClient.lastName,
    fixtureClient.displayName,
    fixtureClient.email,
    fixtureClient.pesel,
    fixtureClient.dateOfBirth,
    metadata,
  ])
  await requireFixtureOwner(client, 'crm_client_people', ids.personId, organizationId)
  const person = await client.query(`
    SELECT client_id, email, pesel, display_name
    FROM public.crm_client_people
    WHERE id = $1
  `, [ids.personId])
  const row = person.rows[0]
  if (String(row?.client_id) !== ids.clientId
    || String(row?.email).toLowerCase() !== fixtureClient.email.toLowerCase()
    || row?.pesel !== fixtureClient.pesel
    || row?.display_name !== fixtureClient.displayName) {
    throw new Error(`Synthetic client person drifted: ${fixtureClient.key}`)
  }
  return { ...ids, inserted: inserted.rowCount === 1 }
}

async function insertOrVerifyFixtureCore(client, organizationId, ownerUserId, clientRows) {
  const fixture = openExpertMockBankProductionFixture
  const ids = openExpertMockBankProductionFixtureIds
  const primary = fixture.clients.find(item => item.isPrimary)
  const primaryIds = clientRows.get(primary.key)
  const metadata = { fixtureKey: FIXTURE_KEY, syntheticDemo: true }

  await client.query(`
    INSERT INTO public.crm_cases (
      id, organization_id, client_id, owner_user_id, title, description,
      status_code, priority, progress_percent, metadata
    ) VALUES (
      $1, $2, $3, $4, $5,
      'Syntetyczna sprawa do prezentacji pełnego przepływu OpenExpert Banku: ESIS, wniosek i decyzja kredytowa.',
      'analiza', 'normal', 30, $6::jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, [ids.caseId, organizationId, primaryIds.clientId, ownerUserId, fixture.caseTitle, metadata])
  await requireFixtureOwner(client, 'crm_cases', ids.caseId, organizationId)

  for (const fixtureClient of fixture.clients) {
    const row = clientRows.get(fixtureClient.key)
    await client.query(`
      INSERT INTO public.crm_case_clients (
        id, organization_id, case_id, client_id, is_primary
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (case_id, client_id) DO NOTHING
    `, [row.caseClientId, organizationId, ids.caseId, row.clientId, fixtureClient.isPrimary])
  }
  const linked = await client.query(`
    SELECT client_id, is_primary
    FROM public.crm_case_clients
    WHERE organization_id = $1 AND case_id = $2
  `, [organizationId, ids.caseId])
  const expectedClientIds = new Set([...clientRows.values()].map(row => row.clientId))
  if (linked.rowCount !== fixture.clients.length
    || linked.rows.filter(row => row.is_primary).length !== 1
    || linked.rows.some(row => !expectedClientIds.has(String(row.client_id)))) {
    throw new Error('Synthetic case client links are inconsistent')
  }

  const productType = await client.query(`
    SELECT id
    FROM public.crm_product_types
    WHERE organization_id IS NULL
      AND code = 'credit_mortgage'
      AND is_system
      AND is_active
  `)
  if (productType.rowCount !== 1) throw new Error('System mortgage CRM product type is missing')
  await client.query(`
    INSERT INTO public.crm_case_items (
      id, organization_id, case_id, product_type_id, owner_user_id,
      title, status_code, amount_value, currency, metadata
    ) VALUES ($1, $2, $3, $4, $5, 'Kredyt hipoteczny — OpenExpert Bank',
      'wniosek', $6, 'PLN', $7::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [ids.caseItemId, organizationId, ids.caseId, productType.rows[0].id, ownerUserId, fixture.financing.loanAmount, metadata])
  await requireFixtureOwner(client, 'crm_case_items', ids.caseItemId, organizationId)

  await client.query(`
    INSERT INTO public.crm_properties (
      id, organization_id, case_id, case_item_id, address, city, postal_code,
      property_type, market_type, price_amount, appraisal_value_amount,
      currency, area_m2, rooms, listing_title, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PLN', $12, $13, $14, $15::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [
    ids.propertyId,
    organizationId,
    ids.caseId,
    ids.caseItemId,
    fixture.property.address,
    fixture.property.city,
    fixture.property.postalCode,
    fixture.property.propertyType,
    fixture.property.marketType,
    fixture.property.priceAmount,
    fixture.property.appraisalValueAmount,
    fixture.property.areaM2,
    fixture.property.rooms,
    fixture.property.listingTitle,
    metadata,
  ])
  await requireFixtureOwner(client, 'crm_properties', ids.propertyId, organizationId)
  const property = await client.query(`
    SELECT id, organization_id, case_id, case_item_id, price_amount,
      appraisal_value_amount, currency, updated_at::text AS updated_at
    FROM public.crm_properties
    WHERE id = $1
  `, [ids.propertyId])
  const propertyRow = property.rows[0]
  if (String(propertyRow?.organization_id) !== organizationId
    || String(propertyRow?.case_id) !== ids.caseId
    || String(propertyRow?.case_item_id) !== ids.caseItemId
    || Number(propertyRow?.price_amount) !== fixture.property.priceAmount
    || Number(propertyRow?.appraisal_value_amount) !== fixture.property.appraisalValueAmount
    || String(propertyRow?.currency).trim() !== 'PLN') {
    throw new Error('Synthetic mortgage property drifted')
  }
  await client.query(`
    INSERT INTO public.crm_case_property_selections (
      organization_id, case_id, property_id, selected_by_user_id
    ) VALUES ($1, $2, $3, $4)
    ON CONFLICT (organization_id, case_id) DO NOTHING
  `, [organizationId, ids.caseId, ids.propertyId, ownerUserId])
  const selection = await client.query(`
    SELECT property_id
    FROM public.crm_case_property_selections
    WHERE organization_id = $1 AND case_id = $2
  `, [organizationId, ids.caseId])
  if (selection.rowCount !== 1 || String(selection.rows[0].property_id) !== ids.propertyId) {
    throw new Error('Synthetic case has a different selected property')
  }
  return propertyRow
}

async function insertOrVerifyOffer(client, organizationId, ownerUserId, catalog, calculated) {
  const ids = openExpertMockBankProductionFixtureIds
  await client.query(`
    INSERT INTO public.crm_case_offer_snapshots (
      id, organization_id, case_id, bank_id, mortgage_product_id,
      mortgage_product_version_id, saved_by_user_id, offer_type, bank_name,
      product_name, version_key, calculator_version, currency, loan_amount,
      first_installment, first_monthly_outflow, cost_first_five_years,
      total_cost, representative_apr_pct, scenario_snapshot, catalog_snapshot,
      calculation_snapshot, stress_snapshot
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, 'mortgage', $8, $9, $10, $11, 'PLN',
      $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb, $20::jsonb, $21::jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `, [
    ids.offerId,
    organizationId,
    ids.caseId,
    catalog.bank.id,
    catalog.id,
    catalog.baseVersion.id,
    ownerUserId,
    catalog.bank.name,
    catalog.name,
    catalog.version.version_key,
    calculated.calculation.engineVersion,
    openExpertMockBankProductionFixture.financing.loanAmount,
    calculated.calculation.firstInstallment,
    calculated.calculation.firstTotalOutflow,
    calculated.calculation.costFirstFiveYears,
    calculated.calculation.totalCost,
    catalog.version.representative_apr_pct,
    calculated.scenario,
    catalog,
    calculationSnapshot(calculated.calculation),
    calculationSnapshot(calculated.stress),
  ])
  const offer = await client.query(`
    SELECT id, organization_id, case_id, bank_id, mortgage_product_id,
      mortgage_product_version_id, scenario_snapshot, catalog_snapshot,
      calculation_snapshot, bank_name, product_name
    FROM public.crm_case_offer_snapshots
    WHERE id = $1
  `, [ids.offerId])
  const row = offer.rows[0]
  if (offer.rowCount !== 1
    || String(row.organization_id) !== organizationId
    || String(row.case_id) !== ids.caseId
    || String(row.bank_id) !== String(catalog.bank.id)
    || String(row.mortgage_product_id) !== String(catalog.id)
    || String(row.mortgage_product_version_id) !== String(catalog.baseVersion.id)) {
    throw new Error('Synthetic OpenExpert Bank offer drifted')
  }
  return row
}

async function createOrVerifyApplication(client, organizationId, ownerUserId, property, calculated) {
  const ids = openExpertMockBankProductionFixtureIds
  let application = await client.query(`
    SELECT application.*, submission.external_reference, process.stage, process.revision
    FROM public.crm_case_bank_applications AS application
    JOIN public.crm_item_submissions AS submission
      ON submission.organization_id = application.organization_id
     AND submission.id = application.submission_id
    LEFT JOIN public.crm_mortgage_application_processes AS process
      ON process.organization_id = application.organization_id
     AND process.case_id = application.case_id
     AND process.application_id = application.submission_id
    WHERE application.organization_id = $1
      AND application.case_id = $2
      AND application.offer_id = $3
  `, [organizationId, ids.caseId, ids.offerId])
  if (!application.rowCount) {
    const conflictingApplication = await client.query(`
      SELECT existing.submission_id, existing.offer_id
      FROM public.crm_case_bank_applications AS existing
      JOIN public.crm_case_offer_snapshots AS target_offer
        ON target_offer.organization_id = existing.organization_id
       AND target_offer.case_id = existing.case_id
       AND target_offer.bank_id = existing.bank_id
      WHERE existing.organization_id = $1
        AND existing.case_id = $2
        AND target_offer.id = $3
      LIMIT 1
    `, [organizationId, ids.caseId, ids.offerId])
    if (conflictingApplication.rowCount) {
      throw new Error(`Synthetic case already has another OpenExpert Bank application: ${conflictingApplication.rows[0].submission_id}`)
    }
    const snapshots = applicationSnapshots({
      offerId: ids.offerId,
      property,
      scenario: calculated.scenario,
      calculation: calculated.calculation,
    })
    await client.query(`
      SELECT snapshot.*
      FROM public.create_crm_case_bank_application_snapshot(
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb
      ) AS snapshot
    `, [
      organizationId,
      ids.caseId,
      ids.offerId,
      ids.propertyId,
      ownerUserId,
      property.updated_at,
      snapshots.scenarioSnapshot,
      snapshots.calculationSnapshot,
    ])
    application = await client.query(`
      SELECT application.*, submission.external_reference, process.stage, process.revision
      FROM public.crm_case_bank_applications AS application
      JOIN public.crm_item_submissions AS submission
        ON submission.organization_id = application.organization_id
       AND submission.id = application.submission_id
      JOIN public.crm_mortgage_application_processes AS process
        ON process.organization_id = application.organization_id
       AND process.case_id = application.case_id
       AND process.application_id = application.submission_id
      WHERE application.organization_id = $1
        AND application.case_id = $2
        AND application.offer_id = $3
    `, [organizationId, ids.caseId, ids.offerId])
  }
  if (application.rowCount !== 1) throw new Error('Expected one synthetic OpenExpert Bank application')
  const row = application.rows[0]
  if (String(row.property_id) !== ids.propertyId
    || row.snapshot_status !== 'complete'
    || !/^OEB-\d{8}-\d{6}$/u.test(String(row.external_reference ?? ''))
    || !row.stage) {
    throw new Error('Synthetic OpenExpert Bank application is incomplete')
  }
  return row
}

async function verifyMailRecipient(client, organizationId, ownerUserId) {
  const result = await client.query(`
    SELECT id, provider, account_email, status
    FROM public.mail_connections
    WHERE organization_id = $1
      AND owner_user_id = $2
      AND lower(account_email) = lower($3)
      AND status = 'active'
  `, [organizationId, ownerUserId, openExpertMockBankProductionFixture.ownerEmail])
  if (result.rowCount !== 1) {
    throw new Error('The production mock-bank owner requires exactly one active matching mailbox')
  }
  return result.rows[0]
}

export async function applyOpenExpertMockBankProductionSeed(databaseUrl, options = {}) {
  const fixture = openExpertMockBankProductionFixture
  const rollback = options.rollback === true
  const organizationSlug = options.organizationSlug ?? fixture.organizationSlug
  const ownerEmail = options.ownerEmail ?? fixture.ownerEmail
  if (options.skipMailboxVerification === true && !rollback) {
    throw new Error('Mailbox verification may only be skipped by a rollback-only integration test')
  }
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL lock_timeout = '15s'")
    await client.query("SET LOCAL statement_timeout = '180s'")
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [SEED_LOCK])

    const roleAccess = await client.query(`
      SELECT
        pg_has_role(current_user, 'openexpert_owner', 'USAGE') AS can_set_owner,
        pg_has_role(current_user, 'openexpert_service', 'USAGE') AS can_set_service
    `)
    if (roleAccess.rows[0]?.can_set_owner !== true || roleAccess.rows[0]?.can_set_service !== true) {
      throw new Error('Production seed connection cannot assume the owner and service roles')
    }
    await client.query('SET LOCAL ROLE openexpert_service')

    const organization = await client.query(
      'SELECT id, name FROM public.organizations WHERE slug = $1',
      [organizationSlug],
    )
    if (organization.rowCount !== 1) throw new Error(`Expected exactly one ${organizationSlug} organization`)
    const organizationId = String(organization.rows[0].id)
    const owner = await client.query(`
      SELECT users.id, users.full_name, memberships.role
      FROM public.users AS users
      JOIN public.organization_memberships AS memberships
        ON memberships.user_id = users.id
      WHERE memberships.organization_id = $1
        AND lower(users.email) = lower($2)
    `, [organizationId, ownerEmail])
    if (owner.rowCount !== 1) throw new Error(`Expected exactly one member ${ownerEmail}`)
    const ownerUserId = String(owner.rows[0].id)
    await client.query('SELECT app.set_request_context($1)', [ownerUserId])
    const requestActor = await client.query('SELECT app.current_user_id() AS id, current_user AS role')
    if (String(requestActor.rows[0]?.id) !== ownerUserId
      || requestActor.rows[0]?.role !== 'openexpert_service') {
      throw new Error('Production seed could not establish the trusted actor context')
    }

    const mailbox = options.skipMailboxVerification === true
      ? { id: 'rollback-only-mailbox-check-skipped' }
      : await verifyMailRecipient(client, organizationId, ownerUserId)
    const seededClients = new Map()
    const newlyInsertedClientIds = []
    for (const fixtureClient of fixture.clients) {
      const seeded = await seedClient(client, organizationId, ownerUserId, fixtureClient)
      seededClients.set(fixtureClient.key, seeded)
      if (seeded.inserted) newlyInsertedClientIds.push(seeded.clientId)
    }
    const property = await insertOrVerifyFixtureCore(client, organizationId, ownerUserId, seededClients)
    const catalog = await loadMockCatalog(client, organizationId)
    const calculated = calculateFixtureOffer(catalog)
    const offer = await insertOrVerifyOffer(client, organizationId, ownerUserId, catalog, calculated)
    const application = await createOrVerifyApplication(
      client,
      organizationId,
      ownerUserId,
      property,
      calculated,
    )

    // Delivery outboxes are intentionally owner-only. The production seed
    // connection is granted both NOLOGIN roles by the guarded migrator.
    await client.query('SET LOCAL ROLE openexpert_owner')
    const ownerRole = await client.query('SELECT current_user AS role')
    if (ownerRole.rows[0]?.role !== 'openexpert_owner') {
      throw new Error('Production seed could not assume the migration owner role')
    }

    // A top-level client e-mail is intentionally left empty for these synthetic
    // fixtures. The canonical client-created OFI/RODO job remains auditable and
    // terminal as blocked_missing_email, while the exact demo addresses live on
    // the person records used by case/mail correlation.
    const legalDeliveries = await client.query(`
      SELECT delivery.client_id, delivery.status, delivery.recipient_email
      FROM public.crm_client_legal_document_deliveries AS delivery
      WHERE delivery.organization_id = $1
        AND delivery.client_id = ANY($2::uuid[])
    `, [organizationId, [...seededClients.values()].map(value => value.clientId)])
    if (legalDeliveries.rowCount !== fixture.clients.length
      || legalDeliveries.rows.some(row => row.status !== 'blocked_missing_email' || row.recipient_email !== null)) {
      throw new Error('Synthetic clients must not enqueue legal-document e-mail delivery')
    }
    if (newlyInsertedClientIds.length
      && legalDeliveries.rows.filter(row => newlyInsertedClientIds.includes(String(row.client_id))).length !== newlyInsertedClientIds.length) {
      throw new Error('A newly seeded synthetic client is missing its blocked legal-delivery audit row')
    }

    const verification = await client.query(`
      SELECT
        (SELECT count(*) FROM public.crm_client_people person
          WHERE person.organization_id = $1
            AND person.id = ANY($2::uuid[])
            AND person.email IS NOT NULL
            AND person.pesel ~ '^[0-9]{11}$') AS applicants,
        (SELECT count(*) FROM public.crm_case_offer_snapshots saved_offer
          WHERE saved_offer.organization_id = $1
            AND saved_offer.case_id = $3
            AND saved_offer.id = $4) AS offers,
        (SELECT count(*) FROM public.crm_case_bank_applications bank_application
          WHERE bank_application.organization_id = $1
            AND bank_application.case_id = $3
            AND bank_application.offer_id = $4
            AND bank_application.snapshot_status = 'complete') AS applications
    `, [
      organizationId,
      [...seededClients.values()].map(value => value.personId),
      openExpertMockBankProductionFixtureIds.caseId,
      openExpertMockBankProductionFixtureIds.offerId,
    ])
    const counts = verification.rows[0]
    if (Number(counts.applicants) !== fixture.clients.length
      || Number(counts.offers) !== 1
      || Number(counts.applications) !== 1) {
      throw new Error(`Production mock-bank fixture verification failed: ${JSON.stringify(counts)}`)
    }

    if (rollback) await client.query('ROLLBACK')
    else await client.query('COMMIT')
    return {
      rolledBack: rollback,
      organizationId,
      organizationName: organization.rows[0].name,
      ownerUserId,
      ownerEmail,
      mailboxConnectionId: String(mailbox.id),
      caseId: openExpertMockBankProductionFixtureIds.caseId,
      offerId: String(offer.id),
      applicationId: String(application.submission_id),
      applicationNumber: String(application.external_reference),
      applicationStage: String(application.stage),
      snapshotStatus: String(application.snapshot_status),
      clientEmails: fixture.clients.map(item => item.email),
      bankName: String(offer.bank_name),
      productName: String(offer.product_name),
    }
  }
  catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
  finally {
    await client.end()
  }
}

async function main() {
  const argumentsList = parseArguments(process.argv.slice(2))
  if (argumentsList.help) {
    console.log(usage())
    return
  }
  const summary = validateOpenExpertMockBankProductionFixture()
  if (!argumentsList.apply) {
    console.log('DRY RUN: validated the synthetic OpenExpert Bank production fixture.')
    console.log(JSON.stringify(summary, null, 2))
    console.log('No database operation was performed.')
    return
  }
  const { databaseUrl } = productionConfiguration()
  const result = await applyOpenExpertMockBankProductionSeed(databaseUrl)
  console.log('Production OpenExpert Bank seed completed.')
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
