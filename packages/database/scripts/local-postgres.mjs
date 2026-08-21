import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { createDefaultBcryptPasswordStrategy } from '@openexpert/auth'
import { createAuthenticatedDataApiClient } from '@openexpert/data-api'
import { seedDemoCrm } from './demo-crm.mjs'
import {
  createLocalMortgageCatalogClient,
  syncMortgageCatalog,
} from './sync-mortgage-catalog.mjs'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const composeFile = resolve(repositoryRoot, 'compose.local.yml')
const migrationsDirectory = resolve(
  repositoryRoot,
  'packages/database/postgres/migrations',
)
const smokeFile = resolve(
  repositoryRoot,
  'packages/database/postgres/smoke/rls-context.sql',
)
const postgresVolume = 'openexpert-local-postgres-data'
const composeProject = 'openexpert-local'
const defaultEnvFile = resolve(repositoryRoot, '.env.local-stack')
const managedBlockStart = '# >>> openexpert local stack (managed)'
const managedBlockEnd = '# <<< openexpert local stack (managed)'

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

const demoClientPortalAccount = {
  email: 'jan.kowalski@example.local',
  password: 'OpenExpert123!',
  fullName: 'Jan Kowalski',
  avatarUrl: '/assets/logo-mark.svg',
}

const defaults = {
  BETTER_AUTH_COOKIE_PREFIX: 'openexpert-local',
  BETTER_AUTH_URL: 'http://127.0.0.1:3004',
  OPENEXPERT_ADMIN_PASSWORD: 'openexpert-admin-local',
  OPENEXPERT_AUTH_PASSWORD: 'openexpert-auth-local',
  OPENEXPERT_AUTHENTICATOR_PASSWORD: 'openexpert-authenticator-local',
  OPENEXPERT_DEV_EMAIL: 'admin@openexpert.local',
  OPENEXPERT_DEV_FULL_NAME: 'Local Administrator',
  OPENEXPERT_DEV_ORGANIZATION: 'OpenExpert Local',
  OPENEXPERT_DEV_ORGANIZATION_SLUG: 'openexpert-local',
  OPENEXPERT_DEV_PASSWORD: 'OpenExpert123!',
  OPENEXPERT_LIVEKIT_HTTP_PORT: '7880',
  OPENEXPERT_LIVEKIT_RTC_TCP_PORT: '7881',
  OPENEXPERT_LIVEKIT_RTC_UDP_PORT: '7882',
  OPENEXPERT_MAILPIT_SMTP_PORT: '55325',
  OPENEXPERT_MAILPIT_UI_PORT: '55324',
  OPENEXPERT_POSTGRES_DB: 'openexpert',
  OPENEXPERT_POSTGRES_PASSWORD: 'openexpert-postgres-local',
  OPENEXPERT_POSTGRES_PORT: '55322',
  OPENEXPERT_POSTGREST_PORT: '55321',
  OPENEXPERT_RUNTIME_PASSWORD: 'openexpert-runtime-local',
  NUXT_DATA_API_JWT_AUDIENCE: 'openexpert-data',
  NUXT_DATA_API_JWT_ISSUER: 'openexpert-local',
  NUXT_CEIDG_API_BASE_URL: 'https://dane.biznes.gov.pl',
  NUXT_CEIDG_API_TOKEN: '',
  NUXT_CEIDG_GLOBAL_HOURLY_LIMIT: '1000',
  NUXT_CEIDG_GLOBAL_MINUTE_LIMIT: '120',
  NUXT_LIVEKIT_API_KEY: 'devkey',
  NUXT_LIVEKIT_API_SECRET: 'secret',
  NUXT_PUBLIC_DATA_API_URL: 'http://127.0.0.1:55321',
  NUXT_PUBLIC_LIVEKIT_URL: 'ws://127.0.0.1:7880',
  NUXT_SMTP_HOST: '127.0.0.1',
  NUXT_SMTP_PORT: '55325',
}

function envFilePath() {
  const configured = process.env.OPENEXPERT_LOCAL_ENV_FILE
  if (!configured) return defaultEnvFile
  return isAbsolute(configured)
    ? configured
    : resolve(repositoryRoot, configured)
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {}

  const parsed = {}
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/u)) {
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
    parsed[key] = value
  }
  return parsed
}

function quoteEnvValue(value) {
  if (value.includes('\n') || value.includes('\r') || value.includes('\'')) {
    throw new Error('Local env values cannot contain newlines or single quotes')
  }
  return `'${value}'`
}

