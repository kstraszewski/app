import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { seedDemoCrm } from './demo-crm.mjs'
import { seedDemoFacilityImages } from './demo-facility-images.mjs'
import { seedDemoScheduling } from './demo-scheduling.mjs'
import { syncMortgageCatalog } from './sync-mortgage-catalog.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDirectory, '../../..')
const command = process.argv[2] ?? 'status'

const devAccount = {
  email: process.env.OPENEXPERT_DEV_EMAIL ?? 'admin@openexpert.local',
  password: process.env.OPENEXPERT_DEV_PASSWORD ?? 'OpenExpert123!',
  organizationName: process.env.OPENEXPERT_DEV_ORGANIZATION ?? 'OpenExpert Local',
  organizationSlug: process.env.OPENEXPERT_DEV_ORGANIZATION_SLUG ?? 'openexpert-local',
  fullName: process.env.OPENEXPERT_DEV_FULL_NAME ?? 'Local Administrator',
  avatarUrl: '/avatars/experts/local-administrator.webp',
}

const demoDelegateAccounts = [
  {
    key: 'anna-nowak',
    email: 'anna.nowak@openexpert.local',
    password: 'OpenExpert123!',
    fullName: 'Anna Nowak',
    specialty: 'Nieruchomości',
    avatarUrl: '/avatars/experts/anna-nowak.webp',
  },
  {
    key: 'piotr-zielinski',
    email: 'piotr.zielinski@openexpert.local',
    password: 'OpenExpert123!',
    fullName: 'Piotr Zieliński',
    specialty: 'Ubezpieczenia',
    avatarUrl: '/avatars/experts/piotr-zielinski.webp',
  },
  {
    key: 'marta-wojcik',
    email: 'marta.wojcik@openexpert.local',
    password: 'OpenExpert123!',
    fullName: 'Marta Wójcik',
    specialty: 'Obsługa klienta',
    avatarUrl: '/avatars/experts/marta-wojcik.webp',
  },
]

function runSupabase(args, { capture = false } = {}) {
  const result = spawnSync(
    'supabase',
    [...args, '--workdir', repoRoot],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: capture ? 'pipe' : 'inherit',
    },
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = capture ? (result.stderr || result.stdout) : ''
    throw new Error('Supabase command failed: supabase ' + args.join(' ') + '\n' + detail)
  }

  return result.stdout ?? ''
}

function readLocalStatus() {
  const raw = runSupabase(['status', '-o', 'json'], { capture: true })
  return JSON.parse(raw)
}

function statusValue(status, keys) {
  for (const key of keys) {
    const value = status[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function localCredentials() {
  const status = readLocalStatus()
  const url = statusValue(status, ['API_URL', 'api_url'])
  const publicKey = statusValue(status, [
    'PUBLISHABLE_KEY',
    'ANON_KEY',
    'publishable_key',
    'anon_key',
  ])
  const secretKey = statusValue(status, [
    'SECRET_KEY',
    'SERVICE_ROLE_KEY',
    'secret_key',
    'service_role_key',
  ])
  const serviceRoleKey = statusValue(status, [
    'SERVICE_ROLE_KEY',
    'service_role_key',
  ]) ?? secretKey
  const studioUrl = statusValue(status, ['STUDIO_URL', 'studio_url'])
  const mailpitUrl = statusValue(status, [
    'MAILPIT_URL',
    'INBUCKET_URL',
    'mailpit_url',
    'inbucket_url',
  ])

  if (!url || !publicKey || !secretKey) {
    throw new Error('Supabase status did not return API URL, public key and secret key.')
  }

  return { url, publicKey, secretKey, serviceRoleKey, studioUrl, mailpitUrl }
}

function errorDetail(error) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const values = Object.fromEntries(
      Object.getOwnPropertyNames(error).map((key) => [key, error[key]]),
    )
    return JSON.stringify(values)
  }
  return String(error)
}

function assertNoError(error, operation) {
  if (error) throw new Error(operation + ': ' + errorDetail(error))
}

async function countOrganizationRows(client, table, organizationId) {
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
  assertNoError(error, 'Counting ' + table)
  return count ?? 0
}

function warsawTime(instant) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant))
}

async function waitForAuthHealth(credentials, attempts) {
  let lastError = 'unknown error'

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(credentials.url + '/auth/v1/health', {
        headers: { apikey: credentials.publicKey },
      })
      if (response.ok) return
      lastError = 'HTTP ' + response.status
    } catch (error) {
      lastError = errorDetail(error)
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
  }

  return lastError
}

async function waitForRestHealth(credentials, attempts) {
  let lastError = 'unknown error'

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(credentials.url + '/rest/v1/users?select=id&limit=1', {
        headers: {
          apikey: credentials.serviceRoleKey,
          authorization: 'Bearer ' + credentials.serviceRoleKey,
        },
      })
      if (response.ok) return
      const body = await response.text()
      lastError = 'HTTP ' + response.status + (body ? ': ' + body : '')
    }
    catch (error) {
      lastError = errorDetail(error)
    }

    await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
  }

  return lastError
}

async function waitForLocalHealth(credentials, attempts) {
  const authError = await waitForAuthHealth(credentials, attempts)
  if (authError) return 'Auth: ' + authError
  const restError = await waitForRestHealth(credentials, attempts)
  return restError ? 'REST: ' + restError : undefined
}

async function waitForLocalServices(credentials, { restartOnFailure = false } = {}) {
  let lastError = await waitForLocalHealth(credentials, 40)
  if (!lastError) return

  if (restartOnFailure) {
    console.warn('Supabase API is not ready (' + lastError + '); refreshing the local stack...')
    runSupabase(['stop', '--yes'])
    runSupabase(['start'])
    lastError = await waitForLocalHealth(credentials, 60)
    if (!lastError) return
  }

  throw new Error('Supabase Auth did not become ready: ' + lastError)
}

