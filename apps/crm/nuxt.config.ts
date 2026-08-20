// https://nuxt.com/docs/api/configuration/nuxt-config
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const isProduction = process.env.NODE_ENV === 'production'
const multiformServiceUrl = process.env.NUXT_MULTIFORM_SERVICE_URL
  || process.env.NUXT_PUBLIC_MULTIFORM_EVE_URL?.replace(/\/multiform-eve\/?$/u, '')
  || (isProduction ? 'https://openexpert-landing.vercel.app' : 'http://127.0.0.1:3013')
const bankMailAgentServiceUrl = process.env.NUXT_BANK_MAIL_AGENT_SERVICE_URL
  || (isProduction ? '' : 'http://127.0.0.1:3014')
const storageProvider = process.env.NUXT_STORAGE_PROVIDER
  || (process.env.VERCEL ? 'vercel-blob' : 'minio')
const dataApiUrl = process.env.NUXT_DATA_API_URL
  || process.env.NUXT_PUBLIC_DATA_API_URL
  || 'http://127.0.0.1:55321'
const authBaseUrl = process.env.BETTER_AUTH_URL
  || process.env.NUXT_AUTH_BASE_URL
  || (process.env.NODE_ENV === 'production'
    ? 'https://crm.openexpert.app'
    : 'http://127.0.0.1:3004')
const clientPortalBaseUrl = process.env.NUXT_PUBLIC_CLIENT_BASE_URL
  || process.env.NUXT_PUBLIC_CLIENT_PORTAL_BASE_URL
  || process.env.NUXT_CLIENT_PORTAL_BASE_URL
  || (process.env.NODE_ENV === 'production'
    ? 'https://client.openexpert.app'
    : 'http://127.0.0.1:3006')
const authDatabaseUrl = process.env.NUXT_AUTH_DATABASE_URL
  || (isProduction
    ? ''
    : process.env.DATABASE_URL
      || 'postgresql://openexpert_auth:openexpert-auth-local@127.0.0.1:55322/openexpert')
const authIpAddressHeaders = process.env.BETTER_AUTH_IP_ADDRESS_HEADERS
  || (process.env.VERCEL ? 'x-vercel-forwarded-for' : '')
const authSmsProvider = process.env.NUXT_AUTH_SMS_PROVIDER
  || process.env.NUXT_CONSENT_SMS_PROVIDER
  || (process.env.NODE_ENV === 'production' ? 'http' : 'local')
const authSmsGatewayUrl = process.env.NUXT_AUTH_SMS_GATEWAY_URL
  || process.env.NUXT_CONSENT_SMS_GATEWAY_URL
  || ''
const authSmsGatewayToken = process.env.NUXT_AUTH_SMS_GATEWAY_TOKEN
  || process.env.NUXT_CONSENT_SMS_GATEWAY_TOKEN
  || ''
const authPhoneEnabled = process.env.NUXT_AUTH_PHONE_ENABLED
  ? process.env.NUXT_AUTH_PHONE_ENABLED === 'true'
  : process.env.NODE_ENV !== 'production'
    || Boolean(authSmsGatewayUrl && authSmsGatewayToken)
const authPasskeyEnabled = process.env.NUXT_AUTH_PASSKEY_ENABLED !== 'false'
const authPasskeyOrigin = authBaseUrl.replace(/\/$/u, '')
const authPasskeyRpId = process.env.NUXT_AUTH_PASSKEY_RP_ID
  || new URL(authPasskeyOrigin).hostname
const resendApiKey = process.env.NUXT_RESEND_API_KEY || ''
const eveSharedDirectoryUrl = new URL('./node_modules/eve/dist/src/shared/', import.meta.url)
const eveSharedAliases = Object.fromEntries(
  readdirSync(eveSharedDirectoryUrl, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => [
      `#shared/${entry.name}`,
      fileURLToPath(new URL(entry.name, eveSharedDirectoryUrl)),
    ]),
)
const mockBankEnabled = process.env.NUXT_MOCK_BANK_ENABLED
  ? process.env.NUXT_MOCK_BANK_ENABLED === 'true'
  : !isProduction
const mockBankOrganizationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const mockBankOrganizationIds = Array.from(new Set(
  (process.env.NUXT_MOCK_BANK_ORGANIZATION_IDS || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean),
))
if (mockBankOrganizationIds.some(value => !mockBankOrganizationIdPattern.test(value))) {
  throw new Error('NUXT_MOCK_BANK_ORGANIZATION_IDS must be a comma-separated list of UUIDs')
}

export default defineNuxtConfig({
  buildDir: process.env.NUXT_BUILD_DIR || '.nuxt',
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  typescript: {
    tsConfig: {
      compilerOptions: {
        allowImportingTsExtensions: true,
      },
    },
    sharedTsConfig: {
      compilerOptions: {
        allowImportingTsExtensions: true,
      },
    },
  },
  vite: {
    server: {
      hmr: false,
    },
  },
  hooks: {
    close() {
      if (process.env.VERCEL === '1') {
        setTimeout(() => process.exit(0), 0)
      }
    },
    'vite:extendConfig'(config) {
      const mutableConfig = config as typeof config & { server?: { hmr?: boolean } }
      mutableConfig.server ||= {}
      mutableConfig.server.hmr = false
    },
  },
  modules: ['@nuxtjs/mdc', '@nuxt/ui', 'eve/nuxt', 'nuxt-charts'],
  nuxtCharts: {
    prefix: 'Nc',
    include: ['LineChart'],
    global: false,
    autoImports: false,
  },
  eve: {
    eveRoot: 'agent',
  },
  // Eve runs its own Nitro/H3 runtime in development. Keep icons in the client
  // bundle so the CRM does not need a mixed-runtime /api/_nuxt_icon endpoint.
  icon: {
    provider: 'none',
    clientBundle: {
      icons: [
        'lucide:badge-percent',
        'lucide:ellipsis',
        'lucide:file-pen-line',
        'lucide:file-text',
        'lucide:filter-x',
        'lucide:folder',
        'lucide:folder-search-2',
        'lucide:layers-3',
        'lucide:landmark',
        'lucide:monitor',
        'lucide:mouse-pointer-2',
        'lucide:move',
        'lucide:panel-right',
        'lucide:receipt-text',
        'lucide:redo-2',
        'lucide:shield-alert',
        'lucide:table-properties',
      ],
      scan: true,
      sizeLimitKb: 512,
    },
  },
  nitro: {
    sourceMap: false,
    alias: {
      ...eveSharedAliases,
    },
    serverAssets: [
      {
        baseName: 'mortgage-template-pdfs',
        dir: fileURLToPath(new URL('../../mock-files', import.meta.url)),
      },
      {
        baseName: 'intermediary-document-fonts',
        dir: fileURLToPath(new URL('./public/fonts', import.meta.url)),
      },
    ],
    typescript: {
      tsConfig: {
        compilerOptions: {
          allowImportingTsExtensions: true,
        },
      },
    },
  },
  routeRules: {
    '/login': { prerender: true },
  },
  css: ['~/assets/css/main.css'],
  ui: {
    fonts: false,
    prose: true,
    theme: {
      colors: ['primary', 'secondary', 'success', 'info', 'warning', 'error'],
      transitions: true,
      defaultVariants: {
        color: 'neutral',
        size: 'sm',
      },
    },
  },
  runtimeConfig: {
    forumRealtime: {
      ablyApiKey: process.env.NUXT_FORUM_ABLY_API_KEY
        || process.env.NUXT_ABLY_API_KEY
        || '',
    },
    messaging: {
      ablyApiKey: process.env.NUXT_ABLY_API_KEY || '',
      outboxSecret: process.env.NUXT_MESSAGING_OUTBOX_SECRET || '',
    },
    notifications: {
      ablyApiKey: process.env.NUXT_NOTIFICATIONS_ABLY_API_KEY
        || process.env.NUXT_ABLY_API_KEY
        || '',
      outboxSecret: process.env.NUXT_NOTIFICATIONS_OUTBOX_SECRET
        || process.env.NUXT_MESSAGING_OUTBOX_SECRET
        || '',
    },
    multiformServiceUrl,
    bankMailAgent: {
      serviceUrl: bankMailAgentServiceUrl,
    },
    aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY || '',
    googleGenerativeAiApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
    ceidg: {
      apiBaseUrl: process.env.NUXT_CEIDG_API_BASE_URL || 'https://dane.biznes.gov.pl',
      globalHourlyLimit: Number.parseInt(process.env.NUXT_CEIDG_GLOBAL_HOURLY_LIMIT || '1000', 10),
      globalMinuteLimit: Number.parseInt(process.env.NUXT_CEIDG_GLOBAL_MINUTE_LIMIT || '120', 10),
      token: process.env.NUXT_CEIDG_API_TOKEN || '',
    },
    dataApi: {
      url: dataApiUrl,
      jwt: {
        audience: process.env.NUXT_DATA_API_JWT_AUDIENCE || 'openexpert-data',
        issuer: process.env.NUXT_DATA_API_JWT_ISSUER || 'openexpert-local',
        keyId: process.env.NUXT_DATA_API_JWT_KEY_ID || 'openexpert-local',
        privateKey: process.env.NUXT_DATA_API_JWT_PRIVATE_KEY || '',
      },
    },
    auth: {
      baseUrl: authBaseUrl,
      basePath: process.env.BETTER_AUTH_BASE_PATH || '/api/auth',
      databaseUrl: authDatabaseUrl,
      databaseSchema: process.env.BETTER_AUTH_DATABASE_SCHEMA || 'identity',
      ipAddressHeaders: authIpAddressHeaders,
      sessionFreshAge: Number(process.env.BETTER_AUTH_SESSION_FRESH_AGE || 600),
      disableSignUp: process.env.BETTER_AUTH_DISABLE_SIGN_UP !== 'false',
      magicLinkDisableSignUp: process.env.BETTER_AUTH_MAGIC_LINK_DISABLE_SIGN_UP !== 'false',
      secret: process.env.BETTER_AUTH_SECRET
        || process.env.NUXT_AUTH_SECRET
        || (process.env.NODE_ENV === 'production'
          ? ''
          : 'openexpert-local-auth-secret-change-me-000000000000'),
      cookiePrefix: process.env.BETTER_AUTH_COOKIE_PREFIX
        || (process.env.NODE_ENV === 'production' ? 'openexpert' : 'openexpert-local'),
      cookieDomain: process.env.NUXT_AUTH_COOKIE_DOMAIN || '',
      trustedOrigins: process.env.NUXT_AUTH_TRUSTED_ORIGINS
        || 'http://127.0.0.1:3003,http://127.0.0.1:3004,http://127.0.0.1:3006',
      socialProviders: {
        google: {
          clientId: process.env.BETTER_AUTH_GOOGLE_CLIENT_ID || '',
          clientSecret: process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET || '',
        },
        apple: {
          clientId: process.env.BETTER_AUTH_APPLE_CLIENT_ID || '',
          clientSecret: process.env.BETTER_AUTH_APPLE_CLIENT_SECRET || '',
        },
      },
    },
    clientPortal: {
      baseUrl: clientPortalBaseUrl,
      cookiePrefix: process.env.BETTER_AUTH_CLIENT_COOKIE_PREFIX
        || `${process.env.BETTER_AUTH_COOKIE_PREFIX
          || (process.env.NODE_ENV === 'production' ? 'openexpert' : 'openexpert-local')}-client`,
      invitationTtlSeconds: Number(process.env.NUXT_CLIENT_PORTAL_INVITATION_TTL_SECONDS || 3600),
    },
    authEmail: {
      apiKey: resendApiKey,
      from: process.env.NUXT_AUTH_EMAIL_FROM
        || (isProduction ? '' : process.env.NUXT_RESEND_FROM)
        || (isProduction ? '' : 'OpenExpert <security@auth.openexpert.local>'),
      replyTo: process.env.NUXT_AUTH_EMAIL_REPLY_TO
        || (isProduction ? '' : process.env.NUXT_RESEND_REPLY_TO)
        || '',
      smtp: {
        host: process.env.NUXT_SMTP_HOST || (process.env.NODE_ENV === 'production'
          ? ''
          : '127.0.0.1'),
        port: Number(process.env.NUXT_SMTP_PORT || 55325),
        secure: process.env.NUXT_SMTP_SECURE === 'true',
        user: process.env.NUXT_SMTP_USER || '',
        password: process.env.NUXT_SMTP_PASSWORD || '',
      },
    },
    mockBank: {
      enabled: mockBankEnabled,
      // Local/test environments are isolated and may expose the simulator to
      // every fixture tenant. A production deployment always requires an
      // explicit immutable organization-id allowlist in addition to enabled.
      allowAllOrganizations: !isProduction,
      organizationIds: mockBankOrganizationIds,
      email: {
        // The simulator is an application service with its own sender identity,
        // but it deliberately shares the single transactional Resend transport.
        apiKey: resendApiKey,
        from: process.env.NUXT_MOCK_BANK_EMAIL_FROM
          || (isProduction ? '' : 'OpenExpert Bank <dokumenty@bank.openexpert.local>'),
        replyTo: process.env.NUXT_MOCK_BANK_EMAIL_REPLY_TO || '',
        smtp: {
          host: process.env.NUXT_SMTP_HOST || (isProduction ? '' : '127.0.0.1'),
          port: Number(process.env.NUXT_SMTP_PORT || 55325),
          secure: process.env.NUXT_SMTP_SECURE === 'true',
          user: process.env.NUXT_SMTP_USER || '',
          password: process.env.NUXT_SMTP_PASSWORD || '',
        },
      },
    },
    authSms: {
      enabled: authPhoneEnabled,
      provider: authSmsProvider,
      demoAutoFill: process.env.NODE_ENV !== 'production'
        && authSmsProvider === 'local',
      gatewayUrl: authSmsGatewayUrl,
      gatewayToken: authSmsGatewayToken,
      sender: process.env.NUXT_AUTH_SMS_SENDER
        || process.env.NUXT_CONSENT_SMS_SENDER
        || 'OpenExpert',
      ttlSeconds: Number(process.env.NUXT_AUTH_PHONE_OTP_TTL_SECONDS || 300),
      maxOtpAttempts: Number(process.env.NUXT_AUTH_PHONE_OTP_MAX_ATTEMPTS || 5),
    },
    authPasskey: {
      enabled: authPasskeyEnabled,
      rpId: authPasskeyRpId,
      rpName: process.env.NUXT_AUTH_PASSKEY_RP_NAME || 'OpenExpert',
      origin: authPasskeyOrigin,
    },
    consentSms: {
      provider: process.env.NUXT_CONSENT_SMS_PROVIDER
        || (process.env.NODE_ENV === 'production' ? 'http' : 'local'),
      demoAutoFill: process.env.NUXT_CONSENT_SMS_DEMO_AUTO_FILL === 'true',
      gatewayUrl: process.env.NUXT_CONSENT_SMS_GATEWAY_URL || '',
      gatewayToken: process.env.NUXT_CONSENT_SMS_GATEWAY_TOKEN || '',
      sender: process.env.NUXT_CONSENT_SMS_SENDER || 'OpenExpert',
      otpSecret: process.env.NUXT_CONSENT_OTP_SECRET
        || (process.env.NODE_ENV === 'production'
          ? ''
          : 'openexpert-local-consent-otp-secret-change-me'),
      publicBaseUrl: process.env.NUXT_CONSENT_PUBLIC_BASE_URL || authBaseUrl,
      ttlSeconds: Number(
        process.env.NUXT_CONSENT_SMS_TTL_SECONDS
        || (Number(process.env.NUXT_CONSENT_SMS_TTL_MINUTES || 10) * 60),
      ),
      maxOtpAttempts: Number(process.env.NUXT_CONSENT_OTP_MAX_ATTEMPTS || 5),
    },
    storage: {
      provider: storageProvider,
      minio: {
        endpoint: process.env.NUXT_MINIO_ENDPOINT || 'http://127.0.0.1:55326',
        region: process.env.NUXT_MINIO_REGION || 'us-east-1',
        accessKeyId: process.env.NUXT_MINIO_ACCESS_KEY_ID || 'openexpert',
        secretAccessKey: process.env.NUXT_MINIO_SECRET_ACCESS_KEY || 'openexpert-minio-local-secret',
        publicBucket: process.env.NUXT_MINIO_PUBLIC_BUCKET || 'openexpert-public',
        privateBucket: process.env.NUXT_MINIO_PRIVATE_BUCKET || 'openexpert-private',
        publicBaseUrl: process.env.NUXT_MINIO_PUBLIC_BASE_URL
          || 'http://127.0.0.1:55326/openexpert-public',
      },
      vercelBlob: {
        publicToken: process.env.NUXT_VERCEL_BLOB_PUBLIC_TOKEN || '',
        publicStoreId: process.env.NUXT_VERCEL_BLOB_PUBLIC_STORE_ID || '',
        publicBaseUrl: process.env.NUXT_VERCEL_BLOB_PUBLIC_BASE_URL || '',
        privateToken: process.env.NUXT_VERCEL_BLOB_PRIVATE_TOKEN || '',
        privateStoreId: process.env.NUXT_VERCEL_BLOB_PRIVATE_STORE_ID || '',
      },
    },
    bookingSecurity: {
      trustProxy: process.env.NUXT_BOOKING_SECURITY_TRUST_PROXY === 'true'
        || (
          process.env.NUXT_BOOKING_SECURITY_TRUST_PROXY === undefined
          && process.env.VERCEL === '1'
        ),
      trustedIpHeaders: process.env.BETTER_AUTH_IP_ADDRESS_HEADERS
        || (process.env.VERCEL === '1' ? 'x-vercel-forwarded-for' : ''),
      rateLimitSecret: process.env.NUXT_BOOKING_RATE_LIMIT_SECRET
        || (process.env.NODE_ENV === 'production'
          ? ''
          : 'openexpert-local-booking-rate-limit-secret'),
    },
    calendarOAuth: {
      encryptionKey: '',
      google: {
        clientId: '',
        clientSecret: '',
        redirectUri: '',
      },
      microsoft: {
        clientId: '',
        clientSecret: '',
        redirectUri: '',
        tenant: 'common',
      },
    },
    mailOAuth: {
      encryptionKey: process.env.NUXT_MAIL_OAUTH_ENCRYPTION_KEY || '',
      // Decrypt-only bridge for credentials written with the historical key.
      // Never use this value for new ciphertext or connection references.
      legacyEncryptionKey: process.env.NUXT_MAIL_OAUTH_LEGACY_ENCRYPTION_KEY || '',
      google: {
        clientId: process.env.NUXT_MAIL_OAUTH_GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.NUXT_MAIL_OAUTH_GOOGLE_CLIENT_SECRET || '',
        redirectUri: process.env.NUXT_MAIL_OAUTH_GOOGLE_REDIRECT_URI || '',
      },
      microsoft: {
        clientId: process.env.NUXT_MAIL_OAUTH_MICROSOFT_CLIENT_ID || '',
        clientSecret: process.env.NUXT_MAIL_OAUTH_MICROSOFT_CLIENT_SECRET || '',
        redirectUri: process.env.NUXT_MAIL_OAUTH_MICROSOFT_REDIRECT_URI || '',
        tenant: process.env.NUXT_MAIL_OAUTH_MICROSOFT_TENANT || 'common',
      },
    },
    public: {
      openexpert: {
        hasAuthConfig: process.env.NODE_ENV !== 'production'
          || Boolean(process.env.BETTER_AUTH_SECRET || process.env.NUXT_AUTH_SECRET),
        landingBaseUrl: process.env.NUXT_PUBLIC_LANDING_BASE_URL
          || (process.env.NODE_ENV === 'production'
            ? 'https://www.openexpert.app'
            : 'http://127.0.0.1:3003'),
        clientPortalBaseUrl,
        social: {
          google: Boolean(
            process.env.BETTER_AUTH_GOOGLE_CLIENT_ID
            && process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET,
          ),
          apple: Boolean(
            process.env.BETTER_AUTH_APPLE_CLIENT_ID
            && process.env.BETTER_AUTH_APPLE_CLIENT_SECRET,
          ),
        },
        phone: {
          enabled: authPhoneEnabled,
          demo: process.env.NODE_ENV !== 'production'
            && authSmsProvider === 'local',
        },
        passkey: {
          enabled: authPasskeyEnabled,
        },
      },
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'pl' },
      title: 'OpenExpert CRM',
      meta: [
        { name: 'description', content: 'CRM dla platformy OpenExpert.' },
        { name: 'theme-color', content: '#030303' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },
})
