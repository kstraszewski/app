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
      colors: ['primary', 'success', 'warning', 'error'],
      transitions: true,
    },
  },
  icon: {
    provider: 'none',
    clientBundle: {
      scan: true,
      sizeLimitKb: 256,
      icons: [
        'lucide:arrow-right',
        'lucide:camera',
        'lucide:check',
        'lucide:chevron-left',
        'lucide:circle-alert',
        'lucide:copy',
        'lucide:layout-grid',
        'lucide:link',
        'lucide:lock-keyhole',
        'lucide:maximize',
        'lucide:mic',
        'lucide:mic-off',
        'lucide:minimize',
        'lucide:monitor-up',
        'lucide:phone-off',
        'lucide:shield-check',
        'lucide:sparkles',
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
        { name: 'theme-color', content: '#0b0c10' },
      ],
    },
  },
})