function replaceManagedEnvBlock(path, entries) {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const start = existing.indexOf(managedBlockStart)
  const end = existing.indexOf(managedBlockEnd)
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error(`Malformed managed local-stack block in ${path}`)
  }

  let unmanaged = existing
  if (start !== -1) {
    unmanaged = (
      existing.slice(0, start)
      + existing.slice(end + managedBlockEnd.length)
    )
  }
  unmanaged = unmanaged.trimEnd()

  const block = [
    managedBlockStart,
    '# Regenerated by @openexpert/database db:local:setup.',
    ...Object.entries(entries)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${quoteEnvValue(value)}`),
    managedBlockEnd,
  ].join('\n')
  const next = `${unmanaged ? `${unmanaged}\n\n` : ''}${block}\n`

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, next, { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
}

function syncApplicationEnvFiles(values) {
  const authDatabaseUrl = values.NUXT_AUTH_DATABASE_URL
  const dataApi = {
    BETTER_AUTH_COOKIE_PREFIX: values.BETTER_AUTH_COOKIE_PREFIX,
    BETTER_AUTH_SECRET: values.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: values.BETTER_AUTH_URL,
    DATABASE_URL: authDatabaseUrl,
    NUXT_AUTH_DATABASE_URL: authDatabaseUrl,
    NUXT_DATA_API_JWT_AUDIENCE: values.NUXT_DATA_API_JWT_AUDIENCE,
    NUXT_DATA_API_JWT_ISSUER: values.NUXT_DATA_API_JWT_ISSUER,
    NUXT_DATA_API_JWT_KEY_ID: values.NUXT_DATA_API_JWT_KEY_ID,
    NUXT_DATA_API_JWT_PRIVATE_KEY: values.NUXT_DATA_API_JWT_PRIVATE_KEY,
    NUXT_DATA_API_JWT_PUBLIC_JWK: values.NUXT_DATA_API_JWT_PUBLIC_JWK,
    NUXT_PUBLIC_DATA_API_URL: values.NUXT_PUBLIC_DATA_API_URL,
    NUXT_SMTP_HOST: values.NUXT_SMTP_HOST,
    NUXT_SMTP_PORT: values.NUXT_SMTP_PORT,
  }

  replaceManagedEnvBlock(resolve(repositoryRoot, 'apps/crm/.env'), {
    ...dataApi,
    NUXT_BOOKING_RATE_LIMIT_SECRET: values.NUXT_BOOKING_RATE_LIMIT_SECRET,
    NUXT_CEIDG_API_BASE_URL: values.NUXT_CEIDG_API_BASE_URL,
    NUXT_CEIDG_API_TOKEN: values.NUXT_CEIDG_API_TOKEN,
    NUXT_CEIDG_GLOBAL_HOURLY_LIMIT: values.NUXT_CEIDG_GLOBAL_HOURLY_LIMIT,
    NUXT_CEIDG_GLOBAL_MINUTE_LIMIT: values.NUXT_CEIDG_GLOBAL_MINUTE_LIMIT,
    NUXT_CLIENT_PORTAL_BASE_URL: 'http://127.0.0.1:3006',
    NUXT_PUBLIC_CLIENT_PORTAL_BASE_URL: 'http://127.0.0.1:3006',
  })
  replaceManagedEnvBlock(resolve(repositoryRoot, 'apps/client/.env'), {
    ...dataApi,
    NUXT_AUTH_BASE_URL: 'http://127.0.0.1:3006',
    NUXT_BOOKING_RATE_LIMIT_SECRET: values.NUXT_BOOKING_RATE_LIMIT_SECRET,
    NUXT_PUBLIC_CLIENT_BASE_URL: 'http://127.0.0.1:3006',
  })
  replaceManagedEnvBlock(resolve(repositoryRoot, 'apps/landing/.env'), dataApi)
  replaceManagedEnvBlock(resolve(repositoryRoot, 'apps/meetings/.env'), {
    NUXT_LIVEKIT_API_KEY: values.NUXT_LIVEKIT_API_KEY,
    NUXT_LIVEKIT_API_SECRET: values.NUXT_LIVEKIT_API_SECRET,
    NUXT_PUBLIC_LIVEKIT_URL: values.NUXT_PUBLIC_LIVEKIT_URL,
  })
}

function publicJwkFromPrivate(encodedPrivateKey, keyId) {
  let privateKey
  try {
    const pem = Buffer.from(encodedPrivateKey, 'base64').toString('utf8')
    privateKey = createPrivateKey(pem)
  }
  catch {
    throw new Error(
      'NUXT_DATA_API_JWT_PRIVATE_KEY must be a base64-encoded PKCS8 PEM',
    )
  }

  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('The local Data API private key must use Ed25519')
  }

  const publicKey = createPublicKey(privateKey)
  const exported = publicKey.export({ format: 'jwk' })
  return {
    privateKey,
    publicJwk: {
      ...exported,
      alg: 'EdDSA',
      kid: keyId,
      use: 'sig',
    },
  }
}

function createLocalKeyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const keyId = `local-${createHash('sha256')
    .update(publicDer)
    .digest('hex')
    .slice(0, 16)}`
  const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' })
  const encodedPrivateKey = Buffer.from(privatePem).toString('base64')
  const { publicJwk } = publicJwkFromPrivate(encodedPrivateKey, keyId)

  return { encodedPrivateKey, keyId, publicJwk }
}

function ensureLocalEnv() {
  const path = envFilePath()
  const existing = parseEnvFile(path)
  const values = { ...defaults, ...existing }
  values.BETTER_AUTH_SECRET ||= randomBytes(48).toString('base64url')
  values.NUXT_BOOKING_RATE_LIMIT_SECRET ||= randomBytes(32).toString('base64url')
  if (values.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters')
  }
  if (values.NUXT_BOOKING_RATE_LIMIT_SECRET.length < 32) {
    throw new Error(
      'NUXT_BOOKING_RATE_LIMIT_SECRET must contain at least 32 characters',
    )
  }
  let material

  if (values.NUXT_DATA_API_JWT_PRIVATE_KEY) {
    const provisionalKeyId = values.NUXT_DATA_API_JWT_KEY_ID || 'local-key'
    const derived = publicJwkFromPrivate(
      values.NUXT_DATA_API_JWT_PRIVATE_KEY,
      provisionalKeyId,
    )
    const publicDer = createPublicKey(derived.privateKey).export({
      format: 'der',
      type: 'spki',
    })
    const keyId = values.NUXT_DATA_API_JWT_KEY_ID
      || `local-${createHash('sha256')
        .update(publicDer)
        .digest('hex')
        .slice(0, 16)}`
    material = {
      encodedPrivateKey: values.NUXT_DATA_API_JWT_PRIVATE_KEY,
      keyId,
      publicJwk: publicJwkFromPrivate(
        values.NUXT_DATA_API_JWT_PRIVATE_KEY,
        keyId,
      ).publicJwk,
    }

    if (values.NUXT_DATA_API_JWT_PUBLIC_JWK) {
      let configuredPublicJwk
      try {
        configuredPublicJwk = JSON.parse(values.NUXT_DATA_API_JWT_PUBLIC_JWK)
      }
      catch {
        throw new Error('NUXT_DATA_API_JWT_PUBLIC_JWK must contain JSON')
      }
      if (
        configuredPublicJwk.kty !== material.publicJwk.kty
        || configuredPublicJwk.crv !== material.publicJwk.crv
        || configuredPublicJwk.x !== material.publicJwk.x
      ) {
        throw new Error(
          'The configured Data API public JWK does not match its private key',
        )
      }
    }
  }
  else {
    material = createLocalKeyMaterial()
    console.log(`Generated local Ed25519 Data API key: ${material.keyId}`)
  }

  values.NUXT_DATA_API_JWT_PRIVATE_KEY = material.encodedPrivateKey
  values.NUXT_DATA_API_JWT_PUBLIC_JWK = JSON.stringify(material.publicJwk)
  values.NUXT_DATA_API_JWT_KEY_ID = material.keyId
  values.OPENEXPERT_DATA_API_JWKS = JSON.stringify({
    keys: [material.publicJwk],
  })
  values.NUXT_PUBLIC_DATA_API_URL = `http://127.0.0.1:${values.OPENEXPERT_POSTGREST_PORT}`
  values.NUXT_PUBLIC_LIVEKIT_URL = `ws://127.0.0.1:${values.OPENEXPERT_LIVEKIT_HTTP_PORT}`
  values.NUXT_SMTP_PORT = values.OPENEXPERT_MAILPIT_SMTP_PORT
  const authDatabaseUrl = 'postgresql://openexpert_auth:'
    + `${encodeURIComponent(values.OPENEXPERT_AUTH_PASSWORD)}`
    + `@127.0.0.1:${encodeURIComponent(values.OPENEXPERT_POSTGRES_PORT)}`
    + `/${encodeURIComponent(values.OPENEXPERT_POSTGRES_DB)}`
  values.DATABASE_URL = authDatabaseUrl
  values.NUXT_AUTH_DATABASE_URL = authDatabaseUrl

  mkdirSync(dirname(path), { recursive: true })
  const lines = [
    '# Generated local development configuration. Never commit this file.',
    '# Source it before starting apps: set -a; source .env.local-stack; set +a',
    '',
    ...Object.entries(values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${quoteEnvValue(value)}`),
    '',
  ]
  writeFileSync(path, lines.join('\n'), { encoding: 'utf8', mode: 0o600 })
  chmodSync(path, 0o600)
  syncApplicationEnvFiles(values)

  return { path, values }
}

function ephemeralComposeEnv() {
  const encodedKey = Buffer.from(
    generateKeyPairSync('ed25519').privateKey.export({
      format: 'pem',
      type: 'pkcs8',
    }),
  ).toString('base64')
  const generated = publicJwkFromPrivate(encodedKey, 'ephemeral-compose')
  return {
    ...defaults,
    OPENEXPERT_DATA_API_JWKS: JSON.stringify({
      keys: [generated.publicJwk],
    }),
  }
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: options.env || process.env,
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.stdio || (options.input ? ['pipe', 'pipe', 'pipe'] : 'inherit'),
  })

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      if (options.allowFailure) {
        return {
          status: 127,
          stderr: `${executable} is not installed or is not on PATH`,
          stdout: '',
        }
      }
      throw new Error(`${executable} is not installed or is not on PATH`)
    }
    throw result.error
  }
  if (result.status !== 0 && !options.allowFailure) {
    const details = [result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
      .trim()
    throw new Error(
      `${executable} ${args.join(' ')} failed with exit ${result.status}`
      + (details ? `\n${details}` : ''),
    )
  }

  return result
}

function detectCompose(environment) {
  const plugin = run('docker', ['compose', 'version'], {
    allowFailure: true,
    env: environment,
    stdio: 'pipe',
  })
  if (plugin.status === 0) return ['docker', 'compose']

  const standalone = run('docker-compose', ['version'], {
    allowFailure: true,
    env: environment,
    stdio: 'pipe',
  })
  if (standalone.status === 0) return ['docker-compose']

  throw new Error(
    'Docker Compose v2 is required. Install/enable the Docker Compose plugin, '
    + 'then rerun this command.',
  )
}

function composeContext({ generateEnv = true, profiles = [] } = {}) {
  const local = generateEnv
    ? ensureLocalEnv()
    : {
        path: envFilePath(),
        values: {
          ...ephemeralComposeEnv(),
          ...parseEnvFile(envFilePath()),
        },
      }
  const environment = { ...process.env, ...local.values }
  const command = detectCompose(environment)
  const prefix = [
    ...command.slice(1),
    '--project-name',
    composeProject,
    '--file',
    composeFile,
    ...profiles.flatMap(profile => ['--profile', profile]),
  ]

  return {
    envPath: local.path,
    environment,
    executable: command[0],
    prefix,
    values: local.values,
  }
}

function compose(context, args, options = {}) {
  return run(
    context.executable,
    [...context.prefix, ...args],
    { ...options, env: context.environment },
  )
}

async function waitForPostgres(context, attempts = 90) {
  let consecutiveReadyChecks = 0
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = compose(
      context,
      [
        'exec',
        '--no-TTY',
        'postgres',
        'pg_isready',
        '--username',
        'postgres',
        '--dbname',
        context.values.OPENEXPERT_POSTGRES_DB,
      ],
      { allowFailure: true, stdio: 'pipe' },
    )
    if (result.status === 0) {
      consecutiveReadyChecks += 1
      // A fresh PostgreSQL volume briefly exposes the bootstrap server before
      // the entrypoint shuts it down and starts the final server. Requiring a
      // stable ready window keeps migrations out of that restart race.
      if (consecutiveReadyChecks >= 4) return
    } else {
      consecutiveReadyChecks = 0
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
  }
  throw new Error('PostgreSQL did not become ready within 45 seconds')
}

function psql(context, sql, extraArgs = []) {
  return compose(
    context,
    [
      'exec',
      '--no-TTY',
      'postgres',
      'psql',
      '--no-psqlrc',
      '--username',
      'postgres',
      '--dbname',
      context.values.OPENEXPERT_POSTGRES_DB,
      '--set',
      'ON_ERROR_STOP=1',
      ...extraArgs,
    ],
    { input: sql, stdio: ['pipe', 'pipe', 'pipe'] },
  )
}

function migrationFiles() {
  return readdirSync(migrationsDirectory)
    .filter(name => name.endsWith('.sql'))
    .filter(name => statSync(resolve(migrationsDirectory, name)).isFile())
    .sort()
}

function applyMigrations(context) {
  for (const name of migrationFiles()) {
    const path = resolve(migrationsDirectory, name)
    const sql = readFileSync(path, 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const lookup = psql(
      context,
      'SELECT checksum FROM app_migrations.schema_migrations '
      + 'WHERE name = :\'migration_name\';\n',
      [
        '--no-align',
        '--tuples-only',
        '--quiet',
        '--set',
        `migration_name=${name}`,
      ],
    ).stdout.trim()

    if (lookup) {
      if (lookup !== checksum) {
        throw new Error(
          `Migration ${name} changed after it was applied. `
          + 'Create a new migration or run the explicit local reset.',
        )
      }
      console.log(`= ${name}`)
      continue
    }

    const wrapped = [
      'BEGIN;',
      'SET LOCAL ROLE openexpert_owner;',
      sql,
      '',
      'INSERT INTO app_migrations.schema_migrations (name, checksum)',
      'VALUES (:\'migration_name\', :\'migration_checksum\');',
      'COMMIT;',
      '',
    ].join('\n')
    psql(context, wrapped, [
      '--set',
      `migration_name=${name}`,
      '--set',
      `migration_checksum=${checksum}`,
    ])
    console.log(`+ ${name}`)
  }
}

function stableUuid(value) {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

const demoPortalTimeZone = 'Europe/Warsaw'

function localDateString(date, timeZone = demoPortalTimeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function addCivilDays(localDate, days) {
  const [year, month, day] = localDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10)
}

function isWeekday(localDate) {
  const [year, month, day] = localDate.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
  return weekday >= 1 && weekday <= 5
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  )
  return representedAsUtc - Math.floor(date.valueOf() / 1_000) * 1_000
}

function zonedDateTimeIso(localDate, localTime, timeZone = demoPortalTimeZone) {
  const [year, month, day] = localDate.split('-').map(Number)
  const [hour, minute] = localTime.split(':').map(Number)
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  let offset = timeZoneOffsetMs(new Date(wallClockAsUtc), timeZone)
  let instant = wallClockAsUtc - offset
  const correctedOffset = timeZoneOffsetMs(new Date(instant), timeZone)
  if (correctedOffset !== offset) {
    offset = correctedOffset
    instant = wallClockAsUtc - offset
  }
  return new Date(instant).toISOString()
}

function demoAppointmentPeriod(localDate, localTime) {
  const startsAt = zonedDateTimeIso(localDate, localTime)
  return {
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 60 * 60 * 1_000)
      .toISOString(),
  }
}

function readBetterAuthAccount(context, email) {
  const result = psql(
    context,
    `
SELECT jsonb_build_object(
  'userId', auth_user.id,
  'email', auth_user.email,
  'emailVerified', auth_user.email_verified,
  'accountRowId', credential.id,
  'accountId', credential.account_id,
  'passwordHash', credential.password
)::text
FROM identity.users AS auth_user
LEFT JOIN LATERAL (
  SELECT account.id, account.account_id, account.password
  FROM identity.accounts AS account
  WHERE account.user_id = auth_user.id
    AND account.provider_id = 'credential'
  ORDER BY account.created_at, account.id
  LIMIT 1
) AS credential ON true
WHERE lower(auth_user.email) = lower(:'seed_email')
LIMIT 1;
`,
    [
      '--no-align',
      '--tuples-only',
      '--quiet',
      '--set',
      `seed_email=${email}`,
    ],
  ).stdout.trim()

  if (!result) return null
  try {
    return JSON.parse(result)
  }
  catch {
    throw new Error('Could not parse the local Better Auth account query')
  }
}

async function ensureBetterAuthAccount(context, account = {}) {
  const values = context.values
  const email = String(account.email ?? values.OPENEXPERT_DEV_EMAIL)
    .trim()
    .toLowerCase()
  const fullName = String(account.fullName ?? values.OPENEXPERT_DEV_FULL_NAME)
    .trim()
  const password = String(account.password ?? values.OPENEXPERT_DEV_PASSWORD)
  const organizationName = String(
    account.organizationName ?? values.OPENEXPERT_DEV_ORGANIZATION,
  ).trim()
  const organizationSlug = String(
    account.organizationSlug ?? values.OPENEXPERT_DEV_ORGANIZATION_SLUG,
  ).trim()
  const avatarUrl = String(
    account.avatarUrl ?? '/avatars/experts/local-administrator.webp',
  ).trim()
  if (!email || !email.includes('@')) {
    throw new Error('OPENEXPERT_DEV_EMAIL must contain a valid local email')
  }
  if (!fullName) throw new Error('Local Better Auth account name cannot be empty')
  if (!organizationName) {
    throw new Error('OPENEXPERT_DEV_ORGANIZATION cannot be empty')
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(organizationSlug)) {
    throw new Error(
      'OPENEXPERT_DEV_ORGANIZATION_SLUG must be a lowercase URL slug',
    )
  }
  if (!avatarUrl) throw new Error('Local Better Auth avatar URL cannot be empty')
  if (password.length < 10) {
    throw new Error(
      'Local Better Auth password must contain at least 10 characters',
    )
  }

  const existing = readBetterAuthAccount(context, email)
  const passwordStrategy = createDefaultBcryptPasswordStrategy(10)
  let hasExpectedPassword = false
  if (
    typeof existing?.passwordHash === 'string'
    && /^\$2[aby]\$10\$/u.test(existing.passwordHash)
  ) {
    try {
      hasExpectedPassword = await passwordStrategy.verify({
        hash: existing.passwordHash,
        password,
      })
    }
    catch {
      // A malformed local-only hash is repaired below just like a stale one.
    }
  }
  const passwordHash = hasExpectedPassword
    ? existing.passwordHash
    : await passwordStrategy.hash(password)
  const userId = existing?.userId
    || stableUuid(`openexpert:local-auth-user:${email}`)
  const accountRowId = existing?.accountRowId
    || stableUuid(`openexpert:local-auth-account:${userId}:credential`)

  psql(
    context,
    `
BEGIN;
SET LOCAL ROLE openexpert_owner;

INSERT INTO identity.users (
  id,
  name,
  email,
  email_verified,
  image
)
VALUES (
  :'seed_user_id'::uuid,
  :'seed_full_name',
  :'seed_email',
  true,
  :'seed_image'
)
ON CONFLICT (id) DO UPDATE
SET
  name = excluded.name,
  email = excluded.email,
  email_verified = true,
  image = excluded.image,
  updated_at = now()
WHERE (
  identity.users.name,
  identity.users.email,
  identity.users.email_verified,
  identity.users.image
) IS DISTINCT FROM (
  excluded.name,
  excluded.email,
  excluded.email_verified,
  excluded.image
);

INSERT INTO identity.accounts (
  id,
  user_id,
  account_id,
  provider_id,
  password
)
VALUES (
  :'seed_account_row_id'::uuid,
  :'seed_user_id'::uuid,
  :'seed_user_id',
  'credential',
  :'seed_password_hash'
)
ON CONFLICT (id) DO UPDATE
SET
  user_id = excluded.user_id,
  account_id = excluded.account_id,
  provider_id = excluded.provider_id,
  password = excluded.password,
  updated_at = now()
WHERE (
  identity.accounts.user_id,
  identity.accounts.account_id,
  identity.accounts.provider_id,
  identity.accounts.password
) IS DISTINCT FROM (
  excluded.user_id,
  excluded.account_id,
  excluded.provider_id,
  excluded.password
);

COMMIT;
`,
    [
      '--set',
      `seed_user_id=${userId}`,
      '--set',
      `seed_account_row_id=${accountRowId}`,
      '--set',
      `seed_email=${email}`,
      '--set',
      `seed_full_name=${fullName}`,
      '--set',
      `seed_image=${avatarUrl}`,
      '--set',
      `seed_organization_name=${organizationName}`,
      '--set',
      `seed_password_hash=${passwordHash}`,
    ],
  )

  const seeded = readBetterAuthAccount(context, email)
  if (
    !seeded
    || seeded.userId !== userId
    || seeded.accountId !== userId
    || seeded.emailVerified !== true
    || !seeded.passwordHash
    || !/^\$2[aby]\$10\$/u.test(seeded.passwordHash)
    || !await passwordStrategy.verify({
      hash: seeded.passwordHash,
      password,
    })
  ) {
    throw new Error('The local Better Auth credential account failed verification')
  }

  return {
    email,
    fullName,
    organizationName,
    organizationSlug,
    password,
    userId,
  }
}

function createToken(values, userId, role = 'authenticated') {
  const { privateKey } = publicJwkFromPrivate(
    values.NUXT_DATA_API_JWT_PRIVATE_KEY,
    values.NUXT_DATA_API_JWT_KEY_ID,
  )
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({
    alg: 'EdDSA',
    kid: values.NUXT_DATA_API_JWT_KEY_ID,
    typ: 'JWT',
  })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    aud: values.NUXT_DATA_API_JWT_AUDIENCE,
    exp: issuedAt + 60,
    iat: issuedAt,
    iss: values.NUXT_DATA_API_JWT_ISSUER,
    role,
    ...(role === 'authenticated' ? { sub: userId } : {}),
  })).toString('base64url')
  const input = `${header}.${payload}`
  const signature = sign(
    null,
    Buffer.from(input, 'ascii'),
    privateKey,
  ).toString('base64url')
  return `${input}.${signature}`
}

function dataApiClient(values, token) {
  const tokenProvider = typeof token === 'function' ? token : () => token
  return createAuthenticatedDataApiClient(
    values.NUXT_PUBLIC_DATA_API_URL,
    tokenProvider,
    {
      headers: {
        'x-client-info': 'openexpert-local-seed/1.0',
      },
      retry: false,
    },
  )
}

function assertDataApiResult(result, operation) {
  if (!result.error) return result.data
  const detail = result.error.message
    || result.error.details
    || JSON.stringify(result.error)
  throw new Error(`${operation}: ${detail}`)
}

async function readWorkforceProfile(client, userId) {
  return assertDataApiResult(
    await client
      .from('users')
      .select('id, organization_id, email, role, full_name')
      .eq('id', userId)
      .maybeSingle(),
    'Reading the local workforce profile',
  )
}

async function ensureLocalDemoAccount(context) {
  const account = await ensureBetterAuthAccount(context)
  const userToken = createToken(context.values, account.userId)
  const userClient = dataApiClient(context.values, userToken)
  let profile = await readWorkforceProfile(userClient, account.userId)

  if (!profile) {
    // Local bootstrap is an owner-controlled provisioning operation, not a
    // user-facing organization-creation grant. The public legacy RPC is
    // intentionally unavailable to authenticated users.
    psql(
      context,
      `
BEGIN;
SET LOCAL ROLE openexpert_owner;
SELECT private.create_organization_for_identity(
  :'seed_user_id'::uuid,
  :'seed_organization_name',
  :'seed_full_name',
  'intermediary'
);
COMMIT;
`,
      [
        '--set',
        `seed_user_id=${account.userId}`,
        '--set',
        `seed_organization_name=${account.organizationName}`,
        '--set',
        `seed_full_name=${account.fullName}`,
      ],
    )
    profile = await readWorkforceProfile(userClient, account.userId)
  }

  if (
    !profile
    || profile.role !== 'admin'
    || !profile.organization_id
  ) {
    throw new Error(
      'The local Better Auth account has no admin organization profile',
    )
  }

  const backendToken = createToken(
    context.values,
    account.userId,
    'openexpert_service',
  )
  const backendClient = dataApiClient(context.values, backendToken)
  const organization = assertDataApiResult(
    await backendClient
      .from('organizations')
      .update({
        name: account.organizationName,
        slug: account.organizationSlug,
      })
      .eq('id', profile.organization_id)
      .select('id, name, slug')
      .single(),
    'Stabilizing the local organization route',
  )
  assertDataApiResult(
    await backendClient
      .from('users')
      .update({
        email: account.email,
        full_name: account.fullName,
        avatar_url: '/avatars/experts/local-administrator.webp',
      })
      .eq('id', account.userId),
    'Stabilizing the local administrator profile',
  )
  assertDataApiResult(
    await backendClient
      .from('profiles')
      .upsert({
        id: account.userId,
        display_name: account.fullName,
        locale: 'pl-PL',
      }, { onConflict: 'id' }),
    'Stabilizing the shared local profile',
  )
  assertDataApiResult(
    await backendClient
      .from('platform_user_roles')
      .upsert({
        user_id: account.userId,
        role: 'super_admin',
      }, { onConflict: 'user_id,role' }),
    'Assigning the local SuperAdmin role',
  )
  assertDataApiResult(
    await backendClient
      .from('organization_user_admin_roles')
      .upsert({
        organization_id: organization.id,
        user_id: account.userId,
        role_key: 'consents_admin',
        assigned_by_user_id: account.userId,
        reason: 'Local demo account for consent compliance administration.',
      }, { onConflict: 'organization_id,user_id,role_key' }),
    'Assigning the local consent administrator role',
  )

  const membership = assertDataApiResult(
    await userClient
      .from('organization_memberships')
      .select('organization_id, user_id, role')
      .eq('organization_id', profile.organization_id)
      .eq('user_id', account.userId)
      .single(),
    'Verifying the local organization membership through RLS',
  )
  if (membership.role !== 'admin') {
    throw new Error('The local organization membership is not an admin role')
  }

  return { account, organization }
}

async function ensureDemoDelegateAccounts(context, organizationId) {
  const delegateByKey = new Map()

  for (const account of demoDelegateAccounts) {
    const identity = await ensureBetterAuthAccount(context, account)
    psql(
      context,
      `
BEGIN;
SET LOCAL ROLE openexpert_owner;

INSERT INTO public.users (
  id,
  organization_id,
  email,
  role,
  full_name,
  avatar_url
)
VALUES (
  :'seed_user_id'::uuid,
  :'seed_organization_id'::uuid,
  :'seed_email',
  'expert',
  :'seed_full_name',
  :'seed_avatar_url'
)
ON CONFLICT (id) DO UPDATE
SET
  organization_id = excluded.organization_id,
  email = excluded.email,
  role = 'expert',
  full_name = excluded.full_name,
  avatar_url = excluded.avatar_url;

INSERT INTO public.organization_memberships (
  organization_id,
  user_id,
  role
)
VALUES (
  :'seed_organization_id'::uuid,
  :'seed_user_id'::uuid,
  'expert'
)
ON CONFLICT (organization_id, user_id) DO UPDATE
SET role = 'expert', updated_at = now();

INSERT INTO public.organization_user_access_states (
  organization_id,
  user_id
)
VALUES (
  :'seed_organization_id'::uuid,
  :'seed_user_id'::uuid
)
ON CONFLICT (organization_id, user_id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, locale)
VALUES (:'seed_user_id'::uuid, :'seed_full_name', 'pl-PL')
ON CONFLICT (id) DO UPDATE
SET display_name = excluded.display_name, locale = excluded.locale;

COMMIT;
`,
      [
        '--set',
        `seed_user_id=${identity.userId}`,
        '--set',
        `seed_organization_id=${organizationId}`,
        '--set',
        `seed_email=${identity.email}`,
        '--set',
        `seed_full_name=${identity.fullName}`,
        '--set',
        `seed_avatar_url=${account.avatarUrl}`,
      ],
    )

    delegateByKey.set(account.key, {
      id: identity.userId,
      email: identity.email,
      fullName: identity.fullName,
      specialty: account.specialty,
      avatarUrl: account.avatarUrl,
    })
  }

  return delegateByKey
}

async function ensureDemoClientPortalAccess({
  backendClient,
  organizationId,
  ownerUserId,
  identity,
  crm,
  seedNow,
}) {
  const client = crm.clients.find(candidate => (
    candidate.primary_email === identity.email
  ))
  const targetCase = crm.cases.find(candidate => (
    candidate.metadata?.demo_seed_key === 'case-mortgage-warszewo'
  ))
  const clientPersonId = String(client?.primaryPerson?.id ?? '')
  if (!client?.id || !clientPersonId || !targetCase?.id) {
    throw new Error(
      'The client portal seed is missing Jan Kowalski or the Warszewo case',
    )
  }

  const verifiedAt = new Date(seedNow.getTime() - 3 * 24 * 60 * 60 * 1_000)
    .toISOString()
  const multiformEnabledAt = new Date(
    seedNow.getTime() - 24 * 60 * 60 * 1_000,
  ).toISOString()

  const existingLinks = assertDataApiResult(
    await backendClient
      .from('client_account_links')
      .select('auth_user_id, organization_id, client_id, client_person_id, verification_method, verified_contact_normalized, verified_at, revoked_at')
      .eq('organization_id', organizationId)
      .eq('client_person_id', clientPersonId),
    'Reading the local client portal account link',
  ) ?? []
  if (existingLinks.some(link => (
    !link.revoked_at && String(link.auth_user_id) !== identity.userId
  ))) {
    throw new Error(
      'Jan Kowalski is already linked to another active local portal identity',
    )
  }

  let accountLink = existingLinks.find(link => (
    String(link.auth_user_id) === identity.userId
  )) ?? null
  if (accountLink && !accountLink.revoked_at && (
    String(accountLink.client_id) !== String(client.id)
    || accountLink.verification_method !== 'email'
    || accountLink.verified_contact_normalized !== identity.email
  )) {
    throw new Error('The active local client portal account link is inconsistent')
  }
  if (!accountLink) {
    accountLink = assertDataApiResult(
      await backendClient
        .from('client_account_links')
        .insert({
          auth_user_id: identity.userId,
          organization_id: organizationId,
          client_id: client.id,
          client_person_id: clientPersonId,
          source_appointment_id: null,
          verification_method: 'email',
          verified_contact_normalized: identity.email,
          verified_at: verifiedAt,
          revoked_at: null,
        })
        .select('auth_user_id, organization_id, client_id, client_person_id, verification_method, verified_contact_normalized, verified_at, revoked_at')
        .single(),
      'Seeding the local client portal account link',
    )
  }

  let grant = assertDataApiResult(
    await backendClient
      .from('client_portal_case_grants')
      .select('organization_id, case_id, client_id, client_person_id, portal_enabled, multiform_enabled, portal_enabled_at, multiform_enabled_at, revoked_at, revision')
      .eq('organization_id', organizationId)
      .eq('case_id', targetCase.id)
      .eq('client_person_id', clientPersonId)
      .maybeSingle(),
    'Reading the local client portal case grant',
  )
  if (!grant && !accountLink.revoked_at) {
    grant = assertDataApiResult(
      await backendClient
        .from('client_portal_case_grants')
        .insert({
          organization_id: organizationId,
          case_id: targetCase.id,
          client_id: client.id,
          client_person_id: clientPersonId,
          portal_enabled: true,
          multiform_enabled: true,
          granted_by_user_id: ownerUserId,
          portal_enabled_at: verifiedAt,
          multiform_enabled_at: multiformEnabledAt,
          revoked_at: null,
          revision: 1,
        })
        .select('organization_id, case_id, client_id, client_person_id, portal_enabled, multiform_enabled, portal_enabled_at, multiform_enabled_at, revoked_at, revision')
        .single(),
      'Seeding the local client portal case grant',
    )
  }

  return {
    accountLink,
    grant,
    caseId: String(targetCase.id),
    caseTitle: targetCase.title,
    clientId: String(client.id),
    clientPersonId,
    expertUserId: String(targetCase.owner_user_id ?? ownerUserId),
    accessActive: Boolean(
      !accountLink.revoked_at
      && grant?.portal_enabled
      && grant?.multiform_enabled
      && !grant?.revoked_at,
    ),
  }
}

async function insertDemoRowIfMissing({
  backendClient,
  table,
  filters,
  values,
  select,
  operation,
}) {
  let query = backendClient.from(table).select(select)
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value)
  }
  const existing = assertDataApiResult(
    await query.maybeSingle(),
    `Reading ${operation}`,
  )
  if (existing) return existing
  return assertDataApiResult(
    await backendClient
      .from(table)
      .insert(values)
      .select(select)
      .single(),
    `Creating ${operation}`,
  )
}

async function findAvailableDemoAppointmentPeriod({
  backendClient,
  expertUserId,
  seedNow,
}) {
  const localTimes = ['10:00', '11:30', '13:00', '14:30']
  const localToday = localDateString(seedNow)
  for (let dayOffset = 1; dayOffset <= 45; dayOffset += 1) {
    const localDate = addCivilDays(localToday, dayOffset)
    if (!isWeekday(localDate)) continue

    for (const localTime of localTimes) {
      const period = demoAppointmentPeriod(localDate, localTime)
      const conflicts = assertDataApiResult(
        await backendClient
          .from('appointment_resource_reservations')
          .select('id')
          .eq('resource_type', 'expert')
          .eq('resource_id', expertUserId)
          .in('status', ['hold', 'confirmed'])
          .overlaps(
            'busy_period',
            `[${period.startsAt},${period.endsAt})`,
          )
          .limit(1),
        'Checking the local client portal expert availability',
      ) ?? []
      if (!conflicts.length) return period
    }
  }
  throw new Error(
    'No free local client portal appointment was found in the next 45 days',
  )
}

async function ensureDemoPortalAppointment({
  backendClient,
  organizationId,
  ownerUserId,
  identity,
  portalAccess,
  seedNow,
}) {
  const facilityId = stableUuid('openexpert:local-demo:facility:szczecin')
  const serviceId = stableUuid('openexpert:local-demo:service:case-consultation')
  const fixtureKey = 'jan-kowalski-next-appointment'

  const facility = await insertDemoRowIfMissing({
    backendClient,
    table: 'facilities',
    filters: { id: facilityId },
    values: {
      id: facilityId,
      organization_id: organizationId,
      name: 'OpenExpert Szczecin',
      slug: 'openexpert-szczecin',
      description: 'Lokalne biuro demonstracyjne OpenExpert.',
      timezone: demoPortalTimeZone,
      address_line1: 'al. Piastów 30',
      address_line2: null,
      postal_code: '70-064',
      city: 'Szczecin',
      country_code: 'PL',
      phone: null,
      email: null,
      is_active: true,
    },
    select: [
      'id',
      'organization_id',
      'name',
      'city',
      'address_line1',
      'address_line2',
      'postal_code',
    ].join(', '),
    operation: 'the local client portal facility',
  })
  if (String(facility.organization_id) !== organizationId) {
    throw new Error(
      'The local client portal facility belongs to another organization',
    )
  }

  await insertDemoRowIfMissing({
    backendClient,
    table: 'facility_memberships',
    filters: {
      organization_id: organizationId,
      facility_id: facilityId,
      user_id: portalAccess.expertUserId,
    },
    values: {
      organization_id: organizationId,
      facility_id: facilityId,
      user_id: portalAccess.expertUserId,
      role: 'admin',
      is_bookable: true,
      booking_priority: 100,
    },
    select: 'organization_id, facility_id, user_id, role, is_bookable',
    operation: 'the local client portal expert facility membership',
  })

  const service = await insertDemoRowIfMissing({
    backendClient,
    table: 'booking_services',
    filters: { id: serviceId },
    values: {
      id: serviceId,
      organization_id: organizationId,
      name: 'Konsultacja kredytowa',
      slug: 'konsultacja-kredytowa-portal-demo',
      description: [
        'Omówienie dokumentów i kolejnych kroków',
        'w sprawie kredytowej.',
      ].join(' '),
      duration_minutes: 60,
      buffer_before_minutes: 0,
      buffer_after_minutes: 0,
      slot_interval_minutes: 15,
      min_notice_minutes: 60,
      max_advance_days: 90,
      is_active: true,
    },
    select: 'id, organization_id, name, duration_minutes',
    operation: 'the local client portal booking service',
  })
  if (String(service.organization_id) !== organizationId) {
    throw new Error('The local client portal service belongs to another organization')
  }

  await insertDemoRowIfMissing({
    backendClient,
    table: 'facility_services',
    filters: {
      organization_id: organizationId,
      facility_id: facilityId,
      service_id: serviceId,
    },
    values: {
      organization_id: organizationId,
      facility_id: facilityId,
      service_id: serviceId,
      is_active: true,
    },
    select: 'organization_id, facility_id, service_id, is_active',
    operation: 'the local client portal facility service',
  })

  await insertDemoRowIfMissing({
    backendClient,
    table: 'facility_service_experts',
    filters: {
      organization_id: organizationId,
      facility_id: facilityId,
      service_id: serviceId,
      user_id: portalAccess.expertUserId,
    },
    values: {
      organization_id: organizationId,
      facility_id: facilityId,
      service_id: serviceId,
      user_id: portalAccess.expertUserId,
      is_active: true,
    },
    select: 'organization_id, facility_id, service_id, user_id, is_active',
    operation: 'the local client portal facility service expert',
  })

  const appointmentSelect = [
    'id',
    'organization_id',
    'facility_id',
    'service_id',
    'expert_user_id',
    'client_id',
    'client_person_id',
    'starts_at',
    'ends_at',
    'status',
    'customer_email',
    'booking_context',
  ].join(', ')
  const fixtureAppointments = assertDataApiResult(
    await backendClient
      .from('appointments')
      .select(appointmentSelect)
      .eq('organization_id', organizationId)
      .contains('booking_context', {
        demo_seed_namespace: 'openexpert-local-demo',
        demo_seed_key: fixtureKey,
      })
      .order('starts_at', { ascending: true }),
    'Reading the local client portal appointments',
  ) ?? []
  const futureAppointments = fixtureAppointments.filter(appointment => (
    Date.parse(String(appointment.ends_at)) >= seedNow.getTime()
  ))
  if (futureAppointments.length > 1) {
    throw new Error(
      'The local client portal seed has more than one future appointment',
    )
  }
  let appointment = futureAppointments[0] ?? null
  if (!appointment) {
    const { startsAt, endsAt } = await findAvailableDemoAppointmentPeriod({
      backendClient,
      expertUserId: portalAccess.expertUserId,
      seedNow,
    })
    const appointmentId = stableUuid(
      `openexpert:local-demo:appointment:jan-kowalski:${startsAt}`,
    )
    const manageToken = stableUuid(
      `openexpert:local-demo:appointment:jan-kowalski:${startsAt}:manage`,
    )
    appointment = assertDataApiResult(
      await backendClient
        .from('appointments')
        .insert({
          id: appointmentId,
          organization_id: organizationId,
          facility_id: facilityId,
          service_id: serviceId,
          expert_user_id: portalAccess.expertUserId,
          widget_id: null,
          starts_at: startsAt,
          ends_at: endsAt,
          timezone: demoPortalTimeZone,
          status: 'confirmed',
          hold_expires_at: null,
          confirmed_at: new Date(seedNow.getTime() - 60 * 60 * 1_000)
            .toISOString(),
          cancelled_at: null,
          cancellation_reason: null,
          customer_name: identity.fullName,
          customer_email: identity.email,
          customer_phone: null,
          notes: 'Omówienie dokumentów i kolejnych kroków w sprawie.',
          source: 'staff',
          idempotency_key: `demo-portal:jan-kowalski:${startsAt}`,
          manage_token: manageToken,
          created_by_user_id: ownerUserId,
          client_id: portalAccess.clientId,
          client_person_id: portalAccess.clientPersonId,
          booking_context: {
            demo_seed_namespace: 'openexpert-local-demo',
            demo_seed_key: fixtureKey,
            case_id: portalAccess.caseId,
          },
          request_fingerprint: null,
          meeting_mode: 'office',
          meeting_url: null,
        })
        .select(appointmentSelect)
        .single(),
      'Creating the local client portal appointment',
    )
  }
  else {
    const isExpectedFixture = (
      String(appointment.organization_id) === organizationId
      && String(appointment.facility_id) === facilityId
      && String(appointment.service_id) === serviceId
      && String(appointment.expert_user_id) === portalAccess.expertUserId
      && String(appointment.client_id) === portalAccess.clientId
      && String(appointment.client_person_id) === portalAccess.clientPersonId
      && appointment.customer_email === identity.email
      && appointment.booking_context?.demo_seed_key === fixtureKey
    )
    if (!isExpectedFixture) {
      throw new Error(
        'The local client portal appointment fixture is inconsistent',
      )
    }
  }

  return { appointment, facility, service }
}

async function seedLocalDemo(context) {
  const result = await ensureLocalDemoAccount(context)
  psql(
    context,
    `
BEGIN;
SET LOCAL ROLE openexpert_owner;
SELECT private.provision_default_crm_consents(:'seed_organization_id'::uuid);
COMMIT;
`,
    [
      '--set',
      `seed_organization_id=${result.organization.id}`,
    ],
  )
  const delegateByKey = await ensureDemoDelegateAccounts(
    context,
    result.organization.id,
  )
  await syncMortgageCatalog(
    createLocalMortgageCatalogClient(context.values),
    { offline: true },
  )

  const userClient = dataApiClient(
    context.values,
    () => createToken(context.values, result.account.userId),
  )
  const backendClient = dataApiClient(
    context.values,
    () => createToken(context.values, result.account.userId, 'openexpert_service'),
  )
  const clientPortalIdentity = await ensureBetterAuthAccount(
    context,
    demoClientPortalAccount,
  )
  const seedNow = new Date()
  const crm = await seedDemoCrm({
    adminClient: backendClient,
    userClient,
    profile: {
      id: result.account.userId,
      organization_id: result.organization.id,
      email: result.account.email,
      full_name: result.account.fullName,
    },
    delegateByKey,
    seedNow,
  })
  if (crm.clients.length !== 9 || crm.cases.length !== 8) {
    throw new Error(
      `The local CRM seed is incomplete: ${crm.clients.length} clients / ${crm.cases.length} cases`,
    )
  }
  const clientPortal = await ensureDemoClientPortalAccess({
    backendClient,
    organizationId: result.organization.id,
    ownerUserId: result.account.userId,
    identity: clientPortalIdentity,
    crm,
    seedNow,
  })
  const clientPortalAppointment = await ensureDemoPortalAppointment({
    backendClient,
    organizationId: result.organization.id,
    ownerUserId: result.account.userId,
    identity: clientPortalIdentity,
    portalAccess: clientPortal,
    seedNow,
  })

  console.log('')
  console.log('OpenExpert local demo workspace is ready:')
  console.log('  CRM:      http://127.0.0.1:3004/login')
  console.log(`  Email:    ${result.account.email}`)
  console.log(`  Password: ${result.account.password}`)
  console.log(
    `  Org:      ${result.organization.name} (${result.organization.slug})`,
  )
  console.log(`  CRM data: ${crm.clients.length} clients / ${crm.cases.length} cases`)
  console.log(`  Experts:  ${delegateByKey.size} delegated-task accounts`)
  console.log('')
  console.log('Client portal demo account:')
  console.log('  Portal:   http://127.0.0.1:3006/login')
  console.log(`  Email:    ${clientPortalIdentity.email}`)
  console.log(`  Password: ${clientPortalIdentity.password}`)
  console.log(`  Case:     ${clientPortal.caseTitle}`)
  console.log(`  Access:   ${clientPortal.accessActive ? 'active' : 'preserved as disabled'}`)
  console.log(
    `  Meeting:  ${clientPortalAppointment.appointment.starts_at}`
    + ` (${clientPortalAppointment.appointment.status})`,
  )
  return {
    ...result,
    crm,
    delegates: [...delegateByKey.values()],
    clientPortal: {
      ...clientPortal,
      account: clientPortalIdentity,
      appointment: clientPortalAppointment,
    },
  }
}

async function waitForDataApi(context, attempts = 90) {
  const baseUrl = context.values.NUXT_PUBLIC_DATA_API_URL
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(baseUrl, { redirect: 'error' })
      if (response.ok) return
      lastError = new Error(`HTTP ${response.status}`)
    }
    catch (error) {
      lastError = error
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
  }

  throw new Error(
    `PostgREST did not become ready at ${baseUrl}: ${lastError?.message || 'unknown error'}`,
  )
}

async function verify(context) {
  const smokeSql = readFileSync(smokeFile, 'utf8')
  const sqlResult = psql(context, smokeSql)
  if (sqlResult.stdout.trim()) process.stdout.write(sqlResult.stdout)

  await waitForDataApi(context)
  const smokeUserId = '11111111-1111-4111-8111-111111111111'
  const token = createToken(context.values, smokeUserId)
  const url = new URL('/profiles?select=id&limit=0', context.values.NUXT_PUBLIC_DATA_API_URL)
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    redirect: 'error',
  })
  if (!response.ok) {
    throw new Error(
      `Ed25519 PostgREST smoke failed with HTTP ${response.status}: `
      + await response.text(),
    )
  }
  console.log('ok PostgREST accepted an Ed25519 authenticated JWT')
}

function selectedProfiles(command, argumentsList) {
  if (!['seed-demo', 'setup', 'start'].includes(command)) return []

  const unknownOptions = argumentsList.filter(
    argument => argument.startsWith('--')
      && argument !== '--'
      && argument !== '--livekit',
  )
  if (unknownOptions.length > 0) {
    throw new Error(
      `Unsupported local-stack option: ${unknownOptions.join(', ')}. `
      + 'Background tasks run separately with `pnpm trigger:dev`.',
    )
  }
  const profiles = []
  if (argumentsList.includes('--livekit')) profiles.push('livekit')
  return profiles
}

async function startStack({ profiles, seed, smoke }) {
  const context = composeContext({ profiles })
  console.log(`Local environment: ${context.envPath}`)
  compose(context, [
    'up',
    '--detach',
    'postgres',
    'mailpit',
  ])
  await waitForPostgres(context)
  applyMigrations(context)
  compose(context, ['up', '--detach', '--force-recreate', 'postgrest'])

  for (const profile of profiles) {
    compose(context, ['up', '--detach', profile])
  }

  await waitForDataApi(context)
  if (seed) await seedLocalDemo(context)
  if (smoke) await verify(context)

  console.log('')
  console.log(`Data API: ${context.values.NUXT_PUBLIC_DATA_API_URL}`)
  console.log(
    `PostgreSQL: postgresql://openexpert_runtime@127.0.0.1:${context.values.OPENEXPERT_POSTGRES_PORT}/${context.values.OPENEXPERT_POSTGRES_DB}`,
  )
  console.log(
    `Mailpit: http://127.0.0.1:${context.values.OPENEXPERT_MAILPIT_UI_PORT}`,
  )
  if (!seed) {
    console.log(
      'Demo workspace: run db:local:seed-demo to create or repair it.',
    )
  }
}

async function confirmReset(skipConfirmation) {
  console.warn(
    `DESTRUCTIVE: this deletes only Docker volume ${postgresVolume}.`,
  )
  if (skipConfirmation) return
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Reset requires an interactive terminal or explicit --yes')
  }

  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  const answer = await prompt.question(`Type ${postgresVolume} to continue: `)
  prompt.close()
  if (answer !== postgresVolume) throw new Error('Reset cancelled')
}