function writeAppEnvironment(credentials) {
  const publicLines = [
    '# Generated by pnpm db:setup. Do not commit.',
    'NUXT_PUBLIC_SUPABASE_URL=' + credentials.url,
    'NUXT_PUBLIC_SUPABASE_KEY=' + credentials.publicKey,
  ]

  const crmPath = resolve(repoRoot, 'apps/crm/.env')
  const landingPath = resolve(repoRoot, 'apps/landing/.env')
  mkdirSync(dirname(crmPath), { recursive: true })
  mkdirSync(dirname(landingPath), { recursive: true })

  writeManagedEnvironment(
    crmPath,
    [...publicLines, 'NUXT_SUPABASE_SECRET_KEY=' + credentials.secretKey],
  )
  writeManagedEnvironment(
    landingPath,
    [...publicLines, 'NUXT_SUPABASE_SECRET_KEY=' + credentials.secretKey],
  )
}

function writeManagedEnvironment(filePath, managedLines) {
  const managedKeys = new Set(
    managedLines
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter(Boolean),
  )
  const preservedLines = existsSync(filePath)
    ? readFileSync(filePath, 'utf8')
        .split('\n')
        .filter((line) => {
          if (!line || line === '# Generated by pnpm db:setup. Do not commit.') return false
          const key = line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1]
          return !key || !managedKeys.has(key)
        })
    : []

  const lines = [...managedLines]
  if (preservedLines.length > 0) lines.push('', ...preservedLines)
  writeFileSync(filePath, lines.join('\n') + '\n')
}

function generateDatabaseTypes() {
  const output = runSupabase(['gen', 'types', 'typescript', '--local'], { capture: true })
  const outputPath = resolve(repoRoot, 'packages/database/database.types.ts')
  writeFileSync(outputPath, output)
  console.log('Generated Supabase types: ' + outputPath)
}

function adminClient(credentials) {
  return createClient(credentials.url, credentials.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

async function authenticatedDevClient(credentials) {
  const client = createClient(credentials.url, credentials.publicKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email: devAccount.email,
    password: devAccount.password,
  })
  assertNoError(error, 'Signing in for the authenticated demo seed')
  if (!data.session || !data.user) {
    throw new Error('The authenticated demo seed received no user session.')
  }
  return client
}

async function ensureDemoDelegateAccounts(supabase, credentials, organizationId) {
  const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  assertNoError(usersError, 'Listing local Auth users for task delegation seed')
  const authUserByEmail = new Map(
    usersData.users.map(user => [String(user.email ?? '').toLowerCase(), user]),
  )
  const delegateByKey = new Map()

  for (const account of demoDelegateAccounts) {
    const userMetadata = {
      full_name: account.fullName,
      demo_seed_kind: 'task_delegate',
      specialty: account.specialty,
    }
    let authUser = authUserByEmail.get(account.email)
    if (authUser) {
      const { data, error } = await supabase.auth.admin.updateUserById(authUser.id, {
        password: account.password,
        email_confirm: true,
        user_metadata: userMetadata,
      })
      assertNoError(error, `Updating demo delegate ${account.fullName}`)
      authUser = data.user
    }
    else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: account.email,
        password: account.password,
        email_confirm: true,
        user_metadata: userMetadata,
      })
      assertNoError(error, `Creating demo delegate ${account.fullName}`)
      authUser = data.user
      if (authUser) authUserByEmail.set(account.email, authUser)
    }
    if (!authUser?.id) {
      throw new Error(`Creating demo delegate ${account.fullName} returned no user id`)
    }

    let { data: workforceProfile, error: profileError } = await supabase
      .from('users')
      .select('id, organization_id, email, full_name')
      .eq('id', authUser.id)
      .maybeSingle()
    assertNoError(profileError, `Reading workforce profile for ${account.fullName}`)

    if (!workforceProfile) {
      const delegateClient = createClient(credentials.url, credentials.publicKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
      const { error: signInError } = await delegateClient.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      })
      assertNoError(signInError, `Signing in demo delegate ${account.fullName}`)
      try {
        const { error: onboardingError } = await delegateClient.rpc(
          'create_organization_with_admin',
          {
            organization_name: `${account.fullName} — profil demonstracyjny`,
            full_name: account.fullName,
          },
        )
        assertNoError(onboardingError, `Onboarding demo delegate ${account.fullName}`)
      }
      finally {
        await delegateClient.auth.signOut({ scope: 'local' })
      }

      const refreshed = await supabase
        .from('users')
        .select('id, organization_id, email, full_name')
        .eq('id', authUser.id)
        .single()
      assertNoError(refreshed.error, `Reading onboarded delegate ${account.fullName}`)
      workforceProfile = refreshed.data
    }

    const { error: userUpdateError } = await supabase
      .from('users')
      .update({
        email: account.email,
        full_name: account.fullName,
        avatar_url: account.avatarUrl,
      })
      .eq('id', authUser.id)
    assertNoError(userUpdateError, `Stabilizing demo delegate ${account.fullName}`)

    const { error: publicProfileError } = await supabase
      .from('profiles')
      .upsert({
        id: authUser.id,
        display_name: account.fullName,
        locale: 'pl-PL',
      }, { onConflict: 'id' })
    assertNoError(publicProfileError, `Updating profile for ${account.fullName}`)

    const { error: membershipError } = await supabase
      .from('organization_memberships')
      .upsert({
        organization_id: organizationId,
        user_id: authUser.id,
        role: 'expert',
      }, { onConflict: 'organization_id,user_id' })
    assertNoError(membershipError, `Adding ${account.fullName} to the demo organization`)

    delegateByKey.set(account.key, {
      id: authUser.id,
      email: account.email,
      fullName: account.fullName,
      specialty: account.specialty,
      avatarUrl: account.avatarUrl,
    })
  }

  return delegateByKey
}

