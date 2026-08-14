import { randomUUID } from 'node:crypto'
import {
  assertOpenExpertPassword,
  createDefaultBcryptPasswordStrategy,
} from '@openexpert/auth'
import { Client } from 'pg'

const CONFIRMATION = 'PROVISION_OPENEXPERT_PRODUCTION_ACCOUNT'
const VERCEL_PROJECT = 'openexpert-crm'
const VERCEL_PROJECT_ID = 'prj_jryJsM4XXiNSowzbggBtT5iIKYFe'

function usage() {
  return `Usage:
  node packages/database/scripts/provision-production-account.mjs
  node packages/database/scripts/provision-production-account.mjs --apply --confirm ${CONFIRMATION}

Required environment variables:
  OPENEXPERT_PROVISION_EMAIL
  OPENEXPERT_PROVISION_FULL_NAME
  OPENEXPERT_PROVISION_PASSWORD
  OPENEXPERT_PROVISION_ORGANIZATION_SLUG

Apply mode accepts only a production-scoped Vercel OIDC token for ${VERCEL_PROJECT}.`
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
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
}

function productionDatabaseUrl() {
  if (
    process.env.VERCEL !== '1'
    || process.env.VERCEL_ENV !== 'production'
    || process.env.VERCEL_TARGET_ENV !== 'production'
  ) {
    throw new Error(
      'Apply mode requires VERCEL=1, VERCEL_ENV=production, and VERCEL_TARGET_ENV=production',
    )
  }
  const databaseUrl = String(process.env.DATABASE_URL_UNPOOLED ?? '').trim()
    || requiredEnvironment('DATABASE_URL')
  const host = new URL(databaseUrl).hostname.toLowerCase()
  if (['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('Apply mode refuses a local DATABASE_URL')
  }

  const oidc = decodeJwtPayload(requiredEnvironment('VERCEL_OIDC_TOKEN'))
  const nowSeconds = Math.floor(Date.now() / 1_000)
  if (oidc.project !== VERCEL_PROJECT || oidc.project_id !== VERCEL_PROJECT_ID) {
    throw new Error(`VERCEL_OIDC_TOKEN must target ${VERCEL_PROJECT}`)
  }
  if (
    typeof oidc.sub !== 'string'
    || !oidc.sub.includes(`:project:${VERCEL_PROJECT}:environment:`)
  ) {
    throw new Error('VERCEL_OIDC_TOKEN subject targets an unexpected project')
  }
  if (typeof oidc.iss !== 'string' || !oidc.iss.startsWith('https://oidc.vercel.com')) {
    throw new Error('VERCEL_OIDC_TOKEN has an unexpected issuer')
  }
  if (typeof oidc.exp !== 'number' || oidc.exp <= nowSeconds + 300) {
    throw new Error('VERCEL_OIDC_TOKEN expires too soon')
  }
  return databaseUrl
}

function accountConfiguration() {
  const email = requiredEnvironment('OPENEXPERT_PROVISION_EMAIL').toLowerCase()
  const fullName = requiredEnvironment('OPENEXPERT_PROVISION_FULL_NAME')
  const password = requiredEnvironment('OPENEXPERT_PROVISION_PASSWORD')
  const organizationSlug = requiredEnvironment(
    'OPENEXPERT_PROVISION_ORGANIZATION_SLUG',
  )
  if (!email.includes('@')) throw new Error('Provisioned email is invalid')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(organizationSlug)) {
    throw new Error('Provisioned organization slug is invalid')
  }
  assertOpenExpertPassword(password)
  return { email, fullName, password, organizationSlug }
}