function removePostgresVolume(context) {
  const inspect = run(
    'docker',
    ['volume', 'inspect', postgresVolume, '--format', '{{json .Labels}}'],
    {
      allowFailure: true,
      env: context.environment,
      stdio: 'pipe',
    },
  )
  if (inspect.status !== 0) {
    console.log(`Volume ${postgresVolume} does not exist; nothing to delete.`)
    return
  }

  let labels
  try {
    labels = JSON.parse(inspect.stdout.trim())
  }
  catch {
    throw new Error(`Could not validate labels for ${postgresVolume}`)
  }
  if (
    labels?.['com.docker.compose.project'] !== composeProject
    || labels?.['com.docker.compose.volume'] !== 'postgres-data'
  ) {
    throw new Error(
      `Refusing to remove ${postgresVolume}: Docker Compose labels do not match`,
    )
  }

  run('docker', ['volume', 'rm', postgresVolume], {
    env: context.environment,
  })
}

function usage() {
  console.log(`Usage: node packages/database/scripts/local-postgres.mjs <command> [options]

Commands:
  setup [--livekit]               Start, migrate, seed demo workspace, and verify
  start [--livekit]               Start and apply pending migrations
  seed-demo                       Idempotently seed Better Auth and demo CRM data
  provision-account               Create or repair the configured local admin account
  migrate                         Apply checksum-tracked SQL migrations
  verify                          Run SQL RLS and Ed25519 PostgREST smoke tests
  status                          Show Docker Compose service status
  stop                            Stop services, preserving all named volumes
  reset [--yes]                   Delete only the PostgreSQL named volume
  env                             Generate/validate .env.local-stack and keys
  token [user-uuid]               Print a 60-second local authenticated JWT
`)
}