async function ensureLocalDemoWorkspace(supabase, profile, credentials) {
  const organizationId = profile.organization_id
  const userId = profile.id
  const delegateByKey = await ensureDemoDelegateAccounts(
    supabase,
    credentials,
    organizationId,
  )

  const { error: organizationError } = await supabase
    .from('organizations')
    .update({
      name: devAccount.organizationName,
      slug: devAccount.organizationSlug,
    })
    .eq('id', organizationId)
  assertNoError(organizationError, 'Stabilizing the local organization route')

  const { data: facility, error: facilityError } = await supabase
    .from('facilities')
    .upsert({
      organization_id: organizationId,
      name: 'OpenExpert Szczecin Centrum',
      slug: 'szczecin-centrum',
      description: 'Fikcyjna placówka demonstracyjna obsługująca klientów ze Szczecina i okolic.',
      timezone: 'Europe/Warsaw',
      address_line1: 'al. Wojska Polskiego 42',
      postal_code: '70-475',
      city: 'Szczecin',
      country_code: 'PL',
      latitude: 53.4305362,
      longitude: 14.5418219,
      phone: '+48 91 881 24 60',
      email: 'szczecin@openexpert.local',
      is_active: true,
    }, { onConflict: 'organization_id,slug' })
    .select('id, name, slug')
    .single()
  assertNoError(facilityError, 'Seeding the Szczecin facility')

  const facilityImages = await seedDemoFacilityImages({
    adminClient: supabase,
    profile,
    facility,
    repoRoot,
  })

  const teamSeeds = [
    {
      slug: 'oddzial-szczecin',
      name: 'Oddział Szczecin',
      kind: 'department',
      description: 'Struktura regionalna fikcyjnej placówki w Szczecinie.',
    },
    {
      slug: 'doradcy-hipoteczni-szczecin',
      name: 'Doradcy hipoteczni',
      kind: 'team',
      description: 'Zespół prowadzący konsultacje i sprawy hipoteczne.',
    },
    {
      slug: 'obsluga-klienta-szczecin',
      name: 'Obsługa klienta',
      kind: 'team',
      description: 'Zespół pierwszego kontaktu, dokumentów i umawiania spotkań.',
    },
  ]
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .upsert(
      teamSeeds.map(team => ({ organization_id: organizationId, ...team })),
      { onConflict: 'organization_id,slug' },
    )
    .select('id, name, slug')
  assertNoError(teamsError, 'Seeding the Szczecin teams')

  const teamBySlug = new Map((teams ?? []).map(team => [team.slug, team]))
  const branch = teamBySlug.get('oddzial-szczecin')
  const mortgage = teamBySlug.get('doradcy-hipoteczni-szczecin')
  const service = teamBySlug.get('obsluga-klienta-szczecin')
  if (!branch || !mortgage || !service) {
    throw new Error('The Szczecin demo teams were not returned after upsert.')
  }

  const { error: edgeError } = await supabase.from('team_edges').upsert([
    { organization_id: organizationId, parent_team_id: branch.id, child_team_id: mortgage.id },
    { organization_id: organizationId, parent_team_id: branch.id, child_team_id: service.id },
  ], { onConflict: 'organization_id,parent_team_id,child_team_id' })
  assertNoError(edgeError, 'Seeding the Szczecin team graph')

  const { error: facilityLinksError } = await supabase.from('team_facilities').upsert(
    [branch, mortgage, service].map(team => ({
      organization_id: organizationId,
      team_id: team.id,
      facility_id: facility.id,
    })),
    { onConflict: 'organization_id,team_id,facility_id' },
  )
  assertNoError(facilityLinksError, 'Linking the Szczecin teams to the facility')

  const { error: teamMembershipsError } = await supabase.from('team_memberships').upsert(
    [branch, mortgage, service].map(team => ({
      organization_id: organizationId,
      team_id: team.id,
      user_id: userId,
      role: team.id === branch.id ? 'admin' : 'member',
    })),
    { onConflict: 'organization_id,team_id,user_id' },
  )
  assertNoError(teamMembershipsError, 'Assigning the local account to the Szczecin teams')

  const delegateTeamAssignments = [
    { delegateKey: 'anna-nowak', team: branch },
    { delegateKey: 'anna-nowak', team: service },
    { delegateKey: 'piotr-zielinski', team: branch },
    { delegateKey: 'piotr-zielinski', team: service },
    { delegateKey: 'marta-wojcik', team: branch },
    { delegateKey: 'marta-wojcik', team: mortgage },
  ].map(({ delegateKey, team }) => ({
    organization_id: organizationId,
    team_id: team.id,
    user_id: delegateByKey.get(delegateKey).id,
    role: 'member',
  }))
  const { error: delegateTeamsError } = await supabase
    .from('team_memberships')
    .upsert(delegateTeamAssignments, {
      onConflict: 'organization_id,team_id,user_id',
    })
  assertNoError(delegateTeamsError, 'Assigning demo delegates to the Szczecin teams')

  const bookableUsers = [
    {
      id: userId,
      bookingPriority: 100,
    },
    ...[...delegateByKey.values()].map((delegate, index) => ({
      id: delegate.id,
      bookingPriority: 90 - index * 10,
    })),
  ]
  const { error: facilityMembershipError } = await supabase
    .from('facility_memberships')
    .upsert(
      bookableUsers.map(bookableUser => ({
        organization_id: organizationId,
        facility_id: facility.id,
        user_id: bookableUser.id,
        role: 'member',
        is_bookable: true,
        booking_priority: bookableUser.bookingPriority,
      })),
      { onConflict: 'organization_id,facility_id,user_id' },
    )
  assertNoError(
    facilityMembershipError,
    'Assigning the demo experts to the Szczecin facility',
  )

  const { data: meetingService, error: meetingServiceError } = await supabase
    .from('booking_services')
    .upsert({
      organization_id: organizationId,
      name: 'Spotkanie',
      slug: 'spotkanie',
      description: 'Ogólne spotkanie z ekspertem.',
      duration_minutes: 60,
      buffer_before_minutes: 0,
      buffer_after_minutes: 0,
      slot_interval_minutes: 15,
      min_notice_minutes: 60,
      max_advance_days: 90,
      is_active: true,
    }, { onConflict: 'organization_id,slug' })
    .select('id, name, slug')
    .single()
  assertNoError(meetingServiceError, 'Seeding the generic meeting service')

  const { error: facilityServiceError } = await supabase.from('facility_services').upsert({
    organization_id: organizationId,
    facility_id: facility.id,
    service_id: meetingService.id,
    is_active: true,
  }, { onConflict: 'organization_id,facility_id,service_id' })
  assertNoError(facilityServiceError, 'Enabling the generic meeting service at the Szczecin facility')

  const { error: expertServiceError } = await supabase
    .from('facility_service_experts')
    .upsert(
      bookableUsers.map(bookableUser => ({
        organization_id: organizationId,
        facility_id: facility.id,
        service_id: meetingService.id,
        user_id: bookableUser.id,
        is_active: true,
      })),
      { onConflict: 'organization_id,facility_id,service_id,user_id' },
    )
  assertNoError(
    expertServiceError,
    'Assigning the generic meeting service to the demo experts',
  )

  const userClient = await authenticatedDevClient(credentials)
  try {
    const seedNow = new Date()
    const crm = await seedDemoCrm({
      adminClient: supabase,
      userClient,
      profile,
      delegateByKey,
      seedNow,
    })
    const meetingTask = crm.tasks.find(
      task => task.seed_key === 'case-mortgage-warszewo:task:property-register',
    )
    if (!meetingTask) {
      throw new Error('Demo task meeting requires the delegated property task')
    }
    const scheduling = await seedDemoScheduling({
      adminClient: supabase,
      profile,
      facility,
      meetingService,
      clients: crm.clients,
      additionalExpertUserIds: [...delegateByKey.values()].map(
        delegate => delegate.id,
      ),
      delegatedTask: meetingTask,
      seedNow,
    })
    const scheduledMeeting = scheduling.delegatedTaskAppointment
    if (!scheduledMeeting) {
      throw new Error('Demo delegated task meeting was not seeded')
    }
    const { error: staleTaskMeetingsError } = await supabase
      .from('appointments')
      .update({ crm_task_id: null })
      .eq('organization_id', organizationId)
      .eq('crm_task_id', meetingTask.id)
      .neq('id', scheduledMeeting.id)
    assertNoError(
      staleTaskMeetingsError,
      'Removing stale demo meetings from the delegated task',
    )

    return {
      facility,
      facilityImages,
      teams: [branch, mortgage, service],
      delegates: [...delegateByKey.values()],
      crm,
      scheduling,
    }
  }
  finally {
    await userClient.auth.signOut({ scope: 'local' })
  }
}

