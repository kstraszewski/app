const isProduction = process.env.NODE_ENV === 'production'
const portalBaseUrl = process.env.NUXT_PUBLIC_CLIENT_BASE_URL
  || (process.env.NODE_ENV === 'production'
    ? 'https://client.openexpert.app'
    : 'http://127.0.0.1:3006')
const storageProvider = process.env.NUXT_STORAGE_PROVIDER
  || (process.env.VERCEL ? 'vercel-blob' : 'minio')
const dataApiUrl = process.env.NUXT_DATA_API_URL
  || process.env.NUXT_PUBLIC_DATA_API_URL
  || 'http://127.0.0.1:55321'
const portalPublicAssetBaseUrl = process.env.NUXT_PORTAL_PUBLIC_ASSET_BASE_URL
  || 'https://www.openexpert.app'
const authDatabaseUrl = process.env.NUXT_AUTH_DATABASE_URL
  || (isProduction
    ? ''
    : process.env.DATABASE_URL
      || 'postgresql://openexpert_auth:openexpert-auth-local@127.0.0.1:55322/openexpert')
const authIpAddressHeaders = process.env.BETTER_AUTH_IP_ADDRESS_HEADERS
  || (process.env.VERCEL ? 'x-vercel-forwarded-for' : '')
const googleClientId = process.env.BETTER_AUTH_GOOGLE_CLIENT_ID || ''
const googleClientSecret = process.env.BETTER_AUTH_GOOGLE_CLIENT_SECRET || ''
const appleClientId = process.env.BETTER_AUTH_APPLE_CLIENT_ID || ''
const appleClientSecret = process.env.BETTER_AUTH_APPLE_CLIENT_SECRET || ''
const demoEnabled = process.env.NUXT_PUBLIC_OPENEXPERT_DEMO_ENABLED === 'true'
  || process.env.NUXT_PUBLIC_DEMO_ENABLED === 'true'
const demoServerEnabled = process.env.NUXT_DEMO_ENABLED === 'true' || demoEnabled

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  typescript: {
    tsConfig: {
      compilerOptions: { allowImportingTsExtensions: true },
    },
  },
  ui: {
    fonts: false,
    colorMode: false,
    theme: {
      colors: ['primary', 'secondary', 'success', 'info', 'warning', 'error'],
      transitions: true,
      defaultVariants: {
        color: 'neutral',
        size: 'md',
      },
    },
  },
  icon: {
    clientBundle: {
      scan: true,
      sizeLimitKb: 256,
    },
  },
  runtimeConfig: {
    messaging: {
      ablyApiKey: process.env.NUXT_ABLY_API_KEY || '',
    },
    notifications: {
      outboxUrl: process.env.OPENEXPERT_NOTIFICATION_OUTBOX_URL || '',
      outboxSecret: process.env.NUXT_NOTIFICATIONS_OUTBOX_SECRET
        || process.env.NUXT_MESSAGING_OUTBOX_SECRET
        || '',
    },
    portalAssets: {
      publicBaseUrl: portalPublicAssetBaseUrl,
    },
    demo: {
      enabled: demoServerEnabled,
      passwordHash: process.env.NUXT_DEMO_PASSWORD_HASH || '',
      sessionSecret: process.env.NUXT_DEMO_SESSION_SECRET || '',
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
      baseUrl: process.env.NUXT_AUTH_BASE_URL
        || process.env.BETTER_AUTH_URL
        || portalBaseUrl,
      basePath: process.env.BETTER_AUTH_BASE_PATH || '/api/auth',
      databaseUrl: authDatabaseUrl,
      databaseSchema: process.env.BETTER_AUTH_DATABASE_SCHEMA || 'identity',
      ipAddressHeaders: authIpAddressHeaders,
      sessionFreshAge: Number(process.env.BETTER_AUTH_SESSION_FRESH_AGE || 600),
      secret: process.env.BETTER_AUTH_SECRET
        || process.env.NUXT_AUTH_SECRET
        || (process.env.NODE_ENV === 'production'
          ? ''
          : 'openexpert-local-auth-secret-change-me-000000000000'),
      cookiePrefix: process.env.BETTER_AUTH_CLIENT_COOKIE_PREFIX
        || `${process.env.BETTER_AUTH_COOKIE_PREFIX
          || (process.env.NODE_ENV === 'production' ? 'openexpert' : 'openexpert-local')}-client`,
      cookieDomain: process.env.NUXT_CLIENT_AUTH_COOKIE_DOMAIN || '',
      trustedOrigins: process.env.NUXT_AUTH_TRUSTED_ORIGINS
        || 'http://127.0.0.1:3003,http://127.0.0.1:3004,http://127.0.0.1:3006',
      socialProviders: {
        google: {
          clientId: googleClientId,
          clientSecret: googleClientSecret,
        },
        apple: {
          clientId: appleClientId,
          clientSecret: appleClientSecret,
        },
      },
    },
    authEmail: {
      apiKey: process.env.NUXT_AUTH_RESEND_API_KEY
        || (isProduction ? '' : process.env.NUXT_RESEND_API_KEY)
        || '',
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
    public: {
      openexpert: {
        portalBaseUrl,
        authBaseUrl: process.env.NUXT_PUBLIC_AUTH_BASE_URL || '',
        demoEnabled,
        hasAuthConfig: process.env.NODE_ENV !== 'production'
          || Boolean(process.env.BETTER_AUTH_SECRET || process.env.NUXT_AUTH_SECRET),
        social: {
          google: Boolean(googleClientId && googleClientSecret),
          apple: Boolean(appleClientId && appleClientSecret),
        },
      },
    },
  },
  routeRules: {
    '/login': { prerender: true },
    '/preview/**': { ssr: false },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'pl' },
      title: 'Panel klienta — OpenExpert',
      meta: [
        { name: 'description', content: 'Bezpieczny panel klienta OpenExpert.' },
        { name: 'robots', content: 'noindex, nofollow' },
        { name: 'theme-color', content: '#ffffff' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      ],
    },
  },
})