async function provisionAccount() {
  const target = accountConfiguration()
  const passwordStrategy = createDefaultBcryptPasswordStrategy(10)
  const passwordHash = await passwordStrategy.hash(target.password)
  const client = new Client({ connectionString: productionDatabaseUrl() })
  await client.connect()

  try {
    await client.query('BEGIN')

    const organizationResult = await client.query(
      'SELECT id, name, slug FROM public.organizations WHERE slug = $1',
      [target.organizationSlug],
    )
    if (organizationResult.rowCount !== 1) {
      throw new Error(`Expected exactly one ${target.organizationSlug} organization`)
    }
    const organization = organizationResult.rows[0]

    const existingIdentityResult = await client.query(`
      SELECT
        auth_user.id AS user_id,
        credential.id AS credential_id
      FROM identity.users AS auth_user
      LEFT JOIN LATERAL (
        SELECT account.id
        FROM identity.accounts AS account
        WHERE account.user_id = auth_user.id
          AND account.provider_id = 'credential'
        ORDER BY account.created_at, account.id
        LIMIT 1
      ) AS credential ON true
      WHERE lower(auth_user.email) = lower($1)
      LIMIT 1
    `, [target.email])
    const existingIdentity = existingIdentityResult.rows[0]
    const userId = String(existingIdentity?.user_id ?? randomUUID())
    const credentialId = String(existingIdentity?.credential_id ?? randomUUID())

    await client.query(`
      INSERT INTO identity.users (id, name, email, email_verified, image)
      VALUES ($1::uuid, $2, $3, true, $4)
      ON CONFLICT (id) DO UPDATE
      SET
        name = excluded.name,
        email = excluded.email,
        email_verified = true,
        image = excluded.image,
        updated_at = now()
    `, [
      userId,
      target.fullName,
      target.email,
      '/avatars/experts/local-administrator.webp',
    ])
    await client.query(`
      INSERT INTO identity.accounts (
        id, user_id, account_id, provider_id, password
      )
      VALUES ($1::uuid, $2::uuid, $2, 'credential', $3)
      ON CONFLICT (id) DO UPDATE
      SET
        user_id = excluded.user_id,
        account_id = excluded.account_id,
        provider_id = excluded.provider_id,
        password = excluded.password,
        updated_at = now()
    `, [credentialId, userId, passwordHash])

    await client.query(`
      INSERT INTO public.users (
        id, organization_id, email, role, full_name, avatar_url
      )
      VALUES ($1::uuid, $2::uuid, $3, 'admin', $4, $5)
      ON CONFLICT (id) DO UPDATE
      SET
        organization_id = excluded.organization_id,
        email = excluded.email,
        role = 'admin',
        full_name = excluded.full_name,
        avatar_url = excluded.avatar_url
    `, [
      userId,
      organization.id,
      target.email,
      target.fullName,
      '/avatars/experts/local-administrator.webp',
    ])
    await client.query(`
      INSERT INTO public.organization_memberships (
        organization_id, user_id, role
      )
      VALUES ($1::uuid, $2::uuid, 'admin')
      ON CONFLICT (organization_id, user_id) DO UPDATE
      SET role = 'admin', updated_at = now()
    `, [organization.id, userId])
    await client.query(`
      INSERT INTO public.organization_user_access_states (
        organization_id, user_id
      )
      VALUES ($1::uuid, $2::uuid)
      ON CONFLICT (organization_id, user_id) DO NOTHING
    `, [organization.id, userId])
    await client.query(`
      INSERT INTO public.profiles (id, display_name, locale)
      VALUES ($1::uuid, $2, 'pl-PL')
      ON CONFLICT (id) DO UPDATE
      SET display_name = excluded.display_name, locale = excluded.locale
    `, [userId, target.fullName])
    await client.query(`
      INSERT INTO public.platform_user_roles (user_id, role)
      VALUES ($1::uuid, 'super_admin')
      ON CONFLICT (user_id, role) DO NOTHING
    `, [userId])
    await client.query(`
      INSERT INTO public.organization_user_admin_roles (
        organization_id,
        user_id,
        role_key,
        assigned_by_user_id,
        reason
      )
      VALUES ($1::uuid, $2::uuid, 'consents_admin', $2::uuid, $3)
      ON CONFLICT (organization_id, user_id, role_key) DO UPDATE
      SET
        assigned_by_user_id = excluded.assigned_by_user_id,
        reason = excluded.reason
    `, [
      organization.id,
      userId,
      'Production demo administrator provisioned explicitly by the owner.',
    ])

    await client.query('COMMIT')

    const verificationResult = await client.query(`
      SELECT
        auth_user.id,
        auth_user.email,
        auth_user.email_verified,
        credential.password,
        workforce.role,
        membership.role AS membership_role,
        organization.name AS organization_name,
        organization.slug AS organization_slug
      FROM identity.users AS auth_user
      JOIN identity.accounts AS credential
        ON credential.user_id = auth_user.id
        AND credential.provider_id = 'credential'
      JOIN public.users AS workforce ON workforce.id = auth_user.id
      JOIN public.organization_memberships AS membership
        ON membership.organization_id = workforce.organization_id
        AND membership.user_id = workforce.id
      JOIN public.organizations AS organization
        ON organization.id = workforce.organization_id
      WHERE auth_user.id = $1::uuid
    `, [userId])
    const verified = verificationResult.rows[0]
    if (
      !verified
      || verified.email !== target.email
      || verified.email_verified !== true
      || verified.role !== 'admin'
      || verified.membership_role !== 'admin'
      || !await passwordStrategy.verify({
        hash: verified.password,
        password: target.password,
      })
    ) {
      throw new Error('Production account verification failed')
    }

    console.log(JSON.stringify({
      email: verified.email,
      userId: verified.id,
      role: verified.role,
      membershipRole: verified.membership_role,
      organizationName: verified.organization_name,
      organizationSlug: verified.organization_slug,
    }, null, 2))
  }
  catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
  finally {
    await client.end()
  }
}

const options = parseArguments(process.argv.slice(2))
if (options.help) {
  console.log(usage())
}
else if (!options.apply) {
  const target = accountConfiguration()
  console.log(JSON.stringify({
    apply: false,
    email: target.email,
    fullName: target.fullName,
    organizationSlug: target.organizationSlug,
  }, null, 2))
  console.log(`Run with --apply --confirm ${CONFIRMATION} to provision the account.`)
}
else {
  await provisionAccount()
}
