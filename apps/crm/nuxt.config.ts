// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

const multiformServiceUrl = process.env.NUXT_MULTIFORM_SERVICE_URL
  || process.env.NUXT_PUBLIC_MULTIFORM_EVE_URL?.replace(/\/multiform-eve\/?$/u, '')
  || 'http://127.0.0.1:3013'
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
const authDatabaseUrl = process.env.NUXT_AUTH_DATABASE_URL
  || process.env.DATABASE_URL
  || 'postgresql://openexpert_auth:openexpert-auth-local@127.0.0.1:55322/openexpert'

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
    'vite:extendConfig'(config) {
      const mutableConfig = config as typeof config & { server?: { hmr?: boolean } }
      mutableConfig.server ||= {}
      mutableConfig.server.hmr = false
    },
  },
  modules: ['@nuxt/ui', 'eve/nuxt', 'nuxt-charts'],
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
    serverAssets: [
      {
        baseName: 'mortgage-template-pdfs',
        dir: fileURLToPath(new URL('../../mock-files', import.meta.url)),
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
  css: ['~/assets/css/main.css'],
  ui: {
    fonts: false,
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
    multiformServiceUrl,
    aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY || '',
    googleGenerativeAiApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
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
      baseUrl: process.env.NUXT_CLIENT_PORTAL_BASE_URL
        || (process.env.NODE_ENV === 'production'
          ? 'https://client.openexpert.app'
          : 'http://127.0.0.1:3006'),
      cookiePrefix: process.env.BETTER_AUTH_CLIENT_COOKIE_PREFIX
        || `${process.env.BETTER_AUTH_COOKIE_PREFIX
          || (process.env.NODE_ENV === 'production' ? 'openexpert' : 'openexpert-local')}-client`,
      invitationTtlSeconds: Number(process.env.NUXT_CLIENT_PORTAL_INVITATION_TTL_SECONDS || 3600),
    },
    authEmail: {
      apiKey: process.env.NUXT_RESEND_API_KEY || '',
      from: process.env.NUXT_AUTH_EMAIL_FROM
        || process.env.NUXT_RESEND_FROM
        || 'OpenExpert <no-reply@openexpert.local>',
      replyTo: process.env.NUXT_AUTH_EMAIL_REPLY_TO
        || process.env.NUXT_RESEND_REPLY_TO
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
        oidcToken: process.env.VERCEL_OIDC_TOKEN || '',
      },
    },
    bookingSecurity: {
      trustProxy: false,
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
      encryptionKey: '',
      google: {
        clientId: '',
        clientSecret: '',
        redirectUri: '',
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
        clientPortalBaseUrl: process.env.NUXT_PUBLIC_CLIENT_PORTAL_BASE_URL
          || process.env.NUXT_CLIENT_PORTAL_BASE_URL
          || (process.env.NODE_ENV === 'production'
            ? 'https://client.openexpert.app'
            : 'http://127.0.0.1:3006'),
      },
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'pl' },
      title: 'OpenExpert CRM',
      meta: [
        { name: 'description', content: 'CRM dla platformy OpenExpert.' },
      ],
    },
  },
})