async function ensureDevAccount(credentials) {
  const supabase = adminClient(credentials)
  const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  assertNoError(usersError, 'Listing local Auth users')

  const metadata = {
    full_name: devAccount.fullName,
    organization_name: devAccount.organizationName,
  }
  const existing = usersData.users.find((user) => user.email === devAccount.email)
  let userId

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: devAccount.password,
      user_metadata: metadata,
    })
    assertNoError(error, 'Updating the local Auth user')
    userId = data.user.id
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: devAccount.email,
      password: devAccount.password,
      email_confirm: true,
      user_metadata: metadata,
    })
    assertNoError(error, 'Creating the local Auth user')
    userId = data.user.id
  }

  let { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, organization_id, email, role, full_name')
    .eq('id', userId)
    .maybeSingle()
  assertNoError(profileError, 'Reading the provisioned local profile')

  if (!profile) {
    const userClient = await authenticatedDevClient(credentials)
    try {
      const { error: onboardingError } = await userClient.rpc(
        'create_organization_with_admin',
        {
          organization_name: devAccount.organizationName,
          full_name: devAccount.fullName,
        },
      )
      assertNoError(onboardingError, 'Creating the local admin organization')
    } finally {
      await userClient.auth.signOut({ scope: 'local' })
    }

    const refreshedProfile = await supabase
      .from('users')
      .select('id, organization_id, email, role, full_name')
      .eq('id', userId)
      .single()
    assertNoError(refreshedProfile.error, 'Reading the onboarded local profile')
    profile = refreshedProfile.data
  }

  if (profile.role !== 'admin' || !profile.organization_id) {
    throw new Error('The local account was created without an admin organization profile.')
  }

  const { error: avatarError } = await supabase
    .from('users')
    .update({ avatar_url: devAccount.avatarUrl })
    .eq('id', profile.id)
  assertNoError(avatarError, 'Setting the local administrator avatar')

  const { error: platformRoleError } = await supabase
    .from('platform_user_roles')
    .upsert({ user_id: userId, role: 'super_admin' }, { onConflict: 'user_id,role' })
  assertNoError(platformRoleError, 'Assigning the local SuperAdmin role')

  await ensureLocalDemoWorkspace(supabase, profile, credentials)

  return profile
}

