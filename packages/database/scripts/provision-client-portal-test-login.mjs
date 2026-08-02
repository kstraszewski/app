import { randomUUID } from 'node:crypto'
import { createDefaultBcryptPasswordStrategy } from '@openexpert/auth'
import { Client } from 'pg'

const CONFIRMATION = 'provision-synthetic-client'
const SYNTHETIC_EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@example\.local$/u
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function assertStrongPassword(password) {
  if (
    password.length < 20
    || password.length > 128
    || !/[a-z]/u.test(password)
    || !/[A-Z]/u.test(password)
    || !/[0-9]/u.test(password)
    || !/[^A-Za-z0-9]/u.test(password)
  ) {
    throw new Error(
      'The test password must contain 20–128 characters, upper and lower case letters, a number, and a symbol',
    )
  }
}

function assertSingleRow(result, message) {
  if (result.rowCount !== 1) throw new Error(message)
  return result.rows[0]
}

async function provision() {
  const databaseUrl = requiredEnvironment('DATABASE_URL')
  const email = requiredEnvironment('OPENEXPERT_CLIENT_LOGIN_EMAIL').toLowerCase()
  const password = requiredEnvironment('OPENEXPERT_CLIENT_LOGIN_PASSWORD')
  const caseId = requiredEnvironment('OPENEXPERT_CLIENT_CASE_ID').toLowerCase()
  const confirmation = requiredEnvironment('OPENEXPERT_CONFIRM_TEST_LOGIN')

  if (confirmation !== CONFIRMATION) {
    throw new Error('Explicit synthetic-client confirmation is required')
  }
  if (!SYNTHETIC_EMAIL_PATTERN.test(email)) {
    throw new Error('Only a synthetic @example.local identity can be provisioned')
  }
  if (!UUID_PATTERN.test(caseId)) throw new Error('OPENEXPERT_CLIENT_CASE_ID is invalid')
  assertStrongPassword(password)

  const passwordStrategy = createDefaultBcryptPasswordStrategy(10)
  const passwordHash = await passwordStrategy.hash(password)
  const database = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: 'openexpert-client-test-login-provisioner',
  })

  await database.connect()
  try {
    await database.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    await database.query('SET LOCAL lock_timeout = 5000')
    await database.query('SET LOCAL statement_timeout = 15000')

    const identity = assertSingleRow(
      await database.query(
        `select id::text, name, lower(btrim(email)) as email, email_verified
           from identity.users
          where lower(btrim(email)) = $1
          for update`,
        [email],
      ),
      'Expected exactly one existing Better Auth identity',
    )
    if (!identity.email_verified || identity.email !== email) {
      throw new Error('The synthetic Better Auth identity is not verified')
    }

    const identityScope = assertSingleRow(
      await database.query(
        `select exists (
                  select 1 from public.profiles where id = $1::uuid
                ) as profile_exists,
                exists (
                  select 1 from public.users where id = $1::uuid
                ) as is_staff,
                exists (
                  select 1 from public.organization_memberships
                   where user_id = $1::uuid
                ) as has_membership`,
        [identity.id],
      ),
      'Could not validate the synthetic identity scope',
    )
    if (!identityScope.profile_exists) throw new Error('The portal profile is missing')
    if (identityScope.is_staff || identityScope.has_membership) {
      throw new Error('Refusing to provision a staff or organization-member identity')
    }

    const credential = await database.query(
      `select id::text, account_id, password is not null as password_is_set
         from identity.accounts
        where user_id = $1::uuid
          and provider_id = 'credential'
        for update`,
      [identity.id],
    )
    if (credential.rowCount > 1) throw new Error('Multiple credential accounts found')
    if (credential.rows[0]?.password_is_set) {
      throw new Error('A password is already set for this identity')
    }
    if (
      credential.rows[0]?.account_id
      && credential.rows[0].account_id !== identity.id
    ) {
      throw new Error('The existing credential account has an unexpected account id')
    }

    const person = assertSingleRow(
      await database.query(
        `select id::text, organization_id::text, client_id::text,
                display_name, email_normalized
           from public.crm_client_people
          where email_normalized = $1
          for update`,
        [email],
      ),
      'Expected exactly one synthetic CRM person with the same email',
    )
    if (person.email_normalized !== identity.email) {
      throw new Error('Identity and CRM person emails do not match')
    }

    const selectedCase = assertSingleRow(
      await database.query(
        `select crm_case.id::text, crm_case.title
           from public.crm_cases as crm_case
           join public.crm_case_clients as case_client
             on case_client.organization_id = crm_case.organization_id
            and case_client.case_id = crm_case.id
          where crm_case.organization_id = $1::uuid
            and crm_case.id = $2::uuid
            and case_client.client_id = $3::uuid
          for update of crm_case, case_client`,
        [person.organization_id, caseId, person.client_id],
      ),
      'The selected case does not belong to the synthetic client',
    )

    const activeLinks = await database.query(
      `select auth_user_id::text, client_id::text,
              verification_method, verified_contact_normalized
         from public.client_account_links
        where organization_id = $1::uuid
          and client_person_id = $2::uuid
          and revoked_at is null
        for update`,
      [person.organization_id, person.id],
    )
    if (activeLinks.rows.some(link => link.auth_user_id !== identity.id)) {
      throw new Error('The CRM person is already linked to another identity')
    }
    if (activeLinks.rowCount > 1) throw new Error('Multiple active portal links found')
    const existingLink = activeLinks.rows[0]
    if (existingLink && (
      existingLink.client_id !== person.client_id
      || existingLink.verification_method !== 'email'
      || existingLink.verified_contact_normalized !== email
    )) {
      throw new Error('The existing portal link is inconsistent')
    }

    const identityLinks = await database.query(
      `select organization_id::text, client_id::text,
              client_person_id::text, verification_method,
              verified_contact_normalized
         from public.client_account_links
        where auth_user_id = $1::uuid
          and revoked_at is null
        for update`,
      [identity.id],
    )
    if (identityLinks.rowCount > 1 || identityLinks.rows.some(link => (
      link.organization_id !== person.organization_id
      || link.client_id !== person.client_id
      || link.client_person_id !== person.id
      || link.verification_method !== 'email'
      || link.verified_contact_normalized !== email
    ))) {
      throw new Error(
        'Refusing to expose another client or tenant through this test identity',
      )
    }

    if (credential.rowCount === 1) {
      await database.query(
        `update identity.accounts
            set password = $2,
                updated_at = now()
          where id = $1::uuid`,
        [credential.rows[0].id, passwordHash],
      )
    }
    else {
      await database.query(
        `insert into identity.accounts (
           id, user_id, account_id, provider_id, password
         ) values ($1::uuid, $2::uuid, $2::uuid::text, 'credential', $3)`,
        [randomUUID(), identity.id, passwordHash],
      )
    }

    await database.query(
      `insert into public.client_account_links (
         auth_user_id,
         organization_id,
         client_id,
         client_person_id,
         source_appointment_id,
         verification_method,
         verified_contact_normalized,
         verified_at,
         revoked_at
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, null, 'email', $5, now(), null)
       on conflict (auth_user_id, organization_id, client_person_id)
       do update set
         client_id = excluded.client_id,
         source_appointment_id = null,
         verification_method = excluded.verification_method,
         verified_contact_normalized = excluded.verified_contact_normalized,
         verified_at = excluded.verified_at,
         revoked_at = null`,
      [
        identity.id,
        person.organization_id,
        person.client_id,
        person.id,
        email,
      ],
    )

    await database.query(
      `insert into public.client_portal_case_grants (
         organization_id,
         case_id,
         client_person_id,
         client_id,
         portal_enabled,
         multiform_enabled,
         granted_by_user_id,
         portal_enabled_at,
         multiform_enabled_at,
         revoked_at
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, true, true, null, now(), now(), null)
       on conflict (organization_id, case_id, client_person_id)
       do update set
         client_id = excluded.client_id,
         portal_enabled = true,
         multiform_enabled = true,
         portal_enabled_at = coalesce(
           client_portal_case_grants.portal_enabled_at,
           excluded.portal_enabled_at
         ),
         multiform_enabled_at = coalesce(
           client_portal_case_grants.multiform_enabled_at,
           excluded.multiform_enabled_at
         ),
         revoked_at = null,
         revision = client_portal_case_grants.revision + 1,
         updated_at = now()`,
      [person.organization_id, selectedCase.id, person.id, person.client_id],
    )

    const verification = assertSingleRow(
      await database.query(
        `select credential.password,
                count(distinct link.client_person_id)::integer as active_links,
                count(distinct portal_grant.case_id)::integer as active_grants
           from identity.accounts as credential
           join public.client_account_links as link
             on link.auth_user_id = credential.user_id
            and link.organization_id = $2::uuid
            and link.client_person_id = $3::uuid
            and link.revoked_at is null
           join public.client_portal_case_grants as portal_grant
             on portal_grant.organization_id = link.organization_id
            and portal_grant.client_id = link.client_id
            and portal_grant.client_person_id = link.client_person_id
            and portal_grant.case_id = $4::uuid
            and portal_grant.portal_enabled = true
            and portal_grant.revoked_at is null
          where credential.user_id = $1::uuid
            and credential.provider_id = 'credential'
          group by credential.password`,
        [identity.id, person.organization_id, person.id, selectedCase.id],
      ),
      'The provisioned portal access could not be verified',
    )
    if (
      verification.active_links !== 1
      || verification.active_grants !== 1
      || typeof verification.password !== 'string'
      || !await passwordStrategy.verify({
        hash: verification.password,
        password,
      })
    ) {
      throw new Error('The provisioned credential or portal scope is invalid')
    }

    await database.query('COMMIT')
    console.log(JSON.stringify({
      status: 'provisioned',
      email,
      userId: identity.id,
      personId: person.id,
      caseId: selectedCase.id,
      caseTitle: selectedCase.title,
    }))
  }
  catch (error) {
    await database.query('ROLLBACK').catch(() => {})
    throw error
  }
  finally {
    await database.end()
  }
}

provision().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