async function main() {
  const [command, ...argumentsList] = process.argv.slice(2)
  const profiles = selectedProfiles(command, argumentsList)

  switch (command) {
    case 'setup':
      await startStack({ profiles, seed: true, smoke: true })
      break
    case 'start':
      await startStack({ profiles, seed: false, smoke: false })
      break
    case 'seed-demo':
      await startStack({ profiles, seed: true, smoke: false })
      break
    case 'provision-account': {
      const context = composeContext({ generateEnv: false })
      const result = await ensureLocalDemoAccount(context)
      console.log('')
      console.log('OpenExpert local administrator is ready:')
      console.log('  CRM:      http://127.0.0.1:3004/login')
      console.log(`  Email:    ${result.account.email}`)
      console.log(`  Password: ${result.account.password}`)
      console.log(`  Org:      ${result.organization.name} (${result.organization.slug})`)
      console.log('')
      break
    }
    case 'migrate': {
      const context = composeContext()
      compose(context, ['up', '--detach', 'postgres'])
      await waitForPostgres(context)
      applyMigrations(context)
      compose(context, ['up', '--detach', '--force-recreate', 'postgrest'])
      await waitForDataApi(context)
      break
    }
    case 'verify': {
      const context = composeContext()
      await verify(context)
      break
    }
    case 'status': {
      const context = composeContext({ generateEnv: false })
      compose(context, ['ps', '--all'])
      break
    }
    case 'stop': {
      const context = composeContext({ generateEnv: false })
      compose(context, ['down', '--remove-orphans'])
      console.log('Stopped services; named volumes were preserved.')
      break
    }
    case 'reset': {
      await confirmReset(argumentsList.includes('--yes'))
      const context = composeContext({ generateEnv: false })
      compose(context, ['down', '--remove-orphans'])
      removePostgresVolume(context)
      await startStack({ profiles, seed: true, smoke: true })
      break
    }
    case 'env': {
      const local = ensureLocalEnv()
      console.log(`Local environment is ready: ${local.path}`)
      break
    }
    case 'token': {
      const local = ensureLocalEnv()
      const userId = argumentsList.find(argument => !argument.startsWith('--'))
        || '11111111-1111-4111-8111-111111111111'
      console.log(createToken(local.values, userId))
      break
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      usage()
      break
    default:
      usage()
      throw new Error(`Unknown command: ${command}`)
  }
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`local-postgres: ${error.message}`)
    process.exitCode = 1
  })
}

export {
  createToken,
  ensureBetterAuthAccount,
  ensureLocalDemoAccount,
  seedLocalDemo,
}
