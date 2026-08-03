import { fileURLToPath } from 'node:url'

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
  modules: ['@nuxt/ui'],
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
  nitro: {
    publicAssets: [
      {
        dir: fileURLToPath(new URL('../crm/public/fonts', import.meta.url)),
        baseURL: '/fonts',
        maxAge: 31_536_000,
      },
      {
        dir: fileURLToPath(new URL('../crm/public/assets', import.meta.url)),
        baseURL: '/assets',
        maxAge: 31_536_000,
      },
    ],
  },
  icon: {
    provider: 'none',
    clientBundle: {
      scan: true,
      sizeLimitKb: 256,
      icons: [
        'lucide:arrow-right',
        'lucide:briefcase-business',
        'lucide:camera',
        'lucide:check',
        'lucide:chevron-left',
        'lucide:circle-alert',
        'lucide:columns-2',
        'lucide:copy',
        'lucide:hourglass',
        'lucide:info',
        'lucide:layout-grid',
        'lucide:link',
        'lucide:lock-keyhole',
        'lucide:maximize',
        'lucide:mic',
        'lucide:mic-off',
        'lucide:minimize',
        'lucide:monitor-up',
        'lucide:phone-off',
        'lucide:picture-in-picture-2',
        'lucide:shield-check',
        'lucide:user-round',
        'lucide:user-round-plus',
        'lucide:users',
        'lucide:video',
        'lucide:video-off',
        'lucide:volume-2',
        'lucide:wifi',
      ],
    },
  },
  runtimeConfig: {
    livekitApiKey: '',
    livekitApiSecret: '',
    meetingsAccessCode: '',
    meetingsEmbedOrigin: '',
    meetingsRoomName: '',
    public: {
      livekitUrl: '',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'pl' },
      title: 'OpenExpert Meet',
      meta: [
        {
          name: 'description',
          content: 'Testowa aplikacja do spotkań online oparta na LiveKit.',
        },
        { name: 'theme-color', content: '#ffffff' },
      ],
    },
  },
})
