// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from 'node:url'

const databaseTypes = fileURLToPath(
  new URL('../../packages/database/database.types.ts', import.meta.url),
)

const multiformServiceUrl = process.env.NUXT_MULTIFORM_SERVICE_URL
  || process.env.NUXT_PUBLIC_MULTIFORM_EVE_URL?.replace(/\/multiform-eve\/?$/u, '')
  || 'http://127.0.0.1:3013'

export default defineNuxtConfig({
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
  modules: ['@nuxt/ui', '@nuxtjs/supabase', 'eve/nuxt', 'nuxt-charts'],
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
      icons: ['lucide:monitor'],
      scan: true,
      sizeLimitKb: 512,
    },
  },
  nitro: {
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
    bookingSecurity: {
      trustProxy: false,
      rateLimitSecret: '',
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
    public: {
      supabase: {
        url: process.env.NUXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:55321',
        key: process.env.NUXT_PUBLIC_SUPABASE_KEY || 'local-development-placeholder',
      },
    },
  },
  supabase: {
    types: databaseTypes,
    cookiePrefix: process.env.NODE_ENV === 'production' ? undefined : 'openexpert-local-auth',
    cookieOptions: {
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
    redirectOptions: {
      login: '/login',
      callback: '/confirm',
      exclude: [
        '/login',
        '/register',
        '/confirm',
        '/forgot-password',
        '/reset-password',
        '/design',
        '/book/*',
      ],
      saveRedirectToCookie: true,
    },
  },
  app: {
    pageTransition: { name: 'oe-page', mode: 'out-in' },
    head: {
      htmlAttrs: { lang: 'pl' },
      title: 'OpenExpert CRM',
      meta: [
        { name: 'description', content: 'CRM dla platformy OpenExpert.' },
      ],
    },
  },
})