async function verifyPasswordLogin(credentials) {
  const supabase = createClient(credentials.url, credentials.publicKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: devAccount.email,
    password: devAccount.password,
  })
  assertNoError(signInError, 'Signing in with the local password')
  if (!signInData.session || !signInData.user) {
    throw new Error('Password login returned no authenticated session.')
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, organization_id, email, role, full_name')
    .eq('id', signInData.user.id)
    .single()
  assertNoError(profileError, 'Reading the profile through authenticated RLS')

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('id', profile.organization_id)
    .single()
  assertNoError(organizationError, 'Reading the organization through authenticated RLS')
  if (organization.slug !== devAccount.organizationSlug) {
    throw new Error(
      `Expected local organization slug ${devAccount.organizationSlug}, received ${organization.slug}.`,
    )
  }

  const { data: platformRole, error: platformRoleError } = await supabase
    .from('platform_user_roles')
    .select('user_id, role')
    .eq('user_id', profile.id)
    .eq('role', 'super_admin')
    .maybeSingle()
  assertNoError(platformRoleError, 'Reading the local SuperAdmin role through authenticated RLS')
  if (!platformRole) {
    throw new Error('The local account must have the SuperAdmin platform role.')
  }

  const { data: teamAdminMembership, error: teamAdminMembershipError } = await supabase
    .from('team_memberships')
    .select('team_id, role')
    .eq('organization_id', profile.organization_id)
    .eq('user_id', profile.id)
    .eq('role', 'admin')
    .limit(1)
    .maybeSingle()
  assertNoError(teamAdminMembershipError, 'Reading the local team administrator membership')
  if (!teamAdminMembership) {
    throw new Error('The local account must have at least one direct team administrator membership.')
  }

  const { data: phoneSearch, error: phoneSearchError } = await supabase.rpc(
    'search_crm_clients_ranked',
    {
      p_organization_id: profile.organization_id,
      p_filters: { q: '+48 501 210-101', limit: 10 },
    },
  )
  assertNoError(phoneSearchError, 'Searching demo clients by a formatted phone number')
  const phoneRows = Array.isArray(phoneSearch?.data) ? phoneSearch.data : []
  if (!phoneRows.some(client => client.display_name === 'Jan Kowalski')) {
    throw new Error('Formatted phone search did not return the seeded Jan Kowalski client.')
  }

  const { data: peselSearch, error: peselSearchError } = await supabase.rpc(
    'search_crm_clients_ranked',
    {
      p_organization_id: profile.organization_id,
      p_filters: { q: '85010112345', limit: 10 },
    },
  )
  assertNoError(peselSearchError, 'Searching demo clients by PESEL')
  const peselRows = Array.isArray(peselSearch?.data) ? peselSearch.data : []
  if (!peselRows.some(client => client.display_name === 'Jan Kowalski')) {
    throw new Error('PESEL search did not return the seeded Jan Kowalski client.')
  }

  const { data: personSearch, error: personSearchError } = await supabase.rpc(
    'search_crm_clients_ranked',
    {
      p_organization_id: profile.organization_id,
      p_filters: { q: 'Pawel Krol', limit: 10 },
    },
  )
  assertNoError(personSearchError, 'Searching a company client by a contact person')
  const personRows = Array.isArray(personSearch?.data) ? personSearch.data : []
  const balticClient = personRows.find(client => client.display_name === 'Baltic Homes sp. z o.o.')
  if (!balticClient || balticClient.matchedPerson?.display_name !== 'Paweł Król') {
    throw new Error('Contact-person search did not explain the Baltic Homes match.')
  }

  const { data: companyIdSearch, error: companyIdSearchError } = await supabase.rpc(
    'search_crm_clients_ranked',
    {
      p_organization_id: profile.organization_id,
      p_filters: { q: '851-000-00-00', limit: 10 },
    },
  )
  assertNoError(companyIdSearchError, 'Searching a company client by a formatted NIP')
  const companyIdRows = Array.isArray(companyIdSearch?.data) ? companyIdSearch.data : []
  if (!companyIdRows.some(client => client.display_name === 'Baltic Homes sp. z o.o.')) {
    throw new Error('Formatted NIP search did not return the seeded Baltic Homes client.')
  }

  const caseSearchExpectations = [
    {
      query: 'Pawel Krol',
      title: 'Finansowanie etapu inwestycji Baltic Homes',
      contextType: 'person',
    },
    {
      query: '508 980-809',
      title: 'Finansowanie etapu inwestycji Baltic Homes',
      contextType: 'person',
    },
    {
      query: 'Kredyt firmowy',
      title: 'Finansowanie etapu inwestycji Baltic Homes',
      contextType: 'product',
    },
    {
      query: 'Maciejkowa',
      title: 'Zakup mieszkania — Warszewo',
      contextType: 'property',
    },
  ]
  for (const expectation of caseSearchExpectations) {
    const { data: caseSearch, error: caseSearchError } = await supabase.rpc(
      'search_crm_cases_with_context',
      {
        p_organization_id: profile.organization_id,
        p_filters: { q: expectation.query, sort: 'relevance', limit: 10, offset: 0 },
      },
    )
    assertNoError(caseSearchError, `Searching demo cases by ${expectation.query}`)
    const caseRows = Array.isArray(caseSearch?.data) ? caseSearch.data : []
    const matchingCase = caseRows.find(crmCase => crmCase.title === expectation.title)
    if (!matchingCase || matchingCase.match_context?.type !== expectation.contextType) {
      throw new Error(
        `Case search for ${expectation.query} did not return an explained ${expectation.contextType} match.`,
      )
    }
  }

  const serviceClient = adminClient(credentials)
  const minimumCounts = {
    crm_clients: 9,
    crm_client_people: 11,
    crm_cases: 8,
    crm_case_items: 8,
    crm_properties: 1,
    crm_tasks: 1,
    crm_documents: 1,
    crm_activities: 1,
    organization_memberships: 4,
    facilities: 1,
    facility_images: 3,
    facility_opening_hours: 5,
    expert_availability_rules: 5,
    booking_services: 4,
    booking_widgets: 3,
    appointments: 7,
  }
  const demoCountEntries = await Promise.all(
    Object.entries(minimumCounts).map(async ([table, minimum]) => {
      const count = await countOrganizationRows(serviceClient, table, profile.organization_id)
      if (count < minimum) {
        throw new Error(`Expected at least ${minimum} rows in ${table}, received ${count}.`)
      }
      return [table, count]
    }),
  )
  const demoCounts = Object.fromEntries(demoCountEntries)

  const { data: delegationMembers, error: delegationMembersError } = await supabase
    .from('organization_memberships')
    .select('user_id, user:users!organization_memberships_user_id_fkey!inner(full_name)')
    .eq('organization_id', profile.organization_id)
  assertNoError(delegationMembersError, 'Reading task delegation demo members')
  const delegateNames = new Set(
    (delegationMembers ?? []).map(membership => membership.user?.full_name),
  )
  for (const expectedName of ['Anna Nowak', 'Piotr Zieliński', 'Marta Wójcik']) {
    if (!delegateNames.has(expectedName)) {
      throw new Error(`Task delegation seed is missing ${expectedName}`)
    }
  }

  const { data: delegatedTasks, error: delegatedTasksError } = await supabase
    .from('crm_tasks')
    .select('id, delegator_user_id, assignee_user_id, client_id, case_id, case_item_id, title, status_code, delegation_status, data_access_scope')
    .eq('organization_id', profile.organization_id)
    .neq('delegation_status', 'not_delegated')
  assertNoError(delegatedTasksError, 'Reading seeded delegated tasks')
  const delegationStatuses = new Set(
    (delegatedTasks ?? []).map(task => task.delegation_status),
  )
  if (
    (delegatedTasks ?? []).length < 5
    || !['pending', 'accepted', 'rejected'].every(status => delegationStatuses.has(status))
    || !(delegatedTasks ?? []).some(task => task.status_code === 'done')
    || (delegatedTasks ?? []).some(task => (
      task.delegator_user_id !== profile.id
      || task.assignee_user_id === profile.id
      || !Array.isArray(task.data_access_scope)
      || task.data_access_scope.length === 0
    ))
  ) {
    throw new Error('Delegated task seed must cover pending, accepted, rejected and completed work')
  }

  const delegatedTaskIds = delegatedTasks.map(task => task.id)
  const { data: taskAudit, error: taskAuditError } = await supabase
    .from('crm_activities')
    .select('task_id, activity_type')
    .eq('organization_id', profile.organization_id)
    .in('task_id', delegatedTaskIds)
  assertNoError(taskAuditError, 'Reading delegated task audit trail')
  if (
    taskAudit.length < delegatedTasks.length
    || !taskAudit.some(activity => activity.activity_type === 'task_delegated')
    || !taskAudit.some(activity => activity.activity_type === 'task_delegation_accepted')
    || !taskAudit.some(activity => activity.activity_type === 'task_delegation_rejected')
  ) {
    throw new Error('Delegated task audit trail is incomplete')
  }

  const { data: taskMeetings, error: taskMeetingsError } = await supabase
    .from('appointments')
    .select('id, crm_task_id, expert_user_id, starts_at, status, meeting_mode')
    .eq('organization_id', profile.organization_id)
    .not('crm_task_id', 'is', null)
  assertNoError(taskMeetingsError, 'Reading delegated task meetings')
  if (!taskMeetings.length) {
    throw new Error('Delegated task seed must include at least one linked meeting')
  }
  const delegatedTaskById = new Map(
    delegatedTasks.map(task => [task.id, task]),
  )
  if (taskMeetings.some((appointment) => {
    const task = delegatedTaskById.get(appointment.crm_task_id)
    return !task
      || !task.data_access_scope.includes('client_contact')
      || !task.data_access_scope.includes('client_identity')
  })) {
    throw new Error(
      'Every delegated task meeting must include client contact and identity access',
    )
  }
  const scheduledDelegationMeeting = taskMeetings.find((appointment) => {
    const task = delegatedTaskById.get(appointment.crm_task_id)
    return task
      && appointment.expert_user_id === task.assignee_user_id
      && appointment.status === 'confirmed'
      && appointment.meeting_mode === 'office'
      && new Date(appointment.starts_at).valueOf() > Date.now()
  })
  if (!scheduledDelegationMeeting) {
    throw new Error(
      'Delegated task seed must include a future confirmed meeting with its assignee',
    )
  }

  const acceptedTask = delegatedTasks.find(task => task.delegation_status === 'accepted')
  if (!acceptedTask) {
    throw new Error('Task delegation security checks require an accepted task')
  }
  const annaAccount = demoDelegateAccounts.find(account => account.key === 'anna-nowak')
  const annaMembership = (delegationMembers ?? []).find(
    membership => membership.user?.full_name === annaAccount?.fullName,
  )
  const annaTask = delegatedTasks.find(task => (
    task.assignee_user_id === annaMembership?.user_id
    && task.delegation_status === 'accepted'
  ))
  if (!annaAccount || !annaMembership || !annaTask) {
    throw new Error('Task delegation security checks require Anna and her accepted task')
  }

  const forgedResolvedTask = await supabase
    .from('crm_tasks')
    .insert({
      organization_id: profile.organization_id,
      delegator_user_id: profile.id,
      assignee_user_id: annaMembership.user_id,
      client_id: acceptedTask.client_id,
      case_id: acceptedTask.case_id,
      case_item_id: acceptedTask.case_item_id,
      title: 'Nieprawidłowa delegacja z pominięciem akceptacji',
      status_code: 'open',
      delegation_status: 'accepted',
      due_at: new Date(Date.now() + 86_400_000).toISOString(),
      data_access_scope: ['case_summary'],
      idempotency_key: 'd7300000-0000-4000-8000-000000000001',
      idempotency_fingerprint: '0'.repeat(64),
    })
  if (
    !forgedResolvedTask.error
    || forgedResolvedTask.error.code !== '23514'
    || !forgedResolvedTask.error.message.includes('delegated_task_must_start_pending')
  ) {
    throw new Error('Authenticated delegators can bypass task acceptance')
  }

  const forgedCompletedTask = await supabase
    .from('crm_tasks')
    .insert({
      organization_id: profile.organization_id,
      delegator_user_id: profile.id,
      assignee_user_id: annaMembership.user_id,
      client_id: acceptedTask.client_id,
      case_id: acceptedTask.case_id,
      case_item_id: acceptedTask.case_item_id,
      title: 'Nieprawidłowe ukończone zadanie oczekujące',
      status_code: 'open',
      delegation_status: 'pending',
      due_at: new Date(Date.now() + 86_400_000).toISOString(),
      completed_at: new Date().toISOString(),
      data_access_scope: ['case_summary'],
      idempotency_key: 'd7300000-0000-4000-8000-000000000002',
      idempotency_fingerprint: '0'.repeat(64),
    })
  if (
    !forgedCompletedTask.error
    || forgedCompletedTask.error.code !== '23514'
    || !forgedCompletedTask.error.message.includes(
      'crm_tasks_delegated_completion_check',
    )
  ) {
    throw new Error('A pending delegated task can carry a forged completion')
  }

  const annaClient = createClient(credentials.url, credentials.publicKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  const { error: annaSignInError } = await annaClient.auth.signInWithPassword({
    email: annaAccount.email,
    password: annaAccount.password,
  })
  assertNoError(annaSignInError, 'Signing in an assignee for task RLS checks')
  try {
    const forbiddenDefinitionChange = await annaClient
      .from('crm_tasks')
      .update({ title: `${annaTask.title} — niedozwolona zmiana` })
      .eq('organization_id', profile.organization_id)
      .eq('id', annaTask.id)
      .select('id')
    if (
      !forbiddenDefinitionChange.error
      || forbiddenDefinitionChange.error.code !== '42501'
    ) {
      throw new Error('An assignee changed the delegated task definition')
    }

    const forgedTaskAudit = await annaClient
      .from('crm_activities')
      .insert({
        organization_id: profile.organization_id,
        actor_user_id: annaMembership.user_id,
        client_id: annaTask.client_id,
        case_id: annaTask.case_id,
        case_item_id: annaTask.case_item_id,
        task_id: annaTask.id,
        activity_type: 'task_completed',
        title: 'Sfałszowany wpis audytowy',
      })
    if (!forgedTaskAudit.error || forgedTaskAudit.error.code !== '42501') {
      throw new Error('An assignee inserted a forged delegated-task audit row')
    }
  }
  finally {
    await annaClient.auth.signOut({ scope: 'local' })
  }

  const protectedTask = delegatedTasks[0]
  const { data: deletedDelegatedTask, error: deleteDelegatedTaskError } = await supabase
    .from('crm_tasks')
    .delete()
    .eq('organization_id', profile.organization_id)
    .eq('id', protectedTask.id)
    .select('id')
  assertNoError(deleteDelegatedTaskError, 'Checking delegated task deletion protection')
  if (deletedDelegatedTask?.length) {
    throw new Error('An authenticated organization admin deleted an audited delegated task')
  }

  const { data: facility, error: facilityError } = await serviceClient
    .from('facilities')
    .select('id, latitude, longitude')
    .eq('organization_id', profile.organization_id)
    .eq('slug', 'szczecin-centrum')
    .single()
  assertNoError(facilityError, 'Reading the seeded facility')
  if (
    facility.latitude !== 53.4305362
    || facility.longitude !== 14.5418219
  ) {
    throw new Error('The Szczecin demo facility must have stable map coordinates.')
  }

  const { data: facilityImages, error: facilityImagesError } = await supabase
    .from('facility_images')
    .select('id, storage_bucket, storage_path, sort_order')
    .eq('organization_id', profile.organization_id)
    .eq('facility_id', facility.id)
    .order('sort_order')
  assertNoError(facilityImagesError, 'Reading facility images through authenticated RLS')
  if (
    facilityImages.length !== 3
    || facilityImages.some((image, index) => (
      image.storage_bucket !== 'facility-images'
      || image.sort_order !== index
    ))
  ) {
    throw new Error('The Szczecin demo facility must have three ordered gallery images.')
  }

  const { data: signedFacilityImage, error: signedFacilityImageError } = await supabase.storage
    .from('facility-images')
    .createSignedUrl(facilityImages[0].storage_path, 60)
  assertNoError(signedFacilityImageError, 'Creating a signed URL for a facility image')
  if (!signedFacilityImage?.signedUrl) {
    throw new Error('The seeded facility image did not produce a signed URL.')
  }

  const { data: service, error: serviceError } = await serviceClient
    .from('booking_services')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .eq('slug', 'spotkanie')
    .single()
  assertNoError(serviceError, 'Reading the seeded generic service')
  const { data: availabilityOverride, error: availabilityOverrideError } = await serviceClient
    .from('expert_availability_overrides')
    .select('local_date')
    .eq('id', 'd3100005-1000-4000-8000-000000000001')
    .eq('organization_id', profile.organization_id)
    .eq('facility_id', facility.id)
    .eq('user_id', profile.id)
    .single()
  assertNoError(availabilityOverrideError, 'Reading tomorrow demo availability')
  const { data: freeSlots, error: freeSlotsError } = await serviceClient.rpc(
    'get_staff_booking_slots',
    {
      p_organization_id: profile.organization_id,
      p_facility_id: facility.id,
      p_service_id: service.id,
      p_expert_user_id: profile.id,
      p_local_date: availabilityOverride.local_date,
    },
  )
  assertNoError(freeSlotsError, 'Verifying tomorrow demo availability')
  if (
    !Array.isArray(freeSlots)
    || freeSlots.length === 0
    || freeSlots.some(slot => warsawTime(slot.starts_at) === '09:00')
    || !freeSlots.some(slot => warsawTime(slot.starts_at) === '10:00')
  ) {
    throw new Error('Demo availability must keep 09:00 occupied and 10:00 available.')
  }

  const { data: mortgageProducts, error: mortgageProductsError } = await supabase
    .from('mortgage_products')
    .select('id, slug')
  assertNoError(mortgageProductsError, 'Reading mortgage products through authenticated RLS')
  if (mortgageProducts.length !== 5) {
    throw new Error(`Expected 5 mortgage products, received ${mortgageProducts.length}.`)
  }

  const { data: mortgageFiles, error: mortgageFilesError } = await supabase.storage
    .from('mortgage-source-documents')
    .list('2026-07-12')
  assertNoError(mortgageFilesError, 'Reading mortgage source files through authenticated RLS')
  if (mortgageFiles.length !== 5) {
    throw new Error(`Expected 5 mortgage source files, received ${mortgageFiles.length}.`)
  }

  const { data: consentDefinitions, error: consentDefinitionsError } = await supabase
    .from('crm_consent_definitions')
    .select('id, code, current_version_id')
    .eq('organization_id', profile.organization_id)
    .order('code')
  assertNoError(consentDefinitionsError, 'Reading consent definitions through authenticated RLS')
  const expectedConsentCodes = ['marketing_email', 'marketing_phone', 'marketing_sms']
  const actualConsentCodes = consentDefinitions.map((definition) => definition.code)
  if (JSON.stringify(actualConsentCodes) !== JSON.stringify(expectedConsentCodes)) {
    throw new Error(`Expected baseline consent definitions ${expectedConsentCodes.join(', ')}, received ${actualConsentCodes.join(', ')}.`)
  }

  const { data: consentVersions, error: consentVersionsError } = await supabase
    .from('crm_consent_definition_versions')
    .select('id, status, version, is_required, content_sha256')
    .in('id', consentDefinitions.map((definition) => definition.current_version_id))
  assertNoError(consentVersionsError, 'Reading current consent versions through authenticated RLS')
  if (
    consentVersions.length !== 3
    || consentVersions.some((version) => version.status !== 'published' || version.version !== 1 || version.is_required || String(version.content_sha256 ?? '').length !== 64)
  ) {
    throw new Error('Baseline consent definitions must have a published, hashed and optional version 1.')
  }

  await supabase.auth.signOut({ scope: 'local' })
  const { data: anonymousProducts, error: anonymousProductsError } = await supabase
    .from('mortgage_products')
    .select('id')
  if (anonymousProductsError && anonymousProductsError.code !== '42501') {
    assertNoError(anonymousProductsError, 'Checking anonymous mortgage catalogue isolation')
  }
  if (!anonymousProductsError && anonymousProducts.length !== 0) {
    throw new Error('Anonymous client can read the protected mortgage catalogue.')
  }

  const { data: anonymousConsents, error: anonymousConsentsError } = await supabase
    .from('crm_consent_definitions')
    .select('id')
  if (anonymousConsentsError && anonymousConsentsError.code !== '42501') {
    assertNoError(anonymousConsentsError, 'Checking anonymous consent-definition isolation')
  }
  if (!anonymousConsentsError && anonymousConsents.length !== 0) {
    throw new Error('Anonymous client can read protected consent definitions.')
  }

  return {
    profile,
    organization,
    mortgageProducts: mortgageProducts.length,
    mortgageFiles: mortgageFiles.length,
    consentDefinitions: consentDefinitions.length,
    facilityImages: facilityImages.length,
    delegatedTasks: delegatedTasks.length,
    taskMeetings: taskMeetings.length,
    demoCounts,
    availableSlots: freeSlots.length,
    availabilityDate: availabilityOverride.local_date,
  }
}

function printAccount(result, credentials) {
  console.log('')
  console.log('OpenExpert local account is ready:')
  console.log('  CRM:      http://127.0.0.1:3004/login')
  console.log('  Email:    ' + devAccount.email)
  console.log('  Password: ' + devAccount.password)
  console.log('  Org:      ' + result.organization.name)
  console.log('  Studio:   ' + (credentials.studioUrl ?? 'disabled'))
  console.log('  Mailpit:  ' + (credentials.mailpitUrl ?? 'disabled'))
  console.log('  Mortgage catalogue: ' + result.mortgageProducts + ' products / ' + result.mortgageFiles + ' source files')
  console.log('  Consent catalogue:  ' + result.consentDefinitions + ' published definitions')
  console.log('  Facility gallery:   ' + result.facilityImages + ' images')
  console.log('  Demo CRM:           ' + result.demoCounts.crm_clients + ' clients / ' + result.demoCounts.crm_cases + ' cases')
  console.log('  Task delegation:    ' + result.delegatedTasks + ' tasks / ' + result.taskMeetings + ' linked meetings')
  console.log('  Demo calendar:      ' + result.demoCounts.appointments + ' appointments / ' + result.availableSlots + ' free slots on ' + result.availabilityDate)
}

async function configureAndVerify({ createAccount, syncCatalog = false, restartOnFailure = false }) {
  const credentials = localCredentials()
  writeAppEnvironment(credentials)
  await waitForLocalServices(credentials, { restartOnFailure })
  if (createAccount) await ensureDevAccount(credentials)
  if (syncCatalog) {
    await syncMortgageCatalog({
      url: credentials.url,
      serviceRoleKey: credentials.serviceRoleKey,
    }, { offline: true })
  }
  const result = await verifyPasswordLogin(credentials)
  printAccount(result, credentials)
}

async function main() {
  if (command === 'setup') {
    runSupabase(['start'])
    runSupabase(['db', 'reset', '--local', '--yes'])
    await configureAndVerify({ createAccount: true, syncCatalog: true, restartOnFailure: true })
    return
  }

  if (command === 'start') {
    runSupabase(['start'])
    const credentials = localCredentials()
    writeAppEnvironment(credentials)
    return
  }

  if (command === 'reset') {
    runSupabase(['start'])
    runSupabase(['db', 'reset', '--local', '--yes'])
    await configureAndVerify({ createAccount: true, syncCatalog: true, restartOnFailure: true })
    return
  }

  if (command === 'verify') {
    await configureAndVerify({ createAccount: false })
    return
  }

  if (command === 'seed-demo') {
    const credentials = localCredentials()
    await waitForLocalServices(credentials)
    const supabase = adminClient(credentials)
    const { data: profile, error } = await supabase
      .from('users')
      .select('id, organization_id, email')
      .eq('email', devAccount.email)
      .single()
    assertNoError(error, 'Reading the local profile for demo seed')
    const result = await ensureLocalDemoWorkspace(supabase, profile, credentials)
    console.log('OpenExpert demo workspace is ready:')
    console.log('  Facility: ' + result.facility.name)
    console.log('  Gallery:  ' + result.facilityImages.length + ' images')
    console.log('  Teams:    ' + result.teams.map(team => team.name).join(', '))
    console.log('  CRM:      ' + result.crm.counts.clients + ' clients / ' + result.crm.counts.cases + ' cases')
    console.log('  Calendar: ' + result.scheduling.availableSlotCount + ' free slots on ' + result.scheduling.demoDate)
    return
  }

  if (command === 'stop') {
    runSupabase(['stop'])
    return
  }

  if (command === 'status') {
    runSupabase(['status'])
    return
  }

  if (command === 'types') {
    generateDatabaseTypes()
    return
  }

  throw new Error('Unknown local Supabase command: ' + command)
}

main().catch((error) => {
  console.error(errorDetail(error))
  process.exitCode = 1
})
